import { buildContext } from "../js/indicators.js";
import { strategies, names } from "../strategies/index.js";
import { capitalDemoStatus, capitalDemoMarketData, capitalDemoMarketBundle, capitalDemoInstrumentRules, capitalDemoOpenPosition, capitalDemoUpdatePosition, capitalDemoReconcile } from "./capital-demo.js";
import { virtualPartialUpdate, virtualSettledPnl } from "./partial-profit.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Execution-Control",
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
    consensusEnabled: true,
    requiredMatches: clamp(s.required_matches ?? 3, 1, names.length),
    riskReward: [1, 1.5, 2, 2.5, 3, 4].includes(Number(s.risk_reward)) ? Number(s.risk_reward) : 2,
    executionMode: ["MAIN_DEMO", "AI_DEMO"].includes(s.execution_mode) ? s.execution_mode : "VIRTUAL",
    tradeSize: Number(s.trade_size) > 0 ? Number(s.trade_size) : null
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
async function getMarketData(env, timeframe, executionMode) {
  // All strategies use Capital.com DEMO market data so virtual results match
  // the broker feed intended for future execution. VIRTUAL never places orders.
  return capitalDemoMarketData(env, timeframe);
}

async function getLegacyMarketData(timeframe) {
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
async function syncCapitalDemoTrades(env) {
  const trades = await db(env, "trades?status=eq.OPEN&execution_mode=in.(MAIN_DEMO,AI_DEMO)&capital_deal_id=not.is.null&select=trade_key,capital_deal_id,execution_mode");
  if (!trades?.length) return { checked: 0, stillOpen: 0, closed: 0, unresolved: 0 };
  return capitalDemoReconcile(env, trades);
}
async function updateOpenTrades(env, bid, ask) {
  const open = await db(env, "trades?status=eq.OPEN&select=*");
  const spread = Math.max(0, Number(ask) - Number(bid));
  for (const t of open || []) {
    if (t.side !== "BUY" && t.side !== "SELL") continue;
    const isDemo = t.execution_mode === "MAIN_DEMO" || t.execution_mode === "AI_DEMO";
    const price = t.side === "BUY" ? bid : ask;
    const entry = Number(t.entry), currentStop = Number(t.sl);
    const risk = Number(t.trailing_distance) || Math.abs(entry - currentStop);
    if (![price, entry, currentStop, risk].every(Number.isFinite) || risk <= 0) continue;
    const buy = t.side === "BUY";
    const hit = buy ? price <= currentStop : price >= currentStop;
    if (!isDemo && hit) {
      const pnl = virtualSettledPnl(t, currentStop);
      await patchTrade(env, t.trade_key, {
        exit: currentStop, pnl, status: "CLOSED",
        result: t.partial_exit_price != null ? "HALF_TRAILING_STOP" : t.trailing_active ? "TRAILING_STOP" : "SL"
      });
      continue;
    }
    // New paper-only management activates when the additive journal column exists.
    // Until the Supabase migration runs, existing trading behaviour is preserved.
    if (!isDemo && Object.hasOwn(t, "partial_exit_price")) {
      const update = virtualPartialUpdate(t, price, risk);
      if (update) await patchTrade(env, t.trade_key, update);
      continue;
    }
    // No TP exit: trail once the executable closing quote is in profit.
    const favorableMove = buy ? price - entry : entry - price;
    if (favorableMove <= 0) continue;
    // Protect half the observed favorable move; never move a stop backwards.
    const desired = buy ? entry + favorableMove * 0.5 : entry - favorableMove * 0.5;
    const nextStop = buy ? Math.max(currentStop, desired) : Math.min(currentStop, desired);
    if (buy ? nextStop <= currentStop + 1e-8 : nextStop >= currentStop - 1e-8) continue;
    if (isDemo) {
      // Capital.com enforces minimum stop distance. Do not claim a broker stop
      // changed unless the broker confirms the amendment.
      if (!t.capital_deal_id) continue;
      const minimumGap = Math.max(spread * 1.05, 1e-8);
      if (buy ? nextStop >= bid - minimumGap : nextStop <= ask + minimumGap) continue;
      try {
        await capitalDemoUpdatePosition(env, t.capital_deal_id, nextStop);
        await patchTrade(env, t.trade_key, { sl: nextStop, trailing_active: true });
      } catch (error) {
        console.error("Capital.com trailing stop update failed", t.trade_key, error?.message || String(error));
      }
    } else {
      await patchTrade(env, t.trade_key, { sl: nextStop, trailing_active: true });
    }
  }
}
async function openDemoTradeOnce(env, trade, executionMode, size) {
  const existing = await db(env, "trades?trade_key=eq." + encodeURIComponent(trade.trade_key) + "&select=trade_key&limit=1");
  if (Array.isArray(existing) && existing.length) return { duplicate: true };
  const order = await capitalDemoOpenPosition(env, {
    direction: trade.side, size, stopLevel: trade.sl,
    trailingEnabled: executionMode === "MAIN_DEMO" || executionMode === "AI_DEMO"
  });
  await insertTradeOnce(env, {
    ...trade, execution_mode: executionMode,
    capital_deal_id: order.dealId,
    capital_deal_reference: order.dealReference,
    capital_status: order.status
  });
  return { duplicate: false, dealId: order.dealId };
}
async function getPreviousState(env) {
  const rows = await db(env, "bot_state?id=eq.1&select=ai_side,side,candle_time");
  return rows?.[0] || {};
}
async function getStrategyPerformance(env) {
  const rows = await db(env, "trades?status=eq.CLOSED&trade_key=like.ai%25&select=confirmations,pnl,result,trade_time,trade_key&order=trade_time.desc&limit=300");
  return names.map(name => {
    const relevant = (rows || []).filter(t => Array.isArray(t.confirmations) && t.confirmations.includes(name));
    const wins = relevant.filter(t => Number(t.pnl) > 0 || t.result === "TP").length;
    const losses = relevant.filter(t => Number(t.pnl) < 0 || t.result === "SL").length;
    const total = wins + losses;
    const winRate = total ? wins / total : null;
    const reliability = total >= 5 ? Math.min(1, total / 10) : 0;
    const weight = total >= 5 ? clamp(1 + ((winRate ?? 0.5) - 0.5) * 1.4 * reliability, 0.45, 1.5) : 1;
    return { name, trades: total, wins, losses, win_rate: winRate === null ? null : Number((winRate * 100).toFixed(1)), weight: Number(weight.toFixed(2)), excluded: false };
  });
}
function aiDecision(results, enabled, performance) {
  const perf = new Map(performance.map(p => [p.name, p]));
  let buyWeight = 0, sellWeight = 0, buyCount = 0, sellCount = 0;
  const voters = [];
  results.forEach((signal, i) => {
    if (!enabled[i] || (signal !== "BUY" && signal !== "SELL")) return;
    const p = perf.get(names[i]);
    const weight = p?.weight || 1;
    if (signal === "BUY") { buyWeight += weight; buyCount++; }
    else { sellWeight += weight; sellCount++; }
    voters.push({ name: names[i], signal, weight });
  });
  const totalWeight = buyWeight + sellWeight;
  const side = buyCount + sellCount < 3 ? "WAIT"
    : buyWeight > sellWeight && buyWeight / totalWeight >= 0.70 ? "BUY"
    : sellWeight > buyWeight && sellWeight / totalWeight >= 0.70 ? "SELL" : "WAIT";
  const selected = voters.filter(v => v.signal === side).map(v => v.name);
  const confidence = totalWeight ? Math.round(Math.max(buyWeight, sellWeight) / totalWeight * 100) : 0;
  const excluded = performance.filter(p => p.excluded).map(p => p.name);
  const reason = side === "WAIT"
    ? (buyCount + sellCount < 2 ? "Недостаточно подтверждений: нужно минимум три стратегии." : "Голоса стратегий недостаточно согласованы.")
    : "AI выбрал " + selected.length + " стратегий; доля взвешенных голосов " + confidence + "%.";
  return { side, count: selected.length, confidence, buy_weight: Number(buyWeight.toFixed(2)), sell_weight: Number(sellWeight.toFixed(2)), selected, excluded, reason, performance };
}
async function runScan(env) {
  if (!env.SUPABASE_SECRET_KEY) throw new Error("Set SUPABASE_SECRET_KEY in Worker secrets");
  const settings = await getSettings(env);
  const previousState = await getPreviousState(env);
  const market = await getMarketData(env, settings.timeframe, settings.executionMode);
  const { candles, price, source } = market;
  if (candles.length < 60) throw new Error("Not enough completed candles");
  const context = buildContext(candles);
  const results = strategies.map(fn => { try { return fn(context); } catch { return "WAIT"; } });
  const activeCount = settings.enabled.filter(Boolean).length;
  const required = settings.requiredMatches;
  const buys = results.filter((s, i) => settings.enabled[i] && s === "BUY").length;
  const sells = results.filter((s, i) => settings.enabled[i] && s === "SELL").length;
  const normalSide = buys >= required && buys > sells ? "BUY"
    : sells >= required && sells > buys ? "SELL" : "WAIT";
  try {
    const sync = await syncCapitalDemoTrades(env);
    if (sync.closed || sync.unresolved) console.log("Capital.com DEMO journal sync", sync);
  } catch (error) {
    // A broker-history failure must not cause journal rows to be guessed closed.
    console.error("Capital.com DEMO journal sync failed", error?.message || String(error));
  }
  await updateOpenTrades(env, market.bid, market.ask);
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
  let ai = settings.aiEnabled ? aiDecision(results, names.map(() => true), performance) : null;
  const candle = candles[candles.length - 1];
  // Match the earlier paper-trading behavior: AI may enter again on each new candle.
  const aiSignalChanged = (ai?.side === "BUY" || ai?.side === "SELL") && candle.time !== previousState.candle_time;
  // A string of recent stopped-out AI trades in the same direction signals
  // a poor market regime. Pause new entries briefly, without closing or
  // limiting existing positions or disabling any strategy votes.
  let aiLossPause = false;
  if (settings.aiEnabled && aiSignalChanged) {
    const recentAi = await db(env, "trades?status=eq.CLOSED&trade_key=like.ai%25&select=side,pnl,trade_time&order=trade_time.desc&limit=12");
    const sameSide = (recentAi || []).filter(t => t.side === ai.side);
    const lastThree = sameSide.slice(0, 3);
    aiLossPause = lastThree.length === 3
      && lastThree.every(t => Number(t.pnl) < 0)
      && Number(lastThree[0].trade_time) > Date.now() - 10 * 60000;
  }
  const canOpenAiTrade = settings.aiEnabled && aiSignalChanged && !aiLossPause;
  const atrSlDistance = context.atr * 1.2;
  // Protective levels use the same ATR distance in every mode and respect live spread.
  const slDistance = Math.max(atrSlDistance, market.spread * 1.05);

  // The classic scanner always makes its own decision and records its own virtual trade.
  const normalEntry = normalSide === "BUY" ? market.ask : normalSide === "SELL" ? market.bid : null;
  const normalSl = normalSide === "BUY" ? normalEntry - slDistance : normalSide === "SELL" ? normalEntry + slDistance : null;
  const normalTp = normalSide === "BUY" ? normalEntry + slDistance * settings.riskReward
    : normalSide === "SELL" ? normalEntry - slDistance * settings.riskReward : null;
  let executionError = null;
  // Enter on every new candle with a directional signal; trade_key prevents duplicate scans.
  const scanMinute = Math.floor(Date.now() / 60000);
  const normalSignalChanged = normalSide === "BUY" || normalSide === "SELL";
  if (normalSignalChanged) {
    const normalTrade = {
      trade_key: "server:" + settings.timeframe + ":" + candle.time + ":" + scanMinute + ":" + normalSide,
      trade_time: scanMinute * 60000, side: normalSide, entry: normalEntry, sl: normalSl, tp: normalTp,
      initial_tp: normalTp, trailing_distance: Math.abs(normalEntry - normalSl), trailing_active: false,
      confirmations: names.filter((_, i) => settings.enabled[i] && results[i] === normalSide),
      exit: null, pnl: null, status: "OPEN", result: null, updated_at: new Date().toISOString()
    };
    if (settings.executionMode === "MAIN_DEMO") {
      try {
        await openDemoTradeOnce(env, normalTrade, "MAIN_DEMO", settings.tradeSize);
      } catch (error) {
        executionError = "Основной DEMO: " + (error?.message || String(error));
      }
    } else {
      await insertTradeOnce(env, { ...normalTrade, execution_mode: "VIRTUAL" });
    }
  }

  // AI is an independent paper trader. Its switch never changes the classic scanner.
  const aiSide = ai?.side || "WAIT";
  const aiEntry = canOpenAiTrade && aiSide === "BUY" ? market.ask
    : canOpenAiTrade && aiSide === "SELL" ? market.bid : null;
  const aiSl = canOpenAiTrade ? (aiSide === "BUY" ? aiEntry - slDistance : aiEntry + slDistance) : null;
  const aiTp = canOpenAiTrade ? (aiSide === "BUY" ? aiEntry + slDistance * settings.riskReward
    : aiEntry - slDistance * settings.riskReward) : null;
  if (canOpenAiTrade) {
    const aiTrade = {
      trade_key: "ai:" + settings.timeframe + ":" + candle.time + ":" + aiSide,
      trade_time: Date.now(), side: aiSide, entry: aiEntry, sl: aiSl, tp: aiTp,
      initial_tp: aiTp, trailing_distance: Math.abs(aiEntry - aiSl), trailing_active: false,
      confirmations: ai.selected, exit: null, pnl: null, status: "OPEN", result: null,
      updated_at: new Date().toISOString()
    };
    if (settings.executionMode === "AI_DEMO") {
      try {
        await openDemoTradeOnce(env, aiTrade, "AI_DEMO", settings.tradeSize);
      } catch (error) {
        executionError = "AI DEMO: " + (error?.message || String(error));
      }
    } else {
      await insertTradeOnce(env, { ...aiTrade, execution_mode: "VIRTUAL" });
    }
  }
  await saveState(env, {
    timeframe: settings.timeframe, price, side: normalSide,
    count: normalSide === "BUY" ? buys : normalSide === "SELL" ? sells : Math.max(buys, sells),
    active_count: activeCount, required_matches: required,
    consensus_enabled: settings.consensusEnabled,
    entry: normalEntry, sl: normalSl, tp: normalTp, candle_time: candle.time,
    ai_enabled: settings.aiEnabled,
    ai_side: aiSide, ai_count: ai?.count ?? 0, ai_entry: aiEntry, ai_sl: aiSl, ai_tp: aiTp,
    ai_confidence: ai?.confidence ?? null, ai_reason: aiLossPause ? "AI: пауза после трёх убыточных сделок этого направления за последние 10 минут." : (ai?.reason ?? (settings.aiEnabled ? "AI ожидает подтверждения." : "AI выключен.")),
    ai_selected: ai?.selected ?? [], ai_excluded: ai?.excluded ?? [],
    ai_performance: performance, normal_side: normalSide,
    strategy_results: names.map((name, i) => ({
      name, signal: results[i], enabled: settings.enabled[i],
      ai_weight: ai?.performance.find(p => p.name === name)?.weight ?? null,
      ai_excluded: ai?.performance.find(p => p.name === name)?.excluded ?? false
    })),
    market_source: source, bid: market.bid, ask: market.ask, spread: market.spread, scan_ok: true, last_error: executionError
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
    if (url.pathname === "/api/capital-demo/rules" && request.method === "GET") {
      try { return reply(await capitalDemoInstrumentRules(env)); }
      catch (e) { return reply({ error: e?.message || "Could not read DEMO dealing rules" }, 502); }
    }
    if (url.pathname === "/api/capital-demo/market" && request.method === "GET") {
      try { return reply(await capitalDemoMarketData(env)); }
      catch (e) { return reply({ connected: false, mode: "DEMO", error: e?.message || "Capital.com Demo market data failed" }, 502); }
    }
    if (url.pathname === "/api/capital-demo/market-bundle" && request.method === "GET") {
      try { return reply(await capitalDemoMarketBundle(env)); }
      catch (e) { return reply({ error: e?.message || "Capital.com Demo multi-timeframe data failed" }, 502); }
    }
    if (url.pathname === "/api/execution-mode" && request.method === "POST") {
      try {
        if (!env.EXECUTION_CONTROL_PIN) return reply({ error: "DEMO execution is locked: set EXECUTION_CONTROL_PIN in Worker secrets first." }, 503);
        if (request.headers.get("X-Execution-Control") !== env.EXECUTION_CONTROL_PIN) return reply({ error: "Неверный PIN управления DEMO." }, 401);
        const body = await request.json();
        const mode = body?.mode;
        if (!["VIRTUAL", "MAIN_DEMO", "AI_DEMO"].includes(mode)) {
          return reply({ error: "Invalid execution mode" }, 400);
        }
        const size = Number(body?.trade_size);
        if (mode !== "VIRTUAL") {
          if (!Number.isFinite(size) || size <= 0) return reply({ error: "Укажи положительный размер сделки BTC." }, 400);
          const rules = await capitalDemoInstrumentRules(env);
          const steps = (size - rules.minDealSize) / rules.sizeIncrement;
          if (rules.marketStatus !== "TRADEABLE") return reply({ error: "BTCUSD сейчас недоступен для торговли." }, 400);
          if (size < rules.minDealSize || size > rules.maxDealSize || Math.abs(steps - Math.round(steps)) > 1e-8) {
            return reply({ error: "Размер BTC должен быть от " + rules.minDealSize + " до " + rules.maxDealSize + " с шагом " + rules.sizeIncrement + "." }, 400);
          }
        }
        await db(env, "bot_settings?id=eq.1", {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            execution_mode: mode,
            trade_size: Number.isFinite(size) && size > 0 ? size : null,
            updated_at: new Date().toISOString()
          })
        });
        return reply({ ok: true, execution_mode: mode, trade_size: Number.isFinite(size) && size > 0 ? size : null });
      } catch (e) {
        return reply({ error: e?.message || "Не удалось изменить режим торговли" }, 500);
      }
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
