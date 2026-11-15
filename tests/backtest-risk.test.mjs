import test from "node:test";
import assert from "node:assert/strict";
import { backtestBreakevenTrailUpdate, backtestHybridTrailUpdate } from "../js/backtest-risk.js";

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

test("hybrid BUY: entry protected at +1.5R, TP protected at +2R, then stop trails", () => {
  const t = { side: "BUY", entry: 100, sl: 90, initial_risk: 10,
    initial_tp: 120, tp: 120, trailing_distance: 10, breakeven_active: false };
  assert.equal(backtestHybridTrailUpdate(t, 114.99), null);
  Object.assign(t, backtestHybridTrailUpdate(t, 115));
  assert.equal(t.sl, 100);
  assert.equal(t.breakeven_active, true);
  assert.equal(backtestHybridTrailUpdate(t, 117), null); // no trailing before TP
  assert.equal(t.sl, 100);
  Object.assign(t, backtestHybridTrailUpdate(t, 120));
  assert.equal(t.sl, 120);
  assert.equal(t.hybrid_tp_active, true);
  Object.assign(t, backtestHybridTrailUpdate(t, 130));
  assert.equal(t.sl, 124); // quote minus 0.6R
  assert.equal(backtestHybridTrailUpdate(t, 125), null);
  assert.equal(t.sl, 124);
});

test("hybrid SELL: entry and TP protected, stop never widens", () => {
  const t = { side: "SELL", entry: 100, sl: 110, initial_risk: 10,
    initial_tp: 80, tp: 80, trailing_distance: 10, breakeven_active: false };
  assert.equal(backtestHybridTrailUpdate(t, 85.01), null);
  Object.assign(t, backtestHybridTrailUpdate(t, 85));
  assert.equal(t.sl, 100);
  assert.equal(backtestHybridTrailUpdate(t, 83), null);
  Object.assign(t, backtestHybridTrailUpdate(t, 80));
  assert.equal(t.sl, 80);
  Object.assign(t, backtestHybridTrailUpdate(t, 70));
  assert.equal(t.sl, 76);
  assert.equal(backtestHybridTrailUpdate(t, 75), null);
});

test("hybrid: lower R/R TP takes precedence over BE trigger", () => {
  const t = { side: "BUY", entry: 100, sl: 90, initial_risk: 10,
    initial_tp: 110, tp: 110, trailing_distance: 10 };
  Object.assign(t, backtestHybridTrailUpdate(t, 110));
  assert.equal(t.sl, 110);
  assert.equal(t.hybrid_tp_active, true);
});

test("hybrid: bad prices or stop/target direction produce no updates", () => {
  assert.equal(backtestHybridTrailUpdate(null, 115), null);
  assert.equal(backtestHybridTrailUpdate({
    side: "BUY", entry: 100, sl: 90, initial_risk: 10, initial_tp: 90
  }, 115), null);
  assert.equal(backtestHybridTrailUpdate({
    side: "SELL", entry: 100, sl: 110, initial_risk: 10, initial_tp: 80
  }, NaN), null);
});
