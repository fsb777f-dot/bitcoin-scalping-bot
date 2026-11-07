export const name="Fibonacci Pullback";
export default c=>c.fibTrend>0&&c.last>=c.fib618&&c.last<=c.fib50?"BUY":c.fibTrend<0&&c.last<=c.fib618&&c.last>=c.fib50?"SELL":"WAIT";
