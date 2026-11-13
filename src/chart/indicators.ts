// Indicators on the chart page: the saved list, plus whatever the open scan uses.
import type { Bars, Condition } from '../../shared/types.ts';
import { getDef, normalizeOperand, operandLabel, seriesKey } from '../../shared/registry.ts';
import { isUnary } from '../../shared/screener.ts';
import type { Series } from '../../shared/indicators.ts';
import { load, save } from '../storage.ts';

export interface ChartIndicator {
  uid: string;
  id: string;
  params: number[];
  // palette slot, kept for life so colours don't shuffle when another indicator is removed
  slot: number;
}

export const CHARTABLE: { group: string; ids: string[] }[] = [
  { group: 'Moving averages', ids: ['ema', 'sma', 'wma', 'ttma'] },
  { group: 'Strength (own panel)', ids: ['ratio'] },
  { group: 'Trend & bands', ids: ['bb', 'supertrend', 'hh', 'll'] },
  { group: 'Volume', ids: ['volsma'] },
  { group: 'Oscillators (own panel)', ids: ['rsi', 'macd', 'stoch', 'adx', 'atr', 'roc'] },
];
// tt has no chip of its own (it comes with ttma) but can still be on a chart and in the saved list
const CHARTABLE_IDS = new Set([...CHARTABLE.flatMap((g) => g.ids), 'tt']);

export const GUIDES: Record<string, number[]> = { rsi: [70, 30], stoch: [80, 20], adx: [25], macd: [0], roc: [0], tt: [8] };

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

// The trend template comes as a pair: its five averages on the price, and the rules panel under it. Adding either
// brings the other, unless it is already there.
const COMES_WITH: Record<string, string> = { ttma: 'tt', tt: 'ttma' };

export function addIndicator(list: ChartIndicator[], id: string, params?: number[], dedupe = true): ChartIndicator[] {
  const def = getDef(id);
  const p = params ?? def.params.map((x) => x.default);
  if (dedupe && list.some((i) => sameIndicator(i, { id, params: p }))) return list;
  let out = [...list, { uid: uid(), id, params: p, slot: freeSlot(list) }];
  const partner = COMES_WITH[id];
  if (partner && !out.some((i) => i.id === partner)) out = addIndicator(out, partner);
  return out;
}

// what the screener's "meets the trend template" filter adds to a chart opened from it
export const withTrendTemplate = (list: ChartIndicator[]) => (list.some((i) => i.id === 'ttma') ? list : addIndicator(list, 'ttma'));

export function defaultIndicators(): ChartIndicator[] {
  return DEFAULTS.reduce<ChartIndicator[]>((acc, d) => addIndicator(acc, d.id, d.params), []);
}

export function loadIndicators(): ChartIndicator[] {
  const list = load(KEY);
  if (!Array.isArray(list)) return defaultIndicators();
  return (list as ChartIndicator[]).filter((i) => i && CHARTABLE_IDS.has(i.id) && Array.isArray(i.params));
}

export function saveIndicators(list: ChartIndicator[]) {
  save(KEY, list);
}

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
