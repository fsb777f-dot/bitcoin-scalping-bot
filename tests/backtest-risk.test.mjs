import test from "node:test";
import assert from "node:assert/strict";
import { backtestBreakevenTrailUpdate } from "../js/backtest-risk.js";

test("BUY: wait for 1R, move to entry, then trail by 0.6R without widening", () => {
  const buy = { side: "BUY", entry: 100, sl: 90, initial_risk: 10, breakeven_active: false };
  assert.equal(backtestBreakevenTrailUpdate(buy, 109.99, 1), null);
  Object.assign(buy, backtestBreakevenTrailUpdate(buy, 110, 1));
  assert.equal(buy.sl, 100);
  assert.equal(buy.breakeven_active, true);
  Object.assign(buy, backtestBreakevenTrailUpdate(buy, 112, 1));
  assert.equal(buy.sl, 106);
  assert.equal(backtestBreakevenTrailUpdate(buy, 111, 1), null);
  assert.equal(buy.sl, 106);
});

test("SELL: wait for 1.5R, protect entry, then move trailing stop down", () => {
  const sell = { side: "SELL", entry: 100, sl: 110, initial_risk: 10, breakeven_active: false };
  assert.equal(backtestBreakevenTrailUpdate(sell, 86, 1.5), null);
  Object.assign(sell, backtestBreakevenTrailUpdate(sell, 85, 1.5));
  assert.equal(sell.sl, 100);
  Object.assign(sell, backtestBreakevenTrailUpdate(sell, 82, 1.5));
  assert.equal(sell.sl, 88);
  assert.equal(backtestBreakevenTrailUpdate(sell, 84, 1.5), null);
});

test("R=2 waits until the completed quote reaches 2R", () => {
  const t = { side: "BUY", entry: 100, sl: 90, initial_risk: 10 };
  assert.equal(backtestBreakevenTrailUpdate(t, 119.9, 2), null);
  assert.equal(backtestBreakevenTrailUpdate(t, 120, 2).sl, 100);
});

test("invalid data never move a protective stop", () => {
  assert.equal(backtestBreakevenTrailUpdate(null, 110, 1), null);
  assert.equal(backtestBreakevenTrailUpdate({ side: "BUY", entry: 100, sl: 90, initial_risk: 0 }, 120, 1), null);
  assert.equal(backtestBreakevenTrailUpdate({ side: "BUY", entry: 100, sl: 90, initial_risk: 10 }, NaN, 1), null);
});
