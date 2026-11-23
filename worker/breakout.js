import {createCapitalSession,capitalDemoAuth,capitalDemoMarketData,capitalDemoInstrumentRules,capitalDemoOpenPosition,
  confirmBtcDemoOpen,capitalDemoUpdatePosition,capitalDemoReconcile} from "./capital-demo.js";
import {frames,levels,periods,signal,trail,updatePaper} from "./breakout-engine.js";

const initial=()=>({tf:"1m",size:0.0005,demo:false,position:null,plan:null,minute:0,log:[]});
export class BitcoinBreakout {
  constructor(ctx,env) { this.ctx=ctx; this.clients=new Set(); this.store=ctx.storage; this.env=env; this.queue=Promise.resolve(); }
  fetch(req) {
    const task=this.queue.then(()=>this.handle(req));
    this.queue=task.catch(()=>{});
    return task;
  }
  async handle(req) {
    if (new URL(req.url).pathname === "/session") {
      // Internal named object serializes logins across scanner, UI and backtests.
      if (this.session && Date.now() < this.expires) return Response.json(this.session);
      try {
        this.session=await createCapitalSession(this.env);
        this.expires=Date.now()+4*60000;
        return Response.json(this.session);
      } catch(e) { return Response.json({error:e.message},{status:503}); }
    }
    const state=this.state ||= await this.store.get("state") || initial();
    const save=()=>this.store.put("state",state);
    const path=new URL(req.url).pathname;
    try {
      if(path==="/stream") {
        const [client,server]=Object.values(new WebSocketPair());
        server.accept();
        this.clients.add(server);
        const remove=()=>this.clients.delete(server);
        server.addEventListener("close",remove);
        server.addEventListener("error",remove);
        server.send(JSON.stringify(state));
        return new Response(null,{status:101,webSocket:client});
      }
      if(path==="/settings") {
        const {tf,size,demo}=await req.json();
        if(!Object.hasOwn(periods,tf) || !Number.isFinite(size) || size<=0 || typeof demo!=="boolean") throw Error("Проверьте период и объём BTC");
        if(demo) {
          const rules=await capitalDemoInstrumentRules(this.env);
          const steps=(size-rules.minDealSize)/rules.sizeIncrement;
          if(size<rules.minDealSize || size>rules.maxDealSize || Math.abs(steps-Math.round(steps))>1e-7)
            throw Error("Допустимый объём от "+rules.minDealSize+" до "+rules.maxDealSize+" BTC, шаг "+rules.sizeIncrement);
        }
        if(state.tf!==tf) {state.plan=null;this.planUntil=0;}
        Object.assign(state,{tf,size,demo});
        await save();
      }
      if(path==="/tick") {
        await this.ensureStream();
        await this.refreshPlan(state);
        if(state.position) await this.reconcile(state,save);
        this.broadcast();
        state.error=null;
        await save();
      }
      if(path==="/settings") this.broadcast();
      return Response.json(state);
    } catch(e) {
      if(path==="/tick") {state.error=e.message;await save();}
      return Response.json({error:e.message},{status:path==="/settings"?400:502});
    }
  }
  broadcast() {
    const data=JSON.stringify(this.state);
    for(const client of this.clients) {
      try {client.send(data);} catch {this.clients.delete(client);}
    }
  }
  async ensureStream() {
    if(this.socket && Date.now()-this.lastMessage<45000) {
      this.socket.send(JSON.stringify({destination:"ping",...this.streamAuth}));
      return;
    }
    const old=this.socket;
    this.socket=null;
    if(old) old.close();
    const auth=await capitalDemoAuth(this.env);
    const response=await fetch("https://api-streaming-capital.backend-capital.com/connect",{headers:{Upgrade:"websocket"}});
    const ws=response.webSocket;
    if(!ws) throw Error("Не удалось открыть поток Capital.com");
    ws.accept();
    this.socket=ws;
    this.lastMessage=Date.now();
    this.streamAuth={cst:auth.CST,securityToken:auth["X-SECURITY-TOKEN"]};
    const lost=()=>{
      if(this.socket!==ws) return;
      this.socket=null;
      this.state.stream="reconnecting";
      this.broadcast();
      this.ctx.waitUntil(this.store.setAlarm(Date.now()+3000));
    };
    ws.addEventListener("close",lost);
    ws.addEventListener("error",lost);
    ws.addEventListener("message",event=>{
      if(ws!==this.socket) return;
      const data=JSON.parse(event.data);
      if(data.status && data.status!=="OK") {ws.close();lost();return;}
      if(data.destination!=="quote") return;
      const q=data.payload;
      if(q?.epic!=="BTCUSD" || !(q.bid>0 && q.ofr>=q.bid) || !Number.isFinite(q.timestamp)) return;
      this.lastMessage=Date.now();
      const task=this.queue.then(()=>this.onQuote(q));
      this.queue=task.catch(async e=>{
        this.state.error=e.message;this.broadcast();
        await this.store.put("state",this.state);
      });
      this.ctx.waitUntil(this.queue);
    });
    ws.send(JSON.stringify({destination:"marketData.subscribe",correlationId:"btc",...this.streamAuth,payload:{epics:["BTCUSD"]}}));
  }
  async alarm() {
    const response=await this.fetch(new Request("https://internal/tick"));
    if(!response.ok) await this.store.setAlarm(Date.now()+10000);
  }
  async refreshPlan(s) {
    const now=Date.now();
    if(s.plan && this.planUntil>now) return;
    if(this.planRetry>now) return;
    this.planRetry=now+3000;
    const market=await capitalDemoMarketData(this.env,"1m");
    const bar=market.candles.at(-1);
    if(now/1000-bar.time>180) throw Error("Минутные котировки устарели");
    const history=frames(market.candles,s.tf);
    const interval=periods[s.tf]*60000;
    const end=history.at(-1)?.end*1000;
    s.plan=levels(history,bar);
    this.planUntil=end+interval;
    s.minute=bar.time;
  }
  async onQuote(q) {
    const s=this.state, now=Date.now();
    if(Math.abs(now-q.timestamp)>15000 || q.timestamp<(this.quoteTime||0)) return;
    this.quoteTime=q.timestamp;
    s.bid=q.bid;s.ask=q.ofr;s.updated_at=new Date(q.timestamp).toISOString();s.stream="live";
    const bar={bidClose:q.bid,askClose:q.ofr};
    const save=()=>this.store.put("state",s);
    const paper=s.paper ||= {position:null, log:[], closed:0, wins:0, losses:0, pnl:0};
    let next=null;
    if(!paper.position || !s.position) {
      try { await this.refreshPlan(s); }
      catch(e) { s.error=e.message; }
      if(this.planUntil>Date.now() && Date.now()-q.timestamp<15000) next=signal(s.plan,bar);
    }
    if(updatePaper(paper,bar,next,q.timestamp,s)) await save();
    if(s.position) {
      const p=s.position;
      const hit=p.side==="BUY"?q.bid<=p.sl:q.ofr>=p.sl;
      if((hit || !p.dealId || now>=(this.syncAfter||0)) && now>=(this.syncRetry||0)) {
        this.syncRetry=now+2000;
        this.syncAfter=now+12000;
        await this.reconcile(s,save);
        await save();
      }
      if(s.position===p && p.dealId && !hit && !(this.stopAfter>now)) {
        const next=trail(p,bar);
        if(next!==p.sl) {
          this.stopAfter=now+1500;
          await capitalDemoUpdatePosition(this.env,p.dealId,next);
          p.sl=next;await save();
        }
      }
    } else {
      s.side=next?.side||"WAIT";
      if(s.demo && next && !(this.entryAfter>now)) {
        this.entryAfter=now+5000;
        await this.open(s,next,q,save);
        await save();
      }
    }
    this.broadcast();
  }
  async reconcile(s,save) {
    const auth=await capitalDemoAuth(this.env);
    const p=s.position;
    if(p) {
      if(!p.dealId) {
        if(!p.ref) throw Error("Ответ на отправку неизвестен. Сверьте заявку в Capital.com DEMO перед новым входом.");
        try { Object.assign(p,await confirmBtcDemoOpen(auth,p.ref)); }
        catch(e) { if(e.rejected) s.position=null; throw e; }
        await save();
      }
      const trade={capital_deal_id:p.dealId,capital_deal_reference:p.ref,status:"OPEN",side:p.side,
        entry:p.entry,demo_size:p.size,trade_time:p.opened};
      await capitalDemoReconcile(this.env,[trade],auth,async (_env,_key,patch)=>{
        if(patch.status==="CLOSED") {
          s.log.unshift({...p,...patch}); s.log=s.log.slice(0,100); s.position=null;
        } else if(patch.capital_status==="OPEN") {
          Object.assign(p,patch);
        } else throw Error("Ожидается подтверждение закрытия от брокера");
      });
      return;
    }
  }
  async open(s,next,q,save) {
    const entry=next.side==="BUY"?q.ofr:q.bid;
    const sl=Math.round((entry+(next.side==="BUY"?-1:1)*next.distance)*100)/100;
    const pending={...next,sl,entry,size:s.size,tf:s.tf,opened:Date.now()};
    try {
      const result=await capitalDemoOpenPosition(this.env,{direction:next.side,size:s.size,stopLevel:sl},{
        claim:async()=>{s.position=pending;await save();return true;},
        remember:async ref=>{pending.ref=ref;await save();}
      });
      Object.assign(pending,{dealId:result.dealId,entry:result.level||entry});
    } catch(e) {if(e.rejected) s.position=null;throw e;}
  }
}
