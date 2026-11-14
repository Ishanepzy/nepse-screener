// Chart drawings, saved per symbol in localStorage. A point is a trade date plus a bar offset rather than a bar
// index, because the data window moves forward every day and drops its oldest bars.

import { load, save } from '../storage.ts';

export type DrawingType =
  | 'line'
  | 'info'
  | 'arrow'
  | 'cross'
  | 'pitchfork'
  | 'fibtz'
  | 'circle'
  | 'triangle'
  | 'path'
  | 'curve'
  | 'dcurve'
  | 'arc'
  | 'callout'
  | 'pricelabel'
  | 'markup'
  | 'markdown'
  | 'hline'
  | 'vline'
  | 'channel'
  | 'fib'
  | 'fibext'
  | 'rect'
  | 'ellipse'
  | 'brush'
  | 'measure'
  | 'long'
  | 'short'
  | 'text';

export interface Anchor {
  // trade date of the nearest bar
  d: string;
  // bars from that date: fractional, and past the last bar for points in the future
  o: number;
  p: number;
}

export type ColorKey = 'blue' | 'orange' | 'green' | 'amber' | 'pink' | 'indigo' | 'red' | 'forest' | 'ink' | 'grey';
export type Dash = 'solid' | 'dashed' | 'dotted';

export interface Style {
  color: ColorKey;
  // 1 to 4 px
  width: number;
  dash: Dash;
  fill: boolean;
  // carry the line on past its first / second point
  ext: [boolean, boolean];
  // text size in px
  size: number;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  // 'price', or the key of the indicator panel it was drawn on (a vertical line crosses every panel)
  pane: string;
  pts: Anchor[];
  // only what differs from the type's defaults
  style: Partial<Style>;
  text?: string;
  locked?: boolean;
}

export type ToolId =
  | 'trend'
  | 'info'
  | 'cross'
  | 'pitchfork'
  | 'fibtz'
  | 'circle'
  | 'triangle'
  | 'path'
  | 'curve'
  | 'dcurve'
  | 'arc'
  | 'callout'
  | 'pricelabel'
  | 'markup'
  | 'markdown'
  | 'ray'
  | 'extended'
  | 'arrow'
  | 'hline'
  | 'hray'
  | 'vline'
  | 'channel'
  | 'fib'
  | 'fibext'
  | 'rect'
  | 'ellipse'
  | 'brush'
  | 'measure'
  | 'long'
  | 'short'
  | 'text';

export interface Tool {
  id: ToolId;
  type: DrawingType;
  label: string;
  help: string;
  // clicks to place it; 0 = press and drag (brush), -1 = until a double-click or Enter (path)
  points: number;
  style?: Partial<Style>;
  // keyboard shortcut, e.g. 'Alt+T'
  key?: string;
}

