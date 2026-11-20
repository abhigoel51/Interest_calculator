# Interest Calculator: build spec

## Deliverables
1. `app/InterestCalculator.html`: a single self-contained offline file (no CDN, no internet, no build step).
   It opens in Chrome or Edge on Windows by double-clicking.
2. `excel/Intrest_package_fixed.xlsx`: a corrected copy of the original workbook. The original at
   `~/Downloads/Intrest_package.xlsx` must NOT be modified.
3. `tests/`: a reference calculation, golden cases and a node test runner for the HTML calc engine.

## Calculation (identical to the Excel `Inputs` sheet)
Settings: `calcDate` (Excel D3), `roi` = % per month (E3, default 1.25), `comp` = compounding period in months
(F3, default 6), `approx` = tolerance in months (G3, default 0).

For each transaction `{date, particulars, debit, credit}`:
- `amt = credit - debit`
- `T = (calcY - y)*12 + (calcM - m) + (calcD - d)/30`
- `mod = T - comp*Math.floor(T/comp)` (Excel MOD semantics)
- `U = mod > approx ? 1 : 0`
- `V = U ? Math.trunc(T/comp) : Math.trunc(T/comp) - 1` (Excel ROUNDDOWN truncates toward zero)
- `W = T - V*comp`
- `interest = amt * (1 + roi*comp/100)**V * (1 + roi*W/100) - amt`

Totals: `principal = Σ amt`, `interest = Σ interest`, `balance = principal + interest`.
Each total is labelled `Dr` if < 0, otherwise `Cr`, and shown as an absolute value.

Fixes to the original behaviour (apply in both the app and the fixed Excel):
- If a transaction's date is AFTER calcDate (T < 0), its interest is 0 and the row is flagged
  "date after calculation date". In the original Excel such rows produced NEGATIVE interest.
- A row with an amount but no date is flagged as an error and left out of the totals.
  In the original Excel it was treated as 1900-01-00 and got ~1,500 months of interest.
- T = 0 gives interest 0 (already true in the original).

Reference check: calcDate 2026-11-01, roi 1.25, comp 6, approx 0, two debits of 70,000 dated 2026-02-10
→ principal 1,40,000 Dr, interest 15,579.375 Dr (7,789.6875 each), balance 1,55,579.375 Dr.

## Calc engine interface (HTML app)
Inside the HTML, put the pure calc code in `<script id="calc-engine">` with no DOM access, ending with
`if (typeof module !== 'undefined') module.exports = { computeRow, computeAll };`
- `computeRow(txn, settings)` → `{ amt, T, V, W, interest, status }`, where status is `"ok" | "future" | "nodate" | "empty"`.
  Dates are ISO strings `"YYYY-MM-DD"`; parse the parts by hand (no `new Date()` timezone bugs).
- `computeAll(txns, settings)` → `{ rows: [...per-row results...], principal, interest, balance,
  principalSide, interestSide, balanceSide }`, where each side is `"Dr" | "Cr"`.
Tests load this script block with node's `vm` module (find it with a regex on the HTML file).

## App UI requirements (v2: replaces v1, which the owner rejected as "looks like a presentation")

### The real use case
A person comes to the lender. The lender has given this person one or more loans on different dates and in
different amounts (e.g. ₹50,000 in Jan 2025, ₹30,000 in Jul 2025). Sometimes the person has repaid part of it.
The lender needs to see, as of a chosen date: for EACH loan, its principal, interest and total; and the grand
total of principal, interest and amount due. The lender then prints it and hands it over.

### Flow (one screen, three numbered sections, top to bottom)
1. **Person**: name (required) and optional phone/notes. A slim top bar has a "People" picker (searchable list
   of saved people) and "+ New person".
2. **Interest terms**: "Calculate up to" date (defaults to today), "Interest per month (%)" (default 1.25),
   "Add interest to principal every … months" (default 6). These are plain editable fields, saved per person.
   New people start with the last-used rate and period. "Allowance (months)" (approx, default 0) is hidden under a
   small "More options" disclosure.
