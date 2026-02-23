# Performance Optimization Plan: /calculate Endpoint

**Goal**: Reduce /calculate time from ~2:30 back to ≤1:15 (or better).
**Constraint**: Do NOT break the unified cashflow architecture — it's correct.

---

## Current Architecture (Post-Unification)

### How /calculate Works Today

```
/calculate endpoint (backend/app/main.py ~line 2232):

1. SEQUENTIAL: Load motor_positions.json → pd.DataFrame (16,000 rows)
2. SEQUENTIAL: Build ForwardCurveSet from curves_points.json
3. SEQUENTIAL: Build 6 regulatory scenario curve sets
4. SEQUENTIAL: Calibrate margin_set (once, shared with workers)
5. PARALLEL:   Submit 7 unified workers to ProcessPoolExecutor:
               ┌─────────────────────────────────────────────┐
               │ eve_nii_unified() per scenario:              │
               │   a. build_eve_cashflows()    ~15-20s        │
               │   b. compute_eve_full()       ~5-8s          │
               │   c. compute_nii_from_cashflows() ~10-20s    │
               │   TOTAL per worker: ~30-45s                  │
               └─────────────────────────────────────────────┘
6. SEQUENTIAL: Collect results via as_completed(), pivot EVE buckets, label NII monthly
7. SEQUENTIAL: Write chart_data.json, calculation_results.json, calculation_params.json
```

Workers: `backend/almready/workers.py` — `eve_nii_unified()` (line 71)

### What Changed From the Old Architecture

| Old (1:15) | New (2:30) | Impact |
|---|---|---|
| 14 workers: 7×`eve_base` + 7×`nii_base` | 7 workers: 7×`eve_nii_unified` | Fewer workers, more work each |
| EVE: scalar only (no buckets) | EVE: scalar + bucket breakdown inline | **+5-8s per worker** |
| NII: `run_nii_12m_base()` with 8 projectors → scalar only | NII: `compute_nii_from_cashflows()` → scalar + monthly | **+10-20s per worker** |
| Chart data: computed lazily on first GET /chart-data | Chart data: computed inline during /calculate | **Work moved, not duplicated** |
| Lazy chart cost: ~60-120s on GET (user waited again) | Lazy chart cost: 0s (instant GET from cache) | **Better UX overall** |

**Key insight**: The old 1:15 did NOT include chart computation — it was deferred. The new 2:30 includes everything. But we can still optimize the new approach to be much faster.

---

## The Three Functions Inside Each Unified Worker

### A. `build_eve_cashflows()` — `backend/almready/services/eve.py` ~line 1097

Generates all future cashflows (interest + principal) for every position.

- **Algorithm**: Routes positions to 8 type-specific `_extend_*_cashflows()` functions
- **Loop structure**: `for row in positions.itertuples(index=False)` per type → inner loop over coupon/payment dates
- **Output**: DataFrame with columns: contract_id, side, flow_date, interest_amount, principal_amount, total_amount, flow_type, coupon_rate
- **For 16,000 positions**: produces ~76,000 cashflow rows
- **Already optimized**: Uses `itertuples()` (commit 542458a migrated from `iterrows()`)
- **Time**: ~15-20s per worker

**Opportunities**: Limited. The per-position inner loops (generate coupon dates, calculate amortization schedules) are inherently serial. Could benefit from pre-computing shared coupon date schedules for positions with identical terms.

### B. `compute_eve_full()` — `backend/almready/services/eve_analytics.py` line 142

Discounts all cashflows to PV and groups by time bucket.

- **Three `apply()` calls on ~76,000 flows** (lines 180, 196, 199):
  ```python
  work["discount_factor"] = work["flow_date"].apply(lambda d: discount_curve_set.df_on_date(...))  # line 180
  work["t_years"]         = work["flow_date"].apply(lambda d: yearfrac(...))                       # line 196
  work["bucket_name"]     = work["t_years"].apply(lambda t: _assign_bucket_name(...))              # line 199
  ```
- **Problem**: `apply()` invokes Python per-element. Many flows share the same date (e.g., all quarterly coupons on same date), but discount factor is re-computed for each.
- **Then**: `groupby(["bucket_name", "side_group"]).agg(...)` — vectorized, fast
- **Time**: ~5-8s per worker

**Opportunities**:
1. **Cache discount factors by unique date**: ~76,000 flows may have only ~2,000 unique dates → 38x fewer curve lookups
2. **Cache t_years by unique date**: same gain
3. **Vectorize bucket assignment**: `_assign_bucket_name()` is a simple threshold comparison — can be done with `np.searchsorted()` or `pd.cut()` instead of per-element `apply()`

