export const name="OBV Momentum";
export default c=>c.obv>c.obvEma&&c.last>c.e21?"BUY":c.obv<c.obvEma&&c.last<c.e21?"SELL":"WAIT";
