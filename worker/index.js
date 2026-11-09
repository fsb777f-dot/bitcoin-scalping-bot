import { buildContext } from "../js/indicators.js";
import { strategies, names } from "../strategies/index.js";
import { capitalDemoStatus } from "./capital-demo.js";

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
  const base = (env.SUPABASE_URL || "https://pycdhpsmxhmvuyqerotb.supabase.co").replace(/\/+$/, "");
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
    aiEnabled: s.ai_enabled === true,
    enabled,
    consensusEnabled: s.consensus_enabled !== false,
    requiredMatches: clamp(s.required_matches ?? 3, 1, names.length),
    riskReward: [1, 1.5, 2, 2.5, 3, 4].includes(Number(s.risk_reward)) ? Number(s.risk_reward) : 2
  };
}
async function bybitRequest(path) {
  let response;
  try {
    response = await fetch("https://api.bybit.com" + path, {
      headers: { "Accept": "application/json" }
    });
  } catch (error) {
    const detail = error?.message || error?.cause?.message || JSON.stringify(error) || String(error);
    throw new Error("Bybit network request failed (" + (error?.name || "Error") + "): " + detail);
  }
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error("Bybit HTTP " + response.status + " " + path.split("?")[0] + ": " + detail);
  }
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("Bybit returned invalid JSON: " + (error?.message || String(error)));
  }
  if (data.retCode !== 0) throw new Error("Bybit API " + data.retCode + ": " + data.retMsg);
  return data.result;
}
async function bybitCandles(timeframe) {
  const interval = timeframe === "5m" ? "5" : "1";
  const result = await bybitRequest("/v5/market/kline?category=spot&symbol=BTCUSDT&interval=" + interval + "&limit=300");
  const raw = (result.list || []).slice().reverse();
  return raw.slice(0, -1).map(k => ({
    time: Number(k[0]) / 1000, open: +k[1], high: +k[2], low: +k[3],
    close: +k[4], volume: +k[5]
  }));
}
async function bybitPrice() {
  const result = await bybitRequest("/v5/market/tickers?category=spot&symbol=BTCUSDT");
  const price = Number(result.list?.[0]?.lastPrice);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Bybit returned an invalid BTCUSDT price");
  return price;
}
async function binanceRequest(path) {
  const hosts = [
    "https://data-api.binance.vision",
    "https://api.binance.com",
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com"
  ];
  const errors = [];
  for (const host of hosts) {
    try {
      const response = await fetch(host + path, {
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 250);
        errors.push(host + " HTTP " + response.status + ": " + detail);
        continue;
      }
      return await response.json();
    } catch (error) {
      const detail = error?.message || error?.cause?.message || JSON.stringify(error) || String(error);
      errors.push(host + " " + (error?.name || "Error") + ": " + detail);
    }
  }
  throw new Error("All Binance market-data hosts failed for " + path.split("?")[0] + ". " + errors.join(" | "));
}
async function binanceCandles(timeframe) {
  const interval = timeframe === "5m" ? "5m" : "1m";
  const raw = await binanceRequest("/api/v3/klines?symbol=BTCUSDT&interval=" + interval + "&limit=300");
  return raw.slice(0, -1).map(k => ({
    time: Number(k[0]) / 1000, open: +k[1], high: +k[2], low: +k[3],
    close: +k[4], volume: +k[5]
  }));
}
async function binancePrice() {
  const data = await binanceRequest("/api/v3/ticker/price?symbol=BTCUSDT");
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Binance returned an invalid BTCUSDT price");
  return price;
}
async function okxRequest(path) {
  const response = await fetch("https://www.okx.com" + path, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error("OKX HTTP " + response.status + " " + path.split("?")[0] + ": " + detail);
  }
  const data = await response.json();
  if (data.code !== "0" || !Array.isArray(data.data)) {
    throw new Error("OKX API error: " + (data.msg || JSON.stringify(data).slice(0, 300)));
  }
  return data.data;
}
async function okxCandles(timeframe) {
  const bar = timeframe === "5m" ? "5m" : "1m";
  const raw = await okxRequest("/api/v5/market/candles?instId=BTC-USDT&bar=" + bar + "&limit=300");
  return raw.slice().reverse().filter(k => k[8] === "1").map(k => ({
    time: Number(k[0]) / 1000, open: +k[1], high: +k[2], low: +k[3],
    close: +k[4], volume: +k[5]
  }));
}
async function okxPrice() {
  const rows = await okxRequest("/api/v5/market/ticker?instId=BTC-USDT");
  const price = Number(rows[0]?.last);
  if (!Number.isFinite(price) || price <= 0) throw new Error("OKX returned an invalid BTC-USDT price");
  return price;
}
async function krakenRequest(path) {
  const response = await fetch("https://api.kraken.com" + path, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error("Kraken HTTP " + response.status + ": " + detail);
  }
  const data = await response.json();
  if (Array.isArray(data.error) && data.error.length) {
    throw new Error("Kraken API error: " + data.error.join(", "));
  }
  if (!data.result) throw new Error("Kraken returned an empty result");
  return data.result;
}
async function krakenCandles(timeframe) {
  const interval = timeframe === "5m" ? "5" : "1";
  const result = await krakenRequest("/0/public/OHLC?pair=XBTUSD&interval=" + interval);
  const key = Object.keys(result).find(k => k !== "last");
  const rows = key ? result[key] : [];
  // Kraken always includes the currently forming candle as the final row.
  return rows.slice(0, -1).map(k => ({
    time: Number(k[0]), open: +k[1], high: +k[2], low: +k[3],
    close: +k[4], volume: +k[6]
  }));
}
async function krakenPrice() {
  const result = await krakenRequest("/0/public/Ticker?pair=XBTUSD");
  const key = Object.keys(result)[0];
  const price = Number(result[key]?.c?.[0]);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Kraken returned an invalid BTC/USD price");
  return price;
}
async function coinbaseRequest(path) {
  const response = await fetch("https://api.exchange.coinbase.com" + path, {
    headers: { "Accept": "application/json", "User-Agent": "BitcoinScalpingBot/1.0" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error("Coinbase HTTP " + response.status + ": " + detail);
  }
  return response.json();
}
async function coinbaseCandles(timeframe) {
  const granularity = timeframe === "5m" ? "300" : "60";
  const rows = await coinbaseRequest("/products/BTC-USD/candles?granularity=" + granularity);
  if (!Array.isArray(rows)) throw new Error("Coinbase returned invalid candle data");
  return rows.slice().reverse().map(k => ({
    time: Number(k[0]), open: +k[3], high: +k[2], low: +k[1],
    close: +k[4], volume: +k[5]
  }));
}
async function coinbasePrice() {
  const data = await coinbaseRequest("/products/BTC-USD/ticker");
  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Coinbase returned an invalid BTC/USD price");
  return price;
}
async function getMarketData(timeframe) {
  const sources = [
    {
      name: "Kraken",
      get: async () => {
        const [candles, price] = await Promise.all([krakenCandles(timeframe), krakenPrice()]);
        return { candles, price, source: "Kraken" };
      }
    },
    {
      name: "Coinbase",
      get: async () => {
        const [candles, price] = await Promise.all([coinbaseCandles(timeframe), coinbasePrice()]);
        return { candles, price, source: "Coinbase" };
      }
    },
    {
      name: "OKX",
      get: async () => {
        const [candles, price] = await Promise.all([okxCandles(timeframe), okxPrice()]);
        return { candles, price, source: "OKX" };
      }
    },
    {
      name: "Bybit",
      get: async () => {
        const [candles, price] = await Promise.all([bybitCandles(timeframe), bybitPrice()]);
        return { candles, price, source: "Bybit" };
      }
    },
    {
      name: "Binance",
      get: async () => {
        const [candles, price] = await Promise.all([binanceCandles(timeframe), binancePrice()]);
        return { candles, price, source: "Binance" };
      }
    }
  ];
  const errors = [];
  for (const source of sources) {
    try {
      const market = await source.get();
      if (market.candles.length < 60) throw new Error("Not enough completed candles from " + source.name);
      return market;
    } catch (error) {
      errors.push(source.name + ": " + (error?.message || String(error)));
    }
  }
  throw new Error("All market-data sources failed. " + errors.join(" | "));
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
async function getStrategyPerformance(env) {
  const rows = await db(env, "trades?status=eq.CLOSED&trade_key=like.ai%&select=confirmations,pnl,result,trade_time,trade_key&order=trade_time.desc&limit=300");
  return names.map(name => {
    const relevant = (rows || []).filter(t => Array.isArray(t.confirmations) && t.confirmations.includes(name));
    const wins = relevant.filter(t => Number(t.pnl) > 0 || t.result === "TP").length;
    const losses = relevant.filter(t => Number(t.pnl) < 0 || t.result === "SL").length;
    const total = wins + losses;
    const winRate = total ? wins / total : null;
    const provenWeak = total >= 6 && winRate < 0.35;
    const reliability = total >= 5 ? Math.min(1, total / 10) : 0;
    const weight = total >= 5 ? clamp(1 + ((winRate ?? 0.5) - 0.5) * 1.4 * reliability, 0.45, 1.5) : 1;
    return { name, trades: total, wins, losses, win_rate: winRate === null ? null : Number((winRate * 100).toFixed(1)), weight: Number(weight.toFixed(2)), excluded: provenWeak };
  });
}
function aiDecision(results, enabled, performance) {
  const perf = new Map(performance.map(p => [p.name, p]));
  let buyWeight = 0, sellWeight = 0, buyCount = 0, sellCount = 0;
  const voters = [];
  results.forEach((signal, i) => {
    if (!enabled[i] || (signal !== "BUY" && signal !== "SELL")) return;
    const p = perf.get(names[i]);
    if (p?.excluded) return;
    const weight = p?.weight || 1;
    if (signal === "BUY") { buyWeight += weight; buyCount++; }
    else { sellWeight += weight; sellCount++; }
    voters.push({ name: names[i], signal, weight });
  });
  const totalWeight = buyWeight + sellWeight;
  const side = buyCount + sellCount < 2 ? "WAIT"
    : buyWeight > sellWeight && buyWeight / totalWeight >= 0.62 ? "BUY"
    : sellWeight > buyWeight && sellWeight / totalWeight >= 0.62 ? "SELL" : "WAIT";
  const selected = voters.filter(v => v.signal === side).map(v => v.name);
  const confidence = totalWeight ? Math.round(Math.max(buyWeight, sellWeight) / totalWeight * 100) : 0;
  const excluded = performance.filter(p => p.excluded).map(p => p.name);
  const reason = side === "WAIT"
    ? (buyCount + sellCount < 2 ? "Недостаточно подтверждений: нужно минимум две стратегии." : "Голоса стратегий недостаточно согласованы.")
    : "AI выбрал " + selected.length + " стратегий; доля взвешенных голосов " + confidence + "%.";
  return { side, count: selected.length, confidence, buy_weight: Number(buyWeight.toFixed(2)), sell_weight: Number(sellWeight.toFixed(2)), selected, excluded, reason, performance };
}
async function runScan(env) {
  if (!env.SUPABASE_SECRET_KEY) throw new Error("Set SUPABASE_SECRET_KEY in Worker secrets");
  const settings = await getSettings(env);
  const market = await getMarketData(settings.timeframe);
  const { candles, price, source } = market;
  if (candles.length < 60) throw new Error("Not enough completed candles");
  const context = buildContext(candles);
  const results = strategies.map(fn => { try { return fn(context); } catch { return "WAIT"; } });
  const activeCount = settings.enabled.filter(Boolean).length;
  const required = settings.consensusEnabled ? settings.requiredMatches : 1;
  const buys = results.filter((s, i) => settings.enabled[i] && s === "BUY").length;
  const sells = results.filter((s, i) => settings.enabled[i] && s === "SELL").length;
  const normalSide = activeCount >= required
    ? buys >= required && buys > sells ? "BUY"
    : sells >= required && sells > buys ? "SELL" : "WAIT"
    : "WAIT";
  await updateOpenTrades(env, price);
  let performance = [];
  if (settings.aiEnabled) {
    try {
      performance = await getStrategyPerformance(env);
    } catch (error) {
      // A statistics-read failure must never stop the live scanner or AI paper trader.
      console.error("AI performance lookup failed; continuing with neutral strategy weights", {
        message: error?.message || String(error),
        stack: error?.stack || null
      });
      performance = names.map(name => ({
        name, trades: 0, wins: 0, losses: 0, win_rate: null,
        weight: 1, excluded: false
      }));
    }
  }
  const ai = settings.aiEnabled ? aiDecision(results, names.map(() => true), performance) : null;
  const candle = candles[candles.length - 1];
  const slDistance = context.atr * 1.2;

  // The classic scanner always makes its own decision and records its own virtual trade.
  const normalEntry = normalSide === "WAIT" ? null : price;
  const normalSl = normalSide === "BUY" ? normalEntry - slDistance : normalSide === "SELL" ? normalEntry + slDistance : null;
  const normalTp = normalSide === "BUY" ? normalEntry + slDistance * settings.riskReward
    : normalSide === "SELL" ? normalEntry - slDistance * settings.riskReward : null;
  if (normalSide !== "WAIT") {
    await insertTradeOnce(env, {
      trade_key: "server:" + settings.timeframe + ":" + candle.time + ":" + normalSide,
      trade_time: Date.now(), side: normalSide, entry: normalEntry, sl: normalSl, tp: normalTp,
      initial_tp: normalTp, trailing_distance: Math.abs(normalEntry - normalSl), trailing_active: false,
      confirmations: names.filter((_, i) => settings.enabled[i] && results[i] === normalSide),
      exit: null, pnl: null, status: "OPEN", result: null, updated_at: new Date().toISOString()
    });
  }

  // AI is an independent paper trader. Its switch never changes the classic scanner.
  const aiSide = ai?.side || "WAIT";
  const aiEntry = settings.aiEnabled && aiSide !== "WAIT" ? price : null;
  const aiSl = aiSide === "BUY" ? aiEntry - slDistance : aiSide === "SELL" ? aiEntry + slDistance : null;
  const aiTp = aiSide === "BUY" ? aiEntry + slDistance * settings.riskReward
    : aiSide === "SELL" ? aiEntry - slDistance * settings.riskReward : null;
  if (settings.aiEnabled && aiSide !== "WAIT") {
    await insertTradeOnce(env, {
      trade_key: "ai:" + settings.timeframe + ":" + candle.time + ":" + aiSide,
      trade_time: Date.now(), side: aiSide, entry: aiEntry, sl: aiSl, tp: aiTp,
      initial_tp: aiTp, trailing_distance: Math.abs(aiEntry - aiSl), trailing_active: false,
      confirmations: ai.selected, exit: null, pnl: null, status: "OPEN", result: null,
      updated_at: new Date().toISOString()
    });
  }
  await saveState(env, {
    timeframe: settings.timeframe, price, side: normalSide,
    count: normalSide === "BUY" ? buys : normalSide === "SELL" ? sells : Math.max(buys, sells),
    active_count: activeCount, required_matches: required,
    consensus_enabled: settings.consensusEnabled,
    entry: normalEntry, sl: normalSl, tp: normalTp, candle_time: candle.time,
    ai_enabled: settings.aiEnabled,
    ai_side: aiSide, ai_count: ai?.count ?? 0, ai_entry: aiEntry, ai_sl: aiSl, ai_tp: aiTp,
    ai_confidence: ai?.confidence ?? null, ai_reason: ai?.reason ?? (settings.aiEnabled ? "AI ожидает подтверждения." : "AI выключен."),
    ai_selected: ai?.selected ?? [], ai_excluded: ai?.excluded ?? [],
    ai_performance: performance, normal_side: normalSide,
    strategy_results: names.map((name, i) => ({
      name, signal: results[i], enabled: settings.enabled[i],
      ai_weight: ai?.performance.find(p => p.name === name)?.weight ?? null,
      ai_excluded: ai?.performance.find(p => p.name === name)?.excluded ?? false
    })),
    market_source: source, scan_ok: true, last_error: null
  });
  return { ok: true, price, normalSide, aiSide, activeCount, required, source, aiEnabled: settings.aiEnabled };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScan(env).catch(async error => {
      const detail = error?.message || String(error);
      console.error("Scheduled scan failed", {
        name: error?.name || null,
        message: detail,
        cause: error?.cause?.message || null,
        stack: error?.stack || null
      });
      try {
        await saveState(env, {
          side: "WAIT", count: 0, entry: null, sl: null, tp: null,
          strategy_results: [], scan_ok: false, last_error: detail
        });
      } catch (e) {
        console.error("Failed to save scan error: " + (e?.message || String(e)));
      }
    }));
  },
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (url.pathname === "/health") return reply({ ok: true, service: "bitcoin-scalping-server", mode: "VIRTUAL_ONLY" });
    if (url.pathname === "/api/capital-demo/status" && request.method === "GET") {
      try { return reply(await capitalDemoStatus(env)); }
      catch (e) { return reply({ connected: false, mode: "DEMO", error: e?.message || "Capital.com Demo connection failed" }, 502); }
    }
    if (url.pathname === "/api/state" && request.method === "GET") {
      try {
        const rows = await db(env, "bot_state?id=eq.1&select=*");
        return reply(rows?.[0] || { ok: true, message: "Сканер ещё не выполнил первый проход" });
      } catch (e) { return reply({ error: String(e) }, 500); }
    }
    return reply({ error: "Not found" }, 404);
  }
};