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
  assert.deepEqual(r.rows.map((x) => x.symbol), ['MF1', 'AAA']); // funds too: the watchlist isn't filtered
  assert.equal(r.rows[1].change, -4.5);
  assert.equal(r.rows[0].change, 0.2);
});
