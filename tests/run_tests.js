#!/usr/bin/env node
// Checks the calc engine embedded in app/InterestCalculator.html against tests/golden.json.
// Usage: node tests/run_tests.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOL = 1e-6;
const htmlPath = path.join(__dirname, '..', 'app', 'InterestCalculator.html');
const goldenPath = path.join(__dirname, 'golden.json');

if (!fs.existsSync(htmlPath)) {
  console.error('ERROR: ' + htmlPath + ' does not exist yet. Build the app first, then re-run.');
  process.exit(2);
}
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script\s+id=["']calc-engine["'][^>]*>([\s\S]*?)<\/script>/i);
if (!m) {
  console.error('ERROR: no <script id="calc-engine"> block found in the HTML file.');
  process.exit(2);
}
const sandbox = { module: { exports: {} } };
sandbox.exports = sandbox.module.exports;
vm.createContext(sandbox);
try {
  vm.runInContext(m[1], sandbox, { filename: 'calc-engine' });
} catch (e) {
  console.error('ERROR: calc-engine script threw: ' + e.message);
  process.exit(2);
}
const { computeRow, computeAll } = sandbox.module.exports || {};
if (typeof computeRow !== 'function' || typeof computeAll !== 'function') {
  console.error('ERROR: module.exports must provide computeRow and computeAll.');
  process.exit(2);
}

const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
const near = (a, b) => typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= TOL;

function checkCase(c) {
  const errs = [];
  const chk = (label, actual, expected, numeric) => {
    const ok = numeric ? near(actual, expected) : actual === expected;
    if (!ok) errs.push(label + ': expected ' + expected + ', got ' + actual);
  };
  let all;
  try {
    all = computeAll(c.txns, c.settings);
  } catch (e) {
    return ['computeAll threw: ' + e.message];
  }
  const ex = c.expected;
  if (!all || !Array.isArray(all.rows) || all.rows.length !== ex.rows.length) {
    return ['rows length: expected ' + ex.rows.length + ', got ' + (all && all.rows ? all.rows.length : 'none')];
  }
  ex.rows.forEach((er, i) => {
    const r = all.rows[i];
    chk('row' + i + '.status', r.status, er.status, false);
    chk('row' + i + '.interest', r.interest, er.interest, true);
    chk('row' + i + '.amt', r.amt, er.amt, true);
    if (er.status === 'ok' || er.status === 'future') chk('row' + i + '.T', r.T, er.T, true);
    // T = 0 (same day as calc date): interest is 0 regardless of V/W, so V/W are not compared
    if ((er.status === 'ok' || er.status === 'future') && er.T !== 0) {
      chk('row' + i + '.V', r.V, er.V, true);
      chk('row' + i + '.W', r.W, er.W, true);
    }
    // computeRow on its own must agree with computeAll
    try {
      const solo = computeRow(c.txns[i], c.settings);
      if (solo.status !== er.status || !near(solo.interest, er.interest))
        errs.push('computeRow row' + i + ': expected ' + er.status + '/' + er.interest +
          ', got ' + solo.status + '/' + solo.interest);
    } catch (e) {
      errs.push('computeRow row' + i + ' threw: ' + e.message);
    }
  });
  ['principal', 'interest', 'balance'].forEach(k => chk(k, all[k], ex[k], true));
  ['principalSide', 'interestSide', 'balanceSide'].forEach(k => chk(k, all[k], ex[k], false));
  return errs;
}

let failed = 0;
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log(pad('CASE', 36) + pad('RESULT', 8) + 'DETAIL');
console.log('-'.repeat(80));
for (const c of golden) {
  const errs = checkCase(c);
  if (errs.length) failed++;
  console.log(pad(c.name, 36) + pad(errs.length ? 'FAIL' : 'pass', 8) + (errs.length ? errs[0] : ''));
  errs.slice(1).forEach(e => console.log(pad('', 44) + e));
}
console.log('-'.repeat(80));
console.log((golden.length - failed) + '/' + golden.length + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
