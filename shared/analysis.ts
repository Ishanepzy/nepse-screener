// Whole-market reads of each stock: Weinstein stage, relative-strength (RS) rating, Minervini's trend template,
// and recent returns. Computed once per dataset for the latest bar, since the RS rating ranks every stock
// against the rest.
import type { Bars } from './types.ts';
import { sma } from './indicators.ts';

export type Stage = 1 | 2 | 3 | 4;

export interface StagePoint {
  /** Last trade date of the week. */
  date: string;
  stage: Stage;
}

export interface Profile {
  /** RS rating 1–99 among company shares (99 = stronger than 99% of them). Null for funds/debentures or short history. */
  rs: number | null;
  /** Weighted 3/6/9/12-month return (%) the rating ranks. */
  rsScore: number | null;
  stage: Stage | null;
  /** How many weeks in a row the stock has been in `stage` (this week included). */
  stageWeeks: number;
  /** Trend template rules met (0–8); `ttChecks` holds each rule's result in TREND_TEMPLATE order. */
  tt: number;
  ttChecks: boolean[];
  /** Highest high / lowest low of the last 52 weeks (today included). */
  high52: number | null;
  low52: number | null;
  /** % returns over 1, 3, 6 and 12 months. */
  ret: { m1: number | null; m3: number | null; m6: number | null; y1: number | null };
}

// ---- weeks ----

const DAY = 86_400_000;
/** Weeks run Sunday to Saturday, which holds both NEPSE calendars (Sun–Thu before April 2026, Mon–Fri since). */
const weekOf = (date: string) => Math.floor((Date.parse(date) / DAY - 3) / 7); // 1970-01-04 was a Sunday

/** Weekly closes: the last daily close of each week, with the date of that bar. The latest week may be partial. */
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

// ---- Weinstein stage ----

/** Weinstein's 30-week moving average. */
export const STAGE_MA_WEEKS = 30;
/** The average's slope is measured over this many weeks... */
export const STAGE_SLOPE_WEEKS = 4;
/** ...and counts as flat when it moved less than this many percent. */
export const STAGE_FLAT_PCT = 0.5;

/**
 * Stage of every week, from the 30-week average of weekly closes and its 4-week slope:
 *  - Stage 2 (advancing): close above a rising average.
 *  - Stage 4 (declining): close below a falling average.
 *  - Otherwise the average is flat, or price is on the wrong side of it: Stage 3 (topping) if the last trend was
 *    up, Stage 1 (basing) if it was down. Before any trend is seen, the average's direction over 13 weeks decides.
 * Weeks before the average and its slope exist get no stage.
 */
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

// ---- returns and RS ----

/** Close of the last bar on or before `date`, or NaN if history doesn't reach back that far. */
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

/** % return over the last `days` calendar days. */
function returnOver(b: Bars, days: number): number | null {
  const last = b.c.length - 1;
  const then = closeOnOrBefore(b, Date.parse(b.t[last]) - days * DAY);
  return then > 0 ? (b.c[last] / then - 1) * 100 : null;
}

/** IBD-style weighting: the latest quarter counts double. */
const RS_WEIGHTS: [days: number, weight: number][] = [
  [91, 0.4],
  [182, 0.2],
  [273, 0.2],
  [365, 0.2],
];

/** Weighted return used for the RS rating. Needs at least 3 months of history; shorter spans are re-weighted. */
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

/** Percentile rank 1–99 of each score among all of them (ties share a rank). */
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

// ---- trend template ----

/** Mark Minervini's trend template, in the order `Profile.ttChecks` reports them. */
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
  // NaN compares false, so a stock without enough history fails the rules it can't be judged on.
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

// ---- all together ----

export interface ProfileInput {
  bars: Bars;
  /** Ranked for RS: company shares that are still trading. Others get a profile without a rating. */
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
