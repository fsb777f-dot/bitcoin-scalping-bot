export const periods = {"1m":1,"5m":5,"15m":15};
const round = n => Math.round(n*100)/100;

// Build completed timeframe candles from consecutive broker minutes. A missing
// minute invalidates the bucket; gaps are never filled with fabricated prices.
export function frames(minutes, tf) {
  const buckets = new Map(), count = periods[tf], seconds = count*60;
  for (const bar of minutes) {
    const start = Math.floor(bar.time/seconds)*seconds;
    const group = buckets.get(start) || [];
    group.push(bar);
    buckets.set(start, group);
  }
  const result = [];
  for (const [start, group] of buckets) {
    if (group.length !== count || group.some((bar,i) => bar.time !== start+i*60)) continue;
    result.push({end:start+seconds, high:Math.max(...group.map(b=>b.high)),
      low:Math.min(...group.map(b=>b.low)), close:group.at(-1).close});
  }
  return result;
}

export function levels(history, bar) {
  if (history.length < 15) return null;
  const last = history.at(-1);
  const ranges = history.slice(-14).map((c,i) => {
    const prior = history[history.length-15+i].close;
    return Math.max(c.high-c.low,Math.abs(c.high-prior),Math.abs(c.low-prior));
  });
  const spread = bar.askClose-bar.bidClose;
  const distance = round(Math.max(ranges.reduce((a,b)=>a+b,0)/14,3*spread,0.02));
  return {buy:round(last.high+spread/2+0.01),sell:round(last.low-spread/2-0.01),distance};
}

export function signal(plan, bar) {
  if (!plan || !(bar.bidClose>0 && bar.askClose>=bar.bidClose)) return null;
  const up = bar.askClose >= plan.buy, down = bar.bidClose <= plan.sell;
  if (up === down) return null;
  const side = up ? "BUY":"SELL", entry = up ? bar.askClose : bar.bidClose;
  return {side, entry, distance:plan.distance, sl:round(entry+(up?-1:1)*plan.distance)};
}

export function trail(p, bar) {
  const buy = p.side==="BUY", quote = buy ? bar.bidClose : bar.askClose;
  if ((buy ? quote-p.entry : p.entry-quote) < p.distance) return p.sl;
  const candidate = round(quote+(buy?-1:1)*p.distance);
  return buy ? Math.max(p.sl,candidate) : Math.min(p.sl,candidate);
}

export function simulate(minutes, tf, size) {
  const history=frames(minutes,tf);
  let index=0, position=null, equity=0, peak=0, drawdown=0;
  const trades=[];
  for (const bar of minutes) {
    while(index<history.length && history[index].end<=bar.time) index++;
    if (position) {
      const buy=position.side==="BUY";
      if (buy ? bar.bidLow<=position.sl : bar.askHigh>=position.sl) {
        const exit=buy ? Math.min(bar.bidOpen,position.sl) : Math.max(bar.askOpen,position.sl);
        const pnl=(exit-position.entry)*size*(buy?1:-1);
        trades.push({...position,exit,pnl,closed:bar.time+60});
        equity+=pnl; peak=Math.max(peak,equity); drawdown=Math.max(drawdown,peak-equity);
        position=null;
      } else position.sl=trail(position,bar);
      continue;
    }
    const plan=levels(history.slice(Math.max(0,index-15),index),bar);
    const next=signal(plan,bar);
    if(next) position={...next,opened:bar.time+60};
  }
  return {tf,size,bars:minutes.length,from:minutes[0]?.time,to:minutes.at(-1)?.time+60,
    closed:trades.length,wins:trades.filter(t=>t.pnl>0).length,losses:trades.filter(t=>t.pnl<0).length,
    pnl:equity,drawdown,position,trades:trades.reverse()};
}
