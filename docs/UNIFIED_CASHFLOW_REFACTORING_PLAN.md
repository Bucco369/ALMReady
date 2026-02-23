# Unified Cashflow Engine Refactoring Plan

## Date: 2026-02-22

---

## 1. PROBLEM STATEMENT

The ALMReady calculation engine computes EVE (Economic Value of Equity) and NII (Net Interest Income) using **two completely separate computation paths** that duplicate work:

- **EVE path**: `build_eve_cashflows()` generates per-instrument, per-date cashflows with separate `interest_amount` and `principal_amount`. These are then discounted to present value.
- **NII path**: 8 separate projector functions (`project_fixed_bullet_nii_12m`, etc.) compute interest accrual using `yearfrac()` — essentially re-deriving the same interest amounts that EVE already computed.

Additionally, NII's monthly breakdown (`build_nii_monthly_profile`) calls `run_nii_12m_base()` **24 times** (12 months x 2 sides) with increasing horizons and takes cumulative differences — a correct but absurdly inefficient approach.

The result: the base `/calculate` endpoint computes EVE and NII aggregates efficiently (parallel workers), but chart data (per-bucket EVE + per-month NII) requires a separate lazy GET request that recomputes everything from scratch.

### Current architecture:

```
/calculate endpoint:
├── build_eve_cashflows() → evaluate_eve_exact() → scalar EVE       [per scenario, parallel]
├── NII projectors → run_nii_12m_base() → scalar NII               [per scenario, parallel]
└── Saves aggregate results only. Chart cache invalidated.

GET /chart-data (lazy, first request after /calculate):
├── build_eve_cashflows() AGAIN → discount → assign buckets → DataFrame   [sequential]
└── 24 × run_nii_12m_base() → cumulative differencing → monthly NII       [sequential]
```

### What it should be:

```
/calculate endpoint:
├── build_eve_cashflows() ONCE per scenario
├── From those cashflows:
│   ├── EVE: discount all flows → aggregate + per-bucket (one pass)
│   └── NII: filter to horizon → sum interest + stubs + renewals → aggregate + per-month
└── Saves EVERYTHING (aggregates + chart data). No lazy GET needed.
```

---

## 2. KEY FINDING: EVE AND NII MEASURE DIFFERENT THINGS

### EVE = Discrete payment cashflows
- Interest is recorded on **payment dates** (coupon dates)
- A quarterly coupon on Mar 31 contains the entire Jan-Mar interest accrual
- Flows go to **maturity** (full instrument lifetime)
- Used for **present value** calculation (discount each flow)
- NO concept of balance_constant or renewals

### NII = Continuous accrual-based income
- Interest is measured as **earned/owed per time period** (proportional to days elapsed)
- For monthly charts, each month gets its proportional share of interest
- Limited to a **configurable horizon** (default 12 months)
- Includes **balance_constant renewals** (positions maturing within horizon are re-invested)
- NO discounting (nominal interest amounts, not PV)

### BUT: They share the same underlying computation
Both compute: `balance × rate × yearfrac(period_start, period_end)` for each instrument.

- EVE computes this for each coupon period and records it on the payment date
- NII computes this for the full horizon (or each month) as one continuous chunk

For any **complete coupon period**, both give the **exact same interest amount**. The difference only appears:
1. When splitting a coupon period across months (pro-rating needed for NII charts)
2. For renewals after maturity (NII-only concept)
3. For end-of-horizon stubs (interest accrued but not yet paid)

---

## 3. THE USER'S INSIGHT (CONFIRMED CORRECT)

> "There is only a single cash flow profile for each instrument, divided into principal and interest. I only see there's one time where we have to project those cash flows, and then we just have to either discount them or sum them up."

This is architecturally correct and aligns with industry-standard ALM engine design:

1. **ONE cashflow engine** generates all flows per instrument (already exists: `build_eve_cashflows()`)
2. **EVE module** consumes ALL flows: discount to PV, assign to maturity buckets
3. **NII module** consumes flows within horizon: sum interest, handle stubs & renewals
4. **Charts** are different groupby operations on the same computed data

