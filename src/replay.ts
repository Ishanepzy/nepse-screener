// Bar replay: the chart stops at a past day, you trade it by hand, and step forward a day at a time. This file is the
// account: orders fill at the close of the day you're on; a sale is matched against the oldest shares first (FIFO);
// NEPSE fees and capital gains tax come off when they're switched on.
import type { Bars } from '../shared/types.ts';
import { buyCost, sellProceeds, type CostRates } from '../shared/costs.ts';
import { load, save } from './storage.ts';

export interface ReplayFill {
  date: string;
  side: 'buy' | 'sell';
  shares: number;
  price: number;
}

export interface ReplaySession {
  // the first day you can trade, and the day the chart shows now
  start: string;
  at: string;
  // starting cash, Rs
  balance: number;
  fees: boolean;
  fills: ReplayFill[];
}

// one sale and the shares it sold
export interface ClosedTrade {
  date: string;
  shares: number;
  price: number;
  // what those shares cost with buy fees, and what the sale brought in after fees and tax
  cost: number;
  proceeds: number;
  pnl: number;
  // days held, averaged over the shares sold
  days: number;
}

export interface ReplayAccount {
  cash: number;
  shares: number;
  // what the shares still held cost, buy fees included, and per share
  costBasis: number;
  avgCost: number | null;
  realized: number;
  unrealized: number;
  equity: number;
  closed: ClosedTrade[];
  // profit of each sell fill, by its index in fills
  fillPnl: (number | null)[];
  // account value at each close from the start to the day shown
  curve: { t: string[]; v: number[] };
  maxDrawdown: number;
}

interface Lot {
  date: string;
  shares: number;
  // per share, buy fees included
  cost: number;
}

const daysApart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function buyTotal(shares: number, price: number, rates: CostRates | null): number {
  return rates ? buyCost(shares, price, rates).total : shares * price;
}

// the most shares the cash pays for, fees included
export function maxBuy(cash: number, price: number, rates: CostRates | null): number {
  if (!(price > 0) || !(cash > 0)) return 0;
  let n = Math.floor(cash / price);
  while (n > 0 && buyTotal(n, price, rates) > cash) n--;
  return n;
}

export function replayAccount(session: ReplaySession, bars: Bars, rates: CostRates | null): ReplayAccount {
  const fees = session.fees ? rates : null;
  let cash = session.balance;
  let realized = 0;
  const lots: Lot[] = [];
  const closed: ClosedTrade[] = [];
  const fillPnl: (number | null)[] = [];

  const apply = (f: ReplayFill) => {
    if (f.side === 'buy') {
      const total = buyTotal(f.shares, f.price, fees);
      cash -= total;
      lots.push({ date: f.date, shares: f.shares, cost: total / f.shares });
      fillPnl.push(null);
      return;
    }
    let left = f.shares;
    let cost = 0;
    let dayShares = 0;
    while (left > 0 && lots.length) {
      const lot = lots[0];
      const take = Math.min(left, lot.shares);
      cost += take * lot.cost;
      dayShares += take * daysApart(lot.date, f.date);
      lot.shares -= take;
      left -= take;
      if (!lot.shares) lots.shift();
    }
    const sold = f.shares - left;
    const days = sold ? dayShares / sold : 0;
    const proceeds = fees ? sellProceeds(sold, f.price, cost, days, fees).net : sold * f.price;
    cash += proceeds;
    realized += proceeds - cost;
    closed.push({ date: f.date, shares: sold, price: f.price, cost, proceeds, pnl: proceeds - cost, days });
    fillPnl.push(proceeds - cost);
  };

  // walk the days from the start to the day shown, filling that day's orders, then valuing at its close
  const curve = { t: [] as string[], v: [] as number[] };
  const fills = [...session.fills].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let k = 0;
  let lastClose = NaN;
  for (let i = 0; i < bars.t.length && bars.t[i] <= session.at; i++) {
    const d = bars.t[i];
    while (k < fills.length && fills[k].date <= d) apply(fills[k++]);
    lastClose = bars.c[i];
    if (d < session.start) continue;
    const held = lots.reduce((n, l) => n + l.shares, 0);
    curve.t.push(d);
    curve.v.push(cash + held * bars.c[i]);
  }
  while (k < fills.length) apply(fills[k++]);

  const shares = lots.reduce((n, l) => n + l.shares, 0);
  const costBasis = lots.reduce((n, l) => n + l.shares * l.cost, 0);
  const value = Number.isFinite(lastClose) ? shares * lastClose : 0;
  let peak = session.balance;
  let dd = 0;
  for (const v of curve.v) {
    peak = Math.max(peak, v);
    dd = Math.min(dd, (v - peak) / peak);
  }
  return {
    cash,
    shares,
    costBasis,
    avgCost: shares ? costBasis / shares : null,
    realized,
    unrealized: value - costBasis,
    equity: cash + value,
    closed,
    fillPnl,
    curve,
    maxDrawdown: dd * 100,
  };
}

export interface ReplayStats {
  netPnl: number;
  netPct: number;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  avgPnl: number | null;
  avgDays: number | null;
  maxDrawdown: number;
}

export function replayStats(session: ReplaySession, a: ReplayAccount): ReplayStats {
  const wins = a.closed.filter((t) => t.pnl > 0);
  const losses = a.closed.filter((t) => t.pnl <= 0);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
  const won = wins.reduce((n, t) => n + t.pnl, 0);
  const lost = -losses.reduce((n, t) => n + t.pnl, 0);
  return {
    netPnl: a.equity - session.balance,
    netPct: ((a.equity - session.balance) / session.balance) * 100,
    trades: a.closed.length,
    winRate: a.closed.length ? (wins.length / a.closed.length) * 100 : null,
    profitFactor: lost > 0 ? won / lost : won > 0 ? Infinity : null,
    avgWin: mean(wins.map((t) => t.pnl)),
    avgLoss: mean(losses.map((t) => t.pnl)),
    avgPnl: mean(a.closed.map((t) => t.pnl)),
    avgDays: mean(a.closed.map((t) => t.days)),
    maxDrawdown: a.maxDrawdown,
  };
}

// ---------- saved sessions, one per stock (they reach the signed-in account like everything else) ----------

const KEY = 'nepse.replay.v1';

function all(): Record<string, ReplaySession> {
  const v = load(KEY);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, ReplaySession>) : {};
}

const isSession = (s: unknown): s is ReplaySession => {
  const x = s as ReplaySession;
  return !!x && typeof x.start === 'string' && typeof x.at === 'string' && Number.isFinite(x.balance) && Array.isArray(x.fills);
};

export function loadReplay(symbol: string): ReplaySession | null {
  const s = all()[symbol];
  return isSession(s) ? { ...s, fees: s.fees !== false } : null;
}

export function saveReplay(symbol: string, session: ReplaySession | null) {
  const next = all();
  if (session) next[symbol] = session;
  else delete next[symbol];
  save(KEY, next);
}
