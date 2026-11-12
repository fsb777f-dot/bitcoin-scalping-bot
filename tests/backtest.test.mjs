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

test("BTC cost is charged per closed trade, not per open position", () => {
  const candles = syntheticCandles(380), enabled = names.map(() => true);
  const plain = backtestBitcoin(candles, { enabled, minMatches: 1, riskReward: 2, positionSize: 0.01 });
  const charged = backtestBitcoin(candles, { enabled, minMatches: 1, riskReward: 2, positionSize: 0.01, tradeCostUsd: 0.25 });
  assert.equal(charged.tradeCostUsd, 0.25);
  const original = plain.perStrategy.find(s => s.closed > 0);
  assert.ok(original, "synthetic candles must include closed trades");
  const net = charged.perStrategy.find(s => s.id === original.id);
  assert.equal(net.closedPnl, Math.round((original.closedPnl - original.closed * 0.25) * 10000) / 10000);
  assert.equal(net.closed, original.closed);
  assert.throws(() => backtestBitcoin(candles, { enabled, minMatches: 1, riskReward: 2, tradeCostUsd: -1 }), /расходы/);
});

test("BTC volume scales closed PnL, floating PnL and drawdown, not signal count", () => {
  const candles = syntheticCandles();
  const enabled = names.map(() => true);
  const one = backtestBitcoin(candles, { enabled, minMatches: 1, riskReward: 2, positionSize: 1 });
  const small = backtestBitcoin(candles, { enabled, minMatches: 1, riskReward: 2, positionSize: 0.005 });
  const normal = backtestBitcoin(candles, { enabled, minMatches: 1, riskReward: 2, positionSize: 0.01 });
  const large = backtestBitcoin(candles, { enabled, minMatches: 1, riskReward: 2, positionSize: 0.1 });
  assert.equal(small.positionSize, 0.005);
  for (const [smallRun, size] of [[small, 0.005], [normal, 0.01], [large, 0.1]]) {
    assert.equal(smallRun.main.total, one.main.total);
    assert.equal(smallRun.main.closed, one.main.closed);
    assert.equal(smallRun.main.wins, one.main.wins);
    assert.equal(smallRun.main.losses, one.main.losses);
    assert.ok(Math.abs(smallRun.main.closedPnl - one.main.closedPnl * size) <= 0.02);
    assert.ok(Math.abs(smallRun.main.pnl - one.main.pnl * size) <= 0.02);
    assert.ok(Math.abs(smallRun.main.maxDrawdown - one.main.maxDrawdown * size) <= 0.02);
  }
  assert.throws(() => backtestBitcoin(candles, { enabled, minMatches: 1, riskReward: 2, positionSize: 0 }), /размер позиции/);
});
