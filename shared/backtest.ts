// Backtests a buy rule (the screener's conditions) with stop, target, trailing stop, time and signal exits, across
// many stocks with one account. A signal at a close buys at the next session's open, and a sell signal sells at the
// next open, so nothing acts on a price before it happened. Long only: NEPSE has no short selling.
//
// A run of days on which the rule holds is one signal, and buys at most once: on its first day if there's room, or
// on a later day of the run once a slot frees up. After a sale the stock waits for a new signal, so a rule that stays
// true doesn't buy straight back in after a stop.
import type { Bars, Condition } from './types.ts';
import { DEFAULT_RATES, buyCost, sellProceeds, type CostRates } from './costs.ts';
import { signalSeries, type SeriesCache } from './screener.ts';

export interface BacktestSettings {
  entry: { conditions: Condition[]; match: 'all' | 'any' };
  // sell at the next open once any of these is true at a close
  exitConditions: Condition[];
  // % below the buy price; null = none
  stopPct: number | null;
  // % above the buy price
  targetPct: number | null;
  // % below the highest close since the buy
  trailPct: number | null;
  // sell at the close after this many sessions
  maxDays: number | null;
  // YYYY-MM-DD; null = from the start / to the end of the data
  from: string | null;
  to: string | null;
  capital: number;
  // of the account's value, for each new position
  positionPct: number;
  maxPositions: number;
  // sessions after buying before the shares can be sold (settlement)
  minHold: number;
  // NEPSE commission, SEBON fee, DP charge and capital gains tax
  fees: boolean;
  // skip a signal when the stock's average daily turnover over 20 sessions is below this (Rs)
  minTurnover: number;
}

export interface BacktestRequest extends BacktestSettings {
  // null = every company share
  symbols: string[] | null;
  rates?: CostRates;
}

export type ExitReason = 'stop' | 'trail' | 'target' | 'signal' | 'time' | 'end';

export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  shares: number;
  // what the buy cost, fees included, and what the sale brought in after fees and tax
  cost: number;
  proceeds: number;
  pnl: number;
  // % on the cost
  ret: number;
  // sessions held
  days: number;
  reason: ExitReason;
}

export interface BacktestStats {
  finalEquity: number;
  totalReturn: number;
  // a year, compounded; null for a period under three months
  cagr: number | null;
  maxDrawdown: number;
  trades: number;
  wins: number;
  winRate: number | null;
  // average % per trade, of the winners / losers / all
  avgWin: number | null;
  avgLoss: number | null;
  avgTrade: number | null;
  // money won / money lost
  profitFactor: number | null;
  avgDays: number | null;
  // % of sessions with money in the market
  exposure: number;
  best: number | null;
  worst: number | null;
  benchmarkReturn: number | null;
  byReason: Partial<Record<ExitReason, { n: number; pnl: number }>>;
}

export interface BacktestResult {
  from: string;
  to: string;
  stocks: number;
  trades: BacktestTrade[];
  // account value at each close
  equity: { t: string[]; v: number[] };
  // NEPSE over the same sessions, scaled to the starting capital
  benchmark: { t: string[]; v: number[] } | null;
  stats: BacktestStats;
  // signals (runs of days the rule held) in the period, and those that never got bought for want of a slot or cash
  signals: number;
  missed: number;
}

// NEPSE trades in whole shares; 10 is the smallest order on the main board
export const LOT = 10;

interface Prepared {
  symbol: string;
  bars: Bars;
  buy: Uint8Array;
  // which run of signal days each bar belongs to (0 = no signal)
  run: Int32Array;
  // the last run this stock was bought on
  usedRun: number;
  sell: Uint8Array | null;
  index: Map<string, number>;
  turnover: Float64Array;
}

interface Position {
  p: Prepared;
  // bar of the buy
  at: number;
  date: string;
  price: number;
  shares: number;
  cost: number;
  // highest close since the buy, for the trailing stop
  peak: number;
  lastClose: number;
  // a sell signal is waiting for the next open the shares can be sold at
  sellNext: boolean;
}

const daysApart = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

function avgTurnover(b: Bars, n = 20): Float64Array {
  const out = new Float64Array(b.c.length);
  let sum = 0;
  for (let i = 0; i < b.c.length; i++) {
    sum += b.c[i] * b.v[i];
    if (i >= n) sum -= b.c[i - n] * b.v[i - n];
    out[i] = sum / Math.min(n, i + 1);
  }
  return out;
}

