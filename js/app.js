import{createMarketChart}from"./chart.js";
import{createJournal}from"./journal.js";
import{initBitcoinBacktest}from"./backtest.js";
import{names}from"../strategies/index.js";
import{supabase}from"./supabase.js";
const $=id=>document.getElementById(id);
const fmt=n=>n!==null&&n!==undefined&&n!==""&&Number.isFinite(Number(n))?Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
const WORKER="https://bitcoin-scalping-bot.fsb777f.workers.dev";
let tf="1m",chart=createMarketChart($("chart")),settings=null,serverState=null,polling=false,previousPrice=null;
let aiJournalLoading=false;
const journal=createJournal(supabase);
const defaults=()=>({timeframe:"1m",enabled_strategies:names.map(()=>true),consensus_enabled:true,required_matches:3,risk_reward:2,ai_enabled:false,execution_mode:"VIRTUAL",trade_size:null});
function status(ok){$("connection").innerHTML='<i class="dot '+(ok?"green":"red")+'"></i> '+(ok?"TradingView график":"График не загрузился")}
function syncControls(){
 if(!settings)return;
 $("consensusEnabled").checked=true;
 $("consensusEnabled").disabled=true;
 $("requiredMatches").value=String(settings.required_matches);
 $("requiredMatches").disabled=false;
 $("matchHint").textContent="Основной бот открывает сделку, когда выбранное тобой число включённых стратегий совпадает по направлению.";
 $("riskReward").value=String(settings.risk_reward);
 $("aiEnabled").checked=!!settings.ai_enabled;
 $("aiModeLabel").textContent=settings.ai_enabled?"ВКЛ · АНАЛИЗ":"ВЫКЛ";
 $("mainDemoEnabled").checked=settings.execution_mode==="MAIN_DEMO";
 $("aiDemoEnabled").checked=settings.execution_mode==="AI_DEMO";
 $("demoTradeSize").value=settings.trade_size==null?"":String(settings.trade_size);
 $("demoExecutionNote").textContent=settings.execution_mode==="MAIN_DEMO"?"Включён основной DEMO. AI продолжает виртуальную торговлю.":settings.execution_mode==="AI_DEMO"?"Включён AI DEMO. Основной бот продолжает виртуальную торговлю.":"DEMO-торговля выключена. Оба режима работают виртуально.";

 $("tfLabel").textContent={"1m":"1 минута","5m":"5 минут","15m":"15 минут"}[tf];
 document.querySelectorAll("[data-tf]").forEach(b=>b.classList.toggle("active",b.dataset.tf===tf));
}
function renderStrategies(){
 const results=serverState?.strategy_results||[];
 $("strategies").innerHTML=names.map((name,i)=>{
  const enabled=!!settings?.enabled_strategies?.[i];
  const signal=results[i]?.signal||"WAIT",info=results[i]||{};
  const aiUsed=serverState?.ai_enabled&&(serverState.ai_selected||[]).includes(name);
  const aiMark=serverState?.ai_enabled?'<small class="ai-strategy-flag '+(info.ai_excluded?"red":aiUsed?"green":"muted")+'">'+(aiUsed?"AI выбрал":signal==="BUY"||signal==="SELL"?"AI учитывает":"AI ждёт сигнал")+(info.ai_weight!=null?" · ×"+info.ai_weight:"")+'</small>':"";
  return '<div class="strategy '+(enabled?"":"strategy-disabled")+'"><span class="strategy-name">'+name+'</span>'+aiMark+'<b class="tag '+(enabled?(signal==="BUY"?"green":signal==="SELL"?"red":"yellow"):"muted")+'">'+(enabled?signal:"ВЫКЛ")+'</b><button type="button" class="strategy-toggle" data-strategy-toggle="'+i+'">'+(enabled?"Отключить":"Включить")+'</button></div>';
 }).join("");
}
function renderSignal(){
 if(!serverState)return;
 const r=serverState;
 const normalSide=r.side||"WAIT";
 $("signal").textContent=normalSide;
 $("signal").className="signalbig "+(normalSide==="BUY"?"green":normalSide==="SELL"?"red":"yellow");
 $("matches").textContent=(r.count||0)+" совпадений · активно "+(r.active_count||0)+" / "+names.length;
 $("entry").textContent=fmt(r.entry);$("sl").textContent=fmt(r.sl);$("tp").textContent=fmt(r.tp);
 const stamp=r.updated_at?new Date(r.updated_at).toLocaleTimeString("ru-RU"):"—";
 $("signalNote").textContent=r.last_error?"Ошибка сканера: "+r.last_error:"Обычный сканер · обновлено "+stamp+". Работает независимо от AI.";
 const aiActive=!!settings?.ai_enabled&&r.ai_enabled===true;
 const aiSide=aiActive?(r.ai_side||"WAIT"):"OFF";
 $("aiSide").textContent=aiSide;
 $("aiSide").className=aiSide==="BUY"?"green":aiSide==="SELL"?"red":aiSide==="WAIT"?"yellow":"";
 $("aiConfidence").textContent=aiActive&&r.ai_confidence!=null?r.ai_confidence+"%":"—";
 $("aiSelected").textContent=aiActive?String((r.ai_selected||[]).length):"0";
 $("aiEntry").textContent=fmt(aiActive?r.ai_entry:null);
 $("aiSl").textContent=fmt(aiActive?r.ai_sl:null);
 $("aiTp").textContent=fmt(aiActive?r.ai_tp:null);
 $("aiNote").textContent=!settings?.ai_enabled?"AI выключен. Обычный сканер продолжает работать самостоятельно.":!aiActive?"AI включён. Ожидаем следующий серверный цикл сканирования.":(r.ai_reason||"AI анализирует рынок.");
 const perf=aiActive?(r.ai_performance||[]):[],learned=perf.filter(p=>p.trades>=5).length,excluded=(r.ai_excluded||[]).length;
 $("aiLearning").textContent=aiActive?"AI анализирует собственные сделки: "+learned+" стратегий с выборкой от 5 сделок · исключено слабых: "+excluded+". Уверенность — доля голосов, не вероятность прибыли.":"Статистика AI появится после закрытия его сделок.";
 renderStrategies();
}
async function loadAiJournal(){
 if(aiJournalLoading)return;aiJournalLoading=true;
 try{
  const rows=[];
  for(let offset=0;;offset+=1000){
   const {data,error}=await supabase.from("trades")
    .select("*")
    .like("trade_key","ai:%").order("trade_time",{ascending:false})
    .range(offset,offset+999);
   if(error)throw error;
   rows.push(...(data||[]));
   if(!data||data.length<1000)break;
  }
  const closed=rows.filter(t=>t.status==="CLOSED");
  const wins=closed.filter(t=>Number(t.pnl)>0||t.result==="TP").length;
  const losses=closed.filter(t=>Number(t.pnl)<0||t.result==="SL").length;
  const decided=wins+losses;
  const open=rows.filter(t=>t.status==="OPEN").length;
  const partialOpen=rows.filter(t=>t.status==="OPEN"&&t.partial_exit_price!=null);
  const pnl=closed.reduce((sum,t)=>sum+(Number.isFinite(Number(t.pnl))?Number(t.pnl):0),0)
   +partialOpen.reduce((sum,t)=>sum+(Number(t.pnl)||0),0);
  $("aiTradeTotal").textContent=String(rows.length);
  $("aiTradeOpen").textContent=String(open);
  $("aiTradeWins").textContent=String(wins);
  $("aiTradeLosses").textContent=String(losses);
  $("aiWinRate").textContent=decided?(wins/decided*100).toFixed(1)+"%":"—";
  $("aiPnl").textContent=(pnl>=0?"+":"")+fmt(pnl);
  $("aiPnl").className=pnl>0?"green":pnl<0?"red":"";
  $("aiJournalList").innerHTML=rows.length?'<div class="ai-trade-list">'+rows.slice(0,100).map(t=>{
   const side=String(t.side||"WAIT"),isOpen=t.status==="OPEN",profit=Number(t.pnl)>0||t.result==="TP",loss=Number(t.pnl)<0||t.result==="SL";
   const result=isOpen?(t.partial_exit_price!=null?"50% ЗАКРЫТО":"ОТКРЫТА"):profit?"ПРИБЫЛЬ":loss?"УБЫТОК":"ЗАКРЫТА";
   const pnlText=t.pnl==null?"—":(Number(t.pnl)>=0?"+":"")+fmt(t.pnl);
   const time=Number(t.trade_time)?new Date(Number(t.trade_time)).toLocaleString("ru-RU"):"—";
   return '<div class="ai-trade-row"><div class="ai-trade-top"><b class="'+(side==="BUY"?"green":"red")+'">'+side+'</b><span class="'+(isOpen?"yellow":profit?"green":loss?"red":"muted")+'">'+result+'</span><time>'+time+'</time></div><div class="ai-trade-values"><span>Вход <b>'+fmt(t.entry)+'</b></span>'+(t.partial_exit_price!=null?'<span>50% <b>'+fmt(t.partial_exit_price)+'</b></span>':'')+'<span>Выход <b>'+fmt(t.exit)+'</b></span><span>PnL <b class="'+(Number(t.pnl)>0?"green":Number(t.pnl)<0?"red":"")+'">'+pnlText+'</b></span></div></div>';
  }).join("")+'</div>':'<p class="notice">У AI пока нет виртуальных сделок. Когда появится BUY или SELL, сделки отобразятся здесь.</p>';
  $("aiJournalNote").textContent="Облачный журнал AI · показаны последние "+Math.min(rows.length,100)+" из "+rows.length+" сделок. Старые частичные закрытия сохранены в истории; новые позиции сопровождаются целиком.";
 }catch(error){
  $("aiJournalNote").textContent="Не удалось загрузить журнал AI: "+error.message;
 }finally{aiJournalLoading=false}
}
async function loadSettings(){
 const {data,error}=await supabase.from("bot_settings").select("*").eq("id",1).maybeSingle();
 if(error)throw error;
 settings={...defaults(),...(data||{})};
 settings.consensus_enabled=true;
 if(!Array.isArray(settings.enabled_strategies)||settings.enabled_strategies.length!==names.length)settings.enabled_strategies=names.map(()=>true);
 settings.enabled_strategies=settings.enabled_strategies.map(Boolean);
 if(![1,1.5,2,2.5,3,4].includes(Number(settings.risk_reward)))settings.risk_reward=2;
 if(!Number.isInteger(Number(settings.required_matches))||settings.required_matches<1||settings.required_matches>names.length)settings.required_matches=3;
 tf=["1m","5m","15m"].includes(settings.timeframe)?settings.timeframe:"1m";
 syncControls();
 renderStrategies();
}
async function saveSettings(){
 const payload={id:1,timeframe:tf,enabled_strategies:settings.enabled_strategies,consensus_enabled:true,required_matches:settings.required_matches,risk_reward:settings.risk_reward,ai_enabled:!!settings.ai_enabled,execution_mode:settings.execution_mode||"VIRTUAL",trade_size:settings.trade_size??null,updated_at:new Date().toISOString()};
 const {error}=await supabase.from("bot_settings").upsert(payload,{onConflict:"id"});
 if(error)throw error;
 $("cloudStatus").textContent="Настройки сохранены в облаке · сканер обновит их в ближайшую минуту";
}
async function setExecutionMode(mode){
 const pin=prompt("Введите PIN управления DEMO (он хранится только в Worker Cloudflare):");
 if(!pin)throw new Error("Переключение DEMO отменено: PIN не введён.");
 const size=Number($("demoTradeSize").value);
 const response=await fetch(WORKER+"/api/execution-mode",{
  method:"POST",headers:{"Content-Type":"application/json","X-Execution-Control":pin},
  body:JSON.stringify({mode,trade_size:Number.isFinite(size)&&size>0?size:null})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.error||"Не удалось изменить режим DEMO");
 settings.execution_mode=result.execution_mode;
 settings.trade_size=result.trade_size;
 syncControls();
 $("cloudStatus").textContent="Режим торговли сохранён на сервере";
 return result;
}
async function checkDemoRules(){
 const response=await fetch(WORKER+"/api/capital-demo/rules",{cache:"no-store"});
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.error||"Не удалось проверить правила Capital.com");
 $("demoExecutionNote").textContent="Capital.com Demo · BTCUSD "+result.marketStatus+" · размер: от "+result.minDealSize+" до "+result.maxDealSize+" BTC · шаг "+result.sizeIncrement+". SL/TP будут повторно проверены перед каждым ордером.";
 return result;
}
async function pollState(){
 if(polling)return;polling=true;
 try{
  const r=await fetch(WORKER+"/api/state",{cache:"no-store"});
  if(!r.ok)throw Error("HTTP "+r.status);
  serverState=await r.json();
  if(serverState.error)throw Error(serverState.error);
  if(Number.isFinite(Number(serverState.price)) && Number(serverState.price)>0)updatePrice(Number(serverState.price));
  renderSignal();
  loadAiJournal();
 }catch(e){$("signalNote").textContent="Не удалось получить серверный сигнал: "+e.message}
 finally{polling=false}
}
function updatePrice(p){
 $("price").textContent=fmt(p);
 if(previousPrice){const d=(p-previousPrice)/previousPrice*100;$("priceChange").textContent=(d>=0?"+":"")+d.toFixed(2)+"%";$("priceChange").className="change "+(d>=0?"green":"red")}
 previousPrice=p;
}
async function startChart(){
 try{
  $("tfLabel").textContent={"1m":"1 минута","5m":"5 минут","15m":"15 минут"}[tf];
  chart?.setTimeframe(tf);
  status(true);
 }catch(e){status(false);$("signalNote").textContent="Ошибка отображения TradingView: "+e.message}
}
$("strategies").addEventListener("click",async e=>{
 const b=e.target.closest("[data-strategy-toggle]");if(!b||!settings)return;
 const i=Number(b.dataset.strategyToggle);if(i<0||i>=names.length)return;
 settings.enabled_strategies[i]=!settings.enabled_strategies[i];
 syncControls();renderStrategies();
 try{await saveSettings()}catch(err){settings.enabled_strategies[i]=!settings.enabled_strategies[i];syncControls();renderStrategies();alert("Не удалось сохранить настройки: "+err.message)}
});
$("mainDemoEnabled").addEventListener("change",async e=>{
 const old=settings.execution_mode;
 try{await setExecutionMode(e.target.checked?"MAIN_DEMO":"VIRTUAL")}
 catch(error){settings.execution_mode=old;syncControls();alert(error.message)}
});
$("aiDemoEnabled").addEventListener("change",async e=>{
 const old=settings.execution_mode;
 if(e.target.checked&&!settings.ai_enabled){
  e.target.checked=false;
  alert("Сначала включи «Самостоятельный AI Trader». После этого можно включить AI DEMO.");
  return;
 }
 try{await setExecutionMode(e.target.checked?"AI_DEMO":"VIRTUAL")}
 catch(error){settings.execution_mode=old;syncControls();alert(error.message)}
});
$("demoTradeSize").addEventListener("change",async()=>{
 const old=settings.trade_size;
 const value=Number($("demoTradeSize").value);
 settings.trade_size=Number.isFinite(value)&&value>0?value:null;
 try{
  if(settings.execution_mode==="VIRTUAL")await saveSettings();
  else await setExecutionMode(settings.execution_mode);
 }catch(error){
  settings.trade_size=old;
  $("demoTradeSize").value=old==null?"":String(old);
  alert(error.message);
 }
});
$("checkDemoRules").addEventListener("click",async()=>{
 const button=$("checkDemoRules");button.disabled=true;button.textContent="Проверяем…";
 try{await checkDemoRules()}catch(error){$("demoExecutionNote").textContent=error.message}
 finally{button.disabled=false;button.textContent="Проверить"}
});
$("aiEnabled").addEventListener("change",async e=>{
 const old=!!settings.ai_enabled;
 if(!e.target.checked&&settings.execution_mode==="AI_DEMO"){
  try{await setExecutionMode("VIRTUAL")}catch(error){e.target.checked=true;alert(error.message);return}
 }
 settings.ai_enabled=e.target.checked;syncControls();
 $("aiModeLabel").textContent=settings.ai_enabled?"ВКЛ · ПАРАЛЛЕЛЬНЫЙ ТЕСТ":"ВЫКЛ";
 $("aiNote").textContent=settings.ai_enabled?"AI включён. Сервер применит режим при ближайшем сканировании.":"AI выключен. При ближайшем сканировании вернётся обычный режим.";
 try{await saveSettings()}catch(err){settings.ai_enabled=old;syncControls();alert("Не удалось сохранить режим AI: "+err.message)}
});
$("riskReward").addEventListener("change",async e=>{
 const old=settings.risk_reward;settings.risk_reward=Number(e.target.value);
 try{await saveSettings()}catch(err){settings.risk_reward=old;syncControls();alert("Ошибка сохранения: "+err.message)}
});
$("consensusEnabled").addEventListener("change",async e=>{
 const old=settings.consensus_enabled;settings.consensus_enabled=e.target.checked;syncControls();
 try{await saveSettings()}catch(err){settings.consensus_enabled=old;syncControls();alert("Ошибка сохранения: "+err.message)}
});
$("requiredMatches").addEventListener("change",async e=>{
 const old=settings.required_matches,n=Math.max(1,Math.min(names.length,Math.round(Number(e.target.value)||1)));
 settings.required_matches=n;syncControls();
 try{await saveSettings()}catch(err){settings.required_matches=old;syncControls();alert("Ошибка сохранения: "+err.message)}
});
document.querySelectorAll("[data-tf]").forEach(b=>b.addEventListener("click",async()=>{
 if(tf===b.dataset.tf)return;
 const old=tf;tf=b.dataset.tf;settings.timeframe=tf;syncControls();
 try{await saveSettings();await startChart()}catch(e){tf=old;settings.timeframe=old;syncControls();alert("Не удалось изменить таймфрейм: "+e.message)}
}));
$("clearAiJournal").addEventListener("click",async()=>{
 const button=$("clearAiJournal");
 if(!confirm("Очистить только журнал AI? Все виртуальные сделки AI, включая открытые, будут удалены. Их дальнейшее закрытие отслеживаться не будет. История обучения AI по этим сделкам тоже начнётся заново. Обычный журнал и тестовый модуль не затрагиваются."))return;
 button.disabled=true;button.textContent="Очищаем…";
 try{
  const {error}=await supabase.from("trades").delete().like("trade_key","ai:%");
  if(error)throw error;
  await loadAiJournal();
  $("aiJournalNote").textContent="Журнал AI очищен. Новые виртуальные сделки будут записываться с ближайших сканирований.";
 }catch(error){
  $("aiJournalNote").textContent="Не удалось очистить журнал AI: "+error.message;
  alert("Ошибка очистки журнала AI: "+error.message);
 }finally{button.disabled=false;button.textContent="Очистить журнал AI"}
});
$("clearJournal").addEventListener("click",async()=>{
 if(confirm("Удалить общий журнал на всех устройствах?"))try{await journal.clear()}catch(e){alert("Ошибка: "+e.message)}
});
document.querySelectorAll(".nav [data-view]").forEach(b=>b.addEventListener("click",()=>{
 document.querySelectorAll("main [data-screen]").forEach(s=>s.hidden=s.dataset.screen!==b.dataset.view);
 document.querySelectorAll(".nav [data-view]").forEach(x=>x.classList.toggle("active",x===b));
}));
(async()=>{
 try{
  await journal.init();
  await loadSettings();
  initBitcoinBacktest(()=>settings,WORKER,async preset=>{
   settings.enabled_strategies=preset.enabled.slice();
   settings.required_matches=preset.minMatches;
   settings.risk_reward=preset.riskReward;
   settings.timeframe=preset.timeframe;
   tf=preset.timeframe;
   syncControls();renderStrategies();await startChart();
   $("cloudStatus").textContent="Настройки основного бота применены из бэктеста";
  });
  await loadAiJournal();
  await startChart();
  await pollState();
  setInterval(pollState,5000);
  $("cloudStatus").textContent="Облачный журнал и серверные настройки подключены";
 }catch(e){console.error(e);$("cloudStatus").textContent="Ошибка облачного подключения: "+e.message;status(false)}
})();
