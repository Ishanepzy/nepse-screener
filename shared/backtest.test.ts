import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionSeries, evaluate, normalizeCondition, type SeriesCache } from './screener.ts';
import { runBacktest, type BacktestRequest } from './backtest.ts';
import type { Bars, Condition } from './types.ts';

// weekdays from Monday 5 Jan 2026
function bars(c: number[], extra: Partial<Pick<Bars, 'o' | 'h' | 'l' | 'v'>> = {}): Bars {
  const t: string[] = [];
  const d = new Date(Date.UTC(2026, 0, 5));
  while (t.length < c.length) {
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) t.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { t, c, o: extra.o ?? c, h: extra.h ?? c.map((x) => x + 1), l: extra.l ?? c.map((x) => x - 1), v: extra.v ?? c.map(() => 1000) };
}
const head = (b: Bars, n: number): Bars => ({ t: b.t.slice(0, n), o: b.o.slice(0, n), h: b.h.slice(0, n), l: b.l.slice(0, n), c: b.c.slice(0, n), v: b.v.slice(0, n) });
const value = (x: number) => ({ id: 'value', params: [x] });
const close = { id: 'close', params: [] };

test('the per-bar series says what the screener would have said on each day', () => {
  const c = Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i / 6) + i * 0.1);
  const b = bars(c);
  const conds: Condition[] = [
    { left: close, op: 'crossAbove', right: { id: 'ema', params: [10] }, within: 3, holds: true },
    { left: close, op: 'crossBelow', right: { id: 'ema', params: [10] }, within: 2, holds: false },
    { left: close, op: 'above', right: { id: 'sma', params: [20] }, within: 4 },
    { left: { id: 'rsi', params: [14] }, op: 'below', right: value(40), within: 1 },
    { left: { id: 'ema', params: [5] }, op: 'rising', right: value(0), within: 3 },
    { left: { id: 'ratio', params: [2, 5], line: 'newhigh' }, op: 'fired', right: value(0), within: 4 },
  ].map((x) => normalizeCondition(x as Condition));
  b.ix = c.map(() => 1);
  for (const cond of conds) {
    const series = conditionSeries(b, cond, new Map());
    for (let i = 0; i < c.length; i++) {
      const h = head(b, i + 1);
      h.ix = b.ix.slice(0, i + 1);
      const want = evaluate(h, cond, new Map() as SeriesCache).pass;
      assert.equal(series[i] === 1, want, `${cond.op} on bar ${i}`);
    }
    assert.ok(series.includes(1), `${cond.op} never passes; the test proves nothing`);
  }
});

const base: BacktestRequest = {
  symbols: null,
  entry: { conditions: [normalizeCondition({ left: close, op: 'crossAbove', right: value(105) } as Condition)], match: 'all' },
  exitConditions: [],
  stopPct: null,
  targetPct: null,
  trailPct: null,
  maxDays: null,
  from: null,
  to: null,
  capital: 100_000,
  positionPct: 50,
  maxPositions: 5,
  minHold: 2,
  fees: false,
  minTurnover: 0,
};

test('buys at the next open after a signal, sells at the target inside the day', () => {
  //          0    1    2    3 (signal) 4 (buy at 107) 5    6 (high 119 reaches 117.7)  7
  const c = [100, 101, 103, 106, 108, 112, 117, 120];
  const o = [100, 101, 103, 105, 107, 110, 116, 118];
  const b = bars(c, { o, h: [101, 102, 104, 107, 109, 113, 119, 121] });
  const r = runBacktest([{ symbol: 'AAA', bars: b }], null, { ...base, targetPct: 10 });
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.entryDate, b.t[4]);
  assert.equal(t.entryPrice, 107);
  assert.equal(t.reason, 'target');
  assert.equal(t.exitDate, b.t[6]);
  assert.ok(Math.abs(t.exitPrice - 117.7) < 1e-9);
  // half of 100,000 at 107 a share, in lots of 10
  assert.equal(t.shares, 460);
  assert.ok(Math.abs(t.pnl - 460 * 10.7) < 1e-6);
  assert.equal(t.days, 2);
  assert.ok(Math.abs(r.stats.finalEquity - (100_000 + t.pnl)) < 1e-6);
  assert.equal(r.signals, 1);

  // with NEPSE's fees and tax the same trade makes less, but still makes money
  const f = runBacktest([{ symbol: 'AAA', bars: b }], null, { ...base, targetPct: 10, fees: true });
  assert.ok(f.trades[0].pnl > 0 && f.trades[0].pnl < t.pnl);
});

