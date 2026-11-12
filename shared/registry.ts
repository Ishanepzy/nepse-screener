import type { Bars, Operand } from './types.ts';
import * as ta from './indicators.ts';

export interface ParamDef {
  label: string;
  default: number;
  min: number;
  max: number;
  float?: boolean;
  // words around the input in the UI: `[20] days`, `fast [12]`
  before?: string;
  after?: string;
}

export interface IndicatorDef {
  id: string;
  label: string;
  short: string;
  params: ParamDef[];
  // The first line is the default. `event` lines are 0/1 flags: conditions test them with "happened" and the chart
  // shows them as markers. A `state` event stays on for many bars (holding a breakout), so it gets no markers.
  lines: { key: string; label: string; event?: boolean; state?: boolean }[];
  pane: 'price' | 'volume' | 'osc';
  compute: (b: Bars, p: number[]) => Record<string, ta.Series>;
}

const period = (def: number, label = 'Period', ui: Pick<ParamDef, 'before' | 'after'> = { after: 'days' }): ParamDef => ({
  label,
  default: def,
  min: 1,
  max: 500,
  ...ui,
});
const one = (s: ta.Series) => ({ value: s });
const VALUE = [{ key: 'value', label: 'Value' }];

export const INDICATORS: IndicatorDef[] = [
  { id: 'close', label: 'Close', short: 'Close', params: [], lines: VALUE, pane: 'price', compute: (b) => one(b.c) },
  { id: 'open', label: 'Open', short: 'Open', params: [], lines: VALUE, pane: 'price', compute: (b) => one(b.o) },
  { id: 'high', label: 'High', short: 'High', params: [], lines: VALUE, pane: 'price', compute: (b) => one(b.h) },
  { id: 'low', label: 'Low', short: 'Low', params: [], lines: VALUE, pane: 'price', compute: (b) => one(b.l) },
  {
    id: 'value',
    label: 'Fixed number',
    short: '',
    params: [{ label: 'Value', default: 0, min: -1e12, max: 1e12, float: true }],
    lines: VALUE,
    pane: 'osc',
    compute: (b, [x]) => one(new Array<number>(b.c.length).fill(x)),
  },
  { id: 'ema', label: 'EMA', short: 'EMA', params: [period(20)], lines: VALUE, pane: 'price', compute: (b, [n]) => one(ta.ema(b.c, n)) },
  { id: 'sma', label: 'SMA', short: 'SMA', params: [period(20)], lines: VALUE, pane: 'price', compute: (b, [n]) => one(ta.sma(b.c, n)) },
  { id: 'wma', label: 'WMA', short: 'WMA', params: [period(20)], lines: VALUE, pane: 'price', compute: (b, [n]) => one(ta.wma(b.c, n)) },
  {
    id: 'bb',
    label: 'Bollinger',
    short: 'BB',
    params: [period(20), { label: 'StdDev', default: 2, min: 0.1, max: 10, float: true, before: '×', after: 'std dev' }],
    lines: [
      { key: 'upper', label: 'Upper' },
      { key: 'middle', label: 'Middle' },
      { key: 'lower', label: 'Lower' },
    ],
    pane: 'price',
    compute: (b, [n, k]) => ta.bollinger(b.c, n, k),
  },
  {
    id: 'supertrend',
    label: 'Supertrend',
    short: 'Supertrend',
    params: [period(10, 'ATR period'), { label: 'Factor', default: 3, min: 0.1, max: 20, float: true, before: '×' }],
    lines: VALUE,
    pane: 'price',
    compute: (b, [n, f]) => one(ta.supertrend(b.h, b.l, b.c, n, f).line),
  },
  {
    id: 'hh',
    label: 'Highest high',
    short: 'High',
    params: [period(250, 'Days')],
    lines: VALUE,
    pane: 'price',
    compute: (b, [n]) => one(ta.priorHighest(b.h, n)),
  },
  {
    id: 'll',
    label: 'Lowest low',
    short: 'Low',
    params: [period(250, 'Days')],
    lines: VALUE,
    pane: 'price',
    compute: (b, [n]) => one(ta.priorLowest(b.l, n)),
  },
  {
    id: 'breakout',
    label: 'Breakout',
    short: 'Breakout',
    params: [period(21, 'Days')],
    lines: [
      { key: 'level', label: 'Level' },
      { key: 'start', label: 'Breakout', event: true },
      { key: 'signal', label: 'Follow-through', event: true },
      { key: 'state', label: 'Holding', event: true, state: true },
    ],
    pane: 'price',
    compute: (b, [n]) => {
      const r = ta.breakout(b.h, b.c, n);
      return { level: r.level, start: r.start, signal: r.signal, state: r.state, base: r.base };
    },
  },
  {
    id: 'ratio',
    label: 'Ratio (price ÷ NEPSE)',
    short: 'Price/NEPSE',
    params: [period(50, 'Average', { before: 'avg', after: 'days' }), period(250, 'High', { before: 'high of', after: 'days' })],
    lines: [
      { key: 'value', label: 'Ratio' },
      { key: 'ma', label: 'Average' },
      { key: 'high', label: 'Prior high' },
    ],
    pane: 'osc',
    compute: (b, [n, h]) => {
      // rising = beating the market, whichever way the market itself goes
      const value = b.c.map((c, i) => (b.ix && b.ix[i] > 0 ? c / b.ix[i] : NaN));
      return { value, ma: ta.sma(value, n), high: ta.priorHighest(value, h) };
    },
  },
  { id: 'volume', label: 'Volume', short: 'Volume', params: [], lines: VALUE, pane: 'volume', compute: (b) => one(b.v) },
  {
    id: 'volsma',
    label: 'Avg Volume',
    short: 'Avg Vol',
    params: [period(20)],
    lines: VALUE,
    pane: 'volume',
    compute: (b, [n]) => one(ta.sma(b.v, n)),
  },
  { id: 'rsi', label: 'RSI', short: 'RSI', params: [period(14)], lines: VALUE, pane: 'osc', compute: (b, [n]) => one(ta.rsi(b.c, n)) },
  {
    id: 'macd',
    label: 'MACD',
    short: 'MACD',
    params: [period(12, 'Fast', { before: 'fast' }), period(26, 'Slow', { before: 'slow' }), period(9, 'Signal', { before: 'signal' })],
    lines: [
      { key: 'macd', label: 'Line' },
      { key: 'signal', label: 'Signal' },
      { key: 'hist', label: 'Histogram' },
    ],
    pane: 'osc',
    compute: (b, [f, s, g]) => ta.macd(b.c, f, s, g),
  },
  {
    id: 'stoch',
    label: 'Stochastic',
    short: 'Stoch',
    params: [period(14, '%K length'), period(3, '%K smooth', { before: 'smooth' }), period(3, '%D smooth', { before: '%D' })],
    lines: [
      { key: 'k', label: '%K' },
      { key: 'd', label: '%D' },
    ],
    pane: 'osc',
    compute: (b, [n, k, d]) => ta.stochastic(b.h, b.l, b.c, n, k, d),
  },
  {
    id: 'adx',
    label: 'ADX / DMI',
    short: 'ADX',
    params: [period(14, 'DI length'), period(14, 'ADX smooth', { before: 'smooth' })],
    lines: [
      { key: 'adx', label: 'ADX' },
      { key: 'pdi', label: '+DI' },
      { key: 'mdi', label: '-DI' },
    ],
    pane: 'osc',
    compute: (b, [n, s]) => ta.dmi(b.h, b.l, b.c, n, s),
  },
  {
    id: 'atr',
    label: 'ATR',
    short: 'ATR',
    params: [period(14)],
    lines: VALUE,
    pane: 'osc',
    compute: (b, [n]) => one(ta.atr(b.h, b.l, b.c, n)),
  },
  {
    id: 'roc',
    label: '% Change',
    short: '% Chg',
    params: [period(5, 'Bars')],
    lines: VALUE,
    pane: 'osc',
    compute: (b, [n]) => one(ta.roc(b.c, n)),
  },
];

