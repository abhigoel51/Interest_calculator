"""Build Intrest_package_fixed.xlsx from the original (original is never modified)."""
import sys
from pathlib import Path
import openpyxl
from openpyxl.styles import PatternFill, Font
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.formatting.rule import Rule

# Usage: python build_fixed.py [path/to/Intrest_package.xlsx]
SRC = sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / "Downloads" / "Intrest_package.xlsx")
DST = str(Path(__file__).resolve().parent / "Intrest_package_fixed.xlsx")

wb = openpyxl.load_workbook(SRC)
inp, pf = wb["Inputs"], wb["Print Format"]
LAST = 516  # last Inputs data row

# --- Print Format: restore broken cells (bugs 1-3), then rebuild whole B column (bug 4)
def b_formula(r):
    i = r + 3
    cond = f'A{r}="",A{r-1}<>""'
    if i <= LAST:  # no later date anywhere in Inputs!A(i):A516
        cond += f",COUNT(Inputs!A{i}:$A${LAST})=0"
    return (f'=IF(AND({cond}),"Interest Amount",'
            f'IF(Inputs!B{i}=0,"",Inputs!B{i}))')

pf["A9"] = '=IF(Inputs!A12=0,"",Inputs!A12)'
pf["A9"].number_format = pf["A8"].number_format
pf["D9"] = ('=IF(AND(B9="Interest Amount",Inputs!$B$4="Cr"),Inputs!$B$3,'
            'IF(Inputs!D12<>0,Inputs!D12,""))')
pf["D9"].number_format = pf["D8"].number_format
for r in range(5, LAST + 1):          # B79 and B82 are rebuilt here too
    pf[f"B{r}"] = b_formula(r)

# --- Inputs: interest column (bug 5)
for r in range(7, LAST + 1):
    orig = inp[f"F{r}"].value
    assert orig.startswith("=((D") and "IF(OR" not in orig, (r, orig)
    inp[f"F{r}"] = f'=IF(OR(A{r}="",A{r}>$D$3),0,{orig[1:]})'

rng = f"A7:G{LAST}"
inp.conditional_formatting.add(rng, Rule(
    type="expression", formula=['AND($A7="",OR(N($C7)<>0,N($D7)<>0))'],
    dxf=DifferentialStyle(font=Font(color="9C0006", bold=True),
                          fill=PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid"))))
inp["A5"] = ("NOTE: a row shown in RED has an amount but NO DATE - it earns no interest; "
             "enter its date. A row dated after the calculation date (D3) also gets 0 interest.")
inp["A5"].font = Font(color="C00000", italic=True, size=9)

wb.save(DST)
print("saved", DST)
