# Future Changes

---

## Session Storage Growth

### Current Behavior
- Sessions live in `backend/data/sessions/{uuid}/`
- Per-session storage: ~100MB (two Parquets + JSONs)
- TTL configurable via `SESSION_TTL_DAYS` env var (default: 7 days)
- Cleanup runs at startup + every 6 hours via background task
- Extracted CSVs and uploaded ZIP are deleted immediately after parsing

### Implemented
- **Post-parse cleanup**: CSVs + ZIP deleted after successful parsing (`balance_parser.py`)
- **Configurable TTL**: `SESSION_TTL_DAYS` environment variable (`main.py`)
- **Periodic cleanup**: Background `asyncio` task runs every 6h (`main.py`)
- **DataFrame cache invalidation**: Stale sessions evicted from in-memory cache during cleanup

### Remaining Improvements
1. **LRU-style expiration**: Add `last_accessed_at` to `SessionMeta`, update it on every API call, and clean up based on inactivity rather than creation date
2. **Disk budget**: Set a max total storage limit (e.g., 2GB) and evict oldest sessions when exceeded

### Long-Term (Multi-User / Production)
3. **Per-user session isolation**: Tie sessions to authenticated users so cleanup is scoped
4. **Object storage**: Move large files (Parquets, uploads) to S3/GCS with signed URLs, keeping only metadata on local disk
5. **Database-backed sessions**: Replace file-based sessions with a proper DB (PostgreSQL) for metadata + S3 for blobs

---

## NII Monthly Pro-Rating Approximation

### Current Behavior

The NII engine uses **day-proportional pro-rating** (`nii.py:1100-1131`, `_prorate_to_months` at `nii.py:554`) to allocate coupon interest across calendar months. For each cashflow, the total interest amount is spread across months based on the number of accrual days that fall in each month:

```python
contrib = interest * overlap_days / total_days
```

This is exact for **fixed-rate** instruments (interest accrues linearly over the period).

### Known Approximation for Variable Instruments

For variable instruments where the coupon period contains multiple rate reset segments (e.g., a variable bullet with annual coupons and monthly resets), the EVE cashflow engine accumulates all segment interest into a single `interest_amount` at the payment date (`eve.py:647`). The NII pro-rating then spreads this blended total evenly (by day count) across the months of the coupon period.

**Example:** A quarterly coupon with monthly resets where rates are 2%, 3%, 4% across the three months. The total coupon is the sum of three different interest amounts, but NII pro-rating allocates 1/3 (by days) to each month — as if the rate were uniform.

**Impact:** The 12-month aggregate NII is **exactly correct** (all interest is accounted for). Only the month-by-month breakdown is approximate for instruments where payment frequency > reset frequency.

**Why this is acceptable:**
1. The EBA NII SOT cares about the **12-month aggregate**, not the month-by-month split
2. The monthly breakdown is for management reporting, where this approximation is industry-standard
3. For the most common case (monthly payments = monthly resets), the pro-rating is exact
4. Instruments where this matters (annual/semi-annual coupons with monthly resets) are relatively rare in retail banking portfolios

### Future Fix (if needed)

To produce exact monthly NII for these instruments, the NII engine would need per-reset-segment interest amounts (not just the accumulated total per payment date). Two approaches:

1. **Emit per-segment cashflows from EVE**: Change `build_eve_cashflows` to output one record per reset segment instead of accumulating. This multiplies output records for variable instruments (e.g., 10 → 120 for a 10Y variable bullet with monthly resets) and increases memory proportionally.

2. **NII-specific re-derivation**: Keep EVE cashflows as-is but have the NII engine re-derive per-month interest by querying forward rates from the curve set for each reset date. This is what Sections B (stub) and C (renewal) already do — extend the same pattern to Section A (pre-maturity).

Option 2 is preferred (no memory impact, matches the existing Section B/C pattern). Would be implemented as part of the Rust engine (Step 4 of the Engine Overhaul Plan) where the per-month curve lookup cost is negligible.

---

