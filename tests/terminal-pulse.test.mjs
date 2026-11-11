import assert from "node:assert/strict";
import { test } from "node:test";
import { computeTerminalPulse } from "../js/terminal.js";

const now = Date.parse("2026-11-11T08:00:00.000Z");
const fresh = new Date(now - 60_000).toISOString();
const stale = new Date(now - 25 * 60_000).toISOString();
const btc = (side, ai = "SELL", enabled = true, updatedAt = fresh) => ({
  side, ai_side: ai, ai_enabled: enabled, updated_at: updatedAt, scan_ok: true
});
const gold = (side, updatedAt = fresh) => ({ state: { side, updated_at: updatedAt } });
const testFeed = side => ({ state: { signals: { consensus: side }, updated_at: fresh } });

test("AI CORE shows counts from six independent read-only streams", () => {
  const result = computeTerminalPulse(
    btc("BUY", "SELL"), gold("BUY"), gold("WAIT"), gold("BUY"), testFeed("SELL"), now
  );
  assert.deepEqual(result, { side: "BUY", buy: 3, sell: 2, wait: 1, available: 6, expected: 6 });
});

test("AI CORE shows WAIT on a tie (not a fabricated trade signal)", () => {
  const result = computeTerminalPulse(
    btc("BUY", "SELL"), gold("BUY"), gold("SELL"), gold("WAIT"), testFeed("WAIT"), now
  );
  assert.equal(result.side, "WAIT");
  assert.equal(result.buy, result.sell);
});

test("disabled AI is not counted as WAIT or as a voter", () => {
  const result = computeTerminalPulse(
    btc("BUY", "SELL", false), gold("WAIT"), gold("WAIT"), gold("WAIT"), testFeed("WAIT"), now
  );
  assert.equal(result.expected, 5);
  assert.equal(result.available, 5);
  assert.equal(result.sell, 0);
});

test("stale or missing feeds are excluded rather than making up WAIT votes", () => {
  const result = computeTerminalPulse(
    btc("SELL", "BUY", true, stale), gold("BUY", stale), null, null, testFeed("WAIT"), now
  );
  assert.deepEqual(result, { side: "WAIT", buy: 0, sell: 0, wait: 1, available: 1, expected: 6 });
});

test("failed scanner cannot vote with outdated or error states", () => {
  const failed = { ...btc("BUY", "SELL"), scan_ok: false };
  const result = computeTerminalPulse(failed, gold("WAIT"), null, null, null, now);
  assert.equal(result.available, 1);
  assert.equal(result.side, "WAIT");
});
