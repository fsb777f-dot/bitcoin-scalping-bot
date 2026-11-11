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

export async function capitalDemoMarketData(env, timeframe = "1m", sharedAuth = null, sharedMarket = null, maxCandles = 300) {
  const auth = sharedAuth || await capitalDemoAuth(env);
  const resolutions = { "1m": "MINUTE", "5m": "MINUTE_5", "15m": "MINUTE_15", "1h": "HOUR", "4h": "HOUR_4" };
  if (!resolutions[timeframe]) throw new Error("Unsupported Capital.com timeframe");
  const [marketResult, historyResult] = await Promise.all([
    sharedMarket || request("/markets/BTCUSD", auth),
    request("/prices/BTCUSD?resolution=" + resolutions[timeframe] + "&max=" + (maxCandles === 1000 ? 1000 : 300), auth)
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
      bidOpen: Number(row.openPrice?.bid), askOpen: Number(row.openPrice?.ask),
      bidClose: Number(row.closePrice?.bid), askClose: Number(row.closePrice?.ask),
      bidLow: Number(row.lowPrice?.bid), askHigh: Number(row.highPrice?.ask),
      volume: Number(row.lastTradedVolume) || 0
    };
  }).filter(c => c.time !== null && [c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.time - b.time);

  const candleSeconds = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400 }[timeframe];
  if (candles.length && candles[candles.length - 1].time >= Math.floor(Date.now() / (candleSeconds * 1000)) * candleSeconds) candles.pop();
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

// One Capital.com session shared by the isolated paper-test timeframes.
export async function capitalDemoMarketBundle(env) {
  const auth = await capitalDemoAuth(env);
  const market = await request("/markets/BTCUSD", auth);
  const frames = await Promise.all(["1m", "5m", "15m", "1h", "4h"].map(async timeframe => [
    timeframe, await capitalDemoMarketData(env, timeframe, auth, market)
  ]));
  return { source: "Capital.com Demo", symbol: "BTCUSD", frames: Object.fromEntries(frames) };
}


