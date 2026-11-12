import { test } from 'node:test';
import assert from 'node:assert/strict';
import { journalStats, parseJournal, replayJournal, type Trade } from './journal.ts';
import { DEFAULT_RATES, buyCost } from './costs.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
let n = 0;
const t = (date: string, side: 'buy' | 'sell', qty: number, price: number, extra: Partial<Trade> = {}): Trade => ({
  id: `x${n++}`,
  date,
  symbol: 'NABIL',
  side,
  qty,
  price,
  ...extra,
});

test('sales close the oldest shares first and leave the rest open', () => {
  const r = replayJournal([t('2026-01-01', 'buy', 100, 500), t('2026-02-01', 'buy', 100, 600), t('2026-03-01', 'sell', 150, 700)], DEFAULT_RATES);
  assert.equal(r.closed.length, 1);
  const c = r.closed[0];
  assert.equal(c.qty, 150);
  near(c.buyPrice, (100 * 500 + 50 * 600) / 150);
  assert.equal(c.buyDate, '2026-01-01');
  assert.equal(c.days, 59);
  assert.equal(r.positions[0].qty, 50);
  near(r.positions[0].avgCost, buyCost(100, 600).total / 100);
});

test('profit is after fees on both sides and tax on the gain', () => {
  const r = replayJournal([t('2026-01-01', 'buy', 100, 500), t('2026-01-10', 'sell', 100, 600)], DEFAULT_RATES);
  const c = r.closed[0];
  const cost = buyCost(100, 500).total;
  const fees = 60_000 * 0.0033 + 60_000 * 0.00015 + 25;
  const tax = (60_000 - fees - cost) * 0.075;
  near(c.cost, cost);
  near(c.tax, tax);
  near(c.pnl, 60_000 - fees - tax - cost);
  const noTax = replayJournal([t('2026-01-01', 'buy', 100, 500), t('2026-01-10', 'sell', 100, 600)], DEFAULT_RATES, false);
  near(noTax.closed[0].tax, 0);
});

test('R multiple uses the planned stop; overselling is reported', () => {
  const r = replayJournal([t('2026-01-01', 'buy', 10, 100, { stop: 90 }), t('2026-01-05', 'sell', 15, 120)], DEFAULT_RATES);
  near(r.closed[0].r!, 2);
  assert.equal(r.closed[0].qty, 10);
  assert.equal(r.warnings.length, 1);
  const s = journalStats(r.closed);
  assert.equal(s.trades, 1);
  assert.equal(s.winRate, 100);
});

test('backups round-trip and bad entries are refused', () => {
  const trades = [t('2026-01-01', 'buy', 10, 100, { setup: 'Breakout' })];
  assert.deepEqual(parseJournal(JSON.parse(JSON.stringify({ v: 1, trades }))), trades.map((x) => ({ ...x, stop: undefined, target: undefined, notes: undefined })));
  assert.throws(() => parseJournal({ trades: [{ symbol: 'X', date: 'soon', side: 'buy', qty: 1, price: 1 }] }));
});

test('a sale that closes a winning and a losing lot is taxed on the net gain', () => {
  const r = replayJournal([t('2026-01-01', 'buy', 100, 100), t('2026-01-02', 'buy', 100, 200), t('2026-02-01', 'sell', 200, 150)], DEFAULT_RATES);
  const c = r.closed[0];
  assert.equal(c.tax, 0); // +5,000 on one lot, -5,000 on the other, less fees: no gain overall
  assert.ok(c.pnl < 0 && c.pnl > -400);
});
