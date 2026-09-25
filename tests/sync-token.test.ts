import { describe, expect, test } from "bun:test";
import { hasSyncToken, isPerformedSyncFailure, readOrderSyncToken, readSyncToken, requiresFullSyncAfterCompletionChange, requiresSyncCatchup } from "../src/sync-token.js";

describe("order sync token selection", () => {
  test("accepts only non-empty string response cursors", () => {
    expect(hasSyncToken({ sync_token: "next" })).toBe(true);
    expect(hasSyncToken({ sync_token: "" })).toBe(false);
    expect(hasSyncToken({ sync_token: 42 })).toBe(false);
    expect(hasSyncToken(null)).toBe(false);
  });

  test("requires an incremental catch-up after a full snapshot", () => {
    expect(requiresSyncCatchup({ full_sync: true })).toBe(true);
    expect(requiresSyncCatchup({ full_sync: false })).toBe(false);
    expect(requiresSyncCatchup({})).toBe(false);
  });

  test("uses a full snapshot after reopening so restored ancestor order is rebuilt", () => {
    expect(requiresFullSyncAfterCompletionChange(false)).toBe(true);
    expect(requiresFullSyncAfterCompletionChange(true)).toBe(false);
  });

  test("marks failed sync executions uncertain but not skipped syncs", () => {
    expect(isPerformedSyncFailure({ skipped: false, value: { performed: true, success: false } })).toBe(true);
    expect(isPerformedSyncFailure({ skipped: false, value: { performed: true, success: true } })).toBe(false);
    expect(isPerformedSyncFailure({ skipped: false, value: { performed: false, success: false } })).toBe(false);
    expect(isPerformedSyncFailure({ skipped: true, value: { performed: true, success: false } })).toBe(false);
  });

  test("uses the saved cursor for order commands", () => {
    const read = () => "cursor-42";
    expect(readOrderSyncToken("reorder", read)).toBe("cursor-42");
  });

  test("falls back to a full sync for an empty stored cursor", () => {
    expect(readSyncToken(() => "")).toBe("*");
  });

  test("uses the saved read cursor for command-only writes and falls back safely", () => {
    expect(readSyncToken(() => "cursor-7")).toBe("cursor-7");
    expect(readSyncToken(() => null)).toBe("*");
    expect(readSyncToken(() => { throw new Error("storage blocked"); })).toBe("*");
  });

  test("falls back to a full sync when there is no usable saved cursor", () => {
    expect(readOrderSyncToken("reorder", () => null)).toBe("*");
    expect(readOrderSyncToken("reorder", () => { throw new Error("storage blocked"); })).toBe("*");
  });

  test("does not read a cursor for unrelated mutations", () => {
    let reads = 0;
    expect(readOrderSyncToken("update", () => { reads += 1; return "cursor-42"; })).toBeUndefined();
    expect(reads).toBe(0);
  });
});
