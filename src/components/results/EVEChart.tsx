/**
 * EVEChart.tsx – Dual-stack bar chart for Economic Value of Equity (EVE).
 *
 * === DATA SOURCE ===
 * When `eveBuckets` prop is provided (from GET /results/chart-data), the chart
 * uses REAL per-bucket PV data from the backend. When not available it shows a
 * "Computing…" placeholder.
 *
 * === VISUAL DESIGN ===
 * Each bucket shows TWO side-by-side stacked bars:
 *   - "Base" stack (lighter colours)
 *   - "Scenario" stack (darker colours) – whichever scenario is selected
 * Within each stack, assets grow upward (green) and liabilities grow
 * downward (red). What-If impact is rendered as amber segments.
 * Two Net EV lines (base=light blue, scenario=dark blue) overlay the bars.
 */
import { useMemo, useCallback } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { differenceInCalendarMonths, differenceInDays, getDaysInMonth } from 'date-fns';
import { useWhatIf } from '@/components/whatif/WhatIfContext';
import type { ChartBucketRow, WhatIfBucketDelta } from '@/lib/api';

// ─── Colours ─────────────────────────────────────────────────────────────────

const C = {
  baseAsset:      '#5bb88a',
  scenarioAsset:  '#3a8a62',
  baseLiab:       '#e07872',
  scenarioLiab:   '#c44d48',
  whatIf:         '#daa44a',
  whatIfStroke:   '#c08e38',
  netBase:        '#6ba3c7',
  netScenario:    '#2e5f8a',
} as const;

const INSIDE_STROKE = 2.5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Scale factor: backend PV is in absolute currency, display in Mln */
const SCALE = 1e6;

/** Exact month difference using calendar math (date-fns). */
function exactMonthDiff(from: Date, to: Date): number {
  const wholeMonths = differenceInCalendarMonths(to, from);
  // Add fractional month based on remaining days
  const interim = new Date(from.getFullYear(), from.getMonth() + wholeMonths, from.getDate());
  const remainingDays = differenceInDays(to, interim);
  const daysInTargetMonth = getDaysInMonth(interim);
  return wholeMonths + remainingDays / daysInTargetMonth;
}

function findBucketIndex(matMonths: number, bucketMonths: number[]): number {
  let idx = bucketMonths.length - 1;
  for (let i = 0; i < bucketMonths.length - 1; i++) {
    if (matMonths < bucketMonths[i + 1]) { idx = i; break; }
  }
  return idx;
}

function allocateWhatIfByBucket(
  modifications: any[],
  analysisDate: Date | null,
  bucketNames: string[],
  bucketStartYears: number[],
): Array<{ dA: number; dL: number }> {
  const perBucket = bucketNames.map(() => ({ dA: 0, dL: 0 }));
  if (bucketNames.length === 0) return perBucket;

  // Convert bucket start years to months for matching
  const bucketMonths = bucketStartYears.map(y => y * 12);

  modifications.forEach((mod) => {
    const sign = mod.type === 'add' ? 1 : -1;
    const key: 'dA' | 'dL' | null =
      mod.category === 'asset' ? 'dA' : mod.category === 'liability' ? 'dL' : null;
    if (!key) return;

    // If the modification carries a per-position maturity distribution,
    // allocate each position's amount to its correct bucket.
    if (mod.maturityProfile && mod.maturityProfile.length > 0) {
      mod.maturityProfile.forEach((entry: { amount: number; maturityYears: number }) => {
        const amt = (entry.amount || 0) * sign;
        const matMo = (entry.maturityYears || 0) * 12;
        const idx = findBucketIndex(matMo, bucketMonths);
        perBucket[idx][key] += amt;
      });
      return;
    }

    // Single-position fallback: place 100% in one bucket
    const notional = (mod.notional || 0) * sign;

    let matMonths: number | null = null;
    if (mod.maturityDate && analysisDate) {
      matMonths = exactMonthDiff(analysisDate, new Date(mod.maturityDate));
      if (matMonths < 0) matMonths = 0;
    } else if (mod.maturity != null) {
      matMonths = mod.maturity * 12;
    }

    if (matMonths != null) {
      perBucket[findBucketIndex(matMonths, bucketMonths)][key] += notional;
    } else {
      const share = notional / bucketNames.length;
      perBucket.forEach(t => { t[key] += share; });
    }
  });

  return perBucket;
}

