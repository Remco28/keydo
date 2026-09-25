import { createTodoistClient, TodoistApiError, TodoistCommandError, type Fetcher, type TodoistSyncRequest, type TodoistSyncResponse, type TodoistTaskCreate, type TodoistTaskMove, type TodoistTaskUpdate } from "./todoist";
import { hasRasterImageSignature, normalizeRasterImageType } from "./image-content";
import { createAsyncLock } from "./order-lock.js";

export type KeydoServerOptions = {
  port?: number;
  hostname?: string;
  allowedHosts?: string[];
  todoistToken?: string;
  todoistApiBase?: string;
  fetcher?: Fetcher;
};

const indexFile = Bun.file(new URL("../index.html", import.meta.url));
const taskViewFile = Bun.file(new URL("./task-view.js", import.meta.url));
const taskActionGateFile = Bun.file(new URL("./task-action-gate.js", import.meta.url));
const taskMutationsFile = Bun.file(new URL("./task-mutations.js", import.meta.url));
const taskCaptureFile = Bun.file(new URL("./task-capture.js", import.meta.url));
const taskAttachmentsFile = Bun.file(new URL("./task-attachments.js", import.meta.url));
const markdownFile = Bun.file(new URL("./markdown.js", import.meta.url));
const syncCoordinatorFile = Bun.file(new URL("./sync-coordinator.js", import.meta.url));
const syncTokenFile = Bun.file(new URL("./sync-token.js", import.meta.url));
const syncRuntimeFile = Bun.file(new URL("./sync-runtime.js", import.meta.url));
const crossTabLockFile = Bun.file(new URL("./cross-tab-lock.js", import.meta.url));
const fractionalIndexingFile = Bun.file(new URL("../node_modules/fractional-indexing/src/index.js", import.meta.url));

function isSyncRequest(value: unknown): value is TodoistSyncRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  // The browser-facing Sync route is read-only. Writes use dedicated routes
  // with narrower validation and lock/reconciliation semantics.
  return Object.keys(candidate).every(key => key === "syncToken" || key === "resourceTypes")
    && (candidate.syncToken === undefined || typeof candidate.syncToken === "string")
    && (candidate.resourceTypes === undefined || (Array.isArray(candidate.resourceTypes) && candidate.resourceTypes.every(type => typeof type === "string")));
}

function syncResponseForBrowser(payload: TodoistSyncResponse): TodoistSyncResponse {
  const user = payload.user;
  if (!user || typeof user !== "object" || Array.isArray(user)) return payload;
  // The browser needs only the account timezone. The Todoist user resource
  // also contains credentials and profile data that should stay server-side.
  const source = user as Record<string, unknown>;
  const safeUser = Object.hasOwn(source, "tz_info") ? { tz_info: source.tz_info } : {};
  return { ...payload, user: safeUser };
}

// Keep this REST body aligned with Todoist's Update Task schema. Fractional
// order_key writes use Sync item_update; project/section/parent changes use
// the dedicated task move endpoint.
function isTodoistTaskUpdate(value: unknown): value is TodoistTaskUpdate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const updates = value as Record<string, unknown>;
  const isInteger = (input: unknown): input is number => typeof input === "number" && Number.isInteger(input);
  const stringFields = new Set(["content", "description", "due_string", "due_date", "due_datetime", "due_lang"]);
  const nullableStringFields = new Set(["duration_unit", "deadline_date"]);
  const integerFields = new Set(["child_order", "day_order"]);
  const supportedFields = new Set([...stringFields, "labels", "priority", "assignee_id", "duration", ...nullableStringFields, ...integerFields, "is_collapsed"]);
  return Object.keys(updates).length > 0 && Object.entries(updates).every(([key, input]) => {
    if (!supportedFields.has(key)) return false;
    if (stringFields.has(key)) return typeof input === "string";
    if (nullableStringFields.has(key)) return input === null || typeof input === "string";
    if (integerFields.has(key)) return isInteger(input) && input >= -2_147_483_648 && input <= 2_147_483_647;
    if (key === "labels") return Array.isArray(input) && input.every(label => typeof label === "string");
    if (key === "priority") return isInteger(input) && input >= 1 && input <= 4;
    if (key === "assignee_id") return input === null || (isInteger(input) && input >= 0);
    if (key === "duration") return input === null || (isInteger(input) && input >= 0);
    return typeof input === "boolean";
  });
}

