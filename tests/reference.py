#!/usr/bin/env python3
"""Independent reference implementation of the Interest Calculator formulas (docs/SPEC.md).

Usage:  /usr/bin/env python3 tests/reference.py        -> regenerates tests/golden.json
Standard library only.
"""
import json
import math
import os
import sys


def excel_mod(n, d):
    """Excel MOD: result has the sign of the divisor."""
    return n - d * math.floor(n / d)


def excel_rounddown(x):
    """Excel ROUNDDOWN(x, 0): truncate toward zero."""
    return int(math.trunc(x))


def _num(v):
    return 0.0 if v is None or v == "" else float(v)


def compute_row(txn, s):
    debit, credit = _num(txn.get("debit")), _num(txn.get("credit"))
    date = txn.get("date")
    amt = credit - debit
    if not date:
        status = "empty" if (debit == 0 and credit == 0) else "nodate"
        return dict(amt=amt, T=None, V=None, W=None, interest=0.0, status=status)
    y, m, d = (int(p) for p in date.split("-"))
    cy, cm, cd = (int(p) for p in s["calcDate"].split("-"))
    comp, roi, approx = s["comp"], s["roi"], s["approx"]
    T = (cy - y) * 12 + (cm - m) + (cd - d) / 30
    if T < 0:
        return dict(amt=amt, T=T, V=None, W=None, interest=0.0, status="future")
    mod = excel_mod(T, comp)
    U = 1 if mod > approx else 0
    V = excel_rounddown(T / comp) if U else excel_rounddown(T / comp) - 1
    W = T - V * comp
    interest = amt * (1 + roi * comp / 100) ** V * (1 + roi * W / 100) - amt
    if T == 0:
        interest = 0.0  # spec: T = 0 gives interest 0 (removes float dust)
    return dict(amt=amt, T=T, V=V, W=W, interest=interest, status="ok")


def compute_all(txns, s):
    rows = [compute_row(t, s) for t in txns]
    counted = [r for r in rows if r["status"] != "nodate"]
    principal = sum(r["amt"] for r in counted)
    interest = sum(r["interest"] for r in counted)
    balance = principal + interest
    side = lambda x: "Dr" if x < 0 else "Cr"
    return dict(rows=rows, principal=principal, interest=interest, balance=balance,
                principalSide=side(principal), interestSide=side(interest),
                balanceSide=side(balance))


# ---------------------------------------------------------------------------
# HAND VERIFICATION (done with pencil arithmetic, independent of the code)
# Settings: calc 2026-11-01, roi 1.25, comp 6, approx 0.  1+roi*comp/100 = 1.075
#
# 1) spec_reference, one 70000 debit dated 2026-02-10:
#    T = 0*12 + (11-2) + (1-10)/30 = 9 - 0.3 = 8.7
#    MOD(8.7,6) = 2.7 > 0 -> U=1; V = trunc(8.7/6) = trunc(1.45) = 1; W = 8.7 - 6 = 2.7
#    factor = 1.075 * (1 + 0.0125*2.7) = 1.075 * 1.03375 = 1.11128125
#    interest = -70000*1.11128125 + 70000 = -77789.6875 + 70000 = -7789.6875
#    two rows: -15579.375 ; balance = -140000 - 15579.375 = -155579.375 -> Dr. Matches SPEC.
#
# 2) exact_12_months, 10000 debit dated 2025-11-01:
#    T = 12 + 0 + 0 = 12; MOD(12,6)=0 -> U=0; V = trunc(2) - 1 = 1; W = 12 - 6 = 6
#    factor = 1.075 * (1 + 0.0125*6) = 1.075 * 1.075 = 1.155625
#    interest = -10000*1.155625 + 10000 = -1556.25 (Dr)
#
# 3) credit_fraction_lt1, 50000 credit dated 2026-10-16:
#    T = (11-10) + (1-16)/30 = 1 - 0.5 = 0.5; MOD(0.5,6)=0.5 > 0 -> U=1
#    V = trunc(0.5/6) = 0; W = 0.5; factor = 1 + 0.0125*0.5 = 1.00625
#    interest = 50000*1.00625 - 50000 = +312.5 (Cr)
# ---------------------------------------------------------------------------


def S(calc, roi=1.25, comp=6, approx=0):
    return dict(calcDate=calc, roi=roi, comp=comp, approx=approx)


def X(date, debit=None, credit=None, p=""):
    return dict(date=date, particulars=p, debit=debit, credit=credit)


