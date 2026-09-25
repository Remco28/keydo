export function hasSyncToken(payload) {
  return Boolean(payload && typeof payload.sync_token === "string" && payload.sync_token.length > 0);
}

export function requiresSyncCatchup(payload) {
  return payload?.full_sync === true;
}

export function requiresFullSyncAfterCompletionChange(completed) {
  // Reopening can restore completed ancestors and append them to their
  // sibling lists, so a full snapshot is needed to rebuild their order.
  return completed === false;
}

export function isPerformedSyncFailure(result) {
  return result?.skipped !== true && result?.value?.performed === true && result.value.success !== true;
}

export function readSyncToken(readStoredToken) {
  try {
    const token = readStoredToken();
    return typeof token === "string" && token.length > 0 ? token : "*";
  } catch {
    return "*";
  }
}

export function readOrderSyncToken(action, readStoredToken) {
  if (action !== "reorder") return undefined;
  return readSyncToken(readStoredToken);
}
