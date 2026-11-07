export const name="Keltner Channel";
export default c=>c.last>c.keltnerUpper?"BUY":c.last<c.keltnerLower?"SELL":"WAIT";
