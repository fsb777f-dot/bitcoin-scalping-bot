import assert from "node:assert/strict";
import { capitalDemoPositionSnapshot, capitalDemoSettlement } from "../worker/capital-demo.js";

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
assert.deepEqual(capitalDemoSettlement(trade, otherAccount, 102), { pnl: 0, demo_pnl_source: "ESTIMATE" },
  "estimate is labeled and rounded to USD cents");
assert.deepEqual(capitalDemoSettlement({ ...trade, side: "SELL", demo_size: 0.5 }, otherAccount, 102),
  { pnl: -1, demo_pnl_source: "ESTIMATE" });
assert.deepEqual(capitalDemoSettlement({ ...trade, demo_size: null }, otherAccount, 102),
  { pnl: null, demo_pnl_source: null }, "unknown volume must never produce invented PnL");
console.log("Capital.com DEMO journal checks passed");
