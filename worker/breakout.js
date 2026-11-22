import {capitalDemoAuth,capitalDemoMarketData,capitalDemoInstrumentRules,capitalDemoOpenPosition,
  confirmBtcDemoOpen,capitalDemoUpdatePosition,capitalDemoReconcile} from "./capital-demo.js";
import {frames,levels,periods,signal,trail} from "./breakout-engine.js";

const initial=()=>({tf:"1m",size:0.0005,demo:false,position:null,plan:null,minute:0,log:[]});
export class BitcoinBreakout {
  constructor(ctx,env) { this.store=ctx.storage; this.env=env; this.queue=Promise.resolve(); }
  fetch(req) {
    const task=this.queue.then(()=>this.handle(req));
    this.queue=task.catch(()=>{});
    return task;
  }
  async handle(req) {
    const state=await this.store.get("state") || initial();
    const save=()=>this.store.put("state",state);
    const path=new URL(req.url).pathname;
    try {
      if(path==="/settings") {
        const {tf,size,demo}=await req.json();
        if(!Object.hasOwn(periods,tf) || !Number.isFinite(size) || size<=0 || typeof demo!=="boolean") throw Error("Проверьте период и объём BTC");
        if(demo) {
          const rules=await capitalDemoInstrumentRules(this.env);
          const steps=(size-rules.minDealSize)/rules.sizeIncrement;
          if(size<rules.minDealSize || size>rules.maxDealSize || Math.abs(steps-Math.round(steps))>1e-7)
            throw Error("Допустимый объём от "+rules.minDealSize+" до "+rules.maxDealSize+" BTC, шаг "+rules.sizeIncrement);
        }
        if(state.tf!==tf) state.plan=null;
        Object.assign(state,{tf,size,demo});
        await save();
      }
      if(path==="/tick") {
        await this.tick(state,save);
        state.error=null;
        await save();
      }
      return Response.json(state);
    } catch(e) {
      if(path==="/tick") {state.error=e.message;await save();}
      return Response.json({error:e.message},{status:path==="/settings"?400:502});
    }
  }
  async tick(s,save) {
    const auth=await capitalDemoAuth(this.env);
    const market=await capitalDemoMarketData(this.env,"1m",auth);
    const bar=market.candles.at(-1);
    if(Date.now()/1000-bar.time>180) throw Error("Минутные котировки устарели");
    if(s.minute===bar.time) return;
    s.minute=bar.time;
    s.updated_at=new Date().toISOString();
    const history=frames(market.candles,s.tf).filter(f=>f.end<=bar.time);
    s.plan=levels(history,bar);
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
          const next=trail(p,bar);
          if(next!==p.sl && (p.side==="BUY"?next<market.bid:next>market.ask)) {
            await capitalDemoUpdatePosition(this.env,p.dealId,next);
            p.sl=next;
          }
        } else throw Error("Ожидается подтверждение закрытия от брокера");
      });
      return;
    }
    const next=signal(s.plan,bar);
    s.side=next?.side||"WAIT";
    if(!s.demo || !next) return;
    const entry=next.side==="BUY"?market.ask:market.bid;
    if(next.side==="BUY"?entry<s.plan.buy:entry>s.plan.sell) return;
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
