import { buildContext } from "./indicators.js";
import { candleMomentum, momentumConfirms } from "./momentum-filter.js";
import { backtestBreakevenTrailUpdate, backtestHybridTrailUpdate } from "./backtest-risk.js";
import { strategies, names } from "../strategies/index.js";
import { spreadSafeStopDistance, virtualTargetTrailUpdate, virtualStopFill } from "../worker/partial-profit.js";

const round = n => Math.round(n * 10000) / 10000;
const direction = trade => trade.side === "BUY" ? 1 : -1;
const quoteValid = c => [c.open, c.high, c.low, c.close, c.bidOpen, c.askOpen,
  c.bidLow, c.askHigh, c.bidClose, c.askClose].every(Number.isFinite)
  && c.bidOpen > 0 && c.askOpen >= c.bidOpen;

function vote(votes, enabled, minimum) {
  const buys = votes.filter((side, i) => enabled[i] && side === "BUY").length;
  const sells = votes.filter((side, i) => enabled[i] && side === "SELL").length;
  return buys >= minimum && buys > sells ? "BUY"
    : sells >= minimum && sells > buys ? "SELL" : "WAIT";
}

// Historical AI comparison uses equal weights; today's learned weights would leak future outcomes.
function aiVote(votes, enabled) {
  const buys = votes.filter((side, i) => enabled[i] && side === "BUY").length;
  const sells = votes.filter((side, i) => enabled[i] && side === "SELL").length;
  const total = buys + sells;
  return total >= 3 && buys > sells && buys / total >= 0.7 ? "BUY"
    : total >= 3 && sells > buys && sells / total >= 0.7 ? "SELL" : "WAIT";
}

