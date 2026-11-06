import type { Condition, Operand, Universe } from './types.ts';

export interface Preset {
  id: string;
  name: string;
  description: string;
  /** `list`: no conditions, just a filtered list of stocks (All stocks, Trend template, Stage 2 leaders). */
  bias: 'list' | 'bull' | 'bear' | 'neutral';
  match: 'all' | 'any';
  conditions: Condition[];
  /** Filters the preset sets. Picking a preset resets these three and keeps the user's other filters. */
  universe?: Pick<Universe, 'trendTemplate' | 'minRs' | 'stages'>;
}

const o = (id: string, params: number[] = [], line?: string): Operand => ({ id, params, line });
const close = o('close');
const num = (x: number) => o('value', [x]);
const ema = (n: number) => o('ema', [n]);
const sma = (n: number) => o('sma', [n]);
const cross = (left: Operand, dir: 'up' | 'down', right: Operand, within: number): Condition => ({
  left,
  op: dir === 'up' ? 'crossAbove' : 'crossBelow',
  right,
  within,
  holds: true,
});
const is = (left: Operand, rel: 'above' | 'below', right: Operand, factor = 1): Condition => ({
  left,
  op: rel,
  right,
  factor,
  within: 1,
});

const happened = (left: Operand, within: number): Condition => ({ left, op: 'fired', right: num(0), within });

const MACD = [12, 26, 9];

