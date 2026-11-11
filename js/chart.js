export function createMarketChart(el){
  let timeframe="1m";
  function render(){
    const interval=timeframe==="15m"?"15":timeframe==="5m"?"5":"1";
    const params=new URLSearchParams({
      symbol:"BINANCE:BTCUSDT",
      interval,
      hide_top_toolbar:"0",
      hide_legend:"0",
      saveimage:"0",
      toolbarbg:"111827",
      theme:"dark",
      style:"1",
      timezone:"Etc/UTC",
      withdateranges:"1",
      hideideas:"1",
      allow_symbol_change:"0",
      hide_side_toolbar:"1",
      details:"0",
      hotlist:"0",
      calendar:"0",
      locale:"ru"
    });
    el.innerHTML="";
    const frame=document.createElement("iframe");
    frame.title="График Bitcoin BTCUSDT TradingView";
    frame.src="https://www.tradingview.com/widgetembed/?"+params.toString();
    frame.loading="lazy";
    frame.referrerPolicy="origin";
    frame.allow="fullscreen";
    frame.style.cssText="display:block;width:100%;height:100%;border:0;border-radius:10px";
    el.appendChild(frame);
  }
  render();
  return {setTimeframe(value){timeframe=["1m","5m","15m"].includes(value)?value:"1m";render()}};
}
