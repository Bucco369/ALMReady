import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Upload,
  FileSpreadsheet,
  RefreshCw,
  CheckCircle2,
  XCircle,
  FlaskConical,
  CalendarIcon,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Position } from "@/types/financial";
import {
  getBalanceSummary,
  uploadBalanceExcel,
  type BalanceSummaryResponse,
} from "@/lib/api";
import { useWhatIf } from "@/components/whatif/WhatIfContext";
import { WhatIfBuilder } from "@/components/whatif/WhatIfBuilder";
import { format } from "date-fns";
import { mapBalanceSummaryToUiRows, type BalanceUiRow } from "@/lib/balanceUi";

interface BalancePositionsCardProps {
  sessionId: string;
  positions: Position[];
  onPositionsChange: (positions: Position[]) => void;
}

function formatAmountShort(num: number) {
  const abs = Math.abs(num);
  if (abs >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(num / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${(num / 1e3).toFixed(0)}K`;
  return `${num.toFixed(0)}`;
}

function formatOptionalAmount(num: number) {
  if (Number.isNaN(num)) return "—";
  return formatAmountShort(num);
}

function formatOptionalPercent(rate: number | null) {
  if (rate === null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(2)}%`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function BalancePositionsCard({ sessionId, onPositionsChange }: BalancePositionsCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [summary, setSummary] = useState<BalanceSummaryResponse | null>(null);
  const [showWhatIfBuilder, setShowWhatIfBuilder] = useState(false);

  const { analysisDate, setAnalysisDate, cet1Capital, setCet1Capital, modifications, isApplied } = useWhatIf();

  useEffect(() => {
    let alive = true;

    async function load() {
      setErr(null);
      try {
        const s = await getBalanceSummary(sessionId);
        if (!alive) return;
        setSummary(s);
      } catch (e: unknown) {
        if (!alive) return;
        const msg = getErrorMessage(e);
        if (!msg.includes("No balance uploaded")) setErr(msg);
        setSummary(null);
      }
    }

    if (sessionId) void load();
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const isLoaded = summary !== null;

  const handleFileUpload = useCallback(
    async (file: File) => {
      setErr(null);
      setUploading(true);
      try {
        onPositionsChange([]);
        const s = await uploadBalanceExcel(sessionId, file);
        setSummary(s);
      } catch (e: unknown) {
        setErr(getErrorMessage(e));
      } finally {
        setUploading(false);
      }
    },
    [sessionId, onPositionsChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".xlsx") && !file.name.toLowerCase().endsWith(".xls")) {
        setErr("Only .xlsx/.xls files are supported");
        return;
      }
      void handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const refreshSummary = useCallback(async () => {
    setErr(null);
    try {
      const s = await getBalanceSummary(sessionId);
      setSummary(s);
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      if (!msg.includes("No balance uploaded")) setErr(msg);
      setSummary(null);
    }
  }, [sessionId]);

  const whatIfCount = useMemo(() => modifications.length, [modifications]);
  const balanceRows = useMemo(() => (summary ? mapBalanceSummaryToUiRows(summary) : []), [summary]);

  return (
    <>
    <div className="dashboard-card">
      <div className="dashboard-card-header">
        <div className="flex items-center gap-1.5">
          <FileSpreadsheet className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">Balance Positions</span>
        </div>

        <div className="flex items-center gap-2">
          <StatusIndicator loaded={isLoaded} />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2"
            title="Refresh from backend"
            onClick={refreshSummary}
          >
            <RefreshCw className={cn("h-3 w-3", uploading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="dashboard-card-content">
        {!isLoaded ? (
          <div
            className={cn("compact-upload-zone", isDragging && "active")}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <Upload className="h-5 w-5 text-muted-foreground mb-1" />
            <p className="text-xs text-muted-foreground mb-2">Drop Excel (.xlsx) or click to upload</p>

            <label>
              <Input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleInputChange}
                disabled={uploading}
              />
              <Button variant="outline" size="sm" asChild className="h-6 text-xs px-2">
                <span>{uploading ? "Uploading..." : "Browse"}</span>
              </Button>
            </label>

            {err && <div className="mt-2 text-[11px] text-destructive whitespace-pre-wrap">{err}</div>}
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            {err && <div className="mb-2 text-[11px] text-destructive whitespace-pre-wrap">{err}</div>}

            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium text-muted-foreground">Analysis Date</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "h-6 px-2 flex items-center gap-1 rounded border text-[11px] transition-colors",
                          "bg-background border-border hover:bg-muted/50",
                          !analysisDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="h-2.5 w-2.5" />
                        <span className={analysisDate ? "font-medium text-foreground" : ""}>
                          {analysisDate ? format(analysisDate, "dd MMM yy") : "Select"}
                        </span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={analysisDate ?? undefined}
                        onSelect={(date) => setAnalysisDate(date ?? null)}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <CompactCET1Input value={cet1Capital} onChange={setCet1Capital} />
              </div>

              <Button size="sm" className="h-6 text-xs px-2 relative" onClick={() => setShowWhatIfBuilder(true)}>
                <FlaskConical className="mr-1 h-3 w-3" />
                What-If
                {whatIfCount > 0 && (
                  <span
                    className={cn(
                      "absolute -top-1 -right-1 h-3.5 min-w-[14px] rounded-full text-[9px] font-bold flex items-center justify-center px-1",
                      isApplied ? "bg-success text-success-foreground" : "bg-warning text-warning-foreground"
                    )}
                  >
                    {whatIfCount}
                  </span>
                )}
              </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-border/50">
              <div className="h-full overflow-auto balance-scroll-container">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left font-medium py-1.5 pl-2 bg-muted/50">Category</th>
                      <th className="text-right font-medium py-1.5 bg-muted/50">Amount</th>
                      <th className="text-right font-medium py-1.5 bg-muted/50">Pos.</th>
                      <th className="text-right font-medium py-1.5 pr-2 bg-muted/50">Avg Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balanceRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-3 text-center text-muted-foreground">
                          No sheets parsed.
                        </td>
                      </tr>
                    ) : (
                      balanceRows.map((row) => <SheetRow key={row.id} row={row} />)
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    <WhatIfBuilder
      sessionId={sessionId}
      open={showWhatIfBuilder}
      onOpenChange={setShowWhatIfBuilder}
      balanceRows={balanceRows}
      sampleRows={summary?.sample_rows ?? {}}
    />
    </>
  );
}

function StatusIndicator({ loaded }: { loaded: boolean }) {
  return loaded ? (
    <div className="flex items-center gap-1 text-success">
      <CheckCircle2 className="h-3 w-3" />
      <span className="text-[10px] font-medium">Loaded</span>
    </div>
  ) : (
    <div className="flex items-center gap-1 text-muted-foreground">
      <XCircle className="h-3 w-3" />
      <span className="text-[10px] font-medium">Not loaded</span>
    </div>
  );
}

function SheetRow({ row }: { row: BalanceUiRow }) {
  return (
    <tr className="border-b border-border/30 hover:bg-muted/20 transition-colors">
      <td className="py-1.5 pl-2 font-medium text-foreground">{row.label}</td>
      <td className="text-right py-1.5 pr-2 font-mono text-muted-foreground">
        {formatOptionalAmount(row.amount)}
      </td>
      <td className="text-right py-1.5 font-mono text-muted-foreground">{row.positions}</td>
      <td className="text-right py-1.5 pr-2 font-mono text-muted-foreground">
        {formatOptionalPercent(row.avgRate)}
      </td>
    </tr>
  );
}

function CompactCET1Input({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [isEditing, setIsEditing] = useState(value === null);
  const [inputValue, setInputValue] = useState(value?.toString() ?? "");

  useEffect(() => {
    if (value === null) {
      setInputValue("");
      setIsEditing(true);
      return;
    }
    setInputValue(value.toString());
  }, [value]);

  const formatCET1Display = (num: number) => {
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(0)}M`;
    return num.toLocaleString("en-US");
  };

  const confirmValue = () => {
    const parsed = Number(inputValue);
    if (Number.isNaN(parsed) || parsed <= 0) return;
    onChange(parsed);
    setIsEditing(false);
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium text-muted-foreground">CET1</span>
      {isEditing ? (
        <input
          type="text"
          inputMode="numeric"
          placeholder="Value"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value.replace(/[^0-9.]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmValue();
            if (e.key === "Escape" && value !== null) {
              setInputValue(value.toString());
              setIsEditing(false);
            }
          }}
          onBlur={() => {
            if (inputValue.trim() === "") return;
            confirmValue();
          }}
          className={cn(
            "h-6 px-2 w-20 rounded border text-[11px] font-mono",
            "bg-background border-border focus:outline-none focus:ring-1 focus:ring-primary",
            "placeholder:text-muted-foreground"
          )}
        />
      ) : (
        <button
          onClick={() => setIsEditing(true)}
          className={cn(
            "h-6 px-2 flex items-center gap-1 rounded border text-[11px] transition-colors group",
            "bg-muted/30 border-border/70 hover:bg-muted/50"
          )}
          title="Click to edit"
        >
          <span className="font-mono font-medium text-foreground">{formatCET1Display(value!)}</span>
          <Pencil className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      )}
    </div>
  );
}