function simulate(candles, steps, sideFor, rr, id, label, positionSize, tradeCostUsd, exitPlan = {}) {
  const open = [], closedTrades = [];
  const atrMultiplier = exitPlan.atrMultiplier ?? 1.2;
  const breakevenAtR = exitPlan.breakevenAtR ?? null;
  let total = 0, realized = 0, wins = 0, losses = 0, grossWins = 0, grossLosses = 0;
  let peak = 0, maxDrawdown = 0;
  for (let i = 240; i < candles.length; i++) {
    const bar = candles[i], step = steps[i];
    if (!step) continue;
    const side = sideFor(step.votes, step.momentum);
    if ((side === "BUY" || side === "SELL") && step.atr > 0) {
      const entry = side === "BUY" ? bar.askOpen : bar.bidOpen;
      const spread = Math.max(0, bar.askOpen - bar.bidOpen);
      const distance = spreadSafeStopDistance(step.atr * atrMultiplier, spread);
      const tp = side === "BUY" ? entry + distance * rr : entry - distance * rr;
      open.push({ side, entry, sl: side === "BUY" ? entry - distance : entry + distance,
        tp, initial_tp: tp, opened: bar.time, trailing_active: false,
        ...(breakevenAtR === null ? {} : { initial_risk: distance, breakeven_active: false }),
        ...(breakevenAtR === "hybrid" ? { trailing_distance: distance, hybrid_tp_active: false } : {}) });
      total++;
    }
    for (let j = open.length - 1; j >= 0; j--) {
      const trade = open[j], buy = trade.side === "BUY";
      const stopped = buy ? bar.bidLow <= trade.sl : bar.askHigh >= trade.sl;
      if (stopped) {
        // At a gap, the opening executable quote can be worse than the stop.
        const exit = virtualStopFill(trade.side, trade.sl, buy ? bar.bidOpen : bar.askOpen);
        const pnl = direction(trade) * (exit - trade.entry) * positionSize - tradeCostUsd;
        realized += pnl;
        if (pnl > 0) { wins++; grossWins += pnl; }
        else if (pnl < 0) { losses++; grossLosses -= pnl; }
        closedTrades.push({ ...trade, exit, pnl, closed: bar.time });
        open.splice(j, 1);
      } else {
        // A stop change made at the completed bar close can only affect the next bar.
        const executableClose = buy ? bar.bidClose : bar.askClose;
        const update = breakevenAtR === "hybrid"
          ? backtestHybridTrailUpdate(trade, executableClose)
          : breakevenAtR === null
            ? virtualTargetTrailUpdate(trade, executableClose)
            : backtestBreakevenTrailUpdate(trade, executableClose, breakevenAtR);
        if (update) Object.assign(trade, update);
      }
    }
    const equity = realized + open.reduce((sum, trade) => sum + direction(trade)
      * ((trade.side === "BUY" ? bar.bidClose : bar.askClose) - trade.entry) * positionSize, 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const last = candles.at(-1);
  const floating = open.reduce((sum, trade) => sum + direction(trade)
    * ((trade.side === "BUY" ? last.bidClose : last.askClose) - trade.entry) * positionSize, 0);
  return { id, label, total, closed: closedTrades.length, open: open.length,
    wins, losses, winrate: closedTrades.length ? round(wins * 100 / closedTrades.length) : null,
    closedPnl: round(realized), floating: round(floating), pnl: round(realized + floating),
    profitFactor: grossLosses ? round(grossWins / grossLosses) : null,
    maxDrawdown: round(maxDrawdown), recent: closedTrades.slice(-8).reverse().map(t => ({
      side: t.side, opened: t.opened, entry: round(t.entry), exit: round(t.exit),
      pnl: round(t.pnl)
    })) };
}

export function backtestBitcoin(candles, { enabled, minMatches, riskReward, positionSize = 1,
  tradeCostUsd = 0, optimization = { atrMultiplier: 1.2, breakevenAtR: null }, momentumEnabled = false }) {
  if (!Array.isArray(candles) || candles.length < 250 || !candles.every(quoteValid))
    throw new Error("Для BTC бэктеста нужно минимум 250 корректных свечей Bid/Ask");
  if (!Array.isArray(enabled) || enabled.length !== names.length ||
      !Number.isInteger(minMatches) || minMatches < 1 || minMatches > names.length ||
      ![1, 1.5, 2, 2.5, 3, 4].includes(riskReward)) throw new Error("Неверные настройки BTC бэктеста");
  if (!Number.isFinite(positionSize) || positionSize <= 0)
    throw new Error("Укажи положительный размер позиции BTC");
  if (!Number.isFinite(tradeCostUsd) || tradeCostUsd < 0)
    throw new Error("Укажи неотрицательные расходы на сделку в USD");
  if (!optimization || ![1, 1.2, 1.5].includes(optimization.atrMultiplier)
    || ![null, 1, 1.5, 2, "hybrid"].includes(optimization.breakevenAtR)
    || typeof momentumEnabled !== "boolean")
    throw new Error("Неверный выбор ATR или режима сопровождения стопа");
  // Use only completed candles before each entry; never inspect future bars.
  const steps = [];
  for (let i = 240; i < candles.length; i++) {
    const priorCandles = candles.slice(i - 240, i);
    const context = buildContext(priorCandles);
    steps[i] = { atr: context.atr, momentum: candleMomentum(priorCandles, context.atr),
      votes: strategies.map(strategy => {
      try { return strategy(context); } catch { return "WAIT"; }
    }) };
  }
  const main = simulate(candles, steps, votes => vote(votes, enabled, minMatches), riskReward, "main", "Основной · без фильтра", positionSize, tradeCostUsd);
  const momentum = simulate(candles, steps,
    (votes, motion) => {
      const side = vote(votes, enabled, minMatches);
      return momentumConfirms(side, motion) ? side : "WAIT";
    }, riskReward, "momentum", "Основной · с фильтром скорости", positionSize, tradeCostUsd);
  const selectedSide = (votes, motion) => {
    const side = vote(votes, enabled, minMatches);
    return momentumEnabled && !momentumConfirms(side, motion) ? "WAIT" : side;
  };
  const optimized = simulate(candles, steps, selectedSide, riskReward, "optimized",
    "Эксперимент · ATR " + optimization.atrMultiplier + " · "
      + (optimization.breakevenAtR === "hybrid" ? "Гибридный SL · BE 1,5R → TP → trailing"
        : optimization.breakevenAtR == null ? "текущее сопровождение TP"
        : "безубыток при " + optimization.breakevenAtR + "R"),
    positionSize, tradeCostUsd, optimization);
  // Same ATR, same entry signals, same costs: isolates whether hybrid exits help.
  const sameAtrLegacy = optimization.breakevenAtR === "hybrid"
    ? simulate(candles, steps, selectedSide, riskReward, "same-atr-legacy",
        "Сравнение · ATR " + optimization.atrMultiplier + " · старое сопровождение TP",
        positionSize, tradeCostUsd, { atrMultiplier: optimization.atrMultiplier })
    : null;
  const ai = simulate(candles, steps, votes => aiVote(votes, enabled), riskReward, "ai", "AI · выбранные стратегии, равные веса (приближённо)", positionSize, tradeCostUsd);
  const perStrategy = names.map((name, i) => ({ name, enabled: enabled[i],
    ...simulate(candles, steps, votes => votes[i], riskReward, "strategy_" + i, name, positionSize, tradeCostUsd) }));
  return { candles: candles.length, from: candles[240].time, to: candles.at(-1).time,
    positionSize, tradeCostUsd, main, momentum, optimized, sameAtrLegacy, ai, perStrategy };
}

const text = n => n == null ? "—" : Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const metric = (name, value) => `<div><small>${name}</small><b>${value}</b></div>`;
const summary = (result, positionSize, card) => `<article class="backtest-card"><h3>${result.label}</h3><div class="backtest-metrics">`
  + metric("Закрытый PnL · USD (" + positionSize + " BTC/сделка)", `<span class="${result.closedPnl >= 0 ? "green" : "red"}">${result.closedPnl > 0 ? "+" : ""}${text(result.closedPnl)}</span>`)
  + metric("Winrate", result.winrate == null ? "—" : text(result.winrate) + "%")
  + metric("Закрыто / открыто", result.closed + " / " + result.open)
  + metric("Прибыльных / убыточных", result.wins + " / " + result.losses)
  + metric("Profit Factor", text(result.profitFactor))
  + metric("Просадка · USD", text(result.maxDrawdown))
  + `</div><p class="notice">Плавающий PnL: ${text(result.floating)} · всего с открытыми: ${text(result.pnl)}</p>`
  + (card ? `<button type="button" class="backtest-apply-all" data-backtest-card="${card}">Применить ко всей торговле</button><p class="notice" data-backtest-card-status="${card}"></p>` : "")
  + `</article>`;

export function initBitcoinBacktest(getSettings, workerUrl, onMainApplied = () => {}) {
  const $ = id => document.getElementById(id);
  const enabled = (getSettings()?.enabled_strategies || names.map(() => true)).slice();
  const apply = $("backtestApply");
  const resultsContainer = $("backtestResults");
  const allStatus = $("backtestApplyAllStatus");
  let cardPresets = new Map();
  let applyingAll = false;
  const momentumInput = $("backtestMomentumEnabled");
  const atrInput = $("backtestAtrMultiplier");
  const exitInput = $("backtestBreakevenAtR");
  try {
    const savedAtr = Number(localStorage.getItem("btc-backtest-atr-multiplier"));
    if ([1, 1.2, 1.5].includes(savedAtr)) atrInput.value = String(savedAtr);
    const savedExit = localStorage.getItem("btc-backtest-breakeven-r");
    if (["legacy", "1", "1.5", "2", "hybrid"].includes(savedExit)) exitInput.value = savedExit;
  } catch {}
  let savedMomentum = false;
  try { savedMomentum = localStorage.getItem("btc-backtest-momentum-enabled") === "true"; } catch {}
  momentumInput.checked = savedMomentum;
  const updateMomentumNote = () => {
    $("backtestMomentumNote").textContent = momentumInput.checked
      ? "ВКЛ · в выбранном варианте основного бэктеста сигнал подтверждается скоростью и ускорением завершённых свечей. Реальная и DEMO-торговля не меняются."
      : "ВЫКЛ · выбранный вариант основного бэктеста работает без фильтра, только по голосованию стратегий. Реальная и DEMO-торговля не меняются.";
  };
  updateMomentumNote();
  let validRun = false;
  const invalidate = () => {
    validRun = false;
    cardPresets = new Map();
    apply.disabled = true;
    resultsContainer.querySelectorAll("[data-backtest-card]").forEach(button => { button.disabled = true; });
    allStatus.textContent = "Настройки изменены. Запусти новый бэктест перед общим применением.";
    $("backtestApplyStatus").textContent = "Настройки изменены. Сначала запусти бэктест с новым выбором.";
  };
  const canApply = () => {
    apply.disabled = !validRun || !["Main", "Ai", "Test"].some(t => $("backtestApply" + t).checked);
  };
  for (const target of ["Main", "Ai", "Test"]) $("backtestApply" + target).addEventListener("change", canApply);
  for (const control of ["backtestTimeframe", "backtestRiskReward"]) $(control).addEventListener("change", invalidate);
  for (const control of [atrInput, exitInput]) control.addEventListener("change", () => {
    try {
      localStorage.setItem("btc-backtest-atr-multiplier", atrInput.value);
      localStorage.setItem("btc-backtest-breakeven-r", exitInput.value);
    } catch {}
    invalidate();
    $("backtestStatus").textContent = "Настройки ATR / сопровождения изменены. Запусти бэктест заново.";
  });
  momentumInput.addEventListener("change", () => {
    try { localStorage.setItem("btc-backtest-momentum-enabled", String(momentumInput.checked)); } catch {}
    updateMomentumNote();
    invalidate();
    $("backtestStatus").textContent = momentumInput.checked
      ? "Фильтр скорости/ускорения ВКЛ для проверки. Нажми «Запустить бэктест»."
      : "Фильтр скорости/ускорения ВЫКЛ для проверки. Нажми «Запустить бэктест».";
  });
  const positionInput = $("backtestPositionSize");
  const costInput = $("backtestTradeCostUsd");
  let brokerRules = null;
  const validBrokerSize = size => size >= brokerRules.minDealSize - 1e-10 &&
    size <= brokerRules.maxDealSize + 1e-10 &&
    Math.abs((size - brokerRules.minDealSize) / brokerRules.sizeIncrement
      - Math.round((size - brokerRules.minDealSize) / brokerRules.sizeIncrement)) < 1e-6;
  async function loadBrokerRules() {
    try {
      const response = await fetch(workerUrl + "/api/capital-demo/rules", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const rules = await response.json();
      if (!(rules.minDealSize > 0 && rules.sizeIncrement > 0 && rules.maxDealSize >= rules.minDealSize))
        throw new Error("Нет лимитов объёма");
      brokerRules = rules;
      $("backtestSizeNote").textContent = "Capital.com Demo · объём BTC от " + rules.minDealSize
        + " до " + rules.maxDealSize + ", шаг " + rules.sizeIncrement + ".";
    } catch {
      $("backtestSizeNote").textContent = "Лимиты Capital.com сейчас недоступны: расчёт ориентировочный, размер DEMO-позиции необходимо проверить отдельно.";
    }
  }
  loadBrokerRules();
  let savedPositionSize = null;
  try { savedPositionSize = localStorage.getItem("btc-backtest-position-size"); } catch {}
  positionInput.value = savedPositionSize || String(getSettings()?.trade_size || 0.01);
  positionInput.addEventListener("input", invalidate);
  try { const savedCost = localStorage.getItem("btc-backtest-trade-cost"); if (savedCost !== null) costInput.value = savedCost; } catch {}
  costInput.addEventListener("input", invalidate);
  $("backtestTimeframe").value = ["1m", "5m", "15m"].includes(getSettings()?.timeframe) ? getSettings().timeframe : "1m";
  $("backtestRiskReward").value = String(getSettings()?.risk_reward || 2);
  const minimumControl = $("backtestMinMatches");
  let savedMinimum = 0;
  try { savedMinimum = Number(localStorage.getItem("btc-backtest-min-matches")); } catch {}
  const initialMinimum = savedMinimum || Number(getSettings()?.required_matches) || 3;
  minimumControl.innerHTML = names.map((_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
  minimumControl.value = String(Math.max(1, Math.min(names.length, Math.trunc(initialMinimum))));
  const updateMatchHint = () => {
    const count = enabled.filter(Boolean).length;
    const minimum = Number(minimumControl.value);
    $("backtestMatchHint").textContent = `Выбрано ${count} из ${names.length} стратегий · порог BUY/SELL: ${minimum} одинаковых сигналов. `
      + (minimum > count ? "При таком выборе основной не сможет открыть сделку." : "Настройки живого бота не меняются.");
  };
  minimumControl.addEventListener("change", () => {
    invalidate();
    try { localStorage.setItem("btc-backtest-min-matches", minimumControl.value); } catch {}
    updateMatchHint();
    $("backtestStatus").textContent = "Число совпадений изменено. Нажми «Запустить бэктест», чтобы пересчитать результат.";
  });
  const strategyList = $("backtestStrategies");
  const showStrategies = outcomes => {
    const order = names.map((_, i) => i);
    if (outcomes) order.sort((a, b) => outcomes[b].closedPnl - outcomes[a].closedPnl);
    strategyList.innerHTML = order.map(i => {
      const name = names[i];
      const result = outcomes?.[i];
      return `<label class="backtest-strategy"><input type="checkbox" data-backtest-strategy="${i}" ${enabled[i] ? "checked" : ""}>`
        + `<span>${name}</span><small class="${result?.closedPnl > 0 ? "green" : result?.closedPnl < 0 ? "red" : "muted"}">`
        + (result ? `${result.closedPnl > 0 ? "+" : ""}${text(result.closedPnl)} $ · ${text(result.winrate)}% · ${result.closed} сделок` : "Ожидает бэктеста")
        + `</small></label>`;
    }).join("");
  };
  showStrategies();
  updateMatchHint();
  strategyList.addEventListener("change", e => {
    const i = Number(e.target.dataset.backtestStrategy);
    if (Number.isInteger(i) && i >= 0 && i < enabled.length) {
      enabled[i] = e.target.checked;
      invalidate();
      updateMatchHint();
      $("backtestStatus").textContent = "Выбор стратегий изменён. Нажми «Запустить бэктест», чтобы пересчитать общий сигнал.";
    }
  });
  $("runBitcoinBacktest").addEventListener("click", async () => {
    const run = $("runBitcoinBacktest"), status = $("backtestStatus");
    invalidate();
    run.disabled = true;
    status.textContent = "Загружаем историю BTCUSD с Capital.com…";
    try {
      const timeframe = $("backtestTimeframe").value;
      const positionRaw = positionInput.value.trim().replace(",", ".");
      const costRaw = costInput.value.trim().replace(",", ".");
      const positionSize = positionRaw ? Number(positionRaw) : NaN;
      const tradeCostUsd = costRaw ? Number(costRaw) : NaN;
      if (!Number.isFinite(positionSize) || positionSize <= 0)
        throw new Error("Укажи положительный объём BTC, например 0.005, 0.01 или 0.1");
      if (!Number.isFinite(tradeCostUsd) || tradeCostUsd < 0)
        throw new Error("Укажи неотрицательные дополнительные расходы на сделку в USD");
      if (brokerRules && !validBrokerSize(positionSize))
        throw new Error("Capital.com не принимает такой размер BTC: от " + brokerRules.minDealSize
          + " до " + brokerRules.maxDealSize + ", шаг " + brokerRules.sizeIncrement);
      try { localStorage.setItem("btc-backtest-position-size", String(positionSize));
        localStorage.setItem("btc-backtest-trade-cost", String(tradeCostUsd)); } catch {}
      const browserKey = "btc-backtest-history:" + timeframe;
      let history;
      try {
        const response = await fetch(workerUrl + "/api/backtest-history?timeframe=" + encodeURIComponent(timeframe), { cache: "no-store" });
        history = await response.json();
        if (!response.ok) throw new Error(history.error || "Нет исторических свечей");
        try { localStorage.setItem(browserKey, JSON.stringify(history)); } catch {}
      } catch (error) {
        try { history = JSON.parse(localStorage.getItem(browserKey)); } catch { history = null; }
        if (!history?.candles?.length) throw error;
        history = { ...history, stale: true, warning: "Capital.com сейчас недоступен; использована история, ранее сохранённая на этом устройстве." };
      }
      status.textContent = "Рассчитываем 41 стратегию на устройстве…";
      // Yield once so the progress label becomes visible before the CPU-intensive calculation.
      await new Promise(resolve => setTimeout(resolve, 0));
      const optimization = { atrMultiplier: Number(atrInput.value),
        breakevenAtR: exitInput.value === "legacy" ? null
          : exitInput.value === "hybrid" ? "hybrid" : Number(exitInput.value) };
      const result = backtestBitcoin(history.candles, { enabled, minMatches: Number(minimumControl.value),
        riskReward: Number($("backtestRiskReward").value), positionSize, tradeCostUsd,
        momentumEnabled: momentumInput.checked, optimization });
      const selectedMode = momentumInput.checked ? result.momentum : result.main;
      const alternativeMode = momentumInput.checked ? result.main : result.momentum;
      const basePreset = {
        enabled: enabled.slice(), timeframe, minMatches: Number(minimumControl.value),
        riskReward: Number($("backtestRiskReward").value), positionSize,
        atrMultiplier: 1.2, breakevenAtR: null, momentumEnabled: momentumInput.checked
      };
      cardPresets = new Map([
        ["control", { ...basePreset, card: "control" }],
        ["optimized", { ...basePreset, ...optimization, card: "optimized" }],
        ["other-momentum", { ...basePreset, momentumEnabled: !momentumInput.checked,
          card: "other-momentum" }],
        ["ai", { ...basePreset, momentumEnabled: false, card: "ai" }]
      ]);
      if (result.sameAtrLegacy) {
        cardPresets.set("same-atr", { ...basePreset,
          atrMultiplier: optimization.atrMultiplier, card: "same-atr" });
      }
      resultsContainer.innerHTML = summary({
        ...selectedMode, label: "Контрольный вариант · ATR 1,2 · текущее сопровождение · "
          + (momentumInput.checked ? "с ускорением" : "без ускорения")
      }, positionSize, "control") + summary(result.optimized, positionSize, "optimized")
        + (result.sameAtrLegacy ? summary(result.sameAtrLegacy, positionSize, "same-atr") : "")
        + summary({ ...alternativeMode, label: "Другой режим ускорения · " + alternativeMode.label },
          positionSize, "other-momentum")
        + summary(result.ai, positionSize, "ai");
      showStrategies(result.perStrategy);
      const zeroReason = result.main.total === 0 ? ` Основной: 0 сделок — порог ${minimumControl.value} не был достигнут при ${enabled.filter(Boolean).length} выбранных стратегиях.` : "";
      status.textContent = `${history.stale ? "⚠️ " + history.warning + " " : ""}Готово: ${result.candles} свечей ${timeframe}. ${new Date(result.from * 1000).toLocaleString("ru-RU")} — ${new Date(result.to * 1000).toLocaleString("ru-RU")}. Размер сделки: ${positionSize} BTC. Доп. расходы: ${tradeCostUsd} USD/закрытую сделку. Расчёт по Bid/Ask и спреду, без автоматического учёта финансирования и дополнительного проскальзывания. Журналы не менялись. Контрольный вариант: ATR 1,2 и прежнее сопровождение. Эксперимент: ATR ${optimization.atrMultiplier}, ${optimization.breakevenAtR === "hybrid"
        ? "гибридный SL (безубыток при +1,5R, стоп на TP и затем trailing)"
        : optimization.breakevenAtR == null ? "старое сопровождение от TP" : "безубыток при " + optimization.breakevenAtR + "R"}. Ускорение: ${momentumInput.checked ? "ВКЛ" : "ВЫКЛ"}.${zeroReason}`;
      validRun = true;
      canApply();
      allStatus.textContent = "Можно применить любой показанный вариант к новым сделкам основного бота, AI и Capital.com DEMO. Потребуется PIN. Режим DEMO не включается автоматически.";
      $("backtestApplyStatus").textContent = "Сравнение готово. Кнопка «Применить» передаёт только прежние настройки стратегий, совпадений и R/R. Экспериментальные ATR и безубыток не переносятся в живую торговлю.";
    } catch (e) { status.textContent = "Бэктест не выполнен: " + e.message; }
    finally { run.disabled = false; }
  });
  resultsContainer.addEventListener("click", async event => {
    const button = event.target.closest("button[data-backtest-card]");
    if (!button || !validRun || applyingAll) return;
    const cardStatus = button.parentElement.querySelector("[data-backtest-card-status]");
    const preset = cardPresets.get(button.dataset.backtestCard);
    if (!preset) return;
    const exitDescription = preset.breakevenAtR === null ? "старое сопровождение от TP"
      : preset.breakevenAtR === "hybrid" ? "гибрид: BE при 1,5R → TP → trailing"
      : "безубыток при " + preset.breakevenAtR + "R";
    const isAiCard = preset.card === "ai";
    const warning = "Применить настройки выбранного результата ко всей будущей торговле?\n\n"
      + "ATR " + preset.atrMultiplier + " · " + exitDescription + "\n"
      + preset.timeframe + " · минимум " + preset.minMatches + " · R/R 1:" + preset.riskReward + "\n"
      + preset.enabled.filter(Boolean).length + " выбранных стратегий · BTC " + preset.positionSize + "\n"
      + "Фильтр скорости/ускорения: " + (preset.momentumEnabled ? "ВКЛ" : "ВЫКЛ") + "\n\n"
      + "Для НОВЫХ сделок основного бота, AI и DEMO, если он уже включён. "
      + "Выбранный размер BTC также станет размером будущих DEMO-ордеров. "
      + "Нынешние позиции и журналы не меняются. Режим DEMO не включается. "
      + "AI сохраняет собственный алгоритм голосования, поэтому исторический AI — приблизительный."
      + (isAiCard ? "\n\nВажно: нельзя перенести исторические AI-сигналы на основной бот. Применяются только его общие настройки." : "");
    if (!confirm(warning)) return;
    const pin = prompt("Введите личный PIN для применения ко всей торговле:");
    if (!pin) return;
    applyingAll = true;
    resultsContainer.querySelectorAll("[data-backtest-card]").forEach(item => { item.disabled = true; });
    allStatus.textContent = "Передаём настройки основному боту, AI и режимам Capital.com DEMO…";
    cardStatus.textContent = "Сохраняем настройки выбранного варианта…";
    try {
      const response = await fetch(workerUrl + "/api/backtest-apply-all", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Execution-Control": pin },
        body: JSON.stringify({ preset })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "HTTP " + response.status);
      try { await onMainApplied(preset); } catch (uiError) {
        console.error("Saved globally, but UI refresh failed", uiError);
      }
      cardStatus.textContent = "Сохранено! Эти настройки будут действовать для новых сделок основного бота и AI, а также DEMO при его включённом режиме.";
      allStatus.textContent = "Сохранено: выбранный вариант применён к НОВЫМ сделкам основного бота и AI (виртуальные и DEMO при включённом режиме). "
        + "DEMO не включалось, открытые сделки остаются без изменений. "
        + "Исторические результаты не гарантируют такую же прибыль.";
    } catch (error) {
      cardStatus.textContent = "Ошибка применения: " + error.message;
      allStatus.textContent = "Не удалось применить ко всей торговле: " + error.message;
    } finally {
      applyingAll = false;
      if (validRun) resultsContainer.querySelectorAll("[data-backtest-card]").forEach(item => {
        item.disabled = false;
      });
    }
  });
  apply.addEventListener("click", async () => {
    if (!validRun) return;
    const targets = { main: $("backtestApplyMain").checked, ai: $("backtestApplyAi").checked,
      test: $("backtestApplyTest").checked };
    if (!Object.values(targets).some(Boolean)) return;
    if (!enabled.some(Boolean)) { $("backtestApplyStatus").textContent = "Выбери хотя бы одну стратегию."; return; }
    const selected = [targets.main && "основной", targets.ai && "AI", targets.test && "отдельный Тест"].filter(Boolean).join(", ");
    if (!confirm(`Применить настройки бэктеста к: ${selected}? Новые сигналы будут рассчитываться по новым настройкам. Старые открытые сделки и журналы останутся, режим DEMO не изменится.`)) return;
    const pin = prompt("Введи личный PIN управления для применения настроек (не сохраняется в браузере):");
    if (pin == null) return;
    apply.disabled = true;
    $("backtestApplyStatus").textContent = "Сохраняем выбранные настройки…";
    try {
      const preset = { enabled: enabled.slice(), timeframe: $("backtestTimeframe").value,
        riskReward: Number($("backtestRiskReward").value), minMatches: Number(minimumControl.value) };
      const response = await fetch(workerUrl + "/api/backtest-apply", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Execution-Control": pin },
        body: JSON.stringify({ targets, preset })
      });
      const result = await response.json();
      if (!response.ok) {
        const alreadyApplied = Array.isArray(result.applied) && result.applied.length
          ? "Часть настроек уже сохранена (" + result.applied.join(", ") + "). " : "";
        const migrationHint = String(result.error || "").includes("bot_settings_timeframe_check")
          ? "База Supabase пока не разрешает 15m. Выполни миграцию supabase/migrations/004_allow_15m_bot_settings.sql. " : "";
        throw new Error(alreadyApplied + migrationHint + (result.error || "HTTP " + response.status));
      }
      if (targets.main) await onMainApplied(preset);
      $("backtestApplyStatus").textContent = `Готово: применено к ${selected}. На следующем сканировании настройки вступят в силу. Старые три стратегии Теста сохранены.`;
      // A new run is required before further application so stale results cannot be reused.
      validRun = false;
    } catch (error) { $("backtestApplyStatus").textContent = "Не удалось применить: " + error.message; }
    finally { canApply(); }
  });
}
