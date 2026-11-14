import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfiles, quadrantOf, rotationSeries, rsRatingHistory, rsRatingSeries, rsRatings, rsScore, rsScoreSeries, stageHistory, trendTemplateSeries, weeklyCloses } from './analysis.ts';
import { evaluate, normalizeCondition, crossIndices, type SeriesCache } from './screener.ts';
import type { Bars } from './types.ts';

// weekday bars from 2024-01-01, one close each, high/low 1 either side
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

test('"happened" finds the latest event in the window, and markers go where a run of them begins', () => {
  //          0   1   2   3   4   5   6   7   8   9
  const c = [10, 10, 10, 10, 12, 13, 11, 11, 11, 11];
  // index flat at 1, so the ratio is the close; new 3-day highs on bars 4 and 5 only
  const bars: Bars = { t: c.map((_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`), c, o: c, h: c, l: c, v: c, ix: c.map(() => 1) };
  const cache: SeriesCache = new Map();
  const cond = (within: number) => normalizeCondition({ left: { id: 'ratio', params: [2, 3], line: 'newhigh' }, op: 'fired', right: { id: 'value', params: [0] }, within });
  const hit = evaluate(bars, cond(5), cache);
  assert.equal(hit.pass, true);
  assert.equal(hit.barsAgo, 4); // bar 5 is the latest
  assert.equal(evaluate(bars, cond(4), cache).pass, false);
  assert.deepEqual(crossIndices(bars, cond(5), cache), [4]); // bars 4-5 are one run, marked once
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

test('RS history: one stock at a time gives the same ratings as all at once, and the last bar matches the profile', () => {
  const mk = (rate: number) => weekdays(Array.from({ length: 320 }, (_, i) => 100 * rate ** i));
  const tail = (b: Bars, n: number): Bars => ({ t: b.t.slice(-n), o: b.o.slice(-n), h: b.h.slice(-n), l: b.l.slice(-n), c: b.c.slice(-n), v: b.v.slice(-n) });
  const stocks = new Map([
    ['FAST', mk(1.004)],
    ['MID', mk(1.001)],
    ['FLAT', mk(1)],
    ['SLOW', mk(0.998)],
    ['YOUNG', tail(mk(1.003), 120)], // listed recently: rated once it has 3 months of history
  ]);
  for (const b of stocks.values()) assert.equal(rsScoreSeries(b).at(-1), rsScore(b) ?? NaN);
  const all = rsRatingHistory(stocks);
  for (const s of stocks.keys()) assert.deepEqual(rsRatingSeries(s, stocks), all.get(s), s);
  const profiles = buildProfiles(new Map([...stocks].map(([s, b]) => [s, { bars: b, ranked: true }])));
  for (const [s, h] of all) assert.equal(h.at(-1), profiles.get(s)!.rs ?? NaN, s);
  assert.equal(all.get('FAST')!.at(-1), 99);
  assert.equal(all.get('SLOW')!.at(-1), 1);
});

test('trend template per bar ends where the profile does, and needs the RS history for rule 8', () => {
  const up = weekdays(Array.from({ length: 300 }, (_, i) => 100 * 1.004 ** i));
  const down = weekdays(Array.from({ length: 300 }, (_, i) => 300 * 0.996 ** i));
  const stocks = new Map([
    ['UP', up],
    ['DOWN', down],
  ]);
  assert.equal(trendTemplateSeries(up).score.at(-1), 7); // no RS history yet: rule 8 can't pass
  const h = rsRatingHistory(stocks);
  up.rs = h.get('UP');
  down.rs = h.get('DOWN');
  const p = buildProfiles(new Map([...stocks].map(([s, b]) => [s, { bars: b, ranked: true }])));
  assert.equal(trendTemplateSeries(up).score.at(-1), p.get('UP')!.tt);
  assert.equal(trendTemplateSeries(down).score.at(-1), p.get('DOWN')!.tt);
  assert.deepEqual(trendTemplateSeries(up).checks.map((c) => c.at(-1)), [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(trendTemplateSeries(up).score[150], trendTemplateSeries(up).checks.reduce((n, c) => n + c[150], 0));
});

test('rotation: a stock that cycles against a flat index turns clockwise through the four quadrants', () => {
  // relative strength swings on a 26-week cycle; the index stays at 1000
  const days = 5 * 90;
  const b = weekdays(Array.from({ length: days }, (_, i) => 1000 * (1 + 0.1 * Math.sin((2 * Math.PI * i) / (5 * 26)))));
  b.ix = b.c.map(() => 1000);
  const { x, y } = rotationSeries(b);
  const order = ['improving', 'leading', 'weakening', 'lagging'];
  const seen = x.flatMap((v, i) => (Number.isFinite(v) && Number.isFinite(y[i]) ? [quadrantOf(v, y[i])] : []));
  assert.ok(seen.length > 40);
  assert.deepEqual(new Set(seen), new Set(order));
  for (let i = 1; i < seen.length; i++) {
    const step = (order.indexOf(seen[i]) - order.indexOf(seen[i - 1]) + 4) % 4;
    assert.ok(step === 0 || step === 1, `week ${i}: ${seen[i - 1]} -> ${seen[i]}`);
  }
});
