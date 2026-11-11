import assert from "node:assert/strict";
import { virtualPartialUpdate, virtualTargetTrailUpdate, virtualSettledPnl, virtualStopFill, spreadSafeStopDistance } from "../worker/partial-profit.js";

const buy = { side: "BUY", entry: 100, sl: 96, partial_exit_price: null };
assert.equal(virtualPartialUpdate(buy, 103.99, 4), null);
const buyHalf = virtualPartialUpdate(buy, 104, 4);
assert.deepEqual(buyHalf, { sl: 100, partial_exit_price: 104, pnl: 2, trailing_active: true, result: "HALF_CLOSED" });
assert.equal(virtualPartialUpdate({ ...buy, sl: 101 }, 104, 4).sl, 101,
  "a legacy profitable stop must never loosen");
assert.deepEqual(virtualPartialUpdate({ ...buy, ...buyHalf }, 106, 4), { sl: 101, trailing_active: true });
assert.equal(virtualPartialUpdate({ ...buy, ...buyHalf, sl: 101 }, 105, 4), null);
assert.equal(virtualSettledPnl({ ...buy, ...buyHalf }, 101), 2.5);
assert.equal(virtualSettledPnl(buy, 96), -4);

const sell = { side: "SELL", entry: 100, sl: 104, partial_exit_price: null };
const sellHalf = virtualPartialUpdate(sell, 96, 4);
assert.deepEqual(sellHalf, { sl: 100, partial_exit_price: 96, pnl: 2, trailing_active: true, result: "HALF_CLOSED" });
assert.deepEqual(virtualPartialUpdate({ ...sell, ...sellHalf }, 94, 4), { sl: 99, trailing_active: true });
assert.equal(virtualSettledPnl({ ...sell, ...sellHalf }, 99), 2.5);
assert.equal(virtualStopFill("BUY", 96, 93), 93, "a gapped BUY stop fills at the worse Bid");
assert.equal(virtualStopFill("SELL", 104, 108), 108, "a gapped SELL stop fills at the worse Ask");
assert.equal(spreadSafeStopDistance(84, 50), 134, "ATR protection is beyond the current bid/ask spread");
assert.ok(Math.abs(spreadSafeStopDistance(10, 50) - 102.5) < 1e-8, "wide spread cannot leave the stop one tick away");
console.log("Bitcoin classic/AI virtual 1R half-close checks passed");

const nextBuy = { side: "BUY", entry: 100, sl: 95, tp: 110, initial_tp: 110, trailing_distance: 5 };
assert.equal(virtualTargetTrailUpdate(nextBuy, 109.99), null, "a new BUY trade must remain fully open before TP");
assert.deepEqual(virtualTargetTrailUpdate(nextBuy, 110), { sl: 110, trailing_active: true }, "TP must raise the whole BUY stop to TP");
assert.deepEqual(virtualTargetTrailUpdate({ ...nextBuy, sl: 110 }, 115), { sl: 112, trailing_active: true }, "BUY stop trails further profit");
assert.equal(virtualTargetTrailUpdate({ ...nextBuy, sl: 112 }, 111), null, "BUY stop never loosens");
assert.equal(virtualSettledPnl(nextBuy, 110), 10, "new BUY exits the whole position, no partial profit");

const nextSell = { side: "SELL", entry: 100, sl: 105, tp: 90, initial_tp: 90, trailing_distance: 5 };
assert.equal(virtualTargetTrailUpdate(nextSell, 90.01), null, "new SELL trade must remain fully open before TP");
assert.deepEqual(virtualTargetTrailUpdate(nextSell, 90), { sl: 90, trailing_active: true }, "TP must lower the whole SELL stop to TP");
assert.deepEqual(virtualTargetTrailUpdate({ ...nextSell, sl: 90 }, 85), { sl: 88, trailing_active: true }, "SELL stop trails further profit");
assert.equal(virtualTargetTrailUpdate({ ...nextSell, sl: 88 }, 89), null, "SELL stop never loosens");
assert.equal(virtualSettledPnl(nextSell, 90), 10, "new SELL exits whole position, no partial profit");
console.log("Bitcoin target-activated full-position trailing checks passed");
