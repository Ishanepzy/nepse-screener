import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ta from './indicators.ts';
import { buildProfiles, rsRatings, stageHistory, weeklyCloses } from './analysis.ts';
import { evaluate, normalizeCondition, crossIndices, type SeriesCache } from './screener.ts';
import type { Bars } from './types.ts';

/** Daily bars Monday–Friday from 2024-01-01, one close per weekday; high/low 1 either side. */
function weekdays(closes: number[]): Bars {
  const t: string[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  while (t.length < closes.length) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) t.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { t, c: closes, o: closes, h: closes.map((x) => x + 1), l: closes.map((x) => x - 1), v: closes.map(() => 1000) };
}

test('breakout: starts on a close above the prior high, signals once on follow-through, ends on falling back', () => {
  //            0   1   2   3   4    5    6    7    8   9
  const c = [10, 10, 10, 10, 10, 12, 11.5, 11.8, 14, 12.4];
  const h = c.map((x) => x + 0.5); // bar 5's high = 12.5
  const r = ta.breakout(h, c, 3);
  // level at bar 5 = max(h[2..4]) = 10.5; close 12 > 10.5 starts it, broken level 10.5
  assert.equal(r.level[5], 10.5);
  assert.deepEqual(r.start, [0, 0, 0, 0, 0, 1, 0, 0, 0, 0]);
  // bars 6-7 close under 12.5 (holding, no signal); bar 8 closes 14 > 12.5: the one signal, and a new 3-day high
  assert.deepEqual(r.signal, [0, 0, 0, 0, 0, 0, 0, 0, 1, 0]);
  // bar 8 broke level 12.5 (max high of bars 5-7), so the base moved up to it and bar 9's 12.4 falls back below it
  assert.equal(r.base[8], 12.5);
  assert.deepEqual(r.state, [0, 0, 0, 0, 0, 1, 1, 1, 1, 0]);
  assert.ok(Number.isNaN(r.base[9]));
  const held = ta.breakout(h, [...c.slice(0, 9), 12.6], 3);
  assert.equal(held.state[9], 1);
});

test('"happened" finds the latest event in the window and marks where states begin', () => {
  const c = [10, 10, 10, 10, 10, 12, 11.5, 13.5, 14, 14.4];
  const bars: Bars = { t: c.map((_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`), c, o: c, h: c.map((x) => x + 0.5), l: c, v: c };
  const cache: SeriesCache = new Map();
  const cond = (line: string, within: number) => normalizeCondition({ left: { id: 'breakout', params: [3], line }, op: 'fired', right: { id: 'value', params: [0] }, within });
  const hit = evaluate(bars, cond('signal', 3), cache);
  assert.equal(hit.pass, true);
  assert.equal(hit.barsAgo, 2);
  assert.equal(evaluate(bars, cond('signal', 2), cache).pass, false);
  assert.equal(evaluate(bars, cond('state', 1), cache).pass, true);
  assert.deepEqual(crossIndices(bars, cond('state', 1), cache), [5]);
});

test('weekly closes group Sunday–Saturday weeks, the last close of each', () => {
  const b = weekdays([1, 2, 3, 4, 5, 6, 7]); // Mon 1 Jan .. Tue 9 Jan 2024
  const w = weeklyCloses(b);
  assert.deepEqual(w.c, [5, 7]);
  assert.deepEqual(w.t, ['2024-01-05', '2024-01-09']);
});

test('stages: a long rise is Stage 2, the top that follows Stage 3, the fall Stage 4, the bottom Stage 1', () => {
  const up = Array.from({ length: 250 }, (_, i) => 100 + i); // ~50 weeks of rising prices
  const top = Array.from({ length: 150 }, () => 349); // 30 flat weeks, long enough for the average to level off
  const down = Array.from({ length: 200 }, (_, i) => 349 - i);
  const bottom = Array.from({ length: 150 }, () => 150);
  const bars = weekdays([...up, ...top, ...down, ...bottom]);
  const stages = stageHistory(bars);
  const at = (bar: number) => stages.find((s) => s.date >= bars.t[bar])!.stage;
  assert.equal(at(240), 2);
  assert.equal(at(250 + 40), 2); // 8 weeks into the top the average is still rising under price
  assert.equal(at(250 + 145), 3);
  assert.equal(at(400 + 190), 4);
  assert.equal(at(600 + 145), 1);
});

test('RS ratings are percentile ranks 1–99 with shared ranks for ties', () => {
  const r = rsRatings(
    new Map([
      ['A', -10],
      ['B', 0],
      ['C', 0],
      ['D', 30],
    ]),
  );
  assert.equal(r.get('A'), 1);
  assert.equal(r.get('B'), r.get('C'));
  assert.equal(r.get('B'), 50);
  assert.equal(r.get('D'), 99);
});

test('trend template: a steady uptrend meets all 8 rules, a downtrend few', () => {
  const up = weekdays(Array.from({ length: 300 }, (_, i) => 100 * 1.004 ** i));
  const down = weekdays(Array.from({ length: 300 }, (_, i) => 300 * 0.996 ** i));
  const p = buildProfiles(
    new Map([
      ['UP', { bars: up, ranked: true }],
      ['DOWN', { bars: down, ranked: true }],
    ]),
  );
  assert.equal(p.get('UP')!.rs, 99);
  assert.equal(p.get('UP')!.tt, 8);
  assert.equal(p.get('UP')!.stage, 2);
  assert.equal(p.get('DOWN')!.rs, 1);
  assert.ok(p.get('DOWN')!.tt <= 2);
  assert.equal(p.get('DOWN')!.stage, 4);
});
