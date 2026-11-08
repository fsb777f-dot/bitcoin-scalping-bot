export const name = "Fibonacci Retracement";

// Trend-following pullback strategy.
// Uses the latest 50 completed candles to identify the active swing and
// waits for a candle rejection of a standard Fibonacci retracement level.
export default function fibonacciRetracement(c) {
  const candles = Array.isArray(c?.candles) ? c.candles : [];
  if (candles.length < 55) return "WAIT";

  const trend = Number(c.fibTrend);
  if (trend !== 1 && trend !== -1) return "WAIT";

  const window = candles.slice(-51, -1);
  const last = candles.at(-1);
  const previous = candles.at(-2);
  if (!last || !previous) return "WAIT";

  let high = -Infinity;
  let low = Infinity;
  let highIndex = -1;
  let lowIndex = -1;

  for (let i = 0; i < window.length; i++) {
    if (window[i].high > high) {
      high = window[i].high;
      highIndex = i;
    }
    if (window[i].low < low) {
      low = window[i].low;
      lowIndex = i;
    }
  }

  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return "WAIT";

  const candleRange = Math.max(last.high - last.low, Number.EPSILON);
  const bullish = last.close > last.open;
  const bearish = last.close < last.open;
  const levels = [0.382, 0.5, 0.618, 0.786];

  if (trend === 1) {
    // An up-swing must run from the low to the later high.
    if (lowIndex >= highIndex) return "WAIT";
    for (const ratio of levels) {
      const level = high - range * ratio;
      const touched = last.low <= level && last.high >= level;
      const reclaimed = last.close > level && previous.close <= level;
      const rejection = touched && bullish && last.close > level &&
        (last.close - last.low) / candleRange >= 0.55;
      if (reclaimed || rejection) return "BUY";
    }
  } else {
    // A down-swing must run from the high to the later low.
    if (highIndex >= lowIndex) return "WAIT";
    for (const ratio of levels) {
      const level = low + range * ratio;
      const touched = last.high >= level && last.low <= level;
      const rejected = last.close < level && previous.close >= level;
      const rejection = touched && bearish && last.close < level &&
        (last.high - last.close) / candleRange >= 0.55;
      if (rejected || rejection) return "SELL";
    }
  }

  return "WAIT";
}