test('a gap through the stop sells at the open, and not before the shares have settled', () => {
  // buy at 107 on bar 4; bar 5 trades far below the stop but can't be sold (two sessions); bar 6 opens at 90
  const c = [100, 101, 103, 106, 108, 95, 92, 93];
  const o = [100, 101, 103, 105, 107, 100, 90, 92];
  const b = bars(c, { o, l: c.map((x, i) => (i === 5 ? 80 : x - 1)) });
  const r = runBacktest([{ symbol: 'AAA', bars: b }], null, { ...base, stopPct: 5 });
  assert.equal(r.trades[0].reason, 'stop');
  assert.equal(r.trades[0].exitDate, b.t[6]);
  assert.equal(r.trades[0].exitPrice, 90);
  assert.ok(r.stats.maxDrawdown < 0);
});

test('trailing stop follows the highest close; sell signals sell at the next open', () => {
  const c = [100, 101, 103, 106, 110, 120, 130, 125, 118, 117];
  const b = bars(c, { o: [100, 101, 103, 105, 107, 115, 125, 128, 124, 117] });
  // peak close 130 on bar 6, 10% trail = 117: bar 8's low 117 touches it
  const trail = runBacktest([{ symbol: 'AAA', bars: b }], null, { ...base, trailPct: 10 });
  assert.equal(trail.trades[0].reason, 'trail');
  assert.equal(trail.trades[0].exitDate, b.t[8]);
  assert.ok(Math.abs(trail.trades[0].exitPrice - 117) < 1e-9);

  const exitRule = [normalizeCondition({ left: close, op: 'crossBelow', right: value(126) } as Condition)];
  const sig = runBacktest([{ symbol: 'AAA', bars: b }], null, { ...base, exitConditions: exitRule });
  // close 125 on bar 7 drops below 126: sold at bar 8's open
  assert.equal(sig.trades[0].reason, 'signal');
  assert.equal(sig.trades[0].exitDate, b.t[8]);
  assert.equal(sig.trades[0].exitPrice, 124);
});

test('one slot, two signals: the more traded stock is bought and the other counted as missed; the rest closes at the end', () => {
  const c = [100, 101, 103, 106, 108, 109, 110];
  const busy = bars(c, { v: c.map(() => 5000) });
  const quiet = bars(c);
  const r = runBacktest(
    [
      { symbol: 'QUIET', bars: quiet },
      { symbol: 'BUSY', bars: busy },
    ],
    bars(c.map((x) => x * 10)),
    { ...base, maxPositions: 1 },
  );
  assert.equal(r.signals, 2);
  assert.equal(r.missed, 1);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].symbol, 'BUSY');
  assert.equal(r.trades[0].reason, 'end');
  assert.equal(r.trades[0].exitPrice, 110);
  // the index over the same days, scaled to the starting capital
  assert.equal(r.benchmark!.v[0], 100_000);
  assert.ok(Math.abs(r.stats.benchmarkReturn! - 10) < 1e-9);
});

test('a date range limits signals and trades to it', () => {
  const c = [100, 101, 103, 106, 108, 104, 103, 107, 109, 110];
  const b = bars(c);
  const all = runBacktest([{ symbol: 'AAA', bars: b }], null, { ...base, exitConditions: [normalizeCondition({ left: close, op: 'below', right: value(105) } as Condition)] });
  assert.equal(all.trades.length, 2);
  const late = runBacktest([{ symbol: 'AAA', bars: b }], null, { ...base, from: b.t[6], exitConditions: [] });
  assert.equal(late.trades.length, 1);
  assert.equal(late.trades[0].entryDate, b.t[8]);
});

test('after a stop, a rule that is still true waits for a fresh signal before buying again', () => {
  // close above 100 from bar 1 to 4: one signal. Bought at bar 2's open (104), stopped on bar 4 (low 95, stop 98.8)
  // while the rule still holds; bar 5 breaks it, bar 6 starts a new signal, bought at bar 7's open.
  const c = [95, 101, 104, 102, 101, 99, 102, 103, 104];
  const b = bars(c, { l: c.map((x, i) => (i === 4 ? 95 : x - 1)) });
  const entry = { conditions: [normalizeCondition({ left: close, op: 'above', right: value(100) } as Condition)], match: 'all' as const };
  const r = runBacktest([{ symbol: 'AAA', bars: b }], null, { ...base, entry, stopPct: 5 });
  assert.equal(r.trades.length, 2);
  assert.equal(r.trades[0].reason, 'stop');
  assert.equal(r.trades[0].exitDate, b.t[4]);
  assert.equal(r.trades[1].entryDate, b.t[7]);
  assert.equal(r.signals, 2);
  assert.equal(r.missed, 0);
});
