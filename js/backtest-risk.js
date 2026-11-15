// Exit experiment for historical BTCUSD backtests only; live orders use their unchanged rules.
// The input is the executable closing quote (Bid for BUY, Ask for SELL).
export function backtestBreakevenTrailUpdate(trade, quote, triggerR) {
  const entry = Number(trade?.entry);
  const stop = Number(trade?.sl);
  const risk = Number(trade?.initial_risk);
  const side = trade?.side;
  if (!["BUY", "SELL"].includes(side)
      || ![entry, stop, quote, risk, triggerR].every(Number.isFinite)
      || entry <= 0 || risk <= 0 || triggerR <= 0) return null;

  const buy = side === "BUY";
  const progress = buy ? quote - entry : entry - quote;
  if (!trade.breakeven_active) {
    if (progress < risk * triggerR) return null;
    // First confirmed close reaching the selected R-level protects the ENTRY.
    // Fees and future stop slippage can still make the result negative.
    return {
      sl: buy ? Math.max(stop, entry) : Math.min(stop, entry),
      breakeven_active: true,
      trailing_active: true
    };
  }

  // On subsequent completed candles, trail behind the executable quote by 0.6R.
  // Never widen a protective stop, and never inspect an unfinished candle.
  const buffer = risk * 0.6;
  const proposal = buy ? quote - buffer : quote + buffer;
  const updated = buy ? Math.max(stop, proposal) : Math.min(stop, proposal);
  if (buy ? updated <= stop + 1e-8 : updated >= stop - 1e-8) return null;
  return { sl: updated, trailing_active: true };
}
