const DEMO_BASE = "https://demo-api-capital.backend-capital.com/api/v1";

async function request(path, headers = {}, init = {}) {
  const response = await fetch(DEMO_BASE + path, {
    ...init,
    headers: { Accept: "application/json", ...headers, ...(init.headers || {}) }
  });
  const body = await response.text();
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch {}
  if (!response.ok) {
    const message = data?.errorCode || data?.error || ("HTTP " + response.status);
    throw new Error("Capital.com Demo " + message);
  }
  return { data, headers: response.headers };
}

export async function capitalDemoStatus(env) {
  if (!env.CAPITAL_API_KEY || !env.CAPITAL_IDENTIFIER || !env.CAPITAL_PASSWORD) {
    throw new Error("Capital.com secrets are incomplete");
  }

  const session = await request("/session", { "X-CAP-API-KEY": env.CAPITAL_API_KEY }, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: env.CAPITAL_IDENTIFIER,
      password: env.CAPITAL_PASSWORD,
      encryptedPassword: false
    })
  });

  const cst = session.headers.get("CST");
  const security = session.headers.get("X-SECURITY-TOKEN");
  if (!cst || !security) throw new Error("Capital.com Demo session tokens were not returned");

  const auth = { CST: cst, "X-SECURITY-TOKEN": security };
  const [accountsResult, marketsResult, detailsResult] = await Promise.all([
    request("/accounts", auth),
    request("/markets?searchTerm=Bitcoin", auth),
    request("/session", auth)
  ]);

  const accounts = Array.isArray(accountsResult.data?.accounts) ? accountsResult.data.accounts : [];
  const accountInfo = detailsResult.data?.accountInfo || {};
  const account = accounts.find(a => a.preferred) || accounts[0] || null;
  const markets = Array.isArray(marketsResult.data?.markets) ? marketsResult.data.markets : [];
  const bitcoin = markets.find(m => /bitcoin/i.test(m.instrumentName || m.marketName || "")) || markets[0] || null;

  return {
    connected: true,
    mode: "DEMO",
    account: account ? {
      currency: account.currency || detailsResult.data?.currency || null,
      balanceAvailable: account.balance?.balance != null || accountInfo.balance != null,
      status: account.status || null
    } : {
      currency: detailsResult.data?.currency || null,
      balanceAvailable: accountInfo.balance != null
    },
    bitcoin: bitcoin ? {
      found: true,
      name: bitcoin.instrumentName || bitcoin.marketName || null,
      epic: bitcoin.epic || null,
      marketStatus: bitcoin.marketStatus || null
    } : { found: false },
    checkedAt: new Date().toISOString()
  };
}

function midpoint(pair) {
  const bid = Number(pair?.bid);
  const ask = Number(pair?.ask);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) return null;
  return (bid + ask) / 2;
}

function capitalTime(value) {
  if (!value) return null;
  const text = String(value);
  const iso = text.endsWith("Z") || text.includes("+") ? text : text + "Z";
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? Math.floor(date.getTime() / 1000) : null;
}

export async function capitalDemoMarketData(env, timeframe = "1m") {
  if (!env.CAPITAL_API_KEY || !env.CAPITAL_IDENTIFIER || !env.CAPITAL_PASSWORD) {
    throw new Error("Capital.com secrets are incomplete");
  }
  const session = await request("/session", { "X-CAP-API-KEY": env.CAPITAL_API_KEY }, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: env.CAPITAL_IDENTIFIER,
      password: env.CAPITAL_PASSWORD,
      encryptedPassword: false
    })
  });
  const cst = session.headers.get("CST");
  const security = session.headers.get("X-SECURITY-TOKEN");
  if (!cst || !security) throw new Error("Capital.com Demo session tokens were not returned");

  const auth = { CST: cst, "X-SECURITY-TOKEN": security };
  const [marketResult, historyResult] = await Promise.all([
    request("/markets/BTCUSD", auth),
    request("/prices/BTCUSD?resolution=" + (timeframe === "5m" ? "MINUTE_5" : "MINUTE") + "&max=300", auth)
  ]);
  const snapshot = marketResult.data?.snapshot || {};
  const bid = Number(snapshot.bid);
  const ask = Number(snapshot.offer);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) {
    throw new Error("Capital.com returned an invalid BTCUSD bid/offer quote");
  }
  if (snapshot.marketStatus !== "TRADEABLE") {
    throw new Error("Capital.com BTCUSD market is not tradeable: " + (snapshot.marketStatus || "unknown"));
  }

  const rows = Array.isArray(historyResult.data?.prices) ? historyResult.data.prices : [];
  const candles = rows.map(row => {
    const time = capitalTime(row.snapshotTimeUTC || row.snapshotTime);
    return {
      time,
      open: midpoint(row.openPrice),
      high: midpoint(row.highPrice),
      low: midpoint(row.lowPrice),
      close: midpoint(row.closePrice),
      volume: Number(row.lastTradedVolume) || 0
    };
  }).filter(c => c.time !== null && [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);

  if (candles.length && candles[candles.length - 1].time >= Math.floor(Date.now() / 60000) * 60) candles.pop();
  if (candles.length < 60) throw new Error("Capital.com returned fewer than 60 completed BTCUSD candles");

  return {
    connected: true,
    mode: "DEMO",
    source: "Capital.com Demo",
    epic: "BTCUSD",
    marketStatus: snapshot.marketStatus,
    bid,
    ask,
    spread: Number((ask - bid).toFixed(8)),
    price: (bid + ask) / 2,
    updatedAt: snapshot.updateTimeUTC || snapshot.updateTime || new Date().toISOString(),
    candles
  };
}
