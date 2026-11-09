const API = "https://bitcoin-scalping-bot-test.fsb777f.workers.dev";
const STRATEGIES = [
  ["brooks", "Brooks · Second Entry", "Тренд, коррекция и второе подтверждение"],
  ["cameron", "Cameron · Momentum", "Импульс, короткий откат и пробой"],
  ["smb", "SMB · Continuation", "Продолжение тренда после консолидации"]
];
const $ = id => document.getElementById(id);
const fmt = value => value == null || !Number.isFinite(Number(value)) ? "—" :
  Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSmall = value => value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(2);
const FRAME_NAMES = { "1m": "1 мин", "5m": "5 мин", "15m": "15 мин", "1h": "1 час", "4h": "4 часа" };

function renderMarketAnalysis(analysis) {
  const host = $("testMarketAnalysis");
  if (!host) return;
  const frames = analysis?.timeframes;
  if (!frames) {
    host.innerHTML = '<p class="notice">Ожидание серверного расчёта индикаторов. Worker обновляет данные раз в минуту.</p>';
    return;
  }
  host.innerHTML = '<div class="test-market-meta">Источник: ' + (analysis.source || "—") + ' · ' +
    (analysis.updated_at ? new Date(analysis.updated_at).toLocaleTimeString("ru-RU") : "—") + '</div>' +
    '<div class="test-market-grid">' + Object.entries(FRAME_NAMES).map(([id, label]) => {
      const x = frames[id];
      if (!x) return '<article class="test-market-card"><b>' + label + '</b><p class="notice">Нет данных</p></article>';
      const fib = x.fibonacci;
      const macdTone = x.macd?.histogram > 0 ? "green" : x.macd?.histogram < 0 ? "red" : "";
      return '<article class="test-market-card"><div class="test-market-head"><b>' + label + '</b><span class="' +
        (x.trend === "UP" ? "green" : x.trend === "DOWN" ? "red" : "yellow") + '">' +
        (x.trend === "UP" ? "РОСТ" : x.trend === "DOWN" ? "СНИЖЕНИЕ" : "ОЖИДАНИЕ") + '</span></div>' +
        '<div class="test-market-price">' + fmt(x.price) + '</div>' +
        '<div class="test-indicators"><span>EMA 9 <b>' + fmt(x.ema?.["9"]) + '</b></span>' +
        '<span>EMA 21 <b>' + fmt(x.ema?.["21"]) + '</b></span>' +
        '<span>EMA 50 <b>' + fmt(x.ema?.["50"]) + '</b></span>' +
        '<span>EMA 200 <b>' + fmt(x.ema?.["200"]) + '</b></span>' +
        '<span>RSI 14 <b>' + fmtSmall(x.rsi14) + '</b></span>' +
        '<span>MACD hist <b class="' + macdTone + '">' + fmtSmall(x.macd?.histogram) + '</b></span>' +
        '<span>ATR 14 <b>' + fmt(x.atr14) + '</b></span></div>' +
        '<div class="test-fib"><b>Fibonacci</b><span>Тренд: ' + (fib?.trend === "UP" ? "рост" : fib?.trend === "DOWN" ? "снижение" : "—") +
        '</span><span>23.6% ' + fmt(fib?.levels?.["0.236"]) + '</span><span>38.2% ' + fmt(fib?.levels?.["0.382"]) +
        '</span><span>50% ' + fmt(fib?.levels?.["0.5"]) + '</span><span>61.8% ' + fmt(fib?.levels?.["0.618"]) +
        '</span><span>78.6% ' + fmt(fib?.levels?.["0.786"]) + '</span></div></article>';
    }).join("") + '</div>';
}
let enabled = { brooks: true, cameron: true, smb: true };
let busy = false;

