# Análisis Técnico Exhaustivo: ALMReady - Sistema de Gestión ALM y Cálculo EVE/NII

## RESUMEN EJECUTIVO

ALMReady es una aplicación full-stack para Asset-Liability Management (ALM) que calcula métricas de riesgo de tasa de interés (IRRBB): Economic Value of Equity (EVE) y Net Interest Income (NII). El sistema procesa balances bancarios y curvas de rendimiento desde archivos Excel, aplica escenarios regulatorios de shock de tasas, y genera métricas de impacto.

**Stack Tecnológico:**
- **Backend**: Python 3.x + FastAPI + Pandas + NumPy + Pydantic v2
- **Frontend**: React 18 + TypeScript + Vite + Recharts + Radix UI
- **Persistencia**: Sistema de archivos JSON (sesiones por UUID)
- **Comunicación**: REST API + CORS habilitado para desarrollo local

---

## 1. ARQUITECTURA GENERAL DEL SISTEMA

### 1.1 Estructura de Directorios

```
ALMReady-03022026-FrontBack/
├── backend/
│   ├── app/
│   │   └── main.py                      # API FastAPI completa (1553 líneas)
│   ├── data/
│   │   └── sessions/
│   │       └── {session_id}/            # UUID de sesión
│   │           ├── meta.json            # Metadata de sesión
│   │           ├── balance_summary.json # Resumen de balance
│   │           ├── balance_positions.json # Posiciones canonicalizadas
│   │           ├── balance_contracts.json # Contratos simplificados
│   │           ├── curves_summary.json  # Catálogo de curvas
│   │           ├── curves_points.json   # Puntos de curvas
│   │           ├── balance__*.xlsx      # Excel subido
│   │           └── curves__*.xlsx       # Excel de curvas subido
│   └── requirements.txt                 # Dependencias Python
│
├── src/
│   ├── components/
│   │   ├── connected/
│   │   │   └── BalancePositionsCardConnected.tsx  # Gestión de sesión + API
│   │   ├── whatif/
│   │   │   ├── WhatIfContext.tsx                  # Estado global What-If
│   │   │   ├── WhatIfBuilder.tsx                  # UI constructor What-If
│   │   │   ├── WhatIfAddTab.tsx                   # Tab de adiciones
│   │   │   ├── WhatIfRemoveTab.tsx                # Tab de remociones
│   │   │   └── BalanceDetailsModalRemove.tsx      # Modal remove granular
│   │   ├── behavioural/
│   │   │   ├── BehaviouralContext.tsx             # Estado supuestos comportamentales
│   │   │   ├── BehaviouralAssumptionsModal.tsx    # UI configuración NMD/prepagos
│   │   │   └── NMDCashflowChart.tsx               # Gráfico NMD
│   │   ├── results/
│   │   │   ├── EVEChart.tsx                       # Visualización EVE
│   │   │   └── NIIChart.tsx                       # Visualización NII
│   │   ├── ui/                                    # 49 componentes Radix/shadcn
│   │   ├── BalancePositionsCard.tsx               # Card balance principal
│   │   ├── BalanceDetailsModal.tsx                # Modal detalles read-only
│   │   ├── CurvesAndScenariosCard.tsx             # Card curvas + escenarios
│   │   └── ResultsCard.tsx                        # Card resultados EVE/NII
│   │
│   ├── lib/
│   │   ├── api.ts                                 # Cliente HTTP + tipos API
│   │   ├── session.ts                             # Gestión localStorage sesión
│   │   ├── calculationEngine.ts                   # Motor de cálculo EVE/NII
│   │   ├── balanceUi.ts                           # Mapeo backend→UI tree
│   │   ├── scenarios.ts                           # Fórmulas de shocks IRRBB
│   │   ├── calendarLabels.ts                      # Conversión tenor→fecha
│   │   └── curves/
│   │       ├── labels.ts                          # Labels amigables de curvas
│   │       └── scenarios.ts                       # Lógica de escenarios
│   │
│   ├── types/
│   │   ├── financial.ts                           # Tipos core financieros
│   │   └── whatif.ts                              # Tipos modificaciones What-If
│   │
│   ├── hooks/
│   │   └── useSession.ts                          # Hook bootstrap sesión
│   │
│   └── pages/
│       └── Index.tsx                              # Orquestador principal (130 líneas)
│
├── package.json                                   # Dependencias Node
├── vite.config.ts                                 # Config Vite
├── tailwind.config.ts                             # Config Tailwind
└── tsconfig.json                                  # Config TypeScript
```

### 1.2 Flujo de Datos End-to-End

```
┌────────────────────────────────────────────────────────────────────┐
│ USUARIO                                                            │
└────────────────────────────────────────────────────────────────────┘
                              │
                              │ 1. Abre aplicación
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ FRONTEND: Index.tsx (React)                                        │
├────────────────────────────────────────────────────────────────────┤
│ • useSession() → getOrCreateSessionId()                            │
│   └─ localStorage.getItem("almready_session_id")                   │
│   └─ Si no existe: POST /api/sessions → nuevo UUID                │
│                                                                     │
│ • Estado global:                                                   │
│   - positions: Position[]                                          │
│   - curves: YieldCurve[]                                           │
│   - selectedCurves: string[]                                       │
│   - scenarios: Scenario[]                                          │
│   - results: CalculationResults | null                             │
│                                                                     │
│ • Contextos:                                                       │
│   - BehaviouralProvider (NMD, prepagos, term deposits)             │
│   - WhatIfProvider (modificaciones add/remove)                     │
└────────────────────────────────────────────────────────────────────┘
                              │
                              │ 2. Usuario sube Excel de Balance
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ BalancePositionsCardConnected                                      │
├────────────────────────────────────────────────────────────────────┤
│ handleExcelUpload(file):                                           │
│   POST /api/sessions/{id}/balance                                 │
│   Content-Type: multipart/form-data                                │
│   Body: file=balance.xlsx                                          │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ BACKEND: FastAPI main.py                                           │
├────────────────────────────────────────────────────────────────────┤
│ @app.post("/api/sessions/{session_id}/balance")                    │
│                                                                     │
│ 1. Recibe Excel (.xlsx/.xls)                                       │
│ 2. _parse_workbook(wb):                                            │
│    ├─ Filtra hojas por prefijo A_, L_, E_, D_                      │
│    ├─ Ignora metadata (README, SCHEMA_*, BALANCE_*, CURVES_*)      │
│    ├─ Valida columnas requeridas (num_sec_ac, lado_balance, etc.)  │
│    └─ Por cada fila: _canonicalize_position_row()                  │
│        ├─ Genera contract_id único                                 │
│        ├─ Normaliza side (asset/liability/equity/derivative)       │
│        ├─ Mapea subcategory_id con SUBCATEGORY_ID_ALIASES          │
│        ├─ Calcula maturity_years desde fecha_vencimiento           │
│        ├─ REGLA ESPECIAL: deposits → maturity_years = 0.0          │
│        ├─ Calcula maturity_bucket (<1Y, 1-5Y, 5-10Y, etc.)         │
│        ├─ Normaliza rate_type (Fixed/Floating)                     │
│        └─ Extrae rate_display según tipo                           │
│                                                                     │
│ 3. Genera agregaciones:                                            │
│    ├─ _build_category_tree() para Assets/Liabilities               │
│    │   ├─ Agrupa por subcategory_id                                │
│    │   ├─ Calcula weighted avg rate y maturity                     │
│    │   └─ Ordena por ASSET_/LIABILITY_SUBCATEGORY_ORDER            │
│    └─ _build_optional_side_tree() para Equity/Derivatives          │
│                                                                     │
│ 4. Persiste en disco:                                              │
│    ├─ balance_summary.json (BalanceUploadResponse completo)        │
│    ├─ balance_positions.json (array canonical_rows)                │
│    ├─ balance_contracts.json (array simplificado)                  │
│    └─ balance__original.xlsx (copia del archivo)                   │
│                                                                     │
│ 5. Retorna: BalanceUploadResponse                                  │
│    ├─ session_id, filename, uploaded_at                            │
│    ├─ sheets: [BalanceSheetSummary]                                │
│    ├─ sample_rows: {sheet: [primeras 3 filas]}                     │
│    └─ summary_tree: BalanceSummaryTree (jerarquía completa)        │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ BalancePositionsCardConnected (Frontend)                           │
├────────────────────────────────────────────────────────────────────┤
│ refreshSummary():                                                  │
│   GET /api/sessions/{id}/balance/summary                           │
│                                                                     │
│ mapSummaryToPositions(summary):                                    │
│   └─ Convierte sheets a Position[] para state                      │
│                                                                     │
│ onPositionsChange(positions)                                       │
│   └─ setPositions() en Index.tsx                                   │
└────────────────────────────────────────────────────────────────────┘
                              │
                              │ 3. Usuario sube Excel de Curvas
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ CurvesAndScenariosCard                                             │
├────────────────────────────────────────────────────────────────────┤
│ handleCurvesUpload(file):                                          │
│   POST /api/sessions/{id}/curves                                  │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ BACKEND: main.py                                                   │
├────────────────────────────────────────────────────────────────────┤
│ @app.post("/api/sessions/{session_id}/curves")                     │
│                                                                     │
│ 1. _parse_curves_workbook(wb):                                     │
│    ├─ Busca primera hoja con 2+ columnas                           │
│    ├─ Columna 1 = curve_id                                         │
│    ├─ Columnas 2..N = tenores (ON, 1M, 3M, 1Y, etc.)               │
│    ├─ Valida regex tenor: ^\s*(\d+)\s*([DWMY])\s*$                 │
│    ├─ Convierte tenor → t_years:                                   │
│    │   ├─ "ON" → 1/365                                             │
│    │   ├─ "1W" → 7/365                                             │
│    │   ├─ "1M" → 1/12                                              │
│    │   └─ "1Y" → 1.0                                               │
│    ├─ Ordena points por t_years                                    │
│    └─ _extract_currency_from_curve_id():                           │
│        └─ Si curve_id tiene "_": toma primer token de 3 chars      │
│                                                                     │
│ 2. Genera catálogo:                                                │
│    ├─ CurveCatalogItem por cada curva                              │
│    │   ├─ curve_id, currency, label_tech                           │
│    │   └─ points_count, min_t, max_t                               │
│    └─ default_discount_curve_id:                                   │
│        └─ "EUR_ESTR_OIS" si existe, sino primera curva             │
│                                                                     │
│ 3. Persiste:                                                       │
│    ├─ curves_summary.json (CurvesSummaryResponse)                  │
│    ├─ curves_points.json ({curve_id: [CurvePoint]})                │
│    └─ curves__original.xlsx                                        │
│                                                                     │
│ 4. Retorna: CurvesSummaryResponse                                  │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ CurvesAndScenariosCard (Frontend)                                  │
├────────────────────────────────────────────────────────────────────┤
│ Para cada curva en summary.curves:                                 │
│   getCurvePoints(sessionId, curve_id)                              │
│   └─ GET /api/sessions/{id}/curves/{curve_id}                      │
│                                                                     │
│ buildScenarioPoints(basePoints, scenarios):                        │
│   └─ Aplica shocks para visualización                              │
│                                                                     │
│ Renderiza:                                                         │
│   ├─ Chart de Curvas base (Recharts LineChart)                     │
│   └─ Chart de Escenarios (shocks aplicados)                        │
└────────────────────────────────────────────────────────────────────┘
                              │
                              │ 4. Usuario configura What-If
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ WhatIfBuilder (Sheet modal)                                        │
├────────────────────────────────────────────────────────────────────┤
│ Tab "Add":                                                         │
│   ├─ PRODUCT_TEMPLATES (7 plantillas)                              │
│   │   ├─ Fixed-rate Loan Portfolio                                 │
│   │   ├─ Floating-rate Loan Portfolio                              │
│   │   ├─ Bond Portfolio                                            │
│   │   ├─ Non-Maturing Deposits                                     │
│   │   ├─ Term Deposits                                             │
│   │   ├─ Wholesale Funding                                         │
│   │   └─ Interest Rate Swap                                        │
│   └─ addModification({type: 'add', ...}) → WhatIfContext           │
│                                                                     │
│ Tab "Remove":                                                      │
│   ├─ Árbol de subcategorías desde balance tree                     │
│   ├─ Search de contratos (GET /balance/contracts con filtros)      │
│   └─ addModification({type: 'remove', ...})                        │
│                                                                     │
│ Click "Apply":                                                     │
│   └─ applyModifications() → setIsApplied(true)                     │
└────────────────────────────────────────────────────────────────────┘
                              │
                              │ 5. Usuario selecciona escenarios
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ CurvesAndScenariosCard                                             │
├────────────────────────────────────────────────────────────────────┤
│ Toggle enable/disable escenarios:                                  │
│   ├─ Parallel Up (+200 bps)                                        │
│   ├─ Parallel Down (-200 bps)                                      │
│   ├─ Steepener (+150 bps diferencial)                              │
│   ├─ Flattener (+150 bps diferencial)                              │
│   ├─ Short Up (+250 bps en short end)                              │
│   └─ Short Down (-250 bps en short end)                            │
│                                                                     │
│ onScenariosChange(scenarios) → setScenarios() en Index             │
└────────────────────────────────────────────────────────────────────┘
                              │
                              │ 6. Usuario hace click "Calculate EVE & NII"
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ Index.tsx                                                          │
├────────────────────────────────────────────────────────────────────┤
│ handleCalculate():                                                 │
│   ├─ Validación: canCalculate                                      │
│   │   ├─ positions.length > 0                                      │
│   │   ├─ selectedCurves.length > 0                                 │
│   │   └─ scenarios.some(s => s.enabled)                            │
│   │                                                                 │
│   ├─ baseCurve = curves[0] || SAMPLE_YIELD_CURVE                   │
│   ├─ discountCurve = baseCurve                                     │
│   │                                                                 │
│   └─ runCalculation(positions, baseCurve, discountCurve, scenarios)│
└────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ calculationEngine.ts (FRONTEND LOCAL)                              │
├────────────────────────────────────────────────────────────────────┤
│ runCalculation():                                                  │
│                                                                     │
│ PASO 1: Generar Cashflows                                          │
│   Para cada position:                                              │
│     ├─ yearsToMaturity = (maturityDate - today) / 365.25 días      │
│     ├─ Generar flujos anuales de interés:                          │
│     │   amount = notional * couponRate                             │
│     │   sign = instrumentType === 'Asset' ? 1 : -1                 │
│     ├─ Agregar principal al vencimiento                            │
│     └─ Cashflow {positionId, date, amount, type}                   │
│                                                                     │
│ PASO 2: Base Case (sin shocks)                                     │
│   discountCashflows(allCashflows, baseCurve):                      │
│     ├─ Para cada cashflow:                                         │
│     │   ├─ yearsToPayment = (date - today) / 365.25 días           │
│     │   ├─ rate = getInterpolatedRate(curve, yearsToPayment)       │
│     │   │   └─ Interpolación lineal entre puntos de curva          │
│     │   ├─ discountFactor = exp(-rate * yearsToPayment)            │
│     │   └─ presentValue = amount * discountFactor                  │
│     │                                                               │
│   baseEve = Σ(presentValue)                                        │
│   baseNii = Σ(interest flows en próximos 12 meses)                 │
│                                                                     │
│ PASO 3: Escenarios (con shocks)                                    │
│   Para cada scenario.enabled:                                      │
│     ├─ applyScenarioShock(baseCurve, scenario):                    │
│     │   ├─ shockDecimal = shockBps / 10000                         │
│     │   └─ Según scenario.name:                                    │
│     │       ├─ "Parallel Up": rate + shockDecimal                  │
│     │       ├─ "Parallel Down": rate - shockDecimal                │
│     │       ├─ "Steepener":                                        │
│     │       │   ├─ Short (≤2Y): rate - shockDecimal                │
│     │       │   └─ Long: rate + shockDecimal * (tenor/10)          │
│     │       ├─ "Flattener":                                        │
│     │       │   ├─ Short (≤2Y): rate + shockDecimal                │
│     │       │   └─ Long: rate - shockDecimal * (tenor/10)          │
│     │       ├─ "Short Up" (≤3Y):                                   │
│     │       │   └─ rate + shockDecimal * (3-tenor)/3               │
│     │       └─ "Short Down": similar pero negativo                 │
│     │                                                               │
│     ├─ scenarioEve = discountCashflows(cf, shockedCurve)           │
│     ├─ deltaEve = scenarioEve - baseEve                            │
│     ├─ scenarioNii = calculateNII(cf)  [NOTA: igual que base]      │
│     ├─ deltaNii = scenarioNii - baseNii                            │
│     │                                                               │
│     └─ ScenarioResult {                                            │
│         scenarioId, scenarioName,                                  │
│         eve, nii, deltaEve, deltaNii                               │
│       }                                                             │
│                                                                     │
│ PASO 4: Identificar Worst Case                                     │
│   worstCaseEve = MIN(scenarioEve para todos)                       │
│   worstCaseScenario = scenario con MIN EVE                         │
│   worstCaseDeltaEve = worstCaseEve - baseEve                       │
│                                                                     │
│ RETORNO: CalculationResults {                                      │
│   baseEve, baseNii,                                                │
│   worstCaseEve, worstCaseDeltaEve, worstCaseScenario,             │
│   scenarioResults: [ScenarioResult],                               │
│   calculatedAt: ISO timestamp                                      │
│ }                                                                   │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ Index.tsx                                                          │
├────────────────────────────────────────────────────────────────────┤
│ setResults(calculationResults)                                     │
│ setIsCalculating(false)                                            │
└────────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ ResultsCard                                                        │
├────────────────────────────────────────────────────────────────────┤
│ Recibe: results, isCalculating                                     │
│                                                                     │
│ useWhatIf():                                                       │
│   ├─ modifications, isApplied, cet1Capital, analysisDate           │
│   └─ hasModifications = modifications.length > 0 && isApplied      │
│                                                                     │
│ Mock What-If Impacts (hardcoded):                                  │
│   ├─ baseEve: +12.5M si hasModifications                           │
│   ├─ worstEve: +8.2M si hasModifications                           │
│   ├─ baseNii: -2.1M si hasModifications                            │
│   └─ worstNii: -1.8M si hasModifications                           │
│                                                                     │
│ Tabs: EVE | NII                                                    │
│   ├─ Base Case Values                                              │
│   ├─ Worst Case Values                                             │
│   ├─ % impact sobre CET1 capital                                   │
│   ├─ EVEChart (BarChart con scenarioResults)                       │
│   └─ NIIChart (BarChart con scenarioResults)                       │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. BACKEND: ARQUITECTURA Y COMPONENTES

### 2.1 API Endpoints

#### Sesiones
```http
POST /api/sessions
Response: SessionMeta {
  session_id: string (UUID)
  created_at: string (ISO)
  status: "active"
  schema_version: "v1"
}

