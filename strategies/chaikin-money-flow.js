export const name="Chaikin Money Flow";
export default c=>c.cmf>0.05?"BUY":c.cmf< -0.05?"SELL":"WAIT";
