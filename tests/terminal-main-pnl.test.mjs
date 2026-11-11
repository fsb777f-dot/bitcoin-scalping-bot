import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateMainPnl, selectVirtualTrades } from "../js/journal.js";

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

test("virtual journal separates main bot and AI trades", () => {
  const trades = [
    { key: "server:5m:1", status: "CLOSED", pnl: 8 },
    { key: "ai:5m:1", status: "CLOSED", pnl: -4 },
    { key: "server:5m:2", status: "OPEN", pnl: null },
    { key: "local:old", status: "CLOSED", pnl: 1 }
  ];
  const main = selectVirtualTrades(trades, "MAIN");
  const ai = selectVirtualTrades(trades, "AI");
  assert.equal(main.length, 3);
  assert.equal(ai.length, 1);
  assert.equal(main.reduce((sum, t) => sum + (t.pnl || 0), 0), 9);
  assert.equal(ai.reduce((sum, t) => sum + (t.pnl || 0), 0), -4);
});
