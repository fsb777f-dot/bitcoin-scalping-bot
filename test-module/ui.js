const API = "https://bitcoin-scalping-bot-test.fsb777f.workers.dev";
const STRATEGIES = [
  ["brooks", "Brooks · Second Entry", "Тренд, коррекция и второе подтверждение"],
  ["cameron", "Cameron · Momentum", "Импульс, короткий откат и пробой"],
  ["smb", "SMB · Continuation", "Продолжение тренда после консолидации"]
];
const $ = id => document.getElementById(id);
const fmt = value => value == null || !Number.isFinite(Number(value)) ? "—" :
  Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let enabled = { brooks: true, cameron: true, smb: true };
let busy = false;

function render(data) {
  if (data.settings?.enabled) enabled = { ...enabled, ...data.settings.enabled };
  const signals = data.state?.signals || {};
  const trades = data.trades || [];
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
