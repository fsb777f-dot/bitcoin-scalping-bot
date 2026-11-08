import { evaluateTestStrategies, testRiskLevels, TEST_STRATEGIES } from "../test-module/strategies.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};
const reply = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "Content-Type": "application/json" }
});

async function db(env, path, init = {}) {
  if (!env.SUPABASE_SECRET_KEY) throw new Error("Missing SUPABASE_SECRET_KEY");
  const base = (env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("Missing SUPABASE_URL");
  const response = await fetch(base + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: "Bearer " + env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const body = await response.text();
  if (!response.ok) throw new Error("Supabase " + response.status + ": " + body.slice(0, 400));
  return body ? JSON.parse(body) : null;
}

async function marketData() {
  const [ohlcResponse, tickerResponse] = await Promise.all([
    fetch("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1"),
    fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD")
  ]);
  if (!ohlcResponse.ok || !tickerResponse.ok) throw new Error("Kraken market request failed");
  const [ohlc, ticker] = await Promise.all([ohlcResponse.json(), tickerResponse.json()]);
  if (ohlc.error?.length || ticker.error?.length) throw new Error("Kraken API error");
  const key = Object.keys(ohlc.result || {}).find(k => k !== "last");
  const candles = (key ? ohlc.result[key] : []).slice(0, -1).map(k => ({
    time: Number(k[0]), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[6]
  }));
  const tickerKey = Object.keys(ticker.result || {})[0];
  const price = Number(ticker.result?.[tickerKey]?.c?.[0]);
  if (candles.length < 60 || !Number.isFinite(price) || price <= 0) {
    throw new Error("Kraken returned insufficient or invalid BTC/USD data");
  }
  return { candles, price };
}

async function runTestScan(env) {
  const { candles, price } = await marketData();
  const candle = candles.at(-1);
  const rows = await db(env, "test_settings?id=eq.1&select=*");
  const enabled = rows?.[0]?.enabled || { brooks: true, cameron: true, smb: true };
  const raw = evaluateTestStrategies(candles);
  const signals = Object.fromEntries(TEST_STRATEGIES.map(s => [
    s.id, enabled[s.id] === false ? "WAIT" : raw[s.id]
  ]));

  const open = await db(env, "test_trades?status=eq.OPEN&select=*");
  for (const trade of open || []) {
    const stopped = trade.side === "BUY" ? price <= Number(trade.sl) : price >= Number(trade.sl);
    const targeted = trade.side === "BUY" ? price >= Number(trade.tp) : price <= Number(trade.tp);
    if (!stopped && !targeted) continue;
    const exit = stopped ? Number(trade.sl) : Number(trade.tp);
    const pnl = trade.side === "BUY" ? exit - Number(trade.entry) : Number(trade.entry) - exit;
    await db(env, "test_trades?trade_key=eq." + encodeURIComponent(trade.trade_key), {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        exit, pnl, status: "CLOSED", result: stopped ? "SL" : "TP",
        updated_at: new Date().toISOString()
      })
    });
  }

  for (const strategy of TEST_STRATEGIES) {
    const side = signals[strategy.id];
    if (side !== "BUY" && side !== "SELL") continue;
    const existing = await db(env, "test_trades?strategy=eq." + strategy.id + "&status=eq.OPEN&select=id&limit=1");
    if (existing?.length) continue;
    const levels = testRiskLevels(side, price, candles, 2);
    if (!levels) continue;
    await db(env, "test_trades?on_conflict=trade_key", {
      method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        trade_key: "test:" + strategy.id + ":1m:" + candle.time,
        strategy: strategy.id, timeframe: "1m", candle_time: candle.time, trade_time: Date.now(),
        side, entry: price, sl: levels.sl, tp: levels.tp, exit: null, pnl: null,
        status: "OPEN", result: null, updated_at: new Date().toISOString()
      })
    });
  }

  await db(env, "test_state?on_conflict=id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: 1, timeframe: "1m", price, signals, updated_at: new Date().toISOString() })
  });
  return { ok: true, price, signals };
}

async function getTestData(env) {
  const [state, settings, trades] = await Promise.all([
    db(env, "test_state?id=eq.1&select=*"),
    db(env, "test_settings?id=eq.1&select=*"),
    db(env, "test_trades?select=*&order=trade_time.desc&limit=1000")
  ]);
  return {
    state: state?.[0] || null,
    settings: settings?.[0] || { enabled: { brooks: true, cameron: true, smb: true } },
    trades: trades || []
  };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runTestScan(env).catch(error => {
      console.error("Test-only scan failed:", error?.message || String(error));
    }));
  },
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return reply({ ok: true, service: "bitcoin-scalping-test-only", mode: "VIRTUAL_ONLY" });
      if (url.pathname === "/api/test-data" && request.method === "GET") return reply(await getTestData(env));
      if (url.pathname === "/api/test-settings" && request.method === "POST") {
        const body = await request.json();
        const enabled = {};
        for (const id of ["brooks", "cameron", "smb"]) enabled[id] = body?.enabled?.[id] !== false;
        await db(env, "test_settings?on_conflict=id", {
          method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ id: 1, enabled, updated_at: new Date().toISOString() })
        });
        return reply({ ok: true, enabled });
      }
      if (url.pathname === "/api/test-scan" && request.method === "POST") return reply(await runTestScan(env));
      return reply({ error: "Not found" }, 404);
    } catch (error) {
      return reply({ error: error?.message || String(error) }, 500);
    }
  }
};