async function capitalDemoAuth(env) {
  if (!env.CAPITAL_API_KEY || !env.CAPITAL_IDENTIFIER || !env.CAPITAL_PASSWORD) {
    throw new Error("Capital.com Demo secrets are incomplete");
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
  return { CST: cst, "X-SECURITY-TOKEN": security };
}

export async function capitalDemoReconcile(env, trades) {
  const auth = await capitalDemoAuth(env);
  const result = await request("/positions", auth);
  const positions = Array.isArray(result.data?.positions) ? result.data.positions : [];
  const openById = new Map(positions.map(item => [item.position?.dealId, item.position]).filter(([id]) => id));
  const summary = { checked: 0, stillOpen: 0, closed: 0, unresolved: 0 };

  for (const trade of trades || []) {
    const dealId = trade.capital_deal_id;
    if (!dealId) continue;
    summary.checked++;
    const live = openById.get(dealId);
    if (live) {
      await dbPatchTrade(env, trade.trade_key, { capital_status: "OPEN" });
      summary.stillOpen++;
      continue;
    }

    // Absence from /positions is not proof of closure. Require a matching,
    // explicitly executed position activity before changing the journal.
    const activityResult = await request(
      "/history/activity?detailed=true&lastPeriod=86400&dealId=" + encodeURIComponent(dealId),
      auth
    );
    const activities = Array.isArray(activityResult.data?.activities) ? activityResult.data.activities : [];
    const closeEvent = activities
      .filter(item => item.dealId === dealId && item.type === "POSITION" && ["ACCEPTED", "EXECUTED"].includes(item.status)
        && (["TP", "SL"].includes(item.source) || (item.status === "EXECUTED" && ["USER", "SYSTEM", "CLOSE_OUT"].includes(item.source))))
      .sort((a, b) => String(b.dateUTC || b.date || "").localeCompare(String(a.dateUTC || a.date || "")))[0];

    if (!closeEvent) {
      summary.unresolved++;
      continue;
    }
    const closeReason = closeEvent.source === "TP" ? "TP"
      : closeEvent.source === "SL" ? "SL" : "BROKER_CLOSED";
    await dbPatchTrade(env, trade.trade_key, {
      status: "CLOSED",
      result: closeReason,
      capital_status: "CLOSED",
      exit: null,
      pnl: null
    });
    summary.closed++;
  }
  return summary;
}

// Keep database writes local to the worker; Capital reconciliation itself is read-only.
async function dbPatchTrade(env, tradeKey, patch) {
  const base = (env.SUPABASE_URL || "https://pycdhpsmxhmvuyqerotb.supabase.co").replace(/\/+$/, "");
  const response = await fetch(base + "/rest/v1/trades?trade_key=eq." + encodeURIComponent(tradeKey), {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: "Bearer " + env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  if (!response.ok) throw new Error("Supabase trade sync " + response.status + ": " + (await response.text()).slice(0, 300));
}

export async function capitalDemoInstrumentRules(env) {
  const auth = await capitalDemoAuth(env);
  const result = await request("/markets/BTCUSD", auth);
  const market = result.data || {};
  const rules = market.dealingRules || {};
  const min = Number(rules.minDealSize?.value);
  const step = Number(rules.minSizeIncrement?.value);
  const max = Number(rules.maxDealSize?.value);
  if (![min, step, max].every(Number.isFinite) || min <= 0 || step <= 0 || max < min) {
    throw new Error("Capital.com did not return valid BTCUSD dealing size rules");
  }
  return {
    mode: "DEMO",
    epic: "BTCUSD",
    marketStatus: market.snapshot?.marketStatus || null,
    minDealSize: min,
    sizeIncrement: step,
    maxDealSize: max
  };
}

export async function capitalDemoOpenPosition(env, { direction, size, stopLevel, profitLevel, trailingEnabled = false }) {
  if (direction !== "BUY" && direction !== "SELL") throw new Error("Invalid DEMO order direction");
  const requestedSize = Number(size);
  if (!Number.isFinite(requestedSize) || requestedSize <= 0) throw new Error("DEMO trade size must be positive");

  const auth = await capitalDemoAuth(env);
  const marketResult = await request("/markets/BTCUSD", auth);
  const market = marketResult.data || {};
  const rules = market.dealingRules || {};
  const min = Number(rules.minDealSize?.value);
  const step = Number(rules.minSizeIncrement?.value);
  const max = Number(rules.maxDealSize?.value);
  if (![min, step, max].every(Number.isFinite) || min <= 0 || step <= 0 || max < min) {
    throw new Error("Capital.com BTCUSD dealing rules are unavailable");
  }
  const snapshot = market.snapshot || {};
  if (snapshot.marketStatus !== "TRADEABLE") {
    throw new Error("Capital.com BTCUSD market is not tradeable");
  }
  const bid = Number(snapshot.bid), ask = Number(snapshot.offer);
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask < bid) {
    throw new Error("Capital.com returned an invalid BTCUSD quote; DEMO order blocked");
  }
  const steps = (requestedSize - min) / step;
  if (requestedSize < min || requestedSize > max || Math.abs(steps - Math.round(steps)) > 1e-8) {
    throw new Error("BTC size " + requestedSize + " is invalid. Allowed: " + min + " to " + max + " in steps of " + step);
  }
  const sl = Number(stopLevel);
  if (!Number.isFinite(sl) || sl <= 0) {
    throw new Error("Valid Stop Loss is required for DEMO orders");
  }
  const levelsValid = direction === "BUY" ? sl < bid : sl > ask;
  if (!levelsValid) {
    throw new Error(direction + " DEMO signal skipped: Stop Loss is on the wrong side of current BTCUSD bid/ask. No order was sent.");
  }
  // No broker Take Profit: positions are managed exclusively by a protective
  // stop that the scanner moves in the profitable direction.
  const orderBody = {
    epic: "BTCUSD",
    direction,
    size: requestedSize,
    stopLevel: sl
  };
  const opened = await request("/positions", auth, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderBody)
  });
  const dealReference = opened.data?.dealReference;
  if (!dealReference) throw new Error("Capital.com did not return a deal reference");

  const confirmation = await request("/confirms/" + encodeURIComponent(dealReference), auth);
  const confirmed = confirmation.data || {};
  const affected = Array.isArray(confirmed.affectedDeals) ? confirmed.affectedDeals : [];
  const deal = affected.find(item => item.status === "OPENED" && item.dealId);
  if (confirmed.dealStatus !== "ACCEPTED" || !deal) {
    throw new Error("Capital.com DEMO order was not confirmed as opened: " + (confirmed.reason || confirmed.dealStatus || confirmed.status || "unknown"));
  }
  return {
    dealReference,
    dealId: deal.dealId,
    status: confirmed.status || "OPEN",
    direction,
    size: requestedSize,
    level: Number(confirmed.level) || null
  };
}


export async function capitalDemoUpdatePosition(env, dealId, stopLevel) {
  if (!dealId) throw new Error("Capital.com deal ID is required to update the stop");
  const level = Number(stopLevel);
  if (!Number.isFinite(level) || level <= 0) throw new Error("Invalid trailing stop level");
  const auth = await capitalDemoAuth(env);
  const result = await request("/positions/" + encodeURIComponent(dealId), auth, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stopLevel: level })
  });
  const reference = result.data?.dealReference;
  if (!reference) throw new Error("Capital.com did not confirm the stop update");
  const confirmation = await request("/confirms/" + encodeURIComponent(reference), auth);
  if (confirmation.data?.dealStatus !== "ACCEPTED") {
    throw new Error("Capital.com did not accept the trailing stop update");
  }
  return { dealReference: reference, stopLevel: level };
}
