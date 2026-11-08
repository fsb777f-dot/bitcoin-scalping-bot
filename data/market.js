const base="https://api.bybit.com";
export async function loadCandles(tf){
  const interval=tf==="5m"?"5":"1";
  const r=await fetch(base+"/v5/market/kline?category=spot&symbol=BTCUSDT&interval="+interval+"&limit=300");
  if(!r.ok)throw Error("Bybit HTTP "+r.status);
  const j=await r.json();
  if(j.retCode!==0)throw Error("Bybit: "+j.retMsg);
  return (j.result.list||[]).slice().reverse().map(k=>({time:Number(k[0])/1000,open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}));
}
export function connectMarket(tf,onCandle,onStatus){
  const interval=tf==="5m"?"5":"1";
  const ws=new WebSocket("wss://stream.bybit.com/v5/public/spot");
  ws.onopen=()=>{onStatus?.(true);ws.send(JSON.stringify({op:"subscribe",args:["kline."+interval+".BTCUSDT"]}))};
  ws.onmessage=e=>{try{const msg=JSON.parse(e.data);if(!msg.topic||!msg.topic.startsWith("kline."))return;for(const k of msg.data||[])onCandle({time:Number(k.start)/1000,open:+k.open,high:+k.high,low:+k.low,close:+k.close,volume:+k.volume},!!k.confirm)}catch(err){console.error(err)}};
  ws.onerror=()=>onStatus?.(false);
  ws.onclose=()=>onStatus?.(false);
  return ws;
}