### The three special cases for NII from EVE cashflows:

**A. Start stub**: If `analysis_date` falls mid-coupon-period, the first EVE cashflow already handles this correctly (it computes interest from `analysis_date` to first coupon using `accrual_start = max(prev_coupon, analysis_date)`).

**B. End-of-horizon stub**: The last coupon within the horizon may not align with `horizon_end`. Interest accrues between the last coupon and `horizon_end` but hasn't been paid yet. This needs a separate small computation: `balance × rate × yearfrac(last_coupon, horizon_end)`.

**C. Renewals (balance_constant=True)**: Positions maturing before `horizon_end` are "renewed" at `risk_free_rate + original_margin`. EVE has zero awareness of this. A lightweight renewal pass is needed for these positions only.

---

## 4. NII HORIZON AS A CONFIGURABLE HYPERPARAMETER

### Current state:
- `horizon_months` IS already a parameter in all NII functions (default=12)
- BUT it's **hardcoded to 12** at the API layer:
  - `main.py` lines 2346, 2352: `_workers.nii_base(..., 12, ...)`
  - `nii_pipeline.py` line 139: `months=12`
  - `nii.py` line 495: `max(12, int(months))` enforces minimum of 12

### Target state:
- Define `NII_HORIZON_MONTHS = 12` as a module-level constant in a config file
- All hardcoded `12` values reference this constant
- The constant can be changed in one place to affect the entire engine
- The `max(12, ...)` constraint in `nii.py` line 495 should be removed or made configurable

### Implementation:
- Create or use existing `backend/almready/config/` directory
- Add `nii_config.py` with `NII_HORIZON_MONTHS = 12`
- Update `main.py`, `nii_pipeline.py`, `nii.py` to import and use this constant
- Store in `calculation_params.json` so What-If reuses the same horizon

---

## 5. DETAILED IMPLEMENTATION PLAN

### Phase 0: NII Horizon Hyperparameter
**Scope**: Small, safe, no logic changes. Do this first.

#### Step 0.1: Create NII config
- **File**: `backend/almready/config/nii_config.py` (new)
- **Content**:
  ```python
  """NII calculation hyperparameters."""
  # Default horizon for Net Interest Income projection (months).
  # EBA GL/2022/14 prescribes 12 months; configurable for internal analysis.
  NII_HORIZON_MONTHS: int = 12
  ```

#### Step 0.2: Update main.py
- **File**: `backend/app/main.py`
- **Lines 2346, 2352**: Replace hardcoded `12` with imported `NII_HORIZON_MONTHS`
- **Lines 2838, 3024** (What-If): Same replacement
- **Store in calc_params**: Add `"nii_horizon_months": NII_HORIZON_MONTHS` to the calc_params dict (line ~2466) so it persists

#### Step 0.3: Update nii.py
- **File**: `backend/almready/services/nii.py`
- **Line 495**: Remove `max(12, int(months))` → just use `int(months)`
- **All function defaults**: Change `horizon_months: int = 12` to import from config

#### Step 0.4: Update nii_pipeline.py
- **File**: `backend/almready/services/nii_pipeline.py`
- **Line 139**: Replace `months=12` with imported constant

#### Step 0.5: Verification
- Run existing tests: `python -m pytest backend/almready/tests/test_nii_monthly_profile.py -v`
- Verify all tests still pass with NII_HORIZON_MONTHS = 12

---

### Phase 1: Unified EVE Computation (aggregate + buckets in one pass)
**Scope**: Moderate. Eliminates duplicate `build_eve_cashflows()` calls for EVE.

#### Step 1.1: Create unified EVE function
- **File**: `backend/almready/services/eve_analytics.py` (modify existing)
- **New function**: `compute_eve_full(positions, discount_curve_set, projection_curve_set, discount_index, buckets=None)`
- **Logic**:
  1. Call `build_eve_cashflows()` ONCE
  2. Compute discount factors for every flow: `df = df_on_date(discount_index, flow_date)`
  3. Compute `pv_total = total_amount × df` per flow
  4. **Aggregate EVE**: `sum(pv_total)` → scalar
  5. **If buckets requested**: assign `t_years = yearfrac(analysis_date, flow_date)`, assign bucket names, groupby (bucket, side_group) → per-bucket breakdown
  6. Return `(scalar_eve, bucket_breakdown_df_or_None)`
