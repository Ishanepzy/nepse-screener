import type { Profile, Stage } from './analysis.ts';

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

/** `fired`: an event line (e.g. a breakout signal) was on at least once in the last N bars. */
export type Op = 'crossAbove' | 'crossBelow' | 'above' | 'below' | 'rising' | 'falling' | 'fired';

export interface Condition {
  left: Operand;
  op: Op;
  /** Ignored for `rising` / `falling` / `fired`. */
  right: Operand;
  /** Right side is multiplied by this (e.g. Volume above 2 x AvgVolume). Default 1. */
  factor?: number;
  /**
   * Cross ops and `fired`: the cross / event must have happened within the last N bars.
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
  /** Only stocks meeting all 8 trend template rules. */
  trendTemplate?: boolean;
  /** Minimum RS rating (1–99). */
  minRs?: number;
  /** Weinstein stages to keep. Empty = all. */
  stages?: Stage[];
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
  rs: number | null;
  stage: Stage | null;
  stageWeeks: number;
  /** Trend template rules met, 0–8, and each rule's result (see TREND_TEMPLATE). */
  tt: number;
  ttChecks: boolean[];
  /** % below the 52-week high (0 = at the high). */
  fromHigh: number | null;
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
  profile: Profile | null;
}

export interface Market {
  asOf: string | null;
  index: { date: string; close: number; change: number; changePct: number; spark: number[] } | null;
  /** Equities that traded on asOf, by direction of the day's close. */
  breadth: { up: number; down: number; flat: number };
}
/** One stock in the leaders view. */
export interface LeaderItem {
  symbol: string;
  name: string;
  sector: string;
  close: number;
  changePct: number | null;
  rs: number;
  stage: Stage | null;
  stageWeeks: number;
  tt: number;
  ret3m: number | null;
  fromHigh: number | null;
}

export interface SectorStrength {
  sector: string;
  count: number;
  /** Median RS rating of its stocks. */
  medianRs: number;
  /** % of its stocks in Stage 2. */
  stage2Pct: number;
  /** Median 3-month return (%). */
  ret3m: number | null;
  /** Highest RS first. */
  leaders: LeaderItem[];
  /** Lowest RS first. */
  laggards: LeaderItem[];
}

export interface LeadersResponse {
  asOf: string | null;
  /** How many stocks are in each stage. */
  stages: Record<Stage, number>;
  /** Stage 2 with RS 80+, strongest first. */
  stage2Leaders: LeaderItem[];
  /** Strongest sector first. */
  sectors: SectorStrength[];
}

/** One stock's prices from the live market feed. */
export interface LiveQuote {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
