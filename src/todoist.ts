const TODOIST_MAX_SYNC_COMMANDS = 100;

export type TodoistSyncRequest = {
  syncToken?: string;
  resourceTypes?: string[];
  commands?: TodoistCommand[];
};

export type TodoistCommand = {
  type: string;
  uuid: string;
  temp_id?: string;
  args?: Record<string, unknown>;
};

export type TodoistSyncResponse = {
  sync_token: string;
  full_sync?: boolean;
  full_sync_date_utc?: string | null;
  [resource: string]: unknown;
};

export type TodoistTaskUpdate = {
  content?: string;
  description?: string;
  labels?: string[];
  priority?: number;
  due_string?: string;
  due_date?: string;
  due_datetime?: string;
  due_lang?: string;
  assignee_id?: number | null;
  duration?: number | null;
  duration_unit?: string | null;
  deadline_date?: string | null;
  child_order?: number;
  day_order?: number;
  is_collapsed?: boolean;
};

export type TodoistTaskCreate = {
  content: string;
  description?: string;
  labels?: string[];
  priority?: number;
  parent_id?: string;
  project_id?: string | null;
  due_string?: string;
  due_date?: string;
};

export type TodoistTaskMove = {
  parent_id?: string | null;
  project_id?: string | null;
  section_id?: string | null;
};

export type TodoistFileUpload = {
  file_url: string;
  file_name: string;
  file_size: number;
  file_type: string;
  resource_type: string;
  image?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  upload_state?: string;
};

export type TodoistCommentAttachment = {
  file_name: string;
  file_type: string;
  file_url: string;
  resource_type: string;
};

export type TodoistComment = {
  id: string;
  content: string;
  file_attachment?: (TodoistCommentAttachment & { file_size?: number; upload_state?: string }) | null;
  is_deleted?: boolean;
  posted_at?: string;
};

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class TodoistApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(status: number, payload: unknown) {
    super(`Todoist API request failed with status ${status}`);
    this.name = "TodoistApiError";
    this.status = status;
    this.payload = payload;
  }
}

export class TodoistCommandError extends Error {
  readonly details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.name = "TodoistCommandError";
    this.details = details;
  }
}

function isInvalidSyncTokenError(error: unknown): error is TodoistApiError {
  if (!(error instanceof TodoistApiError) || error.status !== 400) return false;
  const payload = error.payload;
  if (payload && typeof payload === "object") {
    const extra = (payload as Record<string, unknown>).error_extra;
    if (extra && typeof extra === "object" && (extra as Record<string, unknown>).argument === "sync_token") return true;
  }
  const text = (typeof payload === "string" ? payload : JSON.stringify(payload ?? ""))
    .toLowerCase()
    .replaceAll("_", " ");
  return /(invalid|expired|stale|unknown|rejected).{0,40}sync token|sync token.{0,40}(invalid|expired|stale|unknown|rejected)/.test(text);
}

export type TodoistClientOptions = {
  token: string;
  apiBase?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
};