export const TOOLS: Tool[] = [
  { id: 'trend', type: 'line', label: 'Trend line', help: 'Click two points', points: 2, key: 'Alt+T' },
  { id: 'ray', type: 'line', label: 'Ray', help: 'Click where it starts, then a point it passes through. It carries on to the right.', points: 2, style: { ext: [false, true] } },
  { id: 'extended', type: 'line', label: 'Extended line', help: 'Click two points. The line carries on past both.', points: 2, style: { ext: [true, true] } },
  { id: 'info', type: 'info', label: 'Info line', help: 'A trend line that shows the price change, the % change and the bars between its ends', points: 2 },
  { id: 'arrow', type: 'arrow', label: 'Arrow', help: 'Click where it starts, then where it points', points: 2 },
  { id: 'hline', type: 'hline', label: 'Horizontal line', help: 'Click once at a price, e.g. support or resistance', points: 1, key: 'Alt+H' },
  { id: 'hray', type: 'hline', label: 'Horizontal ray', help: 'Click once. The line runs right from there.', points: 1, style: { ext: [false, true] }, key: 'Alt+J' },
  { id: 'vline', type: 'vline', label: 'Vertical line', help: 'Click once on a date. The line crosses every panel.', points: 1, key: 'Alt+V' },
  { id: 'cross', type: 'cross', label: 'Cross line', help: 'Click once: a horizontal and a vertical line through that point', points: 1, key: 'Alt+C' },
  { id: 'channel', type: 'channel', label: 'Parallel channel', help: 'Click two points for the first line, then a third to set the width', points: 3 },
  { id: 'pitchfork', type: 'pitchfork', label: 'Pitchfork', help: "Andrews' pitchfork: click the pivot, then the high and the low of the swing after it (or the low and the high)", points: 3 },
  { id: 'fib', type: 'fib', label: 'Fib retracement', help: 'Click a swing low, then a swing high (or the other way round)', points: 2, key: 'Alt+F' },
  { id: 'fibext', type: 'fibext', label: 'Fib extension', help: 'Click where the move started, where it ended, and where the pullback stopped', points: 3 },
  { id: 'fibtz', type: 'fibtz', label: 'Fib time zones', help: 'Click a start date, then the width of one zone. Lines fall 1, 2, 3, 5, 8, 13… zones on.', points: 2 },
  { id: 'rect', type: 'rect', label: 'Rectangle', help: 'Click two opposite corners', points: 2, key: 'Alt+Shift+R' },
  { id: 'circle', type: 'circle', label: 'Circle', help: 'Click the centre, then a point on the edge', points: 2 },
  { id: 'ellipse', type: 'ellipse', label: 'Ellipse', help: 'Click two opposite corners of the box around it', points: 2 },
  { id: 'triangle', type: 'triangle', label: 'Triangle', help: 'Click its three corners', points: 3 },
  { id: 'curve', type: 'curve', label: 'Curve', help: 'Click where it starts, the point it bends through, and where it ends', points: 3 },
  { id: 'dcurve', type: 'dcurve', label: 'Double curve', help: 'An S-curve: click where it starts, its two bends, and where it ends', points: 4 },
  { id: 'arc', type: 'arc', label: 'Arc', help: 'A piece of a circle: click where it starts, a point on it, and where it ends', points: 3 },
  { id: 'path', type: 'path', label: 'Path', help: 'Click each point. Double-click or press Enter to finish; Backspace takes the last point back.', points: -1 },
  { id: 'brush', type: 'brush', label: 'Brush', help: 'Press and drag to draw freehand', points: 0 },
  { id: 'measure', type: 'measure', label: 'Measure', help: 'Click two points to see the price change, the % change and how many days apart they are', points: 2 },
  { id: 'long', type: 'long', label: 'Long position', help: 'Click at your entry. Drag the top edge to your target and the bottom edge to your stop.', points: 1 },
  { id: 'short', type: 'short', label: 'Short position', help: 'Click at your entry. Drag the bottom edge to your target and the top edge to your stop.', points: 1 },
  { id: 'text', type: 'text', label: 'Text', help: 'Click where the text goes, then type', points: 1 },
  { id: 'callout', type: 'callout', label: 'Callout', help: 'Click what it points at, then where the box goes, then type', points: 2 },
  { id: 'pricelabel', type: 'pricelabel', label: 'Price label', help: 'Click a point to tag it with its price', points: 1 },
  { id: 'markup', type: 'markup', label: 'Arrow mark up', help: 'Click to mark a bar, e.g. a buy', points: 1 },
  { id: 'markdown', type: 'markdown', label: 'Arrow mark down', help: 'Click to mark a bar, e.g. a sell', points: 1 },
];

export const toolById = (id: ToolId | null) => (id ? TOOLS.find((t) => t.id === id) ?? null : null);

export const TOOL_GROUPS: { id: string; label: string; tools: ToolId[] }[] = [
  { id: 'lines', label: 'Lines', tools: ['trend', 'ray', 'extended', 'info', 'arrow', 'hline', 'hray', 'vline', 'cross', 'channel', 'pitchfork'] },
  { id: 'fib', label: 'Fibonacci', tools: ['fib', 'fibext', 'fibtz'] },
  { id: 'shapes', label: 'Shapes and curves', tools: ['rect', 'circle', 'ellipse', 'triangle', 'curve', 'dcurve', 'arc', 'path', 'brush'] },
  { id: 'measure', label: 'Measure and positions', tools: ['measure', 'long', 'short'] },
  { id: 'notes', label: 'Text and marks', tools: ['text', 'callout', 'pricelabel', 'markup', 'markdown'] },
];

