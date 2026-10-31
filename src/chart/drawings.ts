// Lines and shapes drawn on a stock's chart, kept per symbol in the browser.
// Points are anchored to a trade date (plus a fractional bar offset, so a point can sit to the right of the last
// bar) rather than to a bar index, because the data window shifts forward every day.

export type DrawingType = 'trend' | 'ray' | 'hline' | 'rect' | 'fib' | 'measure';

export interface Anchor {
  /** Trade date of the nearest bar. */
  d: string;
  /** Bars from that date (fractional; beyond the last bar for points in the future). */
  o: number;
  /** Price. */
  p: number;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  a: Anchor;
  /** Second point; absent for horizontal lines. */
  b?: Anchor;
}

export const TOOLS: { type: DrawingType; label: string; help: string; points: 1 | 2 }[] = [
  { type: 'trend', label: 'Trend line', help: 'Click two points', points: 2 },
  { type: 'ray', label: 'Ray', help: 'A line from the first point through the second, extended to the right', points: 2 },
  { type: 'hline', label: 'Horizontal line', help: 'Click once at a price, e.g. a support or resistance level', points: 1 },
  { type: 'rect', label: 'Rectangle', help: 'Click two opposite corners, e.g. to mark a range', points: 2 },
  { type: 'fib', label: 'Fibonacci retracement', help: 'Click a swing low and a swing high (or the reverse)', points: 2 },
  { type: 'measure', label: 'Measure', help: 'Click two points to see the price change, % change and number of days', points: 2 },
];

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

const KEY = 'nepse.drawings.v1';

function readAll(): Record<string, Drawing[]> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function loadDrawings(symbol: string): Drawing[] {
  const list = readAll()[symbol];
  return Array.isArray(list) ? list : [];
}

export function saveDrawings(symbol: string, list: Drawing[]) {
  try {
    const all = readAll();
    if (list.length) all[symbol] = list;
    else delete all[symbol];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* convenience only */
  }
}

let counter = 0;
export const newId = () => `d${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Converts between anchors and bar positions (logical indexes) for one stock's dates. */
export class Anchors {
  private index: Map<string, number>;
  private dates: string[];

  constructor(dates: string[]) {
    this.dates = dates;
    this.index = new Map(dates.map((d, i) => [d, i]));
  }

  /** Bar position of an anchor, or null when its date has fallen out of the data window. */
  toLogical(a: Anchor): number | null {
    const i = this.index.get(a.d);
    return i == null ? null : i + a.o;
  }

  fromLogical(logical: number, price: number): Anchor {
    const i = Math.min(this.dates.length - 1, Math.max(0, Math.round(logical)));
    return { d: this.dates[i], o: Math.round((logical - i) * 100) / 100, p: price };
  }
}
