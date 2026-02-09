import React, { useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight, Minus, FileText, Folder, FolderOpen } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getBalanceContracts, type BalanceContract } from '@/lib/api';
import { useWhatIf } from './WhatIfContext';
import type { BalanceUiCategory, BalanceUiRow } from '@/lib/balanceUi';

interface WhatIfRemoveTabProps {
  sessionId: string;
  balanceRows: BalanceUiRow[];
}

interface ContractPreview {
  id: string;
  sheetLabel: string;
  subcategory: string;
  category: BalanceUiCategory;
  amount: number;
  rate: number | null;
}

export function WhatIfRemoveTab({ sessionId, balanceRows }: WhatIfRemoveTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['assets', 'liabilities']));
  const [searchResults, setSearchResults] = useState<BalanceContract[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const { addModification } = useWhatIf();

  const assets = useMemo(() => balanceRows.filter((row) => row.category === 'asset'), [balanceRows]);
  const liabilities = useMemo(() => balanceRows.filter((row) => row.category === 'liability'), [balanceRows]);

  useEffect(() => {
    let active = true;
    const q = searchQuery.trim();

    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return () => {
        active = false;
      };
    }

    setSearchLoading(true);
    setSearchError(null);

    const timer = window.setTimeout(async () => {
      try {
        const response = await getBalanceContracts(sessionId, { q, limit: 200 });
        if (!active) return;
        setSearchResults(response.contracts);
      } catch (error) {
        if (!active) return;
        setSearchResults([]);
        setSearchError(getErrorMessage(error));
      } finally {
        if (active) {
          setSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery, sessionId]);

  const contracts = useMemo(() => {
    return searchResults.map((contract) => ({
      id: contract.contract_id,
      sheetLabel: contract.sheet,
      subcategory: contract.subcategory,
      category: normalizeCategory(contract.category),
      amount: contract.amount ?? 0,
      rate: contract.rate,
    }));
  }, [searchResults]);

  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const handleRemoveCategoryRow = (row: BalanceUiRow) => {
    addModification({
      type: 'remove',
      label: row.label,
      details: formatAmount(row.amount),
      notional: row.amount,
      category: row.category,
      subcategory: row.id,
      rate: row.avgRate ?? 0,
    });
  };

  const handleRemoveContract = (contract: ContractPreview) => {
    addModification({
      type: 'remove',
      label: contract.id,
      details: `${contract.sheetLabel} - ${formatAmount(contract.amount)}`,
      notional: contract.amount,
      category: contract.category,
      subcategory: contract.subcategory,
      rate: contract.rate ?? 0,
    });
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by Contract ID (n_contrato...)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>

        {searchQuery.trim().length >= 2 && (
          <div className="rounded-md border border-border bg-card overflow-hidden">
            {searchLoading && (
              <div className="px-2.5 py-2 text-[11px] text-muted-foreground">Searching contracts...</div>
            )}

            {!searchLoading && searchError && (
              <div className="px-2.5 py-2 text-[11px] text-destructive whitespace-pre-wrap">{searchError}</div>
            )}

            {!searchLoading && !searchError && contracts.length === 0 && (
              <div className="px-2.5 py-2 text-[11px] text-muted-foreground">No contracts found.</div>
            )}

            {!searchLoading &&
              !searchError &&
              contracts.map((contract) => (
                <div
                  key={`${contract.sheetLabel}-${contract.id}`}
                  className="flex items-center justify-between px-2.5 py-1.5 border-b border-border/50 last:border-0 hover:bg-accent/30"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-xs font-mono text-foreground truncate">{contract.id}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground ml-4.5">
                      {contract.sheetLabel} • {formatAmount(contract.amount)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemoveContract(contract)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-border" />
        <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Or select from balance</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-1 pr-3">
          {assets.length > 0 && (
            <CategoryGroup
              id="assets"
              label="Assets"
              rows={assets}
              isExpanded={expandedNodes.has('assets')}
              onToggle={toggleNode}
              onRemove={handleRemoveCategoryRow}
            />
          )}

          {liabilities.length > 0 && (
            <CategoryGroup
              id="liabilities"
              label="Liabilities"
              rows={liabilities}
              isExpanded={expandedNodes.has('liabilities')}
              onToggle={toggleNode}
              onRemove={handleRemoveCategoryRow}
            />
          )}

          {assets.length === 0 && liabilities.length === 0 && (
            <p className="text-[11px] text-muted-foreground italic">Upload a balance to enable remove selection.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function CategoryGroup({
  id,
  label,
  rows,
  isExpanded,
  onToggle,
  onRemove,
}: {
  id: string;
  label: string;
  rows: BalanceUiRow[];
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onRemove: (row: BalanceUiRow) => void;
}) {
  const totalAmount = rows.reduce((acc, row) => acc + row.amount, 0);
  const totalPositions = rows.reduce((acc, row) => acc + row.positions, 0);
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;
  const FolderIcon = isExpanded ? FolderOpen : Folder;
  const labelClass = id === 'assets' ? 'text-success' : 'text-destructive';

  return (
    <div>
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-1 py-1.5 px-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
      >
        <ChevronIcon className="h-3 w-3 text-muted-foreground" />
        <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className={`text-xs font-semibold ${labelClass}`}>{label}</span>
        <span className="ml-auto text-[11px] font-mono text-muted-foreground">{formatAmount(totalAmount)}</span>
        <span className="text-[10px] text-muted-foreground/80 bg-muted px-1 rounded">{totalPositions}</span>
      </button>

      {isExpanded && (
        <div className="mt-1 space-y-0.5">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-1 py-1 px-2 pl-8 rounded-sm hover:bg-accent/40 group">
              <FileText className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-foreground flex-1">{row.label}</span>
              <span className="text-[11px] font-mono text-muted-foreground">{formatAmount(row.amount)}</span>
              <span className="text-[10px] text-muted-foreground/80 bg-muted px-1 rounded">{row.positions}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => onRemove(row)}
              >
                <Minus className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function normalizeCategory(category: string): BalanceUiCategory {
  return category.toLowerCase() === 'liability' ? 'liability' : 'asset';
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatAmount(num: number) {
  if (Math.abs(num) >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `$${(num / 1e6).toFixed(1)}M`;
  if (Math.abs(num) >= 1e3) return `$${(num / 1e3).toFixed(0)}K`;
  return `$${num.toFixed(0)}`;
}