- **Key insight**: Steps 4 and 5 operate on the SAME discounted cashflow DataFrame. Zero redundancy.

#### Step 1.2: Create new worker function
- **File**: `backend/almready/workers.py`
- **New function**: `eve_full(positions, discount_curve_set, projection_curve_set, discount_index, method, include_buckets=False)`
- Calls `compute_eve_full()` and returns `(scalar_eve, bucket_data_serialized_or_None)`
- Note: bucket data must be serializable for inter-process communication (list of dicts, not DataFrame)

#### Step 1.3: Update /calculate endpoint
- **File**: `backend/app/main.py`
- **Change EVE worker submissions** (~line 2330): Use `eve_full` with `include_buckets=True`
- **Collect results**: Each future now returns `(scalar, bucket_list)` instead of just `scalar`
- **Save chart data**: After collecting all scenario results, build the `ChartDataResponse.eve_buckets` list directly from bucket data
- **No separate GET computation needed for EVE charts anymore**

#### Step 1.4: Update chart-data GET endpoint
- **File**: `backend/app/main.py`
- **Modify** `get_chart_data()` (~line 2923): If cached chart data exists, return it (as before). If not, only compute NII monthly (EVE is always pre-computed now)
- In Phase 2, NII will also be pre-computed, and the GET endpoint can be fully removed or simplified to just read from cache

#### Step 1.5: Verification
- `python -m pytest backend/almready/tests/test_eve_engine.py -v` — existing EVE tests
- Compare: `compute_eve_full()` scalar output must match `run_eve_base()` output for same inputs
- Compare: `compute_eve_full()` bucket output must match `build_eve_bucket_breakdown_exact()` output
- Add a test: `test_eve_full_matches_separate.py` that runs both old and new paths and asserts equality

---

### Phase 2: NII from EVE Cashflows (the core refactoring)
**Scope**: Large, architecturally significant. This is the heart of the refactoring.

#### Understanding: What needs to happen

For each scenario, given the EVE cashflow DataFrame (already generated in Phase 1), compute NII:

```
EVE cashflows (already have):
  flow_date | interest_amount | principal_amount | contract_id | side | ...

NII computation:
  1. Filter to flows within [analysis_date, horizon_end]
  2. Sum interest_amount → pre-maturity NII for coupon-aligned periods
  3. Add end-of-horizon stub interest for each contract
  4. Add renewal interest for balance_constant positions maturing within horizon
  5. Group by month for monthly breakdown (pro-rate coupon interest across months)
```

#### Step 2.1: Create NII-from-cashflows function
- **File**: `backend/almready/services/nii.py` (add new function)
- **New function**: `compute_nii_from_cashflows(cashflows_df, positions_df, curve_set, *, horizon_months, balance_constant, margin_set, risk_free_index)`
- **Parameters**:
  - `cashflows_df`: Output of `build_eve_cashflows()` — has flow_date, interest_amount, principal_amount, contract_id, side
  - `positions_df`: Original positions DataFrame — needed for renewal parameters (notional, rate, maturity, etc.)
  - `curve_set`: Forward curve set for the scenario (needed for renewal rate computation)
  - `horizon_months`: Configurable horizon (from NII_HORIZON_MONTHS)
  - `balance_constant`: Whether to model renewals
  - `margin_set`: Calibrated margin set for renewal rate determination
  - `risk_free_index`: Index for renewal rate computation

- **Returns**: `NiiFromCashflowsResult` (new dataclass):
  ```python
  @dataclass
  class NiiFromCashflowsResult:
      aggregate_nii: float              # Total NII over horizon
      asset_nii: float                  # Total interest income (assets only)
      liability_nii: float              # Total interest expense (liabilities only)
      monthly_breakdown: list[dict]     # Per-month: {month_index, month_label, interest_income, interest_expense, net_nii}
  ```