GET /api/sessions/{session_id}
Response: SessionMeta
```

#### Balance
```http
POST /api/sessions/{session_id}/balance
Content-Type: multipart/form-data
Body: file (Excel .xlsx/.xls)
Response: BalanceUploadResponse {
  session_id, filename, uploaded_at,
  sheets: [BalanceSheetSummary],
  sample_rows: {sheet_name: [3 filas]},
  summary_tree: BalanceSummaryTree
}

GET /api/sessions/{session_id}/balance/summary
Response: BalanceUploadResponse (igual que upload)

GET /api/sessions/{session_id}/balance/details
Query: categoria_ui, subcategoria_ui, subcategory_id,
       currency, rate_type, counterparty, maturity (CSV)
Response: BalanceDetailsResponse {
  session_id, categoria_ui, subcategoria_ui,
  groups: [BalanceDetailsGroup],
  totals: BalanceDetailsTotals,
  facets: BalanceDetailsFacets
}

GET /api/sessions/{session_id}/balance/contracts
Query: q (search), categoria_ui, subcategoria_ui, subcategory_id,
       currency, rate_type, counterparty, maturity, group (CSV),
       page, page_size
Response: BalanceContractsResponse {
  session_id, total, page, page_size,
  contracts: [BalanceContract]
}
```

#### Curvas
```http
POST /api/sessions/{session_id}/curves
Content-Type: multipart/form-data
Body: file (Excel .xlsx/.xls)
Response: CurvesSummaryResponse {
  session_id, filename, uploaded_at,
  default_discount_curve_id,
  curves: [CurveCatalogItem]
}

GET /api/sessions/{session_id}/curves/summary
Response: CurvesSummaryResponse

GET /api/sessions/{session_id}/curves/{curve_id}
Response: CurvePointsResponse {
  session_id, curve_id,
  points: [CurvePoint]
}
```

### 2.2 Modelos de Datos Pydantic

#### Balance Models
```python
BalanceSheetSummary:
  sheet: str                    # Nombre de hoja Excel
  rows: int                     # Cantidad de filas
  columns: list[str]            # Nombres de columnas
  total_saldo_ini: float | None
  total_book_value: float | None
  avg_tae: float | None

BalanceTreeNode:              # Subcategoría
  id: str                     # subcategory_id ("mortgages", "deposits", etc.)
  label: str                  # subcategoria_ui
  amount: float               # Suma de amounts
  positions: int              # Cantidad de contratos
  avg_rate: float | None      # Weighted average rate
  avg_maturity: float | None  # Weighted average maturity

BalanceTreeCategory:          # Categoría (Assets/Liabilities/Equity/Derivatives)
  id: str                     # "assets", "liabilities", "equity", "derivatives"
  label: str                  # "Assets", "Liabilities", etc.
  amount: float
  positions: int
  avg_rate: float | None
  avg_maturity: float | None
  subcategories: list[BalanceTreeNode]

BalanceSummaryTree:
  assets: BalanceTreeCategory | None
  liabilities: BalanceTreeCategory | None
  equity: BalanceTreeCategory | None
  derivatives: BalanceTreeCategory | None

BalanceContract:              # Contrato individual simplificado
  contract_id: str
  sheet: str | None
  category: str               # "asset", "liability", "equity", "derivative"
  categoria_ui: str | None
  subcategory: str            # subcategory_id
  subcategoria_ui: str | None
  group: str | None
  currency: str | None
  counterparty: str | None
  rate_type: str | None       # "Fixed" o "Floating"
  maturity_bucket: str | None # "<1Y", "1-5Y", "5-10Y", "10-20Y", ">20Y"
  maturity_years: float | None
  amount: float | None
  rate: float | None          # rate_display
```

#### Curves Models
```python
CurvePoint:
  tenor: str                  # "ON", "1W", "1M", "3M", "1Y", "5Y", etc.
  t_years: float              # Tiempo en años (0.0027 para ON, 1.0 para 1Y)
  rate: float                 # Tasa en decimal (0.0285 = 2.85%)

CurveCatalogItem:
  curve_id: str               # "EUR_ESTR_OIS", "EUR_EURIBOR_3M", etc.
  currency: str | None        # "EUR" (extraído de curve_id)
  label_tech: str             # curve_id como está
  points_count: int           # Cantidad de puntos
  min_t: float | None         # Tenor mínimo en años
  max_t: float | None         # Tenor máximo en años

CurvesSummaryResponse:
  session_id: str
  filename: str
  uploaded_at: str
  default_discount_curve_id: str | None
  curves: list[CurveCatalogItem]

CurvePointsResponse:
  session_id: str
  curve_id: str
  points: list[CurvePoint]
```

### 2.3 Parser de Balance Excel

**Entrada esperada:**
- Archivo Excel (.xlsx/.xls)
- Hojas con prefijos: `A_` (Assets), `L_` (Liabilities), `E_` (Equity), `D_` (Derivatives)
- Columnas requeridas para A_, L_, E_:
  - `num_sec_ac` (ID de contrato)
  - `lado_balance` (Asset/Liability/Equity/Derivative)
  - `categoria_ui` (categoría UI)
  - `subcategoria_ui` (subcategoría UI)
  - `grupo` (grupo)
  - `moneda` (currency)
  - `saldo_ini` (saldo inicial / amount)
  - `tipo_tasa` (fijo/variable)
- Columnas opcionales: `book_value`, `tae`, `tasa_fija`, `spread`, `indice_ref`, `fecha_vencimiento`, etc.

**Proceso de parsing:**

1. **Filtrado de hojas:**
   - Ignora hojas metadata: "README", "SCHEMA_BASE", "SCHEMA_DERIV", "BALANCE_CHECK", "BALANCE_SUMMARY", "CURVES_ENUMS"
   - Solo procesa hojas que empiezan con `A_`, `L_`, `E_`, `D_`

2. **Validación de columnas:**
   - `_validate_base_sheet_columns()` verifica que todas las columnas requeridas existan
   - Si falta alguna, salta la hoja con warning

3. **Canonicalización de cada fila** (`_canonicalize_position_row()`):

   a. **contract_id:**
      - Si `num_sec_ac` existe → usar ese
      - Si no → generar `{sheet_name_slugified}-{row_index+1}`

   b. **side (normalización de lado_balance):**
      - "asset*" → "asset"
      - "liability*" → "liability"
      - "equity*" → "equity"
      - "derivative*" → "derivative"
      - Si vacío → usa prefijo de sheet_name (A_→asset, L_→liability, etc.)

   c. **categoria_ui:**
      - Usa valor de Excel si existe
      - Si vacío → "Assets"/"Liabilities"/"Equity"/"Derivatives" según side

   d. **subcategory_id (generación con mapeo):**
      ```python
      SUBCATEGORY_ID_ALIASES = {
        "mortgages": "mortgages",
        "mortgage": "mortgages",
        "loans": "loans",
        "securities": "securities",
        "interbank / central bank": "interbank",
        "deposits": "deposits",
        "term deposits": "term-deposits",
        "wholesale funding": "wholesale-funding",
        "debt issued": "debt-issued",
        "other liabilities": "other-liabilities",
        "equity": "equity",
      }
      ```
      - Primero intenta matching en ALIASES (normalizado lowercase)
      - Si no hay match → slugify(subcategoria_ui)
      - Si vacío subcategoria_ui → slugify(sheet_name sin prefijo)

   e. **amount:**
      - `_to_float(saldo_ini)` → convierte a float, maneja NaN
      - Si null → 0.0

   f. **rate_type (normalización de tipo_tasa):**
      ```python
      tipo_tasa_lower = tipo_tasa.lower().strip()
      if tipo_tasa_lower in ["fijo", "fixed"]:
        rate_type = "Fixed"
      elif tipo_tasa_lower in ["variable", "floating", "float", "nonrate", "non-rate", "no-rate"]:
        rate_type = "Floating"
      else:
        rate_type = None
      ```

   g. **rate_display (selección de tasa a mostrar):**
      - Si type == "fixed" → `tasa_fija`
      - Si type == "nonrate"/"non-rate"/"no-rate" → `tasa_fija` (fallback)
      - Si type == "variable"/"floating" → `tasa_fija` (por ahora)
      - Default → `tasa_fija`

   h. **maturity_years (cálculo complejo):**
      ```python
      # Primero: intenta calcular desde fecha_vencimiento
      if fecha_vencimiento:
        maturity_years = (fecha_vencimiento - hoy) / 365.25 días

      # Si negativo o null: usa core_avg_maturity_y (columna auxiliar)
      if maturity_years < 0 or maturity_years is None:
        maturity_years = core_avg_maturity_y

      # REGLA ESPECIAL: deposits siempre 0.0 (temporal hasta tratamiento comportamental)
      if subcategory_id == "deposits":
        maturity_years = 0.0
      ```

   i. **maturity_bucket (categorización):**
      ```python
      # REGLA ESPECIAL: deposits siempre "<1Y"
      if subcategory_id == "deposits":
        return "<1Y"

      # Sino, calcula desde maturity_years:
      if maturity_years < 1: return "<1Y"
      if 1 <= maturity_years < 5: return "1-5Y"
      if 5 <= maturity_years < 10: return "5-10Y"
      if 10 <= maturity_years < 20: return "10-20Y"
      if maturity_years >= 20: return ">20Y"
      ```

   j. **Otros campos (pass-through):**
      - `grupo`, `moneda`, `contraparte`, `spread`, `indice_ref`, `tenor_indice`
      - `fecha_inicio`, `fecha_vencimiento`, `fecha_prox_reprecio`
      - `repricing_bucket`

   k. **include_in_balance_tree:**
      - `true` si side == "asset" o "liability"
      - `false` si side == "equity" o "derivative"

4. **Agregaciones:**

   a. **_weighted_avg_rate(rows):**
      ```python
      weighted_sum = Σ(rate_display * abs(amount))
      weight = Σ(abs(amount))
      return weighted_sum / weight if weight > 0 else None
      ```

   b. **_weighted_avg_maturity(rows):**
      ```python
      weighted_sum = Σ(maturity_years * abs(amount))
      weight = Σ(abs(amount))
      return weighted_sum / weight if weight > 0 else None
      ```

   c. **_build_category_tree(rows, category):** (para Assets/Liabilities)
      ```python
      1. Filtra rows donde side == category y include_in_balance_tree == true
      2. Agrupa por subcategory_id
      3. Para cada subcategoría:
         - amount = Σ(amounts)
         - positions = count(rows)
         - avg_rate = _weighted_avg_rate(rows)
         - avg_maturity = _weighted_avg_maturity(rows)
      4. Ordena subcategorías:
         - Primero: por orden en ASSET_/LIABILITY_SUBCATEGORY_ORDER
         - Luego: por amount descendente
         - Finalmente: por label alfabético
      5. Calcula totales de categoría (suma de subcategorías)
      ```

      Órdenes predefinidos:
      ```python
      ASSET_SUBCATEGORY_ORDER = [
        "mortgages", "loans", "securities", "interbank", "other-assets"
      ]

      LIABILITY_SUBCATEGORY_ORDER = [
        "deposits", "term-deposits", "wholesale-funding", "debt-issued", "other-liabilities"
      ]
      ```

   d. **_build_optional_side_tree(rows, category):** (para Equity/Derivatives)
      ```python
      1. Filtra rows donde side == category (sin filtro include_in_balance_tree)
      2. Agrupa por subcategory_id
      3. Calcula agregados igual que _build_category_tree
      4. Ordena solo por label alfabético
      ```

5. **Salida:**
   - `canonical_rows`: Array de todas las filas canonicalizadas
   - `sheet_summaries`: Metadata de cada hoja (rows, cols, totales)
   - `sample_rows`: Primeras 3 filas de cada hoja (para UI templates)
   - `summary_tree`: BalanceSummaryTree con jerarquía completa

### 2.4 Parser de Curvas Excel

**Entrada esperada:**
- Archivo Excel (.xlsx/.xls)
- Primera hoja válida con:
  - Columna 1: IDs de curvas (ej: "EUR_ESTR_OIS", "EUR_EURIBOR_3M")
  - Columnas 2..N: Tenores (headers como "ON", "1W", "1M", "3M", "1Y", "5Y", etc.)

**Proceso:**

1. **Búsqueda de hoja válida:**
   - Itera hojas hasta encontrar una con ≥2 columnas
   - Verifica que columnas 2..N tengan headers parseables como tenores

2. **Validación de tenores:**
   ```python
   Regex: ^\s*(\d+)\s*([DWMY])\s*$

   Ejemplos válidos:
   - "ON" → caso especial
   - "1W" → 1 semana
   - "2W" → 2 semanas
   - "1M" → 1 mes
   - "3M" → 3 meses
   - "1Y" → 1 año
   - "10Y" → 10 años
   ```

3. **Conversión tenor → años (`_tenor_to_years()`):**
   ```python
   if tenor == "ON": return 1/365

   match = re.match(r'(\d+)\s*([DWMY])', tenor)
   number = int(match[1])
   unit = match[2].upper()

   if unit == 'D': return number / 365
   if unit == 'W': return number * 7 / 365
   if unit == 'M': return number / 12
   if unit == 'Y': return number
   ```

4. **Extracción de divisa (`_extract_currency_from_curve_id()`):**
   ```python
   if "_" in curve_id:
     first_token = curve_id.split("_")[0]
     if len(first_token) == 3 and first_token.isalpha():
       return first_token.upper()  # ej: "EUR"
   return None
   ```

5. **Procesamiento de puntos:**
   - Para cada fila con curve_id válido
   - Para cada tenor (columna), extrae rate
   - Convierte rate a float (maneja NaN)
   - Crea CurvePoint {tenor, t_years, rate}
   - Ordena puntos por t_years

6. **Catálogo de curvas:**
   - CurveCatalogItem por cada curve_id
   - Calcula min_t, max_t, points_count

7. **Curva por defecto:**
   ```python
   if "EUR_ESTR_OIS" in curve_ids:
     default_discount_curve_id = "EUR_ESTR_OIS"
   else:
     default_discount_curve_id = first_curve_id
   ```

**Salida:**
- `curves_summary.json`: CurvesSummaryResponse con catálogo
- `curves_points.json`: Dict {curve_id: [CurvePoint]}

### 2.5 Sistema de Persistencia

**Directorio por sesión:** `/backend/data/sessions/{session_id}/`

**Archivos generados:**

```
meta.json                    # SessionMeta
{
  "session_id": "uuid",
  "created_at": "2026-02-16T23:00:00+00:00",
  "status": "active",
  "schema_version": "v1"
}

balance_summary.json         # BalanceUploadResponse completo
{
  "session_id": "uuid",
  "filename": "Balance_Q4_2024.xlsx",
  "uploaded_at": "2026-02-16T23:00:00+00:00",
  "sheets": [BalanceSheetSummary],
  "sample_rows": {
    "A_Cash_CentralBank": [{row1}, {row2}, {row3}],
    ...
  },
  "summary_tree": {
    "assets": {
      "id": "assets",
      "label": "Assets",
      "amount": 1234567890.12,
      "positions": 1500,
      "avg_rate": 0.0345,
      "avg_maturity": 3.5,
      "subcategories": [
        {
          "id": "mortgages",
          "label": "Mortgages",
          "amount": 500000000,
          "positions": 500,
          "avg_rate": 0.025,
          "avg_maturity": 15.0
        },
        ...
      ]
    },
    "liabilities": { ... },
    "equity": { ... },
    "derivatives": { ... }
  }
}

balance_positions.json       # Array de canonical_rows
[
  {
    "contract_id": "A_CASH_00001",
    "sheet": "A_Cash_CentralBank",
    "side": "asset",
    "categoria_ui": "Assets",
    "subcategoria_ui": "Interbank / Central Bank",
    "subcategory_id": "interbank",
    "group": "Cash & Central Bank",
    "currency": "EUR",
    "counterparty": "Central Bank",
    "amount": 31986098.72,
    "book_value": 31986098.72,
    "rate_type": "Floating",
    "rate_display": null,
    "tipo_tasa_raw": "nonrate",
    "tasa_fija": null,
    "spread": null,
    "indice_ref": null,
    "tenor_indice": null,
    "fecha_inicio": "2025-12-31",
    "fecha_vencimiento": null,
    "fecha_prox_reprecio": null,
    "maturity_years": null,
    "maturity_bucket": null,
    "repricing_bucket": null,
    "include_in_balance_tree": true
  },
  ...
]

balance_contracts.json       # Array simplificado para búsquedas
[
  {
    "contract_id": "A_CASH_00001",
    "sheet": "A_Cash_CentralBank",
    "category": "asset",
    "categoria_ui": "Assets",
    "subcategory": "interbank",
    "subcategoria_ui": "Interbank / Central Bank",
    "group": "Cash & Central Bank",
    "currency": "EUR",
    "counterparty": "Central Bank",
    "rate_type": "Floating",
    "maturity_bucket": null,
    "maturity_years": null,
    "amount": 31986098.72,
    "rate": null
  },
  ...
]

