export const name="ATR Breakout";
export default c=>c.last>c.prev.high&&c.last-c.prev.high>c.atr*0.25?"BUY":c.last<c.prev.low&&c.prev.low-c.last>c.atr*0.25?"SELL":"WAIT";
