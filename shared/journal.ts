// Trade journal maths: replays buys and sells in date order, matches each sale against the oldest shares still held
// (first in, first out), and works out profit after fees and capital gains tax.
import { buyCost, commission, type CostRates } from './costs.ts';

export interface Trade {
  id: string;
  /** Trade date, YYYY-MM-DD. */
  date: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  /** Planned stop-loss (buys): turns results into R multiples. */
  stop?: number;
  target?: number;
  /** Setup or strategy tag, e.g. "Stage 2 breakout". */
  setup?: string;
  notes?: string;
}

export interface Position {
  symbol: string;
  qty: number;
  /** Paid for the shares still held, buy fees included. */
  cost: number;
  /** Per share, buy fees included. */
  avgCost: number;
  firstDate: string;
  /** Stop of the most recent buy that set one. */
  stop?: number;
  setup?: string;
}

export interface ClosedTrade {
  /** The sale's trade id. */
  id: string;
  symbol: string;
  /** Earliest buy matched against this sale. */
  buyDate: string;
  sellDate: string;
  qty: number;
  /** Average buy and sell prices (before fees). */
  buyPrice: number;
  sellPrice: number;
  /** Paid, buy fees included. */
  cost: number;
  /** Received, after sell fees and capital gains tax. */
  proceeds: number;
  tax: number;
  pnl: number;
  pnlPct: number;
  days: number;
  /** Price move in units of the planned risk (buy price − stop), when every matched buy had a stop. */
  r: number | null;
  setup?: string;
}

export interface JournalResult {
  positions: Position[];
  closed: ClosedTrade[];
  /** Sales larger than the shares held at the time; the extra was left out. */
  warnings: string[];
}

interface Lot {
  date: string;
  qty: number;
  price: number;
  costPerShare: number;
  stop?: number;
  setup?: string;
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / DAY));

export function replayJournal(trades: Trade[], rates: CostRates, withTax = true): JournalResult {
  // Date order; same-day entries keep the order they were logged in, so a same-day buy then sell works.
  const ordered = trades.map((t, i) => ({ t, i })).sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i));
  const lots = new Map<string, Lot[]>();
  const closed: ClosedTrade[] = [];
  const warnings: string[] = [];

  for (const { t } of ordered) {
    if (!(t.qty > 0) || !(t.price > 0)) continue;
    const queue = lots.get(t.symbol) ?? [];
    lots.set(t.symbol, queue);
    if (t.side === 'buy') {
      queue.push({ date: t.date, qty: t.qty, price: t.price, costPerShare: buyCost(t.qty, t.price, rates).total / t.qty, stop: t.stop, setup: t.setup });
      continue;
    }
    // Sell: fees are charged on the whole order, then shared per share across the lots it closes.
    const held = queue.reduce((s, l) => s + l.qty, 0);
    const qty = Math.min(t.qty, held);
    if (t.qty > held) warnings.push(`${t.date}: sold ${t.qty} ${t.symbol} but held ${held}; the extra ${t.qty - held} is left out.`);
    if (qty <= 0) continue;
    const amount = qty * t.price;
    const feesPerShare = (commission(amount, rates) + (amount * rates.sebonPct) / 100 + rates.dpCharge) / qty;
    let left = qty;
    let cost = 0;
    let proceeds = 0;
    let tax = 0;
    let buyValue = 0;
    let rSum = 0;
    let rQty = 0;
    let firstDate = '';
    let setup: string | undefined;
    while (left > 0 && queue.length) {
      const lot = queue[0];
      const m = Math.min(left, lot.qty);
      const chunkCost = m * lot.costPerShare;
      const gross = m * (t.price - feesPerShare);
      const gain = gross - chunkCost;
      const held = daysBetween(lot.date, t.date);
      const chunkTax = withTax && gain > 0 ? (gain * (held > 365 ? rates.cgtLongPct : rates.cgtShortPct)) / 100 : 0;
      cost += chunkCost;
      proceeds += gross - chunkTax;
      tax += chunkTax;
      buyValue += m * lot.price;
      if (lot.stop != null && lot.stop < lot.price) {
        rSum += (m * (t.price - lot.price)) / (lot.price - lot.stop);
        rQty += m;
      }
      firstDate ||= lot.date;
      setup ??= lot.setup;
      lot.qty -= m;
      left -= m;
      if (lot.qty === 0) queue.shift();
    }
    closed.push({
      id: t.id,
      symbol: t.symbol,
      buyDate: firstDate,
      sellDate: t.date,
      qty,
      buyPrice: buyValue / qty,
      sellPrice: t.price,
      cost,
      proceeds,
      tax,
      pnl: proceeds - cost,
      pnlPct: ((proceeds - cost) / cost) * 100,
      days: daysBetween(firstDate, t.date),
      r: rQty === qty ? rSum / qty : null,
      setup: t.setup || setup,
    });
  }

  const positions: Position[] = [];
  for (const [symbol, queue] of lots) {
    const qty = queue.reduce((s, l) => s + l.qty, 0);
    if (!qty) continue;
    const cost = queue.reduce((s, l) => s + l.qty * l.costPerShare, 0);
    const withStop = [...queue].reverse().find((l) => l.stop != null);
    positions.push({ symbol, qty, cost, avgCost: cost / qty, firstDate: queue[0].date, stop: withStop?.stop, setup: queue[0].setup });
  }
  positions.sort((a, b) => a.symbol.localeCompare(b.symbol));
  closed.sort((a, b) => (a.sellDate < b.sellDate ? 1 : a.sellDate > b.sellDate ? -1 : 0));
  return { positions, closed, warnings };
}

