import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from './engine.ts';
import { getDef } from './registry.ts';
import type { Bars } from './types.ts';

const bars = (t: string[], c: number[]): Bars => ({ t, c, o: c, h: c, l: c, v: c.map(() => 100) });

test('price / NEPSE uses the index close of the same day, carrying the last one over gaps and live bars', () => {
  const stock = bars(['2026-01-05', '2026-01-06', '2026-01-08'], [100, 110, 120]);
  const index = bars(['2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07'], [1000, 1000, 1100, 1200]);
  const e = new Engine({
    asOf: '2026-01-08',
    builtAt: null,
    companies: new Map([['ABC', { symbol: 'ABC', name: 'ABC Ltd', sector: 'Hydro Power', active: true }]]),
    bars: new Map([['ABC', stock]]),
    index,
  });
  assert.deepEqual(stock.ix, [1000, 1100, 1200]); // 01-08 has no index bar: 01-07's close
  const ratio = getDef('ratio').compute(stock, [2, 2]);
  assert.deepEqual(ratio.value, [0.1, 0.1, 0.1]);

  // A live bar for a new day keeps the latest index close.
  e.applyLive('2026-01-09', [{ symbol: 'ABC', open: 120, high: 126, low: 119, close: 126, volume: 50 }]);
  const live = e.ds.bars.get('ABC')!;
  assert.deepEqual(live.ix, [1000, 1100, 1200, 1200]);
  assert.equal(getDef('ratio').compute(live, [2, 2]).value[3], 0.105);
});

test('the ratio flags every close above its prior high', () => {
  const stock = bars(['2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08'], [100, 101, 99, 103, 104]);
  const index = bars(stock.t, [1000, 1000, 1000, 1000, 1000]);
  new Engine({ asOf: '2026-01-08', builtAt: null, companies: new Map([['ABC', { symbol: 'ABC', name: 'ABC', active: true }]]), bars: new Map([['ABC', stock]]), index });
  // lookback 2: 0.099 is under 0.101; 0.103 and 0.104 each beat the two bars before them
  assert.deepEqual(getDef('ratio').compute(stock, [2, 2]).newhigh, [0, 0, 0, 1, 1]);
});

test('watchlist rows keep the given order, skip unknown symbols, and carry the change in points', () => {
  const co = (symbol: string, sector: string) => ({ symbol, name: symbol, sector, active: true });
  const e = new Engine({
    asOf: '2026-01-06',
    builtAt: null,
    companies: new Map([
      ['AAA', co('AAA', 'Hydro Power')],
      ['MF1', co('MF1', 'Mutual Fund')],
    ]),
    bars: new Map([
      ['AAA', bars(['2026-01-05', '2026-01-06'], [100, 95.5])],
      ['MF1', bars(['2026-01-05', '2026-01-06'], [10, 10.2])],
    ]),
    index: null,
  });
  const r = e.watch(['MF1', 'NOPE', 'AAA']);
  assert.deepEqual(r.sectorSizes, { 'Hydro Power': 1, 'Mutual Fund': 1 });
  const listed = e.screen({ match: 'all', conditions: [] });
  assert.deepEqual(listed.sectorSizes, { 'Hydro Power': 1 }); // funds left out by default, so not counted either
  assert.deepEqual(r.rows.map((x) => x.symbol), ['MF1', 'AAA']); // funds too: the watchlist isn't filtered
  assert.equal(r.rows[1].change, -4.5);
  assert.equal(r.rows[0].change, 0.2);
});

test('the chart and scans only work out RS history when the trend template needs it', () => {
  const t = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  const mk = (rate: number) => bars(t, t.map((_, i) => 100 * rate ** i));
  const co = (symbol: string) => ({ symbol, name: symbol, sector: 'Hydro Power', active: true });
  const e = new Engine({
    asOf: t.at(-1)!,
    builtAt: null,
    companies: new Map([['UP', co('UP')], ['DN', co('DN')]]),
    bars: new Map([['UP', mk(1.004)], ['DN', mk(0.997)]]),
    index: null,
  });
  assert.equal(e.chart('UP', []).bars.rs, undefined);
  const withRs = e.chart('UP', [], true).bars;
  assert.equal(withRs.rs?.length, 300);
  assert.equal(withRs.rs?.at(-1), e.profiles().get('UP')!.rs);
  const r = e.screen({ match: 'all', conditions: [{ left: { id: 'tt', params: [], line: 'score' }, op: 'above', right: { id: 'value', params: [7.5] } }] });
  assert.deepEqual(r.rows.map((x) => x.symbol), ['UP']);
  assert.equal(r.rows[0].tt, 8);
});

