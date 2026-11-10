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

function renderSmc(smc) {
  if (!smc) {
    $("testSmcCard").innerHTML = '<p class="notice">SMC ожидает первое сканирование тестового Worker.</p>';
    return;
  }
  const signal = smc.signal || {};
  const side = signal.side || "WAIT";
  const stats = smc.stats || {};
  const trades = smc.trades || [];
  const open = trades.filter(t => t.status === "OPEN").length;
  const wins = Number(stats.wins) || 0, losses = Number(stats.losses) || 0;
  const pnl = Number(stats.pnl) || 0;
  const decided = wins + losses;
  const zone = signal.zone;
  $("testSmcCard").innerHTML = '<article class="test-card"><div class="test-card-head"><div><b>Smart Money Concepts · BOS / CHoCH / OB / FVG</b>' +
    '<small>Тренд 1H · зона 5m · вход 1m · Capital.com Demo · только виртуально</small></div>' +
    '<b class="test-signal ' + (side === "BUY" ? "green" : side === "SELL" ? "red" : "yellow") + '">' + side + '</b></div>' +
    '<div class="test-confluence">Тренд 1H: <b>' + (signal.bias || "WAIT") + '</b> · ' + (signal.reason || "Ожидание данных") + '</div>' +
    '<div class="test-stats"><span>Зона <b>' + (zone?.type || "—") + '</b></span><span>От <b>' + fmt(zone?.low) +
    '</b></span><span>До <b>' + fmt(zone?.high) + '</b></span><span>Take Profit <b>Нет · трейлинг SL</b></span></div>' +
    '<div class="test-stats"><span>Всего <b>' + (Number(stats.opened) || 0) + '</b></span><span>Открыто <b>' + open +
    '</b></span><span>Плюс <b class="green">' + wins + '</b></span><span>Минус <b class="red">' + losses +
    '</b></span><span>Winrate <b>' + (decided ? (100 * wins / decided).toFixed(1) + "%" : "—") +
    '</b></span><span>PnL на 1 BTC <b class="' + (pnl > 0 ? "green" : pnl < 0 ? "red" : "") + '">' + fmt(pnl) +
    '</b></span></div><p class="notice">Спред Capital.com учтён через Bid/Ask; ночное финансирование не учтено.</p></article>';
  $("testSmcTradeList").innerHTML = trades.length ? trades.slice(0, 40).map(t =>
    '<div class="test-trade"><b>SMC</b><span class="' + (t.side === "BUY" ? "green" : "red") + '">' + t.side +
    '</span><span>Вход ' + fmt(t.entry) + '</span><span>SL ' + fmt(t.sl) + '</span><span>TP нет</span>' +
    '<span>' + (t.status === "OPEN" ? "ОТКРЫТА" : (Number(t.pnl) > 0 ? "ПРИБЫЛЬ" : Number(t.pnl) < 0 ? "УБЫТОК" : "БЕЗУБЫТОК") + " · " + fmt(t.pnl)) +
    '</span></div>').join("") : '<p class="notice">SMC ищет подтверждённые сигналы. Пока сделок нет.</p>';
}

function render(data) {
  if (data.settings?.enabled) enabled = { ...enabled, ...data.settings.enabled };
  renderSmc(data.state?.analysis?.smc);
  const signals = data.state?.signals || {};
  const trades = (data.trades || []).filter(t => t.strategy === "consensus");
  const side = signals.consensus || "WAIT";
  const confirmations = signals.confirmations || [];
  const rows = trades.filter(t => t.strategy === "consensus");
  const closed = rows.filter(t => t.status === "CLOSED");
  const wins = closed.filter(t => Number(t.pnl) > 0).length;
  const losses = closed.filter(t => Number(t.pnl) < 0).length;
  const decided = wins + losses;
  const pnl = closed.reduce((sum, t) => sum + (Number(t.pnl) || 0), 0);
  $("testCards").innerHTML =
    '<article class="test-card"><div class="test-card-head"><div><b>Единая система · SMB + Brooks + Cameron</b><small>Общий сигнал только при согласии минимум двух стратегий из трёх</small></div><b class="test-signal ' +
    (side === "BUY" ? "green" : side === "SELL" ? "red" : "yellow") + '">' + side + '</b></div>' +
    '<div class="test-confluence">Подтвердили сигнал: <b>' + (confirmations.length ? confirmations.map(id => STRATEGIES.find(s => s[0] === id)?.[1].split(" · ")[0] || id).join(" + ") : "нет") + '</b> · ' +
    confirmations.length + '/3</div>' +
    '<div class="test-stats"><span>Вход <b>' + fmt(signals.consensus_entry) + '</b></span><span>Stop Loss <b>' + fmt(signals.consensus_sl) + '</b></span><span>Take Profit <b>' + fmt(signals.consensus_tp) + '</b></span></div>' +
    '<div class="test-confluence">' + STRATEGIES.map(([id, name]) => {
      const s = signals[id] || "WAIT";
      return name.split(" · ")[0] + ': <b class="' + (s === "BUY" ? "green" : s === "SELL" ? "red" : "yellow") + '">' + s + '</b>';
    }).join(' &nbsp; · &nbsp; ') + '</div>' +
    '<div class="test-stats"><span>Сделок <b>' + rows.length + '</b></span><span>Winrate <b>' + (decided ? (wins / decided * 100).toFixed(1) + "%" : "—") + '</b></span>' +
    '<span>Плюс <b class="green">' + wins + '</b></span><span>Минус <b class="red">' + losses + '</b></span><span>PnL <b class="' + (pnl > 0 ? "green" : pnl < 0 ? "red" : "") + '">' + fmt(pnl) + '</b></span></div></article>';
  $("testTradeList").innerHTML = trades.length ? trades.slice(0, 30).map(t =>
    '<div class="test-trade"><b>' + (t.strategy === "consensus" ? "Объединённая система (2 из 3)" : (STRATEGIES.find(s => s[0] === t.strategy)?.[1] || t.strategy)) + '</b>' +
    '<span class="' + (t.side === "BUY" ? "green" : "red") + '">' + t.side + '</span>' +
    '<span>Вход ' + fmt(t.entry) + '</span><span>SL ' + fmt(t.sl) + '</span><span>TP ' + fmt(t.tp) + '</span>' + (t.confirmations?.length ? '<span>Подтвердили: ' + t.confirmations.join(" + ") + '</span>' : '') +
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
