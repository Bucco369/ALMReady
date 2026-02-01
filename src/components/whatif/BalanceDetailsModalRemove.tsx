import React, { useState, useMemo } from 'react';
import { FileSpreadsheet, X, Filter, ChevronLeft, Minus, Search, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useWhatIf } from './WhatIfContext';

interface BalanceDetailsModalRemoveProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCategory: string;
  searchQuery?: string;
}

// Mock contract-level data for removal selection
const MOCK_CONTRACTS = [
  // Assets - Mortgages
  { id: 'NUM_SEC_AC_MTG001', category: 'assets', subcategory: 'mortgages', group: 'Residential Fixed', currency: 'EUR', rateType: 'Fixed', counterparty: 'Retail', maturityBucket: '5-10Y', amount: 150_000_000, rate: 0.0345, maturity: 7.2 },
  { id: 'NUM_SEC_AC_MTG002', category: 'assets', subcategory: 'mortgages', group: 'Residential Fixed', currency: 'EUR', rateType: 'Fixed', counterparty: 'Retail', maturityBucket: '5-10Y', amount: 180_000_000, rate: 0.0355, maturity: 6.8 },
  { id: 'NUM_SEC_AC_MTG003', category: 'assets', subcategory: 'mortgages', group: 'Residential Fixed', currency: 'EUR', rateType: 'Fixed', counterparty: 'Retail', maturityBucket: '10-20Y', amount: 120_000_000, rate: 0.0365, maturity: 12.5 },
  { id: 'NUM_SEC_AC_MTG004', category: 'assets', subcategory: 'mortgages', group: 'Residential Variable', currency: 'EUR', rateType: 'Floating', counterparty: 'Retail', maturityBucket: '10-20Y', amount: 200_000_000, rate: 0.0285, maturity: 14.2 },
  { id: 'NUM_SEC_AC_MTG005', category: 'assets', subcategory: 'mortgages', group: 'Residential Variable', currency: 'EUR', rateType: 'Floating', counterparty: 'Retail', maturityBucket: '10-20Y', amount: 180_000_000, rate: 0.0295, maturity: 11.8 },
  { id: 'NUM_SEC_AC_MTG006', category: 'assets', subcategory: 'mortgages', group: 'Commercial', currency: 'EUR', rateType: 'Fixed', counterparty: 'Corporate', maturityBucket: '5-10Y', amount: 250_000_000, rate: 0.0420, maturity: 6.8 },
  { id: 'NUM_SEC_AC_MTG007', category: 'assets', subcategory: 'mortgages', group: 'Buy-to-Let', currency: 'GBP', rateType: 'Floating', counterparty: 'Retail', maturityBucket: '10-20Y', amount: 120_000_000, rate: 0.0395, maturity: 15.3 },
  
  // Assets - Loans
  { id: 'NUM_SEC_AC_LN001', category: 'assets', subcategory: 'loans', group: 'Corporate Term Loans', currency: 'EUR', rateType: 'Floating', counterparty: 'Corporate', maturityBucket: '1-5Y', amount: 90_000_000, rate: 0.0485, maturity: 3.2 },
  { id: 'NUM_SEC_AC_LN002', category: 'assets', subcategory: 'loans', group: 'Corporate Term Loans', currency: 'EUR', rateType: 'Floating', counterparty: 'Corporate', maturityBucket: '1-5Y', amount: 90_000_000, rate: 0.0495, maturity: 3.5 },
  { id: 'NUM_SEC_AC_LN003', category: 'assets', subcategory: 'loans', group: 'SME Facilities', currency: 'EUR', rateType: 'Fixed', counterparty: 'SME', maturityBucket: '1-5Y', amount: 120_000_000, rate: 0.0525, maturity: 2.8 },
  { id: 'NUM_SEC_AC_LN004', category: 'assets', subcategory: 'loans', group: 'Consumer Loans', currency: 'EUR', rateType: 'Fixed', counterparty: 'Retail', maturityBucket: '<1Y', amount: 100_000_000, rate: 0.0650, maturity: 0.8 },
  
  // Assets - Securities
  { id: 'NUM_SEC_AC_SEC001', category: 'assets', subcategory: 'securities', group: 'Government Bonds', currency: 'EUR', rateType: 'Fixed', counterparty: 'Sovereign', maturityBucket: '5-10Y', amount: 140_000_000, rate: 0.0285, maturity: 6.5 },
  { id: 'NUM_SEC_AC_SEC002', category: 'assets', subcategory: 'securities', group: 'Government Bonds', currency: 'EUR', rateType: 'Fixed', counterparty: 'Sovereign', maturityBucket: '5-10Y', amount: 140_000_000, rate: 0.0290, maturity: 7.0 },
  { id: 'NUM_SEC_AC_SEC003', category: 'assets', subcategory: 'securities', group: 'Corporate Bonds', currency: 'EUR', rateType: 'Fixed', counterparty: 'Corporate', maturityBucket: '1-5Y', amount: 170_000_000, rate: 0.0395, maturity: 3.8 },
  { id: 'NUM_SEC_AC_SEC004', category: 'assets', subcategory: 'securities', group: 'Covered Bonds', currency: 'USD', rateType: 'Fixed', counterparty: 'Financial', maturityBucket: '5-10Y', amount: 100_000_000, rate: 0.0420, maturity: 5.2 },
  
  // Assets - Interbank
  { id: 'NUM_SEC_AC_INT001', category: 'assets', subcategory: 'interbank', group: 'Central Bank Reserves', currency: 'EUR', rateType: 'Floating', counterparty: 'Central Bank', maturityBucket: '<1Y', amount: 150_000_000, rate: 0.0350, maturity: 0.1 },
  { id: 'NUM_SEC_AC_INT002', category: 'assets', subcategory: 'interbank', group: 'Interbank Placements', currency: 'EUR', rateType: 'Floating', counterparty: 'Financial', maturityBucket: '<1Y', amount: 50_000_000, rate: 0.0380, maturity: 0.3 },
  
  // Assets - Other
  { id: 'NUM_SEC_AC_OTH001', category: 'assets', subcategory: 'other-assets', group: 'Fixed Assets', currency: 'EUR', rateType: 'Fixed', counterparty: 'Other', maturityBucket: '>20Y', amount: 60_000_000, rate: 0.0000, maturity: 30.0 },
  { id: 'NUM_SEC_AC_OTH002', category: 'assets', subcategory: 'other-assets', group: 'Deferred Tax', currency: 'EUR', rateType: 'Fixed', counterparty: 'Other', maturityBucket: '5-10Y', amount: 40_000_000, rate: 0.0000, maturity: 8.0 },
  
  // Liabilities - Deposits
  { id: 'NUM_SEC_AC_DEP001', category: 'liabilities', subcategory: 'deposits', group: 'Retail Current Accounts', currency: 'EUR', rateType: 'Floating', counterparty: 'Retail', maturityBucket: '<1Y', amount: 160_000_000, rate: 0.0025, maturity: 0.5 },
  { id: 'NUM_SEC_AC_DEP002', category: 'liabilities', subcategory: 'deposits', group: 'Retail Current Accounts', currency: 'EUR', rateType: 'Floating', counterparty: 'Retail', maturityBucket: '<1Y', amount: 160_000_000, rate: 0.0028, maturity: 0.4 },
  { id: 'NUM_SEC_AC_DEP003', category: 'liabilities', subcategory: 'deposits', group: 'Corporate Current Accounts', currency: 'EUR', rateType: 'Floating', counterparty: 'Corporate', maturityBucket: '<1Y', amount: 240_000_000, rate: 0.0080, maturity: 0.3 },
  { id: 'NUM_SEC_AC_DEP004', category: 'liabilities', subcategory: 'deposits', group: 'Savings Accounts', currency: 'EUR', rateType: 'Floating', counterparty: 'Retail', maturityBucket: '<1Y', amount: 120_000_000, rate: 0.0150, maturity: 0.8 },
  
  // Liabilities - Term deposits
  { id: 'NUM_SEC_AC_TD001', category: 'liabilities', subcategory: 'term-deposits', group: 'Retail Term 1Y', currency: 'EUR', rateType: 'Fixed', counterparty: 'Retail', maturityBucket: '<1Y', amount: 190_000_000, rate: 0.0280, maturity: 0.7 },
  { id: 'NUM_SEC_AC_TD002', category: 'liabilities', subcategory: 'term-deposits', group: 'Retail Term 1Y', currency: 'EUR', rateType: 'Fixed', counterparty: 'Retail', maturityBucket: '<1Y', amount: 190_000_000, rate: 0.0285, maturity: 0.6 },
  { id: 'NUM_SEC_AC_TD003', category: 'liabilities', subcategory: 'term-deposits', group: 'Retail Term 2-3Y', currency: 'EUR', rateType: 'Fixed', counterparty: 'Retail', maturityBucket: '1-5Y', amount: 320_000_000, rate: 0.0350, maturity: 2.1 },
  { id: 'NUM_SEC_AC_TD004', category: 'liabilities', subcategory: 'term-deposits', group: 'Corporate Term', currency: 'EUR', rateType: 'Fixed', counterparty: 'Corporate', maturityBucket: '1-5Y', amount: 220_000_000, rate: 0.0380, maturity: 1.8 },
  
  // Liabilities - Wholesale funding
  { id: 'NUM_SEC_AC_WHL001', category: 'liabilities', subcategory: 'wholesale-funding', group: 'Senior Unsecured', currency: 'EUR', rateType: 'Fixed', counterparty: 'Financial', maturityBucket: '1-5Y', amount: 280_000_000, rate: 0.0420, maturity: 2.5 },
  { id: 'NUM_SEC_AC_WHL002', category: 'liabilities', subcategory: 'wholesale-funding', group: 'Repo Funding', currency: 'EUR', rateType: 'Floating', counterparty: 'Financial', maturityBucket: '<1Y', amount: 200_000_000, rate: 0.0380, maturity: 0.2 },
  
  // Liabilities - Debt issued
  { id: 'NUM_SEC_AC_DBT001', category: 'liabilities', subcategory: 'debt-issued', group: 'Covered Bonds Issued', currency: 'EUR', rateType: 'Fixed', counterparty: 'Financial', maturityBucket: '5-10Y', amount: 100_000_000, rate: 0.0450, maturity: 6.2 },
  { id: 'NUM_SEC_AC_DBT002', category: 'liabilities', subcategory: 'debt-issued', group: 'Subordinated Debt', currency: 'EUR', rateType: 'Fixed', counterparty: 'Financial', maturityBucket: '5-10Y', amount: 50_000_000, rate: 0.0580, maturity: 7.5 },
  
  // Liabilities - Other
  { id: 'NUM_SEC_AC_OTL001', category: 'liabilities', subcategory: 'other-liabilities', group: 'Provisions', currency: 'EUR', rateType: 'Fixed', counterparty: 'Other', maturityBucket: '1-5Y', amount: 50_000_000, rate: 0.0000, maturity: 3.0 },
];

