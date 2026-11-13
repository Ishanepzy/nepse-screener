// Weinstein stage, RS rating and trend template for every stock, as of its last bar.
import type { Bars } from './types.ts';
import { sma } from './indicators.ts';

export type Stage = 1 | 2 | 3 | 4;

export interface StagePoint {
  date: string;
  stage: Stage;
}

export interface Profile {
  // 1-99 among company shares. null for funds, debentures and short histories.
  rs: number | null;
  // the weighted return the rating ranks
  rsScore: number | null;
  stage: Stage | null;
  // weeks in a row in this stage, the current one included
  stageWeeks: number;
  // rules met, and each result in TREND_TEMPLATE order
  tt: number;
  ttChecks: boolean[];
  high52: number | null;
  low52: number | null;
  ret: { m1: number | null; m3: number | null; m6: number | null; y1: number | null };
}

const DAY = 86_400_000;
// Sunday-to-Saturday weeks fit both NEPSE calendars: Sun-Thu until April 2026, Mon-Fri since.
const weekOf = (date: string) => Math.floor((Date.parse(date) / DAY - 3) / 7); // 1970-01-04 was a Sunday

// Last close of each week. The newest week can be a partial one.
export function weeklyCloses(b: Bars): { t: string[]; c: number[] } {
  const t: string[] = [];
  const c: number[] = [];
  let prev = NaN;
  for (let i = 0; i < b.t.length; i++) {
    const w = weekOf(b.t[i]);
    if (w === prev) {
      t[t.length - 1] = b.t[i];
      c[c.length - 1] = b.c[i];
    } else {
      t.push(b.t[i]);
      c.push(b.c[i]);
      prev = w;
    }
  }
  return { t, c };
}

// 30-week average of weekly closes. Its slope is taken over 4 weeks, and under 0.5% counts as flat.
export const STAGE_MA_WEEKS = 30;
export const STAGE_SLOPE_WEEKS = 4;
export const STAGE_FLAT_PCT = 0.5;

// Stage per week, from the 30-week average of weekly closes:
//   2 = close above a rising average, 4 = close below a falling one.
//   Anything else is 3 if the last trend was up and 1 if it was down
//   (until a trend shows up, the 13-week direction of the average decides).
export function stageHistory(b: Bars): StagePoint[] {
  const { t, c } = weeklyCloses(b);
  const ma = sma(c, STAGE_MA_WEEKS);
  const out: StagePoint[] = [];
  let lastTrend: 2 | 4 | null = null;
  for (let w = 0; w < c.length; w++) {
    const now = ma[w];
    const before = ma[w - STAGE_SLOPE_WEEKS];
    if (!(now > 0) || !(before > 0)) continue;
    const slope = (now / before - 1) * 100;
    let stage: Stage;
    if (c[w] > now && slope >= STAGE_FLAT_PCT) stage = lastTrend = 2;
    else if (c[w] < now && slope <= -STAGE_FLAT_PCT) stage = lastTrend = 4;
    else if (lastTrend) stage = lastTrend === 2 ? 3 : 1;
    else {
      const back = ma[w - 13];
      stage = back > 0 && now < back ? 1 : 3;
    }
    out.push({ date: t[w], stage });
  }
  return out;
}

export const STAGE_NAMES: Record<Stage, string> = { 1: 'Basing', 2: 'Advancing', 3: 'Topping', 4: 'Declining' };

// NaN when the history starts after `date`
function closeOnOrBefore(b: Bars, date: number): number {
  if (Date.parse(b.t[0]) > date) return NaN;
  let lo = 0;
  let hi = b.t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (Date.parse(b.t[mid]) <= date) lo = mid;
    else hi = mid - 1;
  }
  return b.c[lo];
}

function returnOver(b: Bars, days: number): number | null {
  const last = b.c.length - 1;
  const then = closeOnOrBefore(b, Date.parse(b.t[last]) - days * DAY);
  return then > 0 ? (b.c[last] / then - 1) * 100 : null;
}

