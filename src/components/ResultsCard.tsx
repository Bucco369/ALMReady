import React from 'react';
import { BarChart3, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';
import type { CalculationResults } from '@/types/financial';

interface ResultsCardProps {
  results: CalculationResults | null;
  isCalculating: boolean;
}

export function ResultsCard({ results, isCalculating }: ResultsCardProps) {
  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  const formatDelta = (num: number) => {
    const formatted = formatCurrency(Math.abs(num));
    return num >= 0 ? `+${formatted}` : `-${formatted.replace('$', '')}`;
  };

  if (isCalculating) {
    return (
      <div className="quadrant-card animate-fade-in h-full flex flex-col">
        <div className="quadrant-header">
          <div className="quadrant-title">
            <BarChart3 className="h-5 w-5 text-primary" />
            Results
          </div>
        </div>
        <div className="quadrant-content flex-1 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">Calculating...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="quadrant-card animate-fade-in h-full flex flex-col">
        <div className="quadrant-header">
          <div className="quadrant-title">
            <BarChart3 className="h-5 w-5 text-primary" />
            Results
          </div>
        </div>
        <div className="quadrant-content flex-1 flex flex-col items-center justify-center">
          <BarChart3 className="empty-state-icon" />
          <p className="empty-state-text">
            Upload data and click Calculate to see results
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="quadrant-card animate-fade-in h-full flex flex-col">
      <div className="quadrant-header">
        <div className="quadrant-title">
          <BarChart3 className="h-5 w-5 text-primary" />
          Results
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(results.calculatedAt).toLocaleTimeString()}
        </span>
      </div>

      <div className="quadrant-content flex-1 overflow-auto">
        {/* Summary Section */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Base EVE
            </div>
            <div className="text-lg font-bold text-foreground">
              {formatCurrency(results.baseEve)}
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Base NII
            </div>
            <div className="text-lg font-bold text-foreground">
              {formatCurrency(results.baseNii)}
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              Worst EVE
            </div>
            <div className="text-lg font-bold text-foreground">
              {formatCurrency(results.worstCaseEve)}
            </div>
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />
              {results.worstCaseScenario}
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
              ΔEVE (Worst)
            </div>
            <div
              className={`flex items-center gap-1.5 text-lg font-bold ${
                results.worstCaseDeltaEve >= 0 ? 'value-positive' : 'value-negative'
              }`}
            >
              {results.worstCaseDeltaEve >= 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              {formatDelta(results.worstCaseDeltaEve)}
            </div>
          </div>
        </div>

        {/* Scenario Results Table */}
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th className="text-right">EVE</th>
                <th className="text-right">ΔEVE</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-muted/30">
                <td className="font-medium">Base Case</td>
                <td className="text-right font-mono text-sm">{formatCurrency(results.baseEve)}</td>
                <td className="text-right text-muted-foreground">—</td>
              </tr>
              {results.scenarioResults.map((result) => (
                <tr key={result.scenarioId}>
                  <td className="font-medium text-sm">{result.scenarioName}</td>
                  <td className="text-right font-mono text-sm">{formatCurrency(result.eve)}</td>
                  <td
                    className={`text-right font-mono text-sm ${
                      result.deltaEve >= 0 ? 'value-positive' : 'value-negative'
                    }`}
                  >
                    {formatDelta(result.deltaEve)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}