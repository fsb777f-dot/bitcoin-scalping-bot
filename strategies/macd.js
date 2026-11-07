export const name="MACD";export default c=>c.macd>c.macdSignal&&c.macdPrevious<=c.macdSignal?"BUY":c.macd<c.macdSignal&&c.macdPrevious>=c.macdSignal?"SELL":"WAIT";
