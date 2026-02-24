from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ParallelShock:
    """
    Parallel shock in basis points to add on top of FwdRate.
    """

    name: str
    shift_bps: float

    @property
    def shift_decimal(self) -> float:
        return float(self.shift_bps) / 10000.0