// IBD-style: the latest quarter counts double
const RS_WEIGHTS: [days: number, weight: number][] = [
  [91, 0.4],
  [182, 0.2],
  [273, 0.2],
  [365, 0.2],
];

// Needs 3 months of history. Spans the stock is too young for are left out and the rest re-weighted.
export function rsScore(b: Bars): number | null {
  let sum = 0;
  let weight = 0;
  for (const [days, w] of RS_WEIGHTS) {
    const r = returnOver(b, days);
    if (r == null) continue;
    sum += r * w;
    weight += w;
  }
  return weight >= 0.4 ? sum / weight : null;
}

// percentile rank 1-99, ties share a rank
// the data has about a thousand distinct dates; parse each once
const dayCache = new Map<string, number>();
function dayNo(date: string): number {
  let d = dayCache.get(date);
  if (d === undefined) dayCache.set(date, (d = Math.round(Date.parse(date) / DAY)));
  return d;
}

// rsScore() at every bar instead of only the last one. Same sums in the same order, so the last value is equal.
export function rsScoreSeries(b: Bars): number[] {
  const n = b.c.length;
  const days = b.t.map(dayNo);
  const sum = new Float64Array(n);
  const weight = new Float64Array(n);
  for (const [span, w] of RS_WEIGHTS) {
    let j = -1; // last bar on or before `span` days back
    for (let i = 0; i < n; i++) {
      while (j + 1 < n && days[j + 1] <= days[i] - span) j++;
      const then = j >= 0 ? b.c[j] : NaN;
      if (!(then > 0)) continue;
      sum[i] += (b.c[i] / then - 1) * 100 * w;
      weight[i] += w;
    }
  }
  return Array.from(sum, (s, i) => (weight[i] >= 0.4 ? s / weight[i] : NaN));
}

// RS rating on every trading day, for the trend template's history. Each day ranks the stocks that traded in the
// 10 days before it. A stock's last bar gets the rating as of the newest date in the data, which is what the
// profile reports, so the chart and the badges agree.
const scoreCache = new WeakMap<Bars, { score: number[]; day: number[] }>();
function scored(b: Bars) {
  let v = scoreCache.get(b);
  if (!v) scoreCache.set(b, (v = { score: rsScoreSeries(b), day: b.t.map(dayNo) }));
  return v;
}

const ratingOf = (rank: number, m: number) => (m === 1 ? 99 : Math.round(1 + (98 * rank) / (m - 1)));

// One stock's RS rating on each of its bars. Counting the stocks below it is enough, no sort, which is what makes
// this fast enough to run when a chart opens. Same numbers as rsRatingHistory.
export function rsRatingSeries(target: string, stocks: Map<string, Bars>, staleDays = 10): number[] {
  const own = stocks.get(target);
  if (!own?.t.length) return [];
  const others = [...stocks.values()].map(scored);
  const me = scored(own);
  const ptr = new Int32Array(others.length).fill(-1);
  const lastDay = Math.max(...others.map((o) => o.day.at(-1) ?? -Infinity));
  const n = own.t.length;
  const out = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    // the last bar is rated as of the newest date in the data, like the profile
    const D = i === n - 1 ? lastDay : me.day[i];
    if (D - me.day[i] > staleDays || !Number.isFinite(me.score[i])) continue;
    const mine = me.score[i];
    let below = 0;
    let equal = 0; // itself included
    let pool = 0;
    for (let k = 0; k < others.length; k++) {
      const o = others[k];
      while (ptr[k] + 1 < o.day.length && o.day[ptr[k] + 1] <= D) ptr[k]++;
      const j = ptr[k];
      if (j < 0 || D - o.day[j] > staleDays) continue;
      const x = o.score[j];
      if (!Number.isFinite(x)) continue;
      pool++;
      if (x < mine) below++;
      else if (x === mine) equal++;
    }
    out[i] = ratingOf(below + (equal - 1) / 2, pool);
  }
  return out;
}

