import { buildContext } from "./indicators.js";
import { strategies, names } from "../strategies/index.js";
import { spreadSafeStopDistance, virtualTargetTrailUpdate, virtualStopFill } from "../worker/partial-profit.js";

const round = n => Math.round(n * 100) / 100;
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

function simulate(candles, steps, sideFor, rr, id, label) {
  const open = [], closedTrades = [];
  let total = 0, realized = 0, wins = 0, losses = 0, grossWins = 0, grossLosses = 0;
  let peak = 0, maxDrawdown = 0;
  for (let i = 240; i < candles.length; i++) {
    const bar = candles[i], step = steps[i];
    if (!step) continue;
    const side = sideFor(step.votes);
    if ((side === "BUY" || side === "SELL") && step.atr > 0) {
      const entry = side === "BUY" ? bar.askOpen : bar.bidOpen;
      const spread = Math.max(0, bar.askOpen - bar.bidOpen);
      const distance = spreadSafeStopDistance(step.atr * 1.2, spread);
      const tp = side === "BUY" ? entry + distance * rr : entry - distance * rr;
      open.push({ side, entry, sl: side === "BUY" ? entry - distance : entry + distance,
        tp, initial_tp: tp, opened: bar.time, trailing_active: false });
      total++;
    }
    for (let j = open.length - 1; j >= 0; j--) {
      const trade = open[j], buy = trade.side === "BUY";
      const stopped = buy ? bar.bidLow <= trade.sl : bar.askHigh >= trade.sl;
      if (stopped) {
        // At a gap, the opening executable quote can be worse than the stop.
        const exit = virtualStopFill(trade.side, trade.sl, buy ? bar.bidOpen : bar.askOpen);
        const pnl = direction(trade) * (exit - trade.entry);
        realized += pnl;
        if (pnl > 0) { wins++; grossWins += pnl; }
        else if (pnl < 0) { losses++; grossLosses -= pnl; }
        closedTrades.push({ ...trade, exit, pnl, closed: bar.time });
        open.splice(j, 1);
      } else {
        const update = virtualTargetTrailUpdate(trade, buy ? bar.bidClose : bar.askClose);
        if (update) Object.assign(trade, update);
      }
    }
    const equity = realized + open.reduce((sum, trade) => sum + direction(trade)
      * ((trade.side === "BUY" ? bar.bidClose : bar.askClose) - trade.entry), 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const last = candles.at(-1);
  const floating = open.reduce((sum, trade) => sum + direction(trade)
    * ((trade.side === "BUY" ? last.bidClose : last.askClose) - trade.entry), 0);
  return { id, label, total, closed: closedTrades.length, open: open.length,
    wins, losses, winrate: closedTrades.length ? round(wins * 100 / closedTrades.length) : null,
    closedPnl: round(realized), floating: round(floating), pnl: round(realized + floating),
    profitFactor: grossLosses ? round(grossWins / grossLosses) : null,
    maxDrawdown: round(maxDrawdown), recent: closedTrades.slice(-8).reverse().map(t => ({
      side: t.side, opened: t.opened, entry: round(t.entry), exit: round(t.exit),
      pnl: round(t.pnl)
    })) };
}

export function backtestBitcoin(candles, { enabled, minMatches, riskReward }) {
  if (!Array.isArray(candles) || candles.length < 250 || !candles.every(quoteValid))
    throw new Error("Для BTC бэктеста нужно минимум 250 корректных свечей Bid/Ask");
  if (!Array.isArray(enabled) || enabled.length !== names.length ||
      !Number.isInteger(minMatches) || minMatches < 1 || minMatches > names.length ||
      ![1, 1.5, 2, 2.5, 3, 4].includes(riskReward)) throw new Error("Неверные настройки BTC бэктеста");
  // Use only completed candles before each entry; never inspect future bars.
  const steps = [];
  for (let i = 240; i < candles.length; i++) {
    const context = buildContext(candles.slice(i - 240, i));
    steps[i] = { atr: context.atr, votes: strategies.map(strategy => {
      try { return strategy(context); } catch { return "WAIT"; }
    }) };
  }
  const main = simulate(candles, steps, votes => vote(votes, enabled, minMatches), riskReward, "main", "Основной · совпадения");
  const ai = simulate(candles, steps, votes => aiVote(votes, enabled), riskReward, "ai", "AI · выбранные стратегии, равные веса (приближённо)");
  const perStrategy = names.map((name, i) => ({ name, enabled: enabled[i],
    ...simulate(candles, steps, votes => votes[i], riskReward, "strategy_" + i, name) }));
  return { candles: candles.length, from: candles[240].time, to: candles.at(-1).time,
    main, ai, perStrategy };
}

const text = n => n == null ? "—" : Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const metric = (name, value) => `<div><small>${name}</small><b>${value}</b></div>`;
const summary = result => `<article class="backtest-card"><h3>${result.label}</h3><div class="backtest-metrics">`
  + metric("Закрытый PnL · $ / BTC", `<span class="${result.closedPnl >= 0 ? "green" : "red"}">${result.closedPnl > 0 ? "+" : ""}${text(result.closedPnl)}</span>`)
  + metric("Winrate", result.winrate == null ? "—" : text(result.winrate) + "%")
  + metric("Закрыто / открыто", result.closed + " / " + result.open)
  + metric("Прибыльных / убыточных", result.wins + " / " + result.losses)
  + metric("Profit Factor", text(result.profitFactor))
  + metric("Просадка · $ / BTC", text(result.maxDrawdown))
  + `</div><p class="notice">Плавающий PnL: ${text(result.floating)} · всего с открытыми: ${text(result.pnl)}</p></article>`;

export function initBitcoinBacktest(getSettings, workerUrl, onMainApplied = () => {}) {
  const $ = id => document.getElementById(id);
  const enabled = (getSettings()?.enabled_strategies || names.map(() => true)).slice();
  const apply = $("backtestApply");
  let validRun = false;
  const invalidate = () => {
    validRun = false;
    apply.disabled = true;
    $("backtestApplyStatus").textContent = "Настройки изменены. Сначала запусти бэктест с новым выбором.";
  };
  const canApply = () => {
    apply.disabled = !validRun || !["Main", "Ai", "Test"].some(t => $("backtestApply" + t).checked);
  };
  for (const target of ["Main", "Ai", "Test"]) $("backtestApply" + target).addEventListener("change", canApply);
  for (const control of ["backtestTimeframe", "backtestRiskReward"]) $(control).addEventListener("change", invalidate);
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
      const result = backtestBitcoin(history.candles, { enabled, minMatches: Number(minimumControl.value),
        riskReward: Number($("backtestRiskReward").value) });
      $("backtestResults").innerHTML = summary(result.main) + summary(result.ai);
      showStrategies(result.perStrategy);
      const zeroReason = result.main.total === 0 ? ` Основной: 0 сделок — порог ${minimumControl.value} не был достигнут при ${enabled.filter(Boolean).length} выбранных стратегиях.` : "";
      status.textContent = `${history.stale ? "⚠️ " + history.warning + " " : ""}Готово: ${result.candles} свечей ${timeframe}. ${new Date(result.from * 1000).toLocaleString("ru-RU")} — ${new Date(result.to * 1000).toLocaleString("ru-RU")}. Журналы не менялись.${zeroReason}`;
      validRun = true;
      canApply();
      $("backtestApplyStatus").textContent = "Бэктест готов. Отметь, куда применить настройки; остальные модули останутся без изменений.";
    } catch (e) { status.textContent = "Бэктест не выполнен: " + e.message; }
    finally { run.disabled = false; }
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
      if (!response.ok) throw new Error(result.error || "HTTP " + response.status);
      if (targets.main) await onMainApplied(preset);
      $("backtestApplyStatus").textContent = `Готово: применено к ${selected}. На следующем сканировании настройки вступят в силу. Старые три стратегии Теста сохранены.`;
      // A new run is required before further application so stale results cannot be reused.
      validRun = false;
    } catch (error) { $("backtestApplyStatus").textContent = "Не удалось применить: " + error.message; }
    finally { canApply(); }
  });
}
