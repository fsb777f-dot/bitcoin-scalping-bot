export const name="VWAP";export default c=>c.last>c.vwap?"BUY":c.last<c.vwap?"SELL":"WAIT";