curves_summary.json          # CurvesSummaryResponse
{
  "session_id": "uuid",
  "filename": "Curve_tenors_input.xlsx",
  "uploaded_at": "2026-02-16T23:00:00+00:00",
  "default_discount_curve_id": "EUR_ESTR_OIS",
  "curves": [
    {
      "curve_id": "EUR_ESTR_OIS",
      "currency": "EUR",
      "label_tech": "EUR_ESTR_OIS",
      "points_count": 28,
      "min_t": 0.0027,
      "max_t": 50.0
    },
    ...
  ]
}

curves_points.json           # Dict {curve_id: [CurvePoint]}
{
  "EUR_ESTR_OIS": [
    {"tenor": "ON", "t_years": 0.0027, "rate": 0.0285},
    {"tenor": "1W", "t_years": 0.0192, "rate": 0.0286},
    {"tenor": "1M", "t_years": 0.0833, "rate": 0.0289},
    {"tenor": "3M", "t_years": 0.25, "rate": 0.0295},
    {"tenor": "1Y", "t_years": 1.0, "rate": 0.0325},
    {"tenor": "5Y", "t_years": 5.0, "rate": 0.0380},
    {"tenor": "10Y", "t_years": 10.0, "rate": 0.0410},
    ...
  ],
  "EUR_EURIBOR_3M": [ ... ]
}

balance__Balance_Q4_2024.xlsx   # Archivo Excel subido (copia)
curves__Curve_tenors_input.xlsx # Archivo Excel de curvas (copia)
```

### 2.6 Funciones Utilitarias Backend

**Normalización:**
```python
_norm_key(text)              # strip().lower() para búsquedas
_slugify(text)               # lowercase, remove accents, alphanumeric+dash
_to_text(value)              # convierte a str, maneja NaN
_to_float(value)             # convierte a float, maneja NaN y strings
_to_iso_date(value)          # convierte a ISO 8601 date string
_serialize_value_for_json    # prepara valores para JSON (maneja datetime, etc.)
```

**Validación:**
```python
_validate_base_sheet_columns(df, sheet_name)
  # Verifica que existan columnas requeridas:
  # num_sec_ac, lado_balance, categoria_ui, subcategoria_ui,
  # grupo, moneda, saldo_ini, tipo_tasa

_is_position_sheet(sheet_name)
  # True si empieza con A_, L_, E_, D_ y no es metadata
```

**Conversiones:**
```python
_tenor_to_years(tenor_str)
  # ON → 1/365, 1W → 7/365, 1M → 1/12, 1Y → 1.0

_extract_currency_from_curve_id(curve_id)
  # "EUR_ESTR_OIS" → "EUR"
```

### 2.7 Filtrado y Búsqueda

**_apply_filters(rows, params):** Lógica de filtrado en cascada

```python
def _apply_filters(rows, params):
  filtered = rows.copy()

  # 1. Filtro por categoria_ui (Assets/Liabilities/etc.)
  if params.categoria_ui:
    filtered = [r for r in filtered if r.categoria_ui == params.categoria_ui]

  # 2. Filtro por subcategoria_ui o subcategory_id
  if params.subcategoria_ui or params.subcategory_id:
    filtered = [r for r in filtered if _matches_subcategory(r, params)]

  # 3. Filtro por grupo (split CSV)
  if params.group:
    group_set = _split_csv_values(params.group)
    filtered = [r for r in filtered if _matches_multi(r.group, group_set)]

  # 4. Filtro por moneda (split CSV)
  if params.currency:
    currency_set = _split_csv_values(params.currency)
    filtered = [r for r in filtered if _matches_multi(r.currency, currency_set)]

  # 5. Filtro por rate_type (split CSV)
  if params.rate_type:
    rate_type_set = _split_csv_values(params.rate_type)
    filtered = [r for r in filtered if _matches_multi(r.rate_type, rate_type_set)]

  # 6. Filtro por counterparty (split CSV)
  if params.counterparty:
    counterparty_set = _split_csv_values(params.counterparty)
    filtered = [r for r in filtered if _matches_multi(r.counterparty, counterparty_set)]

  # 7. Filtro por maturity (split CSV)
  if params.maturity:
    maturity_set = _split_csv_values(params.maturity)
    filtered = [r for r in filtered if _matches_multi(r.maturity_bucket, maturity_set)]

  # 8. Filtro por query_text (busca en contract_id, sheet, group)
  if params.query_text:
    query_lower = params.query_text.lower()
    filtered = [r for r in filtered if (
      query_lower in (r.contract_id or "").lower() or
      query_lower in (r.sheet or "").lower() or
      query_lower in (r.group or "").lower()
    )]

  # 9. Solo retorna filas con include_in_balance_tree == true
  filtered = [r for r in filtered if r.include_in_balance_tree]

  return filtered
```

**Helpers:**
```python
_split_csv_values(csv_string)
  # "EUR,USD,GBP" → {"eur", "usd", "gbp"}
  return set(v.strip().lower() for v in csv_string.split(","))

_matches_multi(value, value_set)
  # Si value_set vacío → True (permite todo)
  # Si value null → False
  # Sino: value.lower() in value_set

_matches_subcategory(row, params)
  # Compara por subcategory_id y/o subcategoria_ui (normalizado)
```

### 2.8 Paginación

**GET /api/sessions/{id}/balance/contracts:**

```python
def paginate(contracts, page, page_size, offset, limit):
  total = len(contracts)

  # Compatibilidad con offset/limit (API antigua)
  if offset is not None and limit is not None:
    start = offset
    end = offset + limit
  else:
    # Paginación moderna page/page_size
    start = (page - 1) * page_size
    end = start + page_size

  paginated = contracts[start:end]

  return BalanceContractsResponse(
    session_id=session_id,
    total=total,
    page=page,
    page_size=page_size,
    contracts=paginated
  )

# Validación:
# page_size: min=1, max=2000
```

---

## 3. FRONTEND: ARQUITECTURA Y COMPONENTES

### 3.1 Estado Global de la Aplicación

**Index.tsx** es el orquestador central que mantiene el estado principal:

```typescript
const [positions, setPositions] = useState<Position[]>([]);
const [curves, setCurves] = useState<YieldCurve[]>([]);
const [selectedCurves, setSelectedCurves] = useState<string[]>([]);
const [scenarios, setScenarios] = useState<Scenario[]>(DEFAULT_SCENARIOS);
const [results, setResults] = useState<CalculationResults | null>(null);
const [isCalculating, setIsCalculating] = useState(false);
```

**Validación de cálculo:**
```typescript
const canCalculate =
  positions.length > 0 &&
  selectedCurves.length > 0 &&
  scenarios.some((s) => s.enabled);
```

### 3.2 Contextos Globales

#### WhatIfContext (src/components/whatif/WhatIfContext.tsx)

**Estado:**
```typescript
modifications: WhatIfModification[]   // Array de modificaciones add/remove
isApplied: boolean                    // Si las modificaciones están aplicadas
analysisDate: Date | null             // Fecha de análisis
cet1Capital: number | null            // Capital CET1 para % calcs
```

**API:**
```typescript
addModification(mod: Omit<WhatIfModification, 'id'>): void
removeModification(id: string): void
clearModifications(): void
applyModifications(): void
resetAll(): void
```

**Computados:**
```typescript
addCount: number      // modifications.filter(m => m.type === 'add').length
removeCount: number   // modifications.filter(m => m.type === 'remove').length
```

**WhatIfModification:**
```typescript
interface WhatIfModification {
  id: string                    // UUID generado
  type: 'add' | 'remove'
  label: string                 // Nombre del producto
  details?: string              // Detalles adicionales
  notional?: number             // Monto nocional
  currency?: string             // Divisa
  category?: 'asset' | 'liability' | 'derivative'
  subcategory?: string          // ej: 'mortgages', 'deposits'
  rate?: number                 // Tasa de interés
  maturity?: number             // Plazo en años
  positionDelta?: number
  removeMode?: 'all' | 'contracts'
  contractIds?: string[]
}
```

#### BehaviouralContext (src/components/behavioural/BehaviouralContext.tsx)

**Estado:**
```typescript
activeProfile: BehaviouralProfile     // 'none' | 'nmd' | 'loan-prepayments' | 'term-deposits'
nmdParams: NMDParameters
loanPrepaymentParams: LoanPrepaymentParameters
termDepositParams: TermDepositParameters
isApplied: boolean
```

**NMDParameters:**
```typescript
interface NMDParameters {
  enabled: boolean
  coreProportion: number        // 0-100 (%)
  coreAverageMaturity: number   // 2-10 años
  passThrough: number           // 0-100 (%)
}
```

**LoanPrepaymentParameters:**
```typescript
interface LoanPrepaymentParameters {
  enabled: boolean
  smm: number                   // 0-50 (%) Single Monthly Mortality
}
```

**TermDepositParameters:**
```typescript
interface TermDepositParameters {
  enabled: boolean
  tdrr: number                  // 0-50 (%) Term Deposit Redemption Rate (monthly)
}
```

**Valores computados:**
```typescript
totalAverageMaturity: number    // (coreProportion / 100) * coreAverageMaturity
isValidMaturity: boolean        // totalAverageMaturity <= 5.0
cprFromSmm: number              // 1 - (1 - SMM)^12 * 100
annualTdrr: number              // 1 - (1 - monthly)^12 * 100
hasCustomAssumptions: boolean   // isApplied && activeProfile !== 'none'
```

### 3.3 Tipos de Datos Frontend

#### Tipos Financieros Core (src/types/financial.ts)

```typescript
interface Position {
  id: string
  instrumentType: 'Asset' | 'Liability'
  description: string
  notional: number              // Monto principal
  maturityDate: string          // YYYY-MM-DD
  couponRate: number            // Decimal (0.045 = 4.5%)
  repriceFrequency: 'Fixed' | 'Monthly' | 'Quarterly' | 'Semi-Annual' | 'Annual'
  currency: string
}

interface YieldCurvePoint {
  tenor: string                 // "1M", "3M", "1Y", "5Y", etc.
  tenorYears: number            // 0.083, 0.25, 1.0, 5.0
  rate: number                  // Decimal (0.0525 = 5.25%)
}

interface YieldCurve {
  id: string
  name: string
  currency: string
  asOfDate: string              // ISO date
  points: YieldCurvePoint[]
}

interface Scenario {
  id: string
  name: string                  // Nombre del escenario
  description?: string
  shockBps: number              // Basis points (100 bps = 1%)
  enabled: boolean
}

interface Cashflow {
  positionId: string
  date: string                  // YYYY-MM-DD
  amount: number
  type: 'Principal' | 'Interest'
}

interface DiscountedCashflow extends Cashflow {
  discountFactor: number        // exp(-rate * years)
  presentValue: number          // amount * discountFactor
}

interface ScenarioResult {
  scenarioId: string
  scenarioName: ScenarioType
  eve: number                   // EVE bajo este escenario
  nii: number                   // NII bajo este escenario
  deltaEve: number              // eve - baseEve
  deltaNii: number              // nii - baseNii
}

interface CalculationResults {
  baseEve: number
  baseNii: number
  worstCaseEve: number          // EVE del peor escenario
  worstCaseDeltaEve: number     // Delta EVE del peor escenario
  worstCaseScenario: string     // Nombre del escenario peor
  scenarioResults: ScenarioResult[]
  calculatedAt: string          // ISO timestamp
}
```

**Escenarios por defecto:**
```typescript
const DEFAULT_SCENARIOS: Scenario[] = [
  { id: '1', name: 'Parallel Up', shockBps: 200, enabled: true },
  { id: '2', name: 'Parallel Down', shockBps: 200, enabled: true },
  { id: '3', name: 'Steepener', shockBps: 150, enabled: true },
  { id: '4', name: 'Flattener', shockBps: 150, enabled: true },
  { id: '5', name: 'Short Up', shockBps: 250, enabled: false },
  { id: '6', name: 'Short Down', shockBps: 250, enabled: false },
];
```

### 3.4 Cliente API (src/lib/api.ts)

**Base URL:**
```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
```

**Funciones principales:**

```typescript
// Health check
export async function health(): Promise<{ status: string }>

// Sesiones
export async function createSession(): Promise<SessionMeta>
export async function getSession(sessionId: string): Promise<SessionMeta>

// Balance
export async function uploadBalanceExcel(
  sessionId: string,
  file: File
): Promise<BalanceSummaryResponse>

export async function getBalanceSummary(
  sessionId: string
): Promise<BalanceSummaryResponse>

export async function getBalanceDetails(
  sessionId: string,
  params?: BalanceDetailsQuery
): Promise<BalanceDetailsResponse>

export async function getBalanceContracts(
  sessionId: string,
  params?: BalanceContractsQuery
): Promise<BalanceContractsResponse>

// Curvas
export async function uploadCurvesExcel(
  sessionId: string,
  file: File
): Promise<CurvesSummaryResponse>

export async function getCurvesSummary(
  sessionId: string
): Promise<CurvesSummaryResponse>

export async function getCurvePoints(
  sessionId: string,
  curveId: string
): Promise<CurvePointsResponse>
```

**Manejo de errores:**
```typescript
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} on ${path}: ${text}`);
  }
  return (await res.json()) as T;
}
```

### 3.5 Gestión de Sesiones (src/lib/session.ts)

```typescript
const LS_KEY = "almready_session_id";

export async function getOrCreateSessionId(): Promise<string> {
  const existing = localStorage.getItem(LS_KEY);

  if (existing) {
    try {
      await getSession(existing);  // Valida sesión
      return existing;
    } catch (error) {
      const isSessionMissing = msg.includes("HTTP 404");
      if (isSessionMissing) {
        localStorage.removeItem(LS_KEY);  // Limpia sesión stale
      } else {
        throw error;
      }
    }
  }

  // Crea nueva sesión
  const meta = await createSession();
  localStorage.setItem(LS_KEY, meta.session_id);
  return meta.session_id;
}

export function clearSessionId() {
  localStorage.removeItem(LS_KEY);
}
```

**Hook useSession:**
```typescript
export function useSession() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    getOrCreateSessionId()
      .then(setSessionId)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { sessionId, loading, error };
}
```

### 3.6 Mapeo Backend → UI Tree (src/lib/balanceUi.ts)

**Órdenes de subcategorías:**
```typescript
const ASSET_SUBCATEGORY_ORDER = [
  "mortgages",
  "loans",
  "securities",
  "interbank",
  "other-assets",
];

const LIABILITY_SUBCATEGORY_ORDER = [
  "deposits",
  "term-deposits",
  "wholesale-funding",
  "debt-issued",
  "other-liabilities",
];
```

**Función de mapeo:**
```typescript
export function mapSummaryTreeToUiTree(
  summaryTree: BalanceSummaryTree | null | undefined
): BalanceUiTree {
  const assets = toCategoryTree(summaryTree?.assets, "assets", "Assets");
  const liabilities = toCategoryTree(summaryTree?.liabilities, "liabilities", "Liabilities");

  return {
    assets: {
      ...assets,
      subcategories: sortSubcategories(assets.subcategories, ASSET_SUBCATEGORY_ORDER),
    },
    liabilities: {
      ...liabilities,
      subcategories: sortSubcategories(liabilities.subcategories, LIABILITY_SUBCATEGORY_ORDER),
    },
  };
}

function sortSubcategories(nodes: BalanceSubcategoryUiRow[], order: string[]) {
  const idx = new Map(order.map((id, position) => [id, position]));
  return [...nodes].sort((a, b) => {
    const aOrder = idx.has(a.id) ? idx.get(a.id)! : Number.POSITIVE_INFINITY;
    const bOrder = idx.has(b.id) ? idx.get(b.id)! : Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });
}
```

---

## 4. MOTOR DE CÁLCULO (src/lib/calculationEngine.ts)

### 4.1 Función Principal: runCalculation()

```typescript
export function runCalculation(
  positions: Position[],
  baseCurve: YieldCurve,
  discountCurve: YieldCurve,
  scenarios: Scenario[]
): CalculationResults
```

### 4.2 Paso 1: Generar Cashflows

```typescript
function generateCashflows(position: Position): Cashflow[] {
  const today = new Date();
  const maturityDate = new Date(position.maturityDate);
  const yearsToMaturity = (maturityDate.getTime() - today.getTime()) / (365.25 * 24 * 3600 * 1000);

  const cashflows: Cashflow[] = [];
  const sign = position.instrumentType === 'Asset' ? 1 : -1;

  // Generar flujos anuales de interés
  for (let year = 1; year <= Math.ceil(yearsToMaturity); year++) {
    const cfDate = new Date(today);
    cfDate.setFullYear(cfDate.getFullYear() + year);

    cashflows.push({
      positionId: position.id,
      date: cfDate.toISOString().split('T')[0],
      amount: sign * position.notional * position.couponRate,
      type: 'Interest',
    });
  }

  // Agregar principal al vencimiento
  cashflows.push({
    positionId: position.id,
    date: position.maturityDate,
    amount: sign * position.notional,
    type: 'Principal',
  });

  return cashflows;
}
```

### 4.3 Paso 2: Descuento de Cashflows

```typescript
function getInterpolatedRate(curve: YieldCurve, yearsToMaturity: number): number {
  const points = curve.points;

  // Edge cases
  if (yearsToMaturity <= points[0].tenorYears) {
    return points[0].rate;
  }
  if (yearsToMaturity >= points[points.length - 1].tenorYears) {
    return points[points.length - 1].rate;
  }

  // Interpolación lineal
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    if (yearsToMaturity >= p1.tenorYears && yearsToMaturity <= p2.tenorYears) {
      const t = (yearsToMaturity - p1.tenorYears) / (p2.tenorYears - p1.tenorYears);
      return p1.rate + t * (p2.rate - p1.rate);
    }
  }

  return points[points.length - 1].rate;
}

function discountCashflows(
  cashflows: Cashflow[],
  curve: YieldCurve
): DiscountedCashflow[] {
  const today = new Date();

  return cashflows.map(cf => {
    const cfDate = new Date(cf.date);
    const yearsToPayment = (cfDate.getTime() - today.getTime()) / (365.25 * 24 * 3600 * 1000);

    const rate = getInterpolatedRate(curve, yearsToPayment);
    const discountFactor = Math.exp(-rate * yearsToPayment);  // Descuento continuo
    const presentValue = cf.amount * discountFactor;

    return {
      ...cf,
      discountFactor,
      presentValue,
    };
  });
}
```

