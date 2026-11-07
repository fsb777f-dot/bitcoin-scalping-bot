export const name="Parabolic SAR";
export default c=>c.last>c.psar?"BUY":c.last<c.psar?"SELL":"WAIT";