function decomposeStack(A: number, L: number, dA: number, dL: number) {
  const assetReduction = Math.min(-Math.min(dA, 0), A);
  const liabReduction  = Math.min(Math.max(dL, 0), -L);
  return {
    assets_kept:           Math.max(0, A - assetReduction),
    assets_reduced_inside: assetReduction,
    assets_added_outside:  Math.max(dA, 0),
    liabs_kept:            Math.min(0, L + liabReduction),
    liabs_reduced_inside:  -liabReduction,
    liabs_added_outside:   Math.min(dL, 0),
  };
}

interface BucketBaseline {
  bucket: string;
  assetsBase: number;
  liabsBase: number;
  assetsScenario: number;
  liabsScenario: number;
}

function buildBaselineFromBuckets(
  eveBuckets: ChartBucketRow[],
  scenarioId: string,
): BucketBaseline[] {
  // Group by bucket_name, preserve order by bucket_start_years
  const baseBuckets = eveBuckets.filter(b => b.scenario === 'base');
  const scenarioBuckets = eveBuckets.filter(b => b.scenario === scenarioId);

  // Get ordered unique bucket names from base scenario
  const seen = new Set<string>();
  const orderedBuckets: { name: string; startYears: number }[] = [];
  for (const b of baseBuckets) {
    if (!seen.has(b.bucket_name)) {
      seen.add(b.bucket_name);
      orderedBuckets.push({ name: b.bucket_name, startYears: b.bucket_start_years });
    }
  }
  orderedBuckets.sort((a, b) => a.startYears - b.startYears);

  // Build lookup maps
  const baseMap = new Map<string, { asset: number; liab: number }>();
  for (const b of baseBuckets) {
    const existing = baseMap.get(b.bucket_name) ?? { asset: 0, liab: 0 };
    existing.asset = b.asset_pv / SCALE;
    existing.liab = b.liability_pv / SCALE;
    baseMap.set(b.bucket_name, existing);
  }

  const scenarioMap = new Map<string, { asset: number; liab: number }>();
  for (const b of scenarioBuckets) {
    const existing = scenarioMap.get(b.bucket_name) ?? { asset: 0, liab: 0 };
    existing.asset = b.asset_pv / SCALE;
    existing.liab = b.liability_pv / SCALE;
    scenarioMap.set(b.bucket_name, existing);
  }

  return orderedBuckets.map(({ name }) => {
    const base = baseMap.get(name) ?? { asset: 0, liab: 0 };
    const scen = scenarioMap.get(name) ?? base;
    return {
      bucket: name,
      assetsBase: base.asset,
      liabsBase: base.liab,
      assetsScenario: scen.asset,
      liabsScenario: scen.liab,
    };
  });
}

