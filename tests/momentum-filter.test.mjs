// Run: node --experimental-default-type=module --test tests/momentum-filter.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { candleMomentum, momentumConfirms } from "../js/momentum-filter.js";

const candles = closes => closes.map((close, time) => ({ close, time }));

test("confirms accelerating upward BTC candles", () => {
  const result = candleMomentum(candles([100, 101, 103]), 10);
  assert.equal(result.side, "BUY");
  assert.equal(result.velocity, 2);
  assert.equal(result.acceleration, 1);
  assert.equal(momentumConfirms("BUY", result), true);
  assert.equal(momentumConfirms("SELL", result), false);
});

test("confirms accelerating downward BTC candles", () => {
  const result = candleMomentum(candles([103, 101, 98]), 10);
  assert.equal(result.side, "SELL");
  assert.equal(result.velocity, -3);
  assert.equal(result.acceleration, -1);
});

test("rejects deceleration and flat prices", () => {
  assert.equal(candleMomentum(candles([100, 103, 105]), 10).side, "WAIT");
  assert.equal(candleMomentum(candles([100, 100, 100]), 10).side, "WAIT");
});

test("insufficient or invalid source data does not create trading signals", () => {
  assert.equal(candleMomentum(candles([100, 101]), 10).side, "WAIT");
  assert.equal(candleMomentum(candles([100, NaN, 110]), 10).side, "WAIT");
  assert.equal(candleMomentum(candles([100, 101, 103]), 0).side, "WAIT");
});

test("off mode preserves classic directional votes", () => {
  assert.equal(momentumConfirms("BUY", null), false);
  assert.equal(momentumConfirms("WAIT", null), true);
});
