import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ta from './indicators.ts';
import { evaluate, normalizeCondition, crossIndices, type SeriesCache } from './screener.ts';
import type { Bars, Condition } from './types.ts';

const close = (xs: number[], n = 2) => xs.map((x) => (Number.isNaN(x) ? x : Number(x.toFixed(n))));

test('sma', () => {
  assert.deepEqual(ta.sma([1, 2, 3, 4, 5], 3), [NaN, NaN, 2, 3, 4]);
});

test('ema is seeded with the SMA of the first n values', () => {
  // alpha = 0.5: 2 -> 0.5*4 + 0.5*2 = 3 -> 0.5*5 + 0.5*3 = 4
  assert.deepEqual(ta.ema([1, 2, 3, 4, 5], 3), [NaN, NaN, 2, 3, 4]);
});

test('ema skips leading NaN (as in MACD signal)', () => {
  assert.deepEqual(ta.ema([NaN, NaN, 1, 2, 3, 4, 5], 3), [NaN, NaN, NaN, NaN, 2, 3, 4]);
});

test('rsi uses Wilder smoothing seeded with a simple average', () => {
  // StockCharts' worked example closes (rounded to 2dp, so their published RSI differs in the 2nd decimal).
  const c = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
  ];
  const r = ta.rsi(c, 14);
  assert.ok(Number.isNaN(r[13]));
  // First 14 changes: gains sum 3.34, losses sum 1.40.
  let g = 3.34 / 14;
  let l = 1.4 / 14;
  assert.equal(r[14].toFixed(6), (100 - 100 / (1 + g / l)).toFixed(6));
  // Next change is -0.28: Wilder's average carries 13/14 of the previous value.
  g = (g * 13 + 0) / 14;
  l = (l * 13 + 0.28) / 14;
  assert.equal(r[15].toFixed(6), (100 - 100 / (1 + g / l)).toFixed(6));
  assert.deepEqual(close(r.slice(14)), [70.46, 66.25]);
});

test('rsi extremes', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  assert.equal(ta.rsi(up, 14).at(-1), 100);
  assert.equal(ta.rsi(up.toReversed(), 14).at(-1), 0);
  assert.equal(ta.rsi(new Array(30).fill(5), 14).at(-1), 50);
});

test('priorHighest excludes the current bar', () => {
  assert.deepEqual(ta.priorHighest([1, 5, 2, 3, 9], 3), [NaN, NaN, NaN, 5, 5]);
});

test('bollinger uses population stdev', () => {
  const { upper, middle, lower } = ta.bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  assert.equal(middle.at(-1), 5);
  assert.equal(upper.at(-1), 9); // stdev = 2
  assert.equal(lower.at(-1), 1);
});

test('supertrend turns up in a steady rally and down in a steady fall', () => {
  const n = 60;
  const up = Array.from({ length: n }, (_, i) => 100 + i * 2);
  const st = ta.supertrend(up.map((x) => x + 1), up.map((x) => x - 1), up, 10, 3);
  assert.equal(st.dir.at(-1), 1);
  assert.ok(st.line.at(-1)! < up.at(-1)!);
  const down = up.toReversed();
  const sd = ta.supertrend(down.map((x) => x + 1), down.map((x) => x - 1), down, 10, 3);
  assert.equal(sd.dir.at(-1), -1);
  assert.ok(sd.line.at(-1)! > down.at(-1)!);
});

test('dmi does not go NaN on a flat stretch', () => {
  const c = [...new Array(20).fill(10), ...Array.from({ length: 40 }, (_, i) => 10 + i)];
  const { adx, pdi } = ta.dmi(c, c, c, 14, 14);
  assert.ok(Number.isFinite(adx.at(-1)!));
  assert.ok(pdi.at(-1)! > 0);
});

function barsOf(c: number[]): Bars {
  const t = c.map((_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
  return { t, o: c, h: c, l: c, c, v: c.map(() => 1000) };
}

const crossCond = (within: number, holds = true): Condition =>
  normalizeCondition({
    left: { id: 'close', params: [] },
    op: 'crossAbove',
    right: { id: 'value', params: [10] },
    within,
    holds,
  });

test('cross within N bars reports how long ago it happened', () => {
  const b = barsOf([8, 9, 11, 12, 13]); // crossed 10 on index 2 = 2 bars ago
  const cache: SeriesCache = new Map();
  assert.equal(evaluate(b, crossCond(2), cache).pass, false);
  const hit = evaluate(b, crossCond(3), cache);
  assert.equal(hit.pass, true);
  assert.equal(hit.barsAgo, 2);
  assert.equal(hit.date, '2026-01-03');
  assert.deepEqual(crossIndices(b, crossCond(1), cache), [2]);
});

test('cross that has already reversed fails unless holds is off', () => {
  const b = barsOf([8, 11, 9]);
  assert.equal(evaluate(b, crossCond(3), new Map()).pass, false);
  assert.equal(evaluate(b, crossCond(3, false), new Map()).pass, true);
});

test('above for N bars and factor', () => {
  const b = barsOf([5, 21, 22, 23]);
  const c = normalizeCondition({
    left: { id: 'close', params: [] },
    op: 'above',
    right: { id: 'value', params: [10] },
    factor: 2,
    within: 3,
  });
  assert.equal(evaluate(b, c, new Map()).pass, true);
  assert.equal(evaluate(b, { ...c, within: 4 }, new Map()).pass, false);
});