#### Step 2.2: Implement the NII-from-cashflows logic

The function has 4 sub-steps:

**Sub-step A: Filter and sum coupon interest within horizon**
```python
horizon_end = analysis_date + relativedelta(months=horizon_months)

# Filter cashflows to horizon
in_horizon = cashflows_df[cashflows_df["flow_date"] <= horizon_end].copy()

# Separate by side
asset_flows = in_horizon[in_horizon["side"].str.upper() == "A"]
liability_flows = in_horizon[in_horizon["side"].str.upper() == "L"]

# Sum interest (signs already applied by build_eve_cashflows: A=+1, L=-1)
coupon_income = asset_flows["interest_amount"].sum()    # positive
coupon_expense = liability_flows["interest_amount"].sum()  # negative
```

**Sub-step B: Compute end-of-horizon stubs**

For each contract, check if there's a coupon AFTER horizon_end that has not been captured:
```python
# For each contract, find the last flow_date within horizon
# and the next flow_date after horizon (if any)
# The stub = interest accrued from last_flow_within_horizon to horizon_end
# This requires knowing the contract's rate and daycount basis
# Use positions_df to look up rate, daycount for each contract_id
```

Implementation detail:
- Group cashflows by contract_id
- For each contract: find max(flow_date) within horizon → `last_coupon`
- If `last_coupon < horizon_end`: compute stub = `notional × rate × yearfrac(last_coupon, horizon_end)`
- For variable-rate instruments: use forward rate at `last_coupon` from curve_set
- For annuities: use the remaining balance at `last_coupon` (derived from cumulative principal flows)
- Add stub to income or expense based on side
- **For monthly allocation**: the stub interest is allocated across the months it spans (last_coupon → horizon_end) proportionally by days, NOT dumped into a single month. This ensures smooth monthly NII consistent with accrual accounting (EBA GL/2022/14, IFRS 9).

**Sub-step C: Compute renewal interest (balance_constant=True only)**

For positions where `maturity_date < horizon_end`:
```python
# Extract renewal candidates from positions_df
renewal_candidates = positions_df[positions_df["maturity_date"] < horizon_end]

# For each renewal candidate:
#   1. Determine renewal rate: risk_free_rate(maturity_date) + original_margin
#   2. Compute renewal interest: notional × renewal_rate × yearfrac(maturity_date, min(next_maturity, horizon_end))
#   3. If multiple renewal cycles fit within horizon, loop

# This reuses the EXISTING renewal logic from nii_projectors.py
# We can extract it into a standalone function to avoid duplication
```

Note: The existing renewal logic in `nii_projectors.py` (e.g., lines 838-860 for fixed_bullet) is well-tested. We should extract it into a reusable helper rather than rewriting it.

**Sub-step D: Monthly pro-rating**

For monthly NII charts, pro-rate each coupon's interest across the months of its accrual period:
```python
# For each flow in cashflows_df within horizon:
#   - Determine accrual_period: (prev_coupon_date, flow_date)
#   - For each calendar month overlapping the accrual period:
#       - Compute overlap_days / total_accrual_days
#       - Assign proportional interest to that month

# For stubs and renewals, assign to the appropriate months directly
```

This is a lightweight DataFrame operation — no discounting, no cashflow generation, just date arithmetic and proportional allocation.

#### Step 2.3: Handle the annuity complication

For amortizing instruments (fixed_annuity, variable_annuity, fixed_linear, variable_linear):
- The balance **decreases** after each payment
- EVE cashflows already account for this: each `interest_amount` reflects the actual balance at that point
- So summing EVE interest amounts within the horizon gives the correct total NII
- For end stubs: need to know the balance at the last coupon date. This can be derived from the principal flows in the EVE cashflows: `current_balance = original_notional - sum(principal_flows_to_date)`
- For renewals: amortizing instruments renew with the original notional (fresh loan)

**No special handling needed** — EVE cashflows already contain the correct interest amounts for declining balances.

