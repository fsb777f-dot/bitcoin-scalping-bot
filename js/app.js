import{createMarketChart}from"./chart.js";
import{createJournal}from"./journal.js";
import{names}from"../strategies/index.js";
import{supabase}from"./supabase.js";
const $=id=>document.getElementById(id);
const fmt=n=>n!==null&&n!==undefined&&n!==""&&Number.isFinite(Number(n))?Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2}):"—";
const WORKER="https://bitcoin-scalping-bot.fsb777f.workers.dev";
let tf="1m",chart=createMarketChart($("chart")),settings=null,serverState=null,polling=false,previousPrice=null;
const journal=createJournal(supabase);
const defaults=()=>({timeframe:"1m",enabled_strategies:names.map(()=>true),consensus_enabled:true,required_matches:3,risk_reward:2,ai_enabled:false});
function status(ok){$("connection").innerHTML='<i class="dot '+(ok?"green":"red")+'"></i> '+(ok?"TradingView график":"График не загрузился")}
function syncControls(){
 if(!settings)return;
 $("consensusEnabled").checked=settings.consensus_enabled;
 $("requiredMatches").value=String(settings.required_matches);
 $("requiredMatches").disabled=!settings.consensus_enabled;
 $("matchHint").textContent=settings.consensus_enabled
  ?"Для сигнала нужно минимум "+settings.required_matches+" одинаковых подтверждения. Если включённых стратегий меньше — сигнал не откроется."
  :"Совпадения выключены: достаточно сигнала одной включённой стратегии.";
 $("riskReward").value=String(settings.risk_reward);
 $("aiEnabled").checked=!!settings.ai_enabled;
 $("aiModeLabel").textContent=settings.ai_enabled?"ВКЛ · АДАПТИВНЫЙ РЕЖИМ":"ВЫКЛ";

 $("tfLabel").textContent=tf==="1m"?"1 минута":"5 минут";
 document.querySelectorAll("[data-tf]").forEach(b=>b.classList.toggle("active",b.dataset.tf===tf));
}
function renderStrategies(){
 const results=serverState?.strategy_results||[];
 $("strategies").innerHTML=names.map((name,i)=>{
  const enabled=!!settings?.enabled_strategies?.[i];
  const signal=results[i]?.signal||"WAIT";
  return '<div class="strategy '+(enabled?"":"strategy-disabled")+'"><span class="strategy-name">'+name+'</span><b class="tag '+(enabled?(signal==="BUY"?"green":signal==="SELL"?"red":"yellow"):"muted")+'">'+(enabled?signal:"ВЫКЛ")+'</b><button type="button" class="strategy-toggle" data-strategy-toggle="'+i+'">'+(enabled?"Отключить":"Включить")+'</button></div>';
 }).join("");
}
function renderSignal(){
 if(!serverState)return;
 const r=serverState;
 const aiActive=!!settings?.ai_enabled&&r.ai_enabled===true;
 const shownSide=settings?.ai_enabled&&!aiActive?"WAIT":(r.side||"WAIT");
 $("signal").textContent=shownSide;
 $("signal").className="signalbig "+(shownSide==="BUY"?"green":shownSide==="SELL"?"red":"yellow");
 $("matches").textContent=(r.count||0)+" совпадений · активно "+(r.active_count||0)+" / "+names.length;
 $("entry").textContent=fmt(settings?.ai_enabled&&!aiActive?null:r.entry);$("sl").textContent=fmt(settings?.ai_enabled&&!aiActive?null:r.sl);$("tp").textContent=fmt(settings?.ai_enabled&&!aiActive?null:r.tp);
 const stamp=r.updated_at?new Date(r.updated_at).toLocaleTimeString("ru-RU"):"—";
 $("signalNote").textContent=r.last_error?"Ошибка сканера: "+r.last_error:(aiActive?"Решение AI · ":"Обычный сканер · ")+"обновлено "+stamp+". Только виртуальная торговля.";
 $("aiSide").textContent=settings?.ai_enabled?(aiActive?(r.side||"WAIT"):"ОЖИДАНИЕ"):"OFF";
 $("aiSide").className=aiActive?(r.side==="BUY"?"green":r.side==="SELL"?"red":"yellow"):"";
 $("aiConfidence").textContent=aiActive&&r.ai_confidence!=null?r.ai_confidence+"%":"—";
 $("aiSelected").textContent=aiActive?String((r.ai_selected||[]).length):"0";
 $("aiNote").textContent=!settings?.ai_enabled?"AI выключен. Работает обычный сканер.":!aiActive?"AI включён. Ожидаем следующий серверный цикл сканирования.":(r.ai_reason||"AI анализирует рынок.");
 const perf=aiActive?(r.ai_performance||[]):[],learned=perf.filter(p=>p.trades>=5).length,excluded=(r.ai_excluded||[]).length;
 $("aiLearning").textContent=aiActive?"Обучение по журналу: "+learned+" стратегий с выборкой от 5 сделок · исключено слабых: "+excluded+".":"Статистика AI появится после закрытия виртуальных сделок.";
 renderStrategies();
}
async function loadSettings(){
 const {data,error}=await supabase.from("bot_settings").select("*").eq("id",1).maybeSingle();
 if(error)throw error;
 settings={...defaults(),...(data||{})};
 if(!Array.isArray(settings.enabled_strategies)||settings.enabled_strategies.length!==names.length)settings.enabled_strategies=names.map(()=>true);
 settings.enabled_strategies=settings.enabled_strategies.map(Boolean);
 if(![1,1.5,2,2.5,3,4].includes(Number(settings.risk_reward)))settings.risk_reward=2;
 if(!Number.isInteger(Number(settings.required_matches))||settings.required_matches<1||settings.required_matches>names.length)settings.required_matches=3;
 tf=settings.timeframe==="5m"?"5m":"1m";
 syncControls();
 renderStrategies();
}
async function saveSettings(){
 const payload={id:1,timeframe:tf,enabled_strategies:settings.enabled_strategies,consensus_enabled:settings.consensus_enabled,required_matches:settings.required_matches,risk_reward:settings.risk_reward,ai_enabled:!!settings.ai_enabled,updated_at:new Date().toISOString()};
 const {error}=await supabase.from("bot_settings").upsert(payload,{onConflict:"id"});
 if(error)throw error;
 $("cloudStatus").textContent="Настройки сохранены в облаке · сканер обновит их в ближайшую минуту";
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
  $("tfLabel").textContent=tf==="1m"?"1 минута":"5 минут";
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
$("aiEnabled").addEventListener("change",async e=>{
 const old=!!settings.ai_enabled;settings.ai_enabled=e.target.checked;syncControls();
 $("aiModeLabel").textContent=settings.ai_enabled?"ВКЛ · ОЖИДАЕТ СКАНА":"ВЫКЛ";
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
  await startChart();
  await pollState();
  setInterval(pollState,5000);
  $("cloudStatus").textContent="Облачный журнал и серверные настройки подключены";
 }catch(e){console.error(e);$("cloudStatus").textContent="Ошибка облачного подключения: "+e.message;status(false)}
})();