function buildEveChartData(
  baselines: BucketBaseline[],
  perBucketDeltas: Array<{ dA: number; dL: number }>,
) {
  return baselines.map((b, i) => {
    const dA = (perBucketDeltas[i]?.dA ?? 0) / SCALE;
    const dL = -(perBucketDeltas[i]?.dL ?? 0) / SCALE;

    const base = decomposeStack(b.assetsBase, b.liabsBase, dA, dL);
    const scen = decomposeStack(b.assetsScenario, b.liabsScenario, dA, dL);

    return {
      tenor: b.bucket,
      // Base stack
      ak_b: base.assets_kept, ari_b: base.assets_reduced_inside, aao_b: base.assets_added_outside,
      lk_b: base.liabs_kept,  lri_b: base.liabs_reduced_inside,  lao_b: base.liabs_added_outside,
      // Scenario stack
      ak_s: scen.assets_kept, ari_s: scen.assets_reduced_inside, aao_s: scen.assets_added_outside,
      lk_s: scen.liabs_kept,  lri_s: scen.liabs_reduced_inside,  lao_s: scen.liabs_added_outside,
      // Net EV lines
      netBase:     (b.assetsBase     + dA) + (b.liabsBase     + dL),
      netScenario: (b.assetsScenario + dA) + (b.liabsScenario + dL),
      // Tooltip raw
      _assetsBase: b.assetsBase, _liabsBase: b.liabsBase,
      _assetsScenario: b.assetsScenario, _liabsScenario: b.liabsScenario,
      _dA: dA, _dL: dL,
    };
  });
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function fmtVal(v: number) {
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + '€';
}

function fmtDelta(v: number) {
  return `${v >= 0 ? '+' : ''}${fmtVal(v)}`;
}

// ─── Custom bar shape ────────────────────────────────────────────────────────

interface StyledBarProps {
  x?: number; y?: number; width?: number; height?: number;
  fillColor: string; strokeColor: string; sw: number; inset?: boolean;
}
function StyledBar({ x = 0, y = 0, width = 0, height = 0, fillColor, strokeColor, sw, inset }: StyledBarProps) {
  if (height === 0 || width === 0) return null;
  const ry = height < 0 ? y + height : y;
  const rh = Math.abs(height);

  if (inset && sw > 0) {
    const half = sw / 2;
    return (
      <g>
        <rect x={x} y={ry} width={width} height={rh} fill={fillColor} />
        <rect
          x={x + half} y={ry + half}
          width={Math.max(0, width - sw)} height={Math.max(0, rh - sw)}
          fill="none" stroke={strokeColor} strokeWidth={sw}
        />
      </g>
    );
  }

  if (sw === 0) {
    return <rect x={x} y={ry - 0.5} width={width} height={rh + 1} fill={fillColor} />;
  }
  return (
    <rect x={x} y={ry} width={width} height={rh}
      fill={fillColor} stroke={strokeColor} strokeWidth={sw} />
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface EVEChartProps {
  className?: string;
  fullWidth?: boolean;
  analysisDate?: Date | null;
  selectedScenario: string;
  scenarioLabel: string;
  eveBuckets?: ChartBucketRow[];
  chartDataLoading?: boolean;
  whatIfBucketDeltas?: WhatIfBucketDelta[];
}

export function EVEChart({
  className,
  fullWidth = false,
  analysisDate,
  selectedScenario,
  scenarioLabel,
  eveBuckets,
  chartDataLoading = false,
  whatIfBucketDeltas,
}: EVEChartProps) {
  const { modifications } = useWhatIf();
  const hasWhatIf = modifications.length > 0;
  const hasRealData = eveBuckets && eveBuckets.length > 0;

  const baselines = useMemo(
    () => hasRealData ? buildBaselineFromBuckets(eveBuckets, selectedScenario) : [],
    [eveBuckets, selectedScenario, hasRealData],
  );

  const bucketStartYears = useMemo(
    () => hasRealData
      ? [...new Set(eveBuckets.filter(b => b.scenario === 'base').map(b => b.bucket_start_years))].sort((a, b) => a - b)
      : [],
    [eveBuckets, hasRealData],
  );

  const bucketNames = useMemo(() => baselines.map(b => b.bucket), [baselines]);

  const effectiveAnalysisDate = analysisDate ?? new Date();

  // Use backend-computed PV deltas when available (accurate, post-Apply),
  // fall back to frontend approximation (preview, before Apply).
  const perBucketDeltas = useMemo(() => {
    if (whatIfBucketDeltas && whatIfBucketDeltas.length > 0 && bucketNames.length > 0) {
      // Build lookup from bucket_name → { dA, dL } using base scenario PVs.
      // liability_pv_delta from the backend is negative when adding liabilities
      // (more negative PV), but the frontend convention is positive = adding.
      // Negate to match (buildEveChartData negates again for display).
      const deltaMap = new Map<string, { dA: number; dL: number }>();
      for (const d of whatIfBucketDeltas) {
        if (d.scenario !== 'base') continue;
        deltaMap.set(d.bucket_name, {
          dA: d.asset_pv_delta,
          dL: -d.liability_pv_delta,
        });
      }
      return bucketNames.map(name => deltaMap.get(name) ?? { dA: 0, dL: 0 });
    }
    return allocateWhatIfByBucket(modifications, effectiveAnalysisDate, bucketNames, bucketStartYears);
  }, [whatIfBucketDeltas, modifications, effectiveAnalysisDate, bucketNames, bucketStartYears]);

  const chartData = useMemo(
    () => hasRealData ? buildEveChartData(baselines, perBucketDeltas) : [],
    [baselines, perBucketDeltas, hasRealData],
  );

  const CustomXAxisTick = useCallback(({ x, y, payload }: any) => {
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={10} textAnchor="middle"
          fill="hsl(var(--muted-foreground))" fontSize={fullWidth ? 10 : 9} fontWeight={500}>
          {payload.value}
        </text>
      </g>
    );
  }, [fullWidth]);

  const CustomTooltip = useCallback(({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const dp = chartData.find((d) => d.tenor === label);
    if (!dp) return null;

    const sections = [
      { tag: 'Base', a: dp._assetsBase, l: dp._liabsBase, net: dp.netBase, color: C.netBase },
      { tag: scenarioLabel || 'Scenario', a: dp._assetsScenario, l: dp._liabsScenario, net: dp.netScenario, color: C.netScenario },
    ];

    return (
      <div className="rounded-lg border border-border/40 bg-background/95 backdrop-blur-sm px-3 py-2 text-[11px] shadow-xl min-w-[190px]">
        <div className="font-semibold text-foreground mb-1.5 pb-1 border-b border-border/30">
          {label}
        </div>
        {sections.map((s, idx) => (
          <div key={s.tag} className={idx > 0 ? 'mt-1.5 pt-1.5 border-t border-border/20' : ''}>
            <div className="text-muted-foreground font-medium mb-0.5">{s.tag}</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-px">
              <span className="text-muted-foreground">Assets:</span>
              <span className="text-right font-mono">{fmtVal(s.a)}</span>
              <span className="text-muted-foreground">Liabilities:</span>
              <span className="text-right font-mono">{fmtVal(Math.abs(s.l))}</span>
              {hasWhatIf && (
                <>
                  <span style={{ color: C.whatIf }}>Δ Assets:</span>
                  <span className="text-right font-mono" style={{ color: C.whatIf }}>{fmtDelta(dp._dA)}</span>
                  <span style={{ color: C.whatIf }}>Δ Liabs:</span>
                  <span className="text-right font-mono" style={{ color: C.whatIf }}>{fmtDelta(dp._dL)}</span>
                </>
              )}
              <span className="font-medium" style={{ color: s.color }}>Net EV:</span>
              <span className="text-right font-mono font-medium" style={{ color: s.color }}>{fmtVal(s.net)}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }, [chartData, hasWhatIf, scenarioLabel]);

  const makeShape = (fill: string, stroke: string, sw: number, inset: boolean) => (props: any) => (
    <StyledBar {...props} fillColor={fill} strokeColor={stroke} sw={sw} inset={inset} />
  );

  const barDefs = [
    { key: 'ak_b',  sid: 'base',     fill: C.baseAsset,      stroke: C.baseAsset,      sw: 0, inset: false },
    { key: 'ari_b', sid: 'base',     fill: C.whatIf,          stroke: C.baseAsset,      sw: INSIDE_STROKE, inset: true },
    { key: 'aao_b', sid: 'base',     fill: C.whatIf,          stroke: C.whatIfStroke,    sw: 0, inset: false },
    { key: 'lk_b',  sid: 'base',     fill: C.baseLiab,        stroke: C.baseLiab,       sw: 0, inset: false },
    { key: 'lri_b', sid: 'base',     fill: C.whatIf,          stroke: C.baseLiab,       sw: INSIDE_STROKE, inset: true },
    { key: 'lao_b', sid: 'base',     fill: C.whatIf,          stroke: C.whatIfStroke,    sw: 0, inset: false },
    { key: 'ak_s',  sid: 'scenario', fill: C.scenarioAsset,   stroke: C.scenarioAsset,  sw: 0, inset: false },
    { key: 'ari_s', sid: 'scenario', fill: C.whatIf,           stroke: C.scenarioAsset,  sw: INSIDE_STROKE, inset: true },
    { key: 'aao_s', sid: 'scenario', fill: C.whatIf,           stroke: C.whatIfStroke,    sw: 0, inset: false },
    { key: 'lk_s',  sid: 'scenario', fill: C.scenarioLiab,    stroke: C.scenarioLiab,   sw: 0, inset: false },
    { key: 'lri_s', sid: 'scenario', fill: C.whatIf,           stroke: C.scenarioLiab,   sw: INSIDE_STROKE, inset: true },
    { key: 'lao_s', sid: 'scenario', fill: C.whatIf,           stroke: C.whatIfStroke,    sw: 0, inset: false },
  ];

  if (!hasRealData) {
    return (
      <div className={`h-full flex flex-col ${className ?? ''}`}>
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            Economic Value (EVE)
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          {chartDataLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Computing bucket breakdown...
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Run calculation to see EVE chart</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${className ?? ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          Economic Value (EVE)
        </span>
        <span className="text-[9px] text-muted-foreground">
          {scenarioLabel}
          {hasWhatIf && <span className="ml-1 text-warning">(+What-If)</span>}
        </span>
      </div>

      {/* Chart */}
      <div className={`flex-1 px-1 ${fullWidth ? 'min-h-0' : 'h-[180px]'}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: 10, left: 0, bottom: 25 }}
            stackOffset="sign"
            barGap={0}
            barCategoryGap="25%"
          >
            <CartesianGrid
              strokeDasharray="3 3" stroke="hsl(var(--border))"
              opacity={0.25} vertical={false}
            />
            <XAxis dataKey="tenor" tick={<CustomXAxisTick />}
              axisLine={false} tickLine={false} height={35} />
            <YAxis
              tick={{ fontSize: fullWidth ? 10 : 9, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false} tickLine={false}
              tickFormatter={(v) => `${Math.abs(v)}`} width={38}
            />
            <Tooltip content={<CustomTooltip />}
              cursor={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.05 }} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />

            {barDefs.map((d) => (
              <Bar key={d.key} dataKey={d.key} stackId={d.sid}
                shape={makeShape(d.fill, d.stroke, d.sw, d.inset)}
                isAnimationActive={false} />
            ))}

            <Line type="monotone" dataKey="netBase" stroke={C.netBase}
              strokeWidth={1.5} dot={{ r: 2.5, fill: C.netBase, strokeWidth: 0 }}
              activeDot={{ r: 3.5, strokeWidth: 0 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="netScenario" stroke={C.netScenario}
              strokeWidth={2} dot={{ r: 2.5, fill: C.netScenario, strokeWidth: 0 }}
              activeDot={{ r: 3.5, strokeWidth: 0 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 px-3 py-1 text-[9px] shrink-0">
        <div className="flex items-center gap-1.5">
          <div className="flex gap-px">
            <div className="w-2 h-2 rounded-sm" style={{ background: C.baseAsset }} />
            <div className="w-2 h-2 rounded-sm" style={{ background: C.baseLiab }} />
          </div>
          <span className="text-muted-foreground">Base</span>
          <div className="flex gap-px ml-1">
            <div className="w-2 h-2 rounded-sm" style={{ background: C.scenarioAsset }} />
            <div className="w-2 h-2 rounded-sm" style={{ background: C.scenarioLiab }} />
          </div>
          <span className="text-muted-foreground">{scenarioLabel.replace(/ \(Worst\)$/, '')}</span>
        </div>
        {hasWhatIf && (
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ background: C.whatIf }} />
            <span className="text-muted-foreground">What-If</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <svg width="14" height="8"><line x1="0" y1="4" x2="14" y2="4" stroke={C.netBase} strokeWidth="1.5" /></svg>
          <span className="text-muted-foreground">Net Base</span>
          <svg width="14" height="8"><line x1="0" y1="4" x2="14" y2="4" stroke={C.netScenario} strokeWidth="2" /></svg>
          <span className="text-muted-foreground">Net Scen.</span>
        </div>
      </div>
    </div>
  );
}
