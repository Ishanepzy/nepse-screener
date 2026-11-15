import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RATES } from '../shared/costs.ts';
import type { Bars } from '../shared/types.ts';
import { buyTotal, maxBuy, replayAccount, replayStats, type ReplaySession } from './replay.ts';

const dates = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12', '2026-01-13'];
const c = [100, 110, 90, 120, 130, 125, 140];
const bars: Bars = { t: dates, c, o: c, h: c, l: c, v: c.map(() => 1) };
const session = (fills: ReplaySession['fills'], at = dates[6], fees = false): ReplaySession => ({ start: dates[0], at, balance: 100_000, fees, fills });

test('buys and a partial sale, oldest shares first, without fees', () => {
  const s = session([
    { date: dates[0], side: 'buy', shares: 100, price: 100 },
    { date: dates[2], side: 'buy', shares: 100, price: 90 },
    // sells the 100 bought at 100, then 50 of those at 90
    { date: dates[3], side: 'sell', shares: 150, price: 120 },
  ]);
  const a = replayAccount(s, bars, null);
  assert.equal(a.shares, 50);
  assert.equal(a.costBasis, 50 * 90);
  assert.equal(a.avgCost, 90);
  assert.equal(a.closed.length, 1);
  assert.equal(a.closed[0].cost, 100 * 100 + 50 * 90);
  assert.equal(a.realized, 150 * 120 - (10_000 + 4_500));
  // valued at the last close shown, 140
  assert.equal(a.unrealized, 50 * 140 - 50 * 90);
  assert.equal(a.equity, 100_000 - 10_000 - 9_000 + 18_000 + 50 * 140);
  assert.deepEqual(a.fillPnl, [null, null, 3_500]);
  // held 3 days (bought on the 5th) and 1 day (the 7th), weighted by shares
  assert.ok(Math.abs(a.closed[0].days - (100 * 3 + 50 * 1) / 150) < 1e-9);
});

test('the day shown limits what counts: the equity curve stops there, and the drawdown comes from it', () => {
  const s = session([{ date: dates[0], side: 'buy', shares: 500, price: 100 }], dates[2]);
  const a = replayAccount(s, bars, null);
  assert.deepEqual(a.curve.t, dates.slice(0, 3));
  // 50,000 cash + 500 shares at 100, 110, 90
  assert.deepEqual(a.curve.v, [100_000, 105_000, 95_000]);
  assert.ok(Math.abs(a.maxDrawdown - ((95_000 - 105_000) / 105_000) * 100) < 1e-9);
  assert.equal(a.unrealized, 500 * 90 - 50_000);
});

test('fees and tax come off when they are on, and the most you can buy pays for them', () => {
  const fills: ReplaySession['fills'] = [
    { date: dates[0], side: 'buy', shares: 100, price: 100 },
    { date: dates[4], side: 'sell', shares: 100, price: 130 },
  ];
  const plain = replayAccount(session(fills), bars, DEFAULT_RATES);
  const real = replayAccount(session(fills, dates[6], true), bars, DEFAULT_RATES);
  assert.equal(plain.realized, 3_000);
  assert.ok(real.realized < 3_000 && real.realized > 2_000);
  assert.equal(real.cash, real.equity);

  const n = maxBuy(100_000, 100, DEFAULT_RATES);
  assert.ok(buyTotal(n, 100, DEFAULT_RATES) <= 100_000 && buyTotal(n + 1, 100, DEFAULT_RATES) > 100_000);
  assert.equal(maxBuy(100_000, 100, null), 1000);
});

test('the analytics: win rate, profit factor and averages over the sales', () => {
  const s = session([
    { date: dates[0], side: 'buy', shares: 100, price: 100 },
    { date: dates[1], side: 'sell', shares: 100, price: 110 },
    { date: dates[1], side: 'buy', shares: 100, price: 110 },
    { date: dates[2], side: 'sell', shares: 100, price: 90 },
  ]);
  const st = replayStats(s, replayAccount(s, bars, null));
  assert.equal(st.trades, 2);
  assert.equal(st.winRate, 50);
  assert.equal(st.profitFactor, 1_000 / 2_000);
  assert.equal(st.avgWin, 1_000);
  assert.equal(st.avgLoss, -2_000);
  assert.equal(st.netPnl, -1_000);
  assert.equal(st.netPct, -1);
});
