// Virtual-only: take half off at +1 initial risk; trail the rest without TP.
export function virtualPartialUpdate(trade, quote, risk) {
  const buy = trade.side === "BUY";
  const entry = Number(trade.entry), stop = Number(trade.sl);
  const progress = buy ? quote - entry : entry - quote;
  if (![entry, stop, quote, risk].every(Number.isFinite) || risk <= 0) return null;
  if (trade.partial_exit_price == null) {
    if (progress < risk) return null;
    return {
      sl: buy ? Math.max(stop, entry) : Math.min(stop, entry),
      partial_exit_price: quote,
      pnl: progress / 2,
      trailing_active: true,
      result: "HALF_CLOSED"
    };
  }
  if (progress <= risk) return null;
  const candidate = buy ? entry + (progress - risk) / 2 : entry - (progress - risk) / 2;
  const proposed = buy ? Math.max(stop, candidate) : Math.min(stop, candidate);
  if (buy ? proposed <= stop + 1e-8 : proposed >= stop - 1e-8) return null;
  return { sl: proposed, trailing_active: true };
}

export function virtualSettledPnl(trade, exitPrice) {
  const entry = Number(trade.entry);
  const finalMove = trade.side === "BUY" ? exitPrice - entry : entry - exitPrice;
  if (trade.partial_exit_price == null) return finalMove;
  const partialPrice = Number(trade.partial_exit_price);
  const firstMove = trade.side === "BUY" ? partialPrice - entry : entry - partialPrice;
  return (firstMove + finalMove) / 2;
}

// A virtual stop cannot fill better than the executable quote that crossed it.
export function virtualStopFill(side, stop, quote) {
  return side === "BUY" ? Math.min(stop, quote) : Math.max(stop, quote);
}

export function spreadSafeStopDistance(atrDistance, spread) {
  // Entry is Ask for BUY and Bid for SELL. Reserve the quoted spread on top
  // of the ATR protection so the stop is not effectively one tick away.
  return Math.max(atrDistance + spread, spread * 2.05);
}
