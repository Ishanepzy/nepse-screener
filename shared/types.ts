/** Daily OHLCV history for one symbol, oldest first. Dates are trade dates (YYYY-MM-DD). */
export interface Bars {
  t: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
}

/** One input to a condition: an indicator (with its params) and which of its output lines to read. */
export interface Operand {
  id: string;
  params: number[];
  line?: string;
}

export type Op = 'crossAbove' | 'crossBelow' | 'above' | 'below' | 'rising' | 'falling';

export interface Condition {
  left: Operand;
  op: Op;
  /** Ignored for `rising` / `falling`. */
  right: Operand;
  /** Right side is multiplied by this (e.g. Volume above 2 x AvgVolume). Default 1. */
  factor?: number;
  /**
   * Cross ops: the cross must have happened within the last N bars.
   * above/below/rising/falling: must hold for the last N bars in a row.
   */
  within?: number;
  /** Cross ops only: also require the relation to still hold on the latest bar. Default true. */
  holds?: boolean;
}

export interface Universe {
  /** Empty = all sectors. */
  sectors?: string[];
  /** Exclude mutual funds, debentures, bonds, promoter & preference shares. Default true. */
  equityOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  /** Minimum average daily turnover (NPR) over the last 20 bars. */
  minTurnover?: number;
  /** Skip symbols with no trade in the last N calendar days (suspended / delisted). Default 10. */
  maxStaleDays?: number;
}

export interface ScreenRequest {
  conditions: Condition[];
  match: 'all' | 'any';
  universe?: Universe;
}

export interface ConditionHit {
  pass: boolean;
  /** For cross ops: how many bars ago the most recent cross in the window happened. */
  barsAgo?: number;
  date?: string;
  left: number | null;
  right: number | null;
}

export interface ScreenRow {
  symbol: string;
  name: string;
  sector: string;
  date: string;
  close: number;
  changePct: number | null;
  volume: number;
  avgTurnover: number;
  /** Recent closes, oldest first, for the row sparkline. */
  spark: number[];
  hits: ConditionHit[];
}

export interface ScreenResponse {
  asOf: string | null;
  scanned: number;
  rows: ScreenRow[];
  tookMs: number;
}

export interface Company {
  symbol: string;
  name: string;
  sector?: string;
  active: boolean;
  lastBar?: string;
}

export interface ChartSeries {
  key: string;
  label: string;
  pane: 'price' | 'volume' | 'osc';
  /** Oscillators sharing a group are drawn in the same pane. */
  group: string;
  values: (number | null)[];
}

export interface ChartMarker {
  date: string;
  dir: 'up' | 'down';
  text: string;
}

export interface ChartResponse {
  symbol: string;
  name: string;
  sector: string;
  bars: Bars;
  series: ChartSeries[];
  /** Constant levels referenced by conditions, keyed by oscillator group (e.g. RSI 30). */
  levels: { group: string; value: number }[];
  markers: ChartMarker[];
}

export interface Market {
  asOf: string | null;
  index: { close: number; change: number; changePct: number; spark: number[] } | null;
  /** Equities that traded on asOf, by direction of the day's close. */
  breadth: { up: number; down: number; flat: number };
}