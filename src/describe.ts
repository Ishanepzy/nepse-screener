// The plain-English sentence shown under each condition in the scan builder.
import type { Condition, Operand } from '../shared/types.ts';
import { getDef } from '../shared/registry.ts';

const n = (x: number) => (Number.isInteger(x) ? String(x) : String(Number(x.toFixed(4))));

export function describeOperand(op: Operand): string {
  const p = op.params ?? [];
  switch (op.id) {
    case 'close':
      return 'the closing price';
    case 'open':
      return "the day's opening price";
    case 'high':
      return "the day's high";
    case 'low':
      return "the day's low";
    case 'volume':
      return "the day's volume";
    case 'value':
      return n(p[0] ?? 0);
    case 'ema':
    case 'sma':
    case 'wma':
      return `the ${p[0]}-day ${op.id.toUpperCase()}`;
    case 'bb':
      return `the ${op.line === 'middle' ? 'middle' : op.line === 'lower' ? 'lower' : 'upper'} Bollinger Band (${p[0]} days, ${n(p[1])}σ)`;
    case 'supertrend':
      return `the Supertrend line (${p[0]}, ${n(p[1])})`;
    case 'hh':
      return p[0] === 250 ? 'the 52-week high (before today)' : `the highest high of the previous ${p[0]} days`;
    case 'll':
      return p[0] === 250 ? 'the 52-week low (before today)' : `the lowest low of the previous ${p[0]} days`;
    case 'volsma':
      return `the ${p[0]}-day average volume`;
    case 'rsi':
      return `the ${p[0]}-day RSI`;
    case 'macd':
      return `the MACD ${op.line === 'signal' ? 'signal line' : op.line === 'hist' ? 'histogram' : 'line'} (${p.join(', ')})`;
    case 'stoch':
      return `Stochastic ${op.line === 'd' ? '%D' : '%K'} (${p.join(', ')})`;
    case 'adx':
      return op.line === 'pdi' ? `+DI (${p[0]})` : op.line === 'mdi' ? `−DI (${p[0]})` : `ADX (${p[0]})`;
    case 'atr':
      return `the ${p[0]}-day ATR`;
    case 'roc':
      return `the ${p[0]}-day % change`;
    case 'ratio': {
      const what = 'the price ÷ NEPSE index ratio';
      if (op.line === 'ma') return `the ${p[0]}-day average of ${what}`;
      if (op.line === 'high') return `the highest ${what} of the previous ${p[1] === 250 ? '52 weeks' : `${p[1]} days`}`;
      return what;
    }
    case 'breakout':
      return `the ${p[0]}-day breakout level (highest high of the previous ${p[0]} days)`;
    default:
      return getDef(op.id).label;
  }
}

function scaled(op: Operand, factor: number): string {
  const base = describeOperand(op);
  if (factor === 1 || op.id === 'value') return base;
  if (factor < 1) return `${n(factor * 100)}% of ${base}`;
  return `${n(factor)} times ${base}`;
}

const days = (k: number) => (k === 1 ? 'day' : `${k} days`);

function describeEvent(op: Operand): string {
  const p = op.params?.[0];
  if (op.id === 'breakout') {
    if (op.line === 'start') return `The close broke above the previous ${p} days' highest high (a ${p}-day breakout)`;
    if (op.line === 'signal') return `After a ${p}-day breakout, a close went above the breakout day's high (follow-through)`;
    if (op.line === 'state') return `The stock was holding a ${p}-day breakout (no close back below the latest level it broke)`;
  }
  return `${getDef(op.id).label} ${op.line ?? ''} happened`;
}

export function describeCondition(c: Condition): string {
  const left = describeOperand(c.left);
  const cap = left.charAt(0).toUpperCase() + left.slice(1);
  const right = scaled(c.right, c.factor ?? 1);
  const k = Math.max(1, c.within ?? 1);
  switch (c.op) {
    case 'crossAbove':
    case 'crossBelow': {
      const dir = c.op === 'crossAbove' ? 'above' : 'below';
      const when = k === 1 ? 'on the latest trading day' : `in the last ${k} trading days`;
      const still = c.holds === false ? '' : ` and is still ${dir} it`;
      return `${cap} crossed ${dir} ${right} ${when}${still}.`;
    }
    case 'above':
    case 'below':
      return k === 1 ? `${cap} is ${c.op} ${right}.` : `${cap} has been ${c.op} ${right} for the last ${days(k)}.`;
    case 'rising':
    case 'falling':
      return k === 1 ? `${cap} ${c.op === 'rising' ? 'rose' : 'fell'} on the latest trading day.` : `${cap} has ${c.op === 'rising' ? 'risen' : 'fallen'} ${k} days in a row.`;
    case 'fired': {
      const when = k === 1 ? 'on the latest trading day' : `in the last ${k} trading days`;
      return `${describeEvent(c.left)} ${when}.`;
    }
  }
}