function render(data) {
  if (data.settings?.enabled) enabled = { ...enabled, ...data.settings.enabled };
  const signals = data.state?.signals || {};
  const trades = data.trades || [];\n  const analysis = data.state?.analysis;\n  renderMarketAnalysis(analysis);\n  renderMarketAnalysis(data.state?.analysis);
  $("testCards").innerHTML = STRATEGIES.map(([id, name, description]) => {
    const side = signals[id] || "WAIT";
    const rows = trades.filter(t => t.strategy === id);
    const closed = rows.filter(t => t.status === "CLOSED");
    const wins = closed.filter(t => Number(t.pnl) > 0).length;
    const losses = closed.filter(t => Number(t.pnl) < 0).length;
    const decided = wins + losses;
    const pnl = closed.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
    return '<article class="test-card"><div class="test-card-head"><div><b>' + name + '</b><small>' + description + '</small></div>' +
      '<label class="switch"><input type="checkbox" data-test-toggle="' + id + '"' + (enabled[id] ? ' checked' : '') + '><span class="switch-slider"></span></label></div>' +
      '<div class="test-signal ' + (side === "BUY" ? "green" : side === "SELL" ? "red" : "yellow") + '">' + (enabled[id] ? side : "ВЫКЛ") + '</div>' +
      '<div class="test-confluence">Подтверждения индикаторов: <b>' + (context ? context.confirmations + "/" + context.checks : "—") + '</b> · тренд 5m/15m, MACD, RSI</div>' +
      '<div class="test-stats"><span>Сделок <b>' + rows.length + '</b></span><span>Winrate <b>' + (decided ? (wins / decided * 100).toFixed(1) + "%" : "—") + '</b></span>' +
      '<span>Плюс <b class="green">' + wins + '</b></span><span>Минус <b class="red">' + losses + '</b></span><span>PnL <b class="' + (pnl > 0 ? "green" : pnl < 0 ? "red" : "") + '">' + fmt(pnl) + '</b></span></div></article>';
  }).join("");
  $("testTradeList").innerHTML = trades.length ? trades.slice(0, 30).map(t =>
    '<div class="test-trade"><b>' + (STRATEGIES.find(s => s[0] === t.strategy)?.[1] || t.strategy) + '</b>' +
    '<span class="' + (t.side === "BUY" ? "green" : "red") + '">' + t.side + '</span>' +
    '<span>Вход ' + fmt(t.entry) + '</span><span>SL ' + fmt(t.sl) + '</span><span>TP ' + fmt(t.tp) + '</span>' +
    '<span>' + (t.status === "OPEN" ? "ОТКРЫТА" : (Number(t.pnl) >= 0 ? "ПРИБЫЛЬ" : "УБЫТОК") + " · " + fmt(t.pnl)) + '</span></div>'
  ).join("") : '<p class="notice">Тестовых сделок пока нет. Модуль начнёт записывать их после появления сигналов.</p>';
  $("testUpdated").textContent = data.state?.updated_at
    ? "Обновлено " + new Date(data.state.updated_at).toLocaleTimeString("ru-RU") + " · " + (data.state.timeframe || "1m")
    : "Ожидание первого серверного сканирования";
}

async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const response = await fetch(API + "/api/test-data", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
    render(data);
    $("testError").textContent = "";
  } catch (error) {
    $("testError").textContent = "Тестовый модуль пока не подключён к базе: " + error.message + ". Проверьте SQL-таблицы из supabase/test-module.sql.";
  } finally { busy = false; }
}

$("testCards").addEventListener("change", async event => {
  const input = event.target.closest("[data-test-toggle]");
  if (!input) return;
  const id = input.dataset.testToggle;
  const previous = !!enabled[id];
  enabled[id] = input.checked;
  input.disabled = true;
  try {
    const response = await fetch(API + "/api/test-settings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
  } catch (error) {
    enabled[id] = previous;
    input.checked = previous;
    $("testError").textContent = "Не удалось сохранить переключатель: " + error.message;
  } finally { input.disabled = false; }
});
refresh();
setInterval(refresh, 10000);
