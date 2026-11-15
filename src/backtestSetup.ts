// The backtest's saved settings and its starting rules: shared by the Backtest page and the chart's backtest button.
import type { Condition, Operand } from '../shared/types.ts';
import type { BacktestSettings, ExitReason } from '../shared/backtest.ts';
import { PRESETS } from '../shared/presets.ts';
import { load } from './storage.ts';

export type Scope = 'all' | 'scan' | 'watchlist' | 'one';
export interface Setup extends BacktestSettings {
  scope: Scope;
  symbol: string;
}

export const SETUP_KEY = 'nepse.backtest.v1';
const o = (id: string, params: number[] = [], line?: string): Operand => ({ id, params, line });

// the rules a backtest can start from: the quick scans that buy, and two the screener only has as filters
export const RULES: { id: string; name: string; conditions: Condition[]; match: 'all' | 'any' }[] = [
  ...PRESETS.filter((p) => p.conditions.length && p.bias !== 'bear').map((p) => ({ id: p.id, name: p.name, conditions: p.conditions, match: p.match })),
  { id: 'bt-tt', name: 'Trend template: all 8 rules met', match: 'all', conditions: [{ left: o('tt', [], 'pass'), op: 'fired', right: o('value', [0]), within: 1, holds: true }] },
  {
    id: 'bt-csp',
    name: 'CAN SLIM, the price letters: N, S and L',
    match: 'all',
    conditions: (['n', 's', 'l'] as const).map((k): Condition => ({ left: o('cs', [], k), op: 'above', right: o('value', [0.5]), within: 1, holds: true })),
  },
  // results data reaches back about two years and holdings only a month, so this one has little history to test
  { id: 'bt-cs', name: 'CAN SLIM: 6 or more of the 7 letters (short history)', match: 'all', conditions: [{ left: o('cs', [], 'score'), op: 'above', right: o('value', [5.5]), within: 1, holds: true }] },
];

export const DEFAULTS: Setup = {
  entry: { conditions: RULES.find((r) => r.id === 'ema20-50-up')?.conditions ?? RULES[0].conditions, match: 'all' },
  exitConditions: [],
  // O'Neil's rule: cut a loss at 7 to 8%
  stopPct: 8,
  targetPct: 25,
  trailPct: null,
  maxDays: null,
  from: null,
  to: null,
  capital: 1_000_000,
  positionPct: 10,
  maxPositions: 10,
  minHold: 2,
  fees: true,
  minTurnover: 1_000_000,
  scope: 'all',
  symbol: '',
};

export const REASONS: Record<ExitReason, string> = {
  stop: 'Stop loss',
  trail: 'Trailing stop',
  target: 'Target',
  signal: 'Sell rule',
  time: 'Time limit',
  end: 'Still open at the end',
};

export function loadSetup(): Setup {
  const v = load(SETUP_KEY);
  return v && typeof v === 'object' ? { ...DEFAULTS, ...(v as Partial<Setup>) } : DEFAULTS;
}
