// Isolated 5-minute virtual paper trader: RSI Reversal + Stochastic.
// Never sends broker orders, never writes the main/AI/Test trading tables.
import { rsi, stochastic, atr } from "../js/indicators.js";

export function gptSignal(candles) {
  if (!Array.isArray(candles) || candles.length < 30) return { side: "WAIT", rsi: null, stoch_k: null, stoch_d: null };
  const closes = candles.map(c => c.close);
  const strength = rsi(closes, 14);
  const oscillator = stochastic(candles, 14);
  const side = strength < 30 && oscillator.k < 20 && oscillator.k > oscillator.d ? "BUY"
    : strength > 70 && oscillator.k > 80 && oscillator.k < oscillator.d ? "SELL" : "WAIT";
  return { side, rsi: strength, stoch_k: oscillator.k, stoch_d: oscillator.d };
}

function numbersValid(...numbers) { return numbers.every(Number.isFinite); }
const round = value => Math.round(value * 100) / 100;

export async function runGptScan(db, market, prefix) {
  const tradesTable = prefix + "_trades", stateTable = prefix + "_state";
  const candle = market.candles?.at(-1);
  if (!candle || market.candles.length < 60) throw Error("Недостаточно закрытых свечей Capital.com 5m");
  if (!numbersValid(market.bid, market.ask, market.spread) || market.bid <= 0 || market.ask < market.bid) {
    throw Error("Некорректные цены Bid/Ask Capital.com");
  }
  const now = new Date().toISOString();

  // Check the live executable quote on every scheduled minute, including repeated 5m candles.
  const open = await db(tradesTable + "?status=eq.OPEN&select=*");
  for (const trade of open || []) {
    const buy = trade.side === "BUY";
    const price = buy ? market.bid : market.ask;
    const stop = Number(trade.sl), entry = Number(trade.entry), target = Number(trade.tp);
    if (!numbersValid(price, stop, entry, target)) continue;
    const hitStop = buy ? price <= stop : price >= stop;
    if (hitStop) {
      const exit = buy ? Math.min(price, stop) : Math.max(price, stop);
      const pnl = (buy ? exit - entry : entry - exit);
      await db(tradesTable + "?trade_key=eq." + encodeURIComponent(trade.trade_key) + "&status=eq.OPEN", {
        method: "PATCH", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "CLOSED", exit_price: exit, pnl, closed_at: now, updated_at: now })
      });
    } else {
      const targetReached = buy ? price >= target : price <= target;
      if (!targetReached) continue;
      const risk = Math.abs(entry - Number(trade.initial_sl));
      if (!Number.isFinite(risk) || risk <= 0) continue;
      // Stop-only exits: protect target profit first, then follow favorable price movement.
      const desired = buy ? Math.max(target, price - risk * 0.6) : Math.min(target, price + risk * 0.6);
      const nextStop = buy ? Math.max(stop, desired) : Math.min(stop, desired);
      if (buy ? nextStop > stop + 1e-8 : nextStop < stop - 1e-8) {
        await db(tradesTable + "?trade_key=eq." + encodeURIComponent(trade.trade_key) + "&status=eq.OPEN", {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ sl: nextStop, updated_at: now })
        });
      }
    }
  }

  const stateRows = await db(stateTable + "?id=eq.1&select=candle_time");
  const priorCandle = Number(stateRows?.[0]?.candle_time || 0);
  if (candle.time <= priorCandle) return { duplicateCandle: true };

  // Only CLOSED candles can produce a new entry; the fill uses the CURRENT broker quote.
  const signal = gptSignal(market.candles);
  if (signal.side !== "WAIT") {
    const entry = signal.side === "BUY" ? market.ask : market.bid;
    const distance = Math.max(atr(market.candles, 14) * 1.5, market.spread * 3);
    if (Number.isFinite(distance) && distance > 0) {
      const buy = signal.side === "BUY";
      await db(tradesTable + "?on_conflict=trade_key", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          trade_key: prefix + ":5m:" + candle.time + ":" + signal.side,
          candle_time: candle.time, side: signal.side, status: "OPEN",
          entry, initial_sl: buy ? entry - distance : entry + distance,
          sl: buy ? entry - distance : entry + distance,
          tp: buy ? entry + distance * 2 : entry - distance * 2,
          opened_at: now, updated_at: now
        })
      });
    }
  }
  await db(stateTable + "?on_conflict=id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: 1, candle_time: candle.time, side: signal.side,
      rsi: signal.rsi, stoch_k: signal.stoch_k, stoch_d: signal.stoch_d,
      price: market.price, updated_at: now })
  });
  return { side: signal.side, candle_time: candle.time };
}

export async function gptStatus(db, prefix) {
  const tradesTable = prefix + "_trades", stateTable = prefix + "_state";
  const [stateRows, recent] = await Promise.all([
    db(stateTable + "?id=eq.1&select=*"),
    db(tradesTable + "?select=*&order=opened_at.desc&limit=30")
  ]);
  const stats = { total: 0, open: 0, closed: 0, wins: 0, losses: 0, pnl: 0, grossWins: 0, grossLosses: 0 };
  let lastId = 0;
  for (;;) {
    const page = await db(tradesTable + "?select=id,status,pnl&id=gt." + lastId + "&order=id.asc&limit=1000");
    for (const trade of page || []) {
      stats.total++;
      if (trade.status === "OPEN") { stats.open++; continue; }
      if (trade.status !== "CLOSED") continue;
      stats.closed++;
      const p = Number(trade.pnl) || 0;
      stats.pnl += p;
      if (p > 0) { stats.wins++; stats.grossWins += p; }
      else if (p < 0) { stats.losses++; stats.grossLosses -= p; }
    }
    if (!page?.length || page.length < 1000) break;
    lastId = Number(page.at(-1).id);
    if (!Number.isSafeInteger(lastId)) throw Error("Неверный идентификатор журнала ЧПТ");
  }
  return {
    symbol: prefix === "gold_gpt" ? "XAUUSD" : "BTCUSD",
    timeframe: "5m", mode: "VIRTUAL_ONLY", source: "Capital.com Demo",
    rules: "RSI(14) reversal + Stochastic(14,3), both agree; ATR(14) × 1.5 SL, 2R trailing activation",
    state: stateRows?.[0] || null,
    stats: { ...stats, pnl: round(stats.pnl), winrate: stats.closed ? round(stats.wins / stats.closed * 100) : null,
      profit_factor: stats.grossLosses ? round(stats.grossWins / stats.grossLosses) : null },
    trades: recent || []
  };
}