### 4.4 Paso 3: Cálculo de EVE y NII

```typescript
function calculateEVE(discountedCashflows: DiscountedCashflow[]): number {
  return discountedCashflows.reduce((sum, cf) => sum + cf.presentValue, 0);
}

function calculateNII(cashflows: Cashflow[]): number {
  const today = new Date();
  const oneYearFromNow = new Date(today);
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  return cashflows
    .filter(cf => {
      const cfDate = new Date(cf.date);
      return cf.type === 'Interest' &&
             cfDate >= today &&
             cfDate <= oneYearFromNow;
    })
    .reduce((sum, cf) => sum + cf.amount, 0);
}
```

### 4.5 Paso 4: Aplicación de Escenarios

```typescript
function applyScenarioShock(curve: YieldCurve, scenario: Scenario): YieldCurve {
  const shockDecimal = scenario.shockBps / 10000;

  const shockedPoints = curve.points.map(point => {
    let shock = 0;
    const tenorYears = point.tenorYears;

    switch (scenario.name) {
      case 'Parallel Up':
        shock = shockDecimal;
        break;

      case 'Parallel Down':
        shock = -shockDecimal;
        break;

      case 'Steepener':
        // Short rates down, long rates up
        if (tenorYears <= 2) {
          shock = -shockDecimal;
        } else {
          shock = shockDecimal * (tenorYears / 10);
        }
        break;

      case 'Flattener':
        // Short rates up, long rates down
        if (tenorYears <= 2) {
          shock = shockDecimal;
        } else {
          shock = -shockDecimal * (tenorYears / 10);
        }
        break;

      case 'Short Up':
        // Solo shock en short end (≤3Y)
        if (tenorYears <= 3) {
          shock = shockDecimal * Math.max(0, (3 - tenorYears) / 3);
        }
        break;

      case 'Short Down':
        // Solo shock en short end (opuesto)
        if (tenorYears <= 3) {
          shock = -shockDecimal * Math.max(0, (3 - tenorYears) / 3);
        }
        break;

      default:
        shock = 0;
    }

    return {
      ...point,
      rate: point.rate + shock,
    };
  });

  return {
    ...curve,
    points: shockedPoints,
  };
}
```

### 4.6 Flujo Completo de runCalculation()

```typescript
export function runCalculation(
  positions: Position[],
  baseCurve: YieldCurve,
  discountCurve: YieldCurve,
  scenarios: Scenario[]
): CalculationResults {
  // PASO 1: Generar cashflows
  const allCashflows = positions.flatMap(generateCashflows);

  // PASO 2: Base case
  const baseDiscountedCF = discountCashflows(allCashflows, baseCurve);
  const baseEve = calculateEVE(baseDiscountedCF);
  const baseNii = calculateNII(allCashflows);

  // PASO 3: Escenarios
  const scenarioResults: ScenarioResult[] = scenarios
    .filter(s => s.enabled)
    .map(scenario => {
      const shockedCurve = applyScenarioShock(baseCurve, scenario);
      const scenarioDiscountedCF = discountCashflows(allCashflows, shockedCurve);
      const scenarioEve = calculateEVE(scenarioDiscountedCF);
      const scenarioNii = calculateNII(allCashflows);  // NOTA: igual que base

      return {
        scenarioId: scenario.id,
        scenarioName: scenario.name as ScenarioType,
        eve: scenarioEve,
        nii: scenarioNii,
        deltaEve: scenarioEve - baseEve,
        deltaNii: scenarioNii - baseNii,
      };
    });

  // PASO 4: Identificar worst case
  const worstScenario = scenarioResults.reduce((worst, curr) =>
    curr.eve < worst.eve ? curr : worst
  );

  return {
    baseEve,
    baseNii,
    worstCaseEve: worstScenario.eve,
    worstCaseDeltaEve: worstScenario.deltaEve,
    worstCaseScenario: worstScenario.scenarioName,
    scenarioResults,
    calculatedAt: new Date().toISOString(),
  };
}
```

---

## 5. COMPONENTES CRÍTICOS DE NEGOCIO

### 5.1 BalancePositionsCardConnected

**Responsabilidades:**
- Gestión de sesión robusta con retry
- Upload de Excel de balance
- Sincronización con backend
- Mapeo de respuesta a posiciones

**Flujo de upload:**
```typescript
async function handleExcelUpload(file: File) {
  try {
    // 1. Upload con retry de sesión
    const summary = await withSessionRetry(sessionId,
      (sid) => uploadBalanceExcel(sid, file)
    );

    // 2. Marcar upload exitoso en localStorage
    localStorage.setItem('almready_balance_uploaded_session_id', sessionId);

    // 3. Refrescar summary
    await refreshSummary();

  } catch (error) {
    console.error('Upload failed:', error);
  }
}

async function refreshSummary() {
  const summary = await withSessionRetry(sessionId,
    (sid) => getBalanceSummary(sid)
  );

  // Mapear a posiciones
  const positions = mapSummaryToPositions(summary);
  onPositionsChange(positions);
}

async function withSessionRetry<T>(
  currentSessionId: string,
  fn: (sessionId: string) => Promise<T>
): Promise<T> {
  try {
    return await fn(currentSessionId);
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      // Sesión stale, crear nueva
      localStorage.removeItem('almready_session_id');
      const newSessionId = await getOrCreateSessionId();
      return await fn(newSessionId);
    }
    throw error;
  }
}
```

### 5.2 BalancePositionsCard

**Responsabilidades:**
- UI de visualización de balance
- Integración con What-If deltas
- Modal de detalles
- Modal de behavioural assumptions

**Cálculo de deltas What-If:**
```typescript
const whatIfDelta = useMemo(() => {
  const delta = {
    netAmount: 0,
    netPositions: 0,
    addedAmount: 0,
    removedAmount: 0,
    addedPositions: 0,
    removedPositions: 0,
    addedRateWeighted: 0,
    removedRateWeighted: 0,
    addedRateWeight: 0,
    removedRateWeight: 0,
    addedMaturityWeighted: 0,
    removedMaturityWeighted: 0,
    addedMaturityWeight: 0,
    removedMaturityWeight: 0,
    items: [],
  };

  modifications.forEach(mod => {
    if (mod.type === 'add') {
      delta.addedAmount += mod.notional || 0;
      delta.addedPositions += 1;
      delta.addedRateWeighted += (mod.rate || 0) * (mod.notional || 0);
      delta.addedMaturityWeighted += (mod.maturity || 0) * (mod.notional || 0);
    } else if (mod.type === 'remove') {
      delta.removedAmount += mod.notional || 0;
      delta.removedPositions += 1;
      delta.removedRateWeighted += (mod.rate || 0) * (mod.notional || 0);
      delta.removedMaturityWeighted += (mod.maturity || 0) * (mod.notional || 0);
    }
  });

  delta.netAmount = delta.addedAmount - delta.removedAmount;
  delta.netPositions = delta.addedPositions - delta.removedPositions;

  // Weighted averages
  delta.addedRateWeight = delta.addedAmount > 0
    ? delta.addedRateWeighted / delta.addedAmount
    : null;
  delta.removedRateWeight = delta.removedAmount > 0
    ? delta.removedRateWeighted / delta.removedAmount
    : null;
  delta.addedMaturityWeight = delta.addedAmount > 0
    ? delta.addedMaturityWeighted / delta.addedAmount
    : null;
  delta.removedMaturityWeight = delta.removedAmount > 0
    ? delta.removedMaturityWeighted / delta.removedAmount
    : null;

  return delta;
}, [modifications]);
```

### 5.3 CurvesAndScenariosCard

**Responsabilidades:**
- Upload de Excel de curvas
- Selección de curvas
- Gestión de escenarios
- Visualización de curvas base vs shocks

**Flujo de curvas:**
```typescript
async function handleCurvesUpload(file: File) {
  const summary = await withSessionRetry(sessionId,
    (sid) => uploadCurvesExcel(sid, file)
  );

  // Para cada curva, obtener puntos
  const curvesData = await Promise.all(
    summary.curves.map(async (catalog) => {
      const points = await getCurvePoints(sessionId, catalog.curve_id);
      return {
        id: catalog.curve_id,
        name: catalog.label_tech,
        currency: catalog.currency || 'Unknown',
        asOfDate: summary.uploaded_at,
        points: points.points.map(p => ({
          tenor: p.tenor,
          tenorYears: p.t_years,
          rate: p.rate,
        })),
      };
    })
  );

  setCurves(curvesData);
  setSelectedCurves([curvesData[0]?.id || '']);
}
```

**Construcción de puntos de escenario:**
```typescript
function buildScenarioPoints(
  basePoints: CurvePoint[],
  scenario: Scenario
): CurvePoint[] {
  const shockDecimal = scenario.shockBps / 10000;

  return basePoints.map(point => {
    let shock = 0;
    const t = point.t_years;

    // Lógica de shock según tipo (igual que calculationEngine)

    return {
      ...point,
      rate: point.rate + shock,
    };
  });
}
```

### 5.4 WhatIfBuilder

**Plantillas de productos:**
```typescript
const PRODUCT_TEMPLATES: ProductTemplate[] = [
  {
    id: 'fixed-loan',
    name: 'Fixed-rate Loan Portfolio',
    category: 'asset',
    fields: [
      { id: 'notional', label: 'Notional Amount', type: 'number', required: true },
      { id: 'currency', label: 'Currency', type: 'select', required: true,
        options: ['USD', 'EUR', 'GBP', 'CHF'] },
      { id: 'startDate', label: 'Start Date', type: 'date', required: true },
      { id: 'maturityDate', label: 'Maturity Date', type: 'date', required: true },
      { id: 'coupon', label: 'Coupon Rate (%)', type: 'number', required: true },
      { id: 'paymentFreq', label: 'Payment Frequency', type: 'select', required: true,
        options: ['Monthly', 'Quarterly', 'Semi-Annual', 'Annual'] },
    ],
  },
  // ... otros 6 templates
];
```

**Flujo de adición:**
```typescript
function handleAddProduct(template: ProductTemplate, formData: any) {
  const maturity = formData.maturityDate
    ? (new Date(formData.maturityDate) - new Date(formData.startDate)) / (365.25 * 24 * 3600 * 1000)
    : null;

  const modification: Omit<WhatIfModification, 'id'> = {
    type: 'add',
    label: template.name,
    details: `${formatCurrency(formData.notional)} ${formData.currency}`,
    notional: formData.notional,
    currency: formData.currency,
    category: template.category,
    subcategory: template.subcategory,
    rate: formData.coupon / 100,
    maturity,
  };

  addModification(modification);
}
```

**Flujo de remoción:**
```typescript
function handleRemoveFromSubcategory(
  categoria: string,
  subcategoria: string,
  mode: 'all' | 'contracts',
  contractIds?: string[]
) {
  if (mode === 'all') {
    const modification: Omit<WhatIfModification, 'id'> = {
      type: 'remove',
      label: `Remove all ${subcategoria}`,
      category: categoria === 'Assets' ? 'asset' : 'liability',
      subcategory,
      removeMode: 'all',
    };
    addModification(modification);
  } else {
    // Remove specific contracts
    contractIds.forEach(contractId => {
      const modification: Omit<WhatIfModification, 'id'> = {
        type: 'remove',
        label: `Remove contract ${contractId}`,
        category: categoria === 'Assets' ? 'asset' : 'liability',
        subcategory,
        removeMode: 'contracts',
        contractIds: [contractId],
      };
      addModification(modification);
    });
  }
}
```

### 5.5 ResultsCard

**Integración con What-If:**
```typescript
const {
  modifications,
  isApplied,
  cet1Capital: contextCet1,
  analysisDate,
} = useWhatIf();

const hasModifications = modifications.length > 0 && isApplied;
const cet1Capital = contextCet1 || 500_000_000;  // Default 500M

// Mock What-If impacts (en v2 serían cálculos reales)
const whatIfImpact = {
  baseEve: hasModifications ? 12_500_000 : 0,
  worstEve: hasModifications ? 8_200_000 : 0,
  baseNii: hasModifications ? -2_100_000 : 0,
  worstNii: hasModifications ? -1_800_000 : 0,
};

// Resultados finales
const finalBaseEve = results.baseEve + whatIfImpact.baseEve;
const finalWorstEve = results.worstCaseEve + whatIfImpact.worstEve;
const finalBaseNii = results.baseNii + whatIfImpact.baseNii;
const finalWorstNii = worstScenarioNii + whatIfImpact.worstNii;

// % impact sobre CET1
const baseEvePercentOfCet1 = (finalBaseEve / cet1Capital) * 100;
const worstEvePercentOfCet1 = (finalWorstEve / cet1Capital) * 100;
```

---

## 6. PREPARACIÓN PARA INTEGRACIÓN DEL MOTOR EVE/NII EXTERNO

### 6.1 Estado Actual vs Futuro

**Estado Actual:**
- Balance se lee desde Excel por epígrafe (hojas A_, L_, E_, D_)
- Estructura jerárquica: sheet → categoría → subcategoría → contrato
- Parser espera columnas específicas (num_sec_ac, lado_balance, etc.)
- Persistencia en JSON con estructura BalanceSummaryTree

**Estado Futuro (según usuario):**
- Balance se leerá desde ZIPs con CSVs por tipo de flujo
- Estructura: Fixed annuity, Fixed bullet, Fixed linear, Fixed scheduled, Non-maturity, Static position, Variable annuity, Variable bullet, Variable linear, Variable non-maturity, Variable scheduled
- Epígrafe se trasladará a una columna de los datos (no como hoja separada)

### 6.2 Puntos de Integración Críticos

#### A. Backend: Parser de Balance

**Archivo a modificar:** `backend/app/main.py`

**Cambios necesarios:**

1. **Nuevo endpoint para upload de ZIP:**
   ```python
   @app.post("/api/sessions/{session_id}/balance/zip")
   async def upload_balance_zip(
       session_id: str,
       file: UploadFile = File(...)
   ):
       # Extraer ZIP
       # Iterar CSVs (Fixed_annuity.csv, Fixed_bullet.csv, etc.)
       # Parser nuevo: _parse_balance_csv(df, flow_type)
       # Generar canonical_rows con flow_type
       # Persistir igual que antes
   ```

2. **Nuevo parser de CSV por tipo de flujo:**
   ```python
   def _parse_balance_csv(df: pd.DataFrame, flow_type: str) -> list[dict]:
       """
       flow_type: 'fixed-annuity', 'fixed-bullet', 'non-maturity', etc.

       Columnas esperadas (nuevas):
       - contract_id (o equivalente)
       - epigrafe (columna nueva, antes era hoja)
       - amount / notional
       - rate (si aplica)
       - maturity_date (si aplica)
       - currency
       - counterparty
       - ...

       Retorna: canonical_rows con flow_type agregado
       """

       canonical_rows = []
       for _, row in df.iterrows():
           canonical_row = {
               'contract_id': row.get('contract_id') or generate_id(),
               'flow_type': flow_type,  # NUEVO
               'epigrafe': row.get('epigrafe'),  # NUEVO
               'side': infer_side_from_epigrafe(row.get('epigrafe')),
               'category': infer_category_from_flow_type(flow_type),
               'subcategory': infer_subcategory_from_flow_type(flow_type),
               'amount': _to_float(row.get('amount')),
               'rate': _to_float(row.get('rate')),
               'maturity_date': _to_iso_date(row.get('maturity_date')),
               'currency': row.get('currency'),
               'counterparty': row.get('counterparty'),
               # ... otros campos
           }
           canonical_rows.append(canonical_row)

       return canonical_rows
   ```

3. **Inferencia de categoría/subcategoría desde flow_type:**
   ```python
   FLOW_TYPE_MAPPING = {
       'fixed-annuity': {
           'category': 'asset',  # o 'liability' según epigrafe
           'subcategory': 'loans',  # o 'mortgages'
           'rate_type': 'Fixed',
       },
       'fixed-bullet': {
           'category': 'asset',
           'subcategory': 'securities',
           'rate_type': 'Fixed',
       },
       'non-maturity': {
           'category': 'liability',
           'subcategory': 'deposits',
           'rate_type': 'Floating',
       },
       # ... resto de mapeos
   }

   def infer_category_from_flow_type(flow_type: str) -> str:
       return FLOW_TYPE_MAPPING.get(flow_type, {}).get('category', 'asset')

   def infer_side_from_epigrafe(epigrafe: str) -> str:
       # Lógica similar a inferCategoryFromSheetName pero con epígrafe
       ...
   ```

4. **Persistencia compatible:**
   - Mantener `balance_positions.json` con canonical_rows (agregar campo `flow_type`)
   - `summary_tree` se genera igual (agrupando por category/subcategory)
   - Backend sigue sirviendo mismos endpoints GET (no breaking changes)

#### B. Frontend: Sin cambios mayores

**¿Por qué?**
- Frontend consume `BalanceSummaryTree` que es independiente del formato de entrada
- Si backend mantiene misma estructura de salida, frontend no necesita cambios
- Solo cambiaría el upload: en vez de `<input accept=".xlsx,.xls">` sería `<input accept=".zip">`

