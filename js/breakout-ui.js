export function initBreakout(worker) {
  const el=id=>document.getElementById("bo"+id);
  const fmt=n=>n==null?"—":Number(n).toLocaleString("ru-RU",{maximumFractionDigits:4});
  const date=ms=>new Date(ms).toLocaleString("ru-RU");
  const url=worker+"/api/breakout";
  let initialized=false, dirty=false;
  async function fetchJson(path,options) {
    const response=await fetch(path,{cache:"no-store",...options});
    const body=await response.json();
    if(!response.ok) throw Error(body.error||"Ошибка сервера");
    return body;
  }
  function list(id,rows,time) {
    el(id).replaceChildren(...rows.map(row=>{
      const item=document.createElement("p");
      item.textContent=date(time(row))+" · "+row.side+" · "+fmt(row.entry)+" → "+fmt(row.exit)+" · "+fmt(row.pnl)+" USD";
      return item;
    }));
    if(!rows.length) el(id).textContent="Закрытых сделок пока нет.";
  }
  function render(s) {
    if(!dirty) {el("Tf").value=s.tf;el("Size").value=s.size;el("Demo").checked=s.demo;}
    initialized=true;
    const p=s.position;
    el("State").textContent=[
      s.tf+" · "+fmt(s.size)+" BTC · DEMO "+(s.demo?"ВКЛ":"ВЫКЛ"),
      s.plan?"Покупка ≥ "+fmt(s.plan.buy)+" · Продажа ≤ "+fmt(s.plan.sell)+" · Стоп "+fmt(s.plan.distance)+" USD":"Ожидание уровней",
      p?p.side+" · "+fmt(p.size)+" BTC · вход "+fmt(p.entry)+" · SL "+fmt(p.sl)+(p.dealId?"":" · ожидается подтверждение"):("Сигнал "+(s.side||"WAIT")+" · позиции нет"),
      s.updated_at?"Обновлено "+date(s.updated_at):"",s.error||""].filter(Boolean).join("\n");
    list("Log",s.log,r=>Date.parse(r.demo_closed_at));
  }
  async function refresh() {
    try {render(await fetchJson(url));}
    catch(e){el("State").textContent=e.message;}
  }
  for(const key of ["Tf","Size","Demo"]) el(key).oninput=()=>{dirty=true;};
  el("Refresh").onclick=refresh;
  el("Save").onclick=async()=>{
    if(!initialized) {await refresh();if(!initialized)return;}
    const pin=prompt("PIN управления DEMO");if(!pin)return;
    el("Save").disabled=true;
    try {
      const state=await fetchJson(url,{method:"POST",headers:{"Content-Type":"application/json","X-Execution-Control":pin},
        body:JSON.stringify({tf:el("Tf").value,size:Number(el("Size").value),demo:el("Demo").checked})});
      dirty=false;render(state);el("Message").textContent="Настройки сохранены.";
    } catch(e){el("Message").textContent=e.message;} finally {el("Save").disabled=false;}
  };
  el("Test").onclick=async()=>{
    el("Test").disabled=true;el("Result").textContent="Загрузка истории…";el("Trades").replaceChildren();
    try {
      const r=await fetchJson(url+"/backtest?"+new URLSearchParams({tf:el("Tf").value,size:el("Size").value}));
      el("Result").textContent=[r.tf+" · "+fmt(r.size)+" BTC · "+date(r.from*1000)+" — "+date(r.to*1000),
        "Закрыто "+r.closed+" · прибыльных "+r.wins+" · убыточных "+r.losses,
        "Winrate "+(r.closed?fmt(100*r.wins/r.closed)+"%":"—")+" · PnL "+fmt(r.pnl)+" USD",
        "Просадка по закрытиям "+fmt(r.drawdown)+" USD"+(r.position?" · одна позиция открыта":"")].join("\n");
      list("Trades",r.trades,t=>t.closed*1000);
    } catch(e){el("Result").textContent=e.message;} finally {el("Test").disabled=false;}
  };
  document.querySelector('[data-view="breakout"]').addEventListener("click",refresh);
  setInterval(()=>{if(!document.hidden && !el("State").closest("section").hidden)refresh();},60000);
}
