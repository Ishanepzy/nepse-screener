// Fee rates as edited by the user; SEBON defaults until then.
import { DEFAULT_RATES, type CostRates } from '../shared/costs.ts';
import { load, save } from './storage.ts';

const KEY = 'nepse.costRates.v1';

// slab limits are fixed, only the percentages can be edited
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
  const v = load(KEY) as Partial<Stored> | null;
  const pcts = v?.pcts;
  if (!Array.isArray(pcts) || pcts.length !== DEFAULT_RATES.tiers.length || !pcts.every(ok)) return DEFAULT_RATES;
  const d = DEFAULT_RATES;
  return {
    tiers: d.tiers.map((t, i) => ({ upTo: t.upTo, pct: pcts[i] })),
    sebonPct: ok(v?.sebonPct) ? v.sebonPct : d.sebonPct,
    dpCharge: ok(v?.dpCharge) ? v.dpCharge : d.dpCharge,
    cgtShortPct: ok(v?.cgtShortPct) ? v.cgtShortPct : d.cgtShortPct,
    cgtLongPct: ok(v?.cgtLongPct) ? v.cgtLongPct : d.cgtLongPct,
  };
}

export function saveRates(r: CostRates) {
  const v: Stored = { pcts: r.tiers.map((t) => t.pct), sebonPct: r.sebonPct, dpCharge: r.dpCharge, cgtShortPct: r.cgtShortPct, cgtLongPct: r.cgtLongPct };
  save(KEY, v);
}

export const NO_COSTS: CostRates = { tiers: DEFAULT_RATES.tiers.map((t) => ({ upTo: t.upTo, pct: 0 })), sebonPct: 0, dpCharge: 0, cgtShortPct: 0, cgtLongPct: 0 };