**Cambios menores:**
```typescript
// BalancePositionsCardConnected.tsx
async function handleZipUpload(file: File) {
  const summary = await uploadBalanceZip(sessionId, file);
  // Resto igual
}

// api.ts
export async function uploadBalanceZip(
  sessionId: string,
  file: File
): Promise<BalanceSummaryResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return http(`/api/sessions/${sessionId}/balance/zip`, {
    method: 'POST',
    body: formData,
  });
}
```

#### C. Motor de Cálculo Externo

**Punto de integración:**

1. **Nuevo endpoint backend para cálculo:**
   ```python
   @app.post("/api/sessions/{session_id}/calculate")
   async def calculate_eve_nii(
       session_id: str,
       request: CalculationRequest
   ):
       """
       request: {
         discount_curve_id: str,
         scenarios: [str],  # IDs de escenarios
         what_if_modifications: [WhatIfMod],  # opcional
         behavioural_params: BehaviouralParams,  # opcional
       }

       Proceso:
       1. Cargar balance_positions.json
       2. Aplicar what_if_modifications (overlay)
       3. Aplicar behavioural_params (transformar maturity de NMD)
       4. Llamar motor externo EVE/NII (subprocess o API)
       5. Retornar CalculationResults
       """

       # Cargar posiciones
       positions = _load_positions(session_id)

       # Cargar curvas
       curves = _load_curves(session_id)
       discount_curve = _get_curve(curves, request.discount_curve_id)

       # Aplicar What-If
       if request.what_if_modifications:
           positions = _apply_what_if(positions, request.what_if_modifications)

       # Aplicar Behavioural
       if request.behavioural_params:
           positions = _apply_behavioural(positions, request.behavioural_params)

       # Llamar motor externo
       results = await _run_eve_nii_engine(
           positions=positions,
           discount_curve=discount_curve,
           scenarios=request.scenarios
       )

       # Persistir resultados
       _save_results(session_id, results)

       return results
   ```

2. **Frontend: reemplazar runCalculation() local:**
   ```typescript
   // Index.tsx
   async function handleCalculate() {
     setIsCalculating(true);

     try {
       const results = await calculateEveNii(sessionId, {
         discount_curve_id: selectedCurves[0],
         scenarios: scenarios.filter(s => s.enabled).map(s => s.id),
         what_if_modifications: isWhatIfApplied ? whatIfModifications : [],
         behavioural_params: isBehaviouralApplied ? behaviouralParams : null,
       });

       setResults(results);
     } catch (error) {
       console.error('Calculation failed:', error);
     } finally {
       setIsCalculating(false);
     }
   }
   ```

3. **Motor externo (subprocess o API):**
   ```python
   async def _run_eve_nii_engine(
       positions: list[dict],
       discount_curve: dict,
       scenarios: list[str]
   ) -> CalculationResults:
       """
       Opción 1: Subprocess
       - Escribir positions.json, curve.json, scenarios.json
       - subprocess.run(['python', 'eve_nii_engine.py', session_id])
       - Leer results.json

       Opción 2: API externa
       - requests.post('http://engine-service/calculate', json={...})

       Opción 3: Librería Python nativa
       - from eve_nii_lib import calculate
       - results = calculate(positions, curve, scenarios)
       """

       # Preparar input para motor
       engine_input = {
           'positions': positions,
           'discount_curve': discount_curve,
           'scenarios': scenarios,
       }

       # Llamar motor (ejemplo con subprocess)
       input_file = f'/tmp/{session_id}_input.json'
       output_file = f'/tmp/{session_id}_output.json'

       with open(input_file, 'w') as f:
           json.dump(engine_input, f)

       subprocess.run([
           'python', 'eve_nii_engine.py',
           '--input', input_file,
           '--output', output_file
       ], check=True)

       with open(output_file, 'r') as f:
           results = json.load(f)

       return CalculationResults(**results)
   ```

### 6.3 Checklist de Integración

**Backend:**
- [ ] Nuevo endpoint `POST /api/sessions/{id}/balance/zip` para upload de ZIP
- [ ] Parser `_parse_balance_csv(df, flow_type)` con mapeo flow_type → category/subcategory
- [ ] Inferencia de side desde columna `epigrafe` (nueva)
- [ ] Agregar campo `flow_type` a canonical_rows
- [ ] Mantener compatibilidad con endpoints GET existentes
- [ ] Nuevo endpoint `POST /api/sessions/{id}/calculate` para cálculo con motor externo
- [ ] Función `_apply_what_if(positions, modifications)` para overlay de What-If
- [ ] Función `_apply_behavioural(positions, params)` para transformaciones NMD/prepagos
- [ ] Integración con motor externo (subprocess/API/librería)

**Frontend:**
- [ ] Cambiar upload de Excel a ZIP en `BalancePositionsCardConnected`
- [ ] Nuevo API client `uploadBalanceZip(sessionId, file)`
- [ ] Reemplazar `runCalculation()` local por llamada a backend `calculateEveNii()`
- [ ] Pasar what_if_modifications al backend si isApplied
- [ ] Pasar behavioural_params al backend si isApplied
- [ ] Manejar resultados desde backend (mantener tipos CalculationResults)

**Motor EVE/NII Externo:**
- [ ] Definir formato de entrada (positions, curves, scenarios)
- [ ] Implementar lógica de cálculo EVE/NII productiva
- [ ] Manejo de flow types (fixed-annuity, variable-bullet, etc.)
- [ ] Aplicar behavioural assumptions (NMD maturity extension, prepagos)
- [ ] Generar cashflows por tipo de flujo
- [ ] Retornar CalculationResults compatible

### 6.4 Compatibilidad hacia atrás

**Para mantener compatibilidad con Excel durante transición:**

1. Mantener ambos endpoints:
   ```python
   @app.post("/api/sessions/{id}/balance")  # Excel (legacy)
   @app.post("/api/sessions/{id}/balance/zip")  # ZIP (nuevo)
   ```

2. Flag en sesión para saber qué formato se usó:
   ```python
   class SessionMeta(BaseModel):
       session_id: str
       created_at: str
       status: str = "active"
       schema_version: str = "v1"
       balance_format: str | None = None  # "excel" | "zip"
   ```

3. Frontend detecta formato y ajusta UI:
   ```typescript
   const balanceFormat = session.balance_format;
   const acceptFormats = balanceFormat === 'zip' ? '.zip' : '.xlsx,.xls';
   ```

---

## 7. PUNTOS CRÍTICOS Y CONSIDERACIONES

### 7.1 Limitaciones Actuales

1. **Motor de cálculo simplificado:**
   - NII es constante en todos los escenarios (no recalcula con curva shockeada)
   - No modela repricing (campo guardado pero no usado)
   - Descuento continuo (exp(-rt)) vs compuesto anual
   - No hay reinversión de flujos

2. **What-If mock:**
   - Impactos hardcoded en ResultsCard
   - No hay recálculo real con modificaciones aplicadas
   - Deltas son visuales, no afectan motor de cálculo

3. **Reglas de negocio temporales:**
   - Deposits forzados a maturity_years = 0.0 y bucket <1Y
   - Pending tratamiento de behavioural assumptions en cálculo

4. **Datos de visualización sintéticos:**
   - EVEChart y NIIChart generan datos placeholder
   - No usan CalculationResults real (solo para tabla)

### 7.2 Reglas de Negocio Específicas

1. **Depósitos (deposits):**
   - `maturity_years` SIEMPRE = 0.0 (temporal)
   - `maturity_bucket` SIEMPRE = "<1Y"
   - Razón: Pending implementación de NMD behavioural model

2. **Categorización de Balance:**
   - Hojas A_*, L_*, E_* requieren columnas específicas
   - D_* (derivatives) opcional, rate_type puede ser None
   - Equity/Derivatives no incluyen en balance_tree principal

3. **Tasas:**
   - Solo 2 tipos finales: "Fixed" o "Floating"
   - "nonrate"/"non-rate"/"no-rate" se trata como Floating pero muestra tasa_fija si existe

4. **Curvas:**
   - EUR_ESTR_OIS preferida como discount curve por defecto
   - Solo procesa primer sheet válido con tenores

5. **Madurez:**
   - Calcula como (fecha_vencimiento - HOY) / 365.25 días
   - Si calculada < 0, usa fallback core_avg_maturity_y
   - Fechas en ISO 8601 format

### 7.3 Dependencias Críticas

**Backend:**
```
fastapi==0.128.0          # Web framework
pydantic==2.12.5          # Data validation
pandas==2.3.3             # Excel parsing + data processing
numpy==2.3.3              # Numeric operations
openpyxl==3.1.5           # XLSX reader
uvicorn==0.40.0           # ASGI server
python-multipart==0.0.22  # File upload handling
```

**Frontend:**
```
react: ^18.3.1
typescript: ~5.6.2
vite: ^5.4.11
recharts: ^2.15.0         # Charting
@radix-ui/*               # UI primitives
tailwindcss: ^3.4.17      # Styling
```

### 7.4 Consideraciones de Performance

1. **Sesiones en disco:**
   - Actualmente hay 100+ sesiones en `/backend/data/sessions/`
   - No hay limpieza automática de sesiones viejas
   - Considerar TTL o cleanup job

2. **Parseo de Excel:**
   - Pandas lee todo el archivo en memoria
   - Para balances grandes (100K+ filas), considerar chunking

3. **Cálculos frontend:**
   - runCalculation() es síncrono y bloquea UI
   - Para balances grandes, mover a Web Worker

4. **Visualización:**
   - EVEChart/NIIChart con muchos escenarios pueden ser lentos
   - Considerar virtualización o lazy rendering

### 7.5 Seguridad

1. **CORS:**
   - Actualmente permite localhost y 127.0.0.1 (development)
   - Para producción: restringir a dominios específicos

2. **Validación de uploads:**
   - Validar tamaño de archivo (actualmente sin límite)
   - Validar extensión de archivo
   - Sanitizar nombres de archivo

3. **Inyección:**
   - Parser usa pandas.read_excel (protegido contra code injection)
   - Filtros usan query params (no hay SQL, solo filtrado en memoria)

### 7.6 Testing

**Estado actual:**
- Estructura de tests en `/src/test/` pero solo placeholder
- No hay tests de integración backend
- No hay tests E2E

**Recomendaciones:**
- Unit tests para parsers (backend)
- Unit tests para calculationEngine (frontend)
- Integration tests para API endpoints
- E2E tests para flujo completo upload → calculate → results

---

## 8. RESUMEN Y PRÓXIMOS PASOS

### 8.1 Resumen del Sistema Actual

ALMReady es un sistema funcional de gestión ALM que:
- ✅ Procesa balances bancarios desde Excel con parseo robusto
- ✅ Maneja curvas de rendimiento con interpolación lineal
- ✅ Calcula EVE y NII con 6 escenarios regulatorios IRRBB
- ✅ Soporta What-If analysis (add/remove posiciones)
- ✅ Integra supuestos comportamentales (NMD, prepagos, term deposits)
- ✅ Visualiza resultados con charts interactivos
- ✅ Gestiona sesiones persistentes por usuario

**Puntos fuertes:**
- Arquitectura bien separada (backend FastAPI + frontend React)
- Parseo robusto con normalizaciones y validaciones
- Sistema de agregación jerárquico (Assets/Liabilities → Subcategorías)
- Contextos globales para What-If y Behavioural (state management limpio)
- API REST bien estructurada con modelos Pydantic

**Áreas de mejora:**
- Motor de cálculo simplificado (NII constante, no repricing)
- What-If impacts hardcoded (no recálculo real)
- Visualizaciones con datos sintéticos (no usan CalculationResults)
- Sin tests automatizados
- Performance para balances grandes no optimizada

### 8.2 Preparación para Integración del Motor Externo

**Cambios de alto nivel necesarios:**

1. **Backend:**
   - Nuevo parser ZIP → CSVs por tipo de flujo
   - Mapeo flow_type → category/subcategory
   - Endpoint `/calculate` que llame motor externo
   - Overlay de What-If antes de cálculo
   - Transformaciones Behavioural antes de cálculo

2. **Frontend:**
   - Cambio de upload Excel → ZIP
   - Llamada a backend para cálculo (vs local)
   - Sin cambios en visualización (mantiene CalculationResults)

3. **Motor Externo:**
   - Definir interface de entrada (positions, curves, scenarios)
   - Implementar cálculos productivos EVE/NII
   - Manejo de flow types específicos
   - Aplicar behavioural assumptions

**Compatibilidad:**
- Mantener endpoints GET existentes (no breaking changes)
- Soportar ambos formatos (Excel y ZIP) durante transición
- Frontend agnóstico al formato de entrada (consume summary_tree)

### 8.3 Puntos de Decisión Pendientes

Antes de integrar el motor externo, necesitas decidir:

1. **Formato exacto de CSVs:**
   - ¿Qué columnas tendrá cada CSV de flow type?
   - ¿Hay columnas comunes a todos los flow types?
   - ¿Cómo se mapea "epígrafe" → side/category/subcategory?

2. **Motor externo:**
   - ¿Subprocess Python, API HTTP, o librería nativa?
   - ¿Qué formato de entrada/salida espera?
   - ¿Cómo maneja What-If y Behavioural?

3. **Behavioural assumptions:**
   - ¿El motor externo los aplica internamente?
   - ¿O backend debe transformar posiciones antes de enviar?

4. **What-If modifications:**
   - ¿El motor recalcula con modificaciones?
   - ¿O backend genera posiciones sintéticas y las agrega?

---

## ANEXOS

### A. Estructura de Archivos Completa

```
97 archivos TypeScript/Python (excluyendo UI primitives y sesiones):

Backend (2):
  backend/app/main.py
  backend/requirements.txt

Frontend (95):
  src/App.tsx
  src/main.tsx
  src/index.css
  src/vite-env.d.ts

  src/pages/ (2):
    Index.tsx
    NotFound.tsx

  src/components/ (13):
    BalancePositionsCard.tsx
    BalanceDetailsModal.tsx
    BalanceUploader.tsx (legacy)
    CalculateButton.tsx (legacy)
    CurvesAndScenariosCard.tsx
    InterestRateCurveUploader.tsx (legacy)
    InterestRateCurvesCard.tsx (legacy)
    NavLink.tsx
    ResultsCard.tsx
    ResultsDisplay.tsx (legacy)
    ScenarioSelector.tsx (legacy)
    ScenariosCard.tsx (legacy)

  src/components/connected/ (1):
    BalancePositionsCardConnected.tsx

  src/components/whatif/ (5):
    WhatIfContext.tsx
    WhatIfBuilder.tsx
    WhatIfAddTab.tsx
    WhatIfRemoveTab.tsx
    BalanceDetailsModalRemove.tsx

  src/components/behavioural/ (3):
    BehaviouralContext.tsx
    BehaviouralAssumptionsModal.tsx
    NMDCashflowChart.tsx

  src/components/results/ (2):
    EVEChart.tsx
    NIIChart.tsx

  src/components/ui/ (49):
    [Componentes Radix/shadcn]

  src/lib/ (8):
    api.ts
    session.ts
    calculationEngine.ts
    balanceUi.ts
    csvParser.ts (legacy)
    calendarLabels.ts
    utils.ts
    curves/labels.ts
    curves/scenarios.ts

  src/types/ (2):
    financial.ts
    whatif.ts

  src/hooks/ (3):
    useSession.ts
    use-mobile.tsx
    use-toast.ts

  src/test/ (2):
    setup.ts
    example.test.ts

Config (10):
  package.json
  tsconfig.json
  tsconfig.app.json
  tsconfig.node.json
  vite.config.ts
  vitest.config.ts
  tailwind.config.ts
  postcss.config.js
  eslint.config.js
  components.json
```

### B. Glosario de Términos

**EVE (Economic Value of Equity):**
- Valor presente neto de todos los flujos de caja futuros
- Mide impacto de cambios de tasas en valor económico del banco

**NII (Net Interest Income):**
- Ingreso neto por interés esperado en próximos 12 meses
- Diferencia entre intereses ganados (assets) y pagados (liabilities)

**IRRBB (Interest Rate Risk in the Banking Book):**
- Riesgo de tasa de interés en cartera bancaria (no trading)
- Regulación bancaria (Basel) requiere análisis de escenarios

**Escenarios regulatorios:**
- Parallel Up/Down: shock uniforme en toda la curva
- Steepener: cortos bajan, largos suben
- Flattener: cortos suben, largos bajan
- Short Up/Down: solo short end (≤3Y)

**What-If Analysis:**
- Análisis hipotético de cambios en balance
- Add: añadir posiciones sintéticas
- Remove: remover posiciones existentes

**Behavioural Assumptions:**
- NMD (Non-Maturing Deposits): depósitos sin vencimiento con modelo de core/non-core
- Loan Prepayments: prepagos de préstamos (SMM/CPR)
- Term Deposits: redenciones tempranas (TDRR)

**Flow Types (futuro):**
- Fixed annuity: flujos fijos anuales (hipotecas)
- Fixed bullet: pago único al vencimiento (bonos)
- Variable annuity: flujos variables anuales
- Non-maturity: sin vencimiento (depósitos a la vista)
- Static position: posición estática (equity)

### C. Referencias de Código Clave

**Backend:**
- Parser balance: `main.py:_parse_workbook()` (líneas ~500-800)
- Canonicalización: `main.py:_canonicalize_position_row()` (líneas ~900-1100)
- Agregaciones: `main.py:_build_category_tree()` (líneas ~1200-1300)
- Parser curvas: `main.py:_parse_curves_workbook()` (líneas ~1400-1500)

**Frontend:**
- Orquestador: `src/pages/Index.tsx` (130 líneas)
- Motor cálculo: `src/lib/calculationEngine.ts` (400 líneas)
- What-If context: `src/components/whatif/WhatIfContext.tsx` (200 líneas)
- Behavioural context: `src/components/behavioural/BehaviouralContext.tsx` (300 líneas)
- API client: `src/lib/api.ts` (400 líneas)
- Balance card: `src/components/BalancePositionsCard.tsx` (976 líneas)

