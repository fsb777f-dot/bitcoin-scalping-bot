import test from "node:test";
import assert from "node:assert/strict";
import {simulate,frames,signal,trail} from "../worker/breakout-engine.js";
const bar=(i,price=100)=>({time:i*60,low:price-2,high:price+2,close:price,bidClose:price-0.5,
  askClose:price+0.5,bidLow:price-2.5,askHigh:price+2.5,bidOpen:price-0.5,askOpen:price+0.5});
test("only complete and consecutive timeframe buckets set breakout levels",()=>{
  assert.equal(frames([0,1,3,4,5].map(i=>bar(i)),"5m").length,0);
  assert.equal(frames(Array.from({length:15},(_,i)=>bar(i)),"15m").length,1);
});
test("one direction only and stop moves into profit symmetrically",()=>{
  const plan={buy:103,sell:97,distance:4};
  for(const side of ["BUY","SELL"]){
    const sign=side==="BUY"?1:-1;
    const position=signal(plan,bar(1,100+5*sign));
    assert.equal(position.side,side);
    assert.equal(trail(position,bar(2,100+5*sign)),position.sl);
    assert.ok(sign*(trail(position,bar(3,100+15*sign))-position.entry)>0);
  }
  assert.equal(signal(plan,{bidClose:96,askClose:104}),null);
});
test("stop exit accounts for adverse gap and configured BTC size",()=>{
  const bars=Array.from({length:15},(_,i)=>bar(i));
  bars.push(bar(15,105),bar(16,95));
  const report=simulate(bars,"1m",0.01);
  assert.equal(report.closed,1);
  assert.equal(report.trades[0].exit,94.5);
  assert.equal(report.pnl,-0.11);
});

test("overlapping scanner and settings requests share one broker login",async()=>{
  const {BitcoinBreakout}=await import("../worker/breakout.js");
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response("{}",{headers:{CST:"test","X-SECURITY-TOKEN":"test"}});};
  try {
    const object=new BitcoinBreakout({storage:{}},{CAPITAL_API_KEY:"test",CAPITAL_PASSWORD:"test",CAPITAL_IDENTIFIER:"test"});
    const sessions=await Promise.all(Array.from({length:4},()=>object.fetch(new Request("https://internal/session"))));
    assert.ok(sessions.every(s=>s.ok));
    assert.equal(calls,1);
  } finally {globalThis.fetch=original;}
});