// Filter options
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF'];
const RATE_TYPES = ['Fixed', 'Floating'];
const COUNTERPARTIES = ['Retail', 'Corporate', 'SME', 'Financial', 'Sovereign', 'Central Bank', 'Other'];
const MATURITY_BUCKETS = ['<1Y', '1-5Y', '5-10Y', '10-20Y', '>20Y'];

interface Filters {
  currencies: string[];
  rateTypes: string[];
  counterparties: string[];
  maturityBuckets: string[];
}

export function BalanceDetailsModalRemove({ open, onOpenChange, selectedCategory, searchQuery: externalSearchQuery }: BalanceDetailsModalRemoveProps) {
  const { addModification } = useWhatIf();
  const [filters, setFilters] = useState<Filters>({
    currencies: [],
    rateTypes: [],
    counterparties: [],
    maturityBuckets: [],
  });
  const [drillDownGroup, setDrillDownGroup] = useState<string | null>(null);
  const [showContracts, setShowContracts] = useState(false);
  const [selectedContracts, setSelectedContracts] = useState<Set<string>>(new Set());
  const [localSearchQuery, setLocalSearchQuery] = useState(externalSearchQuery || '');

  // Combine external and local search
  const effectiveSearchQuery = localSearchQuery;

  // Determine context from selected category
  const getContextLabel = () => {
    const labels: Record<string, string> = {
      'assets': 'Assets',
      'liabilities': 'Liabilities',
      'mortgages': 'Assets → Mortgages',
      'loans': 'Assets → Loans',
      'securities': 'Assets → Securities',
      'interbank': 'Assets → Interbank / Central Bank',
      'other-assets': 'Assets → Other assets',
      'deposits': 'Liabilities → Deposits',
      'term-deposits': 'Liabilities → Term deposits',
      'wholesale-funding': 'Liabilities → Wholesale funding',
      'debt-issued': 'Liabilities → Debt issued',
      'other-liabilities': 'Liabilities → Other liabilities',
    };
    return labels[selectedCategory] || 'Balance';
  };

  // Filter contracts based on context, filters, and search
  const filteredContracts = useMemo(() => {
    let contracts = [...MOCK_CONTRACTS];

    // Filter by selected category context
    contracts = contracts.filter(c => c.subcategory === selectedCategory);

    // Apply user filters
    if (filters.currencies.length > 0) {
      contracts = contracts.filter(c => filters.currencies.includes(c.currency));
    }
    if (filters.rateTypes.length > 0) {
      contracts = contracts.filter(c => filters.rateTypes.includes(c.rateType));
    }
    if (filters.counterparties.length > 0) {
      contracts = contracts.filter(c => filters.counterparties.includes(c.counterparty));
    }
    if (filters.maturityBuckets.length > 0) {
      contracts = contracts.filter(c => filters.maturityBuckets.includes(c.maturityBucket));
    }

    // Apply search
    if (effectiveSearchQuery.length >= 2) {
      contracts = contracts.filter(c => 
        c.id.toLowerCase().includes(effectiveSearchQuery.toLowerCase()) ||
        c.group.toLowerCase().includes(effectiveSearchQuery.toLowerCase())
      );
    }

    return contracts;
  }, [selectedCategory, filters, effectiveSearchQuery]);

  // Aggregate contracts by group
  const aggregatedData = useMemo(() => {
    if (drillDownGroup) {
      // When drilled down, show contracts
      return null;
    }

    const grouped = filteredContracts.reduce((acc, contract) => {
      const key = contract.group;
      if (!acc[key]) {
        acc[key] = { 
          group: key, 
          amount: 0, 
          count: 0, 
          rateSum: 0, 
          maturitySum: 0,
          contracts: [] 
        };
      }
      acc[key].amount += contract.amount;
      acc[key].count += 1;
      acc[key].rateSum += contract.rate * contract.amount;
      acc[key].maturitySum += contract.maturity * contract.amount;
      acc[key].contracts.push(contract);
      return acc;
    }, {} as Record<string, { group: string; amount: number; count: number; rateSum: number; maturitySum: number; contracts: typeof MOCK_CONTRACTS }>);

    return Object.values(grouped).map(g => ({
      group: g.group,
      amount: g.amount,
      count: g.count,
      avgRate: g.amount > 0 ? g.rateSum / g.amount : 0,
      avgMaturity: g.amount > 0 ? g.maturitySum / g.amount : 0,
      contracts: g.contracts,
    })).sort((a, b) => b.amount - a.amount);
  }, [filteredContracts, drillDownGroup]);

  // Contracts for current drill-down
  const drillDownContracts = useMemo(() => {
    if (!drillDownGroup) return [];
    return filteredContracts.filter(c => c.group === drillDownGroup);
  }, [filteredContracts, drillDownGroup]);

  const activeFilterCount = 
    filters.currencies.length + 
    filters.rateTypes.length + 
    filters.counterparties.length + 
    filters.maturityBuckets.length;

  const clearFilters = () => {
    setFilters({ currencies: [], rateTypes: [], counterparties: [], maturityBuckets: [] });
    setDrillDownGroup(null);
    setShowContracts(false);
  };

  const toggleFilter = (category: keyof Filters, value: string) => {
    setFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value],
    }));
  };

  const toggleContractSelection = (contractId: string) => {
    setSelectedContracts(prev => {
      const next = new Set(prev);
      if (next.has(contractId)) {
        next.delete(contractId);
      } else {
        next.add(contractId);
      }
      return next;
    });
  };

  const handleAddSelectedToRemoval = () => {
    const contractsToRemove = filteredContracts.filter(c => selectedContracts.has(c.id));
    
    contractsToRemove.forEach(contract => {
      addModification({
        type: 'remove',
        label: contract.id,
        details: `${contract.group} - ${formatAmount(contract.amount)}`,
        notional: contract.amount,
        category: contract.category === 'assets' ? 'asset' : 'liability',
        subcategory: contract.subcategory,
        rate: contract.rate,
      });
    });

    setSelectedContracts(new Set());
    onOpenChange(false);
  };

  const formatAmount = (num: number) => {
    if (num >= 1e9) return `€${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `€${(num / 1e6).toFixed(1)}M`;
    if (num >= 1e3) return `€${(num / 1e3).toFixed(0)}K`;
    return `€${num}`;
  };

  const formatPercent = (num: number) => (num * 100).toFixed(2) + '%';

  const handleDrillDown = (group: string) => {
    setDrillDownGroup(group);
    setShowContracts(true);
  };

  const handleBack = () => {
    if (showContracts) {
      setShowContracts(false);
      setDrillDownGroup(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader className="pb-2 border-b border-border">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4 text-primary" />
              Select Contracts for Removal — {getContextLabel()}
            </DialogTitle>
            {selectedContracts.size > 0 && (
              <Button
                size="sm"
                onClick={handleAddSelectedToRemoval}
                className="h-7 text-xs"
              >
                <Minus className="mr-1.5 h-3 w-3" />
                Add {selectedContracts.size} to Pending Removals
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Search & Filter Bar */}
        <div className="flex items-center gap-2 py-3 border-b border-border/50 flex-wrap">
          {/* Back button when showing contracts */}
          {showContracts && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="h-6 text-xs px-2"
            >
              <ChevronLeft className="h-3 w-3 mr-1" />
              Back to groups
            </Button>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Search by Contract ID..."
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
              className="h-6 w-48 pl-7 text-xs"
            />
          </div>

          <div className="h-4 w-px bg-border" />

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <span>Filters:</span>
          </div>

          {/* Currency Filter */}
          <FilterDropdown
            label="Currency"
            options={CURRENCIES}
            selected={filters.currencies}
            onToggle={(v) => toggleFilter('currencies', v)}
          />

          {/* Rate Type Filter */}
          <FilterDropdown
            label="Rate Type"
            options={RATE_TYPES}
            selected={filters.rateTypes}
            onToggle={(v) => toggleFilter('rateTypes', v)}
          />

          {/* Counterparty Filter */}
          <FilterDropdown
            label="Counterparty"
            options={COUNTERPARTIES}
            selected={filters.counterparties}
            onToggle={(v) => toggleFilter('counterparties', v)}
          />

          {/* Maturity Filter */}
          <FilterDropdown
            label="Maturity"
            options={MATURITY_BUCKETS}
            selected={filters.maturityBuckets}
            onToggle={(v) => toggleFilter('maturityBuckets', v)}
          />

          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3 mr-1" />
              Clear all
            </Button>
          )}
        </div>

        {/* Active Filters Display */}
        {activeFilterCount > 0 && (
          <div className="flex items-center gap-1.5 py-2 flex-wrap">
            {filters.currencies.map(c => (
              <Badge key={c} variant="outline" className="text-[10px] h-5">
                {c}
                <button onClick={() => toggleFilter('currencies', c)} className="ml-1">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            {filters.rateTypes.map(r => (
              <Badge key={r} variant="outline" className="text-[10px] h-5">
                {r}
                <button onClick={() => toggleFilter('rateTypes', r)} className="ml-1">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            {filters.counterparties.map(c => (
              <Badge key={c} variant="outline" className="text-[10px] h-5">
                {c}
                <button onClick={() => toggleFilter('counterparties', c)} className="ml-1">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
            {filters.maturityBuckets.map(m => (
              <Badge key={m} variant="outline" className="text-[10px] h-5">
                {m}
                <button onClick={() => toggleFilter('maturityBuckets', m)} className="ml-1">
                  <X className="h-2.5 w-2.5" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* Content Area */}
        <ScrollArea className="flex-1 min-h-0">
          {!showContracts && aggregatedData ? (
            // Aggregated View
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left font-medium py-2.5 pl-3 bg-muted/50">Group</th>
                  <th className="text-right font-medium py-2.5 bg-muted/50">Amount</th>
                  <th className="text-right font-medium py-2.5 bg-muted/50">Contracts</th>
                  <th className="text-right font-medium py-2.5 bg-muted/50">Avg Rate</th>
                  <th className="text-right font-medium py-2.5 pr-3 bg-muted/50">Avg Maturity</th>
                </tr>
              </thead>
              <tbody>
                {aggregatedData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">
                      No positions match the current filters
                    </td>
                  </tr>
                ) : (
                  aggregatedData.map((row) => (
                    <tr 
                      key={row.group}
                      className="border-b border-border/50 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => handleDrillDown(row.group)}
                    >
                      <td className="py-2.5 pl-3">
                        <span className="text-foreground underline decoration-dotted underline-offset-2">
                          {row.group}
                        </span>
                      </td>
                      <td className="text-right py-2.5 font-mono text-foreground">
                        {formatAmount(row.amount)}
                      </td>
                      <td className="text-right py-2.5 font-mono text-muted-foreground">
                        {row.count}
                      </td>
                      <td className="text-right py-2.5 font-mono text-muted-foreground">
                        {formatPercent(row.avgRate)}
                      </td>
                      <td className="text-right py-2.5 pr-3 font-mono text-muted-foreground">
                        {row.avgMaturity.toFixed(1)}Y
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            // Contract-level View
            <div className="space-y-1 p-2">
              {drillDownGroup && (
                <div className="text-xs font-medium text-muted-foreground mb-2 px-1">
                  Contracts in: {drillDownGroup}
                </div>
              )}
              
              {drillDownContracts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No contracts found
                </div>
              ) : (
                drillDownContracts.map(contract => (
                  <div
                    key={contract.id}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-md border transition-colors",
                      selectedContracts.has(contract.id)
                        ? "border-primary/50 bg-primary/5"
                        : "border-border/50 hover:bg-muted/30"
                    )}
                  >
                    <Checkbox
                      checked={selectedContracts.has(contract.id)}
                      onCheckedChange={() => toggleContractSelection(contract.id)}
                      className="h-4 w-4"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-medium text-foreground">
                          {contract.id}
                        </span>
                        <Badge variant="outline" className="text-[9px] h-4">
                          {contract.currency}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] h-4">
                          {contract.rateType}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {contract.counterparty} • {contract.maturityBucket} • Rate: {formatPercent(contract.rate)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-mono font-medium text-foreground">
                        {formatAmount(contract.amount)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {contract.maturity.toFixed(1)}Y maturity
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="pt-2 border-t border-border/30 flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">
            {showContracts 
              ? `${drillDownContracts.length} contract${drillDownContracts.length !== 1 ? 's' : ''} • ${selectedContracts.size} selected for removal`
              : `${aggregatedData?.length || 0} group${(aggregatedData?.length || 0) !== 1 ? 's' : ''} • Click to drill down to contracts`
            }
          </p>
          <p className="text-[10px] text-muted-foreground italic">
            Select contracts to add to pending removals
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Filter Dropdown Component
interface FilterDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}

function FilterDropdown({ label, options, selected, onToggle }: FilterDropdownProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          size="sm" 
          className={cn(
            "h-6 text-xs px-2",
            selected.length > 0 && "border-primary text-primary"
          )}
        >
          {label}
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 text-[9px] px-1">
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="start">
        <div className="space-y-1">
          {options.map((option) => (
            <label
              key={option}
              className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/50 cursor-pointer text-sm"
            >
              <Checkbox
                checked={selected.includes(option)}
                onCheckedChange={() => onToggle(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