---

## 9. PROFUNDIZACIÓN: INTEGRACIÓN CON MOTOR EVE/NII EXTERNO

### 9.1 Arquitectura de Integración

```
┌────────────────────────────────────────────────────────────────┐
│ FRONTEND (React)                                               │
├────────────────────────────────────────────────────────────────┤
│ Index.tsx: handleCalculate()                                   │
│   ↓                                                             │
│ POST /api/sessions/{id}/calculate                              │
│   Body: {                                                       │
│     discount_curve_id: "EUR_ESTR_OIS",                         │
│     scenarios: ["parallel-up", "steepener"],                   │
│     what_if_modifications: [WhatIfMod],                        │
│     behavioural_params: BehaviouralParams                      │
│   }                                                             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ BACKEND (FastAPI)                                              │
├────────────────────────────────────────────────────────────────┤
│ @app.post("/api/sessions/{id}/calculate")                      │
│                                                                 │
│ 1. Cargar balance_positions.json                               │
│ 2. Cargar curves_points.json                                   │
│ 3. Aplicar What-If overlay                                     │
│ 4. Aplicar Behavioural transformations                         │
│ 5. Preparar input para motor externo                           │
│ 6. Llamar motor externo (subprocess/API/librería)              │
│ 7. Persistir resultados                                        │
│ 8. Retornar CalculationResults                                 │
└────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌────────────────────────────────────────────────────────────────┐
│ MOTOR EVE/NII EXTERNO                                          │
├────────────────────────────────────────────────────────────────┤
│ Input: positions.json, curves.json, scenarios.json             │
│                                                                 │
│ 1. Generar cashflows por flow_type:                            │
│    - fixed-annuity → anuidades fijas                           │
│    - fixed-bullet → bullet único                               │
│    - variable-annuity → anuidades variables                    │
│    - non-maturity → distribución NMD                           │
│    - etc.                                                       │
│                                                                 │
│ 2. Aplicar curvas de descuento (interpolación)                 │
│ 3. Calcular EVE base                                           │
│ 4. Calcular NII base (12 meses)                                │
│ 5. Para cada escenario:                                        │
│    - Shockear curva                                            │
│    - Recalcular EVE y NII                                      │
│ 6. Identificar worst case                                      │
│                                                                 │
│ Output: results.json                                           │
│   {                                                             │
│     baseEve, baseNii,                                          │
│     worstCaseEve, worstCaseDeltaEve, worstCaseScenario,       │
│     scenarioResults: [ScenarioResult]                          │
│   }                                                             │
└────────────────────────────────────────────────────────────────┘
```

### 9.2 Endpoint Backend: POST /api/sessions/{id}/calculate

**Código completo:**

```python
# -------------------------
# API Models para Cálculo
# -------------------------
class WhatIfModificationAPI(BaseModel):
    id: str
    type: str  # "add" | "remove"
    label: str
    notional: float | None = None
    currency: str | None = None
    category: str | None = None  # "asset" | "liability" | "derivative"
    subcategory: str | None = None
    rate: float | None = None
    maturity: float | None = None  # años
    removeMode: str | None = None  # "all" | "contracts"
    contractIds: list[str] | None = None

class NMDParametersAPI(BaseModel):
    enabled: bool
    coreProportion: float  # 0-100
    coreAverageMaturity: float  # 2-10 años
    passThrough: float  # 0-100

class LoanPrepaymentParametersAPI(BaseModel):
    enabled: bool
    smm: float  # 0-50 (%)

class TermDepositParametersAPI(BaseModel):
    enabled: bool
    tdrr: float  # 0-50 (%)

class BehaviouralParametersAPI(BaseModel):
    profile: str  # "none" | "nmd" | "loan-prepayments" | "term-deposits"
    nmd: NMDParametersAPI | None = None
    loanPrepayments: LoanPrepaymentParametersAPI | None = None
    termDeposits: TermDepositParametersAPI | None = None

class CalculationRequest(BaseModel):
    discount_curve_id: str
    scenarios: list[str]  # ["parallel-up", "steepener", etc.]
    what_if_modifications: list[WhatIfModificationAPI] | None = None
    behavioural_params: BehaviouralParametersAPI | None = None

class ScenarioResultAPI(BaseModel):
    scenarioId: str
    scenarioName: str
    eve: float
    nii: float
    deltaEve: float
    deltaNii: float

class CalculationResults(BaseModel):
    session_id: str
    baseEve: float
    baseNii: float
    worstCaseEve: float
    worstCaseDeltaEve: float
    worstCaseScenario: str
    scenarioResults: list[ScenarioResultAPI]
    calculatedAt: str

# -------------------------
# Endpoint de Cálculo
# -------------------------
@app.post("/api/sessions/{session_id}/calculate")
async def calculate_eve_nii(
    session_id: str,
    request: CalculationRequest
) -> CalculationResults:
    """
    Calcula EVE y NII usando motor externo.

    Proceso:
    1. Cargar posiciones desde balance_positions.json
    2. Cargar curvas desde curves_points.json
    3. Aplicar What-If overlay (add/remove posiciones)
    4. Aplicar Behavioural transformations (NMD, prepagos, etc.)
    5. Preparar input para motor externo
    6. Ejecutar motor externo (subprocess/API/librería)
    7. Persistir y retornar resultados
    """

    # 1. Validar sesión
    session_dir = _session_dir(session_id)
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    # 2. Cargar posiciones
    positions_file = _positions_path(session_id)
    if not positions_file.exists():
        raise HTTPException(status_code=400, detail="No balance uploaded")

    with open(positions_file, 'r') as f:
        positions = json.load(f)

    # 3. Cargar curvas
    curves_points_file = _curves_points_path(session_id)
    if not curves_points_file.exists():
        raise HTTPException(status_code=400, detail="No curves uploaded")

    with open(curves_points_file, 'r') as f:
        curves_data = json.load(f)

    # Obtener curva de descuento
    if request.discount_curve_id not in curves_data:
        raise HTTPException(
            status_code=400,
            detail=f"Discount curve {request.discount_curve_id} not found"
        )

    discount_curve = {
        'curve_id': request.discount_curve_id,
        'points': curves_data[request.discount_curve_id]
    }

    # 4. Aplicar What-If overlay
    if request.what_if_modifications:
        positions = _apply_what_if_overlay(positions, request.what_if_modifications)

    # 5. Aplicar Behavioural transformations
    if request.behavioural_params and request.behavioural_params.profile != 'none':
        positions = _apply_behavioural_transformations(
            positions,
            request.behavioural_params
        )

    # 6. Preparar input para motor externo
    engine_input = {
        'positions': positions,
        'discount_curve': discount_curve,
        'scenarios': request.scenarios,
        'session_id': session_id,
    }

    # 7. Ejecutar motor externo
    results = await _run_eve_nii_engine(session_id, engine_input)

    # 8. Persistir resultados
    results_file = _results_path(session_id)
    with open(results_file, 'w') as f:
        json.dump(results.dict(), f, indent=2)

    return results


# -------------------------
# Funciones de Soporte
# -------------------------
def _apply_what_if_overlay(
    positions: list[dict],
    modifications: list[WhatIfModificationAPI]
) -> list[dict]:
    """
    Aplica modificaciones What-If sobre posiciones base.

    Para type='add': agrega posición sintética
    Para type='remove': marca posiciones para exclusión o ajusta amounts
    """
    modified_positions = positions.copy()

    for mod in modifications:
        if mod.type == 'add':
            # Crear posición sintética
            synthetic_position = {
                'contract_id': f'WHATIF_ADD_{mod.id}',
                'side': mod.category,
                'categoria_ui': mod.category.capitalize(),
                'subcategory_id': mod.subcategory,
                'subcategoria_ui': mod.label,
                'amount': mod.notional,
                'currency': mod.currency,
                'rate_type': 'Fixed' if mod.rate else 'Floating',
                'rate_display': mod.rate,
                'maturity_years': mod.maturity,
                'maturity_bucket': _bucket_from_years(mod.maturity) if mod.maturity else None,
                'flow_type': _infer_flow_type_from_mod(mod),
                'is_synthetic': True,
                'what_if_id': mod.id,
            }
            modified_positions.append(synthetic_position)

        elif mod.type == 'remove':
            if mod.removeMode == 'all':
                # Marcar todas las posiciones de subcategoría para exclusión
                for pos in modified_positions:
                    if pos['subcategory_id'] == mod.subcategory:
                        pos['exclude_from_calculation'] = True

            elif mod.removeMode == 'contracts' and mod.contractIds:
                # Marcar contratos específicos para exclusión
                for pos in modified_positions:
                    if pos['contract_id'] in mod.contractIds:
                        pos['exclude_from_calculation'] = True

    # Filtrar posiciones excluidas
    return [p for p in modified_positions if not p.get('exclude_from_calculation', False)]


def _apply_behavioural_transformations(
    positions: list[dict],
    params: BehaviouralParametersAPI
) -> list[dict]:
    """
    Aplica transformaciones comportamentales a posiciones.

    NMD: Extiende madurez de depósitos según core proportion y average maturity
    Loan Prepayments: Ajusta cashflows por SMM
    Term Deposits: Ajusta redemption rate por TDRR
    """
    transformed = positions.copy()

    if params.profile == 'nmd' and params.nmd and params.nmd.enabled:
        # Transformar depósitos non-maturing
        for pos in transformed:
            if pos['subcategory_id'] == 'deposits' and pos.get('maturity_years', 0) == 0:
                # Calcular madurez efectiva
                core_prop = params.nmd.coreProportion / 100
                core_mat = params.nmd.coreAverageMaturity
                effective_maturity = core_prop * core_mat

                # Actualizar posición
                pos['maturity_years'] = effective_maturity
                pos['maturity_bucket'] = _bucket_from_years(effective_maturity)
                pos['behavioural_adjusted'] = True
                pos['behavioural_type'] = 'nmd'
                pos['nmd_core_proportion'] = params.nmd.coreProportion
                pos['nmd_core_maturity'] = params.nmd.coreAverageMaturity
                pos['nmd_pass_through'] = params.nmd.passThrough

    elif params.profile == 'loan-prepayments' and params.loanPrepayments and params.loanPrepayments.enabled:
        # Transformar préstamos con prepagos
        smm = params.loanPrepayments.smm / 100
        cpr = 1 - (1 - smm) ** 12  # Conversión SMM → CPR anual

        for pos in transformed:
            if pos['subcategory_id'] in ['loans', 'mortgages']:
                # Ajustar madurez efectiva (simplificado)
                original_maturity = pos.get('maturity_years', 0)
                if original_maturity > 0:
                    # Madurez efectiva reducida por prepagos
                    effective_maturity = original_maturity * (1 - cpr * 0.5)  # Factor simplificado
                    pos['maturity_years'] = effective_maturity
                    pos['maturity_bucket'] = _bucket_from_years(effective_maturity)
                    pos['behavioural_adjusted'] = True
                    pos['behavioural_type'] = 'loan-prepayments'
                    pos['smm'] = params.loanPrepayments.smm
                    pos['cpr'] = cpr * 100

    elif params.profile == 'term-deposits' and params.termDeposits and params.termDeposits.enabled:
        # Transformar depósitos a plazo con redemptions
        tdrr_monthly = params.termDeposits.tdrr / 100
        tdrr_annual = 1 - (1 - tdrr_monthly) ** 12

        for pos in transformed:
            if pos['subcategory_id'] == 'term-deposits':
                # Ajustar madurez efectiva
                original_maturity = pos.get('maturity_years', 0)
                if original_maturity > 0:
                    effective_maturity = original_maturity * (1 - tdrr_annual * 0.3)  # Factor simplificado
                    pos['maturity_years'] = effective_maturity
                    pos['maturity_bucket'] = _bucket_from_years(effective_maturity)
                    pos['behavioural_adjusted'] = True
                    pos['behavioural_type'] = 'term-deposits'
                    pos['tdrr_monthly'] = params.termDeposits.tdrr
                    pos['tdrr_annual'] = tdrr_annual * 100

    return transformed


async def _run_eve_nii_engine(
    session_id: str,
    engine_input: dict
) -> CalculationResults:
    """
    Ejecuta motor externo EVE/NII.

    3 opciones de implementación:
    1. Subprocess: Ejecuta Python script externo
    2. API HTTP: Llama a servicio externo
    3. Librería nativa: Importa módulo Python
    """

    # OPCIÓN 1: Subprocess (recomendado para motor aislado)
    input_file = f'/tmp/{session_id}_input.json'
    output_file = f'/tmp/{session_id}_output.json'

    # Escribir input
    with open(input_file, 'w') as f:
        json.dump(engine_input, f, indent=2, default=_serialize_value_for_json)

    # Ejecutar motor
    import subprocess
    result = subprocess.run([
        'python3',
        'eve_nii_engine/main.py',  # Path al motor externo
        '--input', input_file,
        '--output', output_file,
        '--verbose'
    ], check=True, capture_output=True, text=True)

    # Leer output
    with open(output_file, 'r') as f:
        results_data = json.load(f)

    # Parsear a modelo
    return CalculationResults(
        session_id=session_id,
        baseEve=results_data['baseEve'],
        baseNii=results_data['baseNii'],
        worstCaseEve=results_data['worstCaseEve'],
        worstCaseDeltaEve=results_data['worstCaseDeltaEve'],
        worstCaseScenario=results_data['worstCaseScenario'],
        scenarioResults=[
            ScenarioResultAPI(**sr) for sr in results_data['scenarioResults']
        ],
        calculatedAt=results_data['calculatedAt']
    )

    # OPCIÓN 2: API HTTP (si motor es servicio separado)
    """
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.post(
            'http://eve-nii-engine-service:8001/calculate',
            json=engine_input,
            timeout=300.0  # 5 minutos
        )
        response.raise_for_status()
        results_data = response.json()
        return CalculationResults(**results_data)
    """

    # OPCIÓN 3: Librería nativa (si motor es módulo Python)
    """
    from eve_nii_lib import calculate_eve_nii
    results_data = calculate_eve_nii(
        positions=engine_input['positions'],
        discount_curve=engine_input['discount_curve'],
        scenarios=engine_input['scenarios']
    )
    return CalculationResults(**results_data)
    """


def _infer_flow_type_from_mod(mod: WhatIfModificationAPI) -> str:
    """
    Infiere flow_type desde modificación What-If.

    Mapeo según subcategory y características:
    - mortgages + Fixed → fixed-annuity
    - loans + Floating → variable-annuity
    - securities + Fixed → fixed-bullet
    - deposits (non-maturity) → non-maturity
    - term-deposits → fixed-annuity
    - wholesale-funding → fixed-bullet
    """
    subcat = mod.subcategory
    is_fixed = mod.rate is not None

    if subcat == 'mortgages':
        return 'fixed-annuity' if is_fixed else 'variable-annuity'
    elif subcat == 'loans':
        return 'variable-annuity'
    elif subcat == 'securities':
        return 'fixed-bullet' if is_fixed else 'variable-bullet'
    elif subcat == 'deposits':
        return 'non-maturity'
    elif subcat == 'term-deposits':
        return 'fixed-annuity'
    elif subcat == 'wholesale-funding':
        return 'fixed-bullet'
    elif subcat == 'debt-issued':
        return 'fixed-bullet'
    else:
        return 'fixed-annuity'  # Default


def _results_path(session_id: str) -> Path:
    return _session_dir(session_id) / "calculation_results.json"
```

### 9.3 Motor Externo: Estructura y Formato de Datos

**Estructura de directorios del motor:**

```
eve_nii_engine/
├── main.py                     # Entry point
├── cashflow_generator.py       # Generación de cashflows por flow_type
├── discount_engine.py          # Descuento y cálculo EVE
├── scenario_shocks.py          # Aplicación de shocks de escenarios
├── nii_calculator.py           # Cálculo de NII
└── config/
    └── flow_type_mappings.py   # Configuración de flow types
```

**Formato de entrada (input.json):**

```json
{
  "session_id": "uuid",
  "positions": [
    {
      "contract_id": "A_MORTGAGES_00001",
      "side": "asset",
      "flow_type": "fixed-annuity",
      "epigrafe": "Hipotecas vivienda",
      "subcategory_id": "mortgages",
      "amount": 500000,
      "currency": "EUR",
      "rate_display": 0.025,
      "maturity_years": 15.0,
      "maturity_bucket": "10-20Y",
      "behavioural_adjusted": false
    },
    {
      "contract_id": "L_DEPOSITS_00001",
      "side": "liability",
      "flow_type": "non-maturity",
      "epigrafe": "Depósitos a la vista",
      "subcategory_id": "deposits",
      "amount": 1000000,
      "currency": "EUR",
      "rate_display": 0.001,
      "maturity_years": 2.5,
      "maturity_bucket": "1-5Y",
      "behavioural_adjusted": true,
      "behavioural_type": "nmd",
      "nmd_core_proportion": 60.0,
      "nmd_core_maturity": 4.0,
      "nmd_pass_through": 50.0
    }
  ],
  "discount_curve": {
    "curve_id": "EUR_ESTR_OIS",
    "points": [
      {"tenor": "ON", "t_years": 0.0027, "rate": 0.0285},
      {"tenor": "1M", "t_years": 0.0833, "rate": 0.0289},
      {"tenor": "1Y", "t_years": 1.0, "rate": 0.0325},
      {"tenor": "5Y", "t_years": 5.0, "rate": 0.0380},
      {"tenor": "10Y", "t_years": 10.0, "rate": 0.0410}
    ]
  },
  "scenarios": [
    "parallel-up",
    "parallel-down",
    "steepener",
    "flattener"
  ]
}
```

**Formato de salida (output.json):**