export interface JournalStats {
  trades: number;
  wins: number;
  winRate: number | null;
  realized: number;
  avgWin: number | null;
  avgLoss: number | null;
  /** Gross profit ÷ gross loss. */
  profitFactor: number | null;
  avgR: number | null;
  avgDays: number | null;
}

export function journalStats(closed: ClosedTrade[]): JournalStats {
  const wins = closed.filter((c) => c.pnl > 0);
  const losses = closed.filter((c) => c.pnl <= 0);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
  const gain = sum(wins.map((c) => c.pnl));
  const loss = -sum(losses.map((c) => c.pnl));
  const rs = closed.flatMap((c) => (c.r == null ? [] : [c.r]));
  return {
    trades: closed.length,
    wins: wins.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    realized: sum(closed.map((c) => c.pnl)),
    avgWin: avg(wins.map((c) => c.pnl)),
    avgLoss: avg(losses.map((c) => c.pnl)),
    profitFactor: loss > 0 ? gain / loss : null,
    avgR: avg(rs),
    avgDays: avg(closed.map((c) => c.days)),
  };
}

/** Accepts a backup file's content; throws on anything that isn't a list of trades. */
export function parseJournal(raw: unknown): Trade[] {
  const list = Array.isArray(raw) ? raw : (raw as { trades?: unknown })?.trades;
  if (!Array.isArray(list)) throw new Error('Not a journal backup');
  return list.map((t, i) => {
    const x = t as Partial<Trade>;
    if (typeof x.symbol !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.date)) || (x.side !== 'buy' && x.side !== 'sell') || !(Number(x.qty) > 0) || !(Number(x.price) > 0)) {
      throw new Error(`Entry ${i + 1} is incomplete`);
    }
    const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
    return {
      id: typeof x.id === 'string' && x.id ? x.id : `t${Date.now().toString(36)}${i}`,
      date: x.date!,
      symbol: x.symbol.trim().toUpperCase(),
      side: x.side,
      qty: Number(x.qty),
      price: Number(x.price),
      stop: num(x.stop),
      target: num(x.target),
      setup: typeof x.setup === 'string' && x.setup ? x.setup : undefined,
      notes: typeof x.notes === 'string' && x.notes ? x.notes : undefined,
    };
  });
}