export const PRESETS: Preset[] = [
  {
    id: 'all',
    name: 'All stocks',
    description: 'Every company share, strongest RS rating first. Sort or search the table, or add conditions below.',
    bias: 'list',
    match: 'all',
    conditions: [],
  },
  {
    id: 'trend-template',
    name: 'Trend template',
    description:
      "Mark Minervini's 8 rules: price above a rising 200-day average and above the 50/150-day averages (stacked 50 > 150 > 200), at least 30% above the 52-week low, within 25% of the 52-week high, RS rating 70+.",
    bias: 'list',
    match: 'all',
    conditions: [],
    universe: { trendTemplate: true },
  },
  {
    id: 'stage2-leaders',
    name: 'Stage 2 leaders',
    description: 'Weinstein Stage 2 (price above a rising 30-week average) with an RS rating of 80 or more.',
    bias: 'list',
    match: 'all',
    conditions: [],
    universe: { stages: [2], minRs: 80 },
  },
  {
    id: 'breakout-21',
    name: '21-day breakout',
    description: "Closed above the previous 21 days' highest high in the last 3 sessions, and hasn't fallen back below it.",
    bias: 'bull',
    match: 'all',
    conditions: [happened(o('breakout', [21], 'start'), 3), happened(o('breakout', [21], 'state'), 1)],
  },
  {
    id: 'breakout-follow',
    name: 'Breakout follow-through',
    description: "After a 21-day breakout, a close above the breakout day's high in the last 3 sessions, still holding.",
    bias: 'bull',
    match: 'all',
    conditions: [happened(o('breakout', [21], 'signal'), 3), happened(o('breakout', [21], 'state'), 1)],
  },
  {
    id: 'ema9-21-up',
    name: 'EMA 9 × 21 bullish',
    description: 'EMA(9) crossed above EMA(21) in the last 3 sessions and is still above.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(ema(9), 'up', ema(21), 3)],
  },
  {
    id: 'ema9-21-down',
    name: 'EMA 9 × 21 bearish',
    description: 'EMA(9) crossed below EMA(21) in the last 3 sessions and is still below.',
    bias: 'bear',
    match: 'all',
    conditions: [cross(ema(9), 'down', ema(21), 3)],
  },
  {
    id: 'ema20-50-up',
    name: 'EMA 20 × 50 bullish',
    description: 'EMA(20) crossed above EMA(50) in the last 5 sessions.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(ema(20), 'up', ema(50), 5)],
  },
  {
    id: 'golden-cross',
    name: 'Golden cross',
    description: 'SMA(50) crossed above SMA(200) in the last 10 sessions.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(sma(50), 'up', sma(200), 10)],
  },
  {
    id: 'death-cross',
    name: 'Death cross',
    description: 'SMA(50) crossed below SMA(200) in the last 10 sessions.',
    bias: 'bear',
    match: 'all',
    conditions: [cross(sma(50), 'down', sma(200), 10)],
  },
  {
    id: 'price-x-ema200',
    name: 'Price × EMA 200',
    description: 'Close crossed above EMA(200) in the last 3 sessions.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(close, 'up', ema(200), 3)],
  },
  {
    id: 'ema-stack',
    name: 'Uptrend stack',
    description: 'Close > EMA(20) > EMA(50) > EMA(200).',
    bias: 'bull',
    match: 'all',
    conditions: [is(close, 'above', ema(20)), is(ema(20), 'above', ema(50)), is(ema(50), 'above', ema(200))],
  },
  {
    id: 'rsi-oversold',
    name: 'RSI oversold',
    description: 'RSI(14) below 30.',
    bias: 'bull',
    match: 'all',
    conditions: [is(o('rsi', [14]), 'below', num(30))],
  },
  {
    id: 'rsi-overbought',
    name: 'RSI overbought',
    description: 'RSI(14) above 70.',
    bias: 'bear',
    match: 'all',
    conditions: [is(o('rsi', [14]), 'above', num(70))],
  },
  {
    id: 'rsi-x-30',
    name: 'RSI exits oversold',
    description: 'RSI(14) crossed back above 30 in the last 3 sessions.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(o('rsi', [14]), 'up', num(30), 3)],
  },
  {
    id: 'macd-up',
    name: 'MACD bullish cross',
    description: 'MACD(12,26,9) line crossed above its signal line in the last 3 sessions.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(o('macd', MACD, 'macd'), 'up', o('macd', MACD, 'signal'), 3)],
  },
  {
    id: 'macd-down',
    name: 'MACD bearish cross',
    description: 'MACD(12,26,9) line crossed below its signal line in the last 3 sessions.',
    bias: 'bear',
    match: 'all',
    conditions: [cross(o('macd', MACD, 'macd'), 'down', o('macd', MACD, 'signal'), 3)],
  },
  {
    id: 'supertrend-up',
    name: 'Supertrend buy',
    description: 'Supertrend(10,3) flipped bullish (close crossed above it) in the last 3 sessions.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(close, 'up', o('supertrend', [10, 3]), 3)],
  },
  {
    id: 'supertrend-down',
    name: 'Supertrend sell',
    description: 'Supertrend(10,3) flipped bearish in the last 3 sessions.',
    bias: 'bear',
    match: 'all',
    conditions: [cross(close, 'down', o('supertrend', [10, 3]), 3)],
  },
  {
    id: 'ratio-x-ma50',
    name: 'Started beating NEPSE',
    description: 'Price ÷ NEPSE index crossed above its 50-day average in the last 3 sessions: the stock has turned to outperforming the market.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(o('ratio', [50, 250], 'value'), 'up', o('ratio', [50, 250], 'ma'), 3)],
  },
  {
    id: 'ratio-52w-high',
    name: 'RS line 52-week high',
    description:
      'Price ÷ NEPSE index closed above its previous 52-week high in the last 3 sessions. The relative strength line often makes a new high before the price does.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(o('ratio', [50, 250], 'value'), 'up', o('ratio', [50, 250], 'high'), 3)],
  },
  {
    id: 'volume-spike',
    name: 'Volume spike',
    description: "Today's volume is more than 2× its 20-day average.",
    bias: 'neutral',
    match: 'all',
    conditions: [is(o('volume'), 'above', o('volsma', [20]), 2)],
  },
  {
    id: '52w-breakout',
    name: '52-week high breakout',
    description: 'Close crossed above the prior 52-week high in the last 3 sessions.',
    bias: 'bull',
    match: 'all',
    conditions: [cross(close, 'up', o('hh', [250]), 3)],
  },
  {
    id: 'near-52w-low',
    name: 'Near 52-week low',
    description: 'Close within 5% of the prior 52-week low.',
    bias: 'bear',
    match: 'all',
    conditions: [is(close, 'below', o('ll', [250]), 1.05)],
  },
  {
    id: 'bb-lower',
    name: 'Below lower Bollinger',
    description: 'Close below the lower Bollinger Band (20, 2).',
    bias: 'bull',
    match: 'all',
    conditions: [is(close, 'below', o('bb', [20, 2], 'lower'))],
  },
  {
    id: 'adx-trend',
    name: 'Strong uptrend (ADX)',
    description: 'ADX(14) above 25 with +DI above -DI.',
    bias: 'bull',
    match: 'all',
    conditions: [
      is(o('adx', [14, 14], 'adx'), 'above', num(25)),
      is(o('adx', [14, 14], 'pdi'), 'above', o('adx', [14, 14], 'mdi')),
    ],
  },
];
