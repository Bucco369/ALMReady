/**
 * constants.ts – Shared constants and helpers for the product configuration form.
 *
 * Used by both AddCatalog (Buy/Sell tab) and FindLimitCompartment (Find Limit tab).
 * Any change here automatically propagates to both consumers.
 *
 * ── KEY EXPORTS ───────────────────────────────────────────────────────
 *
 *   TEMPLATE_SUBCATEGORY_MAP:
 *     Maps each productTemplate.id → balance tree subcategory.
 *     Used for placing synthetic positions in the correct balance tree bucket
 *     (e.g. 'fixed-loan' → 'loans', 'nmd' → 'deposits').
 *     MUST stay in sync with balanceSchema.ts subcategory IDs.
 *
 *   buildModificationFromForm():
 *     Converts form state → WhatIfModification object (Omit<..., 'id'>).
 *     Handles rate conversion (% → decimal), maturity calculation,
 *     floor/cap extraction, callable logic, and mixed-rate years.
 *     Stores raw formValues for lossless edit round-trips.
 *
 *   resolveModificationSelections():
 *     Reverse-lookup: productTemplateId → { side, familyId, variantId }.
 *     Used by edit mode to pre-fill the cascading dropdowns when the user
 *     clicks "edit" on an existing modification badge.
 *
 *   shouldShowTemplateFields():
 *     Gate for showing the template-specific form fields (Row 3).
 *     Requires Row 2 to be complete: currency + daycount + grace (for loans).
 *     Derivatives skip daycount/grace — only need currency selected.
 *
 * ── FIELD EXTRACTION RULES ────────────────────────────────────────────
 *
 *   Rate:     coupon || depositRate || fixedRate || wac → ÷100 to decimal
 *   Floor:    hasFloor==='Yes' && floorRate → ÷100 to decimal
 *   Cap:      hasCap==='Yes' && capRate → ÷100 to decimal
 *   CallDate: callDate present && isCallable!=='No' (handles templates
 *             where callDate is always required without an isCallable toggle)
 *   Maturity: avgLife (years) || (maturityDate - startDate) in years
 */

import {
  PRODUCT_FAMILIES,
  type AmortizationType,
  type ProductTemplate,
  type WhatIfModification,
} from '@/types/whatif';
import type { LoanSpecPayload } from '@/lib/api';

// ── Template → subcategory mapping ───────────────────────────────────────

export const TEMPLATE_SUBCATEGORY_MAP: Record<string, string> = {
  'fixed-loan': 'loans',
  'floating-loan': 'loans',
  'mixed-loan': 'loans',
  'bond-portfolio': 'securities',
  'bond-frn': 'securities',
  'nmd': 'deposits',
  'term-deposit': 'term-deposits',
  'wholesale-fixed': 'wholesale-funding',
  'wholesale-floating': 'wholesale-funding',
  'covered-bond': 'wholesale-funding',
  'covered-bond-floating': 'wholesale-funding',
  'subordinated': 'wholesale-funding',
  'subordinated-floating': 'wholesale-funding',
  'subordinated-fix2float': 'wholesale-funding',
  'irs-hedge': 'loans',
  'securitised': 'mortgages',
};

// ── Template → backend rate_type mapping ─────────────────────────────────

export const TEMPLATE_RATE_TYPE_MAP: Record<string, string> = {
  'fixed-loan': 'fixed',
  'bond-portfolio': 'fixed',
  'term-deposit': 'fixed',
  'wholesale-fixed': 'fixed',
  'covered-bond': 'fixed',
  'subordinated': 'fixed',
  'securitised': 'fixed',
  'floating-loan': 'variable',
  'bond-frn': 'variable',
  'wholesale-floating': 'variable',
  'covered-bond-floating': 'variable',
  'subordinated-floating': 'variable',
  'mixed-loan': 'mixed',
  'subordinated-fix2float': 'mixed',
  'irs-hedge': 'irs',
  'nmd': 'fixed',
};

/** Maps display label → backend frequency code. */
const FREQ_MAP: Record<string, string> = {
  'Monthly': '1M',
  'Quarterly': '3M',
  'Semi-Annual': '6M',
  'Annual': '12M',
  'At Maturity': '12M',
};

/** Maps display label → backend reference index name. */
const REF_INDEX_MAP: Record<string, string> = {
  'EURIBOR 3M': 'EUR_EURIBOR_3M',
  'EURIBOR 6M': 'EUR_EURIBOR_6M',
  'EURIBOR 12M': 'EUR_EURIBOR_12M',
  '€STR': 'EUR_ESTR_OIS',
  'SOFR': 'USD_SOFR',
  'SONIA': 'GBP_SONIA',
};

