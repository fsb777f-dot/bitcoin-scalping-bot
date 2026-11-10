import assert from "node:assert/strict";
import { evaluateSmc, updateSmcPaper } from "./smc.js";

const candles = Array.from({ length: 80 }, (_, i) => ({
  time: 1800000000 + i * 60, open: 100, high: 101, low: 99, close: 100
}));
const frames = { "1m": candles, "5m": candles, "1h": candles };
assert.equal(evaluateSmc(frames).side, "WAIT");

const market = { frames, bid: 100, ask: 101, spread: 1, analysis: { source: "Capital.com Demo" } };
const previous = { trades: [
  { id: "long", side: "BUY", entry: 95, sl: 90, status: "OPEN", openedAt: 1 },
  { id: "short", side: "SELL", entry: 98, sl: 100.5, status: "OPEN", openedAt: 2 }
], stats: { opened: 2, wins: 0, losses: 0, pnl: 0 } };
const first = updateSmcPaper(previous, market);
assert.equal(first.stats.losses, 1, "short stop is checked against Ask");
assert.equal(first.stats.pnl, -3, "pnl is based on executable Ask, including spread");
assert.ok(first.trades.find(t => t.id === "long").sl >= 95, "profitable long moves its stop forward");
assert.equal(first.trades.find(t => t.id === "short").status, "CLOSED");
const second = updateSmcPaper(first, market);
assert.equal(second.stats.losses, 1, "a closed trade cannot be counted twice");
const unavailable = updateSmcPaper(first, { ...market, analysis: { source: "Kraken" } });
assert.deepEqual(unavailable.stats, first.stats, "SMC must not trade on a fallback provider");
console.log("SMC paper-trading checks passed");
