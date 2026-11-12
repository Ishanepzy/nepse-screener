// NEPSE fees and tax for the calculator and the journal. These are defaults; the UI lets the user edit them.

export interface CostRates {
  // the whole amount pays the rate of the slab it falls in
  tiers: { upTo: number; pct: number }[];
  // % of the amount, both sides
  sebonPct: number;
  // Rs, per stock sold
  dpCharge: number;
  // % of the gain: held up to a year / longer
  cgtShortPct: number;
  cgtLongPct: number;
}

// SEBON schedule from 2024
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
  cgt: number;
  net: number;
}

// costBasis = what the shares cost with buy fees. heldDays picks the CGT rate.
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
  cost: number;
  // loss at the stop, fees on both sides
  riskAtStop: number;
  // what stopped the size where it is (also set when not even one lot fits); none = bad inputs
  limit: 'risk' | 'capital' | 'none';
}

// Biggest position whose loss at the stop (fees included) fits maxRisk and whose cost fits capital.
export function sizePosition(
  capital: number,
  maxRisk: number,
  entry: number,
  stop: number,
  lot = 1,
  rates: CostRates = DEFAULT_RATES,
): PositionPlan {
  const step = Math.max(1, Math.floor(lot));
  const none = (limit: PositionPlan['limit']): PositionPlan => ({ shares: 0, cost: 0, riskAtStop: 0, limit });
  if (!(entry > 0) || !(stop >= 0) || stop >= entry || !(maxRisk > 0) || !(capital > 0)) return none('none');
  const lossAt = (q: number) => {
    const cost = buyCost(q, entry, rates).total;
    return cost - sellProceeds(q, stop, cost, 0, rates, false).net;
  };
  // Start from the fee-free answer and step down; fees only ever shrink it.
  // `limit` is whichever test forced the last step, since fees can make risk bite where capital looked tighter.
  const byRisk = Math.floor(maxRisk / (entry - stop) / step) * step;
  const byCapital = Math.floor(capital / entry / step) * step;
  if (byCapital === 0) return none('capital'); // can't pay for one lot, whatever the risk allows
  let q = Math.min(byRisk, byCapital);
  let limit: PositionPlan['limit'] = byCapital < byRisk ? 'capital' : 'risk';
  while (q > 0) {
    const overRisk = lossAt(q) > maxRisk;
    if (!overRisk && buyCost(q, entry, rates).total <= capital) break;
    limit = overRisk ? 'risk' : 'capital';
    q -= step;
  }
  if (q <= 0) return none(limit);
  return { shares: q, cost: buyCost(q, entry, rates).total, riskAtStop: lossAt(q), limit };
}
