import React, { useCallback, useState } from 'react';
import { Upload, TrendingUp, Eye, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { YieldCurve } from '@/types/financial';
import { parseYieldCurveCSV, generateSampleYieldCurveCSV } from '@/lib/csvParser';

interface InterestRateCurvesCardProps {
  curves: YieldCurve[];
  selectedBaseCurve: string | null;
  selectedDiscountCurve: string | null;
  onCurvesChange: (curves: YieldCurve[]) => void;
  onBaseCurveSelect: (curveId: string) => void;
  onDiscountCurveSelect: (curveId: string) => void;
}

export function InterestRateCurvesCard({
  curves,
  selectedBaseCurve,
  selectedDiscountCurve,
  onCurvesChange,
  onBaseCurveSelect,
  onDiscountCurveSelect,
}: InterestRateCurvesCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleFileUpload = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const curveName = file.name.replace('.csv', '');
        const parsed = parseYieldCurveCSV(content, curveName);
        const newCurves = [...curves, parsed];
        onCurvesChange(newCurves);

        if (curves.length === 0) {
          onBaseCurveSelect(parsed.id);
          onDiscountCurveSelect(parsed.id);
        }
      };
      reader.readAsText(file);
    },
    [curves, onCurvesChange, onBaseCurveSelect, onDiscountCurveSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) {
        handleFileUpload(file);
      }
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
      if (file) {
        handleFileUpload(file);
      }
    },
    [handleFileUpload]
  );

  const handleDownloadSample = useCallback(() => {
    const content = generateSampleYieldCurveCSV();
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_yield_curve.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleClear = useCallback(() => {
    onCurvesChange([]);
  }, [onCurvesChange]);

  const selectedCurve = curves.find((c) => c.id === selectedBaseCurve);
  const baseCurveName = curves.find(c => c.id === selectedBaseCurve)?.name;
  const discountCurveName = curves.find(c => c.id === selectedDiscountCurve)?.name;
  const tenorCount = selectedCurve?.points.length ?? 0;

  const formatPercent = (num: number) => (num * 100).toFixed(2) + '%';

  return (
    <>
      <div className="quadrant-card animate-fade-in h-full flex flex-col">
        <div className="quadrant-header">
          <div className="quadrant-title">
            <TrendingUp className="h-5 w-5 text-primary" />
            Interest Rate Curves
          </div>
        </div>

        <div className="quadrant-content flex-1 flex flex-col">
          {curves.length === 0 ? (
            <div
              className={`upload-zone flex-1 ${isDragging ? 'active' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Upload className="empty-state-icon" />
              <p className="mb-4 text-sm font-medium text-foreground">
                Upload yield curve
              </p>
              <div className="flex gap-2">
                <label>
                  <Input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleInputChange}
                  />
                  <Button variant="outline" size="sm" asChild>
                    <span>Browse Files</span>
                  </Button>
                </label>
                <Button variant="ghost" size="sm" onClick={handleDownloadSample}>
                  <Download className="mr-1 h-4 w-4" />
                  Sample
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col flex-1">
              <div className="space-y-1 mb-4">
                <div className="metric-row">
                  <span className="metric-label">Curves loaded</span>
                  <span className="metric-value">{curves.length}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Tenors</span>
                  <span className="metric-value">{tenorCount}</span>
                </div>
              </div>

              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Base Curve
                  </label>
                  <Select value={selectedBaseCurve || ''} onValueChange={onBaseCurveSelect}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select base curve" />
                    </SelectTrigger>
                    <SelectContent>
                      {curves.map((curve) => (
                        <SelectItem key={curve.id} value={curve.id}>
                          {curve.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Discount Curve
                  </label>
                  <Select value={selectedDiscountCurve || ''} onValueChange={onDiscountCurveSelect}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select discount curve" />
                    </SelectTrigger>
                    <SelectContent>
                      {curves.map((curve) => (
                        <SelectItem key={curve.id} value={curve.id}>
                          {curve.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex gap-2 mt-auto pt-4 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDetails(true)}
                  className="flex-1"
                >
                  <Eye className="mr-1.5 h-4 w-4" />
                  View curve
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Clear
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              {selectedCurve?.name || 'Yield Curve'}
            </DialogTitle>
          </DialogHeader>
          {selectedCurve && (
            <div className="overflow-auto max-h-[60vh]">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tenor</th>
                    <th className="text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCurve.points.map((point, index) => (
                    <tr key={index}>
                      <td className="font-mono">{point.tenor}</td>
                      <td className="text-right font-mono">
                        {formatPercent(point.rate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}