function isTaskMutation(value: unknown): value is { action: "update" | "complete" | "reopen" | "delete" | "move" | "reorder"; updates?: TodoistTaskUpdate; destination?: TodoistTaskMove; order_key?: string; sync_token?: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const hasOnlyKeys = (...keys: string[]) => Object.keys(candidate).every(key => keys.includes(key));
  if (candidate.action === "update") {
    return hasOnlyKeys("action", "updates") && isTodoistTaskUpdate(candidate.updates);
  }
  if (candidate.action === "move") {
    if (!hasOnlyKeys("action", "destination")) return false;
    const destination = candidate.destination;
    if (!destination || typeof destination !== "object" || Array.isArray(destination)) return false;
    const dest = destination as Record<string, unknown>;
    const allowedFields = new Set(["parent_id", "project_id", "section_id"]);
    if (Object.keys(dest).length === 0 || !Object.keys(dest).every(key => allowedFields.has(key))) return false;
    if (dest.parent_id === null && dest.project_id === undefined && dest.section_id === undefined) return false;
    if (dest.parent_id !== undefined && !(typeof dest.parent_id === "string" || dest.parent_id === null)) return false;
    if (dest.project_id !== undefined && !(typeof dest.project_id === "string" || dest.project_id === null)) return false;
    if (dest.section_id !== undefined && !(typeof dest.section_id === "string" || dest.section_id === null)) return false;
    return true;
  }
  if (candidate.action === "reorder") return hasOnlyKeys("action", "order_key", "sync_token") && typeof candidate.order_key === "string" && candidate.order_key.length > 0 && (candidate.sync_token === undefined || typeof candidate.sync_token === "string");
  return (candidate.action === "complete" || candidate.action === "reopen" || candidate.action === "delete") && Object.keys(candidate).length === 1;
}

function isCreateTask(value: unknown): value is TodoistTaskCreate & { command_uuid?: string; temp_id?: string; sync_token?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  // The Sync item_add adapter below maps only this subset; reject anything it
  // would otherwise accept and silently omit (section/order fields included).
  const supportedFields = new Set(["content", "description", "labels", "priority", "project_id", "due_string", "due_date", "command_uuid", "temp_id", "sync_token"]);
  return typeof candidate.content === "string"
    && candidate.content.trim().length > 0
    && Object.keys(candidate).every(key => supportedFields.has(key))
    && !(candidate.due_string !== undefined && candidate.due_date !== undefined)
    && (candidate.description === undefined || typeof candidate.description === "string")
    && (candidate.labels === undefined || (Array.isArray(candidate.labels) && candidate.labels.every(label => typeof label === "string")))
    && (candidate.priority === undefined || (typeof candidate.priority === "number" && Number.isInteger(candidate.priority) && candidate.priority >= 1 && candidate.priority <= 4))
    && (candidate.project_id === undefined || candidate.project_id === null || typeof candidate.project_id === "string")
    && (candidate.due_string === undefined || typeof candidate.due_string === "string")
    && (candidate.due_date === undefined || typeof candidate.due_date === "string")
    && (candidate.command_uuid === undefined || (typeof candidate.command_uuid === "string" && candidate.command_uuid.length > 0))
    && (candidate.temp_id === undefined || (typeof candidate.temp_id === "string" && candidate.temp_id.length > 0))
    && (candidate.sync_token === undefined || typeof candidate.sync_token === "string");
}

