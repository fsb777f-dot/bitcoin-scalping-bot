import assert from "node:assert/strict";
import { virtualPartialUpdate, virtualSettledPnl } from "../worker/partial-profit.js";

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
console.log("Bitcoin classic/AI virtual 1R half-close checks passed");
