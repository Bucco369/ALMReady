/**
 * CurveTorsionEditor.tsx – Interactive drag-to-modify curve editor for custom torsion scenarios.
 *
 * ── ROLE IN THE SYSTEM ──────────────────────────────────────────────────
 *
 *   Opened from CurvesAndScenariosCard's "+ Custom" popover when the user
 *   selects "Curve Torsion". Displays the base risk-free curve and lets
 *   the user drag individual tenor points up/down to define per-tenor shocks.
 *
 *   The result is a Record<string, number> (tenor → shock in bps) that gets
 *   stored in Scenario.customShocks and applied via buildScenarioPoints().
 *
 * ── DRAG MECHANISM ──────────────────────────────────────────────────────
 *
 *   1. Custom `dot` render on the torsioned curve → SVG circles (r=6)
 *   2. onMouseDown on a dot: records tenor, startY, startShock
 *   3. window mousemove: converts pixel delta → bps delta via Y-axis scale
 *   4. window mouseup: clears drag state
 *   5. Y conversion: deltaBps = -(deltaPixels / chartHeight) * yDomainSpan * 100
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Check, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { CurvePoint } from '@/lib/api';

interface CurveTorsionEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  basePoints: CurvePoint[];
  baseCurveLabel: string;
  onCreateScenario: (name: string, shocks: Record<string, number>) => void;
  /** Pre-populate shocks when editing an existing scenario */
  initialShocks?: Record<string, number>;
  /** Pre-populate name when editing an existing scenario */
  initialName?: string;
  /** When true, shows "Update Scenario" instead of "Create Scenario" */
  editMode?: boolean;
}

const CHART_MARGIN = { top: 10, right: 20, left: 50, bottom: 30 };
const DOT_RADIUS = 7;
const BASE_COLOR = 'hsl(215, 50%, 45%)';
const TORSION_COLOR = 'hsl(45, 80%, 50%)';
const DEFAULT_MAX_MATURITY = 25;
const MIN_MATURITY = 0.5;

type ChartRow = {
  t_years: number;
  tenor: string;
  base: number;
  torsioned: number;
};

