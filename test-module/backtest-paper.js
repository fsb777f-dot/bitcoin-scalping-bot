// Isolated 41-strategy paper trader. It never writes to the old SMB/Brooks/Cameron journal.
import { buildContext } from "../js/indicators.js";
import { names, strategies } from "../strategies/index.js";
import { spreadSafeStopDistance, virtualTargetTrailUpdate, virtualStopFill } from "../worker/partial-profit.js";

const rounded = value => Math.round(value * 100) / 100;
const direction = side => side === "BUY" ? 1 : -1;
const validPreset = p => p && Array.isArray(p.enabled) && p.enabled.length === names.length
  && p.enabled.some(Boolean) && ["1m", "5m", "15m"].includes(p.timeframe)
  && [1, 1.5, 2, 2.5, 3, 4].includes(p.riskReward)
  && Number.isInteger(p.minMatches) && p.minMatches >= 1 && p.minMatches <= names.length;

export function updateBacktestPaper(preset, previous, market) {
  if (!validPreset(preset)) return previous || null;
  const candles = market.frames?.[preset.timeframe] || [];
  const latest = candles.at(-1);
  if (!latest || candles.length < 60 || !Number.isFinite(market.bid) || !Number.isFinite(market.ask)) return previous || null;
  const changed = previous?.applied_at !== preset.applied_at;
  const state = changed || !previous ? {
    applied_at: preset.applied_at, lastCandle: latest.time,
    side: "WAIT", count: 0, confirmations: [],
    stats: { total: 0, wins: 0, losses: 0, pnl: 0 }, openTrades: [], recentClosed: []
  } : { ...previous, stats: { ...previous.stats },
    openTrades: [...(previous.openTrades || [])], recentClosed: [...(previous.recentClosed || [])] };

  // Settle old positions using executable bid/ask, then move the stop only after TP.
  const remaining = [];
  for (const existing of state.openTrades) {
    const trade = { ...existing }, quote = trade.side === "BUY" ? market.bid : market.ask;
    const stopped = trade.side === "BUY" ? quote <= trade.sl : quote >= trade.sl;
    if (stopped) {
      const exit = virtualStopFill(trade.side, trade.sl, quote);
      const pnl = direction(trade.side) * (exit - trade.entry);
      state.stats.pnl += pnl;
      if (pnl > 0) state.stats.wins++;
      else if (pnl < 0) state.stats.losses++;
      state.recentClosed.unshift({ ...trade, exit: rounded(exit), pnl: rounded(pnl), closed: Date.now(), status: "CLOSED" });
    } else {
      const update = virtualTargetTrailUpdate(trade, quote);
      if (update) Object.assign(trade, update);
      remaining.push(trade);
    }
  }
  state.openTrades = remaining;
  state.recentClosed = state.recentClosed.slice(0, 40);

  if (latest.time > Number(state.lastCandle || 0)) {
    const context = buildContext(candles.slice(-240));
    const votes = strategies.map(fn => { try { return fn(context); } catch { return "WAIT"; } });
    const buys = votes.filter((s, i) => preset.enabled[i] && s === "BUY").length;
    const sells = votes.filter((s, i) => preset.enabled[i] && s === "SELL").length;
    const side = buys >= preset.minMatches && buys > sells ? "BUY"
      : sells >= preset.minMatches && sells > buys ? "SELL" : "WAIT";
    const count = side === "BUY" ? buys : side === "SELL" ? sells : 0;
    state.side = side;
    state.count = count;
    state.confirmations = side === "WAIT" ? [] : names.filter((_, i) => preset.enabled[i] && votes[i] === side);
    const distance = spreadSafeStopDistance(Number(context.atr) * 1.2, Number(market.spread) || market.ask - market.bid);
    if (side !== "WAIT" && Number.isFinite(distance) && distance > 0) {
      const entry = side === "BUY" ? market.ask : market.bid;
      const sl = entry - direction(side) * distance;
      const tp = entry + direction(side) * distance * preset.riskReward;
      state.openTrades.push({ side, entry, sl, tp, initial_tp: tp,
        trailing_distance: distance, opened: Date.now(), candle: latest.time,
        confirmations: state.confirmations, trailing_active: false, status: "OPEN" });
      state.stats.total++;
    }
    state.lastCandle = latest.time;
  }
  state.floating = rounded(state.openTrades.reduce((sum, t) => sum + direction(t.side) *
    ((t.side === "BUY" ? market.bid : market.ask) - t.entry), 0));
  state.stats.pnl = rounded(state.stats.pnl);
  state.updated_at = new Date().toISOString();
  return state;
}
