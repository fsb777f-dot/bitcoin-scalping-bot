// The current 5m bar can confirm an entry only against previously known zones.
function completedFrame(candles, index, count) {
  const last = candles[index];
  if ((last.time + 300) % (count * 300) || index < count - 1) return null;
  const bars = candles.slice(index + 1 - count, index + 1);
  if (bars.some((bar, i) => bar.time !== bars[0].time + i * 300)) return null;
  return { open: bars[0].open, close: last.close, high: Math.max(...bars.map(c => c.high)),
    low: Math.min(...bars.map(c => c.low)) };
}

export function zoneSignals(candles) {
  let closes = [], halfHours = [], zones = [], signals = [];
  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i], prev = candles[i - 1];
    if (prev && bar.time !== prev.time + 300) {
      closes = []; halfHours = []; zones = [];
    }
    const [a, b, c] = closes;
    const trend = a < b && b < c ? 'BUY' : a > b && b > c ? 'SELL' : 'WAIT';
    zones = zones.filter(z => z.side === 'BUY' ? bar.close >= z.low : bar.close <= z.high);
    for (const zone of zones) {
      const touch = bar.low <= zone.high && bar.high >= zone.low;
      const buy = zone.side === 'BUY';
      if (i >= 239 && trend === zone.side && (touch || zone.touched)
          && (buy ? bar.close > prev.high && bar.close > zone.high
                  : bar.close < prev.low && bar.close < zone.low)) {
        if (candles[i + 1]?.time === bar.time + 300) signals[i + 1] = zone.side;
        zone.used = true;
      }
      zone.touched = touch;
    }
    zones = zones.filter(z => !z.used);
    const hours = completedFrame(candles, i, 48);
    if (hours) closes = [...closes.slice(-2), hours.close];
    const half = completedFrame(candles, i, 6);
    if (!half) continue;
    halfHours = [...halfHours.slice(-2), half];
    if (halfHours.length < 3) continue;
    const [left, pivot, right] = halfHours;
    if (pivot.low < left.low && pivot.low < right.low && right.close >= pivot.low)
      zones.push({ side: 'BUY', low: pivot.low, high: Math.min(pivot.open, pivot.close) });
    if (pivot.high > left.high && pivot.high > right.high && right.close <= pivot.high)
      zones.push({ side: 'SELL', low: Math.max(pivot.open, pivot.close), high: pivot.high });
    zones = zones.slice(-4);
  }
  return signals;
}