export function CurveTorsionEditor({
  open,
  onOpenChange,
  basePoints,
  baseCurveLabel,
  onCreateScenario,
  initialShocks,
  initialName,
  editMode,
}: CurveTorsionEditorProps) {
  const [shocks, setShocks] = useState<Record<string, number>>({});
  const [scenarioName, setScenarioName] = useState('');
  const [maxMaturity, setMaxMaturity] = useState(DEFAULT_MAX_MATURITY);
  const [draggingTenor, setDraggingTenor] = useState<string | null>(null);
  const dragStartRef = useRef<{ y: number; shock: number } | null>(null);
  const chartContainerRef = useRef<HTMLDivElement | null>(null);

  // Reset / populate state when dialog opens
  useEffect(() => {
    if (open) {
      setShocks(initialShocks ? { ...initialShocks } : {});
      setScenarioName(initialName ?? '');
      setMaxMaturity(DEFAULT_MAX_MATURITY);
    }
  }, [open, initialShocks, initialName]);

  const maxAvailableMaturity = useMemo(() => {
    if (basePoints.length === 0) return DEFAULT_MAX_MATURITY;
    return Math.max(...basePoints.map((p) => p.t_years));
  }, [basePoints]);

  // ── Chart data ──────────────────────────────────────────────────────
  const chartData = useMemo<ChartRow[]>(() => {
    return basePoints
      .filter((p) => p.t_years <= maxMaturity)
      .map((point) => ({
        t_years: point.t_years,
        tenor: point.tenor,
        base: point.rate * 100,
        torsioned: (point.rate + (shocks[point.tenor] ?? 0) / 10000) * 100,
      }));
  }, [basePoints, shocks, maxMaturity]);

  // ── Y-axis domain ──────────────────────────────────────────────────
  const yDomain = useMemo<[number, number]>(() => {
    if (chartData.length === 0) return [0, 5];
    const allRates = chartData.flatMap((r) => [r.base, r.torsioned]);
    const min = Math.min(...allRates);
    const max = Math.max(...allRates);
    const span = max - min;
    const padding = Math.max(span * 0.15, 0.25);
    return [min - padding, max + padding];
  }, [chartData]);

  const yDomainSpan = yDomain[1] - yDomain[0];

  // ── Drag handlers ──────────────────────────────────────────────────
  const handleDotMouseDown = useCallback(
    (tenor: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingTenor(tenor);
      dragStartRef.current = {
        y: e.clientY,
        shock: shocks[tenor] ?? 0,
      };
    },
    [shocks]
  );

  useEffect(() => {
    if (!draggingTenor) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !chartContainerRef.current) return;

      const containerRect = chartContainerRef.current.getBoundingClientRect();
      const chartHeight =
        containerRect.height - CHART_MARGIN.top - CHART_MARGIN.bottom;
      if (chartHeight <= 0) return;

      const deltaPixels = e.clientY - dragStartRef.current.y;
      const deltaBps = -(deltaPixels / chartHeight) * yDomainSpan * 100;
      const newShock = Math.round(dragStartRef.current.shock + deltaBps);

      setShocks((prev) => ({ ...prev, [draggingTenor]: newShock }));
    };

    const handleMouseUp = () => {
      setDraggingTenor(null);
      dragStartRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingTenor, yDomainSpan]);

  // ── Custom dot renderer ─────────────────────────────────────────────
  const renderDraggableDot = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (props: any) => {
      const { cx, cy, payload } = props;
      if (cx === undefined || cy === undefined || !payload?.tenor) return null;
      const tenor = payload.tenor as string;
      const isDragging = draggingTenor === tenor;
      const shock = shocks[tenor] ?? 0;

      return (
        <g
          onMouseDown={(e) => handleDotMouseDown(tenor, e)}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          {/* Larger invisible hit area */}
          <circle cx={cx} cy={cy} r={DOT_RADIUS + 4} fill="transparent" />
          {/* Glow effect when modified */}
          {shock !== 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={DOT_RADIUS + 3}
              fill="none"
              stroke={TORSION_COLOR}
              strokeWidth={1}
              opacity={0.3}
            />
          )}
          {/* Visible dot */}
          <circle
            cx={cx}
            cy={cy}
            r={isDragging ? DOT_RADIUS + 1 : DOT_RADIUS}
            fill={shock !== 0 ? TORSION_COLOR : 'hsl(var(--background))'}
            stroke={TORSION_COLOR}
            strokeWidth={2}
          />
          {/* Shock label on dot */}
          {shock !== 0 && (
            <text
              x={cx}
              y={cy - DOT_RADIUS - 5}
              textAnchor="middle"
              fontSize={9}
              fontWeight={600}
              fill="hsl(var(--foreground))"
            >
              {shock > 0 ? '+' : ''}{shock}
            </text>
          )}
        </g>
      );
    },
    [draggingTenor, handleDotMouseDown, shocks]
  );

  // ── Custom tooltip ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const customTooltip = useCallback(({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const row = payload[0].payload as ChartRow;
    const shock = Math.round((row.torsioned - row.base) * 100);
    return (
      <div className="rounded-md border border-border bg-card px-3 py-2 shadow-md text-xs">
        <div className="font-medium text-foreground mb-1">{row.tenor}</div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: BASE_COLOR }} />
          <span className="text-muted-foreground">Base:</span>
          <span className="font-mono">{row.base.toFixed(3)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: TORSION_COLOR }} />
          <span className="text-muted-foreground">Torsion:</span>
          <span className="font-mono">{row.torsioned.toFixed(3)}%</span>
        </div>
        {shock !== 0 && (
          <div className="mt-1 font-medium text-foreground">
            Shock: {shock > 0 ? '+' : ''}{shock} bp
          </div>
        )}
      </div>
    );
  }, []);

  // ── Handlers ────────────────────────────────────────────────────────
  const handleShockInputChange = useCallback((tenor: string, value: string) => {
    const parsed = parseInt(value, 10);
    setShocks((prev) => ({
      ...prev,
      [tenor]: Number.isNaN(parsed) ? 0 : parsed,
    }));
  }, []);

  const handleReset = useCallback(() => {
    setShocks({});
  }, []);

  const handleCreate = useCallback(() => {
    const nonZero: Record<string, number> = {};
    for (const [tenor, bps] of Object.entries(shocks)) {
      if (bps !== 0) nonZero[tenor] = bps;
    }
    const name = scenarioName.trim() || 'Curve Torsion';
    onCreateScenario(name, nonZero);
  }, [shocks, scenarioName, onCreateScenario]);

  const hasAnyShock = Object.values(shocks).some((v) => v !== 0);

  const maturityLabel = maxMaturity < 1
    ? `${Math.round(maxMaturity * 12)}M`
    : `${Math.round(maxMaturity)}Y`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-primary" />
            {editMode ? 'Edit Curve Torsion' : 'Curve Torsion Editor'}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {baseCurveLabel}
            </span>
          </DialogTitle>
        </DialogHeader>

        {basePoints.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
            No curve points available. Upload a curves file first.
          </div>
        ) : (
          <div className="flex-1 flex flex-col gap-3 min-h-0">
            {/* Chart */}
            <div
              ref={chartContainerRef}
              className="h-72 w-full select-none"
              style={{ cursor: draggingTenor ? 'grabbing' : undefined }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={CHART_MARGIN}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    type="number"
                    dataKey="t_years"
                    domain={[0, maxMaturity]}
                    allowDataOverflow
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    stroke="hsl(var(--border))"
                    tickFormatter={(v: number) => {
                      const row = chartData.find((r) => Math.abs(r.t_years - v) < 0.01);
                      return row?.tenor ?? `${v}Y`;
                    }}
                    ticks={chartData.map((r) => r.t_years)}
                  />
                  <YAxis
                    domain={yDomain}
                    tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    stroke="hsl(var(--border))"
                    tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                  />
                  <Tooltip content={customTooltip} />

                  {/* Base curve (solid, no dots) */}
                  <Line
                    type="monotone"
                    dataKey="base"
                    stroke={BASE_COLOR}
                    strokeWidth={2}
                    dot={false}
                    name="Base"
                    connectNulls
                  />

                  {/* Torsioned curve (dashed, draggable dots) */}
                  <Line
                    type="monotone"
                    dataKey="torsioned"
                    stroke={TORSION_COLOR}
                    strokeWidth={2}
                    strokeDasharray="5 3"
                    dot={renderDraggableDot}
                    activeDot={false}
                    name="Torsion"
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Maturity slider */}
            <div className="flex items-center gap-3 px-1">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                Max maturity: {maturityLabel}
              </span>
              <Slider
                value={[maxMaturity]}
                min={Math.min(MIN_MATURITY, maxAvailableMaturity)}
                max={maxAvailableMaturity}
                step={0.5}
                onValueChange={(values) => {
                  const v = values[0] ?? maxAvailableMaturity;
                  setMaxMaturity(Math.max(MIN_MATURITY, Math.min(maxAvailableMaturity, v)));
                }}
                className="flex-1"
              />
            </div>

            {/* Per-tenor shock strip */}
            <div className="space-y-1">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Per-Tenor Shocks (bp)
                </span>
                <span className="text-[9px] text-muted-foreground/70">
                  Drag dots or type values
                </span>
              </div>
              <div className="flex gap-px rounded-md overflow-hidden border border-border/40">
                {basePoints.map((point) => {
                  const shock = shocks[point.tenor] ?? 0;
                  const isModified = shock !== 0;
                  return (
                    <div
                      key={point.tenor}
                      className="flex-1 min-w-0 flex flex-col items-center bg-card"
                    >
                      <span className="w-full text-center py-0.5 text-[8px] font-medium text-muted-foreground bg-muted/40 select-none">
                        {point.tenor}
                      </span>
                      <input
                        type="number"
                        value={shock}
                        onChange={(e) => handleShockInputChange(point.tenor, e.target.value)}
                        className={`w-full text-center text-[10px] font-mono bg-transparent outline-none border-none py-1 px-0 appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield] ${
                          isModified
                            ? 'text-foreground font-semibold'
                            : 'text-muted-foreground/40'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scenario name + action buttons */}
            <div className="flex items-center gap-3 pt-1 border-t border-border/30">
              <div className="flex-1 flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">Name:</span>
                <Input
                  placeholder="Curve Torsion"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  className="h-7 text-xs flex-1"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                disabled={!hasAnyShock}
                className="h-7 text-xs"
              >
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Reset
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!hasAnyShock}
                className="h-7 text-xs"
              >
                <Check className="h-3 w-3 mr-1.5" />
                {editMode ? 'Update Scenario' : 'Create Scenario'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
