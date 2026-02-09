from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import uuid
import json

import pandas as pd
import numpy as np

app = FastAPI()

# CORS (dev): permite que el front (localhost) llame al back
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Modelos ----
class SessionMeta(BaseModel):
    session_id: str
    created_at: str
    status: str = "active"
    schema_version: str = "v1"

class BalanceSheetSummary(BaseModel):
    sheet: str
    rows: int
    columns: list[str]
    total_saldo_ini: float | None = None
    total_book_value: float | None = None
    avg_tae: float | None = None

class BalanceUploadResponse(BaseModel):
    session_id: str
    filename: str
    uploaded_at: str
    sheets: list[BalanceSheetSummary]
    sample_rows: dict[str, list[dict]]  # primeras N filas por hoja (debug)

class BalanceContract(BaseModel):
    contract_id: str
    sheet: str
    subcategory: str
    category: str
    amount: float | None = None
    rate: float | None = None

class BalanceContractsResponse(BaseModel):
    session_id: str
    total: int
    contracts: list[BalanceContract]

# ---- Store en memoria (dev) ----
_SESSIONS: dict[str, SessionMeta] = {}

# ---- Persistencia local (dev) ----
BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
SESSIONS_DIR = BASE_DIR / "data" / "sessions"
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)

def _session_dir(session_id: str) -> Path:
    d = SESSIONS_DIR / session_id
    d.mkdir(parents=True, exist_ok=True)
    return d

def _session_meta_path(session_id: str) -> Path:
    return SESSIONS_DIR / session_id / "meta.json"

def _persist_session_meta(meta: SessionMeta) -> None:
    sdir = _session_dir(meta.session_id)
    (sdir / "meta.json").write_text(meta.model_dump_json(indent=2), encoding="utf-8")

