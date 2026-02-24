from __future__ import annotations

from datetime import date
from typing import Optional, Union

import pandas as pd

from engine.core.tenors import add_tenor
from engine.core.daycount import normalize_daycount_base, yearfrac


def _parse_rate(x) -> Optional[float]:
    """
    Convert rates from various formats:
      - number (0.03)
      - string '0.03'
      - percentage '3.25%' or '3,25%'
    Returns float in decimal format (0.0325).
    """
    if pd.isna(x):
        return None

    s = str(x).strip()
    if s == "":
        return None

    is_pct = "%" in s
    s = s.replace("%", "").replace(" ", "").replace(",", ".")

    try:
        v = float(s)
    except ValueError:
        return None

    if is_pct:
        v = v / 100.0

    return v


def read_forward_curves_wide(
    path: str,
    sheet_name: Union[int, str] = 0,
) -> pd.DataFrame:
    """
    Read forward curves Excel in WIDE format:
      Col A: IndexName (from row 2 downward)
      Col B..: tenors (headers 1M, 3M, 1Y...)
      Cells: forward rate

    Returns a DataFrame with 'IndexName' column + tenor columns.
    """
    df = pd.read_excel(path, sheet_name=sheet_name, header=0, engine="openpyxl")
    df = df.dropna(how="all")

    if df.shape[1] < 2:
        raise ValueError(
            "Unexpected format: expected 1st column = indices and columns B.. = tenors."
        )

    first_col = df.columns[0]
    df = df.rename(columns={first_col: "IndexName"})

    # Basic cleanup
    df["IndexName"] = df["IndexName"].astype(str).str.strip()
    df = df[df["IndexName"].notna() & (df["IndexName"] != "")]

    # Remove junk columns ("Unnamed: ...") if present
    df = df.loc[:, ~df.columns.astype(str).str.startswith("Unnamed:")]

    return df


def wide_to_long(df_wide: pd.DataFrame) -> pd.DataFrame:
    """
    Convert WIDE -> LONG:
      IndexName | Tenor | FwdRate
    """
    if "IndexName" not in df_wide.columns:
        raise ValueError("Missing 'IndexName' column in df_wide.")

    tenor_cols = list(df_wide.columns[1:])
    if not tenor_cols:
        raise ValueError("No tenor columns found (B..end).")

    df_long = df_wide.melt(
        id_vars=["IndexName"],
        value_vars=tenor_cols,
        var_name="Tenor",
        value_name="FwdRate_raw",
    )

    df_long["Tenor"] = df_long["Tenor"].astype(str).str.strip().str.upper()
    df_long["FwdRate"] = df_long["FwdRate_raw"].apply(_parse_rate)

    df_long = df_long.drop(columns=["FwdRate_raw"])
    df_long = df_long[df_long["FwdRate"].notna()]
    df_long = df_long[df_long["Tenor"].notna() & (df_long["Tenor"] != "")]

    return df_long.reset_index(drop=True)


def enrich_with_dates(
    df_long: pd.DataFrame,
    analysis_date: date,
    base: str = "ACT/365",
) -> pd.DataFrame:
    """
    Add:
      - TenorDate = analysis_date + Tenor
      - YearFrac = yearfrac(analysis_date, TenorDate, normalized_base)

    Validates tenors: if any are unsupported, raises a clear error.
    """
    if df_long.empty:
        raise ValueError("df_long is empty: no curve points (rates) to process.")

    b = normalize_daycount_base(base)

    unique_tenors = sorted(df_long["Tenor"].unique().tolist())
    invalid_tenors = []
    for t in unique_tenors:
        try:
            add_tenor(analysis_date, t)
        except Exception:
            invalid_tenors.append(t)

    if invalid_tenors:
        raise ValueError(f"Unsupported tenors found in Excel: {invalid_tenors}")

    df_long = df_long.copy()
    df_long["TenorDate"] = df_long["Tenor"].apply(lambda t: add_tenor(analysis_date, t))
    df_long["YearFrac"] = df_long["TenorDate"].apply(lambda d: yearfrac(analysis_date, d, b))
    return df_long


def load_forward_curves(
    path: str,
    analysis_date: date,
    base: str = "ACT/365",
    sheet_name: Union[int, str] = 0,
) -> pd.DataFrame:
    """
    Full pipeline:
      Excel (wide) -> long -> with dates and yearfrac
    """
    df_wide = read_forward_curves_wide(path, sheet_name=sheet_name)
    df_long = wide_to_long(df_wide)
    df_final = enrich_with_dates(df_long, analysis_date, base=base)
    return df_final
