import assert from "node:assert/strict";
import { capitalDemoPositionSnapshot, capitalDemoSettlement, capitalDemoCloseEvent, capitalDemoTradeTransaction } from "../worker/capital-demo.js";
import { closedDemoJournalPath, mainTradeRecords } from "../worker/index.js";

assert.equal(closedDemoJournalPath("ALL"), "trades?status=eq.CLOSED&execution_mode=in.(MAIN_DEMO,AI_DEMO)");
assert.equal(closedDemoJournalPath("MAIN_DEMO"), "trades?status=eq.CLOSED&execution_mode=eq.MAIN_DEMO");
assert.equal(closedDemoJournalPath("AI_DEMO"), "trades?status=eq.CLOSED&execution_mode=eq.AI_DEMO");
assert.throws(() => closedDemoJournalPath("VIRTUAL"), /Invalid DEMO journal filter/);

const mainSignal = { trade_key: "server:5m:1794492000:BUY", side: "BUY", entry: 100, sl: 90 };
const parallel = mainTradeRecords(mainSignal, true);
assert.equal(parallel.virtual.trade_key, mainSignal.trade_key);
assert.equal(parallel.virtual.execution_mode, "VIRTUAL");
assert.equal(parallel.demo.trade_key, "demo:" + mainSignal.trade_key);
assert.notEqual(parallel.virtual.trade_key, parallel.demo.trade_key,
  "DEMO must never conflict with the main virtual trade on the same signal");
assert.equal(mainTradeRecords(mainSignal, false).demo, null,
  "turning DEMO off must not suppress the main virtual trade");
assert.equal(mainTradeRecords(mainSignal, false).virtual.execution_mode, "VIRTUAL");
assert.deepEqual(mainSignal, { trade_key: "server:5m:1794492000:BUY", side: "BUY", entry: 100, sl: 90 },
  "preparing parallel executions must not mutate original signal");

assert.deepEqual(capitalDemoPositionSnapshot({ level: 74502.5, size: 0.0005, upl: -0.12 }), {
  entry: 74502.5, demo_size: 0.0005, demo_open_pnl: -0.12
});
assert.equal(capitalDemoPositionSnapshot({ level: 74502.5, upl: null }).demo_open_pnl, null,
  "missing broker profit must not become zero");

const trade = { capital_deal_id: "mine", capital_deal_reference: "ref-mine", side: "BUY", entry: 100, demo_size: 0.0005 };
const otherAccount = [{ reference: "other", transactionType: "TRADE", status: "PROCESSED", currency: "USD", size: "500" }];
assert.deepEqual(capitalDemoSettlement(trade, otherAccount), { pnl: null, demo_pnl_source: null },
  "unmatched transactions must never become this deal's profit");
assert.deepEqual(capitalDemoSettlement(trade, [{ reference: "mine", transactionType: "TRADE", status: "PROCESSED", currency: "USD", size: "-1.23" }]),
  { pnl: -1.23, demo_pnl_source: "CAPITAL_TRADE" });
assert.equal(capitalDemoTradeTransaction(trade, otherAccount), undefined,
  "another broker transaction cannot settle the user's trade");
assert.deepEqual(capitalDemoSettlement(trade, otherAccount, 102), { pnl: 0, demo_pnl_source: "ESTIMATE" },
  "estimate is labeled and rounded to USD cents");
assert.deepEqual(capitalDemoSettlement({ ...trade, side: "SELL", demo_size: 0.5 }, otherAccount, 102),
  { pnl: -1, demo_pnl_source: "ESTIMATE" });
assert.deepEqual(capitalDemoSettlement({ ...trade, demo_size: null }, otherAccount, 102),
  { pnl: null, demo_pnl_source: null }, "unknown volume must never produce invented PnL");
const stopClose = { dealId: "new-close-id", epic: "BTCUSD", type: "POSITION", status: "ACCEPTED",
  source: "SL", dateUTC: "2026-11-11T17:24:00", details: { positionDealId: "mine", closingLevel: 102 } };
assert.deepEqual(capitalDemoCloseEvent({ ...trade, trade_time: Date.parse("2026-11-11T17:20:00Z") }, [stopClose]), stopClose,
  "a stop must match its original position even when the closing action has a different ID");
assert.equal(capitalDemoCloseEvent(trade, [{ ...stopClose, details: { positionDealId: "other" } }]), null,
  "another position's stop must never settle this trade");
assert.equal(capitalDemoCloseEvent(trade, [{ dealId: "mine", type: "POSITION", status: "ACCEPTED", source: "USER" }]), null,
  "opening activity cannot be treated as a closing trade");
console.log("Capital.com DEMO journal checks passed");