#### Step 2.4: Handle the variable-rate complication

For variable-rate instruments (variable_bullet, variable_annuity, variable_linear, variable_scheduled):
- EVE cashflows already project forward rates at each reset date
- Interest amounts already reflect the projected rates
- So summing EVE interest within horizon gives correct NII for the pre-maturity period
- For end stubs: use the forward rate at the stub start date
- For renewals: use risk_free_rate + original_spread at each renewal reset

**No special handling needed for pre-maturity** — EVE cashflows handle rate resets correctly. Only renewals and stubs need rate lookups.

#### Step 2.5: Create new unified worker function
- **File**: `backend/almready/workers.py`
- **New function**: `eve_nii_unified(positions, discount_curve_set, projection_curve_set, discount_index, horizon_months, balance_constant, margin_set, risk_free_index)`
- **Logic**:
  1. Call `build_eve_cashflows()` once
  2. Call `compute_eve_full()` with the cashflows → (scalar_eve, bucket_breakdown)
  3. Call `compute_nii_from_cashflows()` with the same cashflows → NiiFromCashflowsResult
  4. Return all results as a serializable dict

#### Step 2.6: Update /calculate endpoint
- **File**: `backend/app/main.py`
- **Replace** separate EVE and NII worker submissions with unified `eve_nii_unified` workers
- **Each scenario** now produces: (eve_scalar, eve_buckets, nii_scalar, nii_monthly) from a SINGLE worker call
- **Save chart data**: Both EVE bucket data and NII monthly data are available immediately
- **Write chart_data.json** inline — no lazy computation needed
- **Remove or simplify** GET `/chart-data` endpoint (can just serve the cached file)

#### Step 2.7: Update What-If endpoint
- **File**: `backend/app/main.py`
- The What-If endpoint already uses `build_eve_bucket_breakdown_exact` and `build_nii_monthly_profile` on delta positions only
- Replace with the unified approach: `build_eve_cashflows(delta_positions)` once per scenario, then derive both EVE and NII deltas
- The renewal logic for What-If: What-If "add" positions have synthetic maturity dates. If they mature within horizon, renewal logic applies. For "remove" positions, their renewal contribution is removed.

#### Step 2.8: Verification
- **Unit tests**:
  - `test_nii_from_cashflows.py` (new): Verify `compute_nii_from_cashflows()` matches `run_nii_12m_base()` for same inputs, for all instrument types
  - `test_unified_worker.py` (new): Verify `eve_nii_unified` returns same EVE and NII as separate workers
  - Existing tests must still pass
- **Integration test**:
  - Upload a balance → /calculate → compare aggregate EVE/NII with previous implementation
  - Compare chart data (per-bucket EVE, per-month NII) with previous implementation
  - Apply What-If → compare deltas
- **Numerical tolerance**: Allow 1e-6 relative error for floating-point differences due to operation ordering

---

### Phase 3: Cleanup and Optimization
**Scope**: Small. Remove dead code and optimize remaining paths.

#### Step 3.1: Remove redundant NII projector calls from main path
- The 8 individual projector functions (`project_fixed_bullet_nii_12m`, etc.) are no longer called from the main `/calculate` path
- They remain available for:
  - Renewal computation (the renewal loop logic should be extracted into helpers)
  - Direct testing
  - Backward compatibility
- Do NOT delete them — they serve as reference implementations and are used by tests

#### Step 3.2: Simplify or remove lazy GET /chart-data endpoint
- If Phase 2 stores chart data inline during `/calculate`, the GET endpoint can be simplified to:
  ```python
  @app.get("/api/sessions/{session_id}/results/chart-data")
  def get_chart_data(session_id: str):
      cache_path = _chart_data_path(session_id)
      if not cache_path.exists():
          raise HTTPException(404, "No chart data. Run /calculate first.")
      return ChartDataResponse.model_validate_json(cache_path.read_text())
  ```
- No more on-demand computation — just serve the cached file

