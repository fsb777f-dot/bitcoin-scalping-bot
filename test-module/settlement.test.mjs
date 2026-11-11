import assert from "node:assert/strict";
import { loadMarketAnalysis } from "./market-analysis.js";
import { settleTestTrade, testRiskLevels } from "./strategies.js";

const candles = Array.from({ length: 210 }, (_, i) => ({
  time: 1800000000 + i * 60, open: 100, high: 102, low: 98,
  close: 100 + i / 200, volume: 1
}));
const frames = Object.fromEntries(["1m", "5m", "15m", "1h", "4h"].map(id => [
  id, { candles, price: 100.5, bid: 100, ask: 101, spread: 1 }
]));
const originalFetch = globalThis.fetch;
const requests = [];
try {
  globalThis.fetch = async url => {
    requests.push(String(url));
    return { ok: true, json: async () => ({ frames }) };
  };
  const market = await loadMarketAnalysis();
  assert.equal(market.analysis.source, "Capital.com Demo");
  assert.equal(market.bid, 100);
  assert.equal(market.ask, 101);
  assert.equal(market.candles.length, 210);
  assert.equal(requests.length, 1, "test worker must request just one Capital.com bundle");
  assert.match(requests[0], /capital-demo\/market-bundle$/);
} finally {
  globalThis.fetch = originalFetch;
}

const levels = testRiskLevels("BUY", 101, candles, 2, 3);
assert.equal(levels.sl, 92, "stop stays clear of the $3 spread");
assert.equal(levels.tp, 119);
assert.deepEqual(settleTestTrade(
  { side: "BUY", entry: 101, sl: 98, tp: 107 }, 97, 98
), { exit: 97, pnl: -4, result: "SL" }, "gap loss uses executable Bid");
assert.deepEqual(settleTestTrade(
  { side: "SELL", entry: 100, sl: 103, tp: 94 }, 104, 105
), { exit: 105, pnl: -5, result: "SL" }, "short gap loss uses executable Ask");
assert.deepEqual(settleTestTrade(
  { side: "BUY", entry: 101, sl: 98, tp: 107 }, 108, 109
), { exit: 107, pnl: 6, result: "TP" }, "take profit fills at limit");
assert.equal(settleTestTrade(
  { side: "BUY", entry: 101, sl: 98, tp: 107 }, 102, 103
), null);
console.log("Capital.com consensus entry and settlement checks passed");
