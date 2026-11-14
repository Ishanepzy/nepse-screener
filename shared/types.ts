import type { Profile, Quadrant, Stage } from './analysis.ts';

// Daily bars for one symbol, oldest first. t = trade date, YYYY-MM-DD.
export interface Bars {
  t: string[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  // NEPSE index close on each bar date (the last known one where the index has no bar). Set by Engine.
  ix?: number[];
  // RS rating on each bar date, company shares only. Set by Engine for the trend template indicator.
  rs?: number[];
  // CAN SLIM's M on each bar date: 1 when the NEPSE index was in an uptrend, 0 when not, NaN before the index
  // has 200 bars. Set by Engine.
  mkt?: number[];
  // CAN SLIM's C, A and I as they stood on each bar date (1 / 0 / NaN = not known then). Set by Engine.
  cai?: { c: number[]; a: number[]; i: number[] };
}

export interface Operand {
  id: string;
  params: number[];
  line?: string;
}

// fired = an event line (a new ratio high, say) was on within the last N bars
export type Op = 'crossAbove' | 'crossBelow' | 'above' | 'below' | 'rising' | 'falling' | 'fired';

export interface Condition {
  left: Operand;
  op: Op;
  // not used by rising / falling / fired
  right: Operand;
  // multiplies the right side, default 1
  factor?: number;
  // cross / fired: happened within the last N bars. The rest: true for N bars in a row.
  within?: number;
  // cross only: must still be true on the last bar (default true)
  holds?: boolean;
}

export interface Universe {
  // empty = all
  sectors?: string[];
  // leave out mutual funds, debentures, promoter shares... (default true)
  equityOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  // average daily turnover over 20 bars, NPR
  minTurnover?: number;
  // days without a trade before a symbol counts as suspended (default 10)
  maxStaleDays?: number;
  trendTemplate?: boolean;
  minRs?: number;
  // empty = all
  stages?: Stage[];
  // the stock's CAN SLIM letters all met (see meetsCanSlim)
  canslim?: boolean;
}

export interface ScreenRequest {
  conditions: Condition[];
  match: 'all' | 'any';
  universe?: Universe;
}

export interface ConditionHit {
  pass: boolean;
  // cross / fired: bars since it last happened
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
  // in rupees
  change: number | null;
  changePct: number | null;
  volume: number;
  avgTurnover: number;
  spark: number[];
  hits: ConditionHit[];
  rs: number | null;
  stage: Stage | null;
  stageWeeks: number;
  // trend template: rules met out of 8, and each result in TREND_TEMPLATE order
  tt: number;
  ttChecks: boolean[];
  canslim: { c: boolean | null; a: boolean | null; n: boolean; s: boolean; l: boolean; i: boolean | null };
  canslimWhy: { c: string; a: string; i: string };
  fromHigh: number | null;
}

export interface ScreenResponse {
  asOf: string | null;
  scanned: number;
  rows: ScreenRow[];
  // how many stocks each sector has among those checked, so a sector's matches can be read as a share of itself
  sectorSizes: Record<string, number>;
}

export interface Company {
  symbol: string;
  name: string;
  sector?: string;
  active: boolean;
  lastBar?: string;
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
  // fixed values the scan compares an oscillator with, e.g. RSI 30
  levels: { group: string; value: number }[];
  markers: ChartMarker[];
  profile: Profile | null;
}

export interface Market {
  asOf: string | null;
  index: { date: string; close: number; change: number; changePct: number; spark: number[] } | null;
  // equities that traded on asOf
  breadth: { up: number; down: number; flat: number };
  // CAN SLIM's M: index above its 50-day average and the 50-day above the 200-day. null without enough history.
  uptrend: boolean | null;
}
export interface LeaderItem {
  symbol: string;
  name: string;
  sector: string;
  close: number;
  change: number | null;
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
  medianRs: number;
  stage2Pct: number;
  ret3m: number | null;
  leaders: LeaderItem[];
  laggards: LeaderItem[];
}

export interface LeadersResponse {
  asOf: string | null;
  stages: Record<Stage, number>;
  stage2Leaders: LeaderItem[];
  sectors: SectorStrength[];
}

export interface LiveQuote {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface RotationPoint {
  symbol: string;
  name: string;
  sector: string;
  // RS-Ratio and RS-Momentum this week
  x: number;
  y: number;
  quadrant: Quadrant;
  // the weeks before, oldest first, ending with this week: the tail drawn behind the bubble
  tail: { date: string; x: number; y: number }[];
  stage: Stage | null;
  rs: number | null;
}

export interface RotationResponse {
  asOf: string | null;
  weeks: number;
  points: RotationPoint[];
}