// the chart's own palette, light and dark
export const COLORS: Record<Exclude<ColorKey, 'ink' | 'grey'>, [string, string]> = {
  blue: ['#2a78d6', '#3987e5'],
  orange: ['#eb6834', '#d95926'],
  green: ['#1baf7a', '#199e70'],
  amber: ['#eda100', '#c98500'],
  pink: ['#e87ba4', '#d55181'],
  indigo: ['#4a3aa7', '#9085e9'],
  red: ['#e34948', '#e66767'],
  forest: ['#008300', '#008300'],
};
export const COLOR_KEYS: ColorKey[] = ['blue', 'orange', 'green', 'amber', 'pink', 'indigo', 'red', 'forest', 'ink', 'grey'];

export function colorValue(k: ColorKey, theme: 'light' | 'dark'): string {
  if (k === 'ink') return 'var(--text)';
  if (k === 'grey') return 'var(--muted)';
  return (COLORS[k] ?? COLORS.blue)[theme === 'dark' ? 1 : 0];
}

const BASE: Style = { color: 'blue', width: 2, dash: 'solid', fill: false, ext: [false, false], size: 14 };
const TYPE_STYLE: Partial<Record<DrawingType, Partial<Style>>> = {
  // full width; the horizontal ray tool turns the left side off
  hline: { ext: [true, true] },
  fib: { color: 'orange', width: 1, fill: true },
  fibext: { color: 'orange', width: 1, fill: true },
  rect: { width: 1, fill: true },
  ellipse: { width: 1, fill: true },
  circle: { width: 1, fill: true },
  triangle: { width: 1, fill: true },
  pitchfork: { width: 1, fill: true },
  fibtz: { color: 'orange', width: 1 },
  callout: { width: 1 },
  markup: { color: 'green' },
  markdown: { color: 'red' },
  channel: { fill: true },
  measure: { width: 1 },
  long: { width: 1 },
  short: { width: 1 },
  text: { color: 'ink' },
};

export const styleOf = (d: Pick<Drawing, 'type' | 'style'>): Style => ({ ...BASE, ...TYPE_STYLE[d.type], ...d.style });

// what each type lets you change
const NO_COLOR = new Set<DrawingType>(['measure', 'long', 'short']);
const NO_WIDTH = new Set<DrawingType>(['text', 'measure', 'long', 'short', 'pricelabel', 'markup', 'markdown']);
const NO_DASH = new Set<DrawingType>([...NO_WIDTH, 'brush', 'callout']);
const FILLS = new Set<DrawingType>(['rect', 'ellipse', 'circle', 'triangle', 'channel', 'pitchfork', 'fib', 'fibext']);
const LINE_LIKE = new Set<DrawingType>(['line', 'info', 'arrow', 'channel']);

export function styleOptions(type: DrawingType) {
  return {
    color: !NO_COLOR.has(type),
    width: !NO_WIDTH.has(type),
    dash: !NO_DASH.has(type),
    fill: FILLS.has(type),
    // horizontal lines only carry on to the left / right; fibs extend their levels to the right
    extLeft: LINE_LIKE.has(type) || type === 'hline',
    extRight: LINE_LIKE.has(type) || type === 'hline' || type === 'fib' || type === 'fibext',
    size: type === 'text' || type === 'callout',
  };
}

// ---------- storage ----------

export const DRAWINGS_KEY = 'nepse.drawings.v2';
const OLD_KEY = 'nepse.drawings.v1';
const DEFAULTS_KEY = 'nepse.drawings.defaults';

const TYPES = new Set<string>(['info', 'cross', 'pitchfork', 'fibtz', 'circle', 'triangle', 'path', 'curve', 'dcurve', 'arc', 'callout', 'pricelabel', 'markup', 'markdown', 'line', 'arrow', 'hline', 'vline', 'channel', 'fib', 'fibext', 'rect', 'ellipse', 'brush', 'measure', 'long', 'short', 'text']);
const POINTS: Record<DrawingType, [number, number]> = {
  line: [2, 2],
  info: [2, 2],
  cross: [1, 1],
  pitchfork: [3, 3],
  fibtz: [2, 2],
  circle: [2, 2],
  triangle: [3, 3],
  path: [2, 1000],
  curve: [3, 3],
  dcurve: [4, 4],
  arc: [3, 3],
  callout: [2, 2],
  pricelabel: [1, 1],
  markup: [1, 1],
  markdown: [1, 1],
  arrow: [2, 2],
  hline: [1, 1],
  vline: [1, 1],
  channel: [3, 3],
  fib: [2, 2],
  fibext: [3, 3],
  rect: [2, 2],
  ellipse: [2, 2],
  brush: [2, 5000],
  measure: [2, 2],
  long: [3, 3],
  short: [3, 3],
  text: [1, 1],
};

