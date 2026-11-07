export const name="Ichimoku Cloud";
export default c=>c.last>c.cloudTop&&c.tenkan>c.kijun?"BUY":c.last<c.cloudBottom&&c.tenkan<c.kijun?"SELL":"WAIT";