/**
 * Convert a WhatIfModification (frontend format) to a backend LoanSpecPayload
 * (snake_case, ready for the V2 /whatif/calculate endpoint).
 *
 * Returns null for modifications that can't be converted (e.g. non-add type
 * or missing product template).
 */
export function modificationToLoanSpec(
  mod: WhatIfModification,
): LoanSpecPayload | null {
  if (mod.type !== 'add' || !mod.productTemplateId) return null;

  const fv = mod.formValues || {};
  const rateType = TEMPLATE_RATE_TYPE_MAP[mod.productTemplateId] || 'fixed';

  // Side: asset→A, liability→L, derivative→A (IRS sides handled by paying_leg)
  const side = mod.category === 'liability' ? 'L' : 'A';

  // Term years: from maturity field or compute from dates
  let termYears = mod.maturity || 0;
  if (!termYears && mod.startDate && mod.maturityDate) {
    const start = new Date(mod.startDate);
    const mat = new Date(mod.maturityDate);
    termYears = (mat.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  }
  // NMD fallback: use avgLife
  if (!termYears && fv.avgLife) {
    termYears = parseFloat(fv.avgLife) || 5.0;
  }
  if (!termYears) termYears = 5.0;

  // Fixed rate: already decimal in mod.rate
  const fixedRate = mod.rate ?? null;

  // Variable index: convert display label → backend name
  let variableIndex: string | null = null;
  if (mod.refIndex) {
    variableIndex = REF_INDEX_MAP[mod.refIndex]
      || `EUR_${mod.refIndex.replace(/\s+/g, '_').toUpperCase()}`;
  }

  // Spread: mod.spread is already in bps
  const spreadBps = mod.spread || 0;

  // Frequencies: convert display label → code
  const paymentFreq = mod.paymentFreq ? (FREQ_MAP[mod.paymentFreq] || '12M') : '12M';
  const repricingFreq = mod.repricingFreq ? (FREQ_MAP[mod.repricingFreq] || null) : null;

  // Grace: from formValues (not stored at top level)
  const graceYears = fv.gracePeriod === 'yes' && fv.graceYears
    ? parseFloat(fv.graceYears) : 0;

  // Daycount: from formValues (not stored at top level)
  const daycount = fv.daycount || '30/360';

  // Paying leg: convert "Fixed"→"fixed", "Floating"→"floating"
  const payingLeg = mod.payingLeg ? mod.payingLeg.toLowerCase() : null;

  // Mixed fixed years: for subordinated-fix2float, compute from start→callDate
  let mixedFixedYears = mod.mixedFixedYears ?? null;
  if (rateType === 'mixed' && !mixedFixedYears && mod.startDate && mod.callDate) {
    const start = new Date(mod.startDate);
    const call = new Date(mod.callDate);
    mixedFixedYears = (call.getTime() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  }

  return {
    id: mod.id,
    notional: mod.notional || 0,
    term_years: Math.max(0.25, termYears),
    side,
    currency: mod.currency || 'EUR',
    rate_type: rateType,
    fixed_rate: fixedRate,
    variable_index: variableIndex,
    spread_bps: spreadBps,
    mixed_fixed_years: mixedFixedYears,
    paying_leg: payingLeg,
    amortization: mod.amortization || 'bullet',
    grace_years: graceYears,
    schedule: null,
    daycount,
    payment_freq: paymentFreq,
    repricing_freq: repricingFreq,
    start_date: mod.startDate || null,
    call_date: mod.callDate || null,
    floor_rate: mod.floorRate ?? null,
    cap_rate: mod.capRate ?? null,
    label: mod.label || '',
  };
}

// ── Row 2 constants ──────────────────────────────────────────────────────

export const CURRENCY_OPTIONS = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'SEK', 'NOK', 'DKK'] as const;

export const DAY_COUNT_OPTIONS = [
  { value: '30/360',  label: '30/360' },
  { value: 'ACT/360', label: 'ACT/360' },
  { value: 'ACT/365', label: 'ACT/365' },
  { value: 'ACT/ACT', label: 'ACT/ACT' },
] as const;

/** Fields handled by Row 2 — skipped in the template form to avoid duplication. */
export const ROW2_FIELD_IDS = new Set(['currency']);

// ── Helpers ──────────────────────────────────────────────────────────────

export function parsePositiveNumber(input?: string): number | null {
  if (!input) return null;
  const parsed = parseFloat(input);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function computeResidualMaturityYears(formValues: Record<string, string>): number {
  const fromAvgLife = parsePositiveNumber(formValues.avgLife);
  if (fromAvgLife !== null) return fromAvgLife;

  const maturityDateRaw = formValues.maturityDate;
  if (!maturityDateRaw) return 0;
  const maturityDate = new Date(maturityDateRaw);
  if (Number.isNaN(maturityDate.getTime())) return 0;

  const startDateRaw = formValues.startDate;
  const startDate = startDateRaw ? new Date(startDateRaw) : new Date();
  if (Number.isNaN(startDate.getTime())) return 0;

  const years =
    (maturityDate.getTime() - startDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (!Number.isFinite(years)) return 0;
  return Math.max(0, years);
}

/** Reverse-lookup: productTemplateId → variant/family/side. */
export function resolveModificationSelections(mod: WhatIfModification) {
  for (const family of PRODUCT_FAMILIES) {
    for (const variant of family.variants) {
      if (variant.templateId === mod.productTemplateId) {
        return { side: family.side, familyId: family.id, variantId: variant.id };
      }
    }
  }
  return null;
}

/**
 * Build a WhatIfModification data object from form state.
 * Used by both AddCatalog and FindLimitCompartment.
 */
export function buildModificationFromForm(
  selectedTemplate: ProductTemplate,
  selectedAmortization: string,
  formValues: Record<string, string>,
): Omit<WhatIfModification, 'id'> {
  const notional = formValues.notional || '—';
  const currency = formValues.currency || 'EUR';
  const rawRate =
    formValues.coupon || formValues.depositRate || formValues.fixedRate || formValues.wac;
  const parsedRate = rawRate !== undefined ? parseFloat(rawRate) : NaN;
  const rate = Number.isFinite(parsedRate) ? parsedRate / 100 : undefined;
  const maturity = computeResidualMaturityYears(formValues);

  return {
    type: 'add' as const,
    label: selectedTemplate.name,
    details: `${notional} ${currency}`,
    notional: parseFloat(notional.replace(/,/g, '')) || 0,
    currency,
    category: selectedTemplate.category,
    subcategory: TEMPLATE_SUBCATEGORY_MAP[selectedTemplate.id] || 'loans',
    rate,
    maturity,
    positionDelta: 1,
    productTemplateId: selectedTemplate.id,
    startDate: formValues.startDate || undefined,
    maturityDate: formValues.maturityDate || undefined,
    paymentFreq: formValues.paymentFreq || undefined,
    repricingFreq: formValues.repricingFreq || undefined,
    refIndex: formValues.refIndex || undefined,
    spread: formValues.spread ? parseFloat(formValues.spread) : undefined,
    payingLeg: (formValues.payingLeg as 'Fixed' | 'Floating') || undefined,
    floorRate: formValues.hasFloor === 'Yes' && formValues.floorRate ? parseFloat(formValues.floorRate) / 100 : undefined,
    capRate: formValues.hasCap === 'Yes' && formValues.capRate ? parseFloat(formValues.capRate) / 100 : undefined,
    repricingBeta: formValues.repricingBeta ? parseFloat(formValues.repricingBeta) : undefined,
    callDate: formValues.callDate && formValues.isCallable !== 'No' ? formValues.callDate : undefined,
    mixedFixedYears: formValues.mixedFixedYears ? parseFloat(formValues.mixedFixedYears) : undefined,
    amortization: ((selectedAmortization as AmortizationType) || 'bullet'),
    formValues: { ...formValues },
  };
}

/**
 * Whether the template form fields section should be visible.
 * Requires row 2 to be complete (currency + daycount + grace for loans).
 * Derivatives skip daycount/grace — only need currency.
 */
export function shouldShowTemplateFields(
  selectedFamilyId: string,
  formValues: Record<string, string>,
  selectedTemplate: unknown,
  selectedVariant: { comingSoon?: boolean } | null,
): boolean {
  if (!selectedTemplate || selectedVariant?.comingSoon) return false;
  if (!formValues.currency) return false;

  // Derivatives only need currency — no daycount or grace
  const family = PRODUCT_FAMILIES.find((f) => f.id === selectedFamilyId);
  if (family?.side === 'derivative') return true;

  if (!formValues.daycount) return false;

  if (selectedFamilyId === 'loans') {
    return (
      formValues.gracePeriod === 'no' ||
      (formValues.gracePeriod === 'yes' && !!formValues.graceYears)
    );
  }

  return true;
}