CASES = [
    ("spec_reference", "Spec reference: two debits 70000 on 2026-02-10, expect 15579.375 Dr",
     S("2026-11-01"), [X("2026-02-10", 70000), X("2026-02-10", 70000)]),
    ("exact_12_months", "T=12 exact multiple of comp (hand-verified)",
     S("2026-11-01"), [X("2025-11-01", 10000)]),
    ("credit_fraction_lt1", "Credit, T=0.5 (hand-verified)",
     S("2026-11-01"), [X("2026-10-16", None, 50000)]),
    ("exact_6_months", "T=6 exact, comp 6", S("2026-11-01"), [X("2026-05-01", 20000)]),
    ("fraction_lt1_debit", "T=0.2 debit", S("2026-11-01"), [X("2026-10-26", 100000)]),
    ("same_day", "T=0 same-day transaction", S("2026-11-01"), [X("2026-11-01", 5000)]),
    ("mixed_cr_result", "Debit and larger credit gives Cr totals",
     S("2026-11-01"), [X("2025-01-15", 10000), X("2025-06-20", None, 80000), X("2026-03-05", 5000)]),
    ("mixed_dr_result", "Larger debit than credit gives Dr",
     S("2026-11-01"), [X("2024-04-10", 90000), X("2025-02-14", None, 20000)]),
    ("credits_only", "Only credits", S("2026-11-01"), [X("2025-03-03", None, 12345.67), X("2026-01-31", None, 800)]),
    ("principal_zero_interest_pos", "Debit and equal credit at different times: principal 0",
     S("2026-11-01"), [X("2024-01-01", 50000), X("2025-01-01", None, 50000)]),
    ("month_end_jan31_to_feb28", "31 Jan -> 28 Feb non-leap (calc 2027-02-28)",
     S("2027-02-28"), [X("2027-01-31", 30000), X("2026-08-31", 30000)]),
    ("month_end_jan31_to_feb29", "31 Jan -> 29 Feb leap (calc 2028-02-29)",
     S("2028-02-29"), [X("2028-01-31", 30000), X("2027-08-31", 30000)]),
    ("month_end_31_to_30", "31st -> 30th (calc 2026-11-30)",
     S("2026-11-30"), [X("2026-10-31", 40000), X("2026-05-31", 40000), X("2026-07-31", None, 1000)]),
    ("leap_day_txn", "Txn on 29 Feb 2024", S("2026-11-01"), [X("2024-02-29", 60000)]),
    ("leap_year_calc", "Calc on 29 Feb 2028", S("2028-02-29"), [X("2024-02-29", 60000), X("2027-03-01", 1000)]),
    ("approx_0_5", "approx 0.5: mod below tolerance lowers V",
     S("2026-11-01", approx=0.5), [X("2026-04-20", 10000), X("2026-04-10", 10000), X("2026-05-01", 10000)]),
    ("approx_1", "approx 1: more rows fall into the tolerance",
     S("2026-11-01", approx=1), [X("2026-04-05", 10000), X("2026-03-01", 10000), X("2025-11-01", 10000), X("2026-10-01", 10000)]),
    ("approx_exact_boundary", "approx 0.5 with mod exactly == approx (not >)",
     S("2026-11-01", approx=0.5), [X("2026-04-16", 10000)]),
    ("comp_1", "comp = 1 month", S("2026-11-01", comp=1), [X("2026-02-10", 25000), X("2026-10-20", 25000)]),
    ("comp_12", "comp = 12 months", S("2026-11-01", comp=12),
     [X("2025-11-01", 25000), X("2025-02-10", 25000), X("2026-06-15", 25000)]),
    ("roi_2", "ROI 2 per month", S("2026-11-01", roi=2), [X("2025-06-12", 100000), X("2026-01-01", None, 30000)]),
    ("future_rows", "Future-dated rows: interest 0, status future",
     S("2026-11-01"), [X("2026-02-10", 70000), X("2026-12-15", 5000), X("2027-01-01", None, 9000)]),
    ("future_same_month_later_day", "Later day in same month is future (T=-0.1)",
     S("2026-11-01"), [X("2026-11-04", 3000), X("2026-11-01", 3000)]),
    ("missing_dates", "Rows with amount but no date: nodate, excluded from totals",
     S("2026-11-01"), [X("2026-02-10", 70000), X(None, 1000), X("", None, 2500, "no date")]),
    ("empty_rows", "Completely empty rows", S("2026-11-01"),
     [X(None), X("2025-05-05", 10000), X(None, None, None), X("")]),
    ("all_empty", "No transactions with data", S("2026-11-01"), [X(None), X(None)]),
    ("no_rows", "Empty list", S("2026-11-01"), []),
    ("long_span_12y", "Long span 12+ years, comp 6", S("2026-11-01"),
     [X("2014-03-17", 100000), X("2012-12-31", None, 25000)]),
    ("long_span_20y_comp12", "Long span 20+ years, comp 12, ROI 1.5", S("2026-11-01", roi=1.5, comp=12),
     [X("2005-07-09", 50000)]),
    ("different_calc_year_boundary", "Calc date early in Jan, txns in prior year",
     S("2027-01-05"), [X("2026-12-20", 10000), X("2026-07-05", 10000), X("2026-01-05", 10000)]),
]


def build():
    out = []
    for name, desc, s, txns in CASES:
        res = compute_all(txns, s)
        out.append(dict(name=name, description=desc, settings=s, txns=txns, expected=res))
    return out


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "golden.json")
    with open(path, "w") as f:
        json.dump(build(), f, indent=1)
    print("wrote %d cases to %s" % (len(CASES), path))
    ref = compute_all(*(lambda c: (c[3], c[2]))(CASES[0]))
    print("spec case: interest=%r balance=%r %s" % (ref["interest"], ref["balance"], ref["balanceSide"]))
