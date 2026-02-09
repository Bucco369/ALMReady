import type { BalanceSheetSummary, BalanceSummaryResponse } from "@/lib/api";

export type BalanceUiCategory = "asset" | "liability";

export interface BalanceUiRow {
  id: string;
  sheetName: string;
  label: string;
  category: BalanceUiCategory;
  amount: number;
  positions: number;
  avgRate: number | null;
  columns: string[];
}

function normalizeId(input: string): string {
  const ascii = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function inferCategoryFromSheetName(sheetName: string): BalanceUiCategory {
  const name = sheetName.toLowerCase();
  const liabilityTokens = [
    "acreedora",
    "acreedoras",
    "deposit",
    "imposicion",
    "pasiv",
    "liabil",
    "funding",
    "debt",
  ];

  return liabilityTokens.some((token) => name.includes(token)) ? "liability" : "asset";
}

export function mapSheetSummaryToUiRow(sheet: BalanceSheetSummary): BalanceUiRow {
  return {
    id: normalizeId(sheet.sheet),
    sheetName: sheet.sheet,
    label: sheet.sheet,
    category: inferCategoryFromSheetName(sheet.sheet),
    amount: sheet.total_saldo_ini ?? sheet.total_book_value ?? 0,
    positions: sheet.rows,
    avgRate: sheet.avg_tae,
    columns: sheet.columns,
  };
}

export function mapBalanceSummaryToUiRows(summary: BalanceSummaryResponse): BalanceUiRow[] {
  return summary.sheets.map(mapSheetSummaryToUiRow);
}

