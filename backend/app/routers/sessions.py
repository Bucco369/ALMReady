"""Session management routes."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter

import app.state as state
from app.schemas import SessionMeta
from app.session import (
    _assert_session_exists,
    _curves_summary_path,
    _get_session_meta,
    _persist_session_meta,
    _summary_path,
)

router = APIRouter()


@router.post("/api/sessions", response_model=SessionMeta)
def create_session() -> SessionMeta:
    session_id = str(uuid.uuid4())
    meta = SessionMeta(
        session_id=session_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        status="active",
        schema_version="v1",
    )
    state._SESSIONS[session_id] = meta
    _persist_session_meta(meta)
    return meta


@router.get("/api/sessions/{session_id}", response_model=SessionMeta)
def get_session(session_id: str) -> SessionMeta:
    _assert_session_exists(session_id)
    meta = _get_session_meta(session_id)
    meta.has_balance = _summary_path(session_id).exists()
    meta.has_curves = _curves_summary_path(session_id).exists()
    return meta
