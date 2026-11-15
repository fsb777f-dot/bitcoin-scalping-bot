import { virtualTargetTrailUpdate } from "../worker/partial-profit.js";

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

// Hybrid experiment: protect entry at +1.5R, keep the ORIGINAL TP-stop rule
// and, beyond TP, trail with a 0.6R buffer. This never changes live trading.
// This method is called only after the bar's pre-existing SL was checked.
// Its update is effective from the NEXT bar, not inside the trigger candle.
export function backtestHybridTrailUpdate(trade, executableClose) {
  const entry = Number(trade?.entry);
  const stop = Number(trade?.sl);
  const risk = Number(trade?.initial_risk);
  const target = Number(trade?.initial_tp ?? trade?.tp);
  const buy = trade?.side === "BUY";
  if (trade?.side !== "BUY" && trade?.side !== "SELL") return null;
  if (![entry, stop, risk, target, executableClose].every(Number.isFinite)
      || entry <= 0 || risk <= 0 || (buy ? target <= entry : target >= entry)) return null;

  const progress = buy ? executableClose - entry : entry - executableClose;
  const targetDistance = Math.abs(target - entry);
  // TP has priority, including configurations with R/R <= 1.5.
  if (progress >= targetDistance) {
    const protectedStop = virtualTargetTrailUpdate(trade, executableClose);
    if (!protectedStop) return null;
    return { ...protectedStop, breakeven_active: true, hybrid_tp_active: true };
  }

  // Between entry and TP: only protect breakeven; do not prematurely trail.
  if (!trade.breakeven_active && progress >= risk * 1.5) {
    return {
      sl: buy ? Math.max(stop, entry) : Math.min(stop, entry),
      breakeven_active: true,
      trailing_active: true
    };
  }
  return null;
}
