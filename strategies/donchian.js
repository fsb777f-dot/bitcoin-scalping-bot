export const name="Donchian Breakout";
export default c=>c.last>c.donchianHigh?"BUY":c.last<c.donchianLow?"SELL":"WAIT";
