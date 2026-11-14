import type { Bars, Condition, ConditionHit, Operand } from './types.ts';
import type { Series } from './indicators.ts';
import { getDef, normalizeOperand, seriesKey } from './registry.ts';

// computed indicators for one symbol, keyed by seriesKey
export type SeriesCache = Map<string, Record<string, Series>>;

export function getLine(bars: Bars, op: Operand, cache: SeriesCache): Series {
  const key = seriesKey(op);
  let lines = cache.get(key);
  if (!lines) {
    lines = getDef(op.id).compute(bars, op.params);
    cache.set(key, lines);
  }
  return lines[op.line ?? 'value'];
}

export const isCross = (op: Condition['op']) => op === 'crossAbove' || op === 'crossBelow';
export const isEvent = (op: Condition['op']) => op === 'fired';
export const isUnary = (op: Condition['op']) => op === 'rising' || op === 'falling' || op === 'fired';
// ops that report when something happened rather than a value
export const hasWhen = (op: Condition['op']) => isCross(op) || isEvent(op);

export function normalizeCondition(c: Condition): Condition {
  const factor = Number(c.factor);
  const within = Math.round(Number(c.within));
  return {
    left: normalizeOperand(c.left),
    op: c.op,
    right: normalizeOperand(c.right ?? { id: 'value', params: [0] }),
    factor: Number.isFinite(factor) && factor !== 0 ? factor : 1,
    within: Number.isFinite(within) ? Math.min(250, Math.max(1, within)) : 1,
    holds: c.holds !== false,
  };
}

const finite = (x: number) => (Number.isFinite(x) ? x : null);

export function evaluate(bars: Bars, c: Condition, cache: SeriesCache): ConditionHit {
  const last = bars.c.length - 1;
  const L = getLine(bars, c.left, cache);
  const Rs = getLine(bars, c.right, cache);
  const f = c.factor ?? 1;
  const R = (i: number) => Rs[i] * f;
  const n = c.within ?? 1;
  const unary = isUnary(c.op);
  const hit: ConditionHit = { pass: false, left: finite(L[last]), right: unary ? null : finite(R(last)) };
  if (last < 1) return hit;

  // NaN compares false, so bars without enough history never pass
  const gt = (i: number) => L[i] > R(i);
  const lt = (i: number) => L[i] < R(i);
  const forLast = (test: (i: number) => boolean) => {
    if (last - n + 1 < 1) return false;
    for (let i = last; i > last - n; i--) if (!test(i)) return false;
    return true;
  };

  switch (c.op) {
    case 'crossAbove':
    case 'crossBelow': {
      const up = c.op === 'crossAbove';
      for (let k = 0; k < n && last - k >= 1; k++) {
        const i = last - k;
        const crossed = up ? gt(i) && L[i - 1] <= R(i - 1) : lt(i) && L[i - 1] >= R(i - 1);
        if (crossed) {
          hit.barsAgo = k;
          hit.date = bars.t[i];
          break;
        }
      }
      hit.pass = hit.barsAgo !== undefined && (c.holds === false || (up ? gt(last) : lt(last)));
      break;
    }
    case 'above':
      hit.pass = forLast(gt);
      break;
    case 'below':
      hit.pass = forLast(lt);
      break;
    case 'rising':
      hit.pass = forLast((i) => L[i] > L[i - 1]);
      break;
    case 'falling':
      hit.pass = forLast((i) => L[i] < L[i - 1]);
      break;
    case 'fired':
      for (let k = 0; k < n && last - k >= 0; k++) {
        if (L[last - k] > 0) {
          hit.barsAgo = k;
          hit.date = bars.t[last - k];
          break;
        }
      }
      hit.pass = hit.barsAgo !== undefined;
      break;
  }
  return hit;
}

