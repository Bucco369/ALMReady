import React, { useCallback, useState } from 'react';
import { Upload, FileSpreadsheet, Eye, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Position } from '@/types/financial';
import { parsePositionsCSV, generateSamplePositionsCSV } from '@/lib/csvParser';

interface BalancePositionsCardProps {
  positions: Position[];
  onPositionsChange: (positions: Position[]) => void;
}

export function BalancePositionsCard({ positions, onPositionsChange }: BalancePositionsCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const handleFileUpload = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const parsed = parsePositionsCSV(content);
        onPositionsChange(parsed);
        setFileName(file.name);
      };
      reader.readAsText(file);
    },
    [onPositionsChange]
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
    const content = generateSamplePositionsCSV();
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_positions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleReplace = useCallback(() => {
    onPositionsChange([]);
    setFileName(null);
  }, [onPositionsChange]);

  // Calculate summary metrics
  const assetCount = positions.filter(p => p.instrumentType === 'Asset').length;
  const liabilityCount = positions.filter(p => p.instrumentType === 'Liability').length;
  const totalNotional = positions.reduce((sum, p) => sum + Math.abs(p.notional), 0);

  const formatNotional = (num: number) => {
    if (num >= 1e9) return `${(num / 1e9).toFixed(1)}bn`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(1)}m`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(0)}k`;
    return num.toString();
  };

  const formatCurrency = (num: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(num);
  };

  const formatPercent = (num: number) => (num * 100).toFixed(2) + '%';

  return (
    <>
      <div className="quadrant-card animate-fade-in h-full flex flex-col">
        <div className="quadrant-header">
          <div className="quadrant-title">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Balance Positions
          </div>
          {positions.length > 0 && (
            <span className="text-xs text-muted-foreground">{fileName}</span>
          )}
        </div>

        <div className="quadrant-content flex-1 flex flex-col">
          {positions.length === 0 ? (
            <div
              className={`upload-zone flex-1 ${isDragging ? 'active' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <Upload className="empty-state-icon" />
              <p className="mb-4 text-sm font-medium text-foreground">
                Upload balance positions
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
                  <span className="metric-label">Positions loaded</span>
                  <span className="metric-value">{positions.length}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Assets / Liabilities</span>
                  <span className="metric-value">{assetCount} / {liabilityCount}</span>
                </div>
                <div className="metric-row">
                  <span className="metric-label">Total notional</span>
                  <span className="metric-value">{formatNotional(totalNotional)}</span>
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
                  View details
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleReplace}
                >
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  Replace
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Balance Positions Detail
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-auto flex-1">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th className="text-right">Notional</th>
                  <th>Maturity</th>
                  <th className="text-right">Rate</th>
                  <th>Reprice</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.id}>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          position.instrumentType === 'Asset'
                            ? 'bg-success/10 text-success'
                            : 'bg-destructive/10 text-destructive'
                        }`}
                      >
                        {position.instrumentType}
                      </span>
                    </td>
                    <td className="font-medium">{position.description}</td>
                    <td className="text-right font-mono">
                      {formatCurrency(position.notional)}
                    </td>
                    <td className="font-mono text-xs">{position.maturityDate}</td>
                    <td className="text-right font-mono">
                      {formatPercent(position.couponRate)}
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {position.repriceFrequency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}