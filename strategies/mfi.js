export const name="Money Flow Index";
export default c=>c.mfiPrevious<20&&c.mfi>20?"BUY":c.mfiPrevious>80&&c.mfi<80?"SELL":"WAIT";
