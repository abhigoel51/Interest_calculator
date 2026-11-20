// UI smoke test for app/InterestCalculator.html (headless Chrome over raw CDP, no npm deps).
// Run:  /opt/homebrew/bin/node tests/ui_smoke.js        (node >= 22: global WebSocket + fetch)
// Env:  WAIT_FOR_REBUILD=1  wait (up to 20 min) for the app file to be rebuilt before testing
//       CHROME=/path/to/chrome  override Chrome binary
// Exit code 1 on any failure. Chrome and the static server are always cleaned up.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..', 'app');
const APP_FILE = path.join(APP_DIR, 'InterestCalculator.html');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const START = Date.now();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForApp() {
  if (!process.env.WAIT_FOR_REBUILD) return;
  const deadline = START + 20 * 60 * 1000;
  for (;;) {
    let ok = false, why = '';
    try {
      const st = fs.statSync(APP_FILE);
      const txt = fs.readFileSync(APP_FILE, 'utf8');
      const has = txt.includes('people-total-due') && !txt.includes('peoplePop');
      const quiet = Date.now() - st.mtimeMs >= 60 * 1000;
      ok = has && quiet;
      why = `v11 people-total-due present & peoplePop gone=${has} unmodified>=60s=${quiet}`;
    } catch (e) { why = String(e.message); }
    if (ok) return;
    if (Date.now() > deadline) throw new Error('timed out waiting for app: ' + why);
    console.log(`waiting for app (${why}); retry in 30s`);
    await sleep(30000);
  }
}

function startServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/InterestCalculator.html';
    const f = path.join(APP_DIR, path.normalize(p));
    if (!f.startsWith(APP_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function launchChrome(userDir) {
  const proc = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDir}`,
    '--window-size=1366,768', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-extensions', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('Chrome did not report DevTools URL')), 30000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', (c) => reject(new Error('Chrome exited early: ' + c)));
  });
  return { proc, wsUrl };
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.handlers = [];
    this.opened = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('ws error')); });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) this.handlers.forEach((h) => h(m));
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify(msg)); });
  }
  on(h) { this.handlers.push(h); }
}

async function main() {
  await waitForApp();
  const server = await startServer();
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/InterestCalculator.html`;
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-smoke-'));
  const chrome = launchChrome(userDir);
  chrome.wsUrl.catch(() => {});
  const results = [];
  const jsErrors = [];
  const nativeDialogs = [];
  let cdp;
  try {
    cdp = new CDP(await chrome.wsUrl);
    await cdp.opened;
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = (m, p) => cdp.send(m, p, sessionId);
    cdp.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Page.javascriptDialogOpening') {
        nativeDialogs.push(m.params.type + ': ' + m.params.message);
        S('Page.handleJavaScriptDialog', { accept: true, promptText: m.params.defaultPrompt || 'Test Person' }).catch(() => {});
      } else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        jsErrors.push('exception: ' + ((d.exception && d.exception.description) || d.text));
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        jsErrors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && m.params.entry.source !== 'network') {
        jsErrors.push('log error: ' + m.params.entry.text);
      }
    });
    await S('Page.enable'); await S('Runtime.enable'); await S('Log.enable');
    await S('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });

    const ev = async (expr) => {
      const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    };
    const load = async () => {
      await S('Page.navigate', { url });
      for (let i = 0; i < 100; i++) {
        if (await ev(`document.readyState==='complete' && !!document.querySelector('[data-testid="amount-due"]')`)) return;
        await sleep(100);
      }
      throw new Error('page did not load / amount-due missing');
    };

    // In-page helpers
    const HELPERS = `
      window.__q = (id, root) => (root || document).querySelector('[data-testid="' + id + '"]');
      window.__set = (el, v, isSelect) => {
        if (!el) throw new Error('element missing');
        el.focus && el.focus();
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        if (isSelect) el.dispatchEvent(new Event('change', { bubbles: true }));
        else el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      window.__txt = (id) => { const e = window.__q(id); return e ? e.textContent.trim() : null; };
      window.__rows = () => Array.from(document.querySelectorAll('[data-testid="loan-row"]'));
      window.__clickByText = (re) => {
        const els = Array.from(document.querySelectorAll('button,a,[role=button],summary'));
        const e = els.find((x) => new RegExp(re, 'i').test(x.textContent));
        if (!e) return false; e.click(); return true;
      };
      true;`;
    const inject = () => ev(HELPERS);
    const num = (s) => (s == null ? NaN : parseFloat(String(s).replace(/,/g, '').replace(/[^\d.\-]/g, '')));
    const readTotals = async () => ({
      principal: num(await ev(`__txt('total-principal')`)),
      interest: num(await ev(`__txt('total-interest')`)),
      due: num(await ev(`__txt('amount-due')`)),
    });
    const near = (a, b) => Math.abs(a - b) <= 0.01;
    const expectNum = (label, a, b) => { if (!near(a, b)) throw new Error(`${label}: expected ${b}, got ${a}`); };
    const domState = () => ev(`JSON.stringify({totals:{p:__txt('total-principal'),i:__txt('total-interest'),d:__txt('amount-due')},rows:__rows().length,results:Array.from(document.querySelectorAll('[data-testid="result-row"]')).map(r=>r.textContent.trim().replace(/\\s+/g,' '))})`);
    const settle = () => sleep(150);

    const run = async (name, fn) => {
      try { await fn(); results.push([name, true]); console.log('PASS  ' + name); }
      catch (e) {
        let st = ''; try { st = await domState(); } catch (_) {}
        results.push([name, false]); console.log('FAIL  ' + name + '\n      ' + e.message + '\n      DOM: ' + st);
      }
    };

    const formState = () => ev(`JSON.stringify({date:__q('loan-date').value,debit:__q('loan-debit').value,credit:__q('loan-credit').value,amount:(__q('loan-debit').value||__q('loan-credit').value),type:(__q('loan-credit').value?'repayment':'loan'),note:__q('loan-note').value,btn:__txt('add-loan'),cancel:!!__q('loan-cancel')&&__q('loan-cancel').offsetParent!==null})`).then(JSON.parse);
    const fillForm = (date, amount, type, note) => ev(`(() => {
      __set(__q('loan-date'), ${JSON.stringify(date)});
      __set(__q(${JSON.stringify(type === 'repayment' ? 'loan-debit' : 'loan-credit')}), '');
      __set(__q(${JSON.stringify(type === 'repayment' ? 'loan-credit' : 'loan-debit')}), ${JSON.stringify(String(amount))});
      __set(__q('loan-note'), ${JSON.stringify(note || '')}); })()`);
    const assertFormCleared = async (label) => {
      const f = await formState();
      if (f.date || f.debit || f.credit || f.note) throw new Error(`${label}: form not cleared: ` + JSON.stringify(f));
      if (f.btn !== 'Add') throw new Error(`${label}: add button text "${f.btn}", expected Add`);
    };
    const addLoan = async (date, amount, type, note) => {
      const n = await ev(`__rows().length`);
      await fillForm(date, amount, type, note);
      await ev(`__q('add-loan').click()`);
      await settle();
      const m = await ev(`__rows().length`);
      if (m !== n + 1) throw new Error(`add-loan (${date} ${amount} ${type}): rows ${n} -> ${m}`);
      await assertFormCleared(`after add ${date} ${amount}`);
    };
    // click loan-edit on the row whose text contains `re` (amount text)
    const editRowMatching = async (re) => {
      const ok = await ev(`(() => { const r = __rows().find(r => ${re}.test(r.textContent)); if (!r) return false; __q('loan-edit', r).click(); return true; })()`);
      if (!ok) throw new Error('no loan-row matching ' + re);
      await settle();
    };

    // a. fresh load, sample person
    await run('a. fresh load, sample person (due 155579.38, interest 15579.38)', async () => {
      await load(); await inject(); await settle();
      const t = await readTotals();
      expectNum('amount-due', t.due, 155579.38);
      expectNum('total-interest', t.interest, 15579.38);
      const calc = await ev(`__q('calc-date').value`);
      if (!/^0?1[-\/.]0?11[-\/.]2026$|^2026-11-01$/.test(calc)) throw new Error('sample calc-date unexpected: ' + calc);
    });

    // b. new person flow via the single entry form
    await run('b. new person: 2x70000 + 20000 repayment via form (interest 14154.38, due 134154.38)', async () => {
      // 14154.38 = 15579.375 (two 70000 loans) - 1425 (20000 repayment dated 10-05-2026)
      const ok = await ev(`__clickByText('new person')`);
      if (!ok) throw new Error('no "+ New person" button found');
      await sleep(300);
      await ev(`__set(__q('person-name'), 'Smoke Tester')`);
      await ev(`__set(__q('calc-date'), '01-11-2026')`);
      await ev(`__set(__q('roi'), '1.25')`);
      await ev(`__set(__q('comp'), '6')`);
      await settle();
      await assertFormCleared('initial form');
      await addLoan('10-02-2026', 70000, 'loan');
      await addLoan('10-02-2026', 70000, 'loan');
      await addLoan('10-05-2026', 20000, 'repayment');
      const n = await ev(`__rows().length`);
      if (n !== 3) throw new Error('expected 3 loan rows, got ' + n);
      const t = await readTotals();
      expectNum('total-interest', t.interest, 14154.38);
      expectNum('amount-due', t.due, 134154.38);
      const rr = await ev(`document.querySelectorAll('[data-testid="result-row"]').length`);
      if (rr !== 3) throw new Error('expected 3 result-rows, got ' + rr);
    });

    // c. future-dated loan
    await run('c. future-dated loan 15-12-2026: interest 0', async () => {
      const before = await readTotals();
      await addLoan('15-12-2026', 5000, 'loan');
      const n = await ev(`__rows().length`);
      if (n !== 4) throw new Error('expected 4 rows, got ' + n);
      const after = await readTotals();
      expectNum('total-interest unchanged', after.interest, before.interest);
      expectNum('amount-due (+5000 principal only)', after.due, before.due + 5000);
      const txt = await ev(`Array.from(document.querySelectorAll('[data-testid="result-row"]')).find(r => /15-12-2026/.test(r.textContent)).textContent.replace(/\\s+/g,' ')`);
      if (!/after|future|not yet/i.test(txt) && !/\b0\.00\b/.test(txt)) throw new Error('future row shows no note/zero interest: ' + txt);
    });

    // d. edit the 20000 repayment -> 10000
    await run('d. edit: repayment 20000 -> 10000 (interest 14866.875, row count unchanged)', async () => {
      // independent value: 15579.375 - 10000 repayment interest (1425/2 = 712.5) = 14866.875; future row adds 0
      const nBefore = await ev(`__rows().length`);
      await editRowMatching('/20,?000/');
      const f = await formState();
      if (f.btn !== 'Update') throw new Error('add-loan text after edit: "' + f.btn + '", expected Update');
      if (!f.cancel) throw new Error('loan-cancel not visible while editing');
      if (num(f.amount) !== 20000) throw new Error('form amount not loaded: ' + f.amount);
      if (f.type !== 'repayment') throw new Error('form type not loaded: ' + f.type);
      if (!/10[-\/.]0?5[-\/.]2026|2026-05-10/.test(f.date)) throw new Error('form date not loaded: ' + f.date);
      await ev(`__set(__q('loan-credit'), '10000')`);
      await ev(`__q('add-loan').click()`);
      await settle();
      const n = await ev(`__rows().length`);
      if (n !== nBefore) throw new Error(`row count changed ${nBefore} -> ${n}`);
      await assertFormCleared('after update');
      const t = await readTotals();
      expectNum('total-interest', t.interest, 15579.375 - 712.5);
      expectNum('total-principal', t.principal, 135000);
      expectNum('amount-due', t.due, 135000 + 15579.375 - 712.5);
    });

    // e. cancel edit
    await run('e. cancel edit: button back to Add, nothing changes', async () => {
      const before = await readTotals(); const nBefore = await ev(`__rows().length`);
      const rowsTxt = await ev(`JSON.stringify(__rows().map(r => r.textContent.replace(/\\s+/g,' ').trim()))`);
      await editRowMatching('/70,?000/');
      let f = await formState();
      if (f.btn !== 'Update') throw new Error('expected Update while editing, got ' + f.btn);
      await ev(`__q('loan-cancel').click()`);
      await settle();
      await assertFormCleared('after cancel');
      f = await formState();
      if (f.cancel) throw new Error('loan-cancel still visible after cancel');
      const t = await readTotals();
      expectNum('total-interest', t.interest, before.interest);
      expectNum('amount-due', t.due, before.due);
      if ((await ev(`__rows().length`)) !== nBefore) throw new Error('row count changed after cancel');
      const rowsTxt2 = await ev(`JSON.stringify(__rows().map(r => r.textContent.replace(/\\s+/g,' ').trim()))`);
      if (rowsTxt !== rowsTxt2) throw new Error('rows changed after cancel: ' + rowsTxt + ' -> ' + rowsTxt2);
    });

    // f. validation
    await run('f. validation: empty date shows form-error, adds no row', async () => {
      const n = await ev(`__rows().length`); const before = await readTotals();
      await fillForm('', 1234, 'loan', '');
      await ev(`__q('add-loan').click()`);
      await settle();
      const err = await ev(`Array.from(document.querySelectorAll('[data-testid="form-error"]')).filter(e => e.offsetParent !== null && e.textContent.trim()).map(e => e.textContent.trim())`);
      if (!err.length) throw new Error('no visible form-error after adding with empty date');
      if ((await ev(`__rows().length`)) !== n) throw new Error('row added despite invalid date');
      const t = await readTotals();
      expectNum('amount-due unchanged', t.due, before.due);
      // clear the form for later scenarios
      await fillForm('', '', 'loan', '');
    });

    // g. delete with in-page confirm
    await run('g. delete: confirm-no keeps row, confirm-yes removes it and updates totals', async () => {
      const n = await ev(`__rows().length`); const before = await readTotals();
      const delLast = () => ev(`(() => { const r = __rows().find(r => /15-12-2026/.test(r.textContent)); __q('loan-delete', r).click(); return true; })()`);
      await delLast(); await settle();
      if (!(await ev(`!!__q('confirm-yes') && !!__q('confirm-no')`))) throw new Error('confirm-yes/confirm-no not shown after loan-delete');
      await ev(`__q('confirm-no').click()`); await settle();
      if ((await ev(`__rows().length`)) !== n) throw new Error('row removed after confirm-no');
      let t = await readTotals();
      expectNum('amount-due after confirm-no', t.due, before.due);
      if (await ev(`!!__q('confirm-yes')`)) throw new Error('confirm buttons still present after confirm-no');
      // now really delete the future-dated 5000 row
      await delLast(); await settle();
      await ev(`__q('confirm-yes').click()`); await settle(); await sleep(200);
      if ((await ev(`__rows().length`)) !== n - 1) throw new Error('row not removed after confirm-yes');
      t = await readTotals();
      expectNum('amount-due after delete', t.due, before.due - 5000);
      expectNum('total-interest after delete', t.interest, before.interest);
    });

    // h. persistence
    await run('h. persistence across reload', async () => {
      const before = await readTotals();
      const nBefore = await ev(`__rows().length`);
      if (nBefore !== 3) throw new Error('precondition: expected 3 rows before reload, got ' + nBefore);
      await load(); await inject(); await settle();
      const t = await readTotals();
      expectNum('total-interest', t.interest, before.interest);
      expectNum('amount-due', t.due, before.due);
      expectNum('total-principal', t.principal, before.principal);
      const n = await ev(`__rows().length`);
      if (n !== nBefore) throw new Error(`loan rows ${nBefore} -> ${n}`);
      const name = await ev(`__q('person-name').value`);
      if (name !== 'Smoke Tester') throw new Error('person-name after reload: ' + name);
    });


    // ---- v4 scenarios (j-n) run on a freshly seeded sample person ----
    const reseed = async () => { await ev(`localStorage.clear(); true`); await load(); await inject(); await settle(); };
    const calOpen = () => ev(`!!__q('cal-popover')`);
    const openCal = async (idx) => {
      await ev(`document.querySelectorAll('[data-testid="cal-btn"]')[${idx}].click(); true`);
      await settle();
      if (!(await calOpen())) throw new Error(`cal-popover missing after clicking cal-btn #${idx + 1}`);
    };
    const pickDay = async (iso) => {
      const [y, m] = iso.split('-').map(Number);
      await ev(`__set(__q('cal-month'), '${m - 1}', true); __set(__q('cal-year'), '${y}', true); true`);
      await settle();
      const ok = await ev(`(() => { const d = document.querySelector('[data-testid="cal-day"][data-date="${iso}"]'); if (!d) return false; d.click(); return true; })()`);
      if (!ok) throw new Error('cal-day ' + iso + ' not found');
      await settle();
    };
    const mouseClick = async (x, y) => {
      for (const type of ['mousePressed', 'mouseReleased'])
        await S('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
      await settle();
    };
    const pressEsc = async () => {
      await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await settle();
    };

    await run('j. calendar: pick 2026-06-20 via loan-date picker, popover removed, field = 20-06-2026', async () => {
      await reseed();
      await openCal(1);
      await pickDay('2026-06-20');
      if (await calOpen()) throw new Error('cal-popover still in DOM after picking a day');
      const v = await ev(`__q('loan-date').value`);
      if (v !== '20-06-2026') throw new Error('loan-date value: ' + v);
      await fillForm('', '', 'loan', '');
    });

    await run('k. calendar closes on Esc / outside click / same icon; no native date input', async () => {
      await openCal(1); await pressEsc();
      if (await calOpen()) throw new Error('popover still open after Escape');
      await openCal(1); await mouseClick(5, 5);
      if (await calOpen()) throw new Error('popover still open after click at (5,5)');
      await openCal(1);
      await ev(`document.querySelectorAll('[data-testid="cal-btn"]')[1].click(); true`); await settle();
      if (await calOpen()) throw new Error('popover still open after clicking the same cal-btn again');
      const n = await ev(`document.querySelectorAll('input[type=date]').length`);
      if (n) throw new Error(n + ' native input[type=date] elements in page');
      // also none while the popover is open
      await openCal(0);
      const n2 = await ev(`document.querySelectorAll('input[type=date]').length`);
      await pressEsc();
      if (n2) throw new Error(n2 + ' native input[type=date] elements while popover open');
    });

    await run('l. calc-date calendar: pick 2026-10-01 changes due, restoring 2026-11-01 returns 155579.38', async () => {
      const before = await readTotals();
      expectNum('initial due', before.due, 155579.38);
      await openCal(0);
      await pickDay('2026-10-01');
      if (await calOpen()) throw new Error('popover still open after pick');
      const cd = await ev(`__q('calc-date').value`);
      if (cd !== '01-10-2026') throw new Error('calc-date after pick: ' + cd);
      const mid = await readTotals();
      if (near(mid.due, 155579.38)) throw new Error('amount-due did not change after picking another calc date: ' + mid.due);
      await openCal(0);
      await pickDay('2026-11-01');
      const cd2 = await ev(`__q('calc-date').value`);
      if (cd2 !== '01-11-2026') throw new Error('calc-date after restore: ' + cd2);
      const after = await readTotals();
      expectNum('restored due', after.due, 155579.38);
    });

    const visible = (id) => `(() => { const e = __q('${id}'); if (!e) return false; const c = getComputedStyle(e); return c.display !== 'none' && c.visibility !== 'hidden' && e.offsetParent !== null || (c.position === 'fixed' && c.display !== 'none'); })()`;
    const setPrint = (on) => S('Emulation.setEmulatedMedia', { media: on ? 'print' : '' });

    await run('m. print summary default (sample person)', async () => {
      await reseed();
      await setPrint(true);
      try {
        await settle();
        if (!(await ev(visible('print-area')))) throw new Error('print-area not visible under print media');
        const name = await ev(`__txt('print-name')`);
        const personName = await ev(`__q('person-name').value`);
        if (!name || !personName || !name.includes(personName)) throw new Error(`print-name "${name}" does not contain person name "${personName}"`);
        expectNum('print-principal', num(await ev(`__txt('print-principal')`)), 140000);
        expectNum('print-interest', num(await ev(`__txt('print-interest')`)), 15579.38);
        expectNum('print-due', num(await ev(`__txt('print-due')`)), 155579.38);
        const months = await ev(`__txt('print-months')`);
        if (!months || !months.includes('8.7')) throw new Error('print-months: ' + months);
        if (await ev(`!!__q('print-breakdown') && (${visible('print-breakdown')})`)) throw new Error('print-breakdown visible by default');
        const it = await ev(`__q('print-area').innerText`);
        if (it.includes('1.25') || it.includes('%')) throw new Error('print-area shows interest rate: ' + JSON.stringify(it));
        if (!(await ev(visible('print-principal-list')))) throw new Error('print-principal-list not visible under print media');
        const prows = await ev(`Array.from(document.querySelectorAll('[data-testid="print-principal-row"]')).map(r => r.textContent.replace(/\\s+/g, ' ').trim())`);
        if (prows.length !== 2) throw new Error('print-principal-row count: ' + prows.length);
        for (const t of prows) if (!t.includes('70,000.00') || !t.includes('10-02-2026')) throw new Error('principal row text: ' + t);
        const plTxt = await ev(`__q('print-principal-list').textContent`);
        if (plTxt.includes('7,789.69')) throw new Error('principal list shows per-loan interest: ' + plTxt);
        const ui = await ev(`(() => { const e = __q('person-name'); return e.offsetParent !== null && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; })()`);
        if (ui) throw new Error('main app form (person-name) still visible under print media');
      } finally { await setPrint(false); }
    });

    await run('n. print with breakdown ticked: 2 rows; checkbox resets on reload', async () => {
      await ev(`__q('print-include-breakdown').click(); true`);
      await settle();
      if (!(await ev(`__q('print-include-breakdown').checked`))) throw new Error('checkbox did not become ticked');
      await setPrint(true);
      try {
        await settle();
        if (!(await ev(visible('print-breakdown')))) throw new Error('print-breakdown not visible under print media when ticked');
        const rows = await ev(`(() => { const t = __q('print-breakdown'); return t.querySelectorAll('tbody tr:not(.grp):not(.subt)').length; })()`);
        if (rows !== 2) throw new Error('print-breakdown rows: ' + rows + ', expected 2');
        if (await ev(`!!__q('print-principal-list') && (${visible('print-principal-list')})`)) throw new Error('print-principal-list visible while breakdown ticked');
      } finally { await setPrint(false); }
      await load(); await inject(); await settle();
      if (await ev(`__q('print-include-breakdown').checked`)) throw new Error('checkbox still ticked after reload');
    });

    // ---- v5 scenarios (o-r) ----
    const TODAY = `(() => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear(); })()`;
    const histVisible = () => ev(visible('history-view'));
    const openHistory = async () => {
      await ev(`__q('history-btn').click(); true`); await settle();
      if (!(await histVisible())) throw new Error('history-view not visible after clicking history-btn');
    };
    const histRows = () => ev(`document.querySelectorAll('[data-testid="history-row"]').length`);
    const stubPrint = () => ev(`window.print = () => {}; true`);

    await run('o. loans list alignment: Amount/Interest/Total values right-align under headers (default and 1.25 zoom)', async () => {
      await reseed();
      await addLoan('02-03-2024', 700, 'loan');
      await addLoan('01-09-2025', 7000, 'loan');
      await addLoan('01-01-2026', 1250000, 'loan');
      const check = async (label) => {
        for (const amt of [700, 7000, 1250000]) {
          const r = await ev(`(() => {
            const leafText = (e) => e.textContent.replace(/\\s+/g, ' ').trim();
            const rows = __rows();
            const find = (t) => Array.from(document.querySelectorAll('*')).filter((e) => leafText(e) === t && !e.closest('[data-testid="loan-row"]') && !e.closest('label') && !['INPUT','SELECT','OPTION','BUTTON'].includes(e.tagName)
              && e.parentElement && ['Amount','Interest','Total'].every((w) => leafText(e.parentElement).includes(w)));
            const H = {};
            for (const k of ['Amount','Interest','Total']) { const f = find(k); if (!f.length) return { error: 'header cell not found: ' + k }; H[k] = f[f.length - 1].getBoundingClientRect().right; }
            const isNum = (t) => /^[\\u2212\\-+]?\\s*(\\u20b9\\s*)?[\\d,]+(\\.\\d+)?$/.test(t);
            const val = (t) => parseFloat(t.replace(/,/g, '').replace(/[^\\d.]/g, ''));
            const row = rows.find((r) => Array.from(r.querySelectorAll('td,th')).concat(Array.from(r.children)).some((c) => isNum(leafText(c)) && val(leafText(c)) === ${amt}));
            if (!row) return { error: 'no loan-row with amount cell ${amt}', rows: rows.map(leafText) };
            const tds = Array.from(row.querySelectorAll('td,th'));
            const cells = tds.length >= 5 ? tds : Array.from(row.children);
            const idx = cells.findIndex((c) => isNum(leafText(c)) && val(leafText(c)) === ${amt});
            const R = (c) => c ? c.getBoundingClientRect().right : null;
            return { H, idx, n: cells.length, a: R(cells[idx]), i: R(cells[idx + 1]), t: R(cells[idx + 2]), texts: cells.map(leafText) };
          })()`);
          if (r.error) throw new Error(`${label}: ${r.error} ${JSON.stringify(r.rows || '')}`);
          if (r.idx !== 2) throw new Error(`${label}: amount ${amt} found in column ${r.idx + 1}, expected 3rd; cells=${JSON.stringify(r.texts)}`);
          for (const [k, v, h] of [['Amount', r.a, r.H.Amount], ['Interest', r.i, r.H.Interest], ['Total', r.t, r.H.Total]]) {
            if (v == null) throw new Error(`${label}: no ${k} value cell in row for ${amt}; cells=${JSON.stringify(r.texts)}`);
            if (Math.abs(v - h) > 1.5) throw new Error(`${label}: ${k} right edge value ${v.toFixed(1)} vs header ${h.toFixed(1)} (row ${amt}, delta ${(v - h).toFixed(1)}); cells=${JSON.stringify(r.texts)}`);
          }
        }
      };
      try {
        await check('default zoom');
        await ev(`document.body.style.zoom='1.25'; true`); await settle();
        await check('zoom 1.25');
      } finally { await ev(`document.body.style.zoom=''; true`); await settle(); }
    });

    await run('p. print logs history: identical re-print is a duplicate (no new record); changed data adds one', async () => {
      await reseed();
      await stubPrint();
      await ev(`__q('print-btn').click(); true`); await settle();
      const lp = await ev(`__txt('last-printed')`);
      const today = await ev(TODAY);
      if (!lp || !lp.includes(today)) throw new Error(`last-printed "${lp}" does not contain today ${today}`);
      await openHistory();
      const n = await histRows();
      if (n !== 1) throw new Error('history-row count after one print: ' + n);
      const t = await ev(`document.querySelector('[data-testid="history-row"]').textContent.replace(/\\s+/g, ' ')`);
      if (!t.includes('Sample Person')) throw new Error('history row lacks "Sample Person": ' + t);
      if (!/1,55,579\.38|155579\.38/.test(t)) throw new Error('history row lacks 1,55,579.38: ' + t);
      await ev(`__q('history-back').click(); true`); await settle();
      if (await histVisible()) throw new Error('history-view still visible after history-back');
      await ev(`__q('print-btn').click(); window.dispatchEvent(new Event('beforeprint')); true`);
      await sleep(600);
      const lp2 = await ev(`__txt('last-printed')`);
      if (!lp2 || !/Already in history/i.test(lp2)) throw new Error(`last-printed after duplicate print: "${lp2}", expected "Already in history"`);
      await openHistory();
      const n2 = await histRows();
      if (n2 !== 1) throw new Error(`history-row count after duplicate print: ${n2}, expected 1`);
      await ev(`__q('history-back').click(); true`); await settle();
      await addLoan('02-03-2024', 5000, 'loan');
      await ev(`__q('print-btn').click(); true`); await sleep(600);
      await openHistory();
      const n3 = await histRows();
      if (n3 !== 2) throw new Error(`history-row count after print with changed data: ${n3}, expected 2`);
    });

    await run('q. history CSV: header + 2 data lines, plain 155579.38, dd-mm-yyyy date', async () => {
      const has = await ev(`typeof window.__historyCSV === 'function'`);
      if (!has) throw new Error('window.__historyCSV is not a function');
      if (!(await ev(`!!__q('history-export')`))) throw new Error('history-export button missing');
      const csv = await ev(`String(window.__historyCSV())`);
      const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length !== 3) throw new Error(`CSV has ${lines.length} non-empty lines (expected header + 2): ` + JSON.stringify(csv));
      if (/\d{5,}\.\d\d/.test(lines[0]) || /\d{2}-\d{2}-\d{4}/.test(lines[0])) throw new Error('first CSV line does not look like a header: ' + lines[0]);
      if (!csv.includes('155579.38')) throw new Error('CSV lacks plain 155579.38: ' + JSON.stringify(csv));
      if (/1,55,579|155,579/.test(csv)) throw new Error('CSV contains thousands-separated amount: ' + JSON.stringify(csv));
      const today = await ev(TODAY);
      if (!csv.includes(today)) throw new Error(`CSV lacks today's date ${today}: ` + JSON.stringify(csv));
    });

    await run('r. history search and delete: filter, delete one, persists, back to main', async () => {
      if (!(await histVisible())) await openHistory();
      await ev(`__set(__q('history-search'), 'zzz-no-such-name')`); await settle();
      let n = await histRows();
      if (n !== 0) throw new Error('rows with non-matching search: ' + n);
      await ev(`__set(__q('history-search'), '')`); await settle();
      n = await histRows();
      if (n !== 2) throw new Error('rows after clearing search: ' + n);
      await ev(`__q('history-delete', document.querySelector('[data-testid="history-row"]')).click(); true`); await settle();
      if (!(await ev(`!!__q('confirm-yes')`))) throw new Error('confirm-yes not shown after history-delete');
      await ev(`__q('confirm-yes').click(); true`); await settle();
      n = await histRows();
      if (n !== 1) throw new Error('rows after delete: ' + n);
      await load(); await inject(); await settle();
      if (!(await histVisible())) await openHistory();
      n = await histRows();
      if (n !== 1) throw new Error('rows after reload (persistence): ' + n);
      await ev(`__q('history-back').click(); true`); await settle();
      if (await histVisible()) throw new Error('history-view still visible after history-back');
      if (!(await ev(visible('person-name')))) throw new Error('main view (person-name) not visible after history-back');
    });

    await run('s. start fresh: modal cancel/Esc keep data, confirm wipes everything, no re-seed after reload', async () => {
      await reseed();
      await addLoan('02-03-2024', 5000, 'loan');
      await stubPrint();
      await ev(`__q('print-btn').click(); true`); await settle();
      if (!(await ev(`!!__q('last-printed')`))) throw new Error('setup: last-printed missing after print');
      const rowsBefore = await ev(`__rows().length`);
      if (rowsBefore < 1) throw new Error('setup: no loan-row');
      const fresh = () => ev(visible('fresh-modal'));
      const openFresh = async () => {
        await ev(`__q('menu-more').click(); true`); await settle();
        await ev(`__q('start-fresh').click(); true`); await settle();
        if (!(await fresh())) throw new Error('fresh-modal not visible after start-fresh');
      };
      await openFresh();
      if (!(await ev(`!!__q('fresh-backup')`))) throw new Error('fresh-backup missing in modal');
      await ev(`__q('fresh-cancel').click(); true`); await settle();
      if (await ev(`!!__q('fresh-modal')`)) throw new Error('fresh-modal still present after fresh-cancel');
      if ((await ev(`__rows().length`)) !== rowsBefore) throw new Error('rows changed after fresh-cancel');
      if (!(await ev(`!!__q('last-printed')`))) throw new Error('last-printed lost after fresh-cancel');
      await openFresh();
      await S('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await S('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await settle();
      if (await ev(`!!__q('fresh-modal')`)) throw new Error('fresh-modal still present after Escape');
      if ((await ev(`__rows().length`)) !== rowsBefore) throw new Error('rows changed after Escape');
      await openFresh();
      await ev(`__q('fresh-confirm').click(); true`); await settle();
      const checkEmpty = async (label) => {
        if (await ev(`!!__q('fresh-modal')`)) throw new Error(label + ': fresh-modal still present');
        const n = await ev(`__rows().length`);
        if (n !== 0) throw new Error(`${label}: ${n} loan-row(s) remain`);
        const nm = await ev(`__q('person-name').value`);
        if (nm !== '') throw new Error(`${label}: person-name is "${nm}"`);
        const due = await ev(`__txt('amount-due')`);
        if (!/^0(\.0+)?$/.test((due || '').replace(/[^\d.]/g, ''))) throw new Error(`${label}: amount-due "${due}" is not 0`);
        if (await ev(`!!__q('last-printed')`)) throw new Error(label + ': last-printed present');
        await openHistory();
        const h = await histRows();
        if (h !== 0) throw new Error(`${label}: ${h} history-row(s)`);
        await ev(`__q('history-back').click(); true`); await settle();
      };
      const focused = await ev(`document.activeElement && document.activeElement.getAttribute('data-testid')`);
      if (focused !== 'person-name') throw new Error('focus after reset is on ' + focused + ', expected person-name');
      await checkEmpty('after confirm');
      await load(); await inject(); await settle();
      await checkEmpty('after reload');
      const names = await ev(`localStorage.getItem('interestCalculator.v2')`);
      if (/Sample Person/.test(names || '')) throw new Error('sample person re-seeded in storage');
    });

    await run('t. print principal list: order, notes only (blank otherwise), repayment sign, future note, interest matches screen', async () => {
      await reseed();
      await ev(`__q('menu-more').click(); true`); await settle();
      await ev(`__q('start-fresh').click(); true`); await settle();
      await ev(`__q('fresh-confirm').click(); true`); await settle();
      await ev(`__set(__q('calc-date'), '13-11-2026'); true`); await settle();
      await addLoan('02-03-2024', 700, 'loan');
      await addLoan('01-09-2025', 7000, 'loan', 'Shop advance');
      await addLoan('01-06-2026', 2000, 'repayment');
      await addLoan('15-12-2026', 5000, 'loan');
      const screenInterest = num(await ev(`__txt('total-interest')`));
      await setPrint(true);
      try {
        await settle();
        if (!(await ev(visible('print-principal-list')))) throw new Error('print-principal-list not visible');
        const rows = await ev(`Array.from(document.querySelectorAll('[data-testid="print-principal-row"]')).map(r => r.textContent.replace(/\\s+/g, ' ').trim())`);
        if (rows.length !== 4) throw new Error('rows: ' + rows.length + ' ' + JSON.stringify(rows));
        const dates = ['02-03-2024', '01-09-2025', '01-06-2026', '15-12-2026'];
        const byDate = (d) => { const r = rows.find((x) => x.includes(d)); if (!r) throw new Error(`no row contains ${d}: ${JSON.stringify(rows)}`); return r; };
        dates.forEach(byDate);
        if (!byDate('01-09-2025').includes('Shop advance')) throw new Error('row missing note: ' + byDate('01-09-2025'));
        const rep = byDate('01-06-2026');
        if (!/2,000\.00/.test(rep) || /[\u2212]|(^|\s)-\d/.test(rep)) throw new Error('repayment row should be positive 2,000.00 with no minus: ' + rep);
        if (!byDate('15-12-2026').includes('after calculation date')) throw new Error('future row lacks note: ' + byDate('15-12-2026'));
        // v12.2: Particulars prints only the user's note; no auto "Loan given"/"Repayment received"
        if (rows.some((x) => /Loan given|Repayment received/.test(x))) throw new Error('auto type label printed in Particulars: ' + JSON.stringify(rows));
        if (byDate('02-03-2024').replace(/\s+/g, '') !== '02-03-2024700.00') throw new Error('row without note should have blank Particulars: ' + byDate('02-03-2024'));
        expectNum('print-interest vs screen', num(await ev(`__txt('print-interest')`)), screenInterest);
      } finally { await setPrint(false); }
    });

    await run('u. new name starts a new person: prompt, start new, same person, suppression, blur keeps prompt (v10)', async () => {
      await reseed();
      const focusName = () => ev(`(() => { const e = __q('person-name'); e.focus(); if (!document.hasFocus()) e.dispatchEvent(new FocusEvent('focus')); return true; })()`);
      const blurName = () => ev(`(() => { const e = __q('person-name'); e.blur(); if (!document.hasFocus()) e.dispatchEvent(new FocusEvent('blur')); return true; })()`);
      const typeName = async (v) => { await ev(`(() => { const e = __q('person-name'); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); await settle(); };
      const prompt = () => ev(`!!__q('name-change-prompt')`);
      const nameVal = () => ev(`__q('person-name').value`);
      const stored = async () => {
        const raw = await ev(`localStorage.getItem('interestCalculator.v2')`);
        const st = JSON.parse(raw);
        const people = Array.isArray(st.people) ? st.people : Object.values(st.people || {});
        return { st, people };
      };
      const entriesOf = (p) => (p.entries || p.loans || p.rows || []);

      // 1
      if ((await nameVal()) !== 'Sample Person (example)') throw new Error('setup: name is ' + (await nameVal()));
      await focusName();
      await typeName('R'); await typeName('Ramesh');
      if (!(await prompt())) throw new Error('name-change-prompt did not appear');
      const pt = await ev(`__txt('name-change-prompt')`);
      if (!pt.includes('Sample Person (example)') || !/\b2\b/.test(pt)) throw new Error('prompt text lacks old name or count 2: ' + pt);
      // 2
      await ev(`__q('name-change-new').click(); true`); await settle();
      if (await prompt()) throw new Error('prompt still present after Start new person');
      if ((await nameVal()) !== 'Ramesh') throw new Error('name after start-new: ' + (await nameVal()));
      const nr = await ev(`__rows().length`);
      if (nr !== 0) throw new Error('loan-rows after start-new: ' + nr);
      expectNum('amount-due after start-new', num(await ev(`__txt('amount-due')`)), 0);
      let s = await stored();
      if (s.people.length !== 2) throw new Error('stored people: ' + s.people.length + ' ' + JSON.stringify(Object.keys(s.st)));
      const old = s.people.find((p) => p.name === 'Sample Person (example)');
      if (!old) throw new Error('old person not kept: ' + JSON.stringify(s.people.map((p) => p.name)));
      if (entriesOf(old).length !== 2) throw new Error('old person entries: ' + entriesOf(old).length + ' keys=' + Object.keys(old));
      // 3
      await blurName(); await focusName();
      await typeName('Ramesh Kumar');
      if (await prompt()) throw new Error('prompt appeared for a person with no entries');
      // 4
      await addLoan('02-03-2024', 5000, 'loan');
      await blurName(); await focusName();
      await typeName('Ramesh K');
      if (!(await prompt())) throw new Error('prompt did not appear for person with 1 entry');
      await ev(`__q('name-change-same').click(); true`); await settle();
      if (await prompt()) throw new Error('prompt still present after Same person');
      if ((await ev(`__rows().length`)) !== 1) throw new Error('rows after Same person: ' + (await ev(`__rows().length`)));
      if ((await nameVal()) !== 'Ramesh K') throw new Error('name after Same person: ' + (await nameVal()));
      await focusName();
      await typeName('Ramesh Ko');
      if (await prompt()) throw new Error('prompt reappeared without blur/refocus');
      await blurName(); await focusName();
      await typeName('Ramesh Kum');
      if (!(await prompt())) throw new Error('prompt did not reappear after blur+refocus');
      await blurName(); await settle();
      if (!(await prompt())) throw new Error('prompt hidden after blur (v10: must stay)');
      s = await stored();
      const cur0 = s.people.find((p) => p.id === s.st.currentId) || {};
      if (cur0.name === 'Ramesh Kum') throw new Error('pending rename was stored on blur: ' + cur0.name);
      // 5
      await load(); await inject(); await settle();
      s = await stored();
      if (s.people.length !== 2) throw new Error('people after reload: ' + s.people.length);
      if ((await nameVal()) === 'Ramesh Kum') throw new Error('pending name survived reload');
      if ((await ev(`__rows().length`)) !== 1) throw new Error('rows after reload: ' + (await ev(`__rows().length`)));
      if (s.people.some((p) => p.name === 'Ramesh Kum')) throw new Error('Ramesh Kum stored');
    });

    await run('v. duplicate rule and Clear all history', async () => {
      await reseed();
      await ev(`__q('menu-more').click(); true`); await settle();
      await ev(`__q('start-fresh').click(); true`); await settle();
      await ev(`__q('fresh-confirm').click(); true`); await settle();
      await stubPrint();
      await ev(`__set(__q('person-name'), 'Asha'); true`);
      await ev(`__set(__q('calc-date'), '01-11-2026'); true`); await settle();
      await addLoan('01-01-2026', 10000, 'loan');
      const count = async () => { await openHistory(); const n = await histRows(); await ev(`__q('history-back').click(); true`); await settle(); return n; };
      const doPrint = async () => { await ev(`__q('print-btn').click(); true`); await sleep(600); };
      await doPrint();
      let n = await count(); if (n !== 1) throw new Error('step 1: expected 1 record, got ' + n);
      await doPrint();
      n = await count(); if (n !== 1) throw new Error('step 2: expected 1 record, got ' + n);
      await ev(`__q('print-include-breakdown').click(); true`); await settle();
      if (!(await ev(`__q('print-include-breakdown').checked`))) throw new Error('step 3: checkbox not ticked');
      await doPrint();
      n = await count(); if (n !== 1) throw new Error('step 3 (breakdown ticked): expected 1 record, got ' + n);
      await ev(`__set(__q('calc-date'), '02-11-2026'); true`); await settle();
      await doPrint();
      n = await count(); if (n !== 2) throw new Error('step 4 (calc date 02-11-2026): expected 2 records, got ' + n);
      await ev(`__set(__q('calc-date'), '01-11-2026'); true`); await settle();
      await doPrint();
      n = await count(); if (n !== 2) throw new Error('step 5 (back to 01-11-2026, matches record 1): expected 2 records, got ' + n);
      // step 6: Clear all history
      await openHistory();
      if (!(await ev(visible('history-clear')))) throw new Error('history-clear not visible with records');
      await ev(`__q('history-clear').click(); true`); await settle();
      if (!(await ev(`!!__q('history-clear-confirm') && !!__q('history-clear-cancel')`))) throw new Error('confirm/cancel buttons not shown after history-clear');
      await ev(`__q('history-clear-cancel').click(); true`); await settle();
      if (await ev(`!!__q('history-clear-confirm')`)) throw new Error('confirm still shown after cancel');
      n = await histRows(); if (n !== 2) throw new Error('after cancel: expected 2 rows, got ' + n);
      await ev(`__q('history-clear').click(); true`); await settle();
      if (!(await ev(`!!__q('history-clear-confirm')`))) throw new Error('confirm not shown on second open');
      await pressEsc();
      if (await ev(`!!__q('history-clear-confirm')`)) throw new Error('confirm still shown after Escape');
      if (!(await histVisible())) throw new Error('Escape closed the whole history view');
      n = await histRows(); if (n !== 2) throw new Error('after Escape: expected 2 rows, got ' + n);
      await ev(`__q('history-clear').click(); true`); await settle();
      await ev(`__q('history-clear-confirm').click(); true`); await settle();
      n = await histRows(); if (n !== 0) throw new Error('after confirm: expected 0 rows, got ' + n);
      const txt = await ev(`__q('history-view').innerText`);
      if (!/Nothing printed yet/i.test(txt)) throw new Error('empty state missing: ' + JSON.stringify(txt));
      if (await ev(visible('history-clear'))) throw new Error('history-clear still visible with no records');
      await ev(`__q('history-back').click(); true`); await settle();
      if (await ev(`!!__q('last-printed')`)) throw new Error('last-printed still present after clearing');
      const lr = await ev(`__rows().length`);
      if (lr !== 1) throw new Error('loan-rows after clear: ' + lr + ', expected 1');
    });

    await run('w. v10: ignoring the prompt cannot rename; Esc/Undo revert; Same person; duplicate guards; people list', async () => {
      await reseed();
      const focusName = () => ev(`(() => { const e = __q('person-name'); e.focus(); if (!document.hasFocus()) e.dispatchEvent(new FocusEvent('focus')); return true; })()`);
      const typeName = async (v) => {
        await ev(`(() => { const e = __q('person-name'); e.value = ${JSON.stringify(v.slice(0, -1))}; e.dispatchEvent(new Event('input', { bubbles: true })); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        await settle();
      };
      const prompt = () => ev(`!!__q('name-change-prompt')`);
      const nameVal = () => ev(`__q('person-name').value`);
      const stored = async () => {
        const st = JSON.parse(await ev(`localStorage.getItem('interestCalculator.v2')`));
        const people = Array.isArray(st.people) ? st.people : Object.values(st.people || {});
        return { st, people, cur: people.find((p) => p.id === st.currentId) };
      };
      const nEnt = (p) => ((p && (p.entries || p.loans || p.rows)) || []).length;
      const click = async (id) => { await ev(`(() => { const e = __q(${JSON.stringify(id)}); if (!e) throw new Error('missing ${id}'); e.click(); return true; })()`); await settle(); };
      const SAMPLE = 'Sample Person (example)';
      // 1
      await focusName(); await typeName('Ravi Shankar');
      if (!(await prompt())) throw new Error('prompt did not appear');
      await ev(`__q('loan-date').focus(); __q('person-name').dispatchEvent(new FocusEvent('blur')); true`); await settle();
      if (!(await prompt())) throw new Error('prompt gone after moving focus away');
      let s = await stored();
      if (s.cur.name !== SAMPLE) throw new Error('stored name changed while pending: ' + s.cur.name);
      const shown = await ev(`document.title + ' | ' + Array.from(document.querySelectorAll('[data-testid="result-column"],[data-testid="result-name"],[data-testid="amount-due-label"]')).map(e=>e.textContent).join(' ')`);
      if (/Ravi Shankar/.test(shown)) throw new Error('pending name leaked into title/result: ' + shown);
      if (!(await ev(`!!__q('loan-date').closest('[inert]')`))) throw new Error('loan-date is not inert while prompt open');
      // 2 Esc
      await focusName();
      await pressEsc();
      if (await prompt()) throw new Error('prompt still present after Esc');
      if ((await nameVal()) !== SAMPLE) throw new Error('field after Esc: ' + (await nameVal()));
      s = await stored();
      if (s.cur.name !== SAMPLE) throw new Error('stored after Esc: ' + s.cur.name);
      if (await ev(`!!__q('loan-date').closest('[inert]')`)) throw new Error('page still inert after Esc');
      // 3 Undo
      await focusName(); await typeName('Ravi Shankar');
      if (!(await prompt())) throw new Error('prompt did not reappear');
      await click('name-change-undo');
      if (await prompt()) throw new Error('prompt present after Undo');
      if ((await nameVal()) !== SAMPLE) throw new Error('field after Undo: ' + (await nameVal()));
      s = await stored();
      if (s.cur.name !== SAMPLE) throw new Error('stored after Undo: ' + s.cur.name);
      // 4 Same person
      await focusName(); await typeName('Ravi Shankar');
      await click('name-change-same');
      s = await stored();
      if (s.cur.name !== 'Ravi Shankar' || nEnt(s.cur) !== 2) throw new Error('after Same person: ' + s.cur.name + ' entries=' + nEnt(s.cur));
      // 5 duplicate guard on New person
      const before = s.people.length;
      await click('new-person');
      await focusName(); await typeName('ravi shankar ');
      if (!(await ev(`!!__q('dup-hint')`))) throw new Error('dup-hint not shown');
      const ht = await ev(`__txt('dup-hint')`);
      if (!/Ravi Shankar/.test(ht)) throw new Error('dup-hint text: ' + ht);
      await click('dup-hint-open');
      s = await stored();
      if (s.cur.name !== 'Ravi Shankar' || nEnt(s.cur) !== 2) throw new Error('after dup-hint-open: ' + s.cur.name + ' entries=' + nEnt(s.cur));
      if (s.people.length !== before) throw new Error(`people ${before} -> ${s.people.length} (blank left behind?)`);
      if (await ev(`!!__q('dup-hint')`)) throw new Error('dup-hint still shown');
      // 6 duplicate check from name change
      await click('new-person');
      await ev(`__set(__q('person-name'), 'Asha'); true`); await settle();
      await addLoan('01-01-2026', 10000, 'loan');
      s = await stored();
      if (s.cur.name !== 'Asha' || nEnt(s.cur) !== 1) throw new Error('Asha setup: ' + s.cur.name + ' ' + nEnt(s.cur));
      const ashaId = s.cur.id;
      const checkAsha = async (label) => {
        const t = await stored();
        const a = t.people.find((p) => p.id === ashaId);
        if (!a || a.name !== 'Asha' || nEnt(a) !== 1) throw new Error(label + ': Asha changed: ' + JSON.stringify(a && [a.name, nEnt(a)]));
        return t;
      };
      await focusName(); await typeName('Ravi Shankar');
      if (!(await prompt())) throw new Error('prompt missing on Asha');
      await click('name-change-new');
      if (!(await ev(`!!__q('dup-open') && !!__q('dup-create')`))) throw new Error('duplicate variant (dup-open/dup-create) not shown');
      await click('dup-open');
      s = await checkAsha('after dup-open');
      if (s.cur.name !== 'Ravi Shankar' || nEnt(s.cur) !== 2) throw new Error('current after dup-open: ' + s.cur.name + ' ' + nEnt(s.cur));
      if (s.people.length !== before + 1) throw new Error('people after dup-open: ' + s.people.length);
      // back to Asha via the People picker
      await ev(`__q('people-btn').click(); true`); await settle();
      if (!(await ev(visible('people-view')))) throw new Error('people-view not visible after people-btn');
      const picked = await ev(`(() => { const it = Array.from(document.querySelectorAll('[data-testid="people-item"]')).find(e => /Asha/.test(e.textContent)); if (!it) return false; it.click(); return true; })()`);
      if (!picked) throw new Error('Asha not in people list');
      await settle();
      if ((await nameVal()) !== 'Asha') throw new Error('did not switch to Asha: ' + (await nameVal()));
      await focusName(); await typeName('Ravi Shankar');
      await click('name-change-new');
      await click('dup-create');
      s = await checkAsha('after dup-create');
      const pcs = s.people.filter((p) => p.name === 'Ravi Shankar');
      if (pcs.length !== 2) throw new Error('expected two Ravi Shankar, got ' + pcs.length);
      // 7 people list details
      await ev(`__q('people-btn').click(); true`); await settle();
      if (!(await ev(visible('people-view')))) throw new Error('people-view not visible (step 7)');
      const items = await ev(`Array.from(document.querySelectorAll('[data-testid="people-item"]')).map(e => e.textContent.replace(/\\s+/g,' ').trim())`);
      if (items.length < 3) throw new Error('people-items: ' + JSON.stringify(items));
      items.forEach((t) => { if (!/\d[\d,]*\.\d{2}/.test(t)) throw new Error('people-item lacks amount columns: ' + t); });
      await ev(`__q('people-back').click(); true`); await settle();
      if (await ev(visible('people-view'))) throw new Error('people-view still visible after people-back');
    });

    await run('x. People page at scale: 121 people, total, search, sort, open, delete, back, exclusive with History, speed (v11)', async () => {
      const KEY = 'interestCalculator.v2';
      const st = JSON.parse(await ev(`localStorage.getItem('${KEY}')`));
      const tmpl = Array.isArray(st.people) ? st.people[0] : Object.values(st.people)[0];
      const pad = (n) => String(n).padStart(3, '0');
      const mk = (i, name, phone, entries) => Object.assign({}, tmpl, { id: 'xp' + i, name, phone: phone || '', calcDate: '2026-11-01', entries });
      const people = [];
      for (let i = 1; i <= 120; i++) {
        const n = 1 + (i % 3), es = [];
        for (let k = 0; k < n; k++) es.push({ date: '2026-0' + (1 + k) + '-' + String(5 + (i % 20)).padStart(2, '0'), type: 'loan', amount: 1000 * (1 + ((i * 7 + k * 13) % 50)), note: '' });
        people.push(mk(i, 'Person ' + pad(i), '', es));
      }
      people.push(mk(999, 'Zed Kumar', '99999', [{ date: '2026-01-01', type: 'loan', amount: 50000, note: '' }]));
      const ns = Object.assign({}, st, { people, currentId: people[0].id, history: [] });
      await ev(`localStorage.setItem('${KEY}', ${JSON.stringify(JSON.stringify(ns))}); true`);
      await load(); await inject(); await settle();
      const click = async (id) => { await ev(`(() => { const e = __q(${JSON.stringify(id)}); if (!e) throw new Error('missing ${id}'); e.click(); return true; })()`); await settle(); };
      const count = () => ev(`document.querySelectorAll('[data-testid="people-item"]').length`);
      const pv = () => ev(visible('people-view'));
      const dues = () => ev(`Array.from(document.querySelectorAll('[data-testid="people-due"]')).map(e => e.textContent)`).then((a) => a.map(num));
      const search = async (v) => { await ev(`(() => { const e = __q('people-search'); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); await sleep(250); };
      const must = (c, m) => { if (!c) throw new Error(m); };

      // timing: click to first render, measured in-page
      const ms = await ev(`(() => { const t0 = performance.now(); __q('people-btn').click(); const n = document.querySelectorAll('[data-testid="people-item"]').length; return { ms: performance.now() - t0, n }; })()`);
      await settle();
      must(ms.ms <= 1500, 'opening People took ' + Math.round(ms.ms) + 'ms');
      must(await pv(), 'people-view not visible');
      must((await count()) === 121, 'people-item count ' + (await count()));
      const title = await ev(`__q('people-view').innerText`);
      must(/121/.test(title), 'title lacks 121: ' + title.slice(0, 120));

      const all = await dues();
      const sum = all.reduce((a, b) => a + b, 0);
      const tot = num(await ev(`__txt('people-total-due')`));
      must(all.length === 121 && Math.abs(sum - tot) <= 0.05, `total due ${tot} vs sum ${sum} (${all.length} dues)`);

      await search('zed'); must((await count()) === 1, 'zed -> ' + (await count()));
      await search('99999'); must((await count()) === 1, '99999 -> ' + (await count()));
      await search('nobody'); must((await count()) === 0, 'nobody -> ' + (await count()));
      must(/No one matches/.test(await ev(`__q('people-view').innerText`)), 'missing "No one matches"');
      await search(''); must((await count()) === 121, 'cleared -> ' + (await count()));

      await ev(`__set(__q('people-sort'), 'due', true); true`); await settle();
      const d2 = await dues();
      must(d2[0] === Math.max.apply(null, d2) && d2[0] === Math.max.apply(null, all), 'due sort: first=' + d2[0] + ' max=' + Math.max.apply(null, all));
      await ev(`__set(__q('people-sort'), 'name', true); true`); await settle();
      const first = await ev(`document.querySelector('[data-testid="people-item"]').textContent`);
      must(/Person 001/.test(first), 'name sort first: ' + first.trim().slice(0, 40));

      await ev(`(() => { const it = Array.from(document.querySelectorAll('[data-testid="people-item"]')).find(e => /Zed Kumar/.test(e.textContent)); it.click(); return true; })()`); await settle();
      must(!(await pv()), 'people-view still visible after opening Zed');
      must((await ev(`__q('person-name').value`)) === 'Zed Kumar', 'person-name ' + (await ev(`__q('person-name').value`)));
      must((await ev(`__rows().length`)) === 1, 'loan-row count ' + (await ev(`__rows().length`)));

      await click('people-btn'); must(await pv(), 'People did not reopen');
      const delP5 = () => ev(`(() => { const it = Array.from(document.querySelectorAll('[data-testid="people-item"]')).find(e => /Person 005/.test(e.textContent)); if (!it) return false; __q('people-delete', it).click(); return true; })()`);
      must(await delP5(), 'Person 005 row missing'); await settle();
      await click('confirm-no');
      must((await count()) === 121, 'after confirm-no: ' + (await count()));
      must(await delP5(), 'Person 005 row missing (2)'); await settle();
      await click('confirm-yes');
      must((await count()) === 120, 'after confirm-yes: ' + (await count()));
      must(!(await ev(`Array.from(document.querySelectorAll('[data-testid="people-item"]')).some(e => /Person 005/.test(e.textContent))`)), 'Person 005 still listed');
      must(await pv(), 'Delete navigated away from People');

      await click('people-back'); must(!(await pv()), 'people-back did not leave People');

      await openHistory(); must(await histVisible(), 'history did not open');
      await click('people-btn');
      must(await pv(), 'people-view hidden with History open');
      must(!(await histVisible()), 'history-view still visible with People open');
      await click('people-back');
    });

    await run('y. Debit/Credit sections, no minus signs (v12)', async () => {
      const must = (c, m) => { if (!c) throw new Error(m); };
      await reseed();
      await ev(`__q('menu-more').click(); true`); await settle();
      await ev(`__q('start-fresh').click(); true`); await settle();
      await ev(`__q('fresh-confirm').click(); true`); await settle();
      await stubPrint();
      await ev(`__set(__q('person-name'), 'Debit Credit Tester'); true`);
      await ev(`__set(__q('calc-date'), '01-11-2026'); true`); await settle();
      must(await ev(`!__q('loan-amount') && !__q('loan-type')`), 'loan-amount / loan-type still exist');
      must(await ev(`!!__q('loan-debit') && !!__q('loan-credit')`), 'loan-debit / loan-credit missing');
      // typing in one clears the other
      await ev(`(() => { const e = __q('loan-debit'); e.focus(); e.value = '500'; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); await settle();
      await ev(`(() => { const e = __q('loan-credit'); e.focus(); e.value = '300'; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); await settle();
      let f = await formState();
      must(f.debit === '' && f.credit === '300', 'typing credit should clear debit: ' + JSON.stringify(f));
      await ev(`(() => { const e = __q('loan-debit'); e.focus(); e.value = '700'; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`); await settle();
      f = await formState();
      must(f.credit === '' && f.debit === '700', 'typing debit should clear credit: ' + JSON.stringify(f));
      // both empty -> error, no new row
      await ev(`__set(__q('loan-debit'), ''); __set(__q('loan-credit'), ''); true`);
      await ev(`__set(__q('loan-date'), '10-02-2026'); true`);
      const n0 = await ev(`__rows().length`);
      await ev(`__q('add-loan').click(); true`); await settle();
      must((await ev(`__rows().length`)) === n0, 'row added with both amounts empty');
      must(await ev(`!!document.querySelector('[data-testid="form-error"]') && /Debit or Credit/i.test(document.querySelector('[data-testid="form-error"]').textContent)`), 'no "Debit or Credit" error shown');
      await ev(`__set(__q('loan-date'), ''); true`);
      await addLoan('10-02-2026', 70000, 'loan');
      await addLoan('10-02-2026', 70000, 'loan');
      await addLoan('01-06-2026', 20000, 'repayment');
      const cnt = (g) => ev(`(() => { const g = __q(${JSON.stringify(g)}); return g ? Array.from(g.querySelectorAll('[data-testid="loan-row"]')).length : -1; })()`);
      must((await cnt('loan-group-debit')) === 2, 'loan-group-debit rows: ' + (await cnt('loan-group-debit')));
      must((await cnt('loan-group-credit')) === 1, 'loan-group-credit rows: ' + (await cnt('loan-group-credit')));
      const sub = (id) => ev(`(() => { const r = __q(${JSON.stringify(id)}); const a = r && __q('subtotal-amount', r); return a ? a.textContent.trim() : null; })()`);
      must((await sub('loan-subtotal-debit')) === '1,40,000.00', 'debit subtotal: ' + (await sub('loan-subtotal-debit')));
      must((await sub('loan-subtotal-credit')) === '20,000.00', 'credit subtotal: ' + (await sub('loan-subtotal-credit')));
      for (const id of ['result-group-debit', 'result-group-credit', 'result-subtotal-debit', 'result-subtotal-credit'])
        must(await ev(`!!__q(${JSON.stringify(id)})`), id + ' missing');
      const t = await readTotals();
      expectNum('total-principal (net)', t.principal, 120000);
      const NOMINUS = /−|(^|\s)-\d/;
      const checkNoMinus = async (label) => {
        for (const sel of ['#loans', '#rTable', '#printArea']) {
          const tx = await ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
          must(!NOMINUS.test(tx), `${label}: minus sign in ${sel}: ` + (tx.match(/.{0,20}(−|(^|\s)-\d).{0,20}/) || [''])[0]);
        }
      };
      await checkNoMinus('screen');
      const printIds = ['print-group-debit', 'print-group-credit', 'print-subtotal-debit', 'print-subtotal-credit'];
      await setPrint(true);
      try {
        await settle();
        for (const id of printIds) must(await ev(`!!__q(${JSON.stringify(id)})`), 'default print: ' + id + ' missing');
        await checkNoMinus('print default');
        await ev(`__q('print-include-breakdown').click(); true`); await settle();
        must(await ev(`__q('print-include-breakdown').checked`), 'breakdown checkbox not ticked');
        for (const id of printIds) must(await ev(`!!__q(${JSON.stringify(id)})`), 'breakdown print: ' + id + ' missing');
        await checkNoMinus('print breakdown');
        await ev(`__q('print-include-breakdown').click(); true`); await settle();
      } finally { await setPrint(false); }
      // edit the repayment -> loan-credit holds it, debit empty; then cancel
      await editRowMatching('/20,?000/');
      f = await formState();
      must(f.credit === '20000' && f.debit === '', 'edit repayment form: ' + JSON.stringify(f));
      await ev(`__q('loan-cancel').click(); true`); await settle();
      await assertFormCleared('after cancel edit (y)');
      must((await ev(`__rows().length`)) === 3, 'row count after cancel');
    });

    // i. JS errors and native dialogs
    await run('i. no JS errors / console errors / native dialogs', async () => {
      const probs = jsErrors.concat(nativeDialogs.map((d) => 'native dialog: ' + d));
      if (probs.length) throw new Error(probs.join(' | '));
    });
  } catch (e) {
    console.log('FAIL  harness: ' + (e && e.stack || e));
    results.push(['harness', false]);
  } finally {
    try { cdp && cdp.ws.close(); } catch (_) {}
    try { chrome.proc.kill('SIGKILL'); } catch (_) {}
    try { server.close(); } catch (_) {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  }
  const failed = results.filter((r) => !r[1]).length;
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FAIL  fatal: ' + (e && e.stack || e)); process.exit(1); });