// every bar where the condition fired, oldest first (chart markers)
export function crossIndices(bars: Bars, c: Condition, cache: SeriesCache): number[] {
  if (isEvent(c.op)) {
    // rising edges only, so a state that lasts many bars is marked where it began
    const L = getLine(bars, c.left, cache);
    const out: number[] = [];
    for (let i = 0; i < L.length; i++) if (L[i] > 0 && !(i > 0 && L[i - 1] > 0)) out.push(i);
    return out;
  }
  if (!isCross(c.op)) return [];
  const L = getLine(bars, c.left, cache);
  const Rs = getLine(bars, c.right, cache);
  const f = c.factor ?? 1;
  const out: number[] = [];
  for (let i = 1; i < L.length; i++) {
    const r0 = Rs[i - 1] * f;
    const r1 = Rs[i] * f;
    if (c.op === 'crossAbove' ? L[i] > r1 && L[i - 1] <= r0 : L[i] < r1 && L[i - 1] >= r0) out.push(i);
  }
  return out;
}

export function screenSymbol(bars: Bars, conditions: Condition[], match: 'all' | 'any', cache: SeriesCache) {
  const hits = conditions.map((c) => evaluate(bars, c, cache));
  const pass = conditions.length > 0 && (match === 'all' ? hits.every((h) => h.pass) : hits.some((h) => h.pass));
  return { pass, hits };
}

// evaluate() for every bar at once: out[i] = 1 where it would pass if bar i were the last. For backtests, which
// need the signal as it stood each day.
export function conditionSeries(bars: Bars, c: Condition, cache: SeriesCache): Uint8Array {
  const len = bars.c.length;
  const out = new Uint8Array(len);
  const L = getLine(bars, c.left, cache);
  const Rs = getLine(bars, c.right, cache);
  const f = c.factor ?? 1;
  const R = (i: number) => Rs[i] * f;
  const n = c.within ?? 1;
  const gt = (i: number) => L[i] > R(i);
  const lt = (i: number) => L[i] < R(i);
  // ok(i) true for n bars in a row, ending at i, none of them bar 0
  const runs = (ok: (i: number) => boolean) => {
    let run = 0;
    for (let i = 1; i < len; i++) {
      run = ok(i) ? run + 1 : 0;
      if (run >= n) out[i] = 1;
    }
  };
  // the latest bar, at or before i and within n of it, where `at` holds; -1 if none
  const lastWithin = (at: (i: number) => boolean, first: number) => {
    let seen = -Infinity;
    for (let i = first; i < len; i++) {
      if (at(i)) seen = i;
      if (i - seen < n) out[i] = 1;
    }
  };
  switch (c.op) {
    case 'crossAbove':
    case 'crossBelow': {
      const up = c.op === 'crossAbove';
      lastWithin((i) => (up ? gt(i) && L[i - 1] <= R(i - 1) : lt(i) && L[i - 1] >= R(i - 1)), 1);
      // and still on the right side on the bar itself, unless that isn't asked
      if (c.holds !== false) for (let i = 0; i < len; i++) if (out[i] && !(up ? gt(i) : lt(i))) out[i] = 0;
      break;
    }
    case 'above':
      runs(gt);
      break;
    case 'below':
      runs(lt);
      break;
    case 'rising':
      runs((i) => L[i] > L[i - 1]);
      break;
    case 'falling':
      runs((i) => L[i] < L[i - 1]);
      break;
    case 'fired':
      lastWithin((i) => L[i] > 0, 0);
      // evaluate() needs two bars before it says anything
      out[0] = 0;
      break;
  }
  return out;
}

// all (or any) of the conditions on each bar; nothing at all without conditions
export function signalSeries(bars: Bars, conditions: Condition[], match: 'all' | 'any', cache: SeriesCache): Uint8Array {
  const out = new Uint8Array(bars.c.length);
  if (!conditions.length) return out;
  const each = conditions.map((c) => conditionSeries(bars, c, cache));
  for (let i = 0; i < out.length; i++) out[i] = (match === 'all' ? each.every((s) => s[i]) : each.some((s) => s[i])) ? 1 : 0;
  return out;
}