const isAnchor = (a: unknown): a is Anchor =>
  !!a && typeof a === 'object' && typeof (a as Anchor).d === 'string' && Number.isFinite((a as Anchor).o) && Number.isFinite((a as Anchor).p);

// drops anything malformed rather than letting one bad entry break the chart
export function cleanDrawings(list: unknown): Drawing[] {
  if (!Array.isArray(list)) return [];
  return list.filter((d): d is Drawing => {
    if (!d || typeof d !== 'object' || typeof d.id !== 'string' || !TYPES.has(d.type) || typeof d.pane !== 'string') return false;
    if (!Array.isArray(d.pts) || !d.pts.every(isAnchor)) return false;
    const [min, max] = POINTS[d.type as DrawingType];
    return d.pts.length >= min && d.pts.length <= max && (!d.style || typeof d.style === 'object');
  });
}

// the first version: price panel only, six types, points as a / b
export function migrateV1(old: Record<string, unknown>): Record<string, Drawing[]> {
  const out: Record<string, Drawing[]> = {};
  for (const [symbol, list] of Object.entries(old)) {
    if (!Array.isArray(list)) continue;
    const next = list.flatMap((x): Drawing[] => {
      if (!x || typeof x !== 'object' || !isAnchor(x.a) || (x.b != null && !isAnchor(x.b))) return [];
      const pts = x.b ? [x.a, x.b] : [x.a];
      const base = { id: String(x.id), pane: 'price', pts, style: {} };
      switch (x.type) {
        case 'trend':
          return [{ ...base, type: 'line' }];
        case 'ray':
          return [{ ...base, type: 'line', style: { ext: [false, true] } }];
        case 'hline':
        case 'rect':
        case 'fib':
        case 'measure':
          return [{ ...base, type: x.type }];
        default:
          return [];
      }
    });
    const clean = cleanDrawings(next);
    if (clean.length) out[symbol] = clean;
  }
  return out;
}

