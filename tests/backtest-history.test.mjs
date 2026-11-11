import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../worker/main-index.js";

test("read-only history endpoint loads 15-minute Capital.com BTCUSD candles", async () => {
  const previousFetch = globalThis.fetch;
  const paths = [];
  let sessionAttempts = 0;
  const start = Math.floor(Date.now() / 900000) * 900000 - 301 * 900000;
  const rows = Array.from({ length: 300 }, (_, i) => {
    const price = 75000 + i;
    const point = val => ({ bid: val - 4, ask: val + 4 });
    return { snapshotTimeUTC: new Date(start + i * 900000).toISOString(),
      openPrice: point(price), highPrice: point(price + 10),
      lowPrice: point(price - 10), closePrice: point(price + 2), lastTradedVolume: 10 };
  });
  globalThis.fetch = async (url, options = {}) => {
    const address = new URL(url);
    paths.push({ path: address.pathname + address.search, method: options.method || "GET" });
    if (address.pathname === "/api/v1/session") {
      sessionAttempts++;
      if (sessionAttempts === 1) return Response.json({ errorCode: "error.too-many.requests" }, { status: 429 });
      return new Response("{}", { status: 200, headers: { CST: "token", "X-SECURITY-TOKEN": "security" } });
    }
    if (address.pathname === "/api/v1/markets/BTCUSD") {
      return Response.json({ snapshot: { bid: 75200, offer: 75210, marketStatus: "TRADEABLE" } });
    }
    if (address.pathname === "/api/v1/prices/BTCUSD") return Response.json({ prices: rows });
    throw new Error("Unexpected API: " + address.pathname);
  };
  try {
    const env = { CAPITAL_API_KEY: "test", CAPITAL_IDENTIFIER: "test", CAPITAL_PASSWORD: "test" };
    const response = await worker.fetch(new Request("https://example.com/api/backtest-history?timeframe=15m"), env);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.timeframe, "15m");
    assert.equal(result.candles.length, 300);
    assert.ok(result.candles.every(c => c.bidOpen < c.askOpen));
    assert.ok(paths.some(p => p.path.includes("resolution=MINUTE_15&max=1000")));
    assert.equal(sessionAttempts, 2, "safe authentication request is retried after 429");
    assert.ok(paths.every(p => p.method === "GET" || p.path === "/api/v1/session"), "history never sends orders or journal writes");
    const callsBeforeCacheHit = paths.length;
    const cached = await worker.fetch(new Request("https://example.com/api/backtest-history?timeframe=15m"), env);
    assert.equal(cached.status, 200);
    assert.equal(paths.length, callsBeforeCacheHit, "repeated browser backtests must not hit Capital.com again");
    const bad = await worker.fetch(new Request("https://example.com/api/backtest-history?timeframe=30m"), env);
    assert.equal(bad.status, 400);
  } finally { globalThis.fetch = previousFetch; }
});