### C. `compute_nii_from_cashflows()` — `backend/almready/services/nii.py` line 929

Derives NII (aggregate + monthly breakdown) from EVE cashflows.

Three components per contract:
- **A. Pre-maturity interest** (line 1022-1036): Reads `interest_amount` from cashflows within horizon, pro-rates to months
- **B. End-of-horizon stub** (line 1038-1107): Computes fractional interest for positions that extend beyond horizon
- **C. Renewal NII** (line 1109-1119): For `balance_constant=True`, computes interest from positions that mature within horizon and are "renewed"

**Critical bottlenecks**:

1. **`iterrows()` at line 1024**:
   ```python
   for _, flow in flows_in_horizon.iterrows():  # SLOW
   ```
   Called on ~50,000+ flows. `iterrows()` is 5-10x slower than `itertuples()`. The same `eve.py` file was already migrated to `itertuples()` in commit 542458a, but this function was written AFTER that commit.

2. **`_prorate_to_months()` at line 539 — always loops 12 months**:
   ```python
   for mi in range(1, horizon_months + 1):  # always 1-12
       m_start = analysis_date + relativedelta(months=mi - 1)
       m_end = analysis_date + relativedelta(months=mi)
       overlap_start = max(period_start, m_start)
       overlap_end = min(period_end, m_end)
       overlap_days = max(0, (overlap_end - overlap_start).days)
       if overlap_days > 0:
           monthly[mi][key] += interest * overlap_days / total_days
   ```
   Called ~60,000+ times (once per flow + once per renewal + once per stub). Each call does 12 `relativedelta()` constructions and date comparisons, even if the period only spans 1-2 months.

3. **`_compute_renewal_nii()` at line 583**: Per-contract while-loops with nested coupon/reset date iterations. Variable annuity renewals are O(resets × payments) per cycle. Called for ~8,000 positions (those maturing within 12m horizon).

4. **No caching of curve lookups**: `curve_set.rate_on_date()` called repeatedly for the same dates across different contracts in renewal computation.

- **Time**: ~10-20s per worker (dominant bottleneck)

---

## Optimization Plan (Ordered by Impact)

### OPT-1: Replace `iterrows()` with `itertuples()` in compute_nii_from_cashflows

**File**: `backend/almready/services/nii.py`, line 1024
**Effort**: 5 minutes
**Expected gain**: 3-6s per worker (5-10x speedup on the inner flow loop)

Change:
```python
# BEFORE (line 1024)
for _, flow in flows_in_horizon.iterrows():
    interest = float(flow["interest_amount"])
    flow_date = flow["flow_date"]

# AFTER
for flow in flows_in_horizon.itertuples(index=False):
    interest = float(flow.interest_amount)
    flow_date = flow.flow_date
```

