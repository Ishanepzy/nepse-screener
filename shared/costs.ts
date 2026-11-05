// NEPSE trading costs, shared by the position-size calculator and the trade journal. Rates change from time to
// time and some brokers differ, so these are defaults the user can edit.

export interface CostRates {
  /** Broker commission: the whole transaction amount pays the rate of the slab it falls in. Last slab has no limit. */
  tiers: { upTo: number; pct: number }[];
  /** SEBON transaction fee, % of the amount, both sides. */
  sebonPct: number;
  /** CDSC DP charge per stock sold (Rs). */
  dpCharge: number;
  /** Capital gains tax for individuals, % of the gain: held 365 days or less / longer. */
  cgtShortPct: number;
  cgtLongPct: number;
}

/** SEBON's 2024 commission schedule (0.36% down to 0.24%), 0.015% SEBON fee, Rs 25 DP charge, 7.5% / 5% CGT. */
export const DEFAULT_RATES: CostRates = {
  tiers: [
    { upTo: 50_000, pct: 0.36 },
    { upTo: 500_000, pct: 0.33 },
    { upTo: 2_000_000, pct: 0.31 },
    { upTo: 10_000_000, pct: 0.27 },
    { upTo: Infinity, pct: 0.24 },
  ],
  sebonPct: 0.015,
  dpCharge: 25,
  cgtShortPct: 7.5,
  cgtLongPct: 5,
};

export function commission(amount: number, rates: CostRates = DEFAULT_RATES): number {
  if (!(amount > 0)) return 0;
  const tier = rates.tiers.find((t) => amount <= t.upTo) ?? rates.tiers[rates.tiers.length - 1];
  return (amount * tier.pct) / 100;
}

export interface BuyCost {
  amount: number;
  commission: number;
  sebon: number;
  /** What leaves the bank account. */
  total: number;
}

export function buyCost(qty: number, price: number, rates: CostRates = DEFAULT_RATES): BuyCost {
  const amount = qty * price;
  const c = commission(amount, rates);
  const sebon = (amount * rates.sebonPct) / 100;
  return { amount, commission: c, sebon, total: amount + c + sebon };
}

export interface SellProceeds {
  amount: number;
  commission: number;
  sebon: number;
  dp: number;
  /** Capital gains tax on the gain over `costBasis` (0 on a loss). */
  cgt: number;
  /** What reaches the bank account. */
  net: number;
}

/**
 * Selling `qty` at `price`. `costBasis` is what those shares cost including buy fees; `heldDays` picks the CGT rate.
 * Pass `withTax: false` to leave tax out (e.g. institutions, or to compare before tax).
 */
export function sellProceeds(
  qty: number,
  price: number,
  costBasis: number,
  heldDays: number,
  rates: CostRates = DEFAULT_RATES,
  withTax = true,
): SellProceeds {
  const amount = qty * price;
  const c = commission(amount, rates);
  const sebon = (amount * rates.sebonPct) / 100;
  const dp = qty > 0 ? rates.dpCharge : 0;
  const beforeTax = amount - c - sebon - dp;
  const gain = beforeTax - costBasis;
  const cgt = withTax && gain > 0 ? (gain * (heldDays > 365 ? rates.cgtLongPct : rates.cgtShortPct)) / 100 : 0;
  return { amount, commission: c, sebon, dp, cgt, net: beforeTax - cgt };
}

export interface PositionPlan {
  shares: number;
  /** Cost of the shares including buy fees. */
  cost: number;
  /** Loss if the stop is hit, after fees on both sides (no tax on a loss). */
  riskAtStop: number;
  /** Why the size stopped where it did. */
  limit: 'risk' | 'capital' | 'none';
}

/**
 * The most shares whose loss at `stop` (fees included) stays within `maxRisk`, without spending more than `capital`.
 * Rounded down to a multiple of `lot`.
 */
export function sizePosition(
  capital: number,
  maxRisk: number,
  entry: number,
  stop: number,
  lot = 1,
  rates: CostRates = DEFAULT_RATES,
): PositionPlan {
  const step = Math.max(1, Math.floor(lot));
  const empty: PositionPlan = { shares: 0, cost: 0, riskAtStop: 0, limit: 'none' };
  if (!(entry > 0) || !(stop >= 0) || stop >= entry || !(maxRisk > 0) || !(capital > 0)) return empty;
  const lossAt = (q: number) => {
    const cost = buyCost(q, entry, rates).total;
    return cost - sellProceeds(q, stop, cost, 0, rates, false).net;
  };
  // Start from the fee-free answer and step down; fees only ever shrink it.
  const byRisk = Math.floor(maxRisk / (entry - stop) / step) * step;
  const byCapital = Math.floor(capital / (entry * 1.01) / step) * step; // 1% headroom covers buy fees
  let q = Math.min(byRisk, byCapital);
  while (q > 0 && (lossAt(q) > maxRisk || buyCost(q, entry, rates).total > capital)) q -= step;
  if (q <= 0) return empty;
  return { shares: q, cost: buyCost(q, entry, rates).total, riskAtStop: lossAt(q), limit: byCapital < byRisk ? 'capital' : 'risk' };
}
