# ALMReady Engine Overhaul — Master Reference Document

*Created: 2026-03-01*
*Status: Preliminary plan — each step to be individually planned in dedicated sessions*

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [Root Cause Analysis](#2-root-cause-analysis)
3. [Architectural Questions & Decisions](#3-architectural-questions--decisions)
4. [Upload Pipeline Assessment](#4-upload-pipeline-assessment)
5. [The Roadmap](#5-the-roadmap)
6. [Step 1 — Audit & Golden Test Suite](#6-step-1--audit--golden-test-suite)
7. [Step 2 — Instrument Coverage Expansion](#7-step-2--instrument-coverage-expansion)
8. [Step 3 — Algorithmic Fix (Python)](#8-step-3--algorithmic-fix-python)
9. [Step 4 — Rust Engine (PyO3)](#9-step-4--rust-engine-pyo3)
10. [Step 5 — Callable Bonds & Monte Carlo](#10-step-5--callable-bonds--monte-carlo)
11. [Key File Reference](#11-key-file-reference)
12. [Decisions Log](#12-decisions-log)

---

## 1. The Problem

### What happened

Running "Calculate EVE and NII" on a 1.5M-position portfolio on the development machine (8 GB RAM MacBook) caused the system to consume all available memory, fill 10.2 GB of 11 GB swap, and nearly crash the machine. A previous attempt generated a macOS warning about ~60 GB of disk usage from swap file creation.

### System state observed during the crash

| Metric | Value | Acceptable |
|---|---|---|
| Total RAM | 8 GB | — |
| RAM free | 98 MB | No |
| Swap used | 10.2 GB / 11 GB | No |
| Load average | 7.27 | No (should be < 2) |
| Python workers spawned | 8 (one per CPU core) | Too many for 8 GB |
| Largest worker RSS | 963 MB (and growing) | — |
| Second largest worker | 710 MB (and growing) | — |
| Total Python RSS | 1.36 GB (early stage, still growing) | Would reach ~35-42 GB |
| Free disk | 18 GB / 233 GB | Limited swap headroom |

### Why it crashed

The engine's memory demand for 1.5M positions is approximately **35-42 GB** across all workers. On an 8 GB machine, the OS compensates by writing memory pages to disk (swap), but with only 18 GB of free disk and an 11 GB swap limit, it runs out of everywhere to put the data.

---

## 2. Root Cause Analysis

### 2.1 The Cashflow Explosion

Each position doesn't produce a single output — it generates many cashflow records. The multiplication factor depends on instrument type and maturity:

| Instrument type | Output records per position | Internal loop iterations | Explanation |
|---|---|---|---|
| Fixed bullet (annual, 10Y) | ~10 | ~10 | 10 coupons + 1 principal; no curve lookups |
| Fixed annuity (monthly, 30Y) | ~360 | ~360 | 360 monthly payments; no curve lookups |
| Variable bullet (annual coupons, monthly resets, 10Y) | **~10** | **~120** | Same 10 payment-date records as fixed bullet; each coupon period accumulates 12 monthly reset segments internally into `period_interest` (see `eve.py:647`), recorded as ONE flow at `pay_date` (`eve.py:667`) |
| Variable annuity (monthly payments, monthly resets, 30Y) | **~360** | **~360** | Same 360 records as fixed annuity; each monthly payment period has ~1 reset segment |

**Key distinction:** Variable instruments produce the **same number of output records** as their fixed equivalents. The reset segments within each coupon period are accumulated into a single interest amount via a loop (`period_interest += seg_interest`), not emitted as separate cashflow records. What the variable rate multiplies is **CPU work** (curve lookups per reset segment), not **memory** (output DataFrame rows).

For 1.5M positions with a mixed portfolio, the engine generates approximately **5-15 million cashflow records** per scenario, depending on portfolio composition (payment frequency × maturity distribution). The fixed vs variable split does NOT affect record count — it only affects computation time per record.

### 2.2 The Python Dict Memory Tax

Cashflows are generated as Python dictionaries (`records: list[dict[str, Any]]` at `eve.py:1264`), each with 9 key-value pairs:

```python
{
    "contract_id": str,           # ~30 bytes
    "source_contract_type": str,  # ~20 bytes
    "rate_type": str,             # ~10 bytes
    "side": str,                  # ~1 byte
    "index_name": str | None,     # ~20 bytes
    "flow_date": date,            # ~8 bytes
    "interest_amount": float,     # ~8 bytes
    "principal_amount": float,    # ~8 bytes
    "total_amount": float,        # ~8 bytes
}
```

A Python dict with 9 entries uses approximately **400-500 bytes** in CPython due to hash tables, key object pointers, boxed float values, and reference counts. The same data in a numpy structured array would use **~72 bytes** (9 fields × 8 bytes). This is a **6x memory overhead** from the data structure choice alone.

- 10M records × 450 bytes = **~4.5 GB** as a Python list of dicts
- 10M records × 72 bytes = **~720 MB** as a numpy array

### 2.3 The DataFrame Conversion Spike

At `eve.py:1363`: `out = pd.DataFrame(records)`

During this conversion, **both the Python list and the new DataFrame exist in memory simultaneously**. For 10M records this means a ~4.5 GB list + ~1.2 GB DataFrame = **~5.7 GB peak** before the list is garbage collected.

### 2.4 Redundant Computation Across Scenarios

The calculation runs 7 tasks in parallel (base + 6 regulatory stress scenarios). Each task receives the **full 1.5M-position DataFrame** and rebuilds **all cashflows from scratch**.

**Critical insight:** For fixed-rate instruments, the cashflows are **identical across all scenarios**. A fixed-rate mortgage produces the same payment schedule regardless of what interest rates do — only the discounting changes. The engine rebuilds identical cashflows 7 times because the architecture doesn't distinguish between "generating cashflows" (position-dependent) and "valuing them" (curve-dependent).

Evidence from `eve.py`:
```python
# Fixed bullet cashflow generation (eve.py:355) — NO curve dependency
interest = sign * notional * fixed_rate * yearfrac(accrual_start, pay_date, base)

# Variable bullet cashflow generation (eve.py:663) — USES projection curve
seg_rate = float(projection_curve_set.rate_on_date(index_name, seg_start)) + float(spread)
```

### 2.5 Data Serialization Overhead (Pickling)

`ProcessPoolExecutor.submit()` serializes (pickles) every argument to send it to the worker process via OS pipe. The 1.5M-row motor DataFrame (~600 MB) gets:
1. Serialized in the main process (temporary ~600 MB spike)
2. Written through the OS pipe
3. Deserialized in the worker (another ~600 MB)

This happens **7 times** (once per scenario submission): 7 × 600 MB = **~4.2 GB** of redundant position data copies.

### 2.6 Additional Copies Inside Workers

Inside each worker (`workers.py:71-141` → `eve_nii_unified`):

| Operation | Memory | Location |
|---|---|---|
| Received motor_df (deserialized) | ~600 MB | pickle/IPC |
| `records: list[dict]` accumulation | ~4.5 GB | `eve.py:1264` |
| `pd.DataFrame(records)` conversion | ~1.2 GB (coexists with list) | `eve.py:1363` |
| `work = cashflows.copy()` in EVE | ~1.2 GB | `eve_analytics.py:154` |
| 8 additional columns on `work` | ~250 MB | `eve_analytics.py:155-189` |
| NII: another copy + processing | ~1.2 GB | `nii.py:1050` |
| **Peak per worker** | **~5-6 GB** | |
| **× 7 simultaneous workers** | **~35-42 GB** | |

### 2.7 The Python Loop Bottleneck

80-85% of `build_eve_cashflows` is pure Python `for row in positions.itertuples()` loops (`eve.py:315`, `388`, `476`, `568`, `700`, `860`, `1011`, `1097`). Python executes these at ~10-50M operations/second. The equivalent vectorized numpy operation runs at ~1-5B operations/second (50-100x faster). The equivalent Rust loop runs at ~1-5B operations/second as well.

For 1.5M positions × ~8 output records each × ~15 operations per record = **~180M Python-level operations** per scenario just for output generation, plus an additional CPU overhead for variable instruments whose internal reset-segment loops multiply curve lookups (e.g., a variable bullet with 12 monthly resets per annual coupon does 12 `rate_on_date` calls per coupon period). Across 7 scenarios = **~1.3B+ operations total**, at Python speed.

### 2.8 NII Is Not Vectorized

`compute_nii_from_cashflows` (`nii.py:979`) processes contracts via Python loops:
- `nii.py:1038`: `for row in nii_positions.itertuples(index=False)` — builds position lookup
- Multiple per-contract loops for renewal NII computation
- Explicit `while cycle_start < horizon_end:` loops per position maturity

This is in contrast to EVE analytics (`eve_analytics.py:120`), which uses vectorized pandas operations with cached discount factors (OPT-3).

---

## 3. Architectural Questions & Decisions

### 3.1 Can this work on this machine at all?

**Yes.** The theoretical minimum memory for 1.5M positions:
- Positions: ~600 MB (one copy, shared or sequential)
- Cashflows as numpy: ~720 MB (built once for fixed, per-scenario for variable)
- Working space: ~200 MB
- **Total: ~1.5 GB** — fits comfortably in 8 GB

The current architecture uses **~25x more memory than necessary**. The problem is the code, not the hardware.

### 3.2 Maximum portfolio size estimates

| Architecture | 8 GB machine | 64 GB server |
|---|---|---|
| Current (wasteful) | ~100-200K positions | ~1.5-2M positions |
| Optimized Python | ~5-8M positions | ~40-60M positions |
| Rust engine | ~8-12M positions | ~60-100M positions |

The largest European banks have ~20-50M contract-level positions, computed on single servers (64-128 GB RAM).

### 3.3 Do we need to move computation to a server?

**Not now.** The bottleneck is algorithmic waste, not hardware limitations. A 64 GB server running the current code would handle 1.5M positions but at unnecessary cost. Fix the algorithm, and it runs on the MacBook.

**When a server becomes genuinely necessary:**
- Multiple simultaneous users
- Portfolios exceeding ~10M positions
- Real-time recalculation (<1 second)
- Historical backtesting across hundreds of dates

**Critical: optimizing locally does NOT make the server transition harder — it makes it easier and cheaper.** The server transition is infrastructure (Docker, auth, API), not engine changes. An efficient engine on a server needs a cheaper server. The optimization work carries over completely. See `docs/FUTURE_SERVER_MODE.md` for the server plan.

### 3.4 Language choice for the engine rewrite

**Decision: Rust via PyO3.** Rationale:

| Factor | Rust | Java | C++ | Go | Julia |
|---|---|---|---|---|---|
| Already in stack | Yes (Tauri) | No | No | No | No |
| Python integration | PyO3/maturin (excellent) | JNI (painful) | pybind11 (works, unsafe) | CGo (awkward) | PyJulia (brittle) |
| Memory control | Exact, zero GC | JVM heap + GC pauses, 256-512 MB base | Exact but unsafe | GC, less control | GC + JIT warmup |
| Numerical performance | Top tier | 70-80% of C | Top tier | 50-60% of C | Top tier (after JIT) |
| Memory safety | Compile-time guaranteed | Runtime (NPE) | None (segfaults) | Runtime | Runtime |
| Type system strength | Strongest | Good but nullable | Weak | Weak | Dynamic |
| Tauri synergy | Future: eliminate Python sidecar entirely, engine runs in-process | Adds JVM runtime | Possible but unsafe | Adds Go runtime | Adds Julia runtime |

**The Tauri angle is decisive.** Current architecture: Rust (Tauri) → spawns Python (PyInstaller sidecar) → FastAPI → pandas engine. With Rust engine, the long-term path is: Rust (Tauri) → Rust (engine) — single binary, no sidecar, no PyInstaller, no port protocol. App drops from ~110 MB to ~20 MB and starts instantly.

### 3.5 Can correctness be verified with a Rust engine?

**Yes, through the golden test suite.** The Python implementation (after audit and algorithmic fix) serves as a **test oracle**. Every instrument type has hand-verified test cases with Excel outputs. The Rust engine must produce identical numbers. If both implementations agree on all test cases, confidence is high.

**What you lose:** the ability to casually inspect intermediate values in Python (`df.head()`, `print(cashflows[...])` etc.). Rust requires explicit debug serialization for intermediate inspection.

**What you gain:** compile-time type safety that prevents mixing up notionals with rates, interest with principal, assets with liabilities. The Rust compiler catches a class of financial logic errors that Python would silently accept.

### 3.6 Parallelism strategy

**Current (wrong):** Parallelize by scenario — 7 workers, each processes ALL 1.5M positions for ONE scenario.

**Correct approach depends on the engine:**

- **Python (Step 3):** Sequential scenarios with memory cleanup. Build fixed cashflows once, reuse. Each scenario = one vectorized discount pass + variable cashflow rebuild. Peak memory ~2-3 GB.

- **Rust (Step 4):** Shared-memory parallelism via Rayon. All threads share the position data and fixed cashflows (no copying). Variable cashflows built per-thread per-scenario. True parallelism without memory duplication. ProcessPoolExecutor + pickling goes away entirely.

### 3.7 Should new instrument types be in the main engine, not just What-If?

**Yes.** A bank's actual balance sheet contains callable bonds, mixed-rate loans, instruments with grace periods, and swaps. If the main EVE/NII engine can't handle them, it either:
- Excludes them → missing risk (methodological error)
- Treats them as simpler instruments → wrong risk (methodological error)

Both are unacceptable given that correctness is priority #1.

### 3.8 Integration vs separate algorithms for new instruments

| Feature | Approach | Rationale |
|---|---|---|
| Grace period | Parameter on existing annuity/linear projectors | Same cashflow structure, interest-only at start |
| Floor/cap rates | Parameter on existing variable projectors | Same structure, rate clamped |
| Mixed rate (fixed-then-variable) | New projector | Two distinct phases with different logic |
| Swaps (IRS) | New projector (two-leg) | Two simultaneous cash flow streams |
| Callable bonds | New projector (Monte Carlo) | Entirely different computational model |

The existing 8 contract type projectors become ~10-11, plus the Monte Carlo engine. Existing projectors gain 2-3 optional parameters. No existing test should break.

### 3.9 What about incremental computation?

Currently, changing one position requires recomputing all 1.5M. An incremental architecture where you "subtract" the old position's contribution and "add" the new one would make the What-If workbench near-instant for the full portfolio. The What-If already works conceptually this way for delta computation, but the base calculation has no concept of this.

This is a future consideration, not part of the current overhaul.

### 3.10 What happens with more scenarios?

EBA standard has 6 regulatory scenarios, but banks often run 20-50 internal scenarios plus historical backtesting. With the current architecture, each additional scenario means another full 6-7 GB copy of everything. With "build once, discount many," each additional scenario costs nearly nothing — one more vectorized multiply-and-sum over the same cached cashflows.

### 3.11 Could we avoid generating individual cashflow records entirely?

For some instrument types, the present value has a **closed-form analytical formula**. A fixed-rate annuity's PV:

```
PV = PMT × [1 - (1+r)^(-n)] / r
```

No loops, no cashflow records, no DataFrames. One multiplication per position. The engine currently generates 360 records for a 30-year monthly annuity, discounts each, and sums — when a single formula could give the same answer.

**Limitation:** The regulatory requirement for bucket breakdown (PV by maturity band) and monthly NII breakdown requires knowing individual cashflow dates. But even bucket allocation could be computed analytically for standard instruments.

**Decision:** Explore analytical shortcuts in the Rust engine (Step 4) for EVE scalar computation, but maintain full cashflow generation for bucket breakdowns and NII monthly detail.

### 3.12 What about Apache Arrow or shared memory?

Arrow is a columnar in-memory format that processes could share without copying. If the main process stored motor_df as an Arrow table in shared memory, all workers could read it without serialization.

**Relevance:** This becomes moot with Rust + Rayon, which uses shared-memory threads natively. No IPC serialization at all. But if an intermediate Python optimization were needed, Arrow (via `pyarrow`) could eliminate the 4.2 GB of redundant pickling.

---

## 4. Upload Pipeline — Full Assessment & Integration

### 4.1 Current state

The upload pipeline (240s → 67s for 1.56M rows) was previously optimized for throughput. It is better architected than the calculation engine in several ways:

| Concern | Calculation engine | Upload pipeline |
|---|---|---|
| Data copied N times? | Yes — pickled 7× to workers | No — each worker reads its own CSV chunk |
| Python loops over 1.5M rows? | Yes — `itertuples` in 8 projectors | No — all operations vectorized |
| Dict-of-dicts accumulation? | Yes — 12M cashflow dicts | No — direct DataFrame operations |
| Redundant recomputation? | Yes — same fixed cashflows 7× | No — one-way data flow |

**But it has real problems:**
- **Does not work in the Tauri desktop app** — gets stuck at a high upload percentage. Works fine in dev mode (browser + uvicorn). This is a blocking production bug.
- **Scales linearly** — 3M rows = ~134s, 5M = ~220s, 10M = ~440s. For larger portfolios this becomes painful.
- **No validation** — invalid positions (missing dates, non-numeric notionals) are silently coerced or skipped during calculation. The user doesn't know their data has problems until a calculation fails or produces wrong numbers.
- **Memory scales linearly** — 1.5M rows = ~1.5 GB peak. At 5M rows = ~5 GB peak. On an 8 GB machine, 5M rows during upload would trigger the same swap pressure as the calculation engine does today.

### 4.2 What's efficient (keep these patterns)

**Parallel I/O without data duplication:** 8 workers each independently read their assigned CSV file and write a Parquet temp file. Workers communicate via disk (Parquet intermediates), not pickle serialization. Data never travels through OS pipes.

**Vectorized classification:** The canonicalization step (`_canonicalization.py:237-314`) deduplicates 1.5M rows to ~5K unique `(side, product)` combos, classifies those against 70 rules using vectorized `.str.contains()`, maps back via `O(1)` lookup. Complexity: `O(70 × 5K + 1.5M)` not `O(70 × 1.5M)`.

**C-level numeric parsing:** `numpy.strings` for bulk decimal detection (3-10x faster than pandas `.str`).

**Parquet storage:** ~150 MB on disk vs ~600 MB JSON. Dates as `datetime64` (native). Column pruning on read.

### 4.3 Rust for the upload pipeline — yes, when we build the Rust crate

Since we're building a Rust PyO3 crate for the calculation engine (Step 4), the upload pipeline should be included in the **same crate**. The marginal cost of adding upload functions to an existing PyO3 module is small — the build infrastructure (maturin, cross-platform CI, PyInstaller integration) is already paid for.

**Estimated gains at 1.5M rows:**

| Component | Python (current) | Rust | Speedup |
|---|---|---|---|
| CSV read + numeric parsing | ~45s | ~8-12s | 4-5x |
| Classification (70 rules × 5K combos) | ~10-15s | ~2-3s | 5x |
| Parquet write | ~8-12s | ~8-12s (PyArrow = C++) | 1x |
| **Total** | **67s** | **~20-25s** | **3x** |

**At larger scales the gains compound:**

| Positions | Python | Rust | Speedup |
|---|---|---|---|
| 1.5M | 67s | ~22s | 3x |
| 5M | ~220s | ~60s | 3.5x |
| 10M | ~440s | ~100s | 4.5x |

The speedup ratio increases at scale because Rust's memory efficiency means less GC pressure and no swap. Python at 10M rows on 8 GB RAM would swap; Rust would not.

**Decision (revised): include upload in the Rust crate during Step 4, not deferred.** The functions to add: CSV parsing, numeric coercion, classification rule matching, and position validation.

### 4.4 Pre-computation: the analysis_date opportunity

**The insight:** Fixed-rate cashflows depend only on position data + analysis date. They do NOT depend on curves, scenarios, or behavioural params. If the analysis date is known before calculation, fixed cashflows can be pre-built and cached.

**Current workflow:**
```
Upload balance → Set curves → Set scenarios → Set analysis date → Calculate
                                                      ↑
                                            (analysis date chosen HERE,
                                             too late for pre-computation)
```

**Proposed workflow change:**
```
Upload balance → Set analysis date → [Pre-build fixed cashflows in background]
                      ↓
              Set curves → Set scenarios → Calculate
                                              ↑
                                   (fixed cashflows already cached,
                                    only variable cashflows + discounting needed)
```

**What this buys:**
- Fixed instruments (likely 50-70% of the portfolio) have their cashflows built once
- Every subsequent "Calculate" only rebuilds variable cashflows + discounts
- Re-running with different scenarios = near-instant (just re-discount the same cashflows)
- The What-If workbench also benefits — delta cashflows are built against the cached base

**Cache invalidation:**
- If analysis_date changes → invalidate fixed cashflow cache → rebuild
- If positions change (re-upload) → invalidate everything → rebuild
- If only scenarios/curves/behavioural params change → cache is valid

**Where in the plan:** This is a workflow/UX change that should be designed during Step 2 (instrument expansion — when we're adding new types, we need to define which types are "fixed" and cacheable) and implemented during Step 3 (Python algorithmic fix — the "build once, reuse" architecture). The Rust engine (Step 4) then implements the same caching natively.

### 4.5 Upload audit scope (included in Step 1)

The upload pipeline requires its own audit, separate from but parallel to the calculation audit. It's simpler because the concern is data integrity, not financial formulas:

**What to verify:**
1. **Numeric parsing fidelity** — Does `_parse_numeric_column` correctly handle European decimals (comma), thousand separators (dot), negative signs, percentages? Test with edge cases: `"1.234,56"`, `"-0,5%"`, `""`, `"N/A"`, `"1e-5"`.
2. **Date parsing** — Does `pd.to_datetime` correctly handle `DD/MM/YYYY` vs `YYYY-MM-DD` vs `MM/DD/YYYY`? What about `31/12/2055` (far future maturities)?
3. **Classification accuracy** — For each known product type (from bank mapping), verify the `source_contract_type` assignment is correct. A mortgage classified as a bullet bond would produce wrong cashflows downstream.
4. **Round-trip fidelity** — Write a motor DataFrame to Parquet, read it back, compare every cell. Are dates, floats, strings preserved exactly?
5. **Column completeness** — Does every field needed by the EVE/NII engine (`notional`, `fixed_rate`, `spread`, `start_date`, `maturity_date`, `daycount_base`, `payment_frequency`, `side`, `source_contract_type`, `index_name`) survive the upload → store → reload pipeline intact?

**Output:** A pytest that creates known-value DataFrames, runs them through the full upload pipeline, reads back the stored Parquet, and asserts every field matches.

### 4.6 Scaling questions

1. **At what position count does upload hit a memory wall?** At ~5M rows the motor DataFrame reaches ~4 GB. On an 8 GB machine, this leaves minimal headroom for canonicalization (which creates a second DataFrame of similar size). The Rust engine should solve this via streaming: parse-classify-write in one pass without holding the entire DataFrame in memory.

2. **Should we support streaming/chunked upload?** For 10M+ positions, loading the entire DataFrame into memory is impractical in any language on an 8 GB machine. A streaming architecture where chunks of 500K rows are parsed, classified, and appended to Parquet incrementally would cap memory at ~500 MB regardless of portfolio size. This is most naturally implemented in Rust.

3. **Should the Parquet format be optimized?** The motor DataFrame stores ~30 columns but EVE/NII only uses ~15. A pre-pruned "calculation-ready" Parquet alongside the full motor Parquet would reduce calculation-time memory by 200-300 MB. Essentially free to implement.

4. **Should new instrument types require new parsing logic?** Yes — the bank mapping files (`bank_mapping_*.py`) and canonicalization rules need to recognize swaps, callable bonds, mixed-rate instruments, etc. This is incremental: add rules, not rewrite the parser. Included in Step 2.

### 4.7 Tauri upload bug

**Known issue:** Upload gets stuck at a high percentage in the Tauri desktop app. Works in browser dev mode. This is likely a Tauri-specific issue with:
- Large file handling through the webview (file size limits, memory pressure in the Rust sidecar layer)
- Progress event streaming (SSE or polling) timing out or being blocked
- The PyInstaller sidecar's interaction with Tauri's resource bundling

**Not blocking the engine overhaul** (the engine works correctly when data reaches it), but must be fixed before distribution. Should be investigated as a standalone bug after the engine audit is complete.

---

## 5. The Roadmap

### Sequencing and rationale

```
Step 1 ─── Audit & Golden Test Suite
   │        "Is what we have correct — end to end?"
   │        Part A: Upload audit (data integrity through parse → store → reload)
   │        Part B: Calculation audit (Excel-verified for all 8 instrument types + 3 behavioural)
   │        These tests become the permanent correctness anchor
   │
Step 2 ─── Instrument Coverage Expansion
   │        "Can we handle the full balance sheet?"
   │        Add: grace periods, floor/cap, mixed rate, swaps
   │        Balance parser + canonicalization updates for new types
   │        Analysis-date workflow change (enables fixed cashflow caching)
   │        Golden tests for each new type
   │
Step 3 ─── Algorithmic Fix (Python)
   │        "Make it work on 1.5M positions without crashing"
   │        Build fixed cashflows once (cached by analysis_date), reuse across scenarios
   │        Sequential scenarios with memory cleanup, numpy arrays instead of dicts
   │        All golden tests must still pass
   │        App becomes usable immediately (3-5 min, ~2-3 GB RAM)
   │
Step 4 ─── Rust Engine (PyO3) — calculation AND upload
   │        "Make it fast — the entire pipeline"
   │        Single almready_engine crate: upload parsing + calculation engine
   │        Rayon for shared-memory parallelism, streaming upload for large portfolios
   │        Every golden test validates Rust vs Python
   │        Target: 1.5M upload in ~20s, calculation in 10-30s
   │
Step 5 ─── Callable Bonds & Monte Carlo (Rust)
            "Complete the instrument coverage"
            Stochastic simulation engine
            Rust-native from the start (Python too slow for MC)
            Academic reference tests
```

**Why this order:**

1. **Audit first** — Never optimize code you haven't verified is correct. If the current engine has a sign error in the annuity formula, optimizing it means producing wrong answers faster.

2. **Expand instruments before optimizing** — The optimization architecture needs to account for all instrument types. If we optimize for 8 types and then discover swaps need a completely different data flow, we'd have to re-architect.

3. **Python fix before Rust** — (a) Creates a working test oracle for the Rust engine. (b) Makes the app usable during Rust development. (c) Prototypes the correct algorithm in a language the user can inspect.

4. **Rust after Python works** — Translates a verified, correct, well-architected algorithm. Not reimplementing the old wasteful design in a faster language.

5. **Monte Carlo last** — Most complex, requires the Rust infrastructure to already exist, and is a specialized computation model unlike the deterministic engine.

---

## 6. Step 1 — Audit & Golden Test Suite

### Objective

Create a comprehensive test suite that generates Excel files with every intermediate value, allowing manual cell-by-cell verification of the engine's calculations for each instrument type.

### What "golden test" means

For each instrument type, we create:
- A single hand-crafted position with deliberately simple, verifiable parameters
- Run it through `build_eve_cashflows` → `compute_eve_full` → `compute_nii_from_cashflows`
- Write an Excel workbook with:

| Sheet | Contents |
|---|---|
| **Input** | All position parameters (notional, rate, dates, day count, etc.) |
| **Cashflows** | Every cashflow record: date, interest, principal, total, cumulative balance |
| **EVE Discounting** | Per-cashflow: year fraction, discount factor, PV of interest, PV of principal, PV total |
| **EVE Buckets** | Per bucket: asset PV, liability PV, net PV |
| **NII Monthly** | Per month: interest income, interest expense, net NII |
| **Summary** | Total EVE, total NII, check sums, cross-references |

- Manually verify every cell in the Excel
- Once verified, encode the expected values in an automated pytest that asserts engine output matches within tolerance (0.01€)

### Instruments to audit

**Existing 8 types (must all be audited):**

1. `fixed_bullet` — Bond paying periodic coupons, principal at maturity
   - Test position: 100,000€, 5% annual, 5Y, ACT/365, annual coupons, asset side
   - Expected: 5 interest flows of ~5,000€ each + 100,000€ principal at maturity

2. `fixed_linear` — Loan with equal principal repayments
   - Test position: 120,000€, 4% annual, 3Y, ACT/365, quarterly payments, asset side
   - Expected: 12 payments with decreasing interest, constant 10,000€ principal each

3. `fixed_annuity` — Loan with equal total payments (mortgage-style)
   - Test position: 200,000€, 3% annual, 10Y, ACT/360, monthly payments, asset side
   - Expected: 120 equal payments, verify via standard annuity formula

4. `fixed_scheduled` — Custom principal flow schedule
   - Test position: 500,000€, 2.5% annual, custom schedule (3 principal payments), asset side
   - Expected: interest accrual between scheduled flows

5. `variable_bullet` — Floating-rate bond, principal at maturity
   - Test position: 100,000€, EURIBOR_3M + 1.5% spread, 3Y, quarterly resets, asset side
   - Requires: a specific test curve to produce known forward rates

6. `variable_linear` — Floating-rate loan with equal principal repayments
   - Test position: 150,000€, EURIBOR_6M + 2.0% spread, 5Y, semi-annual, liability side

7. `variable_annuity` — Floating-rate mortgage
   - Test position: 300,000€, EURIBOR_12M + 1.0% spread, 20Y, monthly, asset side

8. `variable_scheduled` — Floating-rate with custom principal schedule
   - Test position: 250,000€, EURIBOR_3M + 0.5%, custom schedule, asset side

**Additionally audit (behavioural overlays):**

9. Fixed annuity **with CPR** (conditional prepayment rate)
   - Same as test 3 but with cpr_annual = 5%
   - Verify the dual-schedule CPR overlay formula: `QCm = DRm × min(1, QCc/DRc + CPRp)`

10. Fixed bullet **with TDRR** (term deposit early redemption)
    - Liability-side term deposit, tdrr_annual = 3%
    - Verify TDRR applies only to term deposit liabilities

11. **NMD expansion** (non-maturity deposits)
    - Fixed NMD position with behavioural parameters (core/non-core split, 19 EBA buckets)
    - Verify bucket allocation and synthetic maturities

**Test infrastructure needed:**
- A deterministic test `ForwardCurveSet` with known rates (e.g., flat 3% across all tenors, or a specific set of pillar rates)
- `openpyxl` for Excel output
- Test output directory: `backend/engine/tests/audit/` (gitignored via `**/tests/out/`)

### Part A: Upload pipeline audit

The upload pipeline is simpler to audit than the calculation engine — the concern is **data integrity**, not financial formulas. But it's equally important: if positions are parsed wrong, every calculation downstream is silently wrong.

**What to verify:**

1. **Numeric parsing fidelity** — Does `_parse_numeric_column` correctly handle:
   - European decimals: `"1.234,56"` → `1234.56`
   - Percentage notation: `"-0,5%"` → `-0.005`
   - Empty/missing: `""`, `"N/A"`, `None` → `NaN`
   - Scientific: `"1e-5"` → `0.00001`
   - Already-numeric (float64 from `decimal=","` parameter): pass-through without re-parsing

2. **Date parsing** — `DD/MM/YYYY` vs `YYYY-MM-DD` vs `MM/DD/YYYY`. Far future maturities (`31/12/2055`). Dates before analysis date (already matured positions).

3. **Classification accuracy** — For each known product type in the bank mapping, verify `source_contract_type` is assigned correctly. A mortgage classified as a bullet bond produces wrong cashflows. This is a critical data-integrity gate.

4. **Round-trip fidelity** — Create a known-value motor DataFrame → write to Parquet → read back → assert every cell matches. Dates, floats, strings, NaN handling.

5. **Column completeness** — Every field needed by EVE/NII (`notional`, `fixed_rate`, `spread`, `start_date`, `maturity_date`, `daycount_base`, `payment_frequency`, `side`, `source_contract_type`, `index_name`) survives the full upload → store → reload cycle intact.

**Output:** A pytest that constructs known-value DataFrames, runs them through the full pipeline, reads back stored Parquet, and asserts every field matches expected values.

### Acceptance criteria for Step 1

**Part A (upload):**
- [ ] Numeric parsing test with 10+ edge cases (European decimals, percentages, empties, scientific)
- [ ] Date parsing test with multiple formats and edge dates
- [ ] Classification test for each product type in the bank mapping
- [ ] Round-trip test (DataFrame → Parquet → DataFrame, cell-by-cell match)
- [ ] Column completeness test (all EVE/NII required fields survive)
- [ ] Any parsing or classification errors found are documented and fixed

**Part B (calculation):**
- [ ] All 11 golden test Excel files generated and manually verified
- [ ] Automated pytest for each, asserting numerical match to 0.01€
- [ ] Any errors found in the current engine are documented and fixed
- [ ] Test curve fixtures documented (exact rates at exact tenors)

---

## 7. Step 2 — Instrument Coverage Expansion

### Objective

Extend the main EVE/NII engine to handle all instrument types that exist on real bank balance sheets, not just in the What-If workbench.

### New instruments to add

#### 6.1 Grace Period Support

**What it is:** A period at the start of a loan where the borrower pays only interest (no principal amortization). After the grace period ends, the loan amortizes normally over the remaining term.

**Affected projectors:** `_extend_fixed_annuity_cashflows`, `_extend_fixed_linear_cashflows`, `_extend_variable_annuity_cashflows`, `_extend_variable_linear_cashflows`

**Implementation approach:** Add optional `grace_years` parameter. During the grace period, generate interest-only cashflows at the contractual rate. After the grace period, start amortization on the full notional over the remaining term. This is a parameter modification, not a new projector.

**Already partially implemented:** The What-If decomposer (`decomposer.py`) already generates motor positions with grace periods. The V2 schema has `grace_years`. What's missing is the EVE/NII cashflow projector support.

#### 6.2 Floor and Cap Rates

**What it is:** A contractual minimum (floor) and/or maximum (cap) on the interest rate of a variable-rate instrument. Even if the reference rate drops below the floor or rises above the cap, the client rate is bounded.

**Affected projectors:** All 4 variable-rate projectors

**Implementation approach:** Add optional `floor_rate` and `cap_rate` parameters. After computing the segment rate (`reference_rate + spread`), clamp: `effective_rate = max(floor, min(cap, seg_rate))`. A helper `apply_floor_cap` already exists in `nii_projectors.py`.

**Already partially implemented:** `apply_floor_cap` exists in `nii_projectors.py` and is used in NII cycle projectors. Needs to be consistently applied in EVE cashflow generation as well.

#### 6.3 Mixed Rate (Fixed-then-Variable)

**What it is:** An instrument that pays a fixed rate for the first N years, then switches to a floating rate (reference + spread) for the remaining term. Common in European mortgage markets.

**Implementation approach:** New projector `_extend_mixed_rate_cashflows`. Internally delegates to fixed logic for phase 1 and variable logic for phase 2. The switch date is `start_date + mixed_fixed_years`.

**Schema support:** `mixedFixedYears` already exists in the What-If V2 schema.

**Key detail for EVE:** The fixed phase produces curve-independent cashflows; the variable phase produces curve-dependent cashflows. This distinction matters for the "build once, reuse" optimization in Step 3 — the fixed phase can be cached, the variable phase cannot.

#### 6.4 Interest Rate Swaps

**What it is:** A contract where two parties exchange interest rate cash flows — typically one pays fixed, the other pays floating. The notional is never exchanged; only the net interest difference settles periodically.

**Implementation approach:** New projector `_extend_swap_cashflows`. Models two legs:
- **Pay leg:** Fixed or floating rate × notional (outgoing cash)
- **Receive leg:** Fixed or floating rate × notional (incoming cash)

The position's `side` determines the sign convention. A "payer swap" (pay fixed, receive floating) benefits from rate increases.

**Motor position representation:** Could be modeled as a single position with `source_contract_type = "swap"` and additional fields (`pay_rate_type`, `receive_rate_type`, `pay_rate`, `receive_spread`), or as two synthetic positions. The single-position approach is cleaner for the user and for the balance parser.

**EVE/NII impact:** Swaps are major interest rate risk instruments. Their exclusion from the main engine would understate risk significantly for any bank that uses swaps for hedging.

#### 6.5 Callable Bonds (Deferred to Step 5)

**What it is:** A bond where the issuer has the right (but not obligation) to redeem early at specified call dates. The bond's value depends on whether the issuer will exercise this option, which depends on future interest rate paths.

**Why deferred:** Requires Monte Carlo simulation (stochastic rate paths), which is:
- Computationally 100-1000x heavier per position than deterministic projection
- Best implemented directly in Rust (Python too slow for the inner simulation loop)
- A fundamentally different computational model from the deterministic engine

**Will be addressed in Step 5** after the Rust engine is in place.

### Balance parser / canonicalization updates

New contract types need to be:
1. Recognized by the balance parser during upload
2. Classified by `_vectorized_classify_motor_rows` in `_canonicalization.py`
3. Mapped to the correct `source_contract_type` string
4. Included in the `_IMPLEMENTED_SOURCE_CONTRACT_TYPES` set in `eve.py`

### Acceptance criteria for Step 2

- [ ] Grace period works on fixed and variable annuity/linear projectors
- [ ] Floor/cap rates applied consistently in EVE and NII for variable instruments
- [ ] Mixed-rate projector implemented and tested
- [ ] Swap projector implemented and tested
- [ ] Golden tests (with Excel output) for each new feature
- [ ] Existing 218 tests still pass
- [ ] Balance parser recognizes new instrument types

---

## 8. Step 3 — Algorithmic Fix (Python)

### Objective

Make the engine handle 1.5M positions on the 8 GB development machine without crashing. Target: 3-5 minute calculation, ~2-3 GB peak RAM.

### 7.1 Build fixed cashflows once, reuse across scenarios

**The principle:** Fixed-rate instruments produce identical cashflows regardless of the interest rate scenario. Only the discounting changes. Currently, these cashflows are rebuilt 7 times (once per scenario).

**Implementation:**
1. In `calculate.py`, before submitting to workers:
   - Separate positions into `fixed_positions` and `variable_positions`
   - Build cashflows for `fixed_positions` ONCE in the main process
   - Store as a numpy array (not DataFrame) to minimize memory
2. Pass the pre-built fixed cashflows to each scenario task
3. Each task only generates cashflows for variable positions (which depend on the scenario's curve)
4. Combine fixed + variable cashflows, then discount

**Expected impact:** If 60% of positions are fixed-rate, this eliminates 60% of the cashflow generation work across 6 out of 7 scenario runs = **~85% reduction in redundant computation**.

### 7.2 Sequential scenarios with memory cleanup

**The principle:** Running 7 scenarios simultaneously on 8 GB RAM is impossible (~35-42 GB demand). Running them one at a time with explicit memory cleanup between each scenario uses only ~2-3 GB at any point.

**Implementation:**
1. Replace `ProcessPoolExecutor` parallel submission with sequential execution
2. After each scenario completes, explicitly `del` large intermediates and call `gc.collect()`
3. The fixed cashflows persist in memory (shared across scenarios); only variable cashflows + working copies are freed

**Expected impact:** Peak memory drops from ~42 GB to ~3 GB. Calculation time increases from (theoretical) 3-5 min parallel to ~10-15 min sequential — but "15 minutes and finishes" beats "3 minutes and crashes."

**Alternative:** Use 2 workers instead of 7 for bounded parallelism (~6 GB peak). This gives some parallel benefit without memory explosion.

### 7.3 Replace list-of-dicts with pre-allocated numpy arrays

**The principle:** A Python dict with 9 entries uses ~450 bytes. A numpy structured array row uses ~72 bytes. The list-of-dicts also causes a 2x memory spike during DataFrame conversion.

**Implementation:**
1. Before iterating positions, estimate total cashflow count (sum of payment counts per position)
2. Pre-allocate a numpy structured array of that size
3. Fill rows directly during iteration (no dict creation, no append)
4. Skip the `pd.DataFrame(records)` conversion — work directly with the numpy array

**Expected impact:** 6x memory reduction for cashflow storage. Eliminates the conversion spike entirely.

### 7.4 Eliminate unnecessary DataFrame copies

**The principle:** `cashflows.copy()` in `compute_eve_full` and `compute_nii_from_cashflows` doubles memory for safety. If we process EVE and NII sequentially (not in parallel within the same worker), the copy isn't needed — we can modify in place, then discard.

**Implementation:** The unified worker already does EVE then NII sequentially. Make `compute_eve_full` work on the original (or a view), collect results, then let NII process the same data. Use column assignment instead of full copies.

### 7.5 Cache variable rate lookups

**The principle:** EVE analytics already caches discount factors by unique date (OPT-3: `df_cache = {d: df(d) for d in unique_dates}`, ~2K unique dates instead of ~10M lookups). The same pattern should apply to forward rate lookups in variable cashflow generation.

**Implementation:** Build a rate cache `{(index_name, date): rate}` before iterating positions. Many positions share the same reference index and reset dates.

### Acceptance criteria for Step 3

- [ ] 1.5M positions completes without crashing on 8 GB machine
- [ ] Peak RAM stays below 3 GB (measured with `memory_profiler` or `ps`)
- [ ] All golden tests from Steps 1 and 2 still pass (numerical results unchanged)
- [ ] Calculation completes in < 15 minutes for 1.5M positions
- [ ] No ProcessPoolExecutor crashes or swap death

---

## 9. Step 4 — Rust Engine (PyO3) — Calculation AND Upload

### Objective

Replace both the Python calculation engine AND upload pipeline with a single Rust library compiled as a Python extension. Targets: 1.5M upload in ~20s, calculation in 10-30s, ~1-2 GB peak RAM.

### Architecture

```
FastAPI (Python)                     almready_engine.so (Rust, single crate)
─────────────────                    ──────────────────────────────────────
                                     ┌─ Upload module ─────────────────────┐
balance.py                           │                                     │
  └─ rust_engine.parse_upload(  ───► │  CSV read (memmap, SIMD)            │
       file_bytes,                   │  Numeric parsing (DFA state machine)│
       bank_id,                      │  Classification (trie-based rules)  │
       analysis_date                 │  Validation (strict, early errors)  │
     )                               │  → Arrow RecordBatch (zero-copy)    │
                                     │  → Optional: pre-build fixed CFs    │
  positions ◄──────────────────────  └─────────────────────────────────────┘

                                     ┌─ Calculation module ────────────────┐
calculate.py                         │                                     │
  └─ rust_engine.compute(       ───► │  Build fixed CFs (once, or cached)  │
       positions,                    │  For each scenario (Rayon parallel): │
       curves,                       │    Build variable CFs               │
       scenarios,                    │    Discount all CFs → EVE + buckets │
       params                        │    Compute NII + monthly            │
     )                               │  → Return all results               │
                                     └─────────────────────────────────────┘
  results ◄──────────────────────
```

**Key design principles:**

1. **Single crate, two modules.** Upload parsing and calculation share types (`Position`, `Cashflow`, `Curve`) and utilities (date handling, day count, numeric coercion). One build, one `.so`, one cross-platform CI step.

2. **Rayon for parallelism.** Rust threads share memory. No pickling, no copying. All threads read the same position data and fixed cashflows. Only variable cashflows are thread-local.

3. **Arrow for data interchange.** Apache Arrow provides zero-copy transfer between Python (pandas/pyarrow) and Rust (arrow-rs). The 600 MB DataFrame isn't serialized — Rust reads it directly from the same memory.

4. **Structured types.** Rust `struct Position`, `struct Cashflow`, `struct CurvePoint` encode the financial domain. The compiler ensures you can't accidentally add a notional to a rate.

5. **Streaming upload for large portfolios.** For 5M+ positions, the Rust upload module can parse-classify-validate in a streaming fashion (chunks of 500K), capping memory at ~500 MB regardless of portfolio size. Python's pandas requires loading the full DataFrame.

6. **Analysis-date-aware upload.** If analysis_date is provided during upload, the Rust module can pre-build and cache fixed cashflows immediately, making the first Calculate call faster.

### PyO3 + maturin setup

- Rust library crate in `backend/engine-rs/`
- `maturin develop` for development builds (compiles and installs into .venv)
- `maturin build --release` for production
- Python imports:
  ```python
  from almready_engine import parse_upload, compute_eve_nii
  ```
- The existing Python engine and upload pipeline remain as test oracles — never deleted

### Verification strategy

Every golden test from Steps 1-2 runs against both engines:
```python
# Calculation verification
def test_fixed_bullet_eve():
    python_result = python_engine.compute(test_position, test_curve)
    rust_result = rust_engine.compute(test_position, test_curve)
    assert abs(python_result.eve - rust_result.eve) < 0.01
    assert abs(python_result.nii - rust_result.nii) < 0.01

# Upload verification
def test_upload_round_trip():
    python_df = python_upload.parse(test_csv_bytes, bank_id="unicaja")
    rust_df = rust_engine.parse_upload(test_csv_bytes, bank_id="unicaja")
    pd.testing.assert_frame_equal(python_df, rust_df)
```

### Migration path

1. Start with the upload module (simpler — no financial formulas, just parsing/classification)
2. Then calculation: implement one instrument type at a time, starting with `fixed_bullet`
3. Each type gets its own golden test comparison (Rust vs Python)
4. Once all types pass, switch routes to use the Rust engine
5. Keep Python engine importable for debugging and comparison
6. Flag to choose engine: `ALMREADY_ENGINE=rust` or `python`

### Long-term Tauri integration (future, beyond this overhaul)

Once the Rust engine is mature:
- Move HTTP serving from Python/FastAPI to Rust (Axum)
- Tauri calls engine in-process (no sidecar, no subprocess)
- Single binary: Tauri shell + engine + HTTP server
- Eliminate PyInstaller, sidecar_main.py, port protocol
- App size: ~110 MB → ~20 MB
- Startup: ~5 seconds → ~0.5 seconds

### Acceptance criteria for Step 4

**Upload:**
- [ ] Rust upload produces identical DataFrames to Python for all upload audit tests
- [ ] 1.5M positions parsed in < 25 seconds
- [ ] 5M positions parsed without exceeding 2 GB RAM (streaming)
- [ ] Strict validation: surface data quality errors before calculation

**Calculation:**
- [ ] Rust engine produces identical results to Python engine for all golden tests
- [ ] 1.5M positions in < 30 seconds on the development machine
- [ ] Peak RAM < 2 GB
- [ ] `calculate.py` uses Rust engine by default, Python engine available as fallback
- [ ] `maturin develop` workflow documented
- [ ] Cross-platform: compiles on macOS (x64 + arm64) and Windows (x64)

---

## 10. Step 5 — Callable Bonds & Monte Carlo

### Objective

Add stochastic simulation capability for instruments whose value depends on future interest rate paths (callable bonds, putable bonds, and eventually mortgage prepayment modeling with rate-dependent CPR).

### Why this is different

The existing engine is **deterministic**: given a position and a curve, the cashflows are uniquely determined. A callable bond is **stochastic**: the issuer's call decision depends on where rates will be in the future, which requires simulating many possible rate paths and averaging the outcomes.

### Computational model

1. Generate N interest rate paths (e.g., N=1000) from a calibrated stochastic model (Hull-White, SABR, or simpler short-rate models)
2. For each path, project the bond's cashflows (including the call decision at each call date)
3. Discount each path's cashflows back to present value
4. EVE = average PV across all paths
5. NII = similar averaging of interest income across paths

### Why Rust from the start

Monte Carlo inner loop: 1000 paths × 360 cashflow dates × evaluation at each = 360,000 operations per position. For 10,000 callable bonds: 3.6 billion operations. In Python: ~minutes. In Rust: ~milliseconds.

### Academic reference tests

Unlike deterministic instruments (verifiable by hand), Monte Carlo results require:
- Convergence tests (does the result stabilize as N increases?)
- Comparison against known analytical approximations (Black's model for European calls)
- Published academic benchmarks

### Acceptance criteria for Step 5

- [ ] Hull-White or equivalent short-rate model implemented in Rust
- [ ] Callable bond EVE computed via Monte Carlo with configurable path count
- [ ] Convergence tests pass (result within 1% of analytical approximation at N=10000)
- [ ] Performance: 10K callable bonds in < 10 seconds
- [ ] Integration with main EVE/NII pipeline (callable positions automatically use MC engine)

---

## 11. Key File Reference

### Current engine files (Python)

| File | Role | Lines |
|---|---|---|
| `backend/app/routers/calculate.py` | API route, orchestrates EVE/NII calculation | ~580 |
| `backend/app/main.py` | FastAPI app, ProcessPoolExecutor lifecycle | ~130 |
| `backend/engine/workers.py` | Picklable worker functions for multiprocessing | ~142 |
| `backend/engine/services/eve.py` | Cashflow generation (8 projectors) + build_eve_cashflows | ~1394 |
| `backend/engine/services/eve_analytics.py` | EVE discounting + bucket breakdown | ~260 |
| `backend/engine/services/nii.py` | NII computation from cashflows + margin calibration | ~1200 |
| `backend/engine/services/nii_projectors.py` | 6 NII cycle projectors (renewal-based) | ~1000 |
| `backend/engine/services/nmd_behavioural.py` | NMD core/non-core expansion | ~200 |
| `backend/engine/services/market.py` | ForwardCurveSet, rate/df interpolation | ~300 |
| `backend/engine/services/regulatory_curves.py` | 6 EBA stress scenario curve builders | ~200 |
| `backend/engine/config/eve_buckets.py` | 19 regulatory EVE time buckets | ~50 |
| `backend/engine/config/nmd_buckets.py` | 19 EBA NMD buckets with midpoints | ~50 |

### What-If engine files

| File | Role |
|---|---|
| `backend/engine/services/whatif/__init__.py` | Package exports |
| `backend/engine/services/whatif/_v1.py` | V1 what-if delta computation |
| `backend/engine/services/whatif/decomposer.py` | LoanSpec → motor positions |
| `backend/engine/services/whatif/find_limit.py` | Binary search solver |
| `backend/app/routers/whatif.py` | What-If API endpoints |

### Test files

| File | Tests |
|---|---|
| `backend/engine/tests/test_eve.py` | EVE cashflow + discounting tests |
| `backend/engine/tests/test_nii.py` | NII computation tests |
| `backend/engine/tests/test_nmd_behavioural.py` | NMD expansion tests |
| `backend/engine/tests/test_prepayment.py` | CPR overlay tests |
| `backend/engine/tests/test_term_deposit_redemption.py` | TDRR tests |
| `backend/engine/tests/test_behavioural_integration.py` | End-to-end behavioural |
| `backend/engine/tests/test_whatif_decomposer.py` | Decomposer tests |
| `backend/engine/tests/test_whatif_find_limit.py` | Find-limit solver tests |
| **To be created:** `backend/engine/tests/audit/` | Golden test suite (Step 1) |

---

## 12. Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-03-01 | Rust via PyO3 for engine rewrite | Already in stack (Tauri), best performance + safety combo, eliminates sidecar long-term |
| 2026-03-01 | Audit before optimizing | Must verify correctness before changing anything; golden tests become permanent anchor |
| 2026-03-01 | New instruments in main engine, not just What-If | Balance sheets contain these instruments; excluding them is a methodological error |
| 2026-03-01 | Python algorithmic fix before Rust | Creates test oracle, makes app usable during Rust development, prototypes correct architecture |
| 2026-03-01 | Monte Carlo deferred to after Rust engine | Python too slow for MC inner loop; Rust infrastructure needed first |
| 2026-03-01 | Sequential scenarios (Python step) over parallel | 7 parallel workers × 5-6 GB = 35-42 GB impossible on 8 GB; sequential with cleanup = ~3 GB |
| 2026-03-01 | Server migration is orthogonal to engine optimization | Optimizing locally makes server cheaper/easier, not harder; infrastructure vs algorithm are independent concerns |
| 2026-03-01 | ~~Defer Rust for upload pipeline~~ **REVISED** | ~~Low ROI~~ → Include upload in same Rust crate as calculation engine; marginal cost is low when PyO3 infra exists, and scaling to 5M+ positions demands it |
| 2026-03-01 | ~~No pre-computation during upload~~ **REVISED** | ~~Params not known~~ → Workflow change: analysis_date set before/during upload enables pre-building fixed cashflows. Cache invalidated only on date change or re-upload |
| 2026-03-01 | Upload audit included in Step 1 (Part A) | Data integrity through parse → store → reload is foundational; wrong parsing makes all downstream calculations silently wrong |
| 2026-03-01 | Single Rust crate for upload + calculation | Shared types (Position, Cashflow, Curve), one build, one CI step, one cross-platform binary |
| 2026-03-01 | Tauri upload bug: investigate separately | Upload stalls at high % in Tauri app but works in browser; likely webview/sidecar interaction issue, not engine |
