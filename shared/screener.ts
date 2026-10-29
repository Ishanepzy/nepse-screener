import type { Bars, Condition, ConditionHit, Operand } from './types.ts';
import type { Series } from './indicators.ts';
import { getDef, normalizeOperand, seriesKey } from './registry.ts';

/** Per-symbol memo of computed indicators, keyed by seriesKey. Valid until the symbol's bars change. */
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
export const isUnary = (op: Condition['op']) => op === 'rising' || op === 'falling';

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

/** Evaluates one (normalized) condition on the latest bar of `bars`. */
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

  // NaN compares false everywhere below, so bars without enough history never pass.
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
  }
  return hit;
}

/** Every bar index where a cross condition fired, oldest first (for chart markers). */
export function crossIndices(bars: Bars, c: Condition, cache: SeriesCache): number[] {
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