function readAll(): Record<string, Drawing[]> {
  let v = load(DRAWINGS_KEY);
  if (v == null) {
    const old = load(OLD_KEY);
    if (old && typeof old === 'object' && !Array.isArray(old)) {
      v = migrateV1(old as Record<string, unknown>);
      save(DRAWINGS_KEY, v);
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Drawing[]>) : {};
}

export function loadDrawings(symbol: string): Drawing[] {
  return cleanDrawings(readAll()[symbol]);
}

export function saveDrawings(symbol: string, list: Drawing[]): boolean {
  const all = readAll();
  if (list.length) all[symbol] = list;
  else delete all[symbol];
  return save(DRAWINGS_KEY, all);
}

// The last style picked for each type, used for the next one drawn. Extension isn't kept: it is what makes a
// ray a ray, so it comes from the tool.
export function loadStyleDefaults(): Partial<Record<DrawingType, Partial<Style>>> {
  const v = load(DEFAULTS_KEY);
  return v && typeof v === 'object' ? (v as Partial<Record<DrawingType, Partial<Style>>>) : {};
}
export function saveStyleDefault(type: DrawingType, style: Partial<Style>) {
  const all = loadStyleDefaults();
  const { ext: _ext, ...rest } = style;
  all[type] = { ...all[type], ...rest };
  save(DEFAULTS_KEY, all);
}

let counter = 0;
export const newId = () => `d${Date.now().toString(36)}${(counter++).toString(36)}`;

// ---------- dates and bars ----------

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
// NEPSE traded Sunday to Thursday until 5 April 2026 and Monday to Friday since. Public holidays aren't known, so
// dates past the data are a best guess.
const MON_FRI_FROM = Date.parse('2026-04-06T00:00:00Z');
const isSession = (t: number) => {
  const w = new Date(t).getUTCDay();
  return t >= MON_FRI_FROM ? w !== 0 && w !== 6 : w !== 5 && w !== 6;
};

// the date n sessions after `date` (before it, for negative n)
export function addSessions(date: string, n: number): string {
  let t = parse(date);
  if (Number.isNaN(t)) return date;
  const step = n < 0 ? -DAY : DAY;
  for (let left = Math.abs(Math.round(n)); left > 0; ) {
    t += step;
    if (isSession(t)) left--;
  }
  return iso(t);
}

// sessions after `a` up to and including `b`; 0 when b is not later
export function sessionsBetween(a: string, b: string): number {
  let t = parse(a);
  const end = parse(b);
  if (Number.isNaN(t) || Number.isNaN(end)) return 0;
  let n = 0;
  while (t < end) {
    t += DAY;
    if (isSession(t)) n++;
  }
  return n;
}

// six significant digits: enough for a share price, and for a ratio panel that lives around 0.3
export const roundPrice = (p: number) => Number(p.toPrecision(6));

export class Anchors {
  private index: Map<string, number>;
  private dates: string[];

  constructor(dates: string[]) {
    this.dates = dates;
    this.index = new Map(dates.map((d, i) => [d, i]));
  }

  // position on the time axis in bars; null only without data
  toLogical(a: Anchor): number | null {
    const i = this.index.get(a.d);
    if (i != null) return i + a.o;
    const n = this.dates.length;
    if (!n || Number.isNaN(parse(a.d))) return null;
    const last = this.dates[n - 1];
    if (a.d > last) return n - 1 + sessionsBetween(last, a.d) + a.o;
    if (a.d < this.dates[0]) return -sessionsBetween(a.d, this.dates[0]) + a.o;
    // a day this stock didn't trade: the next day it did
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.dates[m] < a.d) lo = m + 1;
      else hi = m;
    }
    return lo + a.o;
  }

  fromLogical(L: number, p: number): Anchor {
    const i = Math.min(this.dates.length - 1, Math.max(0, Math.round(L)));
    return { d: this.dates[i], o: Math.round((L - i) * 100) / 100, p: roundPrice(p) };
  }

  // the date at bar L; past either end of the data, counted on in sessions
  dateAt(L: number): string {
    const n = this.dates.length;
    const i = Math.round(L);
    if (!n) return '';
    if (i >= 0 && i < n) return this.dates[i];
    return i >= n ? addSessions(this.dates[n - 1], i - n + 1) : addSessions(this.dates[0], i);
  }
}

// ---------- maths the shapes share ----------

// retracement: the first point is level 1 and the second level 0, as on TradingView
export const FIB_RETRACEMENT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
export const FIB_EXTENSION = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];
export const fibPrice = (first: number, second: number, level: number) => second + (first - second) * level;
// trend-based extension: the move from a to b, laid on from c
export const fibExtPrice = (a: number, b: number, c: number, level: number) => c + (b - a) * level;

export interface PositionStats {
  reward: number;
  risk: number;
  // reward / risk; null when the stop sits on the entry
  ratio: number | null;
  targetPct: number;
  stopPct: number;
}

export function positionStats(entry: number, target: number, stop: number): PositionStats {
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  return { reward, risk, ratio: risk > 0 ? reward / risk : null, targetPct: ((target - entry) / entry) * 100, stopPct: ((stop - entry) / entry) * 100 };
}

// After the entry bar, the first bar that reached the target or the stop, up to bar `to`. A bar that reached
// both counts as stopped out: from daily bars there's no telling which came first.
export function positionOutcome(
  bars: { h: number[]; l: number[] },
  from: number,
  to: number,
  side: 'long' | 'short',
  target: number,
  stop: number,
): { hit: 'target' | 'stop'; at: number } | null {
  const end = Math.min(Math.floor(to), bars.h.length - 1);
  for (let i = Math.max(0, Math.round(from) + 1); i <= end; i++) {
    const hitStop = side === 'long' ? bars.l[i] <= stop : bars.h[i] >= stop;
    const hitTarget = side === 'long' ? bars.h[i] >= target : bars.l[i] <= target;
    if (hitStop) return { hit: 'stop', at: i };
    if (hitTarget) return { hit: 'target', at: i };
  }
  return null;
}
