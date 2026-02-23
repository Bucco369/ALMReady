"""Filtering, faceting, and aggregation for balance details/contracts."""

from __future__ import annotations

from typing import Any

from app.schemas import (
    BalanceDetailsFacets,
    BalanceDetailsGroup,
    BalanceDetailsTotals,
    FacetOption,
)
from app.parsers.transforms import _to_float, _to_subcategory_id, _to_text


def _split_csv_values(raw: str | None) -> set[str]:
    if raw is None:
        return set()
    values = []
    for token in raw.split(","):
        cleaned = token.strip()
        if cleaned:
            values.append(cleaned.lower())
    return set(values)


def _normalize_category_filter(raw: str | None) -> set[str]:
    values = _split_csv_values(raw)
    out: set[str] = set()
    for value in values:
        if value in {"assets", "asset"}:
            out.add("asset")
        elif value in {"liabilities", "liability"}:
            out.add("liability")
        elif value in {"equity"}:
            out.add("equity")
        elif value in {"derivatives", "derivative"}:
            out.add("derivative")
    return out


def _matches_multi(value: str | None, allowed: set[str]) -> bool:
    if not allowed:
        return True
    if value is None:
        return False
    return value.lower() in allowed


def _matches_subcategory(row: dict[str, Any], subcategoria_ui: str | None, subcategory_id: str | None) -> bool:
    if not subcategoria_ui and not subcategory_id:
        return True

    row_id = str(row.get("subcategory_id") or "").lower()
    row_label = str(row.get("subcategoria_ui") or "").lower()

    if subcategory_id and row_id != subcategory_id.strip().lower():
        return False

    if subcategoria_ui:
        wanted = subcategoria_ui.strip().lower()
        if row_label != wanted and row_id != _to_subcategory_id(subcategoria_ui, "").lower():
            return False

    return True


def _apply_filters(
    rows: list[dict[str, Any]],
    *,
    categoria_ui: str | None = None,
    subcategoria_ui: str | None = None,
    subcategory_id: str | None = None,
    group: str | None = None,
    currency: str | None = None,
    rate_type: str | None = None,
    counterparty: str | None = None,
    maturity: str | None = None,
    query_text: str | None = None,
) -> list[dict[str, Any]]:
    category_filter = _normalize_category_filter(categoria_ui)
    currency_filter = _split_csv_values(currency)
    rate_filter = _split_csv_values(rate_type)
    counterparty_filter = _split_csv_values(counterparty)
    maturity_filter = _split_csv_values(maturity)
    group_filter = _split_csv_values(group)

    query_norm = (query_text or "").strip().lower()

    filtered: list[dict[str, Any]] = []
    for row in rows:
        if not row.get("include_in_balance_tree"):
            continue

        side = str(row.get("side") or "").lower()
        if category_filter and side not in category_filter:
            continue

        if not _matches_subcategory(row, subcategoria_ui, subcategory_id):
            continue

        row_group = _to_text(row.get("group"))
        if not _matches_multi(row_group, group_filter):
            continue

        row_currency = _to_text(row.get("currency"))
        if not _matches_multi(row_currency, currency_filter):
            continue

        row_rate_type = _to_text(row.get("rate_type"))
        if not _matches_multi(row_rate_type, rate_filter):
            continue

        row_counterparty = _to_text(row.get("counterparty"))
        if not _matches_multi(row_counterparty, counterparty_filter):
            continue

        row_maturity = _to_text(row.get("maturity_bucket"))
        if not _matches_multi(row_maturity, maturity_filter):
            continue

        if query_norm:
            contract_id = str(row.get("contract_id") or "").lower()
            sheet_name = str(row.get("sheet") or "").lower()
            group_name = str(row.get("group") or "").lower()
            if query_norm not in contract_id and query_norm not in sheet_name and query_norm not in group_name:
                continue

        filtered.append(row)

    return filtered


def _build_facets(rows: list[dict[str, Any]]) -> BalanceDetailsFacets:
    def count_values(field: str) -> list[FacetOption]:
        counts: dict[str, int] = {}
        for row in rows:
            value = _to_text(row.get(field))
            if value is None:
                continue
            counts[value] = counts.get(value, 0) + 1
        return [FacetOption(value=k, count=v) for k, v in sorted(counts.items(), key=lambda item: item[0].lower())]

    return BalanceDetailsFacets(
        currencies=count_values("currency"),
        rate_types=count_values("rate_type"),
        counterparties=count_values("counterparty"),
        maturities=count_values("maturity_bucket"),
    )


def _aggregate_groups(rows: list[dict[str, Any]]) -> list[BalanceDetailsGroup]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grp = _to_text(row.get("group")) or "Ungrouped"
        grouped.setdefault(grp, []).append(row)

    from app.parsers.transforms import _weighted_avg_maturity, _weighted_avg_rate

    items: list[BalanceDetailsGroup] = []
    for grp, group_rows in grouped.items():
        amount = float(sum((_to_float(r.get("amount")) or 0.0) for r in group_rows))
        items.append(
            BalanceDetailsGroup(
                group=grp,
                amount=amount,
                positions=len(group_rows),
                avg_rate=_weighted_avg_rate(group_rows),
                avg_maturity=_weighted_avg_maturity(group_rows),
            )
        )

    return sorted(items, key=lambda x: x.amount, reverse=True)


def _aggregate_totals(rows: list[dict[str, Any]]) -> BalanceDetailsTotals:
    from app.parsers.transforms import _weighted_avg_maturity, _weighted_avg_rate

    return BalanceDetailsTotals(
        amount=float(sum((_to_float(r.get("amount")) or 0.0) for r in rows)),
        positions=len(rows),
        avg_rate=_weighted_avg_rate(rows),
        avg_maturity=_weighted_avg_maturity(rows),
    )
