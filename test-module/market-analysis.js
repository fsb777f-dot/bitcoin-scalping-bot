// Multi-timeframe BTC/USD data and technical context for the isolated test worker.
const TIMEFRAMES = [
  { id: "1m", interval: 1 },
  { id: "5m", interval: 5 },
  { id: "15m", interval: 15 },
  { id: "1h", interval: 60 },
  { id: "4h", interval: 240 }
];

const BINANCE_HOSTS = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com"
];

async function fetchBinance(path) {
  const errors = [];
  for (const host of BINANCE_HOSTS) {
    try {
      const response = await fetch(host + path, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        errors.push(host + " HTTP " + response.status);
        continue;
      }
      return await response.json();
    } catch (error) {
      errors.push(host + ": " + (error?.message || String(error)));
    }
  }
  throw new Error("Binance data unavailable: " + errors.join(" | "));
}

function normalizeCandles(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, -1).map(row => ({
    time: Number(row[0]) / 1000,
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5])
  })).filter(c => [c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite));
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
  const responses = await Promise.all(TIMEFRAMES.map(async tf => {
    const rows = await fetchBinance("/api/v3/klines?symbol=BTCUSDT&interval=" + tf.id + "&limit=300");
    const candles = normalizeCandles(rows);
    if (candles.length < 60) throw new Error("Недостаточно свечей для " + tf.id + ": " + candles.length);
    return [tf.id, { candles, analysis: analyze(candles) }];
  }));
  const ticker = await fetchBinance("/api/v3/ticker/price?symbol=BTCUSDT");
  const price = Number(ticker?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Binance вернул неверную цену BTC/USDT");
  const frames = Object.fromEntries(responses);
  return {
    price,
    candles: frames["1m"].candles,
    analysis: {
      source: "Kraken",
      symbol: "BTC/USD",
      updated_at: new Date().toISOString(),
      timeframes: Object.fromEntries(Object.entries(frames).map(([id, value]) => [id, value.analysis]))
    }
  };
}
