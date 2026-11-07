export const name="Stochastic";export default c=>c.stochK<20&&c.stochK>c.stochD?"BUY":c.stochK>80&&c.stochK<c.stochD?"SELL":"WAIT";
