import { buildContext } from "../js/indicators.js";
import { strategies, names } from "../strategies/index.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};
const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "Content-Type": "application/json" }
});
const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || min));

function supabaseHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: "Bearer " + env.SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    ...extra
  };
}
async function db(env, path, init = {}) {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const response = await fetch(base + "/rest/v1/" + path, {
    ...init,
    headers: supabaseHeaders(env, init.headers || {})
  });
  const body = await response.text();
  if (!response.ok) throw new Error("Supabase " + response.status + ": " + body.slice(0, 500));
  return body ? JSON.parse(body) : null;
}
async function getSettings(env) {
  const rows = await db(env, "bot_settings?id=eq.1&select=*");
  const s = rows?.[0] || {};
  const enabled = Array.isArray(s.enabled_strategies) && s.enabled_strategies.length === names.length
    ? s.enabled_strategies.map(Boolean) : names.map(() => true);
  return {
    timeframe: s.timeframe === "5m" ? "5m" : "1m",
    enabled,
    consensusEnabled: s.consensus_enabled !== false,
    requiredMatches: clamp(s.required_matches ?? 3, 1, names.length),
    riskReward: [1, 1.5, 2, 2.5, 3, 4].includes(Number(s.risk_reward)) ? Number(s.risk_reward) : 2
  };
}
async function bybitRequest(path) {
  const response = await fetch("https://api.bybit.com" + path, {
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) throw new Error("Bybit " + path.split("?")[0] + " HTTP " + response.status);
  const data = await response.json();
  if (data.retCode !== 0) throw new Error("Bybit API " + data.retCode + ": " + data.retMsg);
  return data.result;
}
async function bybitCandles(timeframe) {
  const interval = timeframe === "5m" ? "5" : "1";
  const result = await bybitRequest("/v5/market/kline?category=spot&symbol=BTCUSDT&interval=" + interval + "&limit=300");
  // Bybit returns newest first. Sort oldest first and ignore the still-forming candle.
  const raw = (result.list || []).slice().reverse();
  return raw.slice(0, -1).map(k => ({
    time: Number(k[0]) / 1000, open: +k[1], high: +k[2], low: +k[3],
    close: +k[4], volume: +k[5]
  }));
}
async function currentPrice() {
  const result = await bybitRequest("/v5/market/tickers?category=spot&symbol=BTCUSDT");
  const price = Number(result.list?.[0]?.lastPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Bybit returned an invalid BTCUSDT price");
  return price;
}
async function saveState(env, state) {
  await db(env, "bot_state?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: 1, ...state, updated_at: new Date().toISOString() })
  });
}
async function insertTradeOnce(env, trade) {
  // Ignore duplicates so a retry cannot reopen a position that was already closed.
  await db(env, "trades?on_conflict=trade_key", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(trade)
  });
}
async function patchTrade(env, key, patch) {
  await db(env, "trades?trade_key=eq." + encodeURIComponent(key), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
}
async function updateOpenTrades(env, price) {
  const open = await db(env, "trades?status=eq.OPEN&select=*");
  for (const t of open || []) {
    let sl = Number(t.sl);
    const distance = Number(t.trailing_distance) || Math.abs(Number(t.entry) - sl);
    let trailingActive = Boolean(t.trailing_active);
    let exit = null, pnl = null, result = null, status = "OPEN";
    if (!trailingActive) {
      const stopped = t.side === "BUY" ? price <= sl : price >= sl;
      const target = t.side === "BUY" ? price >= Number(t.tp) : price <= Number(t.tp);
      if (stopped) {
        exit = sl; pnl = t.side === "BUY" ? exit - Number(t.entry) : Number(t.entry) - exit;
        status = "CLOSED"; result = "SL";
      } else if (target) {
        trailingActive = true;
        sl = Number(t.tp);
      }
    }
    if (status === "OPEN" && trailingActive && distance > 0) {
      const nextStop = t.side === "BUY" ? price - distance : price + distance;
      if (t.side === "BUY" && nextStop > sl) sl = nextStop;
      if (t.side === "SELL" && nextStop < sl) sl = nextStop;
      const hit = t.side === "BUY" ? price <= sl : price >= sl;
      if (hit) {
        exit = sl; pnl = t.side === "BUY" ? exit - Number(t.entry) : Number(t.entry) - exit;
        status = "CLOSED"; result = "TRAILING_STOP";
      }
    }
    await patchTrade(env, t.trade_key, {
      sl, trailing_active: trailingActive, exit, pnl, status, result
    });
  }
}
async function runScan(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in Worker secrets");
  const settings = await getSettings(env);
  const [candles, price] = await Promise.all([bybitCandles(settings.timeframe), currentPrice()]);
  if (candles.length < 60) throw new Error("Not enough completed candles");
  const context = buildContext(candles);
  const results = strategies.map(fn => { try { return fn(context); } catch { return "WAIT"; } });
  const activeCount = settings.enabled.filter(Boolean).length;
  const required = settings.consensusEnabled ? settings.requiredMatches : 1;
  const buys = results.filter((s, i) => settings.enabled[i] && s === "BUY").length;
  const sells = results.filter((s, i) => settings.enabled[i] && s === "SELL").length;
  const side = activeCount >= required
    ? buys >= required && buys > sells ? "BUY"
    : sells >= required && sells > buys ? "SELL" : "WAIT"
    : "WAIT";
  const count = side === "BUY" ? buys : side === "SELL" ? sells : Math.max(buys, sells);
  const candle = candles[candles.length - 1];
  const slDistance = context.atr * 1.2;
  const entry = side === "WAIT" ? null : price;
  const sl = side === "BUY" ? entry - slDistance : side === "SELL" ? entry + slDistance : null;
  const tp = side === "BUY" ? entry + slDistance * settings.riskReward
    : side === "SELL" ? entry - slDistance * settings.riskReward : null;

  await updateOpenTrades(env, price);
  if (side !== "WAIT") {
    const tradeKey = "server:" + settings.timeframe + ":" + candle.time + ":" + side;
    await insertTradeOnce(env, {
      trade_key: tradeKey, trade_time: Date.now(), side, entry, sl, tp,
      initial_tp: tp, trailing_distance: Math.abs(entry - sl), trailing_active: false,
      confirmations: names.filter((_, i) => settings.enabled[i] && results[i] === side),
      exit: null, pnl: null, status: "OPEN", result: null,
      updated_at: new Date().toISOString()
    });
  }
  await saveState(env, {
    timeframe: settings.timeframe, price, side, count, active_count: activeCount,
    required_matches: required, consensus_enabled: settings.consensusEnabled,
    entry, sl, tp, candle_time: candle.time,
    strategy_results: names.map((name, i) => ({ name, signal: results[i], enabled: settings.enabled[i] })),
    last_error: null
  });
  return { ok: true, price, side, count, activeCount, required, candleTime: candle.time };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env).catch(async error => {
      console.error("Scheduled scan failed:", error);
      try { await saveState(env, { last_error: String(error), side: "WAIT" }); } catch (e) { console.error(e); }
    }));
  },
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (url.pathname === "/health") return reply({ ok: true, service: "bitcoin-scalping-server", mode: "VIRTUAL_ONLY" });
    if (url.pathname === "/api/state" && request.method === "GET") {
      try {
        const rows = await db(env, "bot_state?id=eq.1&select=*");
        return reply(rows?.[0] || { ok: true, message: "Сканер ещё не выполнил первый проход" });
      } catch (e) { return reply({ error: String(e) }, 500); }
    }
    return reply({ error: "Not found" }, 404);
  }
};