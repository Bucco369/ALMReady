import React, { useState, useCallback } from 'react';
import { BalancePositionsCard } from '@/components/BalancePositionsCard';
import { InterestRateCurvesCard } from '@/components/InterestRateCurvesCard';
import { ScenariosCard } from '@/components/ScenariosCard';
import { ResultsCard } from '@/components/ResultsCard';
import { runCalculation } from '@/lib/calculationEngine';
import type { Position, YieldCurve, Scenario, CalculationResults } from '@/types/financial';
import { DEFAULT_SCENARIOS, SAMPLE_POSITIONS, SAMPLE_YIELD_CURVE } from '@/types/financial';
import { Button } from '@/components/ui/button';
import { FileSpreadsheet, Calculator, TrendingUp } from 'lucide-react';

const Index = () => {
  // State management
  const [positions, setPositions] = useState<Position[]>([]);
  const [curves, setCurves] = useState<YieldCurve[]>([]);
  const [selectedBaseCurve, setSelectedBaseCurve] = useState<string | null>(null);
  const [selectedDiscountCurve, setSelectedDiscountCurve] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>(DEFAULT_SCENARIOS);
  const [results, setResults] = useState<CalculationResults | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // Check if calculation is possible
  const canCalculate = 
    positions.length > 0 && 
    curves.length > 0 && 
    selectedBaseCurve !== null &&
    selectedDiscountCurve !== null &&
    scenarios.some((s) => s.enabled);

  // Handle calculation
  const handleCalculate = useCallback(() => {
    if (!canCalculate) return;

    const baseCurve = curves.find((c) => c.id === selectedBaseCurve);
    const discountCurve = curves.find((c) => c.id === selectedDiscountCurve);

    if (!baseCurve || !discountCurve) return;

    setIsCalculating(true);
    
    // Simulate async calculation
    setTimeout(() => {
      const calculationResults = runCalculation(
        positions,
        baseCurve,
        discountCurve,
        scenarios
      );
      setResults(calculationResults);
      setIsCalculating(false);
    }, 500);
  }, [canCalculate, positions, curves, selectedBaseCurve, selectedDiscountCurve, scenarios]);

  // Load sample data
  const handleLoadSampleData = useCallback(() => {
    setPositions(SAMPLE_POSITIONS);
    setCurves([SAMPLE_YIELD_CURVE]);
    setSelectedBaseCurve(SAMPLE_YIELD_CURVE.id);
    setSelectedDiscountCurve(SAMPLE_YIELD_CURVE.id);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <TrendingUp className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">EVE/NII Calculator</h1>
              <p className="text-xs text-muted-foreground">
                Interest Rate Risk in the Banking Book
              </p>
            </div>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadSampleData}
            className="gap-2"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Load Sample Data
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-6">
        {/* 2x2 Quadrant Grid */}
        <div className="grid gap-5 lg:grid-cols-2 mb-6" style={{ minHeight: 'calc(100vh - 220px)' }}>
          {/* Top Left - Balance Positions */}
          <BalancePositionsCard
            positions={positions}
            onPositionsChange={setPositions}
          />

          {/* Top Right - Interest Rate Curves */}
          <InterestRateCurvesCard
            curves={curves}
            selectedBaseCurve={selectedBaseCurve}
            selectedDiscountCurve={selectedDiscountCurve}
            onCurvesChange={setCurves}
            onBaseCurveSelect={setSelectedBaseCurve}
            onDiscountCurveSelect={setSelectedDiscountCurve}
          />

          {/* Bottom Left - Scenarios */}
          <ScenariosCard
            scenarios={scenarios}
            onScenariosChange={setScenarios}
          />

          {/* Bottom Right - Results */}
          <ResultsCard
            results={results}
            isCalculating={isCalculating}
          />
        </div>

        {/* Calculate Button - Prominent */}
        <div className="flex justify-center">
          <Button
            size="lg"
            className="gap-2.5 px-8 shadow-lg transition-all hover:shadow-xl disabled:opacity-50"
            onClick={handleCalculate}
            disabled={!canCalculate || isCalculating}
          >
            {isCalculating ? (
              <>
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Calculating...
              </>
            ) : (
              <>
                <Calculator className="h-5 w-5" />
                Calculate EVE & NII (Indicative)
              </>
            )}
          </Button>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-4 mt-auto">
        <div className="container mx-auto px-6 text-center text-xs text-muted-foreground">
          EVE/NII Calculator • Illustrative IRRBB analysis prototype
        </div>
      </footer>
    </div>
  );
};

export default Index;