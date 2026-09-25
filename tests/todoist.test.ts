import { describe, expect, test } from "bun:test";
import { createTodoistClient, TodoistApiError, TodoistCommandError } from "../src/todoist";

describe("Todoist client", () => {
  test("defaults read syncs to all resources", async () => {
    let requestBody: URLSearchParams | undefined;
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        requestBody = init?.body as URLSearchParams;
        return Response.json({ sync_token: "next-token" });
      }
    });

    await client.sync({});
    expect(requestBody?.get("resource_types")).toBe('["all"]');
  });

  test("sends a form-encoded Sync request with bearer auth", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test/",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return Response.json({ sync_token: "next-token", full_sync: true });
      }
    });

    const result = await client.sync({ syncToken: "old-token", resourceTypes: ["items", "projects"] });

    expect(result.sync_token).toBe("next-token");
    expect(requestUrl).toBe("https://todoist.test/api/v1/sync");
    expect(requestInit?.method).toBe("POST");
    expect((requestInit?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    const body = requestInit?.body as URLSearchParams;
    expect(body.get("sync_token")).toBe("old-token");
    expect(body.get("resource_types")).toBe('["items","projects"]');
  });

  test("creates a task with an idempotent Sync item_add command", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        const body = init?.body as URLSearchParams;
        const command = JSON.parse(body.get("commands")!)[0];
        return Response.json({ sync_status: { [command.uuid]: "ok" }, temp_id_mapping: { [command.temp_id]: "task-1" } });
      }
    });

    const result = await client.createTask({ content: "Call Alex", description: "Created in Keydo", priority: 3, due_string: "tomorrow" }, "command-1", "temporary-1", "saved-read-cursor");

    expect(result.id).toBe("task-1");
    expect(requestUrl).toBe("https://todoist.test/api/v1/sync");
    expect(requestInit?.method).toBe("POST");
    const body = requestInit?.body as URLSearchParams;
    expect(body.get("sync_token")).toBe("saved-read-cursor");
    expect(body.get("resource_types")).toBeNull();
    expect(JSON.parse(body.get("commands")!)[0]).toEqual({
      type: "item_add",
      uuid: "command-1",
      temp_id: "temporary-1",
      args: { content: "Call Alex", description: "Created in Keydo", priority: 3, due: { string: "tomorrow" } }
    });
  });

  test("retries task creation with a full token only when the saved cursor is rejected", async () => {
    const requests: Array<{ token: string; uuid: string; resourceTypes: string | null }> = [];
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const command = JSON.parse(body.get("commands")!)[0];
        requests.push({ token: body.get("sync_token")!, uuid: command.uuid, resourceTypes: body.get("resource_types") });
        if (requests.length === 1) return Response.json({ error: "Invalid sync token" }, { status: 400 });
        return Response.json({ sync_status: { [command.uuid]: "ok" }, temp_id_mapping: { [command.temp_id]: "task-1" } });
      }
    });

    const result = await client.createTask({ content: "Call Alex" }, "stable-command", "stable-temp", "expired-cursor");

    expect(result.id).toBe("task-1");
    expect(requests).toEqual([
      { token: "expired-cursor", uuid: "stable-command", resourceTypes: null },
      { token: "*", uuid: "stable-command", resourceTypes: null }
    ]);
  });

  test("recognizes a structured invalid Sync-token argument response", async () => {
    const tokens: string[] = [];
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        tokens.push(body.get("sync_token")!);
        const command = JSON.parse(body.get("commands")!)[0];
        if (tokens.length === 1) {
          return Response.json({
            error: "Invalid argument value",
            error_code: 20,
            error_extra: { argument: "sync_token" },
            error_tag: "INVALID_ARGUMENT_VALUE",
            http_code: 400
          }, { status: 400 });
        }
        return Response.json({ sync_status: { [command.uuid]: "ok" }, temp_id_mapping: { [command.temp_id]: "task-1" } });
      }
    });

    await expect(client.createTask({ content: "Call Alex" }, "stable-command", "stable-temp", "stale-cursor"))
      .resolves.toMatchObject({ id: "task-1" });
    expect(tokens).toEqual(["stale-cursor", "*"]);
  });

  test("does not treat an unrelated HTTP 400 as a stale Sync cursor", async () => {
    let requests = 0;
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async () => {
        requests += 1;
        return Response.json({ error: "Invalid project id" }, { status: 400 });
      }
    });

    await expect(client.createTask({ content: "Call Alex" }, "stable-command", "stable-temp", "saved-cursor"))
      .rejects.toMatchObject({ name: "TodoistApiError", status: 400 });
    expect(requests).toBe(1);
  });

  test("retries an ambiguous create with the same command and temporary IDs", async () => {
    const attemptedIds: Array<[string, string]> = [];
    let attempts = 0;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const command = JSON.parse(body.get("commands")!)[0];
        attemptedIds.push([command.uuid, command.temp_id]);
        if (attempts++ === 0) throw new Error("connection dropped after server accepted command");
        return Response.json({ sync_status: { [command.uuid]: "ok" }, temp_id_mapping: { [command.temp_id]: "task-1" } });
      }
    });

    await expect(client.createTask({ content: "Call Alex" }, "stable-command", "stable-temp")).resolves.toMatchObject({ id: "task-1" });
    expect(attemptedIds).toEqual([["stable-command", "stable-temp"], ["stable-command", "stable-temp"]]);
  });

  test("keeps an ambiguity retry available after falling back from a stale create cursor", async () => {
    const attempts: Array<{ token: string; uuid: string; tempId: string }> = [];
    let call = 0;
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const command = JSON.parse(body.get("commands")!)[0];
        attempts.push({ token: body.get("sync_token")!, uuid: command.uuid, tempId: command.temp_id });
        call += 1;
        if (call === 1) throw new Error("connection reset");
        if (call === 2) return Response.json({ error: "Invalid sync token" }, { status: 400 });
        if (call === 3) throw new Error("connection reset after fallback request");
        return Response.json({ sync_status: { [command.uuid]: "ok" }, temp_id_mapping: { [command.temp_id]: "task-1" } });
      }
    });

    await expect(client.createTask({ content: "Call Alex" }, "stable-command", "stable-temp", "stale-cursor")).resolves.toMatchObject({ id: "task-1" });
    expect(attempts.map(attempt => attempt.token)).toEqual(["stale-cursor", "stale-cursor", "*", "*"]);
    expect(new Set(attempts.map(attempt => attempt.uuid))).toEqual(new Set(["stable-command"]));
    expect(new Set(attempts.map(attempt => attempt.tempId))).toEqual(new Set(["stable-temp"]));
  });

  test("replays the same create command after every response in an attempt is ambiguous", async () => {
    const attemptedIds: Array<[string, string]> = [];
    let attempts = 0;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const command = JSON.parse(body.get("commands")!)[0];
        attemptedIds.push([command.uuid, command.temp_id]);
        if (attempts++ < 2) throw new Error("response lost after Todoist may have accepted command");
        return Response.json({ sync_status: { [command.uuid]: "ok" }, temp_id_mapping: { [command.temp_id]: "task-1" } });
      }
    });

    await expect(client.createTask({ content: "Call Alex" }, "stable-command", "stable-temp")).rejects.toThrow();
    await expect(client.createTask({ content: "Call Alex" }, "stable-command", "stable-temp")).resolves.toMatchObject({ id: "task-1" });
    expect(attemptedIds).toEqual(Array(3).fill(["stable-command", "stable-temp"]));
  });

  test("updates a task", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(null, { status: 204 });
      }
    });

    await client.updateTask("task-1", { priority: 4, due_string: "tomorrow" });

    expect(requestUrl).toBe("https://todoist.test/api/v1/tasks/task-1");
    expect(requestInit?.method).toBe("POST");
    expect(JSON.parse(String(requestInit?.body))).toEqual({ priority: 4, due_string: "tomorrow" });
  });

  test("accepts a successful Sync order command response without resource arrays", async () => {
    let requestUrl = "";
    let requestBody: URLSearchParams | undefined;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestBody = init?.body as URLSearchParams;
        const command = JSON.parse(requestBody.get("commands")!)[0];
        return Response.json({ sync_token: "next-token", sync_status: { [command.uuid]: "ok" } });
      }
    });

    const result = await client.updateTaskOrder("task-1", "a0V", "saved-sync-token");

    expect(result.sync_status).toBeDefined();
    expect(requestUrl).toBe("https://todoist.test/api/v1/sync");
    expect(requestBody?.get("sync_token")).toBe("saved-sync-token");
    expect(requestBody?.get("resource_types")).toBeNull();
    expect(JSON.parse(requestBody!.get("commands")!)[0]).toMatchObject({
      type: "item_update",
      args: { id: "task-1", order_key: "a0V" }
    });
  });

  test("does not replay an order command with a full cursor after Todoist rejects the saved cursor", async () => {
    const requests: Array<{ token: string; commandId: string }> = [];
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const command = JSON.parse(body.get("commands")!)[0];
        requests.push({ token: body.get("sync_token")!, commandId: command.uuid });
        if (requests.length === 1) return Response.json({ error: "Invalid sync token" }, { status: 400 });
        return Response.json({ sync_status: { [command.uuid]: "ok" } });
      }
    });

    await expect(client.updateTaskOrder("task-1", "a0V", "stale-cursor")).rejects.toMatchObject({ name: "TodoistApiError", status: 400 });
    expect(requests.map(request => request.token)).toEqual(["stale-cursor"]);
  });

  test("throws when Todoist rejects an order command", async () => {
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const command = JSON.parse(body.get("commands")!)[0];
        return Response.json({ sync_status: { [command.uuid]: "error: Invalid order key" } });
      }
    });
    await expect(client.updateTaskOrder("task-1", "bad")).rejects.toMatchObject({
      name: "TodoistCommandError",
      details: "error: Invalid order key"
    });
  });

  test("keeps explicit create command rejection details instead of treating them as ambiguous", async () => {
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const command = JSON.parse(body.get("commands")!)[0];
        return Response.json({ sync_status: { [command.uuid]: "error: invalid project" } });
      }
    });

    const error = await client.createTask({ content: "Call Alex" }, "create-command-2", "create-temp-2").catch(reason => reason);
    expect(error).toBeInstanceOf(TodoistCommandError);
    expect(error).toMatchObject({ details: "error: invalid project" });
  });

  test("normalizes sibling ordering with item_update order_key commands", async () => {
    let requestBody: URLSearchParams | undefined;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (_input, init) => {
        requestBody = init?.body as URLSearchParams;
        const commands = JSON.parse(requestBody.get("commands")!);
        return Response.json({ sync_token: "next-token", sync_status: Object.fromEntries(commands.map((command: { uuid: string }) => [command.uuid, "ok"])) });
      }
    });

    const result = await client.updateTaskOrders([{ id: "task-1", orderKey: "a0" }, { id: "task-2", orderKey: "a1" }], "saved-sync-token");

    expect(result.sync_status).toBeDefined();
    expect(requestBody?.get("sync_token")).toBe("saved-sync-token");
    expect(requestBody?.get("resource_types")).toBeNull();
    expect(JSON.parse(requestBody!.get("commands")!)).toEqual([
      expect.objectContaining({ type: "item_update", args: { id: "task-1", order_key: "a0" } }),
      expect.objectContaining({ type: "item_update", args: { id: "task-2", order_key: "a1" } })
    ]);
  });

  test("rejects a partially rejected sibling order-key batch", async () => {
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const commands = JSON.parse((init?.body as URLSearchParams).get("commands")!);
        return Response.json({ sync_status: { [commands[0].uuid]: "ok", [commands[1].uuid]: "error: invalid key" } });
      }
    });
    await expect(client.updateTaskOrders([{ id: "task-1", orderKey: "a0" }, { id: "task-2", orderKey: "a1" }])).rejects.toThrow("one or more");
  });

  test("continues later order batches after per-command rejection using the returned cursor", async () => {
    const batches: Array<{ token: string; size: number }> = [];
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const commands = JSON.parse(body.get("commands")!);
        const index = batches.length;
        batches.push({ token: body.get("sync_token")!, size: commands.length });
        const syncStatus = Object.fromEntries(commands.map((command: { uuid: string }, commandIndex: number) => [
          command.uuid,
          index === 0 && commandIndex === 0 ? "error: task no longer exists" : "ok"
        ]));
        return Response.json({ sync_token: `cursor-${index + 1}`, sync_status: syncStatus });
      }
    });

    const updates = Array.from({ length: 101 }, (_, index) => ({ id: `task-${index}`, orderKey: `a${index}` }));
    await expect(client.updateTaskOrders(updates, "saved-cursor")).rejects.toThrow("one or more");
    expect(batches).toEqual([
      { token: "saved-cursor", size: 100 },
      { token: "cursor-1", size: 1 }
    ]);
  });

  test("stops order batches when Todoist rejects the write cursor", async () => {
    const requests: Array<{ token: string; commandIds: string[] }> = [];
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const commands = JSON.parse(body.get("commands")!);
        const token = body.get("sync_token")!;
        requests.push({ token, commandIds: commands.map((command: { uuid: string }) => command.uuid) });
        if (token === "stale-cursor") return Response.json({ error: "Invalid sync token" }, { status: 400 });
        const nextToken = "after-final-batch";
        return Response.json({ sync_token: nextToken, sync_status: Object.fromEntries(commands.map((command: { uuid: string }) => [command.uuid, "ok"])) });
      }
    });

    await expect(client.updateTaskOrders(
      Array.from({ length: 101 }, (_, index) => ({ id: `task-${index}`, orderKey: `a${index}` })),
      "stale-cursor"
    )).rejects.toMatchObject({ name: "TodoistApiError", status: 400 });

    expect(requests.map(request => request.token)).toEqual(["stale-cursor"]);
    expect(requests[0].commandIds).toHaveLength(100);
  });

  test("stops later order batches after a command-level rate limit", async () => {
    let requests = 0;
    let limitedCommandId = "";
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        requests += 1;
        const commands = JSON.parse((init?.body as URLSearchParams).get("commands")!);
        limitedCommandId = commands[0].uuid;
        const syncStatus = Object.fromEntries(commands.map((command: { uuid: string }, index: number) => [
          command.uuid,
          index === 0
            ? { http_code: 429, error_tag: "RATE_LIMIT_EXCEEDED", error_extra: { retry_after: 5 } }
            : "ok"
        ]));
        return Response.json({ sync_token: "cursor-after-limited-batch", sync_status: syncStatus });
      }
    });

    const error = await client.updateTaskOrders(
      Array.from({ length: 101 }, (_, index) => ({ id: `task-${index}`, orderKey: `a${index}` })),
      "saved-cursor"
    ).catch(reason => reason);

    expect(error).toMatchObject({
      name: "TodoistCommandError",
      details: [{ uuid: limitedCommandId, result: { http_code: 429, error_extra: { retry_after: 5 } } }]
    });
    expect(requests).toBe(1);
  });

  test("retries an ambiguous sibling order write with the same command UUIDs", async () => {
    const attempts: Array<{ commandIds: string[]; syncToken: string }> = [];
    let attempt = 0;
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const commands = JSON.parse(body.get("commands")!);
        attempts.push({ commandIds: commands.map((command: { uuid: string }) => command.uuid), syncToken: body.get("sync_token")! });
        if (attempt++ === 0) throw new Error("connection reset after request");
        return Response.json({ sync_status: Object.fromEntries(commands.map((command: { uuid: string }) => [command.uuid, "ok"])) });
      }
    });

    await client.updateTaskOrders([{ id: "task-1", orderKey: "a0" }, { id: "task-2", orderKey: "a1" }], "saved-cursor");
    expect(attempts).toHaveLength(2);
    expect(attempts[1].commandIds).toEqual(attempts[0].commandIds);
    expect(attempts.map(request => request.syncToken)).toEqual(["saved-cursor", "saved-cursor"]);
  });

  test("retries an ambiguous later order batch with its UUIDs and the preceding batch cursor", async () => {
    const attempts: Array<{ syncToken: string; commandIds: string[] }> = [];
    let requestCount = 0;
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const commands = JSON.parse(body.get("commands")!);
        attempts.push({ syncToken: body.get("sync_token")!, commandIds: commands.map((command: { uuid: string }) => command.uuid) });
        requestCount += 1;
        if (requestCount === 2) throw new Error("connection reset after final batch was applied");
        return Response.json({
          sync_token: requestCount === 1 ? "after-first-batch" : "after-final-batch",
          sync_status: Object.fromEntries(commands.map((command: { uuid: string }) => [command.uuid, "ok"]))
        });
      }
    });

    const updates = Array.from({ length: 101 }, (_, index) => ({ id: `task-${index}`, orderKey: `a${index}` }));
    const result = await client.updateTaskOrders(updates, "saved-cursor");

    expect(result.sync_token).toBe("after-final-batch");
    expect(attempts).toHaveLength(3);
    expect(attempts.map(attempt => attempt.syncToken)).toEqual(["saved-cursor", "after-first-batch", "after-first-batch"]);
    expect(attempts[2].commandIds).toEqual(attempts[1].commandIds);
  });

  test("chunks normalized sibling writes at Todoist's 100-command limit and chains write cursors", async () => {
    const batches: Array<{ syncToken: string; commands: Array<{ uuid: string }> }> = [];
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        const commands = JSON.parse(body.get("commands")!);
        batches.push({ syncToken: body.get("sync_token")!, commands });
        const batchIndex = batches.length;
        return Response.json({
          sync_token: `write-cursor-${batchIndex}`,
          sync_status: Object.fromEntries(commands.map((command: { uuid: string }) => [command.uuid, "ok"]))
        });
      }
    });

    const updates = Array.from({ length: 205 }, (_, index) => ({ id: `task-${index}`, orderKey: `a${index}` }));
    const result = await client.updateTaskOrders(updates, "read-cursor");

    expect(batches.map(batch => batch.commands.length)).toEqual([100, 100, 5]);
    expect(batches.map(batch => batch.syncToken)).toEqual(["read-cursor", "write-cursor-1", "write-cursor-2"]);
    expect(result.sync_token).toBe("write-cursor-3");
  });

  test("does not send another order chunk without the preceding write cursor", async () => {
    let requests = 0;
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async (_input, init) => {
        requests += 1;
        const commands = JSON.parse((init?.body as URLSearchParams).get("commands")!);
        return Response.json({ sync_status: Object.fromEntries(commands.map((command: { uuid: string }) => [command.uuid, "ok"])) });
      }
    });

    const updates = Array.from({ length: 101 }, (_, index) => ({ id: `task-${index}`, orderKey: `a${index}` }));
    await expect(client.updateTaskOrders(updates, "read-cursor")).rejects.toThrow("missing its sync token");
    expect(requests).toBe(1);
  });

  test("closes and reopens tasks", async () => {
    const paths: string[] = [];
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async input => {
        paths.push(String(input));
        return new Response(null, { status: 204 });
      }
    });

    await client.completeTask("task-1");
    await client.reopenTask("task-1");

    expect(paths).toEqual(["https://api.todoist.com/api/v1/tasks/task-1/close", "https://api.todoist.com/api/v1/tasks/task-1/reopen"]);
  });

  test("deletes a task", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(null, { status: 204 });
      }
    });

    await client.deleteTask("task-1");

    expect(requestUrl).toBe("https://todoist.test/api/v1/tasks/task-1");
    expect(requestInit?.method).toBe("DELETE");
  });

  test("moves a task under a new parent", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return Response.json({ id: "task-1" });
      }
    });

    await client.moveTask("task-1", { parent_id: "task-0" });

    expect(requestUrl).toBe("https://todoist.test/api/v1/tasks/task-1/move");
    expect(requestInit?.method).toBe("POST");
    expect(JSON.parse(String(requestInit?.body))).toEqual({ parent_id: "task-0" });
  });

  test("returns null for an empty 200 body", async () => {
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async () => new Response(null, { status: 200 })
    });

    await expect(client.completeTask("task-1")).resolves.toBeNull();
  });

  test("uploads a file as multipart form data", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return Response.json({ file_url: "https://files.todoist.test/shot.png", file_name: "shot.png", file_size: 4, file_type: "image/png", resource_type: "file" });
      }
    });

    const upload = await client.uploadFile(new Blob(["bytes"], { type: "image/png" }), "shot.png");

    expect(requestUrl).toBe("https://todoist.test/api/v1/uploads");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.body).toBeInstanceOf(FormData);
    expect(upload.file_url).toBe("https://files.todoist.test/shot.png");
  });

  test("creates and deletes comments", async () => {
    const seen: Array<{ url: string; method?: string; body?: unknown }> = [];
    const client = createTodoistClient({
      token: "test-token",
      apiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        seen.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (String(input).endsWith("/comments")) return Response.json({ id: "comment-1", content: "Screenshot" });
        return new Response(null, { status: 204 });
      }
    });

    const comment = await client.createComment({ task_id: "task-1", content: "Screenshot", attachment: { file_name: "shot.png", file_type: "image/png", file_url: "https://files.todoist.test/shot.png", resource_type: "file" } });
    await client.deleteComment("comment-1");

    expect(comment.id).toBe("comment-1");
    expect(seen[0]).toMatchObject({ url: "https://todoist.test/api/v1/comments", method: "POST" });
    expect(seen[0].body).toMatchObject({ task_id: "task-1" });
    expect(seen[1]).toMatchObject({ url: "https://todoist.test/api/v1/comments/comment-1", method: "DELETE" });
  });

  test("wraps API errors", async () => {
    const client = createTodoistClient({
      token: "test-token",
      fetcher: async () => Response.json({ error: "unauthorized" }, { status: 401 })
    });

    await expect(client.sync({})).rejects.toBeInstanceOf(TodoistApiError);
  });

  test("aborts a Todoist request when its configured timeout expires", async () => {
    let abortObserved = false;
    const client = createTodoistClient({
      token: "test-token",
      timeoutMs: 5,
      fetcher: async (_input, init) => await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          abortObserved = true;
          reject(init.signal?.reason);
        }, { once: true });
      })
    });

    await expect(client.sync({})).rejects.toThrow();
    expect(abortObserved).toBe(true);
  });
});
