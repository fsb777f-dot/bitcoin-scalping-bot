// Read-only unified terminal. No INSERT, UPDATE, DELETE, PATCH, POST or trading actions.
const MAIN = "https://bitcoin-scalping-bot.fsb777f.workers.dev";
const GOLD = "https://gold-ai-trading-bot.fsb777f.workers.dev";
const TEST = "https://bitcoin-scalping-bot-test.fsb777f.workers.dev";
const $ = id => document.getElementById(id);
const escape = value => String(value ?? "").replace(/[&<>"']/g, ch =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const validNumber = value => value !== null && value !== undefined && value !== ""
  && Number.isFinite(Number(value));
const number = (value, decimals = 2) => validNumber(value)
  ? Number(value).toLocaleString("ru-RU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  : "—";
const percent = value => validNumber(value) ? number(value, 1) + "%" : "—";
const amount = (value, unit = "") => validNumber(value)
  ? (Number(value) > 0 ? "+" : "") + number(value) + (unit ? " " + unit : "") : "—";
const directionClass = side => side === "BUY" ? "tt-buy" : side === "SELL" ? "tt-sell"
  : side === "OFF" ? "tt-off" : "tt-wait";
const dateText = value => {
  if (value === null || value === undefined || value === "") return "—";
  const time = Number(value);
  const date = new Date(Number.isFinite(time) ? (time < 1e11 ? time * 1000 : time) : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
};
const safeSide = side => ["BUY", "SELL", "WAIT", "OFF"].includes(side) ? side : "WAIT";
const uiText = id => $(id)?.textContent?.trim() || "—";
const readJson = async url => {
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(18000) : undefined;
  const response = await fetch(url, { method: "GET", cache: "no-store", signal });
  if (!response.ok) throw Error("HTTP " + response.status);
  const data = await response.json();
  if (data?.error) throw Error(String(data.error));
  return data;
};
const metric = (label, value) => '<div class="tt-metric"><small>' + escape(label)
  + '</small><strong>' + escape(value) + '</strong></div>';
const card = ({ title, detail, side, metrics, footer }) => '<article class="tt-card">'
  + '<div class="tt-system-title"><b>' + escape(title) + '</b><span class="tt-system-signal '
  + directionClass(side) + '">' + escape(side || "—") + '</span></div>'
  + '<div class="tt-system-sub">' + escape(detail || "") + '</div>'
  + '<div class="tt-metrics">' + metrics.map(pair => metric(pair[0], pair[1])).join("") + '</div>'
  + '<div class="tt-system-footer">' + escape(footer || "") + '</div></article>';
const unavailable = (title, description) => card({
  title, detail: description, side: "—", metrics: [["Статистика", "—"]],
  footer: "Источник временно недоступен. Старые значения не выдаются за текущие."
});
const pnlClass = value => Number(value) > 0 ? "tt-buy" : Number(value) < 0 ? "tt-sell" : "tt-wait";

function drawChart(id, dates, source) {
  const host = $(id + "Chart");
  const all = (Array.isArray(dates) ? dates : []).filter(row =>
    validNumber(row?.close) && validNumber(row?.time));
  const data = all.slice(-84);
  if (data.length < 5) {
    host.innerHTML = '<div class="tt-chart-empty">Недостаточно исторических свечей 5m</div>';
    $(id + "ChartAt").textContent = "—";
    return;
  }
  const values = data.map(row => Number(row.close));
  const low = Math.min(...values), high = Math.max(...values);
  const range = high - low || 1;
  const width = 900, height = 240, pad = 17;
  const coords = values.map((v, i) => [
    pad + i * (width - 2 * pad) / (values.length - 1),
    height - pad - (v - low) / range * (height - 2 * pad)
  ]);
  const path = coords.map((p, i) => (i ? "L" : "M") + p[0].toFixed(2) + " " + p[1].toFixed(2)).join(" ");
  const end = coords.at(-1), gain = values.at(-1) >= values[0];
  const stroke = gain ? "#38e6ad" : "#ff819a";
  const fill = gain ? "#35d8a6" : "#fa708b";
  const area = path + " L" + end[0].toFixed(2) + " " + height + " L" + pad + " " + height + " Z";
  const lines = [60, 120, 180].map(y =>
    '<line x1="0" x2="900" y1="' + y + '" y2="' + y + '" stroke="#2c415d" stroke-width="1"/>').join("");
  host.innerHTML = '<svg viewBox="0 0 900 240" preserveAspectRatio="none" role="img" aria-label="Динамика '
    + escape(id === "ttBtc" ? "Bitcoin" : "Gold") + ' по 5-минутным свечам"><defs><linearGradient id="'
    + id + 'Grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + fill
    + '" stop-opacity=".23"/><stop offset="1" stop-color="' + fill
    + '" stop-opacity="0"/></linearGradient></defs>'
    + lines + '<path d="' + area + '" fill="url(#' + id + 'Grad)"/>'
    + '<path d="' + path + '" fill="none" stroke="' + stroke + '" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>'
    + '<circle cx="' + end[0] + '" cy="' + end[1] + '" r="6" fill="' + stroke + '"/>'
    + '</svg>';
  $(id + "ChartAt").textContent = dateText(data.at(-1).time) + (source?.stale ? " · сохранённая история" : "");
}

export function initTradingTerminal(supabase) {
  if (!$("terminal-section")) return { activate() {}, deactivate() {} };
  let active = false, timer = null, busy = false, chartFetchedAt = 0, chartBusy = false;

  function setSignal(id, side, description) {
    const element = $(id + "Side");
    element.textContent = side == null ? "—" : safeSide(side);
    element.className = "tt-direction " + directionClass(side);
    $(id + "Info").textContent = description;
  }

  function sourceStrip(responses) {
    const pairs = [
      ["Bitcoin", "bitcoin"], ["Gold", "gold"], ["ЧПТ BTC", "btcGpt"],
      ["ЧПТ Gold", "goldGpt"], ["Тест", "test"]
    ];
    $("ttSources").innerHTML = pairs.map(([name, key]) => {
      const item = responses[key];
      const good = item?.status === "fulfilled";
      return '<span class="tt-source ' + (good ? "tt-up" : "tt-error")
        + '" title="' + escape(good ? "Источник доступен" : (item?.reason?.message || "Ошибка загрузки"))
        + '"><i class="tt-dot"></i>' + escape(name) + ' · ' + (good ? "OK" : "нет связи") + '</span>';
    }).join("") + '<span class="tt-source">Обновлено ' + escape(new Date().toLocaleTimeString("ru-RU")) + '</span>';
  }

  function signalSummary(state, gold, test) {
    if (state) {
      setSignal("ttMain", state.side, number(state.count, 0) + " совпадений из "
        + number(state.active_count, 0) + " · нужно " + number(state.required_matches, 0));
      const side = state.ai_enabled ? state.ai_side : "OFF";
      setSignal("ttAi", side, "Confidence " + (state.ai_enabled ? percent(state.ai_confidence) : "—")
        + " · выбрано " + number((state.ai_selected || []).length, 0) + " стратегий");
      $("ttBtcPrice").textContent = number(state.price);
      $("ttAnalysisNote").textContent = state.ai_reason
        ? "AI: " + state.ai_reason + " Уверенность — доля голосов, а не вероятность прибыли."
        : "Уверенность AI — доля голосов, а не вероятность прибыли.";
    } else {
      setSignal("ttMain", null, "Bitcoin Worker недоступен");
      setSignal("ttAi", null, "Bitcoin Worker недоступен");
      $("ttBtcPrice").textContent = "—";
    }
    if (gold?.state) {
      setSignal("ttGold", gold.state.side, number(gold.state.matches, 0)
        + " совпадений · " + (gold.state.scan_timeframe || "1m") + " · "
        + dateText(gold.state.updated_at));
      $("ttGoldPrice").textContent = number(gold.state.price);
    } else {
      setSignal("ttGold", null, "Gold Worker недоступен");
      $("ttGoldPrice").textContent = "—";
    }
    if (test?.state) {
      const votes = test.state.signals?.confirmations || [];
      setSignal("ttTest", test.state.signals?.consensus || "WAIT",
        number(votes.length, 0) + "/3 подтверждения · " + dateText(test.state.updated_at));
    } else setSignal("ttTest", null, "Тестовый Worker недоступен");
  }

  function systemCards(state, gold, btcGpt, goldGpt, test) {
    const systems = [];
    if (!state) systems.push(unavailable("Bitcoin · основной", "Текущий сигнал не загружен"));
    else systems.push(card({
      title: "Bitcoin · основной", detail: "Основной сканер · Capital.com",
      side: state.side || "WAIT",
      metrics: [["Совпадения", number(state.count, 0)],
        ["Включено", number(state.active_count, 0) + " / 41"],
        ["Вход", number(state.entry)], ["Stop Loss", number(state.sl)]],
      footer: "Итоговая статистика основного бота доступна во вкладке «Журнал». Сделки здесь не создаются."
    }));
    if (!state) systems.push(unavailable("Bitcoin · AI Аналитик", "Серверный сигнал AI недоступен"));
    else systems.push(card({
      title: "Bitcoin · AI Аналитик", detail: "Собственный журнал AI · статистика приложения",
      side: state.ai_enabled ? (state.ai_side || "WAIT") : "OFF",
      metrics: [["Сделок", uiText("aiTradeTotal")],
        ["Открыто", uiText("aiTradeOpen")],
        ["Winrate", uiText("aiWinRate")],
        ["PnL · USD / 1 BTC", uiText("aiPnl")]],
      footer: "Confidence " + (state.ai_enabled ? percent(state.ai_confidence) : "—")
        + " · прибыль и убыток суммируются в существующем журнале AI."
    }));
    if (!gold?.stats) systems.push(unavailable("Gold AI", "Отдельный журнал золота не загружен"));
    else systems.push(card({
      title: "Gold AI", detail: "Основной виртуальный сканер золота",
      side: gold.state?.side || "WAIT",
      metrics: [["Всего сделок", number(gold.stats.total, 0)], ["Открыто", number(gold.stats.open, 0)],
        ["Winrate", percent(gold.stats.winrate)], ["PnL · USD / 1 oz", amount(gold.stats.pnl)]],
      footer: "Gold AI · обновлено " + dateText(gold.state?.updated_at)
    }));
    for (const [title, data, unit] of [
      ["ЧПТ · Bitcoin", btcGpt, "1 BTC"],
      ["ЧПТ · Gold", goldGpt, "1 oz"]
    ]) {
      if (!data?.stats) systems.push(unavailable(title, "Отдельный журнал ЧПТ недоступен"));
      else systems.push(card({
        title, detail: "RSI Reversal + Stochastic · 5m · виртуально",
        side: data.state?.side || "WAIT",
        metrics: [["Всего сделок", number(data.stats.total, 0)],
          ["Закрыто", number(data.stats.closed, 0)],
          ["Winrate", percent(data.stats.winrate)],
          ["PnL · USD / " + unit, amount(data.stats.pnl)]],
        footer: "Profit Factor " + number(data.stats.profit_factor)
          + " · " + dateText(data.state?.updated_at)
      }));
    }
    if (!test?.state) systems.push(unavailable("Тест · консенсус", "Тестовый Worker недоступен"));
    else {
      const trades = (test.trades || []).filter(t => t.strategy === "consensus");
      const closed = trades.filter(t => t.status === "CLOSED");
      const wins = closed.filter(t => validNumber(t.pnl) && Number(t.pnl) > 0).length;
      const losses = closed.filter(t => validNumber(t.pnl) && Number(t.pnl) < 0).length;
      const pnl = closed.reduce((sum, t) => sum + (validNumber(t.pnl) ? Number(t.pnl) : 0), 0);
      systems.push(card({
        title: "Тест · 3 стратегии", detail: "SMB + Brooks + Cameron · доступные записи",
        side: test.state.signals?.consensus || "WAIT",
        metrics: [["Записей получено", number(trades.length, 0)],
          ["Прибыльных", number(wins, 0)],
          ["Winrate · выборка", wins + losses ? percent(wins / (wins + losses) * 100) : "—"],
          ["PnL · выборка / 1 BTC", amount(pnl)]],
        footer: "Показатели вычислены по полученным записям тестового Worker; они могут не охватывать всю историю."
      }));
      const smc = test.state.analysis?.smc;
      if (smc) systems.push(card({
        title: "Тест · SMC", detail: "Smart Money Concepts · отдельный виртуальный модуль",
        side: smc.signal?.side || "WAIT",
        metrics: [["Сделок", number(smc.stats?.opened, 0)],
          ["Плюс", number(smc.stats?.wins, 0)],
          ["Минус", number(smc.stats?.losses, 0)],
          ["PnL · USD / 1 BTC", amount(smc.stats?.pnl)]],
        footer: "SMC продолжает работать самостоятельно."
      }));
    }
    $("ttSystems").innerHTML = systems.join("");
  }

  function heatmap(state) {
    const rows = state?.strategy_results;
    if (!Array.isArray(rows) || !rows.length) {
      $("ttHeatmap").innerHTML = '<p class="tt-mini">Нет данных о сигналах 41 стратегии.</p>';
      return;
    }
    $("ttHeatmap").innerHTML = rows.map(row => {
      const side = row.enabled === false ? "OFF" : safeSide(row.signal);
      const color = row.enabled === false ? "tt-heat-disabled"
        : side === "BUY" ? "tt-heat-buy" : side === "SELL" ? "tt-heat-sell" : "";
      return '<div class="tt-heat ' + color + '" title="' + escape(row.name)
        + ' · ' + escape(side) + '"><span class="tt-heat-name">' + escape(row.name)
        + '</span><span class="tt-heat-side ' + directionClass(side) + '">' + escape(side) + '</span></div>';
    }).join("");
  }

  function activities(gold, btcGpt, goldGpt, test, btcTrades) {
    const items = [];
    function add(name, rows, unit) {
      for (const trade of (Array.isArray(rows) ? rows : []).slice(0, 20)) {
        const rawTime = trade.trade_time ?? trade.opened_at ?? trade.closed_at;
        const parsedTime = Number(rawTime);
        const millis = Number.isFinite(parsedTime)
          ? (parsedTime < 1e11 ? parsedTime * 1000 : parsedTime)
          : Date.parse(rawTime || "");
        if (!Number.isFinite(millis)) continue;
        items.push({ name, trade, unit, time: millis });
      }
    }
    add("Bitcoin / AI", (btcTrades || []).filter(t => String(t.trade_key).startsWith("ai:")), "USD / BTC");
    add("Bitcoin / основной", (btcTrades || []).filter(t => String(t.trade_key).startsWith("server:")), "USD / BTC");
    add("Gold AI", gold?.trades, "USD / oz");
    add("ЧПТ Bitcoin", btcGpt?.trades, "USD / BTC");
    add("ЧПТ Gold", goldGpt?.trades, "USD / oz");
    add("Тест", (test?.trades || []).filter(t => t.strategy === "consensus"), "USD / BTC");
    const sorted = items.sort((a, b) => b.time - a.time).slice(0, 14);
    if (!sorted.length) {
      $("ttTrades").innerHTML = '<p class="tt-mini">Сделок пока нет либо источник журнала недоступен.</p>';
      return;
    }
    $("ttTrades").innerHTML = sorted.map(({ name, trade, unit, time }) => {
      const status = trade.status || "—";
      const pnl = trade.status === "CLOSED" ? amount(trade.pnl) : "открыта";
      const cls = status === "CLOSED" ? pnlClass(trade.pnl) : "tt-wait";
      return '<div class="tt-trade"><div><div class="tt-trade-name">' + escape(name)
        + ' · <span class="' + directionClass(trade.side) + '">' + escape(safeSide(trade.side))
        + '</span></div><div class="tt-trade-meta">' + escape(dateText(time))
        + ' · вход ' + escape(number(trade.entry)) + ' · ' + escape(status)
        + '</div></div><div class="tt-trade-right ' + cls + '">' + escape(pnl)
        + '<div class="tt-trade-meta">' + escape(unit) + '</div></div></div>';
    }).join("");
  }

  async function refreshCharts(force = false) {
    if (!active || chartBusy || (!force && Date.now() - chartFetchedAt < 300000)) return;
    chartBusy = true;
    // Only GET historical data; neither source receives a trading command.
    const results = await Promise.allSettled([
      readJson(MAIN + "/api/backtest-history?timeframe=5m"),
      readJson(GOLD + "/api/candles?timeframe=5m")
    ]);
    if (!active) { chartBusy = false; return; }
    if (results[0].status === "fulfilled") drawChart("ttBtc", results[0].value.candles, results[0].value);
    else {
      $("ttBtcChart").innerHTML = '<div class="tt-chart-empty">BTC 5m: нет данных</div>';
      $("ttBtcChartAt").textContent = "—";
    }
    if (results[1].status === "fulfilled") drawChart("ttGold", results[1].value.candles, results[1].value);
    else {
      $("ttGoldChart").innerHTML = '<div class="tt-chart-empty">Gold 5m: нет данных</div>';
      $("ttGoldChartAt").textContent = "—";
    }
    // Failed feeds are retried quickly instead of hiding a temporary outage for five minutes.
    chartFetchedAt = Date.now() - (results.some(item => item.status === "rejected") ? 270000 : 0);
    chartBusy = false;
  }

  async function refresh(forceCharts = false) {
    if (!active || busy || document.hidden) return;
    busy = true;
    $("ttRefresh").disabled = true;
    const reads = {
      bitcoin: readJson(MAIN + "/api/state"),
      gold: readJson(GOLD + "/api/status"),
      btcGpt: readJson(MAIN + "/api/gpt-strategy"),
      goldGpt: readJson(GOLD + "/api/gpt-strategy"),
      test: readJson(TEST + "/api/test-data"),
      recent: supabase.from("trades")
        .select("trade_key,trade_time,side,status,entry,pnl,exit")
        .order("trade_time", { ascending: false }).limit(30).then(({ data, error }) => {
          if (error) throw error;
          return data || [];
        })
    };
    try {
      const keys = Object.keys(reads);
      const settled = await Promise.allSettled(keys.map(key => reads[key]));
      if (!active) return;
      const entries = Object.fromEntries(keys.map((key, index) => [key, settled[index]]));
      const value = key => entries[key]?.status === "fulfilled" ? entries[key].value : null;
      const state = value("bitcoin"), gold = value("gold"), test = value("test");
      sourceStrip(entries);
      signalSummary(state, gold, test);
      systemCards(state, gold, value("btcGpt"), value("goldGpt"), test);
      heatmap(state);
      activities(gold, value("btcGpt"), value("goldGpt"), test, value("recent"));
      $("ttFooter").textContent = "Обновлено " + new Date().toLocaleString("ru-RU")
        + ". Данные приходят из действующих журналов, без управления ордерами и настройками. "
        + "Графики показывают закрытые 5m свечи. PnL нормирован на 1 BTC либо 1 унцию золота; "
        + "показатели разных систем нельзя складывать как прибыль одного счёта. "
        + "История, спред и комиссии могут учитываться по-разному между модулями.";
      refreshCharts(forceCharts);
    } catch (error) {
      $("ttFooter").textContent = "Не удалось обновить терминал: " + (error?.message || String(error));
    } finally {
      busy = false;
      $("ttRefresh").disabled = false;
    }
  }

  const activate = () => {
    if (active) return;
    active = true;
    refresh(true);
    timer = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  };
  const deactivate = () => {
    active = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  $("ttRefresh").addEventListener("click", () => refresh(true));
  document.addEventListener("visibilitychange", () => {
    if (active && !document.hidden) refresh();
  });
  return { activate, deactivate };
}
