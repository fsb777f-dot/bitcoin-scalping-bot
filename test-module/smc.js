// Isolated SMC paper test. All signals use completed Capital.com candles only.
const WAIT = { side: "WAIT", reason: "Ожидание структуры, зоны и CHoCH" };

function pivot(candles, i, radius, kind) {
  const value = candles[i]?.[kind];
  if (!Number.isFinite(value) || i < radius || i + radius >= candles.length) return false;
  for (let j = i - radius; j <= i + radius; j++) {
    if (j !== i && (kind === "high" ? candles[j][kind] >= value : candles[j][kind] <= value)) return false;
  }
  return true;
}

function marketBias(hourly) {
  let high = null, low = null, side = "WAIT", breakType = null;
  const r = 5;
  for (let i = r * 2; i < hourly.length; i++) {
    const index = i - r;
    if (pivot(hourly, index, r, "high")) high = hourly[index].high;
    if (pivot(hourly, index, r, "low")) low = hourly[index].low;
    const previous = hourly[i - 1].close, close = hourly[i].close;
    if (high != null && previous <= high && close > high) {
      breakType = side === "SELL" ? "CHoCH" : "BOS";
      side = "BUY";
    } else if (low != null && previous >= low && close < low) {
      breakType = side === "BUY" ? "CHoCH" : "BOS";
      side = "SELL";
    }
  }
  return { side, breakType };
}

function zones(five, side) {
  const result = [];
  for (let i = Math.max(7, five.length - 120); i < five.length; i++) {
    const current = five[i], before = five[i - 2];
    if (side === "BUY" && current.low > before.high) {
      result.push({ type: "FVG", low: before.high, high: current.low, time: current.time + 300, i });
    } else if (side === "SELL" && current.high < before.low) {
      result.push({ type: "FVG", low: current.high, high: before.low, time: current.time + 300, i });
    }
    const earlier = five.slice(i - 6, i);
    const highest = Math.max(...earlier.map(c => c.high));
    const lowest = Math.min(...earlier.map(c => c.low));
    const broke = side === "BUY" ? current.close > highest : current.close < lowest;
    if (!broke) continue;
    const opposite = five.slice(i - 3, i).findLast(c => side === "BUY" ? c.close < c.open : c.close > c.open);
    if (opposite) result.push({ type: "OB", low: opposite.low, high: opposite.high, time: current.time + 300, i });
  }
  return result.reverse();
}

function localBreak(one, touchIndex, side) {
  const last = one.at(-1), previous = one.at(-2);
  const kind = side === "BUY" ? "high" : "low";
  let level = null;
  for (let i = Math.max(2, touchIndex - 25); i < one.length - 3; i++) {
    if (pivot(one, i, 2, kind)) level = one[i][kind];
  }
  if (level == null) return false;
  return side === "BUY" ? previous.close <= level && last.close > level
    : previous.close >= level && last.close < level;
}

export function evaluateSmc(frames) {
  const one = frames?.["1m"], five = frames?.["5m"], hourly = frames?.["1h"];
  if (![one, five, hourly].every(x => Array.isArray(x) && x.length >= 60)) return { ...WAIT, reason: "Недостаточно закрытых свечей" };
  const bias = marketBias(hourly);
  if (bias.side === "WAIT") return { ...WAIT, bias: "WAIT", reason: "Нет подтверждённого BOS/CHoCH на 1H" };
  const last = one.at(-1);
  for (const zone of zones(five, bias.side)) {
    // A zone cannot be traded before its creating 5m candle has closed.
    const invalidated = five.slice(zone.i + 1).some(c => bias.side === "BUY" ? c.close < zone.low : c.close > zone.high);
    if (invalidated) continue;
    let touch = -1;
    for (let i = Math.max(0, one.length - 13); i < one.length - 1; i++) {
      const c = one[i];
      if (c.time >= zone.time && c.low <= zone.high && c.high >= zone.low) touch = i;
    }
    if (touch < 0 || !localBreak(one, touch, bias.side)) continue;
    const recent = one.slice(Math.max(0, touch - 2));
    const extremes = bias.side === "BUY" ? Math.min(...recent.map(c => c.low)) : Math.max(...recent.map(c => c.high));
    return { side: bias.side, bias: bias.side, breakType: bias.breakType, zone: {
      type: zone.type, low: zone.low, high: zone.high
    }, extreme: extremes, candleTime: last.time, reason: zone.type + " 5m → CHoCH 1m" };
  }
  return { ...WAIT, bias: bias.side, breakType: bias.breakType, reason: "Ожидание касания OB/FVG и CHoCH на 1m" };
}

export function updateSmcPaper(previous, market) {
  const old = previous && typeof previous === "object" ? previous : {};
  const trades = Array.isArray(old.trades) ? old.trades.slice() : [];
  const stats = { opened: 0, wins: 0, losses: 0, pnl: 0, ...(old.stats || {}) };
  if (market.analysis?.source !== "Capital.com Demo" || !Number.isFinite(market.bid) || !Number.isFinite(market.ask)) {
    return { ...old, trades, stats, signal: { ...WAIT, reason: "SMC ждёт котировки Capital.com" }, updated_at: new Date().toISOString() };
  }
  const result = evaluateSmc(market.frames);
  const recent = market.frames["1m"].slice(-15);
  const averageRange = recent.reduce((sum, c) => sum + c.high - c.low, 0) / recent.length;
  const gap = Math.max(averageRange * 1.2, market.spread * 1.1, 1);
  const now = Date.now();
  for (const trade of trades) {
    if (trade.status !== "OPEN") continue;
    const exit = trade.side === "BUY" ? market.bid : market.ask;
    const stopped = trade.side === "BUY" ? exit <= trade.sl : exit >= trade.sl;
    if (stopped) {
      trade.status = "CLOSED";
      trade.exit = exit; // Use the executable quote, not an optimistic stop fill.
      trade.pnl = trade.side === "BUY" ? exit - trade.entry : trade.entry - exit;
      trade.result = "SL";
      trade.closedAt = now;
      stats.pnl += trade.pnl;
      if (trade.pnl > 0) stats.wins++;
      else if (trade.pnl < 0) stats.losses++;
    } else {
      const profit = trade.side === "BUY" ? exit - trade.entry : trade.entry - exit;
      if (profit > Math.max(averageRange, market.spread)) {
        const trailing = trade.side === "BUY"
          ? Math.max(trade.entry, exit - gap) : Math.min(trade.entry, exit + gap);
        trade.sl = trade.side === "BUY" ? Math.max(trade.sl, trailing) : Math.min(trade.sl, trailing);
      }
    }
  }
  if (result.side !== "WAIT" && result.candleTime !== old.lastSignalCandle) {
    const entry = result.side === "BUY" ? market.ask : market.bid;
    const padding = Math.max(averageRange * .2, market.spread * .15);
    const sl = result.side === "BUY" ? Math.min(result.extreme - padding, entry - gap)
      : Math.max(result.extreme + padding, entry + gap);
    trades.unshift({ id: "smc:" + result.candleTime, side: result.side, status: "OPEN",
      entry, sl, tp: null, openedAt: now, source: "Capital.com Demo", zone: result.zone });
    stats.opened++;
  }
  const openTrades = trades.filter(t => t.status === "OPEN");
  const closedTrades = trades.filter(t => t.status !== "OPEN").slice(0, 300);
  return { trades: [...openTrades, ...closedTrades].sort((a, b) => b.openedAt - a.openedAt), stats,
    signal: result, lastSignalCandle: result.side !== "WAIT" ? result.candleTime : old.lastSignalCandle,
    updated_at: new Date().toISOString() };
}