3. **Loans**: a list of entries, each with: Date, Amount, Type (Loan given | Repayment received; Loan by default),
   and an optional Note. "+ Add loan" adds a row and focuses its date. Delete is a small quiet icon/link with confirm.
   Map to the engine: Loan given → debit, Repayment received → credit.

### Result (the most important part, always visible)
- On wide screens (≥1100px) the result sits in a sticky right column; on narrow screens it goes below.
- **Breakdown table, one row per entry:** Date | Type | Principal | Months (T, 1 decimal) | Interest | Total
  (principal + interest).
  - Repayments are shown as negatives, in green, with the interest they earn back.
  - Future-dated, missing-date or invalid rows show a short inline note instead of numbers.
- **Totals block:** Total principal, Total interest, **Amount due** (the largest, most prominent number).
  - Use plain words instead of Dr/Cr: "Amount due from <name>" when the balance is Dr.
  - When the balance is Cr, say "Amount payable to <name>".
- **Actions:** a "Print statement" button.

### Visual direction: premium, quiet, simple (think a well-made banking or invoicing app, NOT slides)
- Off-white page (#f7f7f5 or similar) and white surfaces separated by 1px hairline borders (#e6e4df), with at most a very subtle shadow.
  - NO big coloured header bar, NO giant stat tiles or coloured blocks, NO gradients, NO emoji.
- One restrained accent colour (deep ink green or ink blue), used only for primary buttons and focus rings.
  - Text is near-black (#1c1c1a), and secondary text is a warm grey.
- Typography: a system font stack (`-apple-system, "Segoe UI", system-ui, …`).
  - Base 17px, body line-height 1.5, section headings 15px semibold small-caps/uppercase-tracked labels.
  - Use `font-variant-numeric: tabular-nums` for all money, right-aligned.
  - The Amount due figure is about 32px semibold. Nothing else is above 20px.
- Inputs: 44px tall, 8px radius, hairline border, clear focus ring. Labels sit above the fields.
  - Generous whitespace, max content width about 1280px, aligned to an 8px grid.
- Buttons: one primary (filled accent) per area, the rest secondary (outline or ghost). Moderate size, not huge.
- Must remain easy for an elderly user: clear labels, nothing hidden that's needed day to day, good contrast (WCAG AA).

### Kept from v1
- Dates typed as dd-mm-yyyy (also accept / and .), with a small calendar picker as an optional helper.
- Indian number format (en-IN), auto-save to localStorage, "Backup" and "Restore" (tucked into a small menu in the
  top bar, not prominent buttons).
- Seed one sample person on first run with the reference data.
- Print: A4 portrait statement with a header (person name, calculation date, rate and period), the breakdown table
  and the totals, plus "Printed on <date>". Black on white, hairline rules, no app chrome.
- No external resources, no frameworks. Vanilla HTML/CSS/JS in one file.
- The calc-engine `<script id="calc-engine">` block and its interface stay exactly as specified above.
  `node tests/run_tests.js` must keep passing.

### Test hooks (v2): required `data-testid` attributes for UI tests
`person-name`, `calc-date`, `roi`, `comp`, `add-loan`, `loan-row` (each entry row), and inside each row:
`loan-date`, `loan-amount`, `loan-type` (a `<select>` with values `loan` / `repayment`), `loan-delete`.
In the result area: `result-row` (each breakdown row), `total-principal`, `total-interest`, `amount-due`
(their textContent is the formatted number, e.g. "1,55,579.38"), and `print-btn`.
Inputs commit on the `input` event (no blur needed) and recalculate immediately.

## v3 changes (owner feedback on v2: "much better design", plus these)
1. **Loans section = one entry form + a compact list.**
   - **Entry form:** a single row at the top of the section with Date, Amount, Type (Loan given / Repayment received), an optional Note, and one primary button "Add".
   - **List:** each added entry appears below the form as ONE compact line: date · type · note (muted) · amount · interest · total. It also has small "Edit" and "Delete" ghost actions on the right.
   - **Line styling:** repayments in green with a minus sign. Future, invalid or missing-date entries show a short muted/amber note in place of interest.
   - **Edit:** loads that entry into the form. The button becomes "Update", with a "Cancel" link next to it, and the line being edited is subtly highlighted. Update saves it back in place.
   - **Validation:** "Add" or "Update" with an invalid or missing date or amount shows an inline message under the field and adds nothing.
   - **After Add:** the form clears and focus returns to Date. Pressing Enter in any form field = Add/Update.
   - **Order:** entries are listed sorted by date (oldest first).
   - **Result column:** the right-hand breakdown and totals stay as in v2.
2. **No native dialogs anywhere.** Remove every `confirm()`, `alert()` and `prompt()`; some browsers block them silently, which broke Delete.
   - **Inline confirm:** clicking Delete turns that line's actions into "Delete this entry?  [Yes, delete] [No]".
   - **Same for deleting a person and restoring a backup:** use the same inline or small in-page dialog (a modal div), not a native dialog.
3. **Section number badges** (1 Person, 2 Interest terms, 3 Loans): filled circles in the accent colour with white numbers, so the sections stand out. Keep everything else quiet.

### Test hooks (v3: replaces the loan-related v2 hooks; all other v2 hooks stay)
- **Entry form:** `loan-date`, `loan-amount`, `loan-type` (select: `loan` / `repayment`), `loan-note`, and `add-loan` (the Add/Update button; its text is "Add" or "Update"). `loan-cancel` is the cancel-edit link.
- **List:** `loan-row` (each line), with `loan-edit` and `loan-delete` inside it. The inline confirm buttons are `confirm-yes` and `confirm-no`.
- **Person deletion and restore confirms** use `confirm-yes` / `confirm-no` too.
- **Form errors:** `form-error` on an inline error message.

## v4 changes (owner feedback on v3)
1. **Custom, larger date picker.** This replaces the native `<input type=date>` and `showPicker()` completely.
   The native one was too small, and it re-opened after picking because the hidden input sat inside the calendar button.
   - **Where:** the calendar icon next to EVERY date field (Calculate up to, loan entry Date) opens an in-page popover anchored under the field.
   - **Size:** about 360px wide, day cells at least 44×44px, 17px numbers, high contrast, and the same quiet visual language as the app (white surface, hairline border, soft shadow, accent fill for the selected day, ring for today).
   - **Header:** ‹ and › month arrows, plus Month and Year `<select>`s so going back years is quick (year range 2000 to current+5). Below the grid: "Today" and "Clear" text buttons.
   - **Picking a day:** fills the text field as dd-mm-yyyy, fires its `input` event so the app updates, then CLOSES the popover and returns focus to the field.
   - **Other ways to close:** Esc, a click outside, or the icon again. Only one popover is open at a time.
   - **Opening month:** the field's current date, otherwise today.
   - **Typing:** dates can still be typed directly as before.
2. **Print = short summary by default.** The printed statement shows only:
   - The title "Interest Statement" and the person's name (and phone/notes if filled).
   - "Interest calculated up to <dd-mm-yyyy>".
   - "Period: <N> months". N is the T value (1 decimal; drop ".0") of the EARLIEST dated, non-future entry, i.e. months since the first loan.
   - Total principal, Total interest, and the prominent "Amount due from <name>" (or "Amount payable to <name>").
   - "Printed on <dd-mm-yyyy>" in small text at the bottom.
   - It does NOT print the interest rate, the compounding period or the per-loan breakdown.
   - **Breakdown checkbox:** an "Include loan-wise breakdown" checkbox sits next to the Print statement button, unticked by default and NOT saved (it resets to unticked on reload). When ticked, the print also includes the per-loan table (Date, Type, Principal, Months, Interest, Total) ABOVE the totals.
   - **Screen:** the on-screen result column is unchanged; it still shows the breakdown.

### Test hooks (v4, in addition to v3)
- **Calendar:** `cal-btn` (each calendar icon button; the first is for Calculate-up-to, the second for the loan Date), `cal-popover` (present in the DOM ONLY while open), and `cal-day` (each day button, with a `data-date="YYYY-MM-DD"` attribute). Also `cal-month` (select, values 0–11), `cal-year` (select), `cal-today` and `cal-clear`.
- **Print:** `print-include-breakdown` (the checkbox). The printable container is `print-area`, containing `print-name`, `print-calcdate`, `print-months`, `print-principal`, `print-interest`, `print-due` and `print-breakdown` (the table, present only when the checkbox is ticked).

## v5 changes (owner feedback on v4)
1. **Bug: Loans list columns misaligned.** `.lhead` and each `.lrow` are separate grids with an `auto` last column. The header's empty last cell makes its tracks differ from the rows, so "Amount" sits over the interest values.
   - **Fix:** the header and every row must use IDENTICAL fixed tracks, with no `auto`/content-sized tracks; alternatively, convert the list to a real `<table>`.
   - **Must align:** for amounts up to 99,99,999.00, at 1366px and 1920px widths, and at 125% browser zoom (the owner's screenshot looks zoomed). Numbers stay right-aligned under right-aligned headers.
   - **If space is tight:** make the result column narrower (e.g. 520px) and/or make Edit/Delete compact. Never truncate numbers.
2. **Print history (saved log of every statement given out).**
   - **What is recorded:** clicking "Print statement" appends one record to a history log saved in localStorage, alongside the people data.
     - Fields: `printedAt` (date and time), `name`, `phone`, `calcDate`, `periodMonths`, `principal`, `interest`, `amountDue` (absolute values), `side` ("due from" or "payable to"), `breakdownIncluded` (yes/no) and `entries` (number of loans/repayments).
     - It is recorded on the click, not on the OS print dialog's outcome; the browser can't tell if the user cancelled.
     - Ctrl+P (`beforeprint` without a click) also records. Deduplicate so a single print never creates two records (e.g. ignore a beforeprint within 3s of a click).
   - **History screen:** a "History" button in the top bar opens a full-width panel or view replacing the main layout. Same quiet design, with a "← Back" link.
     - It shows a table, newest first: Printed on (dd-mm-yyyy hh:mm), Name, Interest up to, Period, Principal, Interest, Amount due, Breakdown.
     - A search box filters by name.
     - An inline-confirm delete per record (no native dialogs).
     - A primary "Download as Excel (CSV)" button. The CSV is UTF-8 with BOM so Excel opens it correctly, has plain numbers (no commas or ₹) and dd-mm-yyyy dates, and is named `print-history-YYYY-MM-DD.csv`.
     - Empty state: "Nothing printed yet."
   - **In the result column:** a small muted line under the Print button: "Last printed: 13-11-2026" for the current person (matched by person id; fall back to the name), or nothing if never printed.
   - **Backup and restore:** both include the history. Old backups without history restore fine, with empty history.

### Test hooks (v5)
- **Top bar and history view:** `history-btn` (top bar), `history-view` (the history screen container), `history-back`, `history-search` and `history-row` (each record row).
- **Inside each history row:** `history-delete`, using the existing `confirm-yes`/`confirm-no` for the inline confirm.
- **Export and last printed:** `history-export` (the CSV button) and `last-printed` (the line in the result column).
- **Test-only export hook:** expose `window.__historyCSV()`, which returns the CSV string the export button would download.

## v6: Start fresh (delete everything)
- **Menu item:** "More" gets a last item, "Start fresh (delete everything)", styled in a muted red and separated from the other items by a divider.
- **Confirmation:** it opens an in-page modal (no native dialogs) titled "Delete everything?". The body says: "This removes all people, all loan entries and the print history from this computer. It cannot be undone."
  - "Save backup first" (secondary): runs the existing backup download and keeps the modal open.
  - "Yes, delete everything" (danger, filled red).
  - "Cancel" (ghost). Esc also cancels.
- **After deleting:** all data and history are gone. The app does NOT re-seed the sample person, now or after reload; store an `initialized` flag in the saved state so the seed only happens on a truly first run.
  - It shows one blank new person (empty name, today's date, default rate 1.25 and period 6), and focus goes to the Name field.
  - History is empty and "Last printed" is absent.

### Test hooks (v6)
`menu-more` (the More button), `start-fresh` (the menu item), `fresh-modal`, `fresh-backup`, `fresh-confirm` and `fresh-cancel`.

## v7: default print lists each principal amount (owner feedback)
- **Default print** (breakdown box unticked) keeps everything from v4/v5 (name, phone/notes, "Interest calculated up to", Period, totals, amount due, Printed on). Between the Period line and the totals it adds a simple **principal list**:
  - Columns: **Date | Particulars | Amount**. Particulars = "Loan given" or "Repayment received", followed by the note in muted text if one is set.
  - One line per entry, sorted by date (oldest first).
  - Repayments show as a negative amount, e.g. "−20,000.00".
  - Future-dated entries are listed with a small muted note "(after calculation date)".
  - Entries without a valid date are NOT listed, matching the totals, which exclude them.
  - **No per-entry interest, months or totals** in this list. The interest appears only as the single "Total interest" line below it.
  - Then the totals block as before: Total principal, Total interest and Amount due.
- **Ticked box:** the full per-loan breakdown table (Date, Type, Principal, Months, Interest, Total) REPLACES the principal list. It doesn't add a second table.
- The on-screen result column is unchanged.

### Test hooks (v7)
`print-principal-list` (the simple list container, present only when the box is unticked) and `print-principal-row` (each line in it).

## v8: typing a different name starts a new person (owner feedback)
**Problem:** the owner's natural flow is to finish with one person, then type a NEW name over the Name field. Today that just
renames the current person and keeps all their loans, so the old entries stay on screen under the new name.

**Behaviour:**
- **When the prompt appears:** the user changes the Name field of a person who already has at least one entry.
  - The original name is the value when the field got focus, and it must be non-empty.
  - On the first keystroke that makes the value differ from that name, an inline prompt appears directly under the Name field.
  - Use the app's quiet style: a hairline-bordered note with an accent left border. No modal, no native dialog.
- **Prompt text:** "Is this a new person? <original name>'s 3 loans are still on screen."
  - The text uses the actual name and count.
  - Buttons: **[Start new person]** (primary) and **[Same person, just correcting the name]** (secondary/ghost).
- **Start new person:**
  - The previous person is KEPT, with their original name restored, unchanged, in the People list.
  - A new person is created with the typed name, today's calc date and the same rate/period as the current defaults.
  - The new person has no entries and becomes the current person.
  - The screen shows a clean form, focus stays at the end of the Name field, and a short muted toast/line reads
    "<original name> was saved. Find them anytime under People."
- **Same person:** keeps the rename (as today) and hides the prompt. Don't ask again until the field is blurred and refocused.
- **If the user ignores the prompt** and keeps typing or leaves the field, the rename stands (current behaviour). The prompt hides on blur.
- **No prompt when:** the person has no entries (it's a plain rename, e.g. fixing a typo before adding loans), or the original name was empty.
- **Print history:** history records keep the name they were printed under, so this never alters history.
- **"+ New person" button:** unchanged. It still creates a blank person directly.

### Test hooks (v8)
`name-change-prompt` (present in the DOM only while shown), `name-change-new` and `name-change-same`.

## v9: no duplicate history entries + "Clear all history" (owner feedback)
1. **Duplicate rule.** When a print would be recorded (a Print statement click, or `beforeprint` from Ctrl+P), first look for an
   EXISTING history record that matches on all of the following:
   - **Name:** same person id when both have one, otherwise the same name (trimmed, case-insensitive).
   - **Calc date:** the same "interest calculated up to" date.
   - **Amounts:** the same principal, interest and amount due, rounded to 2 decimals.
   - If a match is found, do NOT add a record. The existing record stays exactly as it is.
   - On screen, the "Last printed" line under the Print button reads "Already in history (printed on dd-mm-yyyy)" for the matching record.
   - **What doesn't matter:** time apart is irrelevant (matching values = duplicate even days later), and so is the breakdown checkbox.
   - **Anything different = new record.** A different date, any change in loans that alters principal or interest, or a different name all count.
   - The existing 3-second click/beforeprint dedupe can stay, but this rule subsumes it.
2. **"Clear all history":** a secondary/danger-styled text button in the History view header, next to the export button.
   - It is shown only when there are records.
   - It opens an in-page confirm: "Delete all N print records? People and loans are not affected. This cannot be undone." with buttons [Yes, clear history] and [Cancel]. Esc also cancels. No native dialog.
   - After clearing, the view shows "Nothing printed yet." and the "Last printed" line disappears.
   - People and loans are untouched.

### Test hooks (v9)
`history-clear` (the button), `history-clear-confirm` and `history-clear-cancel`.

## v10: name changes must be decided, and no duplicate people (bug found by owner)
**Bug:** the owner ended up with "Person B" twice under People and "Person A" only in History.
- **Cause 1:** in v8 the Name field renames the current person LIVE on every keystroke, and the prompt hides on blur.
  So typing "Person B" over "Person A" and then clicking anywhere else (e.g. the loan Date field) silently renamed Person A's
  record, with Person A's loans, to Person B.
- **Cause 2:** later, "+ New person" or "Start new person" with the same name created a second "Person B".
- History is not affected; it correctly keeps the name each statement was printed under.

**Fix 1: a name change on a person WITH entries is never committed silently.**
- **Pending text:** from the first differing keystroke, the typed text is pending and NOT saved to the person.
  - The stored name stays the original.
  - The result column, print area, People list and page title keep showing the original name.
- **The prompt stays until answered.** It no longer hides on blur. While it's open, the rest of the page is inert: put `inert` on the other cards and the top bar, and lower their opacity slightly. The Name field and the prompt stay active. That way the user can't add loans or print in an ambiguous state.
- **Three ways out:**
  1. **[Start new person]:** as in v8, the old person is kept unchanged and a new blank person gets the typed name. See also Fix 2.
  2. **[Same person, just correcting the name]:** commits the typed name to the current person.
  3. **[Undo]** (ghost) or **Esc** in the Name field: reverts the field to the original name, discards the pending text and closes the prompt.
- **If the field is emptied:** while the prompt is open, emptying the field is allowed (no special handling); the choice still applies to whatever is typed.
- **Reload or close while pending:** the pending text is simply lost and the original name remains.
- **People with NO entries:** the name still saves live with no prompt, as today.

**Fix 2: a duplicate-name guard.**
- **On "Start new person":** if another person already has that name (trimmed, case-insensitive), the prompt changes to:
  "<Name> is already saved (N loans). [Open <Name>] [Create another <Name>]".
  - **Open** reverts the current person's name, switches to the existing person and closes the prompt.
  - **Create another** proceeds as Start new person.
- **On a person with no entries:** if the live name exactly matches ANOTHER person (case-insensitive, trimmed, non-empty), show a non-blocking muted hint under the field: "Another person named <Name> is already saved. [Open them]".
  - Open switches to that person.
  - If the current blank person has no entries and no phone, delete the blank one so no empty duplicate is left behind.

**Fix 3: the People list shows enough to tell people apart.**
- Each item shows the name plus muted details: "N loans · ₹<amount due> · up to dd-mm-yyyy".
- Blank-name people show "Unnamed person".

### Test hooks (v10)
- **Name-change prompt:** `name-change-undo` (the Undo button), plus `name-change-prompt`, `name-change-new` and `name-change-same` as before.
- **Duplicate guard:** `dup-open` and `dup-create` (the duplicate guard buttons in the prompt), `dup-hint` (the non-blocking hint) and `dup-hint-open`.
- **People list:** `people-item` (each item in the People list).

## v11: People becomes its own page (owner feedback: must scale to 100+ people)
The People dropdown popover is replaced by a full **People page**, a view swap like History, with the same "← Back" pattern.
- **Opening it:** the top-bar "People" button opens it. Opening People closes History and vice versa. Back returns to the main calculator view.
- **Header:** "← Back", the title "PEOPLE (N)", a search box (by name or phone, filtering live), a Sort select, and a primary "+ New person" button.
  - **Sort options:** "Name A–Z" (default), "Amount due (highest first)" and "Recently added".
  - **New person:** creates a blank person and returns to the main view with focus in Name (same as the top-bar button).
- **Summary line under the header:** "N people · Total principal ₹X · Total interest ₹Y · Total due ₹Z".
  - It sums every person's current result, with each person using their own calc date and terms.
  - Use the calc engine's computeAll per person, exactly as the result column does.
  - It covers all people, not just the search results.
- **Table**, one row per person, using the History table's quiet style:
  - **Columns:** Name (with the phone in muted text under it) | Loans (count) | Principal | Interest | Amount due | Up to (dd-mm-yyyy) | Last printed (dd-mm-yyyy or "—") | actions.
  - **Number formatting:** numbers are right-aligned and tabular.
  - **Payable side:** if a person's balance is the "payable to" side, show the amount with a small muted "payable" label.
  - The current person's row is subtly highlighted.
  - **Opening a person:** clicking anywhere on a row (or pressing Enter on a focused row) makes that person current and returns to the main view.
  - **Delete:** a "Delete" ghost action per row, with an inline confirm "Delete <Name> and their N loans? [Yes, delete] [No]" (no native dialog). Clicking Delete must not also open the row.
    - Deleting the current person switches the current person to another one, or to a fresh blank person if none are left.
    - Deleting never touches print history.
- **Empty search:** "No one matches '<text>'." Empty state: "No people yet." plus the New person button.
- **Performance:** rendering 300 people must stay snappy. Build the rows once per render, and debounce the search input by about 100ms.
- **Remove** the old popover (`#peoplePop`) and its code. Keep the "More → Delete this person" option.

### Test hooks (v11)
- **Page and header:** `people-btn` (top-bar button), `people-view`, `people-back`, `people-search`, `people-sort` (select with values `name`, `due`, `recent`), `people-new`, and `people-summary` (the summary line).
- **Rows:** `people-item` (each row; keep this testid), `people-delete`, plus the existing `confirm-yes` / `confirm-no`.
- **`people-due`:** a span inside each row holding that row's amount due (formatted, e.g. "1,55,579.38").
- **`people-total-due`:** a span inside the summary holding the total due.

## v12: Debit and Credit kept in separate sections, no minus signs (owner feedback)
The owner wants loans given (Debit) and repayments received (Credit) kept apart everywhere, the way the Excel has separate
Debit and Credit columns. No amount anywhere in the app or the printout shows a minus sign. The data model
(`entries[].type` = `loan` | `repayment`, positive `amount`), storage key, calc engine and totals do not change.

- **Entry form (section 3):** the Type dropdown and the single Amount box are replaced by two amount boxes.
  - **Order:** Date | Particulars (optional) | Debit (₹) | Credit (₹) | Add/Update. "Particulars" is the old Note field, renamed.
  - **Labels:** "Debit (₹)" with a small muted line "Loan given" under it; "Credit (₹)" with "Repayment received".
  - **One per row:** typing in one box clears the other, so a row is either Debit or Credit, never both.
  - **Validation:** if both are empty, the error "Enter the amount under Debit or Credit" shows on Debit (focus goes there).
    A non-number or zero shows "Enter a number above zero" on the box that has it. Date errors stay as before.
  - **Saving:** a Debit amount saves as `type: 'loan'`, a Credit amount as `type: 'repayment'`.
  - **Edit:** loads the amount into the Debit box for a loan, the Credit box for a repayment (the other box is empty).
  - **Narrow screens (< 760px):** Date and Particulars on one line, Debit and Credit on the next, then the buttons.
- **Loan list:** two sub-sections, Debit first, each in date order, rendered whenever the person has at least one entry.
  - **Headings:** "Debit · Loans given" and "Credit · Repayments received", in the quiet section-label style (small caps, muted, a thin rule; no coloured banner).
  - **Columns:** each sub-section has its own column header (Date | Particulars | Amount | Interest | Total | actions).
  - **Signs:** every amount, interest and total is positive (absolute value). Credit rows keep their existing green number colour.
  - **Subtotal:** each sub-section ends with a subtotal row: "Total debit" / "Total credit", with sums of Amount, Interest and Total
    over that section's rows that are counted in the totals (status ok or future; future rows add 0 interest).
  - **Empty section:** if a section has no rows, show one muted line: "No loans given yet." / "No repayments yet." and no subtotal.
  - Each row keeps `data-testid="loan-row"` and its `data-i` = index into `entries`, so Edit/Delete work unchanged.
  - Flagged rows (future, date missing) stay in their own section with their message.
- **Result column breakdown:** the same split inside the one table: a section header row "Debit · Loans given",
  its `result-row`s, a subtotal row "Total debit"; then "Credit · Repayments received", its rows and "Total credit".
  A section with no rows is omitted here. All figures positive. The totals block below is unchanged
  (Total principal, Total interest, Amount due from / payable to).
- **Print:**
  - **Default principal list:** split into the same two sections (each with its heading, its `print-principal-row`s in date order,
    and a "Total debit" / "Total credit" subtotal of Amount). A section with no rows is omitted. No minus signs.
  - **"Include loan-wise breakdown":** the breakdown table is split the same way as the result column.
  - Everything else in the printout stays as v7.
- **Nowhere** (loan list, result column, print) may the text contain the minus character "−" or a leading "-" before an amount.

### Test hooks (v12)
- **Form:** `loan-debit` and `loan-credit` (inputs) replace `loan-amount` and `loan-type`, which are removed. `loan-note` stays (now labelled Particulars).
- **Loan list:** `loan-group-debit`, `loan-group-credit` (the wrapper of each sub-section, containing its rows);
  `loan-subtotal-debit`, `loan-subtotal-credit` (the subtotal row; it contains a span `data-testid="subtotal-amount"` with the formatted amount sum).
- **Result column:** `result-group-debit`, `result-group-credit` (section header rows); `result-subtotal-debit`, `result-subtotal-credit` (subtotal rows).
- **Print:** `print-group-debit`, `print-group-credit` (section header rows in the principal list and the breakdown);
  `print-subtotal-debit`, `print-subtotal-credit` (subtotal rows, each with a `subtotal-amount` span).

### v12.1: colour the Debit and Credit headings (owner feedback)
- The section headings ("Debit · Loans given" / "Credit · Repayments received") in the loan list and the result column get a quiet tinted strip.
  - Debit: terracotta text `#9a4a1f` on `#fbf3ee`. Credit: the existing green `--good` on `#eef6f1`.
  - Each strip has a 3px left bar in its colour. It's a subtle label strip, not a banner.
- The heading elements carry class `debit` / `credit`. Testids are unchanged.
- **Print:** headings stay plain black (no tint), as before.

### v12.2: print Particulars shows only what the user typed (owner feedback)
- In the default printout's principal list, the Particulars cell holds only the entry's note (Particulars).
  - With no note, the cell is blank. There is no automatic "Loan given" / "Repayment received", because the Debit/Credit section headings already say that.
  - A future-dated entry still shows the muted "(after calculation date)" flag.
- The on-screen lists and the "Include loan-wise breakdown" table are unchanged.
