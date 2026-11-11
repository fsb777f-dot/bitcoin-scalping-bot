// Multi-timeframe BTCUSD data and technical context for the isolated test worker.
// Every paper strategy uses the same executable Capital.com DEMO feed.
const TIMEFRAMES = [
  { id: "1m" },
  { id: "5m" },
  { id: "15m" },
  { id: "1h" },
  { id: "4h" }
];

async function fromCapital() {
  // Read-only quotes through the main worker; no broker credentials in the test worker.
  const url = "https://bitcoin-scalping-bot.fsb777f.workers.dev/api/capital-demo/market-bundle";
  let response;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    if (response.ok || ![429, 502, 503].includes(response.status) || attempt) break;
    await new Promise(resolve => setTimeout(resolve, 1300)); // Capital.com limits new sessions to 1/s.
  }
  if (!response.ok) throw new Error("Capital.com bundle HTTP " + response.status);
  const data = await response.json();
  const frames = data?.frames;
  if (!frames || TIMEFRAMES.some(tf => !Array.isArray(frames[tf.id]?.candles) || frames[tf.id].candles.length < 60)) {
    throw new Error("Capital.com returned incomplete test timeframes");
  }
  return { frames: Object.fromEntries(TIMEFRAMES.map(tf => [tf.id, frames[tf.id]])),
    price: frames["1m"].price, bid: frames["1m"].bid, ask: frames["1m"].ask, spread: frames["1m"].spread };
}

export async function loadSmcCapitalMarket() {
  const capital = await fromCapital();
  return {
    price: capital.price, bid: capital.bid, ask: capital.ask, spread: capital.spread,
    frames: Object.fromEntries(TIMEFRAMES.map(tf => [tf.id, capital.frames[tf.id].candles])),
    analysis: { source: "Capital.com Demo" }
  };
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
  const capital = await fromCapital();
  const frames = Object.fromEntries(TIMEFRAMES.map(tf => [tf.id, capital.frames[tf.id].candles]));
  return {
    price: capital.price, bid: capital.bid, ask: capital.ask, spread: capital.spread,
    candles: frames["1m"], frames,
    analysis: {
      source: "Capital.com Demo", symbol: "BTCUSD",
      updated_at: new Date().toISOString(),
      timeframes: Object.fromEntries(TIMEFRAMES.map(tf => [tf.id, analyze(frames[tf.id])])),
      errors: {}
    }
  };
}
