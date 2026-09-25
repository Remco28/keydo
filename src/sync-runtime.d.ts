export type BackgroundSyncAction = "refresh" | "initialize" | null;

export function backgroundSyncAction(state: {
  configured: boolean | null | undefined;
  liveTodoist: boolean;
  online: boolean;
  visible: boolean;
}): BackgroundSyncAction;

export function createCoalescedSyncRunner<T>(run: () => Promise<T> | T): () => Promise<T>;