export function createTodoistClient(options: TodoistClientOptions) {
  const apiBase = (options.apiBase ?? "https://api.todoist.com").replace(/\/$/, "");
  const fetcher = options.fetcher ?? fetch;

  async function parseJsonBody(response: Response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetcher(`${apiBase}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(options.timeoutMs ?? 30_000),
      headers: {
        Authorization: `Bearer ${options.token}`,
        ...(init.method && init.method !== "GET" ? { "X-Request-Id": crypto.randomUUID() } : {}),
        ...(init.headers ?? {})
      }
    });

    if (!response.ok) {
      const payload = await parseJsonBody(response).catch(() => null);
      throw new TodoistApiError(response.status, payload);
    }

    if (response.status === 204) return null;
    return parseJsonBody(response) as Promise<unknown>;
  }

  function syncRequest(payload: TodoistSyncRequest) {
    const body = new URLSearchParams({ sync_token: payload.syncToken ?? "*" });
    if (payload.resourceTypes !== undefined) body.set("resource_types", JSON.stringify(payload.resourceTypes));
    // Reads default to all resources; write-only command requests should
    // omit resource_types so they do not ask Todoist for a full snapshot.
    else if (!payload.commands) body.set("resource_types", JSON.stringify(["all"]));

    if (payload.commands) body.set("commands", JSON.stringify(payload.commands));

    return request("/api/v1/sync", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }) as Promise<TodoistSyncResponse>;
  }

  async function executeSyncCommands(syncToken: string, commands: TodoistCommand[], { retryInvalidSyncToken = true } = {}) {
    let token = syncToken;
    let cursorFallbackUsed = token === "*";
    let ambiguousRetries = 0;
    while (true) {
      try {
        return await syncRequest({ syncToken: token, commands });
      } catch (error) {
        if (retryInvalidSyncToken && !cursorFallbackUsed && isInvalidSyncTokenError(error)) {
          // The cursor can become stale after a preflight read (for example,
          // another Todoist client changed the account state). Reuse the
          // command UUIDs with a full cursor; Todoist's UUID idempotency makes
          // this safe if the first response was lost after processing.
          token = "*";
          cursorFallbackUsed = true;
          ambiguousRetries = 0;
          continue;
        }
        if (error instanceof TodoistApiError && error.status < 500) throw error;
        if (ambiguousRetries >= 1) throw error;
        ambiguousRetries += 1;
      }
    }
  }

  return {
    sync(payload: TodoistSyncRequest) {
      return syncRequest(payload);
    },

    quickAddTask(text: string) {
      return request("/api/v1/tasks/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, meta: true })
      });
    },

    getCompletedTasks(since: string, until: string) {
      const params = new URLSearchParams({ since, until, limit: "100" });
      return request(`/api/v1/tasks/completed/by_completion_date?${params}`, { method: "GET" });
    },

    async createTask(task: TodoistTaskCreate, uuid: string = crypto.randomUUID(), tempId: string = crypto.randomUUID(), syncToken = "*") {
      const args: Record<string, unknown> = { content: task.content };
      if (task.description !== undefined) args.description = task.description;
      if (task.priority !== undefined) args.priority = task.priority;
      if (task.parent_id !== undefined) args.parent_id = task.parent_id;
      if (task.project_id !== undefined) args.project_id = task.project_id;
      if (task.labels !== undefined) args.labels = task.labels;
      if (task.due_string !== undefined || task.due_date !== undefined) {
        args.due = task.due_string !== undefined ? { string: task.due_string } : { date: task.due_date };
      }

      const commands = [{ type: "item_add", uuid, temp_id: tempId, args }];
      const result = await executeSyncCommands(syncToken, commands);
      const syncStatus = (result?.sync_status as Record<string, unknown> | undefined)?.[uuid];
      if (syncStatus !== undefined && syncStatus !== "ok") {
        throw new TodoistCommandError("Todoist rejected the task creation command", syncStatus);
      }
      const id = (result?.temp_id_mapping as Record<string, unknown> | undefined)?.[tempId];
      if (syncStatus === "ok" && typeof id === "string" && id) return { ...result, id };
      throw new Error("Todoist task creation response is missing its command result or task ID");
    },

    updateTask(taskId: string, updates: TodoistTaskUpdate) {
      return request(`/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
    },

    async updateTaskOrder(taskId: string, orderKey: string, syncToken = "*") {
      const uuid = crypto.randomUUID();
      const result = await executeSyncCommands(syncToken, [{ type: "item_update", uuid, args: { id: taskId, order_key: orderKey } }], { retryInvalidSyncToken: false });
      const syncStatus = result.sync_status as Record<string, unknown> | undefined;
      if (syncStatus?.[uuid] !== "ok") {
        throw new TodoistCommandError("Todoist rejected the task order update", syncStatus?.[uuid] ?? null);
      }
      return result;
    },

    async updateTaskOrders(updates: Array<{ id: string; orderKey: string }>, syncToken = "*") {
      const commands = updates.map(({ id, orderKey }) => ({
        type: "item_update",
        uuid: crypto.randomUUID(),
        args: { id, order_key: orderKey }
      }));
      let nextSyncToken = syncToken;
      let result: TodoistSyncResponse | null = null;
      const rejectedCommands: Array<{ uuid: string; result: unknown }> = [];
      for (let offset = 0; offset < commands.length; offset += TODOIST_MAX_SYNC_COMMANDS) {
        const batch = commands.slice(offset, offset + TODOIST_MAX_SYNC_COMMANDS);
        result = null;
        result = await executeSyncCommands(nextSyncToken, batch, { retryInvalidSyncToken: false });
        if (!result) throw new Error("Todoist task order response is missing");
        const syncStatus = result.sync_status as Record<string, unknown> | undefined;
        for (const command of batch) {
          if (syncStatus?.[command.uuid] !== "ok") {
            rejectedCommands.push({ uuid: command.uuid, result: syncStatus?.[command.uuid] ?? null });
          }
        }
        // A command-level rate limit is definitive for this batch. Avoid
        // immediately submitting later chunks into the same rate limit; the
        // caller will reconcile any earlier/partial writes before retrying.
        const batchWasRateLimited = batch.some(command => {
          const status = syncStatus?.[command.uuid];
          return Boolean(status && typeof status === "object" && (status as Record<string, unknown>).http_code === 429);
        });
        if (batchWasRateLimited) {
          throw new TodoistCommandError("Todoist rate limited one or more task order updates", rejectedCommands);
        }
        if (offset + TODOIST_MAX_SYNC_COMMANDS < commands.length) {
          if (typeof result.sync_token !== "string" || !result.sync_token) {
            throw new Error("Todoist task order response is missing its sync token");
          }
          nextSyncToken = result.sync_token;
        }
      }
      if (!result) throw new Error("Todoist task order response is missing");
      if (rejectedCommands.length) {
        throw new TodoistCommandError("Todoist rejected one or more task order updates", rejectedCommands);
      }
      return result;
    },

    completeTask(taskId: string) {
      return request(`/api/v1/tasks/${encodeURIComponent(taskId)}/close`, { method: "POST" });
    },

    reopenTask(taskId: string) {
      return request(`/api/v1/tasks/${encodeURIComponent(taskId)}/reopen`, { method: "POST" });
    },

    deleteTask(taskId: string) {
      return request(`/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
    },

    moveTask(taskId: string, destination: TodoistTaskMove) {
      return request(`/api/v1/tasks/${encodeURIComponent(taskId)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(destination)
      });
    },

    uploadFile(file: Blob, fileName: string, projectId?: string) {
      const form = new FormData();
      form.set("file", file, fileName);
      if (projectId) form.set("project_id", projectId);
      return request("/api/v1/uploads", {
        method: "POST",
        body: form
      }) as Promise<TodoistFileUpload>;
    },

    createComment(input: { task_id: string; content: string; attachment?: TodoistCommentAttachment }) {
      return request("/api/v1/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      }) as Promise<TodoistComment>;
    },

    deleteComment(commentId: string) {
      return request(`/api/v1/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
    }
  };
}
