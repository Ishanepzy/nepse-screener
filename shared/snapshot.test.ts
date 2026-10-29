import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSnapshot, encodeSnapshot } from './snapshot.ts';
import type { Dataset } from './engine.ts';
import type { Bars, Company } from './types.ts';

const co = (symbol: string, sector?: string): Company => ({ symbol, name: `${symbol} Ltd`, sector, active: true });

function dataset(): Dataset {
  const liquid: Bars = {
    t: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'],
    o: [100, 101.5, 99.25, 103],
    h: [102, 103.333333, 101, 104.5],
    l: [99, 100.1, 98.75, 102],
    c: [101, 99.9, 100.55, 104.2],
    v: [1200, 800.5, 0, 4500],
  };
  // Trades only on some days: the date gaps must survive.
  const thin: Bars = { t: ['2026-10-05', '2026-10-08'], o: [50, 52], h: [51, 53], l: [49.5, 51], c: [50.5, 52.75], v: [10, 20] };
  return {
    asOf: '2026-10-08',
    builtAt: '2026-10-08T10:00:00.000Z',
    companies: new Map([
      ['LIQ', co('LIQ', 'Hydropower')],
      ['NICD83/84', co('NICD83/84')],
    ]),
    bars: new Map([
      ['LIQ', liquid],
      ['NICD83/84', thin],
    ]),
    index: null,
  };
}

test('snapshot round-trips bars to the paisa, keeping gaps and odd symbols', () => {
  const src = dataset();
  const out = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(src))));
  assert.equal(out.asOf, src.asOf);
  assert.equal(out.builtAt, src.builtAt);
  assert.equal(out.companies.get('LIQ')?.sector, 'Hydropower');
  assert.equal(out.companies.get('NICD83/84')?.sector, undefined);

  const liq = out.bars.get('LIQ')!;
  assert.deepEqual(liq.t, src.bars.get('LIQ')!.t);
  assert.deepEqual(liq.c, [101, 99.9, 100.55, 104.2]);
  assert.deepEqual(liq.h, [102, 103.33, 101, 104.5]); // rounded to paisa
  assert.deepEqual(liq.l, [99, 100.1, 98.75, 102]);
  assert.deepEqual(liq.o, [100, 101.5, 99.25, 103]);
  assert.deepEqual(liq.v, [1200, 801, 0, 4500]);

  assert.deepEqual(out.bars.get('NICD83/84')!.t, ['2026-10-05', '2026-10-08']);
  assert.deepEqual(out.bars.get('NICD83/84')!.c, [50.5, 52.75]);
});

test('snapshot drops bars older than the window', () => {
  const src = dataset();
  const old = src.bars.get('LIQ')!;
  old.t.unshift('2020-01-01');
  for (const k of ['o', 'h', 'l', 'c', 'v'] as const) old[k].unshift(1);
  const out = decodeSnapshot(encodeSnapshot(src, 3));
  assert.equal(out.bars.get('LIQ')!.t[0], '2026-10-05');
});