export function runBacktest(stocks: { symbol: string; bars: Bars }[], index: Bars | null, s: BacktestRequest): BacktestResult {
  const rates = s.rates ?? DEFAULT_RATES;
  const minHold = Math.max(1, Math.round(s.minHold));
  const prepared: Prepared[] = stocks
    .filter(({ bars }) => bars.c.length > 1)
    .map(({ symbol, bars }) => {
      const cache: SeriesCache = new Map();
      const buy = signalSeries(bars, s.entry.conditions, s.entry.match, cache);
      const run = new Int32Array(buy.length);
      let runs = 0;
      for (let i = 0; i < buy.length; i++) run[i] = buy[i] ? (i > 0 && buy[i - 1] ? run[i - 1] : ++runs) : 0;
      return {
        symbol,
        bars,
        buy,
        run,
        usedRun: 0,
        sell: s.exitConditions.length ? signalSeries(bars, s.exitConditions, 'any', cache) : null,
        index: new Map(bars.t.map((d, i) => [d, i])),
        turnover: avgTurnover(bars),
      };
    });

  const inRange = (d: string) => (!s.from || d >= s.from) && (!s.to || d <= s.to);
  const dates = [...new Set(prepared.flatMap((p) => p.bars.t.filter(inRange)))].sort();
  const empty: BacktestResult = {
    from: s.from ?? '',
    to: s.to ?? '',
    stocks: prepared.length,
    trades: [],
    equity: { t: [], v: [] },
    benchmark: null,
    stats: stats([], [], s.capital, null, 0),
    signals: 0,
    missed: 0,
  };
  if (!dates.length) return empty;
  for (const p of prepared) p.usedRun = 0;

  let cash = s.capital;
  let lastEquity = s.capital;
  const open = new Map<string, Position>();
  const trades: BacktestTrade[] = [];
  const equity = { t: [] as string[], v: [] as number[] };
  // `${symbol} ${run}` of every signal seen in the period, and of those bought
  const seen = new Set<string>();
  let bought = 0;
  let invested = 0;

  const sell = (pos: Position, i: number, date: string, price: number, reason: ExitReason) => {
    const proceeds = s.fees ? sellProceeds(pos.shares, price, pos.cost, daysApart(pos.date, date), rates).net : pos.shares * price;
    cash += proceeds;
    open.delete(pos.p.symbol);
    trades.push({
      symbol: pos.p.symbol,
      entryDate: pos.date,
      entryPrice: pos.price,
      exitDate: date,
      exitPrice: price,
      shares: pos.shares,
      cost: pos.cost,
      proceeds,
      pnl: proceeds - pos.cost,
      ret: ((proceeds - pos.cost) / pos.cost) * 100,
      days: i - pos.at,
      reason,
    });
  };
  const costOf = (shares: number, price: number) => (s.fees ? buyCost(shares, price, rates).total : shares * price);

  for (const date of dates) {
    // 1. sells: at the open (a signal from the last close, or a gap through a level), then during the day
    for (const pos of [...open.values()]) {
      const i = pos.p.index.get(date);
      if (i == null || i - pos.at < minHold) continue;
      const b = pos.p.bars;
      const [o, h, l, c] = [b.o[i], b.h[i], b.l[i], b.c[i]];
      const stop = s.stopPct != null ? pos.price * (1 - s.stopPct / 100) : -Infinity;
      const trail = s.trailPct != null ? pos.peak * (1 - s.trailPct / 100) : -Infinity;
      const floor = Math.max(stop, trail);
      const floorWhy: ExitReason = trail > stop ? 'trail' : 'stop';
      const target = s.targetPct != null ? pos.price * (1 + s.targetPct / 100) : Infinity;
      if (pos.sellNext) sell(pos, i, date, o, 'signal');
      else if (o <= floor) sell(pos, i, date, o, floorWhy);
      else if (o >= target) sell(pos, i, date, o, 'target');
      // both levels inside one day: daily bars can't say which came first, so assume the worse
      else if (l <= floor) sell(pos, i, date, floor, floorWhy);
      else if (h >= target) sell(pos, i, date, target, 'target');
      else if (s.maxDays != null && i - pos.at >= s.maxDays) sell(pos, i, date, c, 'time');
    }

    // 2. buys at the open, from signals at the last close; the most traded stocks first
    const today = prepared
      .map((p) => ({ p, i: p.index.get(date) }))
      .filter((x): x is { p: Prepared; i: number } => {
        if (x.i == null || x.i < 1 || !x.p.buy[x.i - 1] || x.p.turnover[x.i - 1] < s.minTurnover || !inRange(x.p.bars.t[x.i - 1])) return false;
        seen.add(`${x.p.symbol} ${x.p.run[x.i - 1]}`);
        return !open.has(x.p.symbol) && x.p.usedRun !== x.p.run[x.i - 1];
      })
      .sort((a, b) => b.p.turnover[b.i - 1] - a.p.turnover[a.i - 1]);
    for (const { p, i } of today) {
      if (open.size >= s.maxPositions) break;
      const price = p.bars.o[i];
      const budget = Math.min(cash, (lastEquity * s.positionPct) / 100);
      let shares = Math.floor(budget / price / LOT) * LOT;
      while (shares > 0 && costOf(shares, price) > budget) shares -= LOT;
      if (shares < LOT) continue;
      const cost = costOf(shares, price);
      cash -= cost;
      p.usedRun = p.run[i - 1];
      bought++;
      open.set(p.symbol, { p, at: i, date, price, shares, cost, peak: price, lastClose: price, sellNext: false });
    }

    // 3. the close: value the account, raise trailing peaks, note sell signals for tomorrow's open
    let value = cash;
    for (const pos of open.values()) {
      const i = pos.p.index.get(date);
      if (i != null) {
        pos.lastClose = pos.p.bars.c[i];
        pos.peak = Math.max(pos.peak, pos.lastClose);
        if (pos.p.sell?.[i]) pos.sellNext = true;
      }
      value += pos.shares * pos.lastClose;
    }
    if (open.size) invested++;
    lastEquity = value;
    equity.t.push(date);
    equity.v.push(value);
  }

  // still open at the end: sold at the last close, so the totals include them
  const end = dates[dates.length - 1];
  for (const pos of [...open.values()]) {
    const b = pos.p.bars;
    let i = b.t.length - 1;
    while (i > pos.at && b.t[i] > end) i--;
    sell(pos, i, b.t[i], b.c[i], 'end');
  }
  if (equity.v.length) equity.v[equity.v.length - 1] = cash;

  let benchmark: BacktestResult['benchmark'] = null;
  if (index?.t.length) {
    const t: string[] = [];
    const v: number[] = [];
    let j = 0;
    let first = NaN;
    for (const d of dates) {
      while (j < index.t.length - 1 && index.t[j + 1] <= d) j++;
      if (index.t[j] > d) continue;
      if (Number.isNaN(first)) first = index.c[j];
      t.push(d);
      v.push((s.capital * index.c[j]) / first);
    }
    if (t.length) benchmark = { t, v };
  }

  return {
    from: dates[0],
    to: end,
    stocks: prepared.length,
    trades,
    equity,
    benchmark,
    stats: stats(trades, equity.v, s.capital, benchmark, dates.length ? (invested / dates.length) * 100 : 0, dates[0], end),
    signals: seen.size,
    missed: seen.size - bought,
  };
}

