import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateMainPnl } from "../js/journal.js";

test("main terminal PnL excludes AI and includes realized partial profit", () => {
  const trades = [
    { key: "server:1", status: "CLOSED", pnl: 120 },
    { key: "server:2", status: "CLOSED", pnl: -40 },
    { key: "server:3", status: "OPEN", partialExitPrice: 73500, pnl: 15 },
    { key: "server:4", status: "OPEN", pnl: 1000 },
    { key: "ai:1", status: "CLOSED", pnl: 900 },
    { key: "local:1", status: "CLOSED", pnl: 50 }
  ];
  assert.equal(calculateMainPnl(trades), 95);
});
