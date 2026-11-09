// Multi-timeframe BTC/USD data and technical context for the isolated test worker.
// Use exchange fallbacks because Binance can reject requests from some Cloudflare regions.
const TIMEFRAMES = [
  { id: "1m", kraken: 1, coinbase: 60, bybit: "1" },
  { id: "5m", kraken: 5, coinbase: 300, bybit: "5" },
  { id: "15m", kraken: 15, coinbase: 900, bybit: "15" },
  { id: "1h", kraken: 60, coinbase: 3600, bybit: "60" },
  { id: "4h", kraken: 240, coinbase: 21600, bybit: "240" }
];

async function json(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json();
}

async function fromKraken(tf) {
  const [ohlc, ticker] = await Promise.all([
    json("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=" + tf.kraken),
    json("https://api.kraken.com/0/public/Ticker?pair=XBTUSD")
  ]);
  if (ohlc.error?.length) throw new Error("Kraken: " + ohlc.error.join(", "));
  const key = Object.keys(ohlc.result || {}).find(k => k !== "last");
  const rows = key ? ohlc.result[key] : [];
  const candles = rows.slice(0, -1).map(r => ({
    time: Number(r[0]), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[6]
  })).filter(c => [c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite));
  const tickerKey = Object.keys(ticker.result || {})[0];
  const price = Number(ticker.result?.[tickerKey]?.c?.[0]);
  if (candles.length < 60 || !Number.isFinite(price) || price <= 0) throw new Error("Kraken returned insufficient or invalid data");
  return { candles, price };
}

async function fromCoinbase(tf) {
  const [rows, ticker] = await Promise.all([
    json("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=" + tf.coinbase),
    json("https://api.exchange.coinbase.com/products/BTC-USD/ticker")
  ]);
  if (!Array.isArray(rows)) throw new Error("Coinbase returned invalid candles");
  const candles = rows.slice().reverse().slice(0, -1).map(r => ({
    time: Number(r[0]), low: +r[1], high: +r[2], open: +r[3], close: +r[4], volume: +r[5]
  })).filter(c => [c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite));
  const price = Number(ticker.price);
  if (candles.length < 60 || !Number.isFinite(price) || price <= 0) throw new Error("Coinbase returned insufficient or invalid data");
  return { candles, price };
}

async function fromBybit(tf) {
  const [market, ticker] = await Promise.all([
    json("https://api.bybit.com/v5/market/kline?category=spot&symbol=BTCUSDT&interval=" + tf.bybit + "&limit=300"),
    json("https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT")
  ]);
  if (market.retCode !== 0 || !Array.isArray(market.result?.list)) throw new Error("Bybit: " + (market.retMsg || "invalid candles"));
  const candles = market.result.list.slice().reverse().slice(0, -1).map(r => ({
    time: Number(r[0]) / 1000, open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5]
  })).filter(c => [c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite));
  const price = Number(ticker.result?.list?.[0]?.lastPrice);
  if (candles.length < 60 || !Number.isFinite(price) || price <= 0) throw new Error("Bybit returned insufficient or invalid data");
  return { candles, price };
}

const ema = (values, period) => {
  if (values.length < period) return null;
  let value = values.slice(0, period).reduce((sum, n) => sum + n, 0) / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
};

function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (!losses) return gains ? 100 : 50;
  return 100 - 100 / (1 + gains / losses);
}

function atr(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const ranges = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], previous = candles[i - 1].close;
    ranges.push(Math.max(c.high - c.low, Math.abs(c.high - previous), Math.abs(c.low - previous)));
  }
  const recent = ranges.slice(-period);
  return recent.reduce((sum, n) => sum + n, 0) / recent.length;
}

function macd(values) {
  if (values.length < 35) return { line: null, signal: null, histogram: null };
  const line = [];
  for (let i = 0; i < values.length; i++) {
    const slice = values.slice(0, i + 1);
    const fast = ema(slice, 12), slow = ema(slice, 26);
    line.push(fast === null || slow === null ? null : fast - slow);
  }
  const valid = line.filter(Number.isFinite);
  const signal = ema(valid, 9);
  const current = valid.at(-1);
  return { line: current, signal, histogram: signal === null ? null : current - signal };
}

function fibonacci(candles) {
  const window = candles.slice(-100);
  if (!window.length) return null;
  const high = Math.max(...window.map(c => c.high));
  const low = Math.min(...window.map(c => c.low));
  const last = window.at(-1).close;
  const highIndex = window.findLastIndex(c => c.high === high);
  const lowIndex = window.findLastIndex(c => c.low === low);
  const uptrend = highIndex > lowIndex;
  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return null;
  const levels = uptrend
    ? { "0.236": high - range * .236, "0.382": high - range * .382, "0.5": high - range * .5, "0.618": high - range * .618, "0.786": high - range * .786 }
    : { "0.236": low + range * .236, "0.382": low + range * .382, "0.5": low + range * .5, "0.618": low + range * .618, "0.786": low + range * .786 };
  return { trend: uptrend ? "UP" : "DOWN", high, low, levels, nearest: Object.entries(levels).sort((a,b) => Math.abs(a[1]-last)-Math.abs(b[1]-last))[0][0] };
}

function analyze(candles) {
  const closes = candles.map(c => c.close);
  const fast = ema(closes, 9), medium = ema(closes, 21), slow = ema(closes, 50), long = ema(closes, 200);
  const momentum = macd(closes);
  const direction = fast === null || medium === null ? "WAIT" : fast > medium ? "UP" : fast < medium ? "DOWN" : "WAIT";
  return {
    candle_count: candles.length,
    candle_time: candles.at(-1)?.time ?? null,
    price: closes.at(-1) ?? null,
    ema: { "9": fast, "21": medium, "50": slow, "200": long },
    rsi14: rsi(closes),
    macd: momentum,
    atr14: atr(candles),
    trend: direction,
    fibonacci: fibonacci(candles)
  };
}

export async function loadMarketAnalysis() {
  const providers = [
    { name: "Kraken", load: fromKraken },
    { name: "Coinbase", load: fromCoinbase },
    { name: "Bybit", load: fromBybit }
  ];
  const failures = [];

  for (const provider of providers) {
    try {
      const responses = await Promise.all(TIMEFRAMES.map(async tf => {
        const result = await provider.load(tf);
        return [tf.id, result];
      }));
      const frames = Object.fromEntries(responses);
      const oneMinute = frames["1m"];
      return {
        price: oneMinute.price,
        candles: oneMinute.candles,
        analysis: {
          source: provider.name,
          symbol: "BTC/USD",
          updated_at: new Date().toISOString(),
          timeframes: Object.fromEntries(responses.map(([id, value]) => [id, analyze(value.candles)])),
          errors: {}
        }
      };
    } catch (error) {
      failures.push(provider.name + ": " + (error?.message || String(error)));
    }
  }

  throw new Error("All market-data sources failed. " + failures.join(" | "));
}