export const INDICATOR_BY_ID = new Map(INDICATORS.map((d) => [d.id, d]));

export const isStateLine = (op: Operand) => !!INDICATOR_BY_ID.get(op.id)?.lines.find((l) => l.key === (op.line ?? 'value'))?.state;

export const isEventLine = (op: Operand) => !!INDICATOR_BY_ID.get(op.id)?.lines.find((l) => l.key === (op.line ?? 'value'))?.event;

export function getDef(id: string): IndicatorDef {
  const d = INDICATOR_BY_ID.get(id);
  if (!d) throw new Error(`Unknown indicator "${id}"`);
  return d;
}

// fill in defaults and clamp to the allowed range
export function normalizeOperand(op: Operand): Operand {
  const def = getDef(op.id);
  const params = def.params.map((p, i) => {
    const raw = Number(op.params?.[i]);
    if (!Number.isFinite(raw)) return p.default;
    const v = p.float ? raw : Math.round(raw);
    return Math.min(p.max, Math.max(p.min, v));
  });
  const line = def.lines.some((l) => l.key === op.line) ? op.line! : def.lines[0].key;
  return { id: def.id, params, line };
}

// one cache entry per indicator + params, whichever line is read
export const seriesKey = (op: Operand) => `${op.id}(${op.params.join(',')})`;

export function operandLabel(op: Operand): string {
  const def = getDef(op.id);
  if (def.id === 'value') return formatNumber(op.params[0]);
  if (def.id === 'ratio') {
    const [n, h] = op.params;
    if (op.line === 'ma') return `Price/NEPSE ${n}D avg`;
    if (op.line === 'high') return `Price/NEPSE ${h === 250 ? '52W' : `${h}D`} high`;
    return op.line ? 'Price/NEPSE' : `Price/NEPSE (avg ${n}, high ${h})`;
  }
  if (def.id === 'hh' || def.id === 'll') {
    const n = op.params[0];
    const span = n === 250 ? '52W' : `${n}D`;
    return `${span} ${def.id === 'hh' ? 'High' : 'Low'}`;
  }
  const args = op.params.length ? `(${op.params.map(formatNumber).join(',')})` : '';
  const line = def.lines.length > 1 ? ' ' + (def.lines.find((l) => l.key === op.line)?.label ?? '') : '';
  return `${def.short}${args}${line}`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}
