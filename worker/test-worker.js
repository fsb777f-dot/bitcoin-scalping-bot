import { evaluateTestStrategies, testRiskLevels, TEST_STRATEGIES } from "../test-module/strategies.js";
import { loadMarketAnalysis } from "../test-module/market-analysis.js";

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
  const base = (env.SUPABASE_URL || "https://pycdhpsmxhmvuyqerotb.supabase.co").replace(/\/+$/, "");
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

async function runTestScan(env) {
  const { candles, price, analysis } = await loadMarketAnalysis();
  const candle = candles.at(-1);
  const rows = await db(env, "test_settings?id=eq.1&select=*");
  const enabled = rows?.[0]?.enabled || { brooks: true, cameron: true, smb: true };
  const raw = evaluateTestStrategies(candles);
  const signals = Object.fromEntries(TEST_STRATEGIES.map(s => [
    s.id, enabled[s.id] === false ? "WAIT" : raw[s.id]
  ]));
  // One combined decision: at least two of the three enabled strategies must agree.
  const votes = TEST_STRATEGIES
    .filter(s => enabled[s.id] !== false && (signals[s.id] === "BUY" || signals[s.id] === "SELL"))
    .map(s => ({ id: s.id, side: signals[s.id] }));
  const buyVotes = votes.filter(v => v.side === "BUY");
  const sellVotes = votes.filter(v => v.side === "SELL");
  const consensusSide = buyVotes.length >= 2 && buyVotes.length > sellVotes.length ? "BUY"
    : sellVotes.length >= 2 && sellVotes.length > buyVotes.length ? "SELL" : "WAIT";
  const confirmations = votes.filter(v => v.side === consensusSide).map(v => v.id);

  const tf1 = analysis.timeframes["1m"], tf5 = analysis.timeframes["5m"], tf15 = analysis.timeframes["15m"];
  analysis.strategy_context = Object.fromEntries(TEST_STRATEGIES.map(strategy => {
    const side = signals[strategy.id];
    const expected = side === "BUY" ? "UP" : side === "SELL" ? "DOWN" : "WAIT";
    const trend5 = side !== "WAIT" && tf5?.trend === expected;
    const trend15 = side !== "WAIT" && tf15?.trend === expected;
    const macd5 = side !== "WAIT" && Number.isFinite(tf5?.macd?.histogram) && (side === "BUY" ? tf5.macd.histogram > 0 : tf5.macd.histogram < 0);
    const rsi1 = side !== "WAIT" && (side === "BUY"
      ? tf1.rsi14 >= 45 && tf1.rsi14 <= 75
      : tf1.rsi14 >= 25 && tf1.rsi14 <= 55);
    return [strategy.id, {
      side, trend5, trend15, macd5, rsi1,
      confirmations: [trend5, trend15, macd5, rsi1].filter(Boolean).length,
      checks: 4
    }];
  }));

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

  if (consensusSide === "BUY" || consensusSide === "SELL") {
    const existing = await db(env, "test_trades?strategy=eq.consensus&status=eq.OPEN&select=id&limit=1");
    if (!existing?.length) {
      const levels = testRiskLevels(consensusSide, price, candles, 2);
      if (levels) await db(env, "test_trades?on_conflict=trade_key", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({
          trade_key: "test:consensus:1m:" + candle.time,
          strategy: "consensus", confirmations, timeframe: "1m", candle_time: candle.time, trade_time: Date.now(),
          side: consensusSide, entry: price, sl: levels.sl, tp: levels.tp, exit: null, pnl: null,
          status: "OPEN", result: null, updated_at: new Date().toISOString()
        })
      });
    }
  }

  await db(env, "test_state?on_conflict=id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: 1, timeframe: "1m", price, signals: { ...signals, consensus: consensusSide, confirmations }, analysis, updated_at: new Date().toISOString() })
  });
  return { ok: true, price, signals, analysis };
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
