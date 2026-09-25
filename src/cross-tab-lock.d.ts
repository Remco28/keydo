export function withLocalOrderLock<T>(operation: () => Promise<T> | T): Promise<T>;
export class OrderLockUnavailableError extends Error {}
export function withCrossTabOrderLock<T>(
  operation: (lockToken: string) => Promise<T> | T,
  locks?: { request<T>(name: string, options: { mode: "exclusive"; signal?: AbortSignal }, callback: () => Promise<T> | T): Promise<T> },
  serverLock?: (operation: (lockToken: string) => Promise<T> | T) => Promise<T> | T,
  acquisitionTimeoutMs?: number
): Promise<T>;
export function withServerOrderLock<T>(
  operation: (lockToken: string) => Promise<T> | T,
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  lockUrl?: string,
  handshakeTimeoutMs?: number
): Promise<T>;
