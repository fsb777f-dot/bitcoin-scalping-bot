import test from "node:test";
import assert from "node:assert/strict";
import { validGlobalBacktestPreset, tradeWithExitProfile, exitProfileOfTrade }
  from "../worker/trade-preset.js";

const preset = () => ({
  enabled: Array(41).fill(true),
  timeframe: "15m", riskReward: 2, minMatches: 2,
  atrMultiplier: 1.5, breakevenAtR: "hybrid",
  momentumEnabled: false, card: "optimized", positionSize: 0.001
});

test("full backtest preset validates realistic Bitcoin settings", () => {
  assert.equal(validGlobalBacktestPreset(preset(), 41), true);
  for (const exit of [null, 1, 1.5, 2, "hybrid"]) {
    assert.equal(validGlobalBacktestPreset({ ...preset(), breakevenAtR: exit }, 41), true);
  }
});

test("invalid or oversized trade sizes, unsupported ATR, missing strategies are rejected", () => {
  for (const change of [
    { positionSize: 0 }, { positionSize: 0.00105 }, { positionSize: 51 },
    { atrMultiplier: 9 }, { breakevenAtR: "arbitrary" }, { card: "unknown" },
    { enabled: Array(41).fill(false) }, { minMatches: 99 },
    { momentumEnabled: "true" }, { timeframe: "4h" },
    { enabled: [true, ...Array(40).fill(false)], minMatches: 2 }
  ]) {
    assert.equal(validGlobalBacktestPreset({ ...preset(), ...change }, 41), false);
  }
});

test("new positions preserve exit profile in Main / AI / DEMO keys", () => {
  const keys = ["server:15m:1794612210:BUY", "ai:15m:1794612210:SELL"];
  for (const key of keys) for (const exit of [null, 1, 1.5, 2, "hybrid"]) {
    const frozen = tradeWithExitProfile(key, exit);
    assert.deepEqual(exitProfileOfTrade(frozen), { applied: true, exitProfile: exit });
    assert.deepEqual(exitProfileOfTrade("demo:" + frozen), { applied: true, exitProfile: exit });
  }
});

test("old trades keep their original exit logic", () => {
  for (const key of ["server:15m:1794612210:BUY", "ai:15m:1794612210:SELL",
    "demo:server:15m:1794612210:BUY"]) {
    assert.deepEqual(exitProfileOfTrade(key), { applied: false, exitProfile: null });
  }
  assert.deepEqual(exitProfileOfTrade("ai:15m:1794612210:BUY:preset-garbage"),
    { applied: false, exitProfile: null });
});
