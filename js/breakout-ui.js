export function initBreakout(worker) {
  const el=id=>document.getElementById("bo"+id);
  const fmt=n=>n==null?"—":Number(n).toLocaleString("ru-RU",{maximumFractionDigits:4});
  const date=ms=>new Date(ms).toLocaleString("ru-RU");
  const url=worker+"/api/breakout";
  const message=text=>/too-many.requests|HTTP 429/i.test(text)?"Capital.com временно ограничил частоту запросов.":text;
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
  let paperVersion;
  function renderPaper(s) {
    const book=s.paper;
    if(!el("PaperPosition")) return;
    if(!book) {el("PaperPosition").textContent="Ожидание первой котировки виртуального журнала.";return;}
    const p=book.position;
    const mark=p?.side==="BUY"?s.bid:s.ask;
    el("PaperPosition").textContent=p
      ? p.side+" · "+p.tf+" · "+fmt(p.size)+" BTC · вход "+fmt(p.entry)+" · SL "+fmt(p.sl)
        +" · результат "+fmt((mark-p.entry)*p.size*(p.side==="BUY"?1:-1))+" USD"
      : "Открытой виртуальной позиции нет.";
    if(paperVersion===book.closed) return;
    paperVersion=book.closed;
    el("PaperStats").textContent="Закрыто "+book.closed+" · в плюс "+book.wins+" · в минус "+book.losses
      +" · винрейт "+(book.closed?fmt(100*book.wins/book.closed)+"%":"—")+" · итог "+fmt(book.pnl)+" USD";
    el("PaperLog").replaceChildren(...book.log.map(t=>{
      const row=document.createElement("p");
      row.textContent=date(t.opened)+" → "+date(t.closed)+" · "+t.side+" · "+t.tf+" · "+fmt(t.size)
        +" BTC · вход "+fmt(t.entry)+" → выход "+fmt(t.exit)+" · "+fmt(t.pnl)+" USD";
      return row;
    }));
    if(!book.log.length) el("PaperLog").textContent="Закрытых виртуальных сделок пока нет.";
  }
  let journalVersion;
  function render(s) {
    if(!dirty) {el("Tf").value=s.tf;el("Size").value=s.size;el("Demo").checked=s.demo;}
    initialized=true;
    renderPaper(s);
    const p=s.position;
    el("State").textContent=[
      s.tf+" · "+fmt(s.size)+" BTC · DEMO "+(s.demo?"ВКЛ":"ВЫКЛ"),
      s.bid?"Bid "+fmt(s.bid)+" · Ask "+fmt(s.ask):"",
      s.plan?"Покупка ≥ "+fmt(s.plan.buy)+" · Продажа ≤ "+fmt(s.plan.sell)+" · Стоп "+fmt(s.plan.distance)+" USD":"Ожидание уровней",
      p?p.side+" · "+fmt(p.size)+" BTC · вход "+fmt(p.entry)+" · SL "+fmt(p.sl)+(p.dealId?"":" · ожидается подтверждение"):("Сигнал "+(s.side||"WAIT")+" · позиции нет"),
      s.updated_at?"Обновлено "+date(s.updated_at):"",message(s.error||"")].filter(Boolean).join("\n");
    const version=s.log.length+":"+s.log[0]?.dealId;
    if(version!==journalVersion){list("Log",s.log,r=>Date.parse(r.demo_closed_at));journalVersion=version;}
  }
  async function refresh() {
    try {render(await fetchJson(url));}
    catch(e){el("State").textContent=e.message;}
  }
  for(const key of ["Tf","Size","Demo"]) el(key).oninput=()=>{dirty=true;el("Message").textContent="Изменения ещё не сохранены.";};

  el("Save").onclick=async()=>{
    if(!initialized) {await refresh();if(!initialized)return;}
    const pin=prompt("PIN управления DEMO");if(!pin)return;
    el("Save").disabled=true;
    try {
      const state=await fetchJson(url,{method:"POST",headers:{"Content-Type":"application/json","X-Execution-Control":pin},
        body:JSON.stringify({tf:el("Tf").value,size:Number(el("Size").value),demo:el("Demo").checked})});
      dirty=false;render(state);el("Message").textContent="Настройки сохранены.";
    } catch(e){dirty=false;await refresh();el("Message").textContent="Настройки не сохранены. "+message(e.message);} finally {el("Save").disabled=false;}
  };
  el("Test").onclick=async()=>{
    el("Test").disabled=true;el("Result").textContent="Загрузка истории…";el("Trades").replaceChildren();
    try {
      const r=await fetchJson(url+"/backtest?"+new URLSearchParams({tf:el("Tf").value,size:el("Size").value}));
      el("Result").textContent=[r.tf+" · "+fmt(r.size)+" BTC · "+date(r.from*1000)+" — "+date(r.to*1000),
        "Закрыто "+r.closed+" · прибыльных "+r.wins+" · убыточных "+r.losses,
        "Winrate "+(r.closed?fmt(100*r.wins/r.closed)+"%":"—")+" · PnL "+fmt(r.pnl)+" USD",
        r.warning||"",
        "Просадка по закрытиям "+fmt(r.drawdown)+" USD"+(r.position?" · одна позиция открыта":"")].join("\n");
      list("Trades",r.trades,t=>t.closed*1000);
    } catch(e){el("Result").textContent=message(e.message);} finally {el("Test").disabled=false;}
  };
  let socket=null,retry;
  function connect() {
    clearTimeout(retry);
    if(document.hidden || el("State").closest("section").hidden) {
      if(socket) socket.close();
      socket=null;
      return;
    }
    if(socket) return;
    const ws=new WebSocket(url.replace(/^http/,"ws")+"/stream");
    socket=ws;
    el("Feed").textContent="Подключение…";
    ws.onmessage=event=>{
      if(ws!==socket)return;
      const state=JSON.parse(event.data);
      render(state);
      el("Feed").textContent=state.stream==="live" && Date.now()-Date.parse(state.updated_at)<15000?"Прямой эфир":"Ожидание котировки";
    };
    ws.onclose=()=>{
      if(socket!==ws)return;
      socket=null;el("Feed").textContent="Восстановление связи…";retry=setTimeout(connect,1500);
    };
  }
  new MutationObserver(connect).observe(el("State").closest("section"),{attributes:true,attributeFilter:["hidden"]});
  document.addEventListener("visibilitychange",connect);
}