Also update line 1044 (`flows_in_horizon["principal_amount"].abs().sum()` is fine as-is, it's vectorized).

### OPT-2: Optimize `_prorate_to_months()` with early termination

**File**: `backend/almready/services/nii.py`, lines 539-562
**Effort**: 15 minutes
**Expected gain**: 4-7s per worker (eliminate ~80% of wasted month iterations)

Current: always loops 1..12 even for a 1-month coupon period.
Optimization: Compute the first and last relevant month index, loop only those.

```python
def _prorate_to_months(interest, period_start, period_end, analysis_date, horizon_months, is_asset, monthly):
    if abs(interest) < 1e-16 or period_end <= period_start:
        return
    total_days = (period_end - period_start).days
    if total_days <= 0:
        return
    key = "income" if is_asset else "expense"

    # Compute first and last relevant month indices
    first_mi = max(1, (period_start.year - analysis_date.year) * 12 + period_start.month - analysis_date.month + 1)
    last_mi = min(horizon_months, (period_end.year - analysis_date.year) * 12 + period_end.month - analysis_date.month + 1)

    for mi in range(max(1, first_mi), min(horizon_months, last_mi) + 1):
        m_start = analysis_date + relativedelta(months=mi - 1)
        m_end = analysis_date + relativedelta(months=mi)
        overlap_start = max(period_start, m_start)
        overlap_end = min(period_end, m_end)
        overlap_days = (overlap_end - overlap_start).days
        if overlap_days > 0:
            monthly[mi][key] += interest * overlap_days / total_days
```

Alternatively, pre-compute month boundaries ONCE and pass them in, avoiding repeated `relativedelta()` calls.

### OPT-3: Cache discount factor and yearfrac lookups in `compute_eve_full()`

**File**: `backend/almready/services/eve_analytics.py`, lines 180-201
**Effort**: 20 minutes
**Expected gain**: 2-4s per worker

Replace per-flow `apply()` with cached map by unique date:

```python
# BEFORE (76,000 apply calls)
work["discount_factor"] = work["flow_date"].apply(lambda d: float(discount_curve_set.df_on_date(discount_index, d)))

# AFTER (2,000 unique lookups + vectorized map)
unique_dates = work["flow_date"].unique()
df_cache = {d: float(discount_curve_set.df_on_date(discount_index, d)) for d in unique_dates}
work["discount_factor"] = work["flow_date"].map(df_cache)

# Same for t_years
tyears_cache = {d: max(0.0, float(yearfrac(analysis_date, d, dc_base))) for d in unique_dates}
work["t_years"] = work["flow_date"].map(tyears_cache)
```

For bucket assignment, replace `apply()` with vectorized `pd.cut()` or `np.searchsorted()`:
```python
# BEFORE
work["bucket_name"] = work["t_years"].apply(lambda t: _assign_bucket_name(t, norm_buckets))

# AFTER
boundaries = [b.start_years for b in norm_buckets] + [float('inf')]
labels = [b.name for b in norm_buckets]
work["bucket_name"] = pd.cut(work["t_years"], bins=boundaries, labels=labels, right=False)
```

### OPT-4: Cache curve rate lookups in renewal computation

**File**: `backend/almready/services/nii.py`, within `_compute_renewal_nii()` (line 583+)
**Effort**: 10 minutes
**Expected gain**: 1-2s per worker

`curve_set.rate_on_date()` is called inside renewal while-loops. Many positions mature on similar dates, leading to redundant interpolation.

Add a rate cache at the top of `compute_nii_from_cashflows()`:

```python
_rate_cache: dict[tuple[str, date], float] = {}
def _cached_rate(index_name: str, d: date) -> float:
    key = (index_name, d)
    if key not in _rate_cache:
        _rate_cache[key] = float(curve_set.rate_on_date(index_name, d))
    return _rate_cache[key]
```

Then pass `_cached_rate` into `_compute_renewal_nii()` or replace calls within it.

### OPT-5: Pre-compute month boundaries once

**File**: `backend/almready/services/nii.py`
**Effort**: 10 minutes
**Expected gain**: 1-2s per worker

Currently `_prorate_to_months()` calls `analysis_date + relativedelta(months=mi-1)` and `analysis_date + relativedelta(months=mi)` on every invocation (~60,000 calls × 2 relativedelta = 120,000 date constructions).

Pre-compute once:
```python
month_bounds = [analysis_date + relativedelta(months=i) for i in range(horizon_months + 1)]
# month_bounds[0] = analysis_date, month_bounds[1] = analysis_date + 1M, ..., month_bounds[12] = horizon_end
```

Pass `month_bounds` to `_prorate_to_months()` instead of `analysis_date + horizon_months`.

### OPT-6: Vectorize pre-maturity NII (Section A of compute_nii_from_cashflows)

**File**: `backend/almready/services/nii.py`, lines 987-1036
**Effort**: 30-45 minutes
**Expected gain**: 3-5s per worker (eliminates iterrows + per-flow Python loop for the largest chunk)

The current approach processes each contract's flows one by one via `groupby("contract_id")` + `iterrows()`. The pre-maturity NII computation (Section A) can be largely vectorized:

```python
# Instead of per-contract iteration, batch all contracts:
# 1. Filter cashflows to horizon
cf_horizon = cf[cf["flow_date"] <= horizon_end].copy()

# 2. Map each flow to asset/liability
cf_horizon["is_asset"] = cf_horizon["contract_id"].map(lambda cid: pos_lookup[cid].side.upper() == "A")

# 3. Sum total income/expense vectorized
total_income = cf_horizon.loc[cf_horizon["is_asset"], "interest_amount"].sum()
total_expense = cf_horizon.loc[~cf_horizon["is_asset"], "interest_amount"].sum()

# 4. For monthly pro-rating, assign each flow's interest to months using vectorized date logic
# (This is the harder part — need to handle multi-month coupon periods vectorized)
```

The monthly pro-rating part is harder to fully vectorize because each flow's period spans different months. But the scalar NII totals can be computed instantly via vectorized sums, and the monthly breakdown can use a batched approach.

---

## Estimated Impact

| Optimization | Per Worker | × 7 Workers | Cumulative |
|---|---|---|---|
| Baseline (current) | ~35s | — | 2:30 |
| OPT-1: iterrows → itertuples | -4.5s | -31.5s | ~2:00 |
| OPT-2: _prorate_to_months early exit | -5.5s | -38.5s | ~1:20 |
| OPT-3: Cache discount/yearfrac | -3s | -21s | ~1:00 |
| OPT-4: Cache rate lookups | -1.5s | -10.5s | ~0:50 |
| OPT-5: Pre-compute month bounds | -1.5s | -10.5s | ~0:40 |
| OPT-6: Vectorize pre-maturity NII | -4s | -28s | ~0:30 |

**Note**: Workers run in parallel, so the wall-clock savings depend on the SLOWEST worker. With 7 workers on 8 cores (1 batch), wall-clock ≈ max(worker_times). The per-worker savings translate roughly 1:1 to wall-clock savings.

The parallel overhead (pickle serialization, process scheduling) adds ~2-5s regardless. Sequential pre-work (curve building, margin calibration) adds ~10-15s.

**Realistic target: 45-75 seconds** (down from 150s, equal to or better than old 75s).

---

## File Reference

| File | Lines | What's There |
|---|---|---|
| `backend/app/main.py` | 2232-2515 | /calculate endpoint: worker submission + result collection |
| `backend/app/main.py` | 2704-2955 | /calculate/whatif endpoint: sequential EVE+NII on delta positions |
| `backend/almready/workers.py` | 71-129 | `eve_nii_unified()`: build_cashflows → compute_eve_full → compute_nii_from_cashflows |
| `backend/almready/services/eve.py` | 1097-1212 | `build_eve_cashflows()`: 8 type-specific cashflow generators |
| `backend/almready/services/eve.py` | 239-1095 | `_extend_*_cashflows()`: per-position itertuples + coupon loops |
| `backend/almready/services/eve_analytics.py` | 142-279 | `compute_eve_full()`: 3× apply() + groupby + bucket construction |
| `backend/almready/services/nii.py` | 929-1223 | `compute_nii_from_cashflows()`: groupby contract → iterrows → prorate |
| `backend/almready/services/nii.py` | 539-562 | `_prorate_to_months()`: 12-month unconditional loop, called ~60k+ times |
| `backend/almready/services/nii.py` | 583-926 | `_compute_renewal_nii()`: per-contract while-loops for balance_constant |
| `backend/almready/services/nii.py` | 140-281 | `run_nii_12m_base()`: OLD function (kept for backward compat, not used by unified worker) |
| `backend/almready/services/nii.py` | 352-467 | `build_nii_monthly_profile()`: OLD function (168× run_nii_12m_base calls, replaced) |
| `backend/almready/config/nii_config.py` | 1 | `NII_HORIZON_MONTHS = 12` |

---

## Test Data Profile (Session a400a046)

- **16,000 motor positions** (2,000 per source_contract_type × 8 types)
- **76,694 cashflows** generated by build_eve_cashflows()
- **15 EVE time buckets** (0-1M through 50Y+)
- **Asset PV**: 10,935 Mln | **Liability PV**: -3,892 Mln | **Net EVE**: 7,043 Mln
- **7 scenarios**: base + 6 regulatory (parallel-up/down, steepener, flattener, short-up/down)
- **Motor sides**: 10,643 assets + 5,357 liabilities
- **~53% of positions have maturity before analysis_date** (already matured, generate no cashflows but still processed)

---

## Implementation Order

1. **OPT-1** (iterrows → itertuples) — trivial, zero risk, high impact
2. **OPT-2** (_prorate_to_months early exit) — moderate, highest single-optimization impact
3. **OPT-5** (pre-compute month boundaries) — trivial, pairs with OPT-2
4. **OPT-3** (cache discount/yearfrac) — moderate, clear win
5. **OPT-4** (cache rate lookups) — easy, moderate win
6. **OPT-6** (vectorize pre-maturity NII) — most complex, biggest structural change

After each optimization, run the test suite:
```bash
cd backend && python -m pytest almready/tests/ -x -q
```

All 48 passing tests should remain passing (1 pre-existing failure: `test_run_nii_12m_base_raises_for_unimplemented_source_type`).

---

## What-If Endpoint Bonus

The `/calculate/whatif` endpoint (line 2704) runs `_unified_whatif_map()` **sequentially in the main thread** (no ProcessPoolExecutor). All the same optimizations apply, and additionally:

- **Opportunity**: Submit What-If computation to the ProcessPoolExecutor instead of running in main thread
- **Opportunity**: Skip matured positions (maturity_date < analysis_date) early — they contribute zero EVE/NII delta but still go through cashflow generation

---

## What NOT to Change

- **Do NOT revert to separate EVE/NII workers** — the unified approach is architecturally correct
- **Do NOT remove the inline chart data computation** — the lazy GET was a worse UX
- **Do NOT add caching across scenarios** — each scenario uses different curves, so cashflows differ
- **Do NOT add multiprocessing to the What-If endpoint** unless the sequential path is still too slow after optimizations (currently only runs on delta positions, which are much smaller than full portfolio)
