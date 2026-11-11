// Isolated display: reads only the GPT virtual journal endpoint.
const asNumber = n => n == null || !Number.isFinite(Number(n)) ? "—"
  : Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safeText = v => String(v ?? "").replace(/[&<>"']/g, x => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[x]));

export function initGptStrategyUi(worker) {
  const get = id => document.getElementById(id);
  if (!get("gptStatus")) return;
  async function refresh() {
    try {
      const response = await fetch(worker + "/api/gpt-strategy", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "HTTP " + response.status);
      const state = data.state || {}, stats = data.stats || {};
      get("gptSignal").textContent = state.side || "WAIT";
      get("gptSignal").className = state.side === "BUY" ? "green" : state.side === "SELL" ? "red" : "";
      get("gptIndicators").textContent = "5m · RSI " + asNumber(state.rsi) + " · Stochastic K/D "
        + asNumber(state.stoch_k) + " / " + asNumber(state.stoch_d)
        + " · цена " + asNumber(state.price)
        + " · сканер " + (state.updated_at ? new Date(state.updated_at).toLocaleString("ru-RU") : "ещё не запущен");
      for (const key of ["total", "open", "closed", "wins", "losses"]) get("gpt-" + key).textContent = stats[key] ?? 0;
      get("gpt-winrate").textContent = stats.winrate == null ? "—" : asNumber(stats.winrate) + "%";
      get("gpt-pnl").textContent = asNumber(stats.pnl) + " USD / 1 BTC";
      get("gpt-pnl").className = Number(stats.pnl) >= 0 ? "green" : "red";
      get("gpt-pf").textContent = asNumber(stats.profit_factor);
      get("gptJournal").innerHTML = (data.trades || []).map(trade => {
        const pnl = Number(trade.pnl);
        return '<div class="test-trade"><div><b class="' + (trade.side === "BUY" ? "green" : "red") + '">' + safeText(trade.side)
          + '</b> · ' + safeText(trade.status) + ' · ' + safeText(new Date(trade.opened_at).toLocaleString("ru-RU"))
          + '</div><div>Вход: ' + asNumber(trade.entry) + ' · Стоп: ' + asNumber(trade.sl)
          + ' · Трейлинг от: ' + asNumber(trade.tp) + '</div><div>Выход: ' + asNumber(trade.exit_price)
          + ' · PnL: <b class="' + (pnl >= 0 ? "green" : "red") + '">' + asNumber(trade.pnl) + '</b></div></div>';
      }).join("") || '<p class="notice">Пока нет сделок: ЧПТ ждёт совпадения обоих индикаторов.</p>';
      get("gptStatus").textContent = "Capital.com Demo · виртуальный тест · обновлено " + new Date().toLocaleTimeString("ru-RU");
    } catch (e) {
      get("gptStatus").textContent = "Не удалось загрузить Стратегию ЧПТ: " + e.message + ". Проверь SQL-миграцию журнала.";
    }
  }
  get("gptRefresh").addEventListener("click", refresh);
  refresh();
  setInterval(refresh, 60_000);
}
