// Experimental candle-based momentum confirmation.
// This is NOT a 20-second tick-price forecast: it only uses completed BTCUSD candles.
export function candleMomentum(candles, atr) {
  const neutral = { side: "WAIT", velocity: 0, acceleration: 0 };
  if (!Array.isArray(candles) || candles.length < 3 || !Number.isFinite(atr) || atr <= 0)
    return neutral;

  const [older, previous, latest] = candles.slice(-3);
  const prices = [older?.close, previous?.close, latest?.close];
  if (!prices.every(price => Number.isFinite(price) && price > 0)) return neutral;

  const velocity = latest.close - previous.close; // USD per completed candle
  const previousVelocity = previous.close - older.close;
  const acceleration = velocity - previousVelocity; // change in USD per candle
  // ATR normalization makes the minimum movement scale with current volatility.
  const minVelocity = atr * 0.03;
  const minAcceleration = atr * 0.01;
  const side = velocity > minVelocity && acceleration > minAcceleration ? "BUY"
    : velocity < -minVelocity && acceleration < -minAcceleration ? "SELL" : "WAIT";

  return { side, velocity, acceleration };
}

export function momentumConfirms(side, momentum) {
  return (side !== "BUY" && side !== "SELL") || momentum?.side === side;
}
