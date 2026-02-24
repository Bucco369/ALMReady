from __future__ import annotations

from datetime import date


# --- Canonical daycount bases ---
BASE_ACT_360 = "ACT/360"
BASE_ACT_365 = "ACT/365"
BASE_ACT_ACT = "ACT/ACT"
BASE_30_360  = "30/360"


# --- Map typical input variants to canonical bases ---
DAYCOUNT_BASE_MAP = {
    # ACT/360
    "ACT/360": BASE_ACT_360,
    "ACT360": BASE_ACT_360,
    "A/360": BASE_ACT_360,
    "ACTUAL/360": BASE_ACT_360,
    "ACTUAL/360.0": BASE_ACT_360,

    # ACT/365 (and typical variants)
    "ACT/365": BASE_ACT_365,
    "ACT365": BASE_ACT_365,
    "A/365": BASE_ACT_365,
    "ACTUAL/365": BASE_ACT_365,
    "ACTUAL/365F": BASE_ACT_365,
    "ACT/365F": BASE_ACT_365,

    # ACT/ACT
    "ACT/ACT": BASE_ACT_ACT,
    "ACTACT": BASE_ACT_ACT,
    "A/A": BASE_ACT_ACT,
    "ACTUAL/ACTUAL": BASE_ACT_ACT,
    "ACTUAL/ACT": BASE_ACT_ACT,
    "ACT/ACTISDA": BASE_ACT_ACT,
    "ACTUAL/ACTUALISDA": BASE_ACT_ACT,

    # 30/360
    "30/360": BASE_30_360,
    "30360": BASE_30_360,
    "30E/360": BASE_30_360,
    "30E360": BASE_30_360,
    "30E/360ISDA": BASE_30_360,
    "30E360ISDA": BASE_30_360,
}


def normalize_daycount_base(value: str) -> str:
    """
    Normalize input variants to a canonical daycount base:
    ACT/360, ACT/365, ACT/ACT, 30/360
    """
    if value is None:
        raise ValueError("Daycount base is empty.")

    v = str(value).strip().upper()

    # basic normalization
    v = v.replace(" ", "").replace("-", "/")

    # strip typical parentheses: 30/360(US) or 30/360(USNASD)
    for ch in ("(", ")", "[", "]"):
        v = v.replace(ch, "")

    # normalize common 30E notation variants
    v = v.replace("30/360E", "30E/360")

    # common suffix variants
    v = v.replace("US", "")          # 30/360US
    v = v.replace("NASD", "")        # 30/360NASD
    v = v.replace("FIXED", "F")      # ACT/365FIXED -> ACT/365F

    if v in DAYCOUNT_BASE_MAP:
        return DAYCOUNT_BASE_MAP[v]

    raise ValueError(f"Unrecognized daycount base: {value!r}")


# ============================================================
# Helpers: leap years and end-of-month (for 30/360 US with February)
# ============================================================
def is_leap_year(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)


def _last_day_of_month(year: int, month: int) -> int:
    if month == 2:
        return 29 if is_leap_year(year) else 28
    if month in (1, 3, 5, 7, 8, 10, 12):
        return 31
    return 30


def _is_last_day_of_month(d: date) -> bool:
    return d.day == _last_day_of_month(d.year, d.month)


def _is_last_day_of_february(d: date) -> bool:
    return d.month == 2 and _is_last_day_of_month(d)


# ============================================================
# Year fraction
# ============================================================
def yearfrac(d0: date, d1: date, base: str) -> float:
    """
    Year fraction between d0 and d1 using a canonical daycount base:
      ACT/360, ACT/365, ACT/ACT (ISDA), 30/360 (US)
    """
    if d1 < d0:
        raise ValueError("d1 must be >= d0")

    days = (d1 - d0).days

    if base == BASE_ACT_360:
        return days / 360.0

    if base == BASE_ACT_365:
        return days / 365.0

    if base == BASE_ACT_ACT:
        return yearfrac_act_act_isda(d0, d1)

    if base == BASE_30_360:
        return yearfrac_30_360_us(d0, d1)

    raise ValueError(f"Unsupported daycount base: {base}")


def yearfrac_act_act_isda(d0: date, d1: date) -> float:
    if d1 < d0:
        raise ValueError("d1 must be >= d0")
    if d0 == d1:
        return 0.0

    def diy(y: int) -> int:
        return 366 if is_leap_year(y) else 365

    if d0.year == d1.year:
        return (d1 - d0).days / float(diy(d0.year))

    end_y0 = date(d0.year + 1, 1, 1)
    yf = (end_y0 - d0).days / float(diy(d0.year))

    yf += max(0, d1.year - d0.year - 1)

    start_y1 = date(d1.year, 1, 1)
    yf += (d1 - start_y1).days / float(diy(d1.year))

    return yf


def yearfrac_30_360_us(d0: date, d1: date) -> float:
    """
    30/360 (US) with special February end-of-month adjustment (NASD).
    """
    if d1 < d0:
        raise ValueError("d1 must be >= d0")

    d0_day, d1_day = d0.day, d1.day
    d0_month, d1_month = d0.month, d1.month
    d0_year, d1_year = d0.year, d1.year

    # Special adjustment: end of February
    if _is_last_day_of_february(d0):
        d0_day = 30
    if _is_last_day_of_february(d1) and d0_day in (30, 31):
        d1_day = 30

    # Adjustments for day 31
    if d0_day == 31:
        d0_day = 30
    if d1_day == 31 and d0_day in (30, 31):
        d1_day = 30

    days_360 = (
        360 * (d1_year - d0_year)
        + 30 * (d1_month - d0_month)
        + (d1_day - d0_day)
    )
    return days_360 / 360.0