test('rotation covers company shares by default, and exactly the symbols asked for otherwise', () => {
  const t = Array.from({ length: 300 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  const wave = (k: number) => bars(t, t.map((_, i) => 100 * (1 + 0.1 * Math.sin(i / 20 + k))));
  const co = (symbol: string, sector: string) => ({ symbol, name: symbol, sector, active: true });
  const e = new Engine({
    asOf: t.at(-1)!,
    builtAt: null,
    companies: new Map([['AAA', co('AAA', 'Hydro Power')], ['BBB', co('BBB', 'Hydro Power')], ['MF1', co('MF1', 'Mutual Fund')]]),
    bars: new Map([['AAA', wave(0)], ['BBB', wave(2)], ['MF1', wave(4)]]),
    index: bars(t, t.map(() => 1000)),
  });
  assert.deepEqual(e.rotation().points.map((p) => p.symbol).sort(), ['AAA', 'BBB']);
  const mine = e.rotation(['MF1', 'AAA']);
  assert.deepEqual(mine.points.map((p) => p.symbol), ['MF1', 'AAA']);
  assert.ok(mine.points.every((p) => p.tail.length === 7 && p.tail.at(-1)!.x === p.x));
});

test('market trend (CAN SLIM M) and the CAN SLIM filter', () => {
  const t = Array.from({ length: 260 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  const rising = bars(t, t.map((_, i) => 1000 + i));
  const co = (symbol: string) => ({ symbol, name: symbol, sector: 'Hydro Power', active: true });
  const mk = (index: Bars) =>
    new Engine({ asOf: t.at(-1)!, builtAt: null, companies: new Map([['A', co('A')]]), bars: new Map([['A', bars(t, t.map((_, i) => 100 + i))]]), index });
  assert.equal(mk(rising).market().uptrend, true);
  assert.equal(mk(bars(t, t.map((_, i) => 2000 - i))).market().uptrend, false);
  assert.equal(mk(bars(t.slice(-100), t.slice(-100).map(() => 1000))).market().uptrend, null); // under 200 days
  // A only ever rises: no down volume at all, which is more volume on up days than down
  const e = mk(rising);
  assert.equal(e.screen({ match: 'all', conditions: [] }).rows[0].canslim.n, true);
  assert.equal(e.screen({ match: 'all', conditions: [] }).rows[0].canslim.s, true);
  // B creeps up over its last 50 sessions, but trades three times the volume on its down days: S fails
  const c: number[] = [];
  const v: number[] = [];
  t.forEach((_, i) => {
    const down = i >= 210 && i % 2 === 1;
    c.push(i < 210 ? 100 + i : c[i - 1] + (down ? -1 : 2));
    v.push(down ? 300 : 100);
  });
  const heavy = new Engine({ asOf: t.at(-1)!, builtAt: null, companies: new Map([['B', co('B')]]), bars: new Map([['B', { t, c, o: c, h: c, l: c, v }]]), index: rising });
  const row = heavy.screen({ match: 'all', conditions: [] }).rows[0];
  assert.equal(row.canslim.n, true);
  assert.equal(row.canslim.s, false);
  assert.equal(heavy.screen({ match: 'all', conditions: [], universe: { canslim: true } }).rows.length, 0);
});

test("CAN SLIM's M on every bar follows the index's own sessions, also for a stock that skips days", () => {
  const t = Array.from({ length: 280 }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
  // up for 240 sessions, then a sharp fall that breaks the 50-day average
  const ic = t.map((_, i) => (i < 240 ? 1000 + i * 2 : 1480 - (i - 240) * 15));
  const index = bars(t, ic);
  const st = t.filter((_, i) => i % 3 !== 1);
  const e = new Engine({
    asOf: t.at(-1)!,
    builtAt: null,
    companies: new Map([['A', { symbol: 'A', name: 'A', sector: 'Hydro Power', active: true }]]),
    bars: new Map([['A', bars(st, st.map(() => 100))]]),
    index,
  });
  const mkt = e.ds.bars.get('A')!.mkt!;
  const s50 = ic.map((_, i) => (i < 49 ? NaN : ic.slice(i - 49, i + 1).reduce((a, x) => a + x, 0) / 50));
  const s200 = ic.map((_, i) => (i < 199 ? NaN : ic.slice(i - 199, i + 1).reduce((a, x) => a + x, 0) / 200));
  st.forEach((d, k) => {
    const j = t.indexOf(d);
    const want = j < 199 ? NaN : ic[j] > s50[j] && s50[j] > s200[j] ? 1 : 0;
    if (Number.isNaN(want)) assert.ok(Number.isNaN(mkt[k]), d);
    else assert.equal(mkt[k], want, d);
  });
  assert.ok(mkt.includes(1) && mkt.includes(0));
  assert.equal(mkt.at(-1), e.market().uptrend ? 1 : 0);
});
