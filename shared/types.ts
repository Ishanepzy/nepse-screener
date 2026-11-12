import type { Profile, Stage } from './analysis.ts';

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
}

export interface Operand {
  id: string;
  params: number[];
  line?: string;
}

// fired = an event line (a breakout, say) was on within the last N bars
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
  fromHigh: number | null;
}

export interface ScreenResponse {
  asOf: string | null;
  scanned: number;
  rows: ScreenRow[];
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
