// Replays buys and sells in date order. A sale closes the oldest shares first (FIFO).
import { buyCost, commission, type CostRates } from './costs.ts';

export interface Trade {
  id: string;
  date: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  // planned stop on a buy; lets results be shown in R
  stop?: number;
  target?: number;
  setup?: string;
  notes?: string;
}

export interface Position {
  symbol: string;
  qty: number;
  // includes buy fees
  cost: number;
  avgCost: number;
  firstDate: string;
  // from the latest buy that set one
  stop?: number;
  setup?: string;
}

export interface ClosedTrade {
  // id of the sell entry
  id: string;
  symbol: string;
  // earliest buy this sale closed
  buyDate: string;
  sellDate: string;
  qty: number;
  buyPrice: number;
  sellPrice: number;
  cost: number;
  // after sell fees and tax
  proceeds: number;
  tax: number;
  pnl: number;
  pnlPct: number;
  days: number;
  // price move / planned risk. null unless every matched buy had a stop.
  r: number | null;
  setup?: string;
}

export interface JournalResult {
  positions: Position[];
  closed: ClosedTrade[];
  // sales bigger than the holding at the time (the extra is ignored)
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
  // by date; same-day entries keep the order they were logged in, so buy-then-sell on one day works
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
    // sell fees are charged on the whole order, then spread per share over the lots it closes
    const held = queue.reduce((s, l) => s + l.qty, 0);
    const qty = Math.min(t.qty, held);
    if (t.qty > held) warnings.push(`${t.date}: sold ${t.qty} ${t.symbol} but held ${held}; the extra ${t.qty - held} is left out.`);
    if (qty <= 0) continue;
    const amount = qty * t.price;
    const feesPerShare = (commission(amount, rates) + (amount * rates.sebonPct) / 100 + rates.dpCharge) / qty;
    let left = qty;
    let cost = 0;
    let gross = 0;
    // gain of the lots held up to a year / longer; losses net against gains of the same sale
    let gainShort = 0;
    let gainLong = 0;
    let buyValue = 0;
    let rSum = 0;
    let rQty = 0;
    let firstDate = '';
    let setup: string | undefined;
    while (left > 0 && queue.length) {
      const lot = queue[0];
      const m = Math.min(left, lot.qty);
      const chunkCost = m * lot.costPerShare;
      const chunkGross = m * (t.price - feesPerShare);
      if (daysBetween(lot.date, t.date) > 365) gainLong += chunkGross - chunkCost;
      else gainShort += chunkGross - chunkCost;
      cost += chunkCost;
      gross += chunkGross;
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
    const tax = withTax ? (Math.max(0, gainShort) * rates.cgtShortPct + Math.max(0, gainLong) * rates.cgtLongPct) / 100 : 0;
    const proceeds = gross - tax;
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
  // gross profit / gross loss
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

// Reads a backup file. Throws when it isn't a list of trades.
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