## Multi-User Server Mode

### When to consider

The current ALMReady desktop app is a single-user installation. Each analyst installs it on their workstation and works with their own sessions and data.

Consider switching to server mode when:

- Multiple analysts in the same bank need to **share sessions** (e.g. one person uploads the balance sheet, another runs scenarios, a manager reviews results).
- The bank's IT policy makes per-machine installation impractical and they prefer running software on a central internal server.
- An external client needs **multi-tenant** access with per-user data isolation.

### Architecture

```
Bank internal network
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   Analysts' browsers ──► nginx (port 443)               │
│                              │                          │
│                              ├──► React SPA (static)    │
│                              │                          │
│                              └──► FastAPI backend       │
│                                        │                │
│                                        └──► Sessions FS │
│                                             (or Postgres)│
└─────────────────────────────────────────────────────────┘
```

Deployed via `docker-compose` on a single server the bank controls. No public internet exposure required.

### What needs to change in the codebase

#### 1. Authentication layer (~2 days)

The backend currently has no auth. Add JWT-based auth using `fastapi-users` or a custom implementation:

- `POST /api/auth/login` — accepts username + password, returns a JWT
- `GET /api/auth/me` — returns current user info
- All existing `/api/sessions/*` endpoints require a valid JWT in the `Authorization: Bearer {token}` header

Library recommendation: `fastapi-users[sqlalchemy]>=13` with SQLite for simplicity, or PostgreSQL for production.

#### 2. User-scoped sessions (~1 day)

Add `user_id: str` to `SessionMeta` (Pydantic model + disk serialisation).

In every session endpoint that lists or creates sessions, filter by the `user_id` extracted from the JWT. The session directory structure becomes:

```
sessions/
  {user_id}/
    {session_uuid}/
      meta.json
      balance_positions.parquet
      ...
```

No changes to the calculation engine or balance/curves parsers.

#### 3. Frontend auth (~1 day)

- Add a login page (`src/pages/Login.tsx`) with username + password form.
- Store the JWT in `localStorage` (or `sessionStorage` for stricter security).
- Add an auth context / hook that gates access to the main app.
- Add the `Authorization` header to every `http()` / `xhrUpload()` call in `src/lib/api.ts`.
- Redirect to `/login` on 401 responses.

#### 4. CORS

Change `ALMREADY_CORS_ORIGINS` (or the hardcoded CORS list in `main.py`) to allow the server's actual domain (e.g. `https://alm.bankname.internal`). Remove the Tauri-specific origins from server deployments.

#### 5. Data directory

`ALMREADY_DATA_DIR` will point to a Docker volume mount, e.g. `/data/almready/sessions`. No code changes required — just configure the environment variable in `docker-compose.yml`.

### docker-compose.yml (sketch)

```yaml
version: "3.9"
services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    environment:
      ALMREADY_DATA_DIR: /data/sessions
      SESSION_TTL_DAYS: "30"
    volumes:
      - sessions_data:/data/sessions
    expose:
      - "8000"

  frontend:
    build:
      context: .
      dockerfile: Dockerfile.frontend
    expose:
      - "80"

  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - backend
      - frontend

volumes:
  sessions_data:
```

### Dockerfiles

**Backend:**
```dockerfile
FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Frontend:**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
```

### Estimated effort

| Task | Days |
|------|------|
| Auth backend (JWT + user model) | 2 |
| User-scoped sessions | 1 |
| Frontend login page + JWT handling | 1 |
| Docker + nginx config | 0.5 |
| Testing + QA | 1 |
| **Total** | **~5.5 days** |

This assumes the core calculation engine and API contract are frozen. No changes to `engine/` or the balance/curves parsers are needed.

### Deployment considerations for bank IT

- The bank provides an internal hostname + TLS certificate.
- Docker Desktop or Docker Engine must be installed on the server machine.
- Sessions volume should be on a network drive if HA/backup is required.
- No outbound internet access is required — all images can be built and loaded offline.
- Updates: replace the container images and run `docker-compose up -d`.
