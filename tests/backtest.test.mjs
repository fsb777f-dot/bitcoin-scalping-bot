import assert from "node:assert/strict";
import { test } from "node:test";
import { backtestBitcoin } from "../js/backtest.js";
import { names } from "../strategies/index.js";

function syntheticCandles(length = 280) {
  return Array.from({ length }, (_, i) => {
    const center = 74000 + i * 3 + Math.sin(i / 9) * 17;
    const open = center, close = center + Math.sin(i / 3) * 3;
    return {
      time: 1700000000 + i * 300, open, high: Math.max(open, close) + 8,
      low: Math.min(open, close) - 8, close, volume: 12 + i % 4,
      bidOpen: open - 2, askOpen: open + 2,
      bidClose: close - 2, askClose: close + 2,
      bidLow: Math.min(open, close) - 10, askHigh: Math.max(open, close) + 10
    };
  });
}

test("backtest has 41 independent BTC strategies and respects candle history", () => {
  assert.equal(names.length, 41);
  const result = backtestBitcoin(syntheticCandles(), {
    enabled: names.map(() => true), minMatches: 8, riskReward: 2
  });
  assert.equal(result.candles, 280);
  assert.equal(result.perStrategy.length, 41);
  assert.ok(Number.isFinite(result.main.pnl));
  assert.ok(Number.isFinite(result.ai.closedPnl));
  assert.ok(result.perStrategy.every(s => s.open + s.closed === s.total));
  assert.equal(result.from, syntheticCandles()[240].time);
});

test("disabled strategies remain visible and invalid bid/ask is rejected", () => {
  const enabled = names.map((_, index) => index < 10);
  const candles = syntheticCandles(260);
  const result = backtestBitcoin(candles, { enabled, minMatches: 8, riskReward: 1.5 });
  assert.equal(result.perStrategy.filter(x => x.enabled).length, 10);
  assert.equal(result.perStrategy.length, 41);
  candles[0].askOpen = candles[0].bidOpen - 1;
  assert.throws(() => backtestBitcoin(candles, { enabled, minMatches: 8, riskReward: 1.5 }), /Bid\/Ask/);
});
