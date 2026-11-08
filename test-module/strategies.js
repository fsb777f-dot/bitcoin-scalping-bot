// Isolated experimental strategies. This module never imports the production strategy registry.
const ema = (values, period) => {
  if (values.length < period) return null;
  let value = values.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
};
const atr = (candles, period = 14) => {
  if (candles.length < period + 1) return 0;
  const ranges = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], previous = candles[i - 1].close;
    ranges.push(Math.max(c.high - c.low, Math.abs(c.high - previous), Math.abs(c.low - previous)));
  }
  return ranges.slice(-period).reduce((sum, n) => sum + n, 0) / period;
};
const bodyDirection = candle => candle.close > candle.open ? 1 : candle.close < candle.open ? -1 : 0;

export const TEST_STRATEGIES = [
  { id: "brooks", name: "Brooks · Second Entry", description: "Тренд, коррекция и второе подтверждение" },
  { id: "cameron", name: "Cameron · Momentum", description: "Импульс, короткий откат и пробой" },
  { id: "smb", name: "SMB · Continuation", description: "Продолжение тренда после консолидации" }
];

export function evaluateTestStrategies(candles) {
  const waiting = { brooks: "WAIT", cameron: "WAIT", smb: "WAIT" };
  if (!Array.isArray(candles) || candles.length < 60) return waiting;
  const closes = candles.map(c => c.close);
  const fast = ema(closes, 20), slow = ema(closes, 50), range = atr(candles);
  if (!range || !Number.isFinite(fast) || !Number.isFinite(slow)) return waiting;

  const last = candles.at(-1), previous = candles.at(-2);
  const trend = fast > slow ? 1 : fast < slow ? -1 : 0;
  const result = { ...waiting };

  // Brooks proxy: trend + multi-candle pullback + second attempt to resume trend.
  if (trend) {
    const pullback = candles.slice(-6, -2);
    const counterBars = pullback.filter(c => bodyDirection(c) === -trend).length;
    const firstAttempt = trend === 1
      ? candles.at(-3).high > candles.at(-4).high
      : candles.at(-3).low < candles.at(-4).low;
    const secondEntry = trend === 1
      ? last.close > previous.high && bodyDirection(last) === 1
      : last.close < previous.low && bodyDirection(last) === -1;
    if (counterBars >= 2 && firstAttempt && secondEntry) result.brooks = trend === 1 ? "BUY" : "SELL";
  }

  // Cameron proxy: strong recent impulse, shallow pullback, then break of pullback bar.
  const impulse = candles.slice(-9, -4);
  const impulseMove = impulse.at(-1).close - impulse[0].open;
  const pullbackBars = candles.slice(-4, -1);
  const pullbackAgainst = pullbackBars.filter(c => bodyDirection(c) === -Math.sign(impulseMove)).length;
  const impulseStrong = Math.abs(impulseMove) >= range * 1.8;
  const resumed = impulseMove > 0
    ? last.close > previous.high && last.close > last.open
    : impulseMove < 0 && last.close < previous.low && last.close < last.open;
  if (impulseStrong && pullbackAgainst >= 1 && resumed) result.cameron = impulseMove > 0 ? "BUY" : "SELL";

  // SMB proxy: aligned trend, tight pause, close outside the pause range.
  const pause = candles.slice(-7, -1);
  const pauseHigh = Math.max(...pause.map(c => c.high));
  const pauseLow = Math.min(...pause.map(c => c.low));
  const tightPause = pauseHigh - pauseLow <= range * 2.2;
  if (tightPause && trend === 1 && last.close > pauseHigh && last.close > last.open) result.smb = "BUY";
  if (tightPause && trend === -1 && last.close < pauseLow && last.close < last.open) result.smb = "SELL";

  return result;
}

export function testRiskLevels(side, entry, candles, rewardRisk = 2) {
  const distance = atr(candles) * 1.2;
  if (!distance || !Number.isFinite(entry) || !["BUY", "SELL"].includes(side)) return null;
  return side === "BUY"
    ? { sl: entry - distance, tp: entry + distance * rewardRisk }
    : { sl: entry + distance, tp: entry - distance * rewardRisk };
}
