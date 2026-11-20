// At the reference size of 0.0005 BTC, a $400 price move earns $0.20.
// The same price steps scale the protected USD amount with position size.
export function btcProfitStop(trade, quote, update, gap = 0) {
  const sign = trade.side === "BUY" ? 1 : -1;
  const entry = Number(trade.entry);
  const current = Number(trade.sl);
  const move = sign * (quote - entry);
  const steps = Math.floor((move + 1e-8) / 400);
  if (!(steps >= 2 && entry > 0 && current > 0)) return update;
  let candidate = entry + sign * (steps - 1) * 400;
  if (steps === 5 && move > 2000 + gap) candidate = entry + sign * 2000;
  candidate = Math.round(candidate * 100) / 100;
  if (sign * (quote - candidate) <= gap || sign * (candidate - current) <= 0) return update;
  if (update && sign * (update.sl - candidate) >= 0 && sign * (quote - update.sl) >= gap) return update;
  return { ...update, sl: candidate, trailing_active: true };
}
