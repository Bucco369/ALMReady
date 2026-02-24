from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Dict, Iterable, Union

import pandas as pd

from engine.io.curves_forward_reader import load_forward_curves
from engine.core.curves import ForwardCurve, curve_from_long_df
from engine.core.daycount import normalize_daycount_base, yearfrac


@dataclass
class ForwardCurveSet:
    """
    Forward curve set by IndexName, ready to query rates/DF.
    """
    analysis_date: date
    base: str
    points: pd.DataFrame               # canonical long table (debug/export)
    curves: Dict[str, ForwardCurve]    # index_name -> ForwardCurve

    @property
    def available_indices(self) -> list[str]:
        return sorted(self.curves.keys())

    def get(self, index_name: str) -> ForwardCurve:
        if index_name not in self.curves:
            available = self.available_indices
            raise KeyError(f"Curve not found: {index_name!r}. Available: {available}")
        return self.curves[index_name]

    def require_indices(self, required_indices: Iterable[str]) -> None:
        """
        Fails if any required index is missing from the curve set.
        """
        required = sorted(
            {
                str(ix).strip()
                for ix in required_indices
                if ix is not None and str(ix).strip() != ""
            }
        )
        missing = [ix for ix in required if ix not in self.curves]
        if missing:
            raise KeyError(
                f"Missing curves for required indices: {missing}. "
                f"Available: {self.available_indices}"
            )

    def require_float_index_coverage(
        self,
        positions: pd.DataFrame,
        *,
        rate_type_col: str = "rate_type",
        index_col: str = "index_name",
        row_offset: int = 2,
    ) -> None:
        """
        Ensures curve coverage for floating rate positions.
        """
        for col in (rate_type_col, index_col):
            if col not in positions.columns:
                raise ValueError(f"positions does not contain required column: {col!r}")

        rate_tokens = (
            positions[rate_type_col]
            .astype("string")
            .str.strip()
            .str.lower()
        )
        float_mask = rate_tokens.eq("float")
        if not float_mask.any():
            return

        missing_index_mask = (
            float_mask
            & (
                positions[index_col].isna()
                | positions[index_col].astype("string").str.strip().eq("")
            )
        )
        if missing_index_mask.any():
            rows = [int(i) + row_offset for i in positions.index[missing_index_mask][:10]]
            raise ValueError(
                f"Float positions without index_name in rows {rows}"
            )

        required = (
            positions.loc[float_mask, index_col]
            .astype("string")
            .str.strip()
            .dropna()
            .tolist()
        )
        self.require_indices(required)

    def _t(self, d: date) -> float:
        """
        Converts a calendar date to year-fraction from analysis_date using self.base.
        """
        b = normalize_daycount_base(self.base)
        return yearfrac(self.analysis_date, d, b)

    def rate_on_date(self, index_name: str, d: date) -> float:
        """
        Equivalent rate (continuous comp., via log-linear DF) on a date d.
        """
        curve = self.get(index_name)
        t = self._t(d)
        return curve.rate(t)

    def df_on_date(self, index_name: str, d: date) -> float:
        """
        Discount Factor on a date d (useful for EVE).
        """
        curve = self.get(index_name)
        t = self._t(d)
        return curve.discount_factor(t)


def load_forward_curve_set(
    path: str,
    analysis_date: date,
    base: str = "ACT/365",
    sheet_name: Union[int, str] = 0,
) -> ForwardCurveSet:
    """
    Pipeline:
      Excel curves (wide) -> canonical long -> ForwardCurve by IndexName
    """
    df = load_forward_curves(
        path,
        analysis_date=analysis_date,
        base=base,
        sheet_name=sheet_name,
    )

    index_names = sorted(df["IndexName"].unique().tolist())
    curves: Dict[str, ForwardCurve] = {}
    for ix in index_names:
        curves[ix] = curve_from_long_df(df, ix)

    return ForwardCurveSet(
        analysis_date=analysis_date,
        base=base,
        points=df,
        curves=curves,
    )
