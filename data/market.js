import { CONFIG } from "../js/config.js";

const hosts = [
  "https://api.binance.com",
  "https://data-api.binance.vision",
  "https://api1.binance.com",
  "https://api2.binance.com",
  "https://api3.binance.com"
];

async function binanceFetch(path) {
  const errors = [];
  for (const host of hosts) {
    try {
      const response = await fetch(host + path, { headers: { "Accept": "application/json" } });
      if (!response.ok) {
        errors.push(host + " HTTP " + response.status);
        continue;
      }
      return await response.json();
    } catch (error) {
      errors.push(host + ": " + (error?.message || String(error)));
    }
  }
  throw new Error("Binance market data unavailable: " + errors.join(" | "));
}

export async function loadCandles(tf) {
  const interval = tf === "5m" ? "5m" : "1m";
  const raw = await binanceFetch(
    "/api/v3/klines?symbol=" + CONFIG.symbol + "&interval=" + interval + "&limit=300"
  );
  if (!Array.isArray(raw) || raw.length < 60) throw new Error("Binance returned too few candles");
  return raw.map(k => ({
    time: Number(k[0]) / 1000,
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5])
  }));
}

export function connectMarket(tf, onCandle, onStatus) {
  const interval = tf === "5m" ? "5m" : "1m";
  const ws = new WebSocket(CONFIG.stream + "/" + CONFIG.symbol.toLowerCase() + "@kline_" + interval);
  ws.onopen = () => onStatus?.(true);
  ws.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      const k = message.k;
      if (!k) return;
      onCandle({
        time: Number(k.t) / 1000,
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
        volume: Number(k.v)
      }, Boolean(k.x));
    } catch (error) {
      console.error("Binance WebSocket message error:", error);
    }
  };
  ws.onerror = () => onStatus?.(false);
  ws.onclose = () => onStatus?.(false);
  return ws;
}
