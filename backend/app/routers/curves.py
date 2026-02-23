"""Curves upload, summary, points, and delete routes."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.schemas import CurvePointsResponse, CurvesSummaryResponse
from app.session import (
    _assert_session_exists,
    _calc_params_path,
    _curves_points_path,
    _curves_summary_path,
    _results_path,
    _session_dir,
)
from app.parsers.curves_parser import (
    _load_or_rebuild_curve_points,
    _load_or_rebuild_curves_summary,
    _parse_and_store_curves,
)

router = APIRouter()


@router.delete("/api/sessions/{session_id}/curves")
def delete_curves(session_id: str) -> dict[str, str]:
    _assert_session_exists(session_id)
    sdir = _session_dir(session_id)
    deleted: list[str] = []
    for p in [_curves_summary_path(session_id), _curves_points_path(session_id)]:
        if p.exists():
            p.unlink()
            deleted.append(p.name)
    for p in sdir.iterdir():
        if p.is_file() and p.name.startswith("curves__"):
            p.unlink()
            deleted.append(p.name)
    for p in [_results_path(session_id), _calc_params_path(session_id)]:
        if p.exists():
            p.unlink()
            deleted.append(p.name)
    return {"status": "ok", "deleted": ", ".join(deleted) if deleted else "nothing to delete"}


@router.post("/api/sessions/{session_id}/curves", response_model=CurvesSummaryResponse)
async def upload_curves(session_id: str, file: UploadFile = File(...)) -> CurvesSummaryResponse:
    _assert_session_exists(session_id)

    raw_filename = file.filename or "curves.xlsx"
    if not raw_filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only .xlsx/.xls files are supported")

    safe_filename = Path(raw_filename).name
    storage_name = f"curves__{safe_filename}"

    sdir = _session_dir(session_id)
    xlsx_path = sdir / storage_name
    content = await file.read()
    xlsx_path.write_bytes(content)

    return _parse_and_store_curves(session_id, filename=safe_filename, xlsx_path=xlsx_path)


@router.get("/api/sessions/{session_id}/curves/summary", response_model=CurvesSummaryResponse)
def get_curves_summary(session_id: str) -> CurvesSummaryResponse:
    _assert_session_exists(session_id)
    return _load_or_rebuild_curves_summary(session_id)


@router.get("/api/sessions/{session_id}/curves/{curve_id}", response_model=CurvePointsResponse)
def get_curve_points(session_id: str, curve_id: str) -> CurvePointsResponse:
    _assert_session_exists(session_id)
    points_by_curve = _load_or_rebuild_curve_points(session_id)
    points = points_by_curve.get(curve_id)
    if points is None:
        raise HTTPException(status_code=404, detail=f"Curve '{curve_id}' not found for this session")

    return CurvePointsResponse(session_id=session_id, curve_id=curve_id, points=points)