#### Step 3.3: Remove build_nii_monthly_profile's 24-call loop
- Once `compute_nii_from_cashflows` is the primary path, the old `build_nii_monthly_profile` can be deprecated
- Keep it in the codebase (with a deprecation comment) for reference until fully validated
- Remove imports of `run_nii_12m_scenarios` from main.py (already done in What-If, extend to main calc)

#### Step 3.4: Performance profiling
- Time the new unified path vs the old separate paths
- Expected improvement:
  - EVE: ~2x faster (one `build_eve_cashflows` call instead of two per scenario)
  - NII monthly: ~24x faster (one pass instead of 24 cumulative calls)
  - Chart data: instant (pre-computed during /calculate, no lazy GET)
  - Overall /calculate: slightly slower per-worker (each worker now does more), but eliminates the entire GET /chart-data computation

---

## 6. FILE-BY-FILE CHANGE SUMMARY

| File | Phase | Changes |
|------|-------|---------|
| `almready/config/nii_config.py` | 0 | **NEW**: NII_HORIZON_MONTHS constant |
| `almready/services/nii.py` | 0,2 | Import config constant; add `compute_nii_from_cashflows()` |
| `almready/services/nii_projectors.py` | 2 | Extract renewal logic into reusable helpers |
| `almready/services/nii_pipeline.py` | 0 | Import config constant |
| `almready/services/eve_analytics.py` | 1 | Add `compute_eve_full()` |
| `almready/services/eve.py` | — | No changes (build_eve_cashflows unchanged) |
| `almready/workers.py` | 1,2 | Add `eve_full()`, then `eve_nii_unified()` |
| `app/main.py` | 0,1,2,3 | Import config; update worker calls; inline chart data; simplify GET |
| Tests | 1,2 | New test files for unified functions |

---

## 7. RISK ASSESSMENT

### Low risk:
- Phase 0 (config constant): No logic changes, just indirection
- Phase 3 (cleanup): Removing dead code paths

### Medium risk:
- Phase 1 (unified EVE): Well-understood computation, just restructuring. Existing tests cover correctness.

### Higher risk (requires careful testing):
- Phase 2 (NII from cashflows): This changes HOW NII is computed. The three special cases (stubs, renewals, monthly pro-rating) each need careful implementation:
  - **End stubs**: Must correctly identify the last coupon within horizon for each contract. Must handle instruments with different payment frequencies.
  - **Renewals**: Must exactly replicate the existing renewal logic (rate = risk_free + margin, loop through renewal cycles). Test against existing projector output.
  - **Monthly pro-rating**: New logic. Needs to handle: stub periods, full coupon periods, coupon periods spanning month boundaries.
  - **Annuity balance tracking**: Must correctly determine the outstanding balance at any point using cumulative principal flows from EVE cashflows.

### Mitigation:
- Implement Phase 2 incrementally: first get aggregate NII correct, then add monthly breakdown
- Keep old NII code available for comparison testing
- Run both old and new paths in parallel during development, assert numerical equality

---

## 8. TESTING STRATEGY

### Unit Tests (per phase):

**Phase 0:**
- Import NII_HORIZON_MONTHS from config, verify it equals 12
- Run existing NII tests with the constant

**Phase 1:**
- `test_compute_eve_full()`: Compare scalar output with `run_eve_base()` for fixed bullet, fixed annuity, variable bullet, variable annuity
- `test_compute_eve_full_buckets()`: Compare bucket output with `build_eve_bucket_breakdown_exact()`
- Test with multiple scenarios (base + 6 regulatory shocks)

**Phase 2:**
- `test_nii_from_cashflows_fixed_bullet()`: Single fixed bullet, compare aggregate NII with `project_fixed_bullet_nii_12m()`
- `test_nii_from_cashflows_fixed_annuity()`: Single fixed annuity, verify declining balance handled correctly
- `test_nii_from_cashflows_variable_bullet()`: Single variable bullet with rate resets, compare with `project_variable_bullet_nii_12m()`
- `test_nii_from_cashflows_renewal()`: Fixed bullet maturing at 6 months, balance_constant=True, verify renewal interest matches projector
- `test_nii_from_cashflows_end_stub()`: Instrument with coupon after horizon end, verify stub accrual
- `test_nii_from_cashflows_monthly()`: Verify monthly breakdown sums to aggregate
- `test_nii_from_cashflows_portfolio()`: Full portfolio (mixed instruments), compare with `run_nii_12m_base()`
- `test_nii_from_cashflows_scenarios()`: Multiple scenarios, compare with `run_nii_12m_scenarios()`

