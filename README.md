# Interest Calculator

An offline interest calculator for money lent to people. It is a single HTML file with no install, no internet connection and no server. You record each loan and repayment for a person, and it shows the compound interest and the amount due, and prints a clean statement. It replaces an Excel workbook and reproduces that workbook's calculation exactly, apart from a few deliberate fixes listed below.

## Quick start (for the end user)

1. Download `app/InterestCalculator.html`.
2. Put it somewhere permanent, such as the Desktop or Documents.
3. Double-click it. It opens in Google Chrome or Microsoft Edge.

Two things to remember:

- **Always use the same browser and keep the file in the same place.** The data is stored inside that browser on that computer. Opening the file in a different browser, or from a different folder, shows an empty app.
- **Save a backup regularly.** Open **More** and choose **Backup all data**. This downloads a backup file you can keep on a USB drive or in email. **More → Restore from backup** brings everything back.

## Features

**People, interest terms and loans**
- One screen with three numbered sections: Person (name, phone, notes), Interest terms (calculate-up-to date, rate per month, compounding period) and Loans.
- Loans use one entry form (Date, Amount, Type, Note, Add) above a compact one-line list. Each line has Edit and Delete. Edit loads the entry into the form and the button becomes Update. Delete asks for confirmation in the page. Invalid dates or amounts show an inline message.
- Entries are listed oldest first.

**Repayments**
- Type is either "Loan given" or "Repayment received". Repayments are shown in green with a minus sign and reduce the principal.

**Live result**
- A result column stays visible beside the form and updates as you type. It shows each loan's months, interest and total, then Total principal, Total interest and "Amount due from <name>" in plain words (or "payable to" when the balance goes the other way).

**Calendar and number formats**
- A large in-app calendar (360px wide, big day cells, month and year selectors, Today and Clear). It closes when you pick a day.
- Dates can also be typed as dd-mm-yyyy.
- Amounts use Indian digit grouping, for example 1,55,579.38.

**Print statement**
- The default printout is a short summary: name, "Interest calculated up to", the period in months since the first loan, a principal list (date, particulars, amount, one line per entry), then Total principal, one Total interest line, the Amount due and "Printed on". It shows no rate and no per-loan interest.
- An optional "Include loan-wise breakdown" checkbox replaces the principal list with a full table (date, type, principal, months, interest, total). The box is not saved and resets to unticked.

**Print history**
- Every print is logged. The History page has search by name, delete per record, "Clear all history" (with confirmation) and "Download as Excel (CSV)". The CSV has plain numbers and dd-mm-yyyy dates, and opens correctly in Excel.
- A print that matches an existing record (same person, calculation date, principal, interest and amount due) is not logged again. The line under the Print button reads "Already in history (printed on ...)". Otherwise it shows "Last printed".

**People page**
- A full page that scales to hundreds of people: live search by name or phone, sort (Name A-Z, Amount due highest first, Recently added), and a summary line with the number of people and the total principal, interest and amount due across everyone.
- The table shows loans, principal, interest, amount due, calculation date and last printed date for each person. Click a row to open that person. Each row has Delete with an in-page confirmation, and deleting never touches print history.

**Name-change prompt and duplicate guard**
- If you type a different name over a person who already has loans, the app asks whether this is a new person or the same person with a corrected name. The change is not saved until you decide; Undo or Esc reverts it.
- Choosing a new person keeps the previous person unchanged. If a person with that name already exists, the app offers to open them instead of creating a duplicate.

**Backup, restore, Start fresh, no native dialogs**
- Backup and restore include the print history.
- **More → Start fresh (delete everything)** wipes all people, loans and history after a confirmation that offers to save a backup first.
- No native browser dialogs are used anywhere (`alert`, `confirm`, `prompt`). Every confirmation is inside the page, because browsers can silently block native ones.

## How interest is calculated

Settings: calculation date, rate per month in % (default 1.25), compounding period `R` in months (default 6) and an "Approx/Allowance" tolerance in months (default 0).

For each entry, `amt` is the repayment received minus the loan given (so a loan is negative and a repayment is positive).

1. **Months elapsed**, using a 30-day month:

   `T = (Y2 - Y1) * 12 + (M2 - M1) + (D2 - D1) / 30`

   where date 1 is the entry date and date 2 is the calculation date.

2. **Whole compounding periods**:

   `V = trunc(T / R)` if `MOD(T, R) > Approx`, otherwise `trunc(T / R) - 1`

3. **Leftover months**: `W = T - V * R`

4. **Interest**:

   `interest = amt * (1 + roi * R / 100)^V * (1 + roi * W / 100) - amt`

   with `roi` the monthly rate in percent.