function stats(trades: BacktestTrade[], v: number[], capital: number, bench: BacktestResult['benchmark'], exposure: number, from = '', to = ''): BacktestStats {
  const final = v.length ? v[v.length - 1] : capital;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  let peak = capital;
  let dd = 0;
  for (const x of v) {
    peak = Math.max(peak, x);
    dd = Math.min(dd, (x - peak) / peak);
  }
  const years = from && to ? daysApart(from, to) / 365.25 : 0;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const won = wins.reduce((a, t) => a + t.pnl, 0);
  const lost = -losses.reduce((a, t) => a + t.pnl, 0);
  const byReason: BacktestStats['byReason'] = {};
  for (const t of trades) {
    const r = (byReason[t.reason] ??= { n: 0, pnl: 0 });
    r.n++;
    r.pnl += t.pnl;
  }
  return {
    finalEquity: final,
    totalReturn: (final / capital - 1) * 100,
    cagr: years >= 0.25 && final > 0 ? ((final / capital) ** (1 / years) - 1) * 100 : null,
    maxDrawdown: dd * 100,
    trades: trades.length,
    wins: wins.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    avgWin: mean(wins.map((t) => t.ret)),
    avgLoss: mean(losses.map((t) => t.ret)),
    avgTrade: mean(trades.map((t) => t.ret)),
    profitFactor: lost > 0 ? won / lost : won > 0 ? Infinity : null,
    avgDays: mean(trades.map((t) => t.days)),
    exposure,
    best: trades.length ? Math.max(...trades.map((t) => t.ret)) : null,
    worst: trades.length ? Math.min(...trades.map((t) => t.ret)) : null,
    benchmarkReturn: bench ? (bench.v[bench.v.length - 1] / capital - 1) * 100 : null,
    byReason,
  };
}