function isTaskOrderUpdates(value: unknown): value is { sync_token?: string; updates: Array<{ id: string; order_key: string }> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!Object.keys(candidate).every(key => key === "sync_token" || key === "updates")) return false;
  if (candidate.sync_token !== undefined && typeof candidate.sync_token !== "string") return false;
  if (!Array.isArray(candidate.updates) || candidate.updates.length === 0) return false;
  const ids = new Set<string>();
  for (const update of candidate.updates) {
    if (!update || typeof update !== "object" || Array.isArray(update)) return false;
    const entry = update as Record<string, unknown>;
    if (Object.keys(entry).length !== 2 || !Object.hasOwn(entry, "id") || !Object.hasOwn(entry, "order_key")) return false;
    if (typeof entry.id !== "string" || !entry.id || typeof entry.order_key !== "string" || !entry.order_key || ids.has(entry.id)) return false;
    ids.add(entry.id);
  }
  return true;
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function normalizeHostName(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isWildcardHost(value: string): boolean {
  const host = normalizeHostName(value);
  return host === "0.0.0.0" || host === "::";
}

function isAllowedHost(request: Request, allowedHosts: Set<string>): boolean {
  const hostHeader = request.headers.get("host");
  if (!hostHeader) return false;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return false;
    return allowedHosts.has(normalizeHostName(parsed.hostname));
  } catch {
    return false;
  }
}

