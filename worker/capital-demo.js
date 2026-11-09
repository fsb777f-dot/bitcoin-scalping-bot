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
      balance: account.balance?.balance ?? accountInfo.balance ?? null,
      available: account.balance?.available ?? accountInfo.available ?? null,
      status: account.status || null
    } : {
      currency: detailsResult.data?.currency || null,
      balance: accountInfo.balance ?? null,
      available: accountInfo.available ?? null
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
