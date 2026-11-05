import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buyCost, commission, sellProceeds, sizePosition } from './costs.ts';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≉ ${b}`);

test('commission takes the slab rate on the whole amount', () => {
  near(commission(50_000), 180); // 0.36%
  near(commission(50_001), 50_001 * 0.0033);
  near(commission(2_000_000), 6_200); // 0.31%
  near(commission(20_000_000), 48_000); // 0.24%
});

test('buy and sell costs, with CGT on the gain by holding period', () => {
  const b = buyCost(100, 500); // 50,000
  near(b.total, 50_000 + 180 + 7.5);
  const s = sellProceeds(100, 600, b.total, 30); // 60,000
  const fees = 60_000 * 0.0033 + 9 + 25;
  const gain = 60_000 - fees - b.total;
  near(s.cgt, gain * 0.075);
  near(s.net, 60_000 - fees - gain * 0.075);
  near(sellProceeds(100, 600, b.total, 400).cgt, gain * 0.05);
  assert.equal(sellProceeds(100, 400, b.total, 30).cgt, 0);
});

test('position size keeps the loss at the stop, fees included, within the risk', () => {
  const p = sizePosition(1_000_000, 10_000, 500, 450, 1);
  assert.equal(p.limit, 'risk');
  assert.ok(p.riskAtStop <= 10_000);
  // one more share would break the limit
  const more = buyCost(p.shares + 1, 500).total;
  assert.ok(more - sellProceeds(p.shares + 1, 450, more, 0, undefined, false).net > 10_000);
  assert.ok(p.shares < 200 && p.shares > 150);
});

test('position size is capped by capital and rounded to lots', () => {
  const p = sizePosition(50_000, 10_000, 500, 490, 10);
  assert.equal(p.limit, 'capital');
  assert.equal(p.shares % 10, 0);
  assert.ok(p.cost <= 50_000);
  assert.equal(sizePosition(100_000, 1_000, 500, 510).shares, 0); // stop above entry
});
