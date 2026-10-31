// The indicators drawn on the chart page: a user-editable list, remembered in the browser. When a chart is opened
// from a scan, the scan's own indicators are added to it so the signal is visible straight away.
import type { Bars, Condition } from '../../shared/types.ts';
import { getDef, normalizeOperand, operandLabel, seriesKey } from '../../shared/registry.ts';
import { isUnary } from '../../shared/screener.ts';
import type { Series } from '../../shared/indicators.ts';

export interface ChartIndicator {
  uid: string;
  id: string;
  params: number[];
  /** Palette slot, fixed when added so an indicator keeps its colour when others are removed. */
  slot: number;
}

/** Things that make sense as a chart overlay or pane (plain prices and fixed numbers don't). */
export const CHARTABLE: { group: string; ids: string[] }[] = [
  { group: 'Moving averages', ids: ['ema', 'sma', 'wma'] },
  { group: 'Trend & bands', ids: ['bb', 'supertrend', 'hh', 'll'] },
  { group: 'Volume', ids: ['volsma'] },
  { group: 'Oscillators (own panel)', ids: ['rsi', 'macd', 'stoch', 'adx', 'atr', 'roc'] },
];
const CHARTABLE_IDS = new Set(CHARTABLE.flatMap((g) => g.ids));

/** Guide lines drawn in an oscillator's panel. */
export const GUIDES: Record<string, number[]> = { rsi: [70, 30], stoch: [80, 20], adx: [25], macd: [0], roc: [0] };

const KEY = 'nepse.chart.indicators.v1';
const DEFAULTS: Omit<ChartIndicator, 'uid' | 'slot'>[] = [
  { id: 'ema', params: [20] },
  { id: 'ema', params: [50] },
];

let counter = 0;
const uid = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`;

export const sameIndicator = (a: { id: string; params: number[] }, b: { id: string; params: number[] }) =>
  a.id === b.id && a.params.length === b.params.length && a.params.every((p, i) => p === b.params[i]);

export const indicatorKey = (ind: { id: string; params: number[] }) => seriesKey({ id: ind.id, params: ind.params });

export function indicatorLabel(ind: { id: string; params: number[] }): string {
  return operandLabel({ id: ind.id, params: ind.params }).trim();
}

function freeSlot(list: ChartIndicator[]): number {
  const used = new Set(list.map((i) => i.slot));
  for (let s = 0; s < 8; s++) if (!used.has(s)) return s;
  return list.length % 8;
}

/** Adds an indicator with default params unless given. `dedupe` skips it when an identical one is already there. */
export function addIndicator(list: ChartIndicator[], id: string, params?: number[], dedupe = true): ChartIndicator[] {
  const def = getDef(id);
  const p = params ?? def.params.map((x) => x.default);
  if (dedupe && list.some((i) => sameIndicator(i, { id, params: p }))) return list;
  return [...list, { uid: uid(), id, params: p, slot: freeSlot(list) }];
}

export function defaultIndicators(): ChartIndicator[] {
  return DEFAULTS.reduce<ChartIndicator[]>((acc, d) => addIndicator(acc, d.id, d.params), []);
}

export function loadIndicators(): ChartIndicator[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const list = JSON.parse(raw) as ChartIndicator[];
      if (Array.isArray(list)) return list.filter((i) => CHARTABLE_IDS.has(i.id) && Array.isArray(i.params));
    }
  } catch {
    /* storage blocked or corrupt: fall back to defaults */
  }
  return defaultIndicators();
}

export function saveIndicators(list: ChartIndicator[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* convenience only */
  }
}

/** Adds every indicator a scan's conditions refer to (e.g. EMA 9 and EMA 21 for a 9/21 cross). */
export function withScanIndicators(list: ChartIndicator[], conditions: Condition[]): ChartIndicator[] {
  let out = list;
  for (const c of conditions) {
    for (const op of isUnary(c.op) ? [c.left] : [c.left, c.right]) {
      if (!CHARTABLE_IDS.has(op.id)) continue;
      const n = normalizeOperand(op);
      out = addIndicator(out, n.id, n.params);
    }
  }
  return out;
}

export function computeIndicator(bars: Bars, ind: ChartIndicator): Record<string, Series> {
  return getDef(ind.id).compute(bars, ind.params);
}
