from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from datetime import date
from math import exp, log
import pandas as pd


@dataclass(frozen=True)
class CurvePoint:
    year_frac: float      # T (years)
    rate: float           # r(T) in decimal (assuming continuous compounding for DF)
    tenor: str            # "ON", "1M", ...
    tenor_date: date      # pillar date (analysis_date + tenor)


@dataclass
class ForwardCurve:
    index_name: str
    points: list[CurvePoint]

    def __post_init__(self) -> None:
        if not self.points:
            raise ValueError(f"Curve '{self.index_name}' has no points.")

        self.points.sort(key=lambda p: p.year_frac)

        # Validation: T must be strictly increasing
        prev = None
        for p in self.points:
            if prev is not None and p.year_frac <= prev:
                raise ValueError(
                    f"Curve '{self.index_name}' has non-strictly-increasing YearFrac "
                    f"(duplicate or out of order)."
                )
            prev = p.year_frac

    @property
    def year_fracs(self) -> list[float]:
        return [p.year_frac for p in self.points]

    @property
    def rates(self) -> list[float]:
        return [p.rate for p in self.points]

    # ---------- Core: log-linear in DF ----------
    def _pillar_ln_dfs(self) -> list[float]:
        # ln(DF_i) = -r_i * T_i (continuous compounding)
        return [-p.rate * p.year_frac for p in self.points]

    @staticmethod
    def _interp_linear(x: float, x0: float, x1: float, y0: float, y1: float) -> float:
        if x1 == x0:
            return y1
        w = (x - x0) / (x1 - x0)
        return y0 + w * (y1 - y0)

    def discount_factor(self, t: float) -> float:
        """
        DF(t) with log-linear interpolation in ln(DF):
        - For 0 < t < first pillar: interpolate between (0, lnDF=0) and first pillar.
        - Between pillars: linear interpolation in lnDF.
        - For t > last pillar: extrapolation (not interpolation), using the
          slope of the last segment in ln(DF).

        Modeling note for the long tail:
        - This extrapolation implies "flat instantaneous forward" in the tail
          (constant slope in ln(DF)).
        - It does NOT imply "flat zero rate".
        - If another tail behavior is needed (e.g. convergence to UFR), it must
          be implemented as an explicit alternative mode.
        """
        if t is None:
            raise ValueError("t cannot be None.")
        t = float(t)

        if t <= 0.0:
            return 1.0

        xs = self.year_fracs
        ln_dfs = self._pillar_ln_dfs()

        if len(xs) == 1:
            x1 = xs[0]
            y1 = ln_dfs[0]
            if t <= x1:
                ln_df_t = self._interp_linear(t, 0.0, x1, 0.0, y1)
            else:
                ln_df_t = self._interp_linear(t, 0.0, x1, 0.0, y1)
            return exp(ln_df_t)

        if t <= xs[0]:
            ln_df_t = self._interp_linear(t, 0.0, xs[0], 0.0, ln_dfs[0])
            return exp(ln_df_t)

        if t >= xs[-1]:
            # Beyond the pillar domain: no interpolation possible here.
            # Extrapolate ln(DF) linearly using the slope of the last segment.
            # Equivalent to constant instantaneous forward in the tail.
            ln_df_t = self._interp_linear(
                t,
                xs[-2],
                xs[-1],
                ln_dfs[-2],
                ln_dfs[-1],
            )
            return exp(ln_df_t)

        j = bisect_left(xs, t)
        ln_df_t = self._interp_linear(
            t,
            xs[j - 1],
            xs[j],
            ln_dfs[j - 1],
            ln_dfs[j],
        )
        return exp(ln_df_t)

    def zero_rate(self, t: float) -> float:
        """
        r(t) equivalente (comp continua) derivada de DF(t):
          r(t) = -ln DF(t) / t
        """
        t = float(t)
        if t <= 0.0:
            # not defined at 0; return first pillar rate as convention
            return float(self.points[0].rate)

        df = self.discount_factor(t)
        return -log(df) / t

    # Convenience: rate(t) is an alias for zero_rate(t)
    def rate(self, t: float) -> float:
        return self.zero_rate(t)


def curve_from_long_df(
    df_long: pd.DataFrame,
    index_name: str,
    col_index: str = "IndexName",
    col_tenor: str = "Tenor",
    col_rate: str = "FwdRate",
    col_tenor_date: str = "TenorDate",
    col_year_frac: str = "YearFrac",
) -> ForwardCurve:
    required = [col_index, col_tenor, col_rate, col_tenor_date, col_year_frac]
    missing = [c for c in required if c not in df_long.columns]
    if missing:
        raise ValueError(f"df_long is missing required columns: {missing}")

    sub = df_long[df_long[col_index] == index_name].copy()
    if sub.empty:
        raise ValueError(f"No points found for IndexName='{index_name}'.")

    if sub[col_year_frac].isna().any():
        raise ValueError(f"Curve '{index_name}' has null YearFrac.")
    if sub[col_rate].isna().any():
        raise ValueError(f"Curve '{index_name}' has null FwdRate.")

    points: list[CurvePoint] = []
    for r in sub.itertuples(index=False):
        points.append(
            CurvePoint(
                year_frac=float(getattr(r, col_year_frac)),
                rate=float(getattr(r, col_rate)),
                tenor=str(getattr(r, col_tenor)).strip().upper(),
                tenor_date=getattr(r, col_tenor_date),
            )
        )

    return ForwardCurve(index_name=index_name, points=points)