The rate compounds once per full period of `R` months, and the leftover `W` months earn simple interest on top. Totals are the sum of `amt` (principal) and the sum of the interest. The amount due is principal plus interest, shown as an absolute value with "due from" or "payable to".

**Worked example.** Two loans of ₹70,000 each, both dated 10-02-2026, calculated up to 01-11-2026, rate 1.25% per month, period 6 months, Approx 0:

- `T = (2026 - 2026) * 12 + (11 - 2) + (1 - 10) / 30 = 9 - 0.3 = 8.7` months
- `MOD(8.7, 6) = 2.7`, which is greater than 0, so `V = trunc(8.7 / 6) = 1`
- `W = 8.7 - 1 * 6 = 2.7`
- Growth factor = `(1 + 1.25 * 6 / 100)^1 * (1 + 1.25 * 2.7 / 100)` = `1.075 * 1.03375` = `1.11128125`
- Each loan: `70,000 * 1.11128125 = 77,789.6875`, so interest is 7,789.6875
- Two loans: interest ₹15,579.38, principal ₹1,40,000, **amount due ₹1,55,579.38** (exactly 15,579.375 and 1,55,579.375 before rounding for display)

**Deliberate fixes against the original Excel**

- An entry dated after the calculation date gets 0 interest (the original produced negative interest). It still counts in the principal.
- A row with an amount but no date is excluded from the totals and flagged (the original treated it as the year 1900 and charged about 1,500 months of interest).

## Printing

Print uses the normal browser print dialog, so it works with any installed printer, or choose **Save as PDF** as the destination.

Tip: in the print dialog, open **More settings** and untick **Headers and footers**. This removes the browser's own date, page title and file path from the page edges, leaving a clean statement.

## Data and privacy

- All data (people, loans, print history) is stored in the browser's `localStorage` on that computer, under the key `interestCalculator.v2`.
- Nothing is sent anywhere. The app makes no network requests and uses no external scripts or fonts.
- Clearing the browser's site data or cookies for the file will erase the app's data, so keep backups.
- The backup file is a plain JSON file containing everything (people, loans, settings and print history). Anyone who has it can read it, so store it as carefully as the data itself. Restoring it on the same or another computer, in any browser, recreates everything.

## Project structure

```
.
├── app/
│   └── InterestCalculator.html   The product: one self-contained offline file
├── docs/
│   └── SPEC.md                   Full spec as a version history (v1 to v11), with test hooks
├── tests/
│   ├── reference.py              Independent Python implementation of the calculation
│   ├── golden.json               30 expected results generated by reference.py
│   ├── run_tests.js              Checks the app's calc engine against golden.json
│   └── ui_smoke.js               End-to-end headless Chrome test (no npm dependencies)
├── excel/
│   └── build_fixed.py            Builds a corrected copy of the original Excel workbook
└── CLAUDE.md                     Project notes and working rules for AI-assisted development
```

The corrected Excel workbook itself is not included in this repository because it contains private data. `excel/build_fixed.py` regenerates it from the original workbook.

## Development and tests

The app has no build step. Edit `app/InterestCalculator.html` directly. The calculation lives in the `<script id="calc-engine">` block (`computeRow`, `computeAll`), which the tests load.

```
node tests/run_tests.js        # 30 calculation cases checked against the Python reference
node tests/ui_smoke.js         # end-to-end UI test in headless Chrome
python3 tests/reference.py     # regenerates tests/golden.json
```

- `run_tests.js` compares the app's calc engine with the independent Python reference across 30 cases and should report 30/30.
- `ui_smoke.js` drives headless Chrome over the DevTools protocol with no npm dependencies. It needs Node 22 or newer and Google Chrome installed, and should finish with ALL PASSED.

To preview in a browser, serve the folder over HTTP (some tooling treats `file://` pages as static snapshots):

```
python3 -m http.server 8765 --directory app
```

Then open `http://localhost:8765/InterestCalculator.html`.

## Version history

- **v1:** First version, replicating the Excel `Inputs` and `Print Format` sheets.
- **v2:** Redesign to a quiet, banking-style single screen with a live result column.
- **v3:** One loan entry form plus a compact list with Edit and Delete, in-page confirms (no native dialogs) and numbered sections.
- **v4:** Large custom calendar, and a short summary as the default print with an optional loan-wise breakdown.
- **v5:** Fixed loan list column alignment, and added print history with search, delete and CSV export.
- **v6:** "Start fresh (delete everything)" in the More menu.
- **v7:** The default print lists each principal amount, with one total interest line.
- **v8:** Typing a different name offers to start a new person.
- **v9:** No duplicate history entries, and "Clear all history".
- **v10:** Name changes must be decided before they are saved, plus a duplicate-name guard and a clearer People list.
- **v11:** People becomes its own page with search, sort, a totals summary and delete.