export function rsRatingHistory(stocks: Map<string, Bars>, staleDays = 10): Map<string, number[]> {
  const syms = [...stocks.keys()];
  const K = syms.length;
  const bars = syms.map((s) => stocks.get(s)!);
  const scores = bars.map((b) => scored(b).score);
  const days = bars.map((b) => scored(b).day);
  const out = bars.map((b) => new Array<number>(b.t.length).fill(NaN));
  const allDays = [...new Set(days.flat())].sort((a, b) => a - b);
  const ptr = new Int32Array(K).fill(-1);
  const inPool = new Uint8Array(K);
  const members: number[] = [];
  allDays.forEach((D, d) => {
    members.length = 0;
    for (let k = 0; k < K; k++) {
      const dk = days[k];
      while (ptr[k] + 1 < dk.length && dk[ptr[k] + 1] <= D) ptr[k]++;
      const j = ptr[k];
      inPool[k] = j >= 0 && D - dk[j] <= staleDays && Number.isFinite(scores[k][j]) ? 1 : 0;
      if (inPool[k]) members.push(k);
    }
    const last = d === allDays.length - 1;
    const score = (k: number) => scores[k][ptr[k]];
    members.sort((a, b) => score(a) - score(b));
    // same ranking as rsRatings: ties share the average rank
    const m = members.length;
    for (let a = 0; a < m; ) {
      let b = a;
      while (b + 1 < m && score(members[b + 1]) === score(members[a])) b++;
      const rating = ratingOf((a + b) / 2, m);
      for (let x = a; x <= b; x++) {
        const k = members[x];
        if (days[k][ptr[k]] === D || last) out[k][ptr[k]] = rating;
      }
      a = b + 1;
    }
    // a stock that has stopped trading has no rating today (the profile says the same)
    if (last) for (let k = 0; k < K; k++) if (!inPool[k] && ptr[k] >= 0) out[k][ptr[k]] = NaN;
  });
  return new Map(syms.map((s, k) => [s, out[k]]));
}

export function rsRatings(scores: Map<string, number>): Map<string, number> {
  const sorted = [...scores].sort((a, b) => a[1] - b[1]);
  const n = sorted.length;
  const out = new Map<string, number>();
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && sorted[j + 1][1] === sorted[i][1]) j++;
    const rank = (i + j) / 2;
    const rating = n === 1 ? 99 : Math.round(1 + (98 * rank) / (n - 1));
    for (let k = i; k <= j; k++) out.set(sorted[k][0], rating);
    i = j + 1;
  }
  return out;
}

// Minervini's trend template. Profile.ttChecks follows this order.
// Short forms for the chart legend, same order.
export const TREND_TEMPLATE_SHORT = ['above 150/200', '150 > 200', '200 rising', '50 > 150/200', 'above 50', '30% off low', 'near 52w high', 'RS 70+'];

export const TREND_TEMPLATE = [
  'Price above the 150-day and 200-day averages',
  '150-day average above the 200-day average',
  '200-day average rising for at least a month',
  '50-day average above the 150-day and 200-day averages',
  'Price above the 50-day average',
  'Price at least 30% above its 52-week low',
  'Price within 25% of its 52-week high',
  'RS rating of 70 or more',
];

const YEAR_BARS = 250;
const MONTH_BARS = 21;

function trendTemplate(b: Bars, rs: number | null, high52: number | null, low52: number | null): boolean[] {
  const last = b.c.length - 1;
  const c = b.c[last];
  const at = (s: number[], i = last) => (i >= 0 ? s[i] : NaN);
  const s50 = at(sma(b.c, 50));
  const s150 = at(sma(b.c, 150));
  const sma200 = sma(b.c, 200);
  const s200 = at(sma200);
  // NaN compares false, so a rule that needs more history than the stock has simply fails
  return [
    c > s150 && c > s200,
    s150 > s200,
    s200 > at(sma200, last - MONTH_BARS),
    s50 > s150 && s50 > s200,
    c > s50,
    low52 != null && c >= low52 * 1.3,
    high52 != null && c >= high52 * 0.75,
    rs != null && rs >= 70,
  ];
}