### Integration Tests:
- Upload test balance → /calculate → compare all outputs with previous implementation
- Apply What-If (add + remove) → compare deltas
- Verify frontend renders correctly (charts, summary tables)

### Regression safeguard:
- Before starting, capture the current outputs for a reference portfolio:
  - Base EVE, worst EVE, all scenario EVEs
  - Base NII, worst NII, all scenario NIIs
  - Per-bucket EVE breakdown (all scenarios)
  - Per-month NII breakdown (all scenarios)
- After each phase, verify all outputs match within tolerance (1e-6 relative)

---

## 9. IMPLEMENTATION ORDER AND DEPENDENCIES

```
Phase 0: NII Horizon Config
    ↓ (no dependency, can be done first)
Phase 1: Unified EVE (aggregate + buckets)
    ↓ (provides build_eve_cashflows output for Phase 2)
Phase 2: NII from EVE Cashflows
    ↓ (provides all data for inline chart computation)
Phase 3: Cleanup (remove dead code, simplify GET endpoint)
```

Each phase is independently deployable and testable. If Phase 2 proves too complex, Phases 0 and 1 still provide significant value.

---

## 10. WHAT WE ARE NOT CHANGING

- **EVE cashflow generation** (`build_eve_cashflows` and all 8 `_extend_*` functions): These are correct and well-tested. They remain the single source of truth for cashflow projection.
- **Discount factor computation**: `df_on_date()` remains unchanged.
- **Regulatory curve construction**: `build_regulatory_curve_sets()` remains unchanged.
- **Frontend**: No frontend changes needed. The API response shapes remain identical.
- **What-If data structures**: `WhatIfBucketDelta`, `WhatIfMonthDelta` response types remain the same.

---

## 11. OPEN QUESTIONS FOR IMPLEMENTATION

### Q1: Monthly NII — accrual-based or payment-date-based?
- **DECIDED: Accrual-based (continuous allocation)**. Pro-rate each coupon's interest across the months of its accrual period using proportional day counts. This is the regulatory standard (EBA GL/2022/14, IFRS 9 effective interest method) and matches the current NII projector behavior. Payment-date allocation would produce misleading lumpy charts (zero in non-payment months) and incorrect end-of-horizon allocation. The pro-rating is a lightweight O(N) operation on already-computed data.

### Q2: Should renewals inherit the original payment frequency?
- Currently yes (nii_projectors use `_original_term_days` for renewal cycle length)
- This should be preserved in the unified approach

### Q3: Margin calibration for renewals
- Currently `compute_nii_margin_set()` is called once before NII computation
- This should remain the same — the margin set is calibrated from the base curve and passed to the renewal logic

### Q4: Process pool parallelism
- Currently: separate EVE and NII workers run in parallel across scenarios (e.g., 14 workers for 7 scenarios × 2 metrics)
- Unified approach: one worker per scenario doing both EVE and NII (7 workers)
- Fewer workers, but each does more work. Total computation is less because there's no duplication.
- The unified workers can still run in parallel across scenarios using the existing ProcessPoolExecutor.

---

## 12. ESTIMATED SCOPE PER PHASE

| Phase | Files modified | New files | Lines changed (est.) | Complexity |
|-------|---------------|-----------|---------------------|------------|
| 0 | 4 | 1 | ~30 | Low |
| 1 | 3 | 1 (test) | ~150 | Medium |
| 2 | 4 | 2 (function + test) | ~400 | High |
| 3 | 2 | 0 | ~-100 (deletions) | Low |

Total estimated: ~480 net lines changed, 2 new files.
