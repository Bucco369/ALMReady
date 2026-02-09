const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${path}: ${text}`);
  }
  return (await res.json()) as T;
}

export type SessionMeta = {
  session_id: string;
  created_at: string;
  status: "active" | string;
  schema_version: string;
};

export type BalanceSheetSummary = {
  sheet: string;
  rows: number;
  columns: string[];
  total_saldo_ini: number | null;
  total_book_value: number | null;
  avg_tae: number | null;
};

export type BalanceSummaryResponse = {
  session_id: string;
  filename: string;
  uploaded_at: string;
  sheets: BalanceSheetSummary[];
  sample_rows: Record<string, Record<string, unknown>[]>;
};

export type BalanceContract = {
  contract_id: string;
  sheet: string;
  subcategory: string;
  category: "asset" | "liability" | string;
  amount: number | null;
  rate: number | null;
};

export type BalanceContractsResponse = {
  session_id: string;
  total: number;
  contracts: BalanceContract[];
};

export async function health(): Promise<{ status: string }> {
  return http<{ status: string }>("/api/health");
}

export async function createSession(): Promise<SessionMeta> {
  return http<SessionMeta>("/api/sessions", { method: "POST" });
}

export async function getSession(sessionId: string): Promise<SessionMeta> {
  return http<SessionMeta>(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export async function uploadBalanceExcel(sessionId: string, file: File): Promise<BalanceSummaryResponse> {
  const fd = new FormData();
  fd.append("file", file, file.name);

  return http<BalanceSummaryResponse>(
    `/api/sessions/${encodeURIComponent(sessionId)}/balance`,
    { method: "POST", body: fd }
  );
}

export async function getBalanceSummary(sessionId: string): Promise<BalanceSummaryResponse> {
  return http<BalanceSummaryResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/balance/summary`);
}

export async function getBalanceContracts(
  sessionId: string,
  params?: { q?: string; offset?: number; limit?: number }
): Promise<BalanceContractsResponse> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));

  const query = qs.toString();
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/balance/contracts${query ? `?${query}` : ""}`;
  return http<BalanceContractsResponse>(path);
}