// The 8 rules on every bar, for the chart. Rule 8 reads b.rs; without it the score tops out at 7.
export function trendTemplateSeries(b: Bars): { score: number[]; checks: number[][] } {
  const n = b.c.length;
  const s50 = sma(b.c, 50);
  const s150 = sma(b.c, 150);
  const s200 = sma(b.c, 200);
  const hi = rollingExtreme(b.h, YEAR_BARS, (a, x) => a >= x);
  const lo = rollingExtreme(b.l, YEAR_BARS, (a, x) => a <= x);
  const checks = TREND_TEMPLATE.map(() => new Array<number>(n).fill(0));
  const score = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = b.c[i];
    const pass = (r: number, ok: boolean) => {
      if (!ok) return;
      checks[r][i] = 1;
      score[i]++;
    };
    pass(0, c > s150[i] && c > s200[i]);
    pass(1, s150[i] > s200[i]);
    pass(2, i >= MONTH_BARS && s200[i] > s200[i - MONTH_BARS]);
    pass(3, s50[i] > s150[i] && s50[i] > s200[i]);
    pass(4, c > s50[i]);
    pass(5, c >= lo[i] * 1.3);
    pass(6, c >= hi[i] * 0.75);
    pass(7, (b.rs?.[i] ?? NaN) >= 70);
  }
  return { score, checks };
}

// Highest (or lowest) of the last n values, today included; fewer while the history is shorter than n.
function rollingExtreme(src: number[], n: number, keep: (a: number, x: number) => boolean): number[] {
  const out = new Array<number>(src.length);
  const q: number[] = []; // indexes, values ordered so q[0] is the extreme
  for (let i = 0; i < src.length; i++) {
    while (q.length && !keep(src[q[q.length - 1]], src[i])) q.pop();
    q.push(i);
    if (q[0] <= i - n) q.shift();
    out[i] = src[q[0]];
  }
  return out;
}

export interface ProfileInput {
  bars: Bars;
  // only company shares that still trade are ranked; the rest get no RS rating
  ranked: boolean;
}

export function buildProfiles(stocks: Map<string, ProfileInput>): Map<string, Profile> {
  const scores = new Map<string, number>();
  for (const [symbol, { bars, ranked }] of stocks) {
    if (!ranked) continue;
    const s = rsScore(bars);
    if (s != null) scores.set(symbol, s);
  }
  const ratings = rsRatings(scores);

  const out = new Map<string, Profile>();
  for (const [symbol, { bars }] of stocks) {
    const n = bars.c.length;
    if (!n) continue;
    const from = Math.max(0, n - YEAR_BARS);
    let high52 = -Infinity;
    let low52 = Infinity;
    for (let i = from; i < n; i++) {
      if (bars.h[i] > high52) high52 = bars.h[i];
      if (bars.l[i] < low52) low52 = bars.l[i];
    }
    const hi = Number.isFinite(high52) ? high52 : null;
    const lo = Number.isFinite(low52) ? low52 : null;
    const rs = ratings.get(symbol) ?? null;
    const stages = stageHistory(bars);
    const stage = stages.at(-1)?.stage ?? null;
    let stageWeeks = 0;
    for (let i = stages.length - 1; i >= 0 && stages[i].stage === stage; i--) stageWeeks++;
    const ttChecks = trendTemplate(bars, rs, hi, lo);
    out.set(symbol, {
      rs,
      rsScore: scores.get(symbol) ?? null,
      stage,
      stageWeeks,
      tt: ttChecks.filter(Boolean).length,
      ttChecks,
      high52: hi,
      low52: lo,
      ret: { m1: returnOver(bars, 30), m3: returnOver(bars, 91), m6: returnOver(bars, 182), y1: returnOver(bars, 365) },
    });
  }
  return out;
}