export function createServer(options: KeydoServerOptions = {}) {
  const port = options.port ?? Number(Bun.env.PORT ?? 7710);
  const hostname = options.hostname ?? Bun.env.HOST ?? "127.0.0.1";
  const allowedHosts = new Set([
    hostname,
    ...(options.allowedHosts ?? []),
    ...(Bun.env.KEYDO_ALLOWED_HOSTS ?? "").split(","),
    ...(Bun.env.KEYDO_TAILSCALE_HOSTS ?? "").split(",")
  ].map(normalizeHostName).filter(host => host && !isWildcardHost(host)));
  if (isWildcardHost(hostname) || ["127.0.0.1", "::1", "localhost"].includes(normalizeHostName(hostname))) {
    ["127.0.0.1", "::1", "localhost"].forEach(host => allowedHosts.add(host));
  }
  const token = options.todoistToken ?? Bun.env.TODOIST_ACCESS_TOKEN ?? "";
  const todoist = token ? createTodoistClient({ token, apiBase: options.todoistApiBase ?? Bun.env.TODOIST_API_BASE, fetcher: options.fetcher }) : null;
  const taskOrderLock = createAsyncLock();
  type OrderLockOwner = { token: string; release: () => void; activeRequests: number; cancelled: boolean };
  let orderLockOwner: OrderLockOwner | null = null;

  function releaseOrderLockOwner(owner: OrderLockOwner) {
    if (orderLockOwner !== owner) return;
    orderLockOwner = null;
    owner.release();
  }

  function holdOrderLockForRequest(request: Request): { release?: () => void; response?: Response } {
    const token = request.headers.get("x-keydo-order-lock");
    if (!token) return { response: errorResponse("A shared task-state lock token is required", 409) };
    const owner = orderLockOwner;
    if (!owner || owner.cancelled || owner.token !== token) {
      return { response: errorResponse("The shared task-state lock is no longer active", 409) };
    }
    owner.activeRequests += 1;
    let released = false;
    return { release: () => {
      if (released) return;
      released = true;
      owner.activeRequests -= 1;
      if (owner.cancelled && owner.activeRequests === 0) releaseOrderLockOwner(owner);
    } };
  }

  return Bun.serve({
    hostname,
    port,
    // Leave room for multipart boundaries and fields around the 5 MiB image.
    maxRequestBodySize: 5 * 1024 * 1024 + 64 * 1024,
    async fetch(request) {
      const url = new URL(request.url);

      if (!isAllowedHost(request, allowedHosts)) return errorResponse("Unrecognized host", 421);

      if (url.pathname.startsWith("/api/todoist/") && !["GET", "HEAD"].includes(request.method) && !isSameOrigin(request)) {
        return errorResponse("Cross-origin Todoist requests are not allowed", 403);
      }

      if (url.pathname === "/api/todoist/order-lock") {
        if (request.method !== "POST") return errorResponse("Method not allowed", 405);
        let release;
        try {
          release = await taskOrderLock.acquire(request.signal);
        } catch {
          return errorResponse("Task-order lock request was cancelled", 503);
        }
        const owner: OrderLockOwner = { token: crypto.randomUUID(), release, activeRequests: 0, cancelled: false };
        orderLockOwner = owner;
        const releaseOnce = () => {
          owner.cancelled = true;
          if (owner.activeRequests === 0) releaseOrderLockOwner(owner);
        };
        let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            try {
              controller.enqueue(encoder.encode(`locked ${owner.token}\n`));
            } catch {
              releaseOnce();
              return;
            }
            heartbeatTimer = setInterval(() => {
              try {
                controller.enqueue(encoder.encode("keepalive\n"));
              } catch {
                clearInterval(heartbeatTimer);
                releaseOnce();
              }
            }, 15_000);
          },
          cancel() {
            clearInterval(heartbeatTimer);
            releaseOnce();
          }
        });
        return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      }

      if (url.pathname === "/api/health") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return Response.json({ ok: true, service: "keydo", todoistConfigured: Boolean(todoist) });
      }

      if (url.pathname === "/api/config") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return Response.json({ todoist: { configured: Boolean(todoist) } });
      }

      if (url.pathname === "/src/task-view.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(taskViewFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/task-action-gate.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(taskActionGateFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/task-mutations.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(taskMutationsFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/task-capture.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(taskCaptureFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/task-attachments.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(taskAttachmentsFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/markdown.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(markdownFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/sync-coordinator.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(syncCoordinatorFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/sync-token.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(syncTokenFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/sync-runtime.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(syncRuntimeFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/cross-tab-lock.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(crossTabLockFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/src/fractional-indexing.js") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(fractionalIndexingFile, {
          headers: {
            "Content-Type": "text/javascript; charset=utf-8",
            "X-Content-Type-Options": "nosniff"
          }
        });
      }

      if (url.pathname === "/api/todoist/sync") {
        if (request.method !== "POST") return errorResponse("Method not allowed", 405);
        if (!todoist) return errorResponse("Todoist is not configured", 503);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Request body must be valid JSON", 400);
        }

        if (!isSyncRequest(body)) return errorResponse("Invalid Todoist Sync request", 400);

        const lockUse = holdOrderLockForRequest(request);
        if (lockUse.response) return lockUse.response;
        try {
          return Response.json(syncResponseForBrowser(await todoist.sync(body)), {
            headers: { "Cache-Control": "no-store" }
          });
        } catch (error) {
          if (error instanceof TodoistApiError) {
            return Response.json({ error: "Todoist API request failed", status: error.status, details: error.payload }, { status: 502 });
          }
          return errorResponse("Todoist Sync failed", 502);
        } finally {
          lockUse.release?.();
        }
      }

      if (url.pathname === "/api/todoist/tasks") {
        if (request.method !== "POST") return errorResponse("Method not allowed", 405);
        if (!todoist) return errorResponse("Todoist is not configured", 503);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Request body must be valid JSON", 400);
        }

        if (!isCreateTask(body)) return errorResponse("A task content is required", 400);

        const lockUse = holdOrderLockForRequest(request);
        if (lockUse.response) return lockUse.response;
        try {
          return Response.json(await todoist.createTask(body, body.command_uuid, body.temp_id, body.sync_token ?? "*"));
        } catch (error) {
          if (error instanceof TodoistCommandError) {
            return Response.json({ error: error.message, command_rejected: true, details: error.details }, { status: 422 });
          }
          if (error instanceof TodoistApiError) {
            return Response.json({ error: "Todoist API request failed", status: error.status, details: error.payload }, { status: 502 });
          }
          return errorResponse("Todoist task creation failed", 502);
        } finally {
          lockUse.release?.();
        }
      }

      if (url.pathname === "/api/todoist/task-order") {
        if (request.method !== "POST") return errorResponse("Method not allowed", 405);
        if (!todoist) return errorResponse("Todoist is not configured", 503);
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Request body must be valid JSON", 400);
        }
        if (!isTaskOrderUpdates(body)) return errorResponse("Invalid task order updates", 400);
        const lockUse = holdOrderLockForRequest(request);
        if (lockUse.response) return lockUse.response;
        try {
          const result = await todoist.updateTaskOrders(body.updates.map(update => ({ id: update.id, orderKey: update.order_key })), body.sync_token ?? "*");
          return Response.json({ ...result, ok: true });
        } catch (error) {
          if (error instanceof TodoistCommandError) {
            return Response.json({ error: error.message, command_rejected: true, details: error.details }, { status: 422 });
          }
          if (error instanceof TodoistApiError) {
            return Response.json({ error: "Todoist API request failed", status: error.status, details: error.payload }, { status: 502 });
          }
          return errorResponse("Todoist task ordering failed", 502);
        } finally {
          lockUse.release?.();
        }
      }

      const taskMutationMatch = url.pathname.match(/^\/api\/todoist\/tasks\/([^/]+)$/);
      if (taskMutationMatch) {
        if (request.method !== "POST") return errorResponse("Method not allowed", 405);
        if (!todoist) return errorResponse("Todoist is not configured", 503);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return errorResponse("Request body must be valid JSON", 400);
        }

        if (!isTaskMutation(body)) return errorResponse("Invalid Todoist task mutation", 400);
        let taskId: string;
        try {
          taskId = decodeURIComponent(taskMutationMatch[1]);
        } catch {
          return errorResponse("Invalid task id", 400);
        }
        if (!taskId) return errorResponse("Invalid task id", 400);

        const lockUse = holdOrderLockForRequest(request);
        if (lockUse.response) return lockUse.response;
        try {
          if (body.action === "reorder") {
            const result = await todoist.updateTaskOrder(taskId, body.order_key ?? "", body.sync_token ?? "*");
            return Response.json({ ...result, ok: true });
          }
          if (body.action === "complete") await todoist.completeTask(taskId);
          if (body.action === "reopen") await todoist.reopenTask(taskId);
          if (body.action === "delete") await todoist.deleteTask(taskId);
          if (body.action === "update") await todoist.updateTask(taskId, body.updates ?? {});
          if (body.action === "move") await todoist.moveTask(taskId, body.destination ?? {});
          return Response.json({ ok: true });
        } catch (error) {
          if (error instanceof TodoistCommandError) {
            return Response.json({ error: error.message, command_rejected: true, details: error.details }, { status: 422 });
          }
          if (error instanceof TodoistApiError) {
            return Response.json({ error: "Todoist API request failed", status: error.status, details: error.payload }, { status: 502 });
          }
          return errorResponse("Todoist task mutation failed", 502);
        } finally {
          lockUse.release?.();
        }
      }

      const attachmentMatch = url.pathname.match(/^\/api\/todoist\/tasks\/([^/]+)\/attachments$/);
      if (attachmentMatch) {
        if (request.method !== "POST") return errorResponse("Method not allowed", 405);
        if (!todoist) return errorResponse("Todoist is not configured", 503);

        let taskId: string;
        try {
          taskId = decodeURIComponent(attachmentMatch[1]);
        } catch {
          return errorResponse("Invalid task id", 400);
        }
        if (!taskId) return errorResponse("Invalid task id", 400);

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return errorResponse("Request body must be multipart form data", 400);
        }

        const file = form.get("file");
        if (!(file instanceof File) || file.size === 0) return errorResponse("An image file is required", 400);
        const imageType = normalizeRasterImageType(file.type);
        if (!imageType) return errorResponse("Only PNG, JPEG, GIF, and WebP uploads are supported", 400);
        if (file.size > 5 * 1024 * 1024) return errorResponse("Image exceeds the 5 MB limit", 413);
        if (!hasRasterImageSignature(imageType, await file.arrayBuffer())) return errorResponse("Image content does not match its file type", 400);

        const content = form.get("content");
        const lockUse = holdOrderLockForRequest(request);
        if (lockUse.response) return lockUse.response;
        try {
          const upload = await todoist.uploadFile(file, file.name || "pasted-screenshot.png");
          const comment = await todoist.createComment({
            task_id: taskId,
            content: typeof content === "string" && content ? content : "Screenshot attached from Keydo",
            attachment: {
              file_name: upload.file_name,
              file_type: upload.file_type,
              file_url: upload.file_url,
              resource_type: upload.resource_type ?? "file"
            }
          });
          return Response.json({
            comment,
            attachment: { name: upload.file_name, type: upload.file_type, url: upload.file_url, commentId: comment.id }
          });
        } catch (error) {
          if (error instanceof TodoistApiError) {
            return Response.json({ error: "Todoist API request failed", status: error.status, details: error.payload }, { status: 502 });
          }
          return errorResponse("Todoist attachment upload failed", 502);
        } finally {
          lockUse.release?.();
        }
      }

      const commentMatch = url.pathname.match(/^\/api\/todoist\/comments\/([^/]+)$/);
      if (commentMatch) {
        if (request.method !== "DELETE") return errorResponse("Method not allowed", 405);
        if (!todoist) return errorResponse("Todoist is not configured", 503);

        let commentId: string;
        try {
          commentId = decodeURIComponent(commentMatch[1]);
        } catch {
          return errorResponse("Invalid comment id", 400);
        }
        if (!commentId) return errorResponse("Invalid comment id", 400);

        const lockUse = holdOrderLockForRequest(request);
        if (lockUse.response) return lockUse.response;
        try {
          await todoist.deleteComment(commentId);
          return Response.json({ ok: true });
        } catch (error) {
          if (error instanceof TodoistApiError) {
            return Response.json({ error: "Todoist API request failed", status: error.status, details: error.payload }, { status: 502 });
          }
          return errorResponse("Todoist comment deletion failed", 502);
        } finally {
          lockUse.release?.();
        }
      }

      if (url.pathname === "/api/todoist/files") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        if (!todoist) return errorResponse("Todoist is not configured", 503);

        const upstream = url.searchParams.get("url") ?? "";
        let upstreamUrl: URL;
        try {
          upstreamUrl = new URL(upstream);
        } catch {
          return errorResponse("A valid file URL is required", 400);
        }
        if (upstreamUrl.protocol !== "https:"
          || upstreamUrl.hostname !== "files.todoist.com"
          || upstreamUrl.port !== ""
          || upstreamUrl.username !== ""
          || upstreamUrl.password !== "") {
          return errorResponse("Only Todoist-hosted files can be proxied", 400);
        }

        const fetcher = options.fetcher ?? fetch;
        try {
          const upstreamResponse = await fetcher(upstreamUrl.toString(), {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(30_000),
            redirect: "error"
          });
          if (!upstreamResponse.ok) {
            try { await upstreamResponse.body?.cancel(); } catch {}
            return errorResponse("Todoist file request failed", 502);
          }
          const contentType = upstreamResponse.headers.get("content-type") ?? "application/octet-stream";
          const imageType = normalizeRasterImageType(contentType);
          if (!imageType) {
            try { await upstreamResponse.body?.cancel(); } catch {}
            return errorResponse("Only image files can be proxied", 502);
          }
          const bytes = await readBoundedBody(upstreamResponse, 8 * 1024 * 1024);
          if (!bytes) {
            return errorResponse("Image exceeds the 8 MB limit", 502);
          }
          if (!hasRasterImageSignature(imageType, bytes)) return errorResponse("Image content does not match its file type", 502);
          return new Response(bytes.buffer as ArrayBuffer, {
            headers: {
              "Content-Type": imageType,
              "Cache-Control": "private, max-age=3600",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
              "Cross-Origin-Resource-Policy": "same-origin"
            }
          });
        } catch (error) {
          if (error instanceof TodoistApiError) {
            return Response.json({ error: "Todoist API request failed", status: error.status, details: error.payload }, { status: 502 });
          }
          return errorResponse("Todoist file request failed", 502);
        }
      }

      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (request.method !== "GET") return errorResponse("Method not allowed", 405);
        return new Response(indexFile, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
            "Content-Security-Policy": "frame-ancestors 'none'"
          }
        });
      }

      return new Response("Not found", { status: 404 });
    }
  });
}

if (import.meta.main) {
  const server = createServer();
  console.log(`Keydo listening on ${server.url}`);
}
