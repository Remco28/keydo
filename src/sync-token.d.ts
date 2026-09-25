export declare function hasSyncToken(payload: unknown): payload is { sync_token: string };
export declare function requiresSyncCatchup(payload: unknown): boolean;
export declare function requiresFullSyncAfterCompletionChange(completed: boolean): boolean;
export declare function isPerformedSyncFailure(result: { skipped?: boolean; value?: { performed?: boolean; success?: boolean } } | null | undefined): boolean;
export declare function readSyncToken(readStoredToken: () => string | null): string;

export declare function readOrderSyncToken(
  action: string,
  readStoredToken: () => string | null
): string | undefined;