```json
{
  "session_id": "uuid",
  "baseEve": 125000000.50,
  "baseNii": 8500000.25,
  "worstCaseEve": 98000000.75,
  "worstCaseDeltaEve": -27000000.25,
  "worstCaseScenario": "parallel-up",
  "scenarioResults": [
    {
      "scenarioId": "parallel-up",
      "scenarioName": "Parallel Up (+200bps)",
      "eve": 98000000.75,
      "nii": 10200000.50,
      "deltaEve": -27000000.25,
      "deltaNii": 1700000.25
    },
    {
      "scenarioId": "parallel-down",
      "scenarioName": "Parallel Down (-200bps)",
      "eve": 152000000.25,
      "nii": 6800000.00,
      "deltaEve": 27000000.75,
      "deltaNii": -1700000.25
    },
    {
      "scenarioId": "steepener",
      "scenarioName": "Steepener",
      "eve": 110000000.00,
      "nii": 9000000.00,
      "deltaEve": -15000000.50,
      "deltaNii": 500000.75
    },
    {
      "scenarioId": "flattener",
      "scenarioName": "Flattener",
      "eve": 135000000.50,
      "nii": 8200000.00,
      "deltaEve": 10000000.00,
      "deltaNii": -300000.25
    }
  ],
  "calculatedAt": "2026-02-16T23:00:00.000Z"
}
```

### 9.4 Generación de Cashflows por Flow Type

**Código del motor externo (cashflow_generator.py):**

```python
from datetime import date, timedelta
from typing import List, Dict

def generate_cashflows(position: Dict, as_of_date: date) -> List[Dict]:
    """
    Genera cashflows según flow_type.

    Flow types soportados:
    - fixed-annuity: Anuidades fijas (hipotecas, préstamos amortizables)
    - fixed-bullet: Pago único al vencimiento (bonos)
    - variable-annuity: Anuidades variables (préstamos tasa variable)
    - variable-bullet: Bullet con tasa variable
    - non-maturity: Distribución según modelo NMD
    - static-position: Sin cashflows (equity)
    """
    flow_type = position.get('flow_type', 'fixed-annuity')

    if flow_type == 'fixed-annuity':
        return _generate_fixed_annuity(position, as_of_date)
    elif flow_type == 'fixed-bullet':
        return _generate_fixed_bullet(position, as_of_date)
    elif flow_type == 'variable-annuity':
        return _generate_variable_annuity(position, as_of_date)
    elif flow_type == 'variable-bullet':
        return _generate_variable_bullet(position, as_of_date)
    elif flow_type == 'non-maturity':
        return _generate_non_maturity(position, as_of_date)
    elif flow_type == 'static-position':
        return _generate_static_position(position, as_of_date)
    else:
        raise ValueError(f"Unknown flow_type: {flow_type}")


def _generate_fixed_annuity(position: Dict, as_of_date: date) -> List[Dict]:
    """
    Anuidad fija: pagos periódicos constantes (capital + interés).

    Fórmula de anuidad:
    PMT = Principal * [r(1+r)^n] / [(1+r)^n - 1]

    donde:
    - r = tasa periódica
    - n = número de períodos
    """
    principal = position['amount']
    rate = position.get('rate_display', 0)
    maturity_years = position.get('maturity_years', 0)
    side = position['side']

    if maturity_years <= 0:
        return []

    # Calcular pago anual de anuidad
    n_years = int(maturity_years) or 1
    annual_rate = rate

    if annual_rate > 0:
        # Fórmula de anuidad
        pmt = principal * (annual_rate * (1 + annual_rate) ** n_years) / \
              ((1 + annual_rate) ** n_years - 1)
    else:
        # Sin interés, solo amortización lineal
        pmt = principal / n_years

    # Generar cashflows anuales
    cashflows = []
    remaining_principal = principal
    sign = 1 if side == 'asset' else -1

    for year in range(1, n_years + 1):
        cf_date = as_of_date + timedelta(days=365 * year)

        # Interés del período
        interest = remaining_principal * annual_rate

        # Amortización de capital
        principal_payment = pmt - interest

        # Cashflow total
        cashflows.append({
            'contract_id': position['contract_id'],
            'date': cf_date.isoformat(),
            'amount': sign * pmt,
            'interest': sign * interest,
            'principal': sign * principal_payment,
            'type': 'annuity'
        })

        remaining_principal -= principal_payment

    return cashflows


def _generate_fixed_bullet(position: Dict, as_of_date: date) -> List[Dict]:
    """
    Bullet fijo: intereses periódicos + principal al vencimiento.
    Típico de bonos.
    """
    principal = position['amount']
    rate = position.get('rate_display', 0)
    maturity_years = position.get('maturity_years', 0)
    side = position['side']

    if maturity_years <= 0:
        return []

    n_years = int(maturity_years) or 1
    sign = 1 if side == 'asset' else -1

    cashflows = []

    # Pagos anuales de interés
    for year in range(1, n_years + 1):
        cf_date = as_of_date + timedelta(days=365 * year)
        interest = principal * rate

        cashflows.append({
            'contract_id': position['contract_id'],
            'date': cf_date.isoformat(),
            'amount': sign * interest,
            'interest': sign * interest,
            'principal': 0,
            'type': 'interest'
        })

    # Pago de principal al vencimiento
    maturity_date = as_of_date + timedelta(days=365 * n_years)
    cashflows.append({
        'contract_id': position['contract_id'],
        'date': maturity_date.isoformat(),
        'amount': sign * principal,
        'interest': 0,
        'principal': sign * principal,
        'type': 'principal'
    })

    return cashflows


def _generate_non_maturity(position: Dict, as_of_date: date) -> List[Dict]:
    """
    Non-maturity: distribución según modelo NMD.

    Usa maturity_years ajustada por behavioural assumptions.
    Distribuye el monto según buckets NMD estándar.
    """
    principal = position['amount']
    maturity_years = position.get('maturity_years', 0)
    side = position['side']
    sign = 1 if side == 'asset' else -1

    # Distribución NMD (% por bucket)
    NMD_BUCKET_DISTRIBUTION = {
        1: 1.33333,   2: 2.66667,   3: 5.33333,
        4: 8.00000,   5: 13.33333,  6: 16.00000,
        7: 20.00000,  8: 33.33333,
    }

    cashflows = []

    for year, percentage in NMD_BUCKET_DISTRIBUTION.items():
        if year > maturity_years:
            break

        cf_date = as_of_date + timedelta(days=365 * year)
        amount = principal * (percentage / 100)

        cashflows.append({
            'contract_id': position['contract_id'],
            'date': cf_date.isoformat(),
            'amount': sign * amount,
            'interest': 0,
            'principal': sign * amount,
            'type': 'nmd-distribution'
        })

    return cashflows


def _generate_variable_annuity(position: Dict, as_of_date: date) -> List[Dict]:
    """
    Anuidad variable: similar a fixed-annuity pero con repricing periódico.
    Simplificado: usa tasa actual para proyección (conservador).
    """
    # Por ahora, igual que fixed-annuity
    # En motor productivo: modelar repricing con curva forward
    return _generate_fixed_annuity(position, as_of_date)


def _generate_variable_bullet(position: Dict, as_of_date: date) -> List[Dict]:
    """
    Bullet variable: similar a fixed-bullet pero con repricing.
    """
    return _generate_fixed_bullet(position, as_of_date)


def _generate_static_position(position: Dict, as_of_date: date) -> List[Dict]:
    """
    Posición estática (equity): sin cashflows.
    """
    return []
```

### 9.5 Frontend: Cambios para Llamada a Backend

**Archivo: src/lib/api.ts**

```typescript
// Nuevo tipo para request de cálculo
export interface CalculationRequest {
  discount_curve_id: string;
  scenarios: string[];
  what_if_modifications?: WhatIfModification[];
  behavioural_params?: BehaviouralParams;
}

export interface BehaviouralParams {
  profile: 'none' | 'nmd' | 'loan-prepayments' | 'term-deposits';
  nmd?: {
    enabled: boolean;
    coreProportion: number;
    coreAverageMaturity: number;
    passThrough: number;
  };
  loanPrepayments?: {
    enabled: boolean;
    smm: number;
  };
  termDeposits?: {
    enabled: boolean;
    tdrr: number;
  };
}

// Nueva función de API
export async function calculateEveNii(
  sessionId: string,
  request: CalculationRequest
): Promise<CalculationResults> {
  return http(`/api/sessions/${sessionId}/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
}
```

**Archivo: src/pages/Index.tsx**

```typescript
// Reemplazar handleCalculate() local por llamada a backend
const handleCalculate = useCallback(async () => {
  if (!canCalculate || !sessionId) return;

  setIsCalculating(true);

  try {
    // Preparar request
    const request: CalculationRequest = {
      discount_curve_id: selectedCurves[0],
      scenarios: scenarios.filter(s => s.enabled).map(s => s.id),
      what_if_modifications: isWhatIfApplied ? whatIfModifications : undefined,
      behavioural_params: isBehaviouralApplied ? behaviouralParams : undefined,
    };

    // Llamar backend
    const calculationResults = await calculateEveNii(sessionId, request);

    setResults(calculationResults);
  } catch (error) {
    console.error('Calculation failed:', error);
    toast.error('Failed to calculate EVE/NII');
  } finally {
    setIsCalculating(false);
  }
}, [canCalculate, sessionId, selectedCurves, scenarios, ...]);
```

---

## 10. PROFUNDIZACIÓN: ESTRUCTURA DE DATOS Y PERSISTENCIA

### 10.1 Esquemas JSON Completos con Ejemplos Reales

#### A. meta.json (SessionMeta)

**Esquema:**
```typescript
interface SessionMeta {
  session_id: string;        // UUID v4
  created_at: string;        // ISO 8601 timestamp con timezone
  status: string;            // "active" | "archived" | "expired"
  schema_version: string;    // "v1" (para compatibilidad futura)
  balance_format?: string;   // "excel" | "zip" (futuro)
}
```

**Ejemplo:**
```json
{
  "session_id": "a3b2c1d4-5678-90ab-cdef-1234567890ab",
  "created_at": "2026-02-16T22:30:00.000000+00:00",
  "status": "active",
  "schema_version": "v1"
}
```

#### B. balance_summary.json (BalanceUploadResponse)

**Esquema:**
```typescript
interface BalanceUploadResponse {
  session_id: string;
  filename: string;
  uploaded_at: string;
  sheets: BalanceSheetSummary[];
  sample_rows: { [sheet_name: string]: any[] };
  summary_tree: BalanceSummaryTree;
}

interface BalanceSheetSummary {
  sheet: string;
  rows: number;
  columns: string[];
  total_saldo_ini: number | null;
  total_book_value: number | null;
  avg_tae: number | null;
}

interface BalanceSummaryTree {
  assets: BalanceTreeCategory | null;
  liabilities: BalanceTreeCategory | null;
  equity: BalanceTreeCategory | null;
  derivatives: BalanceTreeCategory | null;
}

interface BalanceTreeCategory {
  id: string;
  label: string;
  amount: number;
  positions: number;
  avg_rate: number | null;
  avg_maturity: number | null;
  subcategories: BalanceTreeNode[];
}

interface BalanceTreeNode {
  id: string;
  label: string;
  amount: number;
  positions: number;
  avg_rate: number | null;
  avg_maturity: number | null;
}
```

**Ejemplo:**
```json
{
  "session_id": "a3b2c1d4-5678-90ab-cdef-1234567890ab",
  "filename": "Balance_Q4_2024.xlsx",
  "uploaded_at": "2026-02-16T22:30:15.123456+00:00",
  "sheets": [
    {
      "sheet": "A_Cash_CentralBank",
      "rows": 10,
      "columns": ["num_sec_ac", "lado_balance", "categoria_ui", "subcategoria_ui", "grupo", "moneda", "saldo_ini", "tipo_tasa"],
      "total_saldo_ini": 31986098.72,
      "total_book_value": 31986098.72,
      "avg_tae": null
    },
    {
      "sheet": "A_Mortgages",
      "rows": 500,
      "columns": ["num_sec_ac", "lado_balance", "categoria_ui", "subcategoria_ui", "grupo", "moneda", "saldo_ini", "tipo_tasa", "tasa_fija", "fecha_vencimiento"],
      "total_saldo_ini": 500000000.00,
      "total_book_value": 500000000.00,
      "avg_tae": 0.025
    }
  ],
  "sample_rows": {
    "A_Cash_CentralBank": [
      {
        "num_sec_ac": "CASH_001",
        "lado_balance": "asset",
        "categoria_ui": "Assets",
        "subcategoria_ui": "Interbank / Central Bank",
        "grupo": "Cash & Central Bank",
        "moneda": "EUR",
        "saldo_ini": 31986098.72,
        "tipo_tasa": "nonrate"
      }
    ]
  },
  "summary_tree": {
    "assets": {
      "id": "assets",
      "label": "Assets",
      "amount": 1234567890.12,
      "positions": 1510,
      "avg_rate": 0.0345,
      "avg_maturity": 5.25,
      "subcategories": [
        {
          "id": "mortgages",
          "label": "Mortgages",
          "amount": 500000000.00,
          "positions": 500,
          "avg_rate": 0.025,
          "avg_maturity": 15.0
        },
        {
          "id": "loans",
          "label": "Loans",
          "amount": 300000000.00,
          "positions": 300,
          "avg_rate": 0.035,
          "avg_maturity": 5.0
        },
        {
          "id": "securities",
          "label": "Securities",
          "amount": 200000000.00,
          "positions": 150,
          "avg_rate": 0.030,
          "avg_maturity": 7.0
        },
        {
          "id": "interbank",
          "label": "Interbank / Central Bank",
          "amount": 234567890.12,
          "positions": 560,
          "avg_rate": null,
          "avg_maturity": null
        }
      ]
    },
    "liabilities": {
      "id": "liabilities",
      "label": "Liabilities",
      "amount": 1100000000.00,
      "positions": 2000,
      "avg_rate": 0.015,
      "avg_maturity": 1.5,
      "subcategories": [
        {
          "id": "deposits",
          "label": "Deposits",
          "amount": 700000000.00,
          "positions": 1500,
          "avg_rate": 0.001,
          "avg_maturity": 0.0
        },
        {
          "id": "term-deposits",
          "label": "Term Deposits",
          "amount": 200000000.00,
          "positions": 300,
          "avg_rate": 0.020,
          "avg_maturity": 2.0
        },
        {
          "id": "wholesale-funding",
          "label": "Wholesale Funding",
          "amount": 150000000.00,
          "positions": 150,
          "avg_rate": 0.025,
          "avg_maturity": 3.0
        },
        {
          "id": "debt-issued",
          "label": "Debt Issued",
          "amount": 50000000.00,
          "positions": 50,
          "avg_rate": 0.030,
          "avg_maturity": 5.0
        }
      ]
    },
    "equity": {
      "id": "equity",
      "label": "Equity",
      "amount": 134567890.12,
      "positions": 10,
      "avg_rate": null,
      "avg_maturity": null,
      "subcategories": [
        {
          "id": "equity",
          "label": "Equity",
          "amount": 134567890.12,
          "positions": 10,
          "avg_rate": null,
          "avg_maturity": null
        }
      ]
    },
    "derivatives": null
  }
}
```

#### C. balance_positions.json (Canonical Rows)

**Esquema:**
```typescript
interface CanonicalPosition {
  contract_id: string;
  sheet: string | null;
  side: 'asset' | 'liability' | 'equity' | 'derivative';
  categoria_ui: string;
  subcategoria_ui: string;
  subcategory_id: string;
  group: string | null;
  currency: string | null;
  counterparty: string | null;
  amount: number;
  book_value: number | null;
  rate_type: 'Fixed' | 'Floating' | null;
  rate_display: number | null;
  tipo_tasa_raw: string | null;
  tasa_fija: number | null;
  spread: number | null;
  indice_ref: string | null;
  tenor_indice: string | null;
  fecha_inicio: string | null;
  fecha_vencimiento: string | null;
  fecha_prox_reprecio: string | null;
  maturity_years: number | null;
  maturity_bucket: string | null;
  repricing_bucket: string | null;
  include_in_balance_tree: boolean;
  flow_type?: string;                // NUEVO (futuro)
  epigrafe?: string;                 // NUEVO (futuro)
  behavioural_adjusted?: boolean;    // NUEVO (motor externo)
  behavioural_type?: string;         // NUEVO (motor externo)
  is_synthetic?: boolean;            // NUEVO (What-If)
  what_if_id?: string;               // NUEVO (What-If)
}
```

**Ejemplo (truncado):**
```json
[
  {
    "contract_id": "A_CASH_00001",
    "sheet": "A_Cash_CentralBank",
    "side": "asset",
    "categoria_ui": "Assets",
    "subcategoria_ui": "Interbank / Central Bank",
    "subcategory_id": "interbank",
    "group": "Cash & Central Bank",
    "currency": "EUR",
    "counterparty": "Central Bank",
    "amount": 31986098.72,
    "book_value": 31986098.72,
    "rate_type": "Floating",
    "rate_display": null,
    "tipo_tasa_raw": "nonrate",
    "tasa_fija": null,
    "spread": null,
    "indice_ref": null,
    "tenor_indice": null,
    "fecha_inicio": "2025-12-31",
    "fecha_vencimiento": null,
    "fecha_prox_reprecio": null,
    "maturity_years": null,
    "maturity_bucket": null,
    "repricing_bucket": null,
    "include_in_balance_tree": true
  },
  {
    "contract_id": "A_MORTGAGES_00001",
    "sheet": "A_Mortgages",
    "side": "asset",
    "categoria_ui": "Assets",
    "subcategoria_ui": "Mortgages",
    "subcategory_id": "mortgages",
    "group": "Residential Mortgages",
    "currency": "EUR",
    "counterparty": "Retail Client",
    "amount": 250000.00,
    "book_value": 250000.00,
    "rate_type": "Fixed",
    "rate_display": 0.025,
    "tipo_tasa_raw": "fijo",
    "tasa_fija": 0.025,
    "spread": null,
    "indice_ref": null,
    "tenor_indice": null,
    "fecha_inicio": "2020-01-01",
    "fecha_vencimiento": "2040-01-01",
    "fecha_prox_reprecio": null,
    "maturity_years": 14.0,
    "maturity_bucket": "10-20Y",
    "repricing_bucket": null,
    "include_in_balance_tree": true
  }
]
```

#### D. curves_points.json (Curves Data)

**Esquema:**
```typescript
interface CurvesPointsData {
  [curve_id: string]: CurvePoint[];
}

