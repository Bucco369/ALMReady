import React, { useMemo, useState } from 'react';
import { Plus, ChevronRight, TrendingUp, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWhatIf } from './WhatIfContext';
import type { BalanceUiRow } from '@/lib/balanceUi';

type SampleRow = Record<string, unknown>;

interface WhatIfAddTabProps {
  balanceRows: BalanceUiRow[];
  sampleRows: Record<string, SampleRow[]>;
}

export function WhatIfAddTab({ balanceRows, sampleRows }: WhatIfAddTabProps) {
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const { addModification } = useWhatIf();

  const selectedRow = useMemo(
    () => balanceRows.find((row) => row.id === selectedRowId) ?? null,
    [balanceRows, selectedRowId]
  );

  const sampleForSelectedRow = useMemo(() => {
    if (!selectedRow) return null;
    const first = sampleRows[selectedRow.sheetName]?.[0];
    return first ?? null;
  }, [sampleRows, selectedRow]);

  const assetRows = useMemo(() => balanceRows.filter((row) => row.category === 'asset'), [balanceRows]);
  const liabilityRows = useMemo(() => balanceRows.filter((row) => row.category === 'liability'), [balanceRows]);

  const handleFieldChange = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddToModifications = () => {
    if (!selectedRow) return;

    const notional =
      parseNumber(formValues['saldo_ini']) ??
      parseNumber(formValues['book_value']) ??
      selectedRow.amount;

    const rawRate = parseNumber(formValues['tae']);
    const rate = rawRate === null ? selectedRow.avgRate ?? 0 : rawRate > 1 ? rawRate / 100 : rawRate;

    const contractId = formValues['n_contrato']?.trim();
    const currency = formValues['currency']?.trim() || undefined;
    const label = contractId || `New ${selectedRow.label}`;

    addModification({
      type: 'add',
      label,
      details: `${selectedRow.label} - ${formatAmount(notional)}`,
      notional,
      currency,
      category: selectedRow.category,
      subcategory: selectedRow.id,
      rate,
    });

    setFormValues({});
  };

  if (!selectedRow) {
    return (
      <ScrollArea className="flex-1">
        <div className="space-y-4 pr-3">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp className="h-3 w-3 text-success" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Asset categories</span>
            </div>
            <div className="space-y-1">
              {assetRows.map((row) => (
                <CategoryButton key={row.id} row={row} onSelect={() => setSelectedRowId(row.id)} />
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Landmark className="h-3 w-3 text-destructive" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Liability categories
              </span>
            </div>
            <div className="space-y-1">
              {liabilityRows.map((row) => (
                <CategoryButton key={row.id} row={row} onSelect={() => setSelectedRowId(row.id)} />
              ))}
            </div>
          </div>

          {assetRows.length === 0 && liabilityRows.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic">Upload a balance to enable add templates from sheets.</p>
          )}
        </div>
      </ScrollArea>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 pb-3 border-b border-border mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSelectedRowId(null);
            setFormValues({});
          }}
          className="h-6 px-2 text-xs"
        >
          ← Back
        </Button>
        <span className="text-xs font-medium">{selectedRow.label}</span>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-3 pr-3">
          {selectedRow.columns.map((column) => {
            const key = column.toLowerCase();
            const inputType = inferInputType(column);
            const placeholder = getSamplePlaceholder(sampleForSelectedRow, column);

            return (
              <div key={column} className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">{column}</Label>
                <Input
                  type={inputType}
                  value={formValues[key] ?? ''}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  className="h-7 text-xs"
                  placeholder={placeholder}
                />
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <div className="pt-3 border-t border-border mt-3">
        <Button size="sm" className="w-full h-7 text-xs" onClick={handleAddToModifications}>
          <Plus className="h-3 w-3 mr-1" />
          Add to modifications
        </Button>
      </div>
    </div>
  );
}

function CategoryButton({ row, onSelect }: { row: BalanceUiRow; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-accent/50 hover:border-primary/30 transition-colors text-left group"
    >
      <span className="text-xs text-foreground">{row.label}</span>
      <ChevronRight className="h-3 w-3 text-muted-foreground group-hover:text-primary transition-colors" />
    </button>
  );
}

function inferInputType(column: string): 'text' | 'number' | 'date' {
  const c = column.toLowerCase();
  const numericColumns = new Set([
    'saldo_ini',
    'amortizacion',
    'spread',
    'tae',
    'book_value',
    'cuota_total',
    'cuota_int',
    'per_rep',
    'per_int',
    'per_pri',
  ]);

  if (c.startsWith('f_') || c.includes('date')) return 'date';
  if (numericColumns.has(c)) return 'number';
  return 'text';
}

function getSamplePlaceholder(sample: SampleRow | null, column: string): string {
  if (!sample) return '';
  const match = Object.keys(sample).find((key) => key.toLowerCase() === column.toLowerCase());
  if (!match) return '';
  const value = sample[match];
  if (value === null || value === undefined) return '';
  return String(value);
}

function parseNumber(value?: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

function formatAmount(num: number) {
  if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (Math.abs(num) >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}

