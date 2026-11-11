// Self-contained read-only GPT strategy window for the Gold dashboard.
export const gptStrategyPage = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Стратегия ЧПТ · виртуальный тест</title>
<style>
:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b1018;color:#edf2f9}
*{box-sizing:border-box}body{max-width:850px;margin:auto;padding:18px 14px 70px}
a{color:#8bbaff;text-decoration:none}.card{padding:18px;border:1px solid #2b394b;border-radius:16px;background:#151e2b;margin:12px 0}
h1{font-size:23px}h2{font-size:17px}.muted{color:#9cabbf;font-size:13px;line-height:1.5}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.stats>div{border:1px solid #34435a;border-radius:10px;padding:10px}
.stats small{display:block;color:#9cabbf}.stats b{font-size:19px}
.buy,.positive{color:#65d8ac}.sell,.negative{color:#ff9090}
.trade{padding:12px;border:1px solid #2b394b;border-radius:12px;margin:9px 0;line-height:1.8}
button{border-radius:9px;background:#254d74;color:white;border:0;padding:10px 15px;font-weight:600}
</style></head><body>
<a href="/" id="back">← Вернуться к боту</a>
<h1>Стратегия ЧПТ <span class="muted">· 5 минут</span></h1>
<p class="muted">Отдельный виртуальный тест RSI Reversal + Stochastic на котировках Capital.com Demo. Оба сигнала должны совпасть. Реальные и DEMO-ордера не открываются. Основной бот и AI не затрагиваются.</p>
<section class="card"><h2 id="signal">Сигнал: ожидание</h2><p class="muted" id="detail">Проверяем серверный журнал…</p></section>
<section class="card"><h2>Результаты виртуальной торговли</h2>
<div class="stats">
<div><small>Всего</small><b id="total">—</b></div><div><small>Открыто</small><b id="open">—</b></div><div><small>Закрыто</small><b id="closed">—</b></div>
<div><small>Прибыльных</small><b class="positive" id="wins">—</b></div><div><small>Убыточных</small><b class="negative" id="losses">—</b></div><div><small>Winrate</small><b id="winrate">—</b></div>
<div><small>PnL</small><b id="pnl">—</b></div><div><small>Profit Factor</small><b id="pf">—</b></div>
</div><p class="muted">PnL указывается на 1 BTC или 1 унцию XAUUSD в каждой сделке; это не доходность счёта. Спред учитывается по Bid/Ask. Ночное финансирование и проскальзывание не моделируются.</p>
</section>
<section class="card"><h2>Собственный журнал ЧПТ</h2><button id="refresh">Обновить</button><div id="journal"></div><p class="muted" id="status">Данные обновляются автоматически каждую минуту.</p></section>
<script>
const $=id=>document.getElementById(id);
const fmt=n=>n==null||!Number.isFinite(Number(n))?"—":Number(n).toLocaleString("ru-RU",{maximumFractionDigits:2,minimumFractionDigits:2});
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
if(!document.referrer)$("back").textContent="← Главная";
async function refresh(){
 try{
  const res=await fetch("/api/gpt-strategy",{cache:"no-store"}),data=await res.json();
  if(!res.ok)throw Error(data.error||"HTTP "+res.status);
  const state=data.state||{},s=data.stats||{};
  $("signal").textContent="Сигнал ЧПТ: "+(state.side||"WAIT");
  $("signal").className=(state.side||"").toLowerCase();
  $("detail").textContent=data.symbol+" · 5m · RSI: "+fmt(state.rsi)+" · Stochastic K/D: "+fmt(state.stoch_k)+" / "+fmt(state.stoch_d)+" · Цена: "+fmt(state.price)+" · "+(state.updated_at?new Date(state.updated_at).toLocaleString("ru-RU"):"ожидание первого запуска");
  for(const key of ["total","open","closed","wins","losses"])$(key).textContent=s[key]??0;
  $("winrate").textContent=s.winrate==null?"—":fmt(s.winrate)+"%";
  $("pnl").textContent=fmt(s.pnl)+" "+(data.symbol==="XAUUSD"?"USD / унция":"USD / BTC");
  $("pnl").className=(Number(s.pnl)>=0?"positive":"negative");
  $("pf").textContent=fmt(s.profit_factor);
  $("journal").innerHTML=(data.trades||[]).map(t=>'<div class="trade"><b class="'+(t.side==="BUY"?"buy":"sell")+'">'+safe(t.side)+'</b> · '+safe(t.status)+' · '+safe(new Date(t.opened_at).toLocaleString("ru-RU"))+'<div>Вход: '+fmt(t.entry)+' · Стоп: '+fmt(t.sl)+' · Активация трейлинга: '+fmt(t.tp)+'</div><div>Выход: '+fmt(t.exit_price)+' · PnL: <b class="'+(Number(t.pnl)>=0?"positive":"negative")+'">'+fmt(t.pnl)+'</b></div></div>').join("")||'<p class="muted">Пока сделок нет. ЧПТ ждёт совпадения сигналов на закрытой 5-минутной свече.</p>';
  $("status").textContent="Capital.com Demo · виртуальный журнал · обновлено "+new Date().toLocaleTimeString("ru-RU");
 }catch(e){
  $("status").textContent="Журнал ЧПТ недоступен: "+e.message+". Проверь, что SQL-миграция для стратегии выполнена.";
 }
}
$("refresh").onclick=refresh;refresh();setInterval(refresh,60000);
</script></body></html>`;
