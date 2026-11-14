# Interest Package

Interest calculator for a non-technical, elderly user (the owner's father) on a **Windows PC**. It replaces
the original Excel at `~/Downloads/Intrest_package.xlsx` (sheets `Inputs`, `Print Format`). Never modify that original.

## Status (2026-11-13)
v11 has been delivered and is waiting on the father's first real-use feedback. Expect UX tweaks next, not a rewrite.

## Files
- `app/InterestCalculator.html`: **the product.** One self-contained offline file (vanilla HTML/CSS/JS, no CDN).
  The father double-clicks it, and it opens in Chrome or Edge. The data lives in that browser's localStorage under
  `interestCalculator.v2`.
- `docs/SPEC.md`: the full spec, written as a version history (v1 → v11) with the `data-testid` contracts. Append a new
  "vN changes" section for every round of changes rather than rewriting older ones.
- `tests/reference.py` + `tests/golden.json` + `tests/run_tests.js`: 30 calc cases checked against the HTML's calc engine.
- `tests/ui_smoke.js`: headless Chrome over raw CDP (no npm), scenarios a–x. `WAIT_FOR_REBUILD=1` is an opt-in wait.
- `excel/Intrest_package_fixed.xlsx` (+ `build_fixed.py`): a corrected copy of the original Excel. Its audit fixes:
  - the phantom ₹9,00,000 row in Print Format A9/D9, the #REF! in B82 and the wrong reference in B79;
  - the Interest Amount line landing mid-list when Inputs has a gap;
  - negative interest for future dates;
  - interest computed for rows with no date.
- `.claude/launch.json`: `app` serves `app/` on port 8765 for the browser pane. The pane opens file:// URLs as
  static snapshots and silently returns false from native `confirm()`, so preview over http.

## Calculation rules (must match the Excel exactly)
- **Settings:** calc date, ROI per month (%, default 1.25), compounding period in months (default 6),
  and an "Approx/Allowance" tolerance in months (default 0).
- **Entries:** Loan given = debit, Repayment received = credit. `amt = credit − debit`.
- **Months:** `T = (Y2−Y1)*12 + (M2−M1) + (D2−D1)/30` (30-day month convention).
- **Compounding:**
  - `V = trunc(T/R)` if `MOD(T,R) > Approx`, else `trunc(T/R) − 1`.
  - `W = T − V*R`.
  - Interest = `amt*(1+roi*R/100)^V*(1+roi*W/100) − amt`.
- **Fixes vs the Excel:**
  - A future-dated entry gets 0 interest but still counts in principal.
  - A row with an amount but no date is excluded from totals.
- **Reference:** two ₹70,000 loans on 10-02-2026, calc date 01-11-2026, give interest 15,579.375 and amount due 1,55,579.375.
- The `<script id="calc-engine">` block (`computeRow`, `computeAll`) is what the tests load. Keep it pure, and keep it
  byte-identical unless the calculation itself is meant to change.

## Current app behaviour (v11)
- **Layout:** one screen with sections 1 Person, 2 Interest terms and 3 Loans, plus a sticky result column on wide screens.
- **Loans:** one entry form (Date, Amount, Type, Note, Add/Update) above a compact one-line list with Edit/Delete.
- **Result column:** a per-loan breakdown plus Total principal, Total interest, and "Amount due from <name>" (plain words, no Dr/Cr).
- **Dates:** a custom in-app calendar (large, closes on pick). Dates can also be typed as dd-mm-yyyy.
- **Print (v7):** the default printout shows: name, "interest calculated up to", and the period in months since the first loan.
  - Then a principal list (Date | Particulars | Amount per entry, with no per-entry interest).
  - Then Total principal, ONE Total interest figure, the amount due and "Printed on".
  - It never prints the rate.
  - Ticking "Include loan-wise breakdown" (not saved) replaces the principal list with the full per-loan table.
- **Print history:** every Print click or Ctrl+P is logged, EXCEPT a duplicate (v9). A duplicate has the same person (id, or name ignoring case), the same calc date, and the same principal, interest and amount due to the paisa. Duplicates are skipped and "Last printed" reads "Already in history (printed on …)". The History view also has "Clear all history" (with an in-page confirm). The History view has search, delete and "Download as Excel (CSV)",
  and "Last printed" shows under the Print button.
- **Name changes (v10):** typing a different name over a person WITH loans is pending and never saved silently. An inline prompt ([Start new person] / [Same person, just correcting the name] / [Undo], Esc = Undo) stays open, and the rest of the page is inert until a choice is made. Start new person keeps the old person unchanged. Duplicate names are guarded: "X is already saved" offers [Open X] / [Create another X], and a blank new person typed with an existing name gets an "Open them" hint. A person with no loans renames live. 
- **People page (v11):** a full view (like History, with ← Back; `showView` shows exactly one of main, history or people). It has search by name or phone, sort (Name A–Z / Amount due / Recently added) and "+ New person". A summary line totals principal, interest and due across ALL people. The table shows Name/phone, Loans, Principal, Interest, Amount due, Up to and Last printed; clicking a row opens that person, and Delete uses an inline confirm (history untouched). Tested with 120 people (opens in about 13ms).
- **More menu:** Backup, Restore, Delete this person, and "Start fresh (delete everything)".
- **No native dialogs anywhere.** All confirms are in-page.

## Owner preferences
- A premium, quiet, simple look, like a banking or invoicing app. Never slide-like big tiles, coloured banners or chunky UI.
- Readable for an elderly user (17px base, clear labels), but not oversized.
- Keep it simple: no servers, databases or installs. CSV is an acceptable export format.

## Working rules
- **Always use multiple subagents.** The main session (Opus) does the planning: it writes the spec delta in `docs/SPEC.md`,
  including the testids. It then fans out to 2–3 parallel Sonnet subagents with non-overlapping files, typically one for
  the app and one for `tests/ui_smoke.js`. The main session then verifies everything itself.
- **Before calling a change done:**
  - run `node tests/run_tests.js` (must print 30/30) and `node tests/ui_smoke.js` (must print ALL PASSED);
  - click through the change in the browser pane at 1366px wide;
  - afterwards, clear the pane's localStorage.
- Python work uses the project venv at `.venv/`, because system Python is externally managed.
