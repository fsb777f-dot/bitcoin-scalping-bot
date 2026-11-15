// Applied backtest exit presets. Stored in existing JSON settings (no DB migration).
// A suffix freezes the exit rule for each NEW trade, preserving all older trades.
const exitTags = new Map([
  [null, "legacy"], [1, "be1"], [1.5, "be15"], [2, "be2"], ["hybrid", "hybrid"]
]);
const tagExits = new Map([...exitTags].map(([key, value]) => [value, key]));
export function validBacktestExit(value) {
  return exitTags.has(value);
}
export function tradeWithExitProfile(key, exitProfile) {
  if (!validBacktestExit(exitProfile)) throw new Error("Invalid exit profile");
  return key + ":preset-" + exitTags.get(exitProfile);
}
export function exitProfileOfTrade(key) {
  const match = String(key || "").match(/:preset-(legacy|be1|be15|be2|hybrid)$/);
  if (!match) return { applied: false, exitProfile: null };
  return { applied: true, exitProfile: tagExits.get(match[1]) };
}
export function validGlobalBacktestPreset(p, strategyCount) {
  return p && typeof p === "object" && !Array.isArray(p)
    && Array.isArray(p.enabled) && p.enabled.length === strategyCount
    && p.enabled.some(Boolean) && p.enabled.every(value => typeof value === "boolean")
    && ["1m", "5m", "15m"].includes(p.timeframe)
    && [1, 1.5, 2, 2.5, 3, 4].includes(p.riskReward)
    && Number.isInteger(p.minMatches) && p.minMatches >= 1 && p.minMatches <= strategyCount
    && [1, 1.2, 1.5].includes(p.atrMultiplier)
    && validBacktestExit(p.breakevenAtR)
    && typeof p.momentumEnabled === "boolean"
    && ["control", "optimized", "same-atr", "other-momentum", "ai"].includes(p.card)
    && Number.isFinite(p.positionSize) && p.positionSize >= 0.0001
    && p.positionSize <= 50
    && Math.abs((p.positionSize - 0.0001) / 0.0001
      - Math.round((p.positionSize - 0.0001) / 0.0001)) < 1e-6;
}
