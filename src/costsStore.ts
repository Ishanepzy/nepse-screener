// The fee and tax rates the calculator and journal use: SEBON's defaults, editable, remembered in this browser.
import { DEFAULT_RATES, type CostRates } from '../shared/costs.ts';

const KEY = 'nepse.costRates.v1';

/** Slab limits are fixed (SEBON's); the user edits the percentages. */
export const SLABS = ['Up to Rs 50,000', 'Rs 50,000 – 5 lakh', 'Rs 5 – 20 lakh', 'Rs 20 lakh – 1 crore', 'Above Rs 1 crore'];

interface Stored {
  pcts: number[];
  sebonPct: number;
  dpCharge: number;
  cgtShortPct: number;
  cgtLongPct: number;
}

const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

export function loadRates(): CostRates {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    if (v && Array.isArray(v.pcts) && v.pcts.length === DEFAULT_RATES.tiers.length && v.pcts.every(ok)) {
      return {
        tiers: DEFAULT_RATES.tiers.map((t, i) => ({ upTo: t.upTo, pct: v.pcts[i] })),
        sebonPct: ok(v.sebonPct) ? v.sebonPct : DEFAULT_RATES.sebonPct,
        dpCharge: ok(v.dpCharge) ? v.dpCharge : DEFAULT_RATES.dpCharge,
        cgtShortPct: ok(v.cgtShortPct) ? v.cgtShortPct : DEFAULT_RATES.cgtShortPct,
        cgtLongPct: ok(v.cgtLongPct) ? v.cgtLongPct : DEFAULT_RATES.cgtLongPct,
      };
    }
  } catch {
    /* blocked or corrupt: defaults */
  }
  return DEFAULT_RATES;
}

export function saveRates(r: CostRates) {
  try {
    const v: Stored = { pcts: r.tiers.map((t) => t.pct), sebonPct: r.sebonPct, dpCharge: r.dpCharge, cgtShortPct: r.cgtShortPct, cgtLongPct: r.cgtLongPct };
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* convenience only */
  }
}

/** Every cost at zero, for "leave fees out". */
export const NO_COSTS: CostRates = { tiers: DEFAULT_RATES.tiers.map((t) => ({ upTo: t.upTo, pct: 0 })), sebonPct: 0, dpCharge: 0, cgtShortPct: 0, cgtLongPct: 0 };