def _load_session_from_disk(session_id: str) -> SessionMeta | None:
    meta_path = _session_meta_path(session_id)
    if not meta_path.exists():
        return None

    try:
        meta_raw = json.loads(meta_path.read_text(encoding="utf-8"))
        meta = SessionMeta(**meta_raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Corrupted session metadata for {session_id}: {e}")

    _SESSIONS[session_id] = meta
    return meta

def _get_session_meta(session_id: str) -> SessionMeta | None:
    if session_id in _SESSIONS:
        return _SESSIONS[session_id]
    return _load_session_from_disk(session_id)

def _assert_session_exists(session_id: str) -> None:
    if _get_session_meta(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found. Create it first via POST /api/sessions")

def _df_clean_for_json(df: pd.DataFrame) -> pd.DataFrame:
    # Normaliza placeholders tipo '--' y NaNs
    df = df.replace({"--": None})
    df = df.replace({np.nan: None})

    # Convierte fechas a string ISO si existen
    for col in ["f_ini", "f_rep", "f_fin", "f_cuota"]:
        if col in df.columns:
            s = pd.to_datetime(df[col], errors="coerce")
            df[col] = s.dt.strftime("%Y-%m-%d")
            df.loc[s.isna(), col] = None

    return df

def _find_column_name(df: pd.DataFrame, target: str) -> str | None:
    target_norm = target.strip().lower()
    for col in df.columns:
        if str(col).strip().lower() == target_norm:
            return str(col)
    return None

def _find_first_column_name(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for candidate in candidates:
        col = _find_column_name(df, candidate)
        if col is not None:
            return col
    return None

def _normalize_id(input_value: str) -> str:
    normalized = str(input_value).strip().lower()
    normalized = normalized.replace(" ", "-").replace("/", "-")
    out = []
    last_dash = False
    for ch in normalized:
        if ch.isalnum():
            out.append(ch)
            last_dash = False
        else:
            if not last_dash:
                out.append("-")
                last_dash = True
    result = "".join(out).strip("-")
    return result or "unknown"

def _infer_category_from_sheet_name(sheet_name: str) -> str:
    name = sheet_name.strip().lower()
    liability_tokens = [
        "acreedora",
        "acreedoras",
        "deposit",
        "imposicion",
        "pasiv",
        "liabil",
        "funding",
        "debt",
    ]
    for token in liability_tokens:
        if token in name:
            return "liability"
    return "asset"

def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if np.isnan(numeric):
        return None
    return numeric

def _contract_id_as_text(value: Any, fallback: str) -> str:
    if value is None:
        return fallback

    if isinstance(value, (int, np.integer)):
        return str(int(value))

    if isinstance(value, float):
        if np.isnan(value):
            return fallback
        if value.is_integer():
            return str(int(value))
        return str(value)

    text = str(value).strip()
    return text if text != "" else fallback

def _build_contract_rows(sheet_name: str, df: pd.DataFrame) -> list[dict]:
    if df.empty:
        return []

    category = _infer_category_from_sheet_name(sheet_name)
    subcategory = _normalize_id(sheet_name)

    contract_id_col = _find_first_column_name(df, ["n_contrato", "num_sec_ac", "contract_id", "id"])
    amount_col = _find_first_column_name(df, ["saldo_ini", "book_value", "notional", "importe"])
    rate_col = _find_first_column_name(df, ["tae", "rate", "tipo_rf"])

    rows: list[dict] = []
    records = df.to_dict(orient="records")
    for idx, rec in enumerate(records):
        contract_raw = rec.get(contract_id_col) if contract_id_col else None
        fallback_id = f"{subcategory}-{idx + 1}"
        contract_id = _contract_id_as_text(contract_raw, fallback_id)

        rows.append(
            {
                "contract_id": contract_id,
                "sheet": sheet_name,
                "subcategory": subcategory,
                "category": category,
                "amount": _to_float(rec.get(amount_col)) if amount_col else None,
                "rate": _to_float(rec.get(rate_col)) if rate_col else None,
            }
        )

    return rows

def _load_or_rebuild_contract_index(session_id: str) -> list[dict]:
    sdir = _session_dir(session_id)
    contracts_path = sdir / "balance_contracts.json"
    if contracts_path.exists():
        return json.loads(contracts_path.read_text(encoding="utf-8"))

    excel_candidates = sorted(
        [
            p
            for p in sdir.iterdir()
            if p.is_file() and p.suffix.lower() in {".xlsx", ".xls"}
        ],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not excel_candidates:
        raise HTTPException(status_code=404, detail="No balance uploaded for this session yet")

    xlsx_path = excel_candidates[0]
    try:
        xls = pd.ExcelFile(xlsx_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot read Excel file: {e}")

    all_contracts: list[dict] = []
    for sh in xls.sheet_names:
        df = pd.read_excel(xlsx_path, sheet_name=sh)
        df = _df_clean_for_json(df)
        all_contracts.extend(_build_contract_rows(sh, df))

    contracts_path.write_text(json.dumps(all_contracts, indent=2), encoding="utf-8")
    return all_contracts

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.post("/api/sessions", response_model=SessionMeta)
def create_session():
    sid = str(uuid.uuid4())
    meta = SessionMeta(
        session_id=sid,
        created_at=datetime.now(timezone.utc).isoformat(),
        status="active",
        schema_version="v1",
    )
    _SESSIONS[sid] = meta
    _persist_session_meta(meta)
    return meta

@app.get("/api/sessions/{session_id}", response_model=SessionMeta)
def get_session(session_id: str):
    _assert_session_exists(session_id)
    # _assert_session_exists lazily reloads from disk after backend restarts.
    return _get_session_meta(session_id)

@app.post("/api/sessions/{session_id}/balance", response_model=BalanceUploadResponse)
async def upload_balance(session_id: str, file: UploadFile = File(...)):
    """
    Sube un XLSX (balance simplificado por hojas), lo parsea y devuelve un resumen.
    Además guarda el fichero y un JSON de resumen en backend/data/sessions/<session_id>/
    """
    _assert_session_exists(session_id)

    filename = file.filename or "balance.xlsx"
    if not filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx/.xls files are supported")

    # Guarda fichero en disco
    sdir = _session_dir(session_id)
    xlsx_path = sdir / filename
    content = await file.read()
    xlsx_path.write_bytes(content)

    # Lee todas las hojas
    try:
        xls = pd.ExcelFile(xlsx_path)
        sheet_names = xls.sheet_names
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Cannot read Excel file: {e}")

    sample_rows: dict[str, list[dict]] = {}
    all_contracts: list[dict] = []

    sheet_summaries: list[BalanceSheetSummary] = []
    for sh in sheet_names:
        df = pd.read_excel(xlsx_path, sheet_name=sh)
        df = _df_clean_for_json(df)

        cols = [str(c) for c in df.columns.tolist()]
        rows = int(df.shape[0])

        saldo_col = _find_column_name(df, "saldo_ini")
        total_saldo = None
        if saldo_col is not None:
            total_saldo = float(pd.to_numeric(df[saldo_col], errors="coerce").fillna(0).sum())

        book_value_col = _find_column_name(df, "book_value")
        total_bv = None
        if book_value_col is not None:
            total_bv = float(pd.to_numeric(df[book_value_col], errors="coerce").fillna(0).sum())

        tae_col = _find_column_name(df, "tae")
        avg_tae = None
        if tae_col is not None:
            tae_series = pd.to_numeric(df[tae_col], errors="coerce")
            if tae_series.notna().any():
                avg_tae = float(tae_series.mean())

        sheet_summaries.append(
            BalanceSheetSummary(
                sheet=sh,
                rows=rows,
                columns=cols,
                total_saldo_ini=total_saldo,
                total_book_value=total_bv,
                avg_tae=avg_tae,
            )
        )

        # sample debug (primeras 3 filas)
        sample_rows[sh] = df.head(3).to_dict(orient="records")
        all_contracts.extend(_build_contract_rows(sh, df))

    uploaded_at = datetime.now(timezone.utc).isoformat()
    resp = BalanceUploadResponse(
        session_id=session_id,
        filename=filename,
        uploaded_at=uploaded_at,
        sheets=sheet_summaries,
        sample_rows=sample_rows,
    )

    # Persistimos resumen para poder pedirlo luego sin reparsear
    (sdir / "balance_summary.json").write_text(resp.model_dump_json(indent=2), encoding="utf-8")
    (sdir / "balance_contracts.json").write_text(json.dumps(all_contracts, indent=2), encoding="utf-8")

    return resp

@app.get("/api/sessions/{session_id}/balance/summary", response_model=BalanceUploadResponse)
def get_balance_summary(session_id: str):
    _assert_session_exists(session_id)
    sdir = _session_dir(session_id)
    p = sdir / "balance_summary.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="No balance uploaded for this session yet")
    return BalanceUploadResponse(**json.loads(p.read_text(encoding="utf-8")))

@app.get("/api/sessions/{session_id}/balance/contracts", response_model=BalanceContractsResponse)
def get_balance_contracts(session_id: str, q: str | None = None, offset: int = 0, limit: int = 200):
    _assert_session_exists(session_id)
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")
    if limit <= 0 or limit > 2000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 2000")

    contracts_raw = _load_or_rebuild_contract_index(session_id)

    filtered = contracts_raw
    if q is not None and q.strip() != "":
        q_norm = q.strip().lower()
        filtered = [
            c
            for c in contracts_raw
            if q_norm in str(c.get("contract_id", "")).lower()
            or q_norm in str(c.get("sheet", "")).lower()
        ]

    total = len(filtered)
    sliced = filtered[offset : offset + limit]
    contracts = [BalanceContract(**item) for item in sliced]

    return BalanceContractsResponse(session_id=session_id, total=total, contracts=contracts)