interface CurvePoint {
  tenor: string;      // "ON", "1M", "3M", "1Y", etc.
  t_years: number;    // Tiempo en años decimales
  rate: number;       // Tasa en decimal
}
```

**Ejemplo:**
```json
{
  "EUR_ESTR_OIS": [
    {"tenor": "ON", "t_years": 0.002739726027397260, "rate": 0.0285},
    {"tenor": "1W", "t_years": 0.01917808219178082, "rate": 0.0286},
    {"tenor": "1M", "t_years": 0.08333333333333333, "rate": 0.0289},
    {"tenor": "3M", "t_years": 0.25, "rate": 0.0295},
    {"tenor": "6M", "t_years": 0.5, "rate": 0.0305},
    {"tenor": "1Y", "t_years": 1.0, "rate": 0.0325},
    {"tenor": "2Y", "t_years": 2.0, "rate": 0.0350},
    {"tenor": "3Y", "t_years": 3.0, "rate": 0.0365},
    {"tenor": "5Y", "t_years": 5.0, "rate": 0.0380},
    {"tenor": "7Y", "t_years": 7.0, "rate": 0.0395},
    {"tenor": "10Y", "t_years": 10.0, "rate": 0.0410},
    {"tenor": "15Y", "t_years": 15.0, "rate": 0.0425},
    {"tenor": "20Y", "t_years": 20.0, "rate": 0.0435},
    {"tenor": "30Y", "t_years": 30.0, "rate": 0.0445},
    {"tenor": "50Y", "t_years": 50.0, "rate": 0.0450}
  ],
  "EUR_EURIBOR_3M": [
    {"tenor": "1M", "t_years": 0.08333333333333333, "rate": 0.0310},
    {"tenor": "3M", "t_years": 0.25, "rate": 0.0315},
    {"tenor": "6M", "t_years": 0.5, "rate": 0.0325},
    {"tenor": "1Y", "t_years": 1.0, "rate": 0.0345}
  ]
}
```

#### E. calculation_results.json (CalculationResults)

**Esquema:**
```typescript
interface CalculationResults {
  session_id: string;
  baseEve: number;
  baseNii: number;
  worstCaseEve: number;
  worstCaseDeltaEve: number;
  worstCaseScenario: string;
  scenarioResults: ScenarioResult[];
  calculatedAt: string;
}

interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  eve: number;
  nii: number;
  deltaEve: number;
  deltaNii: number;
}
```

**Ejemplo:**
```json
{
  "session_id": "a3b2c1d4-5678-90ab-cdef-1234567890ab",
  "baseEve": 125000000.50,
  "baseNii": 8500000.25,
  "worstCaseEve": 98000000.75,
  "worstCaseDeltaEve": -27000000.25,
  "worstCaseScenario": "parallel-up",
  "scenarioResults": [
    {
      "scenarioId": "parallel-up",
      "scenarioName": "Parallel Up (+200bps)",
      "eve": 98000000.75,
      "nii": 10200000.50,
      "deltaEve": -27000000.25,
      "deltaNii": 1700000.25
    },
    {
      "scenarioId": "parallel-down",
      "scenarioName": "Parallel Down (-200bps)",
      "eve": 152000000.25,
      "nii": 6800000.00,
      "deltaEve": 27000000.75,
      "deltaNii": -1700000.25
    },
    {
      "scenarioId": "steepener",
      "scenarioName": "Steepener",
      "eve": 110000000.00,
      "nii": 9000000.00,
      "deltaEve": -15000000.50,
      "deltaNii": 500000.75
    }
  ],
  "calculatedAt": "2026-02-16T23:00:00.000Z"
}
```

### 10.2 Relaciones Entre Archivos y Flujo de Datos

```
┌──────────────────────────────────────────────────────────────┐
│ PERSISTENCIA POR SESIÓN                                      │
│ /backend/data/sessions/{session_id}/                         │
└──────────────────────────────────────────────────────────────┘

meta.json
  ├─ Creado: POST /api/sessions
  ├─ Leído: GET /api/sessions/{id}
  └─ Independiente

balance__*.xlsx
  ├─ Creado: POST /api/sessions/{id}/balance
  ├─ Leído: Solo por parser (nunca devuelto a frontend)
  └─ Usado para regenerar summary si se pierde JSON

balance_summary.json
  ├─ Creado: POST /api/sessions/{id}/balance (después de parsear Excel)
  ├─ Leído: GET /api/sessions/{id}/balance/summary
  ├─ Depende de: balance__*.xlsx (parseado)
  ├─ Consumidores: Frontend → BalancePositionsCardConnected
  └─ Contiene: summary_tree (jerarquía completa)

balance_positions.json
  ├─ Creado: POST /api/sessions/{id}/balance (canonical_rows)
  ├─ Leído:
  │   ├─ GET /api/sessions/{id}/balance/details (filtrado + agregación)
  │   ├─ GET /api/sessions/{id}/balance/contracts (búsqueda + paginación)
  │   └─ POST /api/sessions/{id}/calculate (motor externo)
  ├─ Depende de: balance__*.xlsx (parseado)
  └─ Es la fuente de verdad para posiciones

balance_contracts.json
  ├─ Creado: POST /api/sessions/{id}/balance (simplificado)
  ├─ Leído: GET /api/sessions/{id}/balance/contracts
  ├─ Depende de: balance_positions.json (subset de campos)
  └─ Optimización para búsquedas (menos campos)

curves__*.xlsx
  ├─ Creado: POST /api/sessions/{id}/curves
  ├─ Leído: Solo por parser
  └─ Usado para regenerar curves si se pierde JSON

curves_summary.json
  ├─ Creado: POST /api/sessions/{id}/curves (después de parsear)
  ├─ Leído: GET /api/sessions/{id}/curves/summary
  ├─ Depende de: curves__*.xlsx (parseado)
  ├─ Consumidores: Frontend → CurvesAndScenariosCard
  └─ Contiene: Catálogo de curvas

curves_points.json
  ├─ Creado: POST /api/sessions/{id}/curves
  ├─ Leído:
  │   ├─ GET /api/sessions/{id}/curves/{curve_id}
  │   └─ POST /api/sessions/{id}/calculate (motor externo)
  ├─ Depende de: curves__*.xlsx (parseado)
  └─ Es la fuente de verdad para puntos de curva

calculation_results.json
  ├─ Creado: POST /api/sessions/{id}/calculate
  ├─ Leído: GET /api/sessions/{id}/results (futuro)
  ├─ Depende de:
  │   ├─ balance_positions.json
  │   ├─ curves_points.json
  │   └─ Motor EVE/NII externo
  └─ Resultados persistidos de cálculo
```

### 10.3 Queries de Filtrado y Búsqueda

**GET /api/sessions/{id}/balance/details:**

Filtros soportados (SQL-like WHERE clause):
```sql
SELECT *
FROM balance_positions
WHERE
  include_in_balance_tree = true
  AND (categoria_ui = ? OR ? IS NULL)
  AND (subcategoria_ui = ? OR subcategory_id = ? OR ? IS NULL)
  AND (currency IN (?, ?, ...) OR ? IS NULL)
  AND (rate_type IN (?, ?, ...) OR ? IS NULL)
  AND (counterparty IN (?, ?, ...) OR ? IS NULL)
  AND (maturity_bucket IN (?, ?, ...) OR ? IS NULL)
```

Agregación:
```sql
SELECT
  group,
  SUM(amount) as amount,
  COUNT(*) as positions,
  SUM(rate_display * ABS(amount)) / SUM(ABS(amount)) as avg_rate,
  SUM(maturity_years * ABS(amount)) / SUM(ABS(amount)) as avg_maturity
FROM filtered_positions
GROUP BY group
ORDER BY amount DESC
```

Facets (para filtros dinámicos):
```sql
-- Currencies
SELECT currency, COUNT(*) as count
FROM filtered_positions
WHERE currency IS NOT NULL
GROUP BY currency
ORDER BY count DESC

-- Rate Types
SELECT rate_type, COUNT(*) as count
FROM filtered_positions
WHERE rate_type IS NOT NULL
GROUP BY rate_type

-- Counterparties
SELECT counterparty, COUNT(*) as count
FROM filtered_positions
WHERE counterparty IS NOT NULL
GROUP BY counterparty
ORDER BY count DESC
LIMIT 20

-- Maturity Buckets
SELECT maturity_bucket, COUNT(*) as count
FROM filtered_positions
WHERE maturity_bucket IS NOT NULL
GROUP BY maturity_bucket
ORDER BY
  CASE maturity_bucket
    WHEN '<1Y' THEN 1
    WHEN '1-5Y' THEN 2
    WHEN '5-10Y' THEN 3
    WHEN '10-20Y' THEN 4
    WHEN '>20Y' THEN 5
  END
```

**GET /api/sessions/{id}/balance/contracts:**

Búsqueda full-text (SQL-like LIKE):
```sql
SELECT *
FROM balance_contracts
WHERE
  (
    LOWER(contract_id) LIKE LOWER('%' || ? || '%')
    OR LOWER(sheet) LIKE LOWER('%' || ? || '%')
    OR LOWER(group) LIKE LOWER('%' || ? || '%')
  )
  AND (categoria_ui = ? OR ? IS NULL)
  AND (subcategory = ? OR subcategoria_ui = ? OR ? IS NULL)
  AND (currency IN (?, ...) OR ? IS NULL)
  AND (rate_type IN (?, ...) OR ? IS NULL)
  AND (counterparty IN (?, ...) OR ? IS NULL)
  AND (maturity_bucket IN (?, ...) OR ? IS NULL)
  AND (group IN (?, ...) OR ? IS NULL)
ORDER BY amount DESC
LIMIT ? OFFSET ?
```

Paginación:
```
Total: COUNT(*)
Page: query param (default 1)
Page Size: query param (default 100, max 2000)
Offset: (page - 1) * page_size
Limit: page_size
```

### 10.4 Índices y Optimizaciones (En Memoria)

**Actual (sin índices):**
- Todos los queries son full table scans en memoria
- balance_positions.json se carga completo en cada request
- Filtrado secuencial: O(n) donde n = cantidad de posiciones

**Optimizaciones recomendadas para balances grandes (>100K posiciones):**

1. **Índice por subcategory_id:**
   ```python
   # Al cargar balance_positions.json, crear índice
   index_by_subcategory = {}
   for position in positions:
       subcat = position['subcategory_id']
       if subcat not in index_by_subcategory:
           index_by_subcategory[subcat] = []
       index_by_subcategory[subcat].append(position)

   # Query optimizado
   def get_positions_by_subcategory(subcategory_id):
       return index_by_subcategory.get(subcategory_id, [])
   ```

2. **Índice por contract_id (hash map):**
   ```python
   index_by_contract_id = {
       pos['contract_id']: pos
       for pos in positions
   }

   # Búsqueda O(1)
   def get_position_by_id(contract_id):
       return index_by_contract_id.get(contract_id)
   ```

3. **Pre-agregaciones:**
   ```python
   # Calcular summary_tree solo una vez (al cargar)
   # Cachear en memoria durante request lifecycle

   @lru_cache(maxsize=128)
   def get_aggregated_summary(session_id, subcategory_id):
       # Retorna pre-calculado
       pass
   ```

4. **Paginación eficiente:**
   ```python
   # En vez de cargar todo y paginar en Python:
   # Usar generadores para leer JSON en streaming

   import ijson

   def iter_positions(session_id, offset, limit):
       file_path = _positions_path(session_id)
       with open(file_path, 'rb') as f:
           positions = ijson.items(f, 'item')
           # Skip offset
           for _ in range(offset):
               next(positions, None)
           # Yield limit items
           for i, pos in enumerate(positions):
               if i >= limit:
                   break
               yield pos
   ```

5. **Compresión:**
   ```python
   # Para sesiones grandes, comprimir JSON
   import gzip

   def save_positions_compressed(session_id, positions):
       file_path = _positions_path(session_id).with_suffix('.json.gz')
       with gzip.open(file_path, 'wt', encoding='utf-8') as f:
           json.dump(positions, f)

   def load_positions_compressed(session_id):
       file_path = _positions_path(session_id).with_suffix('.json.gz')
       with gzip.open(file_path, 'rt', encoding='utf-8') as f:
           return json.load(f)
   ```

### 10.5 Flujo Completo de Lectura/Escritura

**Escritura (Upload de Balance):**

```
1. Frontend: POST /api/sessions/{id}/balance
   Body: multipart/form-data { file: balance.xlsx }

2. Backend: main.py
   ├─ Validar sesión existe
   ├─ Guardar balance__Balance_Q4_2024.xlsx
   ├─ Parsear Excel:
   │  ├─ _parse_workbook(wb)
   │  ├─ _validate_base_sheet_columns(df, sheet)
   │  ├─ Por cada fila: _canonicalize_position_row(row)
   │  └─ canonical_rows = [...]
   │
   ├─ Generar agregaciones:
   │  ├─ summary_tree = _build_summary_tree(canonical_rows)
   │  │  ├─ assets = _build_category_tree(rows, 'asset')
   │  │  ├─ liabilities = _build_category_tree(rows, 'liability')
   │  │  ├─ equity = _build_optional_side_tree(rows, 'equity')
   │  │  └─ derivatives = _build_optional_side_tree(rows, 'derivative')
   │  │
   │  ├─ sheet_summaries = [...] (metadata por hoja)
   │  └─ sample_rows = {...} (primeras 3 filas)
   │
   ├─ Persistir en disco:
   │  ├─ balance_summary.json
   │  │  └─ BalanceUploadResponse {
   │  │       session_id, filename, uploaded_at,
   │  │       sheets, sample_rows, summary_tree
   │  │     }
   │  │
   │  ├─ balance_positions.json
   │  │  └─ canonical_rows (array completo)
   │  │
   │  └─ balance_contracts.json
   │     └─ simplified_contracts (subset de campos)
   │
   └─ Retornar: BalanceUploadResponse
```

**Lectura (Get Balance Summary):**

```
1. Frontend: GET /api/sessions/{id}/balance/summary

2. Backend: main.py
   ├─ Validar sesión existe
   ├─ Buscar balance_summary.json
   │  ├─ Si existe: leer y retornar
   │  └─ Si no existe:
   │     ├─ Buscar balance__*.xlsx más reciente
   │     ├─ Re-parsear Excel
   │     ├─ Regenerar balance_summary.json
   │     └─ Retornar
   │
   └─ Retornar: BalanceUploadResponse
```

**Lectura (Get Balance Details con Filtros):**

```
1. Frontend: GET /api/sessions/{id}/balance/details
   Query params:
     categoria_ui=Assets
     subcategoria_ui=Mortgages
     currency=EUR,USD
     rate_type=Fixed

2. Backend: main.py
   ├─ Validar sesión
   ├─ Cargar balance_positions.json completo
   ├─ Aplicar filtros en cascada:
   │  ├─ Filter por categoria_ui
   │  ├─ Filter por subcategoria_ui
   │  ├─ Filter por currency IN (EUR, USD)
   │  ├─ Filter por rate_type = Fixed
   │  └─ filtered_positions = [...]
   │
   ├─ Agrupar por "group":
   │  ├─ GROUP BY group
   │  ├─ SUM(amount) as amount
   │  ├─ COUNT(*) as positions
   │  ├─ weighted_avg_rate
   │  └─ weighted_avg_maturity
   │
   ├─ Calcular totales:
   │  ├─ total_amount = SUM(all amounts)
   │  ├─ total_positions = COUNT(all)
   │  ├─ total_avg_rate
   │  └─ total_avg_maturity
   │
   ├─ Generar facets:
   │  ├─ currencies: GROUP BY currency, COUNT
   │  ├─ rate_types: GROUP BY rate_type, COUNT
   │  ├─ counterparties: GROUP BY counterparty, COUNT
   │  └─ maturities: GROUP BY maturity_bucket, COUNT
   │
   └─ Retornar: BalanceDetailsResponse {
       session_id, categoria_ui, subcategoria_ui,
       groups: [BalanceDetailsGroup],
       totals: BalanceDetailsTotals,
       facets: BalanceDetailsFacets
     }
```

**Búsqueda (Search Contracts con Paginación):**

```
1. Frontend: GET /api/sessions/{id}/balance/contracts
   Query params:
     q=MORTGAGE
     page=2
     page_size=50

2. Backend: main.py
   ├─ Validar sesión
   ├─ Cargar balance_contracts.json completo
   ├─ Aplicar búsqueda full-text:
   │  └─ q.lower() IN (contract_id, sheet, group).lower()
   │
   ├─ Contar total: total = len(filtered)
   ├─ Paginar:
   │  ├─ offset = (page - 1) * page_size = 50
   │  ├─ limit = page_size = 50
   │  └─ paginated = filtered[offset:offset+limit]
   │
   └─ Retornar: BalanceContractsResponse {
       session_id, total, page, page_size,
       contracts: paginated
     }
```

---

**Fin del Análisis Técnico Expandido**

Este documento describe exhaustivamente cómo funciona ALMReady a nivel técnico agregado, con profundización adicional en:
- Integración completa con motor EVE/NII externo (código, formato de datos, manejo de What-If y Behavioural)
- Estructura de datos y persistencia (esquemas JSON completos, relaciones, queries, optimizaciones)

Cubre la arquitectura completa, flujos de datos, parsers, motor de cálculo, y puntos de integración para el motor EVE/NII externo con nueva estructura de balance basada en CSVs por tipo de flujo.
