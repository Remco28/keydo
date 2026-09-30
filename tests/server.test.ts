import { describe, expect, test } from "bun:test";
import { createServer } from "../src/server";
import { withServerOrderLock } from "../src/cross-tab-lock.js";

async function appRequest(server: ReturnType<typeof createServer>, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase()) && !headers.has("Origin")) {
    headers.set("Origin", new URL(server.url).origin);
  }
  let lockReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (path.startsWith("/api/todoist/") && path !== "/api/todoist/order-lock" && !headers.has("X-Keydo-Order-Lock")) {
    const lockResponse = await fetch(new URL("/api/todoist/order-lock", server.url), { method: "POST", headers: { Origin: new URL(server.url).origin } });
    lockReader = lockResponse.body!.getReader();
    const lockLine = new TextDecoder().decode((await lockReader.read()).value).trim();
    const token = lockLine.match(/^locked ([a-f0-9-]+)$/)?.[1];
    if (!token) throw new Error("Test server did not grant an order-lock token");
    headers.set("X-Keydo-Order-Lock", token);
  }
  try {
    return await fetch(new URL(path, server.url), { ...init, headers });
  } finally {
    await lockReader?.cancel().catch(() => {});
  }
}

describe("Keydo server", () => {
  test("reports health", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      const response = await fetch(new URL("/api/health", server.url));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, service: "keydo", todoistConfigured: false });
    } finally {
      server.stop(true);
    }
  });

  test("rejects unconfigured Host headers even when their Origin matches", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      const attackerHost = `attacker.test:${server.port}`;
      const response = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST",
        headers: { Host: attackerHost, Origin: `http://${attackerHost}` }
      });
      expect(response.status).toBe(421);
      expect(await response.json()).toEqual({ error: "Unrecognized host" });
    } finally {
      server.stop(true);
    }
  });

  test("accepts an explicitly configured hostname alias", async () => {
    const server = createServer({ port: 0, allowedHosts: ["keydo.test"], todoistToken: "" });
    try {
      const response = await fetch(new URL("/api/health", server.url), {
        headers: { Host: `keydo.test:${server.port}` }
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, service: "keydo", todoistConfigured: false });
    } finally {
      server.stop(true);
    }
  });

  test("accepts operator and Tailscale hostname environment aliases", async () => {
    const previousAllowedHosts = Bun.env.KEYDO_ALLOWED_HOSTS;
    const previousTailscaleHosts = Bun.env.KEYDO_TAILSCALE_HOSTS;
    Bun.env.KEYDO_ALLOWED_HOSTS = "operator.keydo.test";
    Bun.env.KEYDO_TAILSCALE_HOSTS = "node.tailnet.test";
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      for (const hostname of ["operator.keydo.test", "node.tailnet.test"]) {
        const response = await fetch(new URL("/api/health", server.url), {
          headers: { Host: `${hostname}:${server.port}` }
        });
        expect(response.status).toBe(200);
      }
    } finally {
      server.stop(true);
      if (previousAllowedHosts === undefined) delete Bun.env.KEYDO_ALLOWED_HOSTS;
      else Bun.env.KEYDO_ALLOWED_HOSTS = previousAllowedHosts;
      if (previousTailscaleHosts === undefined) delete Bun.env.KEYDO_TAILSCALE_HOSTS;
      else Bun.env.KEYDO_TAILSCALE_HOSTS = previousTailscaleHosts;
    }
  });

  test("uses validated Tailscale Serve forwarding headers only on a loopback backend", async () => {
    const server = createServer({
      port: 0,
      allowedHosts: ["keydo.tailnet.test"],
      trustTailscaleServe: true,
      todoistToken: ""
    });
    try {
      const host = `127.0.0.1:${server.port}`;
      const response = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST",
        headers: {
          Host: host,
          Origin: "https://keydo.tailnet.test",
          "X-Forwarded-Host": "keydo.tailnet.test",
          "X-Forwarded-Proto": "https"
        }
      });
      expect(response.status).toBe(200);
      await response.body?.cancel();

      const forgedForwardedHost = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST",
        headers: {
          Host: host,
          Origin: "https://attacker.test",
          "X-Forwarded-Host": "attacker.test",
          "X-Forwarded-Proto": "https"
        }
      });
      expect(forgedForwardedHost.status).toBe(421);

      const insecureForwardedProto = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST",
        headers: {
          Host: host,
          Origin: "https://keydo.tailnet.test",
          "X-Forwarded-Host": "keydo.tailnet.test",
          "X-Forwarded-Proto": "http"
        }
      });
      expect(insecureForwardedProto.status).toBe(421);
    } finally {
      server.stop(true);
    }
  });

  test("refuses Tailscale Serve trust on a non-loopback bind", () => {
    expect(() => createServer({ hostname: "0.0.0.0", trustTailscaleServe: true }))
      .toThrow("Tailscale Serve trust requires Keydo to bind to a loopback hostname");
  });

  test("reports connection status without exposing credentials", async () => {
    const server = createServer({ port: 0, todoistToken: "server-only-token" });
    try {
      const response = await fetch(new URL("/api/config", server.url));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ todoist: { configured: true } });
    } finally {
      server.stop(true);
    }
  });

  test("rejects cross-origin Todoist writes before contacting Todoist", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => { upstreamCalled = true; return Response.json({ id: "task-1" }); }
    });
    try {
      const response = await fetch(new URL("/api/todoist/tasks", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://attacker.test" },
        body: JSON.stringify({ content: "Forged task" })
      });
      expect(response.status).toBe(403);
      const missingOriginResponse = await fetch(new URL("/api/todoist/tasks", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Forged task" })
      });
      expect(missingOriginResponse.status).toBe(403);
      const crossSchemeOrigin = new URL(server.url);
      crossSchemeOrigin.protocol = crossSchemeOrigin.protocol === "https:" ? "http:" : "https:";
      const crossSchemeResponse = await fetch(new URL("/api/todoist/tasks", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: crossSchemeOrigin.origin },
        body: JSON.stringify({ content: "Forged task" })
      });
      expect(crossSchemeResponse.status).toBe(403);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("serves the task action gate module", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      const response = await fetch(new URL("/src/task-action-gate.js", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/javascript");
      expect(await response.text()).toContain("createTaskActionGate");
    } finally {
      server.stop(true);
    }
  });

  test("serves the task mutations module", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      const response = await fetch(new URL("/src/task-mutations.js", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/javascript");
      expect(await response.text()).toContain("restoreTaskOrderFields");
    } finally {
      server.stop(true);
    }
  });

  test("serves the task capture module", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      const response = await fetch(new URL("/src/task-capture.js", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/javascript");
      expect(await response.text()).toContain("resolveCaptureProject");
    } finally {
      server.stop(true);
    }
  });

  test("serves the task attachments module", async () => {
    const server = createServer({ port: 0 });
    try {
      const response = await fetch(new URL("/src/task-attachments.js", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/javascript");
      expect(await response.text()).toContain("noteAttachmentsByItem");
    } finally {
      server.stop(true);
    }
  });

  test("serves the Markdown renderer module", async () => {
    const server = createServer({ port: 0 });
    try {
      const response = await fetch(new URL("/src/markdown.js", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/javascript");
      expect(await response.text()).toContain("renderMarkdown");
    } finally {
      server.stop(true);
    }
  });

  test("serves the sync coordinator module", async () => {
    const server = createServer({ port: 0 });
    try {
      const response = await fetch(new URL("/src/sync-coordinator.js", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/javascript");
      expect(await response.text()).toContain("createSyncCoordinator");
    } finally {
      server.stop(true);
    }
  });

  test("serves the sync token helper module", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      const response = await fetch(new URL("/src/sync-token.js", server.url));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("readOrderSyncToken");
    } finally {
      server.stop(true);
    }
  });

  test("serves the cross-tab order lock module", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      const response = await fetch(new URL("/src/cross-tab-lock.js", server.url));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("withCrossTabOrderLock");
    } finally {
      server.stop(true);
    }
  });

  test("serves the background sync lifecycle module", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      const response = await fetch(new URL("/src/sync-runtime.js", server.url));
      expect(response.status).toBe(200);
      const source = await response.text();
      expect(source).toContain("backgroundSyncAction");
      expect(source).toContain("createCoalescedSyncRunner");
    } finally {
      server.stop(true);
    }
  });

  test("holds a server order lock until its streaming request is cancelled", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    const firstController = new AbortController();
    const secondController = new AbortController();
    try {
      const firstResponse = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST",
        headers: { Origin: new URL(server.url).origin },
        signal: firstController.signal
      });
      expect(firstResponse.status).toBe(200);
      const firstReader = firstResponse.body!.getReader();
      const firstChunk = await firstReader.read();
      expect(new TextDecoder().decode(firstChunk.value).trim()).toMatch(/^locked [a-f0-9-]+$/);

      let secondAcquired = false;
      const secondResponsePromise = fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST",
        headers: { Origin: new URL(server.url).origin },
        signal: secondController.signal
      }).then(async response => {
        secondAcquired = true;
        return { response, reader: response.body!.getReader() };
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(secondAcquired).toBe(false);

      firstController.abort();
      await firstReader.cancel().catch(() => {});
      const second = await secondResponsePromise;
      expect(second.response.status).toBe(200);
      expect(new TextDecoder().decode((await second.reader.read()).value).trim()).toMatch(/^locked [a-f0-9-]+$/);
      secondController.abort();
      await second.reader.cancel().catch(() => {});
    } finally {
      firstController.abort();
      secondController.abort();
      server.stop(true);
    }
  });

  test("removes a cancelled queued lock request before granting the next caller", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    const firstController = new AbortController();
    const queuedController = new AbortController();
    const nextController = new AbortController();
    let firstReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let nextReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const first = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST", headers: { Origin: new URL(server.url).origin }, signal: firstController.signal
      });
      firstReader = first.body!.getReader();
      expect(new TextDecoder().decode((await firstReader.read()).value).trim()).toMatch(/^locked [a-f0-9-]+$/);

      const queuedRequest = fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST", headers: { Origin: new URL(server.url).origin }, signal: queuedController.signal
      }).then(response => ({ response }), error => ({ error }));
      await new Promise(resolve => setTimeout(resolve, 10));
      queuedController.abort();
      const queuedResult = await queuedRequest;
      expect("error" in queuedResult).toBe(true);

      firstController.abort();
      await firstReader.cancel().catch(() => {});
      const next = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST", headers: { Origin: new URL(server.url).origin }, signal: nextController.signal
      });
      expect(next.status).toBe(200);
      nextReader = next.body!.getReader();
      expect(new TextDecoder().decode((await nextReader.read()).value).trim()).toMatch(/^locked [a-f0-9-]+$/);
    } finally {
      firstController.abort();
      queuedController.abort();
      nextController.abort();
      await firstReader?.cancel().catch(() => {});
      await nextReader?.cancel().catch(() => {});
      server.stop(true);
    }
  });

  test("keeps a Sync snapshot inside its shared order-lock lease", async () => {
    let upstreamStarted!: () => void;
    const upstreamReady = new Promise<void>(resolve => { upstreamStarted = resolve; });
    let finishUpstream!: () => void;
    const upstreamGate = new Promise<void>(resolve => { finishUpstream = resolve; });
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => {
        upstreamStarted();
        await upstreamGate;
        return Response.json({ sync_token: "next", items: [] });
      }
    });
    const firstController = new AbortController();
    const nextController = new AbortController();
    let firstReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let nextReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const firstLock = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST", headers: { Origin: new URL(server.url).origin }, signal: firstController.signal
      });
      firstReader = firstLock.body!.getReader();
      const token = new TextDecoder().decode((await firstReader.read()).value).trim().match(/^locked ([a-f0-9-]+)$/)?.[1];
      expect(token).toBeTruthy();

      const snapshot = fetch(new URL("/api/todoist/sync", server.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: new URL(server.url).origin,
          "X-Keydo-Order-Lock": token!
        },
        body: JSON.stringify({ syncToken: "cursor-1", resourceTypes: ["items"] })
      });
      await upstreamReady;
      firstController.abort();
      await firstReader.cancel().catch(() => {});

      let nextAcquired = false;
      const nextLockPromise = fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST", headers: { Origin: new URL(server.url).origin }, signal: nextController.signal
      }).then(response => {
        nextAcquired = true;
        nextReader = response.body!.getReader();
        return response;
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(nextAcquired).toBe(false);

      finishUpstream();
      expect((await snapshot).status).toBe(200);
      const nextLock = await nextLockPromise;
      expect(nextLock.status).toBe(200);
      expect(new TextDecoder().decode((await nextReader!.read()).value).trim()).toMatch(/^locked [a-f0-9-]+$/);
    } finally {
      finishUpstream();
      firstController.abort();
      nextController.abort();
      await firstReader?.cancel().catch(() => {});
      await nextReader?.cancel().catch(() => {});
      server.stop(true);
    }
  });

  test("releases an accepted lock request after an upstream Sync failure", async () => {
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { throw new Error("Todoist unavailable"); }
    });
    const firstController = new AbortController();
    const nextController = new AbortController();
    let firstReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let nextReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const firstLock = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST", headers: { Origin: new URL(server.url).origin }, signal: firstController.signal
      });
      firstReader = firstLock.body!.getReader();
      const firstToken = new TextDecoder().decode((await firstReader.read()).value).trim().match(/^locked ([a-f0-9-]+)$/)?.[1];
      expect(firstToken).toBeTruthy();

      const failedSync = await fetch(new URL("/api/todoist/sync", server.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: new URL(server.url).origin,
          "X-Keydo-Order-Lock": firstToken!
        },
        body: JSON.stringify({ syncToken: "cursor-1", resourceTypes: ["items"] })
      });
      expect(failedSync.status).toBe(502);

      firstController.abort();
      await firstReader.cancel().catch(() => {});
      const nextLock = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST",
        headers: { Origin: new URL(server.url).origin },
        signal: AbortSignal.any([nextController.signal, AbortSignal.timeout(1000)])
      });
      expect(nextLock.status).toBe(200);
      nextReader = nextLock.body!.getReader();
      expect(new TextDecoder().decode((await nextReader.read()).value).trim()).toMatch(/^locked [a-f0-9-]+$/);
    } finally {
      firstController.abort();
      nextController.abort();
      await firstReader?.cancel().catch(() => {});
      await nextReader?.cancel().catch(() => {});
      server.stop(true);
    }
  });

  test("keeps an accepted structural write fenced after its lock stream disconnects", async () => {
    let upstreamStarted!: () => void;
    const upstreamReady = new Promise<void>(resolve => { upstreamStarted = resolve; });
    let finishUpstream!: () => void;
    const upstreamGate = new Promise<void>(resolve => { finishUpstream = resolve; });
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => {
        upstreamStarted();
        await upstreamGate;
        return new Response(null, { status: 204 });
      }
    });
    const lockController = new AbortController();
    const nextLockController = new AbortController();
    let firstReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let nextReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const firstLock = await fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST", headers: { Origin: new URL(server.url).origin }, signal: lockController.signal
      });
      firstReader = firstLock.body!.getReader();
      const firstLine = new TextDecoder().decode((await firstReader.read()).value).trim();
      const firstToken = firstLine.match(/^locked ([a-f0-9-]+)$/)?.[1];
      expect(firstToken).toBeTruthy();

      const mutation = fetch(new URL("/api/todoist/tasks/task-1", server.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: new URL(server.url).origin,
          "X-Keydo-Order-Lock": firstToken!
        },
        body: JSON.stringify({ action: "delete" })
      });
      await upstreamReady;

      lockController.abort();
      await firstReader.cancel().catch(() => {});
      let nextAcquired = false;
      const nextLockPromise = fetch(new URL("/api/todoist/order-lock", server.url), {
        method: "POST", headers: { Origin: new URL(server.url).origin }, signal: nextLockController.signal
      }).then(response => {
        nextAcquired = true;
        nextReader = response.body!.getReader();
        return response;
      });
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(nextAcquired).toBe(false);

      finishUpstream();
      expect((await mutation).status).toBe(200);
      const nextLock = await nextLockPromise;
      expect(nextLock.status).toBe(200);
      const nextToken = new TextDecoder().decode((await nextReader!.read()).value).trim().match(/^locked ([a-f0-9-]+)$/)?.[1];
      expect(nextToken).toBeTruthy();

      const staleMutation = await fetch(new URL("/api/todoist/tasks/task-1", server.url), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: new URL(server.url).origin,
          "X-Keydo-Order-Lock": firstToken!
        },
        body: JSON.stringify({ action: "delete" })
      });
      expect(staleMutation.status).toBe(409);
    } finally {
      finishUpstream();
      lockController.abort();
      nextLockController.abort();
      await firstReader?.cancel().catch(() => {});
      await nextReader?.cancel().catch(() => {});
      server.stop(true);
    }
  });

  test("serializes independent lock clients around their complete order operations", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    let finishFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { finishFirst = resolve; });
    const order: string[] = [];
    const lockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("Origin", new URL(server.url).origin);
      return fetch(new URL(String(input), server.url), { ...init, headers });
    };
    try {
      const first = withServerOrderLock(async () => {
        order.push("first-start");
        await firstGate;
        order.push("first-end");
      }, lockFetch);
      const second = withServerOrderLock(() => { order.push("second"); }, lockFetch);

      await new Promise(resolve => setTimeout(resolve, 10));
      expect(order).toEqual(["first-start"]);
      finishFirst();
      await Promise.all([first, second]);
      expect(order).toEqual(["first-start", "first-end", "second"]);
    } finally {
      finishFirst();
      server.stop(true);
    }
  });

  test("proxies a configured Sync request", async () => {
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async (input, init) => {
        expect(String(input)).toBe("https://todoist.test/api/v1/sync");
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer server-only-token");
        return Response.json({ sync_token: "next-token", full_sync: true, items: [] });
      },
      todoistApiBase: "https://todoist.test"
    });
    try {
      const response = await appRequest(server, "/api/todoist/sync", { method: "POST", body: JSON.stringify({ syncToken: "*", resourceTypes: ["items"] }) });
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ sync_token: "next-token", full_sync: true, items: [] });
    } finally {
      server.stop(true);
    }
  });

  test("strips credentials from the Todoist user resource before returning Sync data", async () => {
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => Response.json({
        sync_token: "next-token",
        items: [],
        user: {
          email: "private@example.test",
          token: "private-user-token",
          access_token: "private-access-token",
          refresh_token: "private-refresh-token",
          tz_info: { timezone: "America/Los_Angeles" }
        }
      })
    });
    try {
      const response = await appRequest(server, "/api/todoist/sync", {
        method: "POST",
        body: JSON.stringify({ syncToken: "*", resourceTypes: ["items", "user"] })
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.user).toEqual({ tz_info: { timezone: "America/Los_Angeles" } });
      expect(JSON.stringify(payload)).not.toContain("private-user-token");
      expect(JSON.stringify(payload)).not.toContain("private-access-token");
      expect(JSON.stringify(payload)).not.toContain("private-refresh-token");
      expect(JSON.stringify(payload)).not.toContain("private@example.test");
    } finally {
      server.stop(true);
    }
  });

  test("uses TODOIST_API_BASE from the environment when no option overrides it", async () => {
    const previousBase = Bun.env.TODOIST_API_BASE;
    Bun.env.TODOIST_API_BASE = "https://custom-todoist.test";
    let requestUrl = "";
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async input => { requestUrl = String(input); return Response.json({ sync_token: "next", items: [] }); }
    });
    try {
      const response = await appRequest(server, "/api/todoist/sync", {
        method: "POST",
        body: JSON.stringify({ syncToken: "*", resourceTypes: ["items"] })
      });
      expect(response.status).toBe(200);
      expect(requestUrl).toBe("https://custom-todoist.test/api/v1/sync");
    } finally {
      server.stop(true);
      if (previousBase === undefined) delete Bun.env.TODOIST_API_BASE;
      else Bun.env.TODOIST_API_BASE = previousBase;
    }
  });

  test("rejects arbitrary Sync commands before contacting Todoist", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return Response.json({ sync_token: "next", sync_status: {} }); }
    });
    try {
      const response = await fetch(new URL("/api/todoist/sync", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: new URL(server.url).origin },
        body: JSON.stringify({ syncToken: "*", commands: [{ type: "item_update", uuid: "cmd", args: { id: "task-1", order_key: "a0" } }] })
      });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("rejects unsupported Sync request fields before contacting Todoist", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return Response.json({ sync_token: "next", items: [] }); }
    });
    try {
      const response = await fetch(new URL("/api/todoist/sync", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: new URL(server.url).origin },
        body: JSON.stringify({ syncToken: "*", resourceTypes: ["items"], includeDeleted: true })
      });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("rejects non-object Sync request bodies before contacting Todoist", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return Response.json({ sync_token: "next", items: [] }); }
    });
    try {
      const response = await appRequest(server, "/api/todoist/sync", {
        method: "POST",
        body: JSON.stringify([])
      });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("requires a live order-lock token for Sync snapshots", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return Response.json({ sync_token: "next", items: [] }); }
    });
    try {
      const response = await fetch(new URL("/api/todoist/sync", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: new URL(server.url).origin },
        body: JSON.stringify({ syncToken: "cursor-1", resourceTypes: ["items"] })
      });
      expect(response.status).toBe(409);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("proxies task creation", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        const body = init?.body as URLSearchParams;
        expect(body.get("sync_token")).toBe("saved-read-cursor");
        expect(body.get("resource_types")).toBeNull();
        const command = JSON.parse(body.get("commands")!)[0];
        return Response.json({ sync_status: { [command.uuid]: "ok" }, temp_id_mapping: { [command.temp_id]: "task-1" } });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks", { method: "POST", body: JSON.stringify({ content: "Call Alex", description: "Created in Keydo", priority: 3, parent_id: "parent-1", project_id: "project-1", due_string: "tomorrow", command_uuid: "stable-command", temp_id: "stable-temp", sync_token: "saved-read-cursor" }) });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: "task-1" });
      expect(requestUrl).toBe("https://todoist.test/api/v1/sync");
      const syncBody = requestInit?.body as URLSearchParams;
      expect(JSON.parse(syncBody.get("commands")!)[0]).toEqual({
        type: "item_add",
        uuid: "stable-command",
        temp_id: "stable-temp",
        args: { content: "Call Alex", description: "Created in Keydo", priority: 3, parent_id: "parent-1", project_id: "project-1", due: { string: "tomorrow" } }
      });
    } finally {
      server.stop(true);
    }
  });

  test("returns explicit task command rejections as a definitive client error", async () => {
    let upstreamCalls = 0;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async (_input, init) => {
        upstreamCalls += 1;
        const command = JSON.parse(((init?.body as URLSearchParams).get("commands"))!)[0];
        return Response.json({ sync_status: { [command.uuid]: "error: invalid project" } });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks", {
        method: "POST",
        body: JSON.stringify({ content: "Call Alex", command_uuid: "command-1", temp_id: "temp-1" })
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        command_rejected: true,
        details: "error: invalid project"
      });
      expect(upstreamCalls).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("preserves Todoist 429 retry metadata through the task-create proxy", async () => {
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => Response.json({ error_tag: "RATE_LIMIT_EXCEEDED", error_extra: { retry_after: 4 } }, { status: 429 })
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks", {
        method: "POST",
        body: JSON.stringify({ content: "Call Alex", command_uuid: "command-429", temp_id: "temp-429" })
      });
      expect(response.status).toBe(502);
      const payload = await response.json();
      expect(payload.status).toBe(429);
      expect(payload.details).toMatchObject({ error_extra: { retry_after: 4 } });
    } finally {
      server.stop(true);
    }
  });

  test("preserves Sync command-level rate-limit details through the task-create proxy", async () => {
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async (_input, init) => {
        const command = JSON.parse(((init?.body as URLSearchParams).get("commands"))!)[0];
        return Response.json({
          sync_status: {
            [command.uuid]: { http_code: 429, error_tag: "RATE_LIMIT_EXCEEDED", error_extra: { retry_after: 3 } }
          }
        });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks", {
        method: "POST",
        body: JSON.stringify({ content: "Call Alex", command_uuid: "command-sync-429", temp_id: "temp-sync-429" })
      });
      expect(response.status).toBe(422);
      const payload = await response.json();
      expect(payload.command_rejected).toBe(true);
      expect(payload.details).toMatchObject({ http_code: 429, error_extra: { retry_after: 3 } });
    } finally {
      server.stop(true);
    }
  });

  test("requires a live order-lock token for task creation", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return Response.json({}); }
    });
    try {
      const response = await fetch(new URL("/api/todoist/tasks", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: new URL(server.url).origin },
        body: JSON.stringify({ content: "Unfenced task" })
      });
      expect(response.status).toBe(409);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test.each(["section_id", "order", "order_key", "day_order"])("rejects unsupported task-create field %s instead of silently dropping it", async field => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return Response.json({}); }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks", {
        method: "POST",
        body: JSON.stringify({ content: "Call Alex", [field]: "unhandled" })
      });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("rejects task creation with conflicting due_string and due_date values", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return Response.json({}); }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks", {
        method: "POST",
        body: JSON.stringify({ content: "Call Alex", due_string: "tomorrow", due_date: "2026-09-27" })
      });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test.each([["priority", 5], ["labels", "work"]])("rejects malformed task-create field %s before contacting Todoist", async (field, value) => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return Response.json({}); }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks", {
        method: "POST",
        body: JSON.stringify({ content: "Call Alex", [field]: value })
      });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("proxies supported task update fields", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(null, { status: 204 });
      }
    });
    try {
      const updates = {
        priority: 3,
        due_string: "tomorrow",
        due_datetime: "2026-09-27T09:00:00Z",
        due_lang: "en",
        child_order: 6,
        day_order: 2,
        assignee_id: null,
        duration: 30,
        duration_unit: "minute",
        deadline_date: null,
        is_collapsed: true
      };
      const response = await appRequest(server, "/api/todoist/tasks/task-1", { method: "POST", body: JSON.stringify({ action: "update", updates }) });
      expect(response.status).toBe(200);
      expect(requestUrl).toBe("https://todoist.test/api/v1/tasks/task-1");
      expect(JSON.parse(String(requestInit?.body))).toEqual(updates);
    } finally {
      server.stop(true);
    }
  });

  test.each(["order_key", "parent_id", "project_id", "section_id"])("rejects unsupported structural task field %s on the generic update route", async field => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => { upstreamCalled = true; return new Response(null, { status: 204 }); }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks/task-1", {
        method: "POST",
        body: JSON.stringify({ action: "update", updates: { [field]: field === "order_key" ? "a0V" : "value" } })
      });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test.each([
    { action: "update", updates: { content: "Renamed" }, destination: { project_id: "p" } },
    { action: "move", destination: { project_id: "p" }, project_id: "p" },
    { action: "reorder", order_key: "a0", sync_token: "cursor", updates: [] },
    { action: "delete", force: true }
  ])("rejects unexpected top-level task mutation fields", async payload => {
    const server = createServer({ port: 0, todoistToken: "server-only-token" });
    try {
      const response = await appRequest(server, "/api/todoist/tasks/task-1", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test.each([["priority", 5], ["labels", "work"], ["day_order", "2"]])("rejects malformed task-update field %s before contacting Todoist", async (field, value) => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => { upstreamCalled = true; return new Response(null, { status: 204 }); }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks/task-1", {
        method: "POST",
        body: JSON.stringify({ action: "update", updates: { [field]: value } })
      });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("requires a live order-lock token for non-structural task updates", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => { upstreamCalled = true; return new Response(null, { status: 204 }); }
    });
    try {
      const response = await fetch(new URL("/api/todoist/tasks/task-1", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: new URL(server.url).origin },
        body: JSON.stringify({ action: "update", updates: { priority: 3 } })
      });
      expect(response.status).toBe(409);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("requires an order-lock token for due-date updates that can change day order", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return new Response(null, { status: 204 }); }
    });
    try {
      const response = await fetch(new URL("/api/todoist/tasks/task-1", server.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: new URL(server.url).origin },
        body: JSON.stringify({ action: "update", updates: { due_string: "today" } })
      });
      expect(response.status).toBe(409);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("proxies task ordering through a Sync command", async () => {
    let requestUrl = "";
    let commandArgs: Record<string, unknown> | undefined;
    let syncToken = "";
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        const body = init?.body as URLSearchParams;
        syncToken = body.get("sync_token") ?? "";
        const command = JSON.parse(body.get("commands")!)[0];
        commandArgs = command.args;
        return Response.json({
          sync_token: "next-sync-token",
          sync_status: { [command.uuid]: "ok" },
          items: [{ id: "task-1", order_key: "corrected-order-key" }]
        });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks/task-1", {
        method: "POST",
        body: JSON.stringify({ action: "reorder", order_key: "a0V", sync_token: "saved-sync-token" })
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        sync_token: "next-sync-token",
        sync_status: expect.any(Object),
        items: [{ id: "task-1", order_key: "corrected-order-key" }],
        ok: true
      });
      expect(requestUrl).toBe("https://todoist.test/api/v1/sync");
      expect(syncToken).toBe("saved-sync-token");
      expect(commandArgs).toEqual({ id: "task-1", order_key: "a0V" });
    } finally {
      server.stop(true);
    }
  });

  test("proxies normalized sibling order keys as Sync item_update commands", async () => {
    let syncToken = "";
    let commands: Array<{ type: string; uuid: string; args: Record<string, unknown> }> = [];
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (_input, init) => {
        const body = init?.body as URLSearchParams;
        syncToken = body.get("sync_token") ?? "";
        commands = JSON.parse(body.get("commands")!);
        return Response.json({ sync_token: "next-token", sync_status: Object.fromEntries(commands.map(command => [command.uuid, "ok"])) });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/task-order", {
        method: "POST",
        body: JSON.stringify({ updates: [{ id: "task-1", order_key: "a0" }, { id: "task-2", order_key: "a1" }], sync_token: "saved-sync-token" })
      });
      expect(response.status).toBe(200);
      expect((await response.json()).sync_token).toBe("next-token");
      expect(syncToken).toBe("saved-sync-token");
      expect(commands).toHaveLength(2);
      expect(commands.map(command => [command.type, command.args])).toEqual([
        ["item_update", { id: "task-1", order_key: "a0" }],
        ["item_update", { id: "task-2", order_key: "a1" }]
      ]);
    } finally {
      server.stop(true);
    }
  });

  test("surfaces a rejected order cursor so the client can reload before retrying", async () => {
    let requests = 0;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => {
        requests += 1;
        return Response.json({ error: "Invalid sync token" }, { status: 400 });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/task-order", {
        method: "POST",
        body: JSON.stringify({ updates: [{ id: "task-1", order_key: "a0V" }], sync_token: "stale-cursor" })
      });

      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "Todoist API request failed",
        status: 400,
        details: { error: "Invalid sync token" }
      });
      expect(requests).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("stops a multi-batch task order request at a command-level rate limit", async () => {
    let upstreamCalls = 0;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async (_input, init) => {
        upstreamCalls += 1;
        const commands = JSON.parse(((init?.body as URLSearchParams).get("commands"))!);
        const syncStatus = Object.fromEntries(commands.map((command: { uuid: string }, index: number) => [
          command.uuid,
          index === 0
            ? { http_code: 429, error_tag: "RATE_LIMIT_EXCEEDED", error_extra: { retry_after: 6 } }
            : "ok"
        ]));
        return Response.json({ sync_token: "write-cursor-1", sync_status: syncStatus });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/task-order", {
        method: "POST",
        body: JSON.stringify({
          updates: Array.from({ length: 101 }, (_, index) => ({ id: `task-${index}`, order_key: `a${index}` }))
        })
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        command_rejected: true,
        details: [{ result: { http_code: 429, error_extra: { retry_after: 6 } } }]
      });
      expect(upstreamCalls).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("rejects duplicate task IDs in a normalized order batch before contacting Todoist", async () => {
    let upstreamCalls = 0;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => {
        upstreamCalls += 1;
        return Response.json({ sync_status: {} });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/task-order", {
        method: "POST",
        body: JSON.stringify({ updates: [{ id: "task-1", order_key: "a0" }, { id: "task-1", order_key: "a1" }] })
      });
      expect(response.status).toBe(400);
      expect(upstreamCalls).toBe(0);
    } finally {
      server.stop(true);
    }
  });

  test.each([
    { extra: true, updates: [{ id: "task-1", order_key: "a0" }] },
    { updates: [{ id: "task-1", order_key: "a0", child_order: 1 }] }
  ])("rejects ignored task-order payload fields before contacting Todoist", async body => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return Response.json({}); }
    });
    try {
      const response = await appRequest(server, "/api/todoist/task-order", { method: "POST", body: JSON.stringify(body) });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("proxies task deletion", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(null, { status: 204 });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks/task-1", { method: "POST", body: JSON.stringify({ action: "delete" }) });
      expect(response.status).toBe(200);
      expect(requestUrl).toBe("https://todoist.test/api/v1/tasks/task-1");
      expect(requestInit?.method).toBe("DELETE");
    } finally {
      server.stop(true);
    }
  });

  test("proxies a task move", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return Response.json({ id: "task-1" });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks/task-1", { method: "POST", body: JSON.stringify({ action: "move", destination: { parent_id: "task-0" } }) });
      expect(response.status).toBe(200);
      expect(requestUrl).toBe("https://todoist.test/api/v1/tasks/task-1/move");
      expect(JSON.parse(String(requestInit?.body))).toEqual({ parent_id: "task-0" });
    } finally {
      server.stop(true);
    }
  });

  test("proxies a task move that updates project, section, and parent together", async () => {
    let requestInit: RequestInit | undefined;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (_input, init) => { requestInit = init; return Response.json({ id: "task-1" }); }
    });
    try {
      const destination = { project_id: "project-b", section_id: "section-b", parent_id: "task-parent" };
      const response = await appRequest(server, "/api/todoist/tasks/task-1", { method: "POST", body: JSON.stringify({ action: "move", destination }) });
      expect(response.status).toBe(200);
      expect(JSON.parse(String(requestInit?.body))).toEqual(destination);
    } finally {
      server.stop(true);
    }
  });

  test("rejects an empty task move", async () => {
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => Response.json({ id: "task-1" })
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks/task-1", { method: "POST", body: JSON.stringify({ action: "move", destination: {} }) });
      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("rejects a null parent move without another destination", async () => {
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => Response.json({ id: "task-1" })
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks/task-1", {
        method: "POST",
        body: JSON.stringify({ action: "move", destination: { parent_id: null } })
      });
      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("rejects Sync when Todoist is not configured", async () => {
    const server = createServer({ port: 0, todoistToken: "" });
    try {
      const response = await appRequest(server, "/api/todoist/sync", { method: "POST", body: "{}" });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Todoist is not configured" });
    } finally {
      server.stop(true);
    }
  });

  test("rejects non-GET health and config requests", async () => {
    const server = createServer({ port: 0 });
    try {
      expect((await fetch(new URL("/api/health", server.url), { method: "POST" })).status).toBe(405);
      expect((await fetch(new URL("/api/config", server.url), { method: "POST" })).status).toBe(405);
    } finally {
      server.stop(true);
    }
  });

  test("rejects non-GET app shell requests", async () => {
    const server = createServer({ port: 0 });
    try {
      expect((await fetch(server.url, { method: "POST" })).status).toBe(405);
    } finally {
      server.stop(true);
    }
  });

  test("rejects a malformed task id", async () => {
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => Response.json({ ok: true })
    });
    try {
      const response = await appRequest(server, "/api/todoist/tasks/%E0", { method: "POST", body: JSON.stringify({ action: "delete" }) });
      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("uploads an attachment and comments on the task", async () => {
    const seen: Array<{ url: string; method?: string }> = [];
    let commentBody: Record<string, unknown> | undefined;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        seen.push({ url: String(input), method: init?.method });
        if (String(input).endsWith("/api/v1/uploads")) {
          return Response.json({ file_url: "https://files.todoist.test/shot.png", file_name: "shot.png", file_size: 4, file_type: "image/png", resource_type: "file" });
        }
        commentBody = JSON.parse(String(init?.body));
        return Response.json({ id: "comment-1", content: "Screenshot attached from Keydo" });
      }
    });
    try {
      const form = new FormData();
      form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "shot.png", { type: "image/png" }));
      const response = await appRequest(server, "/api/todoist/tasks/task-1/attachments", { method: "POST", body: form });
      expect(response.status).toBe(200);
      expect(seen.map(entry => entry.url)).toEqual(["https://todoist.test/api/v1/uploads", "https://todoist.test/api/v1/comments"]);
      expect(commentBody).toMatchObject({ task_id: "task-1" });
      expect(await response.json()).toMatchObject({ attachment: { url: "https://files.todoist.test/shot.png", commentId: "comment-1" } });
    } finally {
      server.stop(true);
    }
  });

  test("rejects non-image attachments", async () => {
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => Response.json({})
    });
    try {
      const form = new FormData();
      form.set("file", new File(["bytes"], "notes.txt", { type: "text/plain" }));
      const response = await appRequest(server, "/api/todoist/tasks/task-1/attachments", { method: "POST", body: form });
      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("rejects SVG attachment uploads", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => { upstreamCalled = true; return Response.json({}); }
    });
    try {
      const form = new FormData();
      form.set("file", new File(["<svg xmlns=\"http://www.w3.org/2000/svg\"/>"] , "image.svg", { type: "image/svg+xml" }));
      const response = await appRequest(server, "/api/todoist/tasks/task-1/attachments", { method: "POST", body: form });
      expect(response.status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("requires a live order-lock token for attachment uploads", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => { upstreamCalled = true; return Response.json({}); }
    });
    try {
      const form = new FormData();
      form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "shot.png", { type: "image/png" }));
      const response = await fetch(new URL("/api/todoist/tasks/task-1/attachments", server.url), {
        method: "POST",
        headers: { Origin: new URL(server.url).origin },
        body: form
      });
      expect(response.status).toBe(409);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("rejects image uploads whose bytes do not match the declared raster type", async () => {
    const server = createServer({ port: 0, todoistToken: "server-only-token", fetcher: async () => Response.json({}) });
    try {
      const form = new FormData();
      form.set("file", new File(["not a png"], "fake.png", { type: "image/png" }));
      const response = await appRequest(server, "/api/todoist/tasks/task-1/attachments", { method: "POST", body: form });
      expect(response.status).toBe(400);
    } finally {
      server.stop(true);
    }
  });

  test("deletes a comment", async () => {
    let requestUrl = "";
    let requestMethod: string | undefined;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestMethod = init?.method;
        return new Response(null, { status: 204 });
      }
    });
    try {
      const response = await appRequest(server, "/api/todoist/comments/comment-1", { method: "DELETE" });
      expect(response.status).toBe(200);
      expect(requestUrl).toBe("https://todoist.test/api/v1/comments/comment-1");
      expect(requestMethod).toBe("DELETE");
    } finally {
      server.stop(true);
    }
  });

  test("requires a live order-lock token for comment deletion", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async () => { upstreamCalled = true; return new Response(null, { status: 204 }); }
    });
    try {
      const response = await fetch(new URL("/api/todoist/comments/comment-1", server.url), {
        method: "DELETE",
        headers: { Origin: new URL(server.url).origin }
      });
      expect(response.status).toBe(409);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("proxies Todoist-hosted images with auth", async () => {
    let requestUrl = "";
    let authHeader: string | undefined;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      todoistApiBase: "https://todoist.test",
      fetcher: async (input, init) => {
        requestUrl = String(input);
        authHeader = (init?.headers as Record<string, string> | undefined)?.Authorization;
        return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "Content-Type": "image/png" } });
      }
    });
    try {
      const fileUrl = "https://files.todoist.com/abc/file.png";
      const response = await fetch(new URL(`/api/todoist/files?url=${encodeURIComponent(fileUrl)}`, server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(requestUrl).toBe(fileUrl);
      expect(authHeader).toBe("Bearer server-only-token");
      expect((await response.arrayBuffer()).byteLength).toBe(8);
    } finally {
      server.stop(true);
    }
  });

  test("does not follow redirects from Todoist file URLs", async () => {
    let requestCount = 0;
    let redirectMode: RequestRedirect | undefined;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async (_input, init) => {
        requestCount += 1;
        redirectMode = init?.redirect;
        if (redirectMode === "error") throw new TypeError("redirect disallowed");
        return Response.redirect("https://example.invalid/private", 302);
      }
    });
    try {
      const fileUrl = "https://files.todoist.com/abc/file.png";
      const response = await fetch(new URL(`/api/todoist/files?url=${encodeURIComponent(fileUrl)}`, server.url));
      expect(response.status).toBe(502);
      expect(redirectMode).toBe("error");
      expect(requestCount).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("refuses to proxy SVG files", async () => {
    let cancelled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Type": "image/svg+xml" } })
    });
    try {
      const fileUrl = "https://files.todoist.com/abc/file.svg";
      const response = await fetch(new URL(`/api/todoist/files?url=${encodeURIComponent(fileUrl)}`, server.url));
      expect(response.status).toBe(502);
      expect(cancelled).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("cancels failed upstream file responses", async () => {
    let cancelled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 503 })
    });
    try {
      const fileUrl = "https://files.todoist.com/abc/file.png";
      const response = await fetch(new URL(`/api/todoist/files?url=${encodeURIComponent(fileUrl)}`, server.url));
      expect(response.status).toBe(502);
      expect(cancelled).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("stops reading a proxied image once it exceeds the size limit", async () => {
    let cancelled = false;
    const largeChunk = new Uint8Array(4 * 1024 * 1024);
    const upstreamBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(largeChunk);
      },
      cancel() {
        cancelled = true;
      }
    });
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => new Response(upstreamBody, { headers: { "Content-Type": "image/png" } })
    });
    try {
      const fileUrl = "https://files.todoist.com/abc/large.png";
      const response = await fetch(new URL(`/api/todoist/files?url=${encodeURIComponent(fileUrl)}`, server.url));
      expect(response.status).toBe(502);
      expect(cancelled).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("enforces a request body cap before parsing oversized requests", async () => {
    const server = createServer({ port: 0 });
    try {
      const body = new Uint8Array(5 * 1024 * 1024 + 64 * 1024 + 1);
      const response = await appRequest(server, "/api/todoist/sync", { method: "POST", body });
      expect(response.status).toBe(413);
    } finally {
      server.stop(true);
    }
  });

  test("refuses to proxy non-Todoist URLs", async () => {
    let upstreamCalled = false;
    const server = createServer({
      port: 0,
      todoistToken: "server-only-token",
      fetcher: async () => { upstreamCalled = true; return new Response(null, { status: 200 }); }
    });
    try {
      expect((await fetch(new URL("/api/todoist/files?url=https%3A%2F%2Fevil.test%2Fx.png", server.url))).status).toBe(400);
      expect((await fetch(new URL(`/api/todoist/files?url=${encodeURIComponent("https://files.todoist.com:8443/x.png")}`, server.url))).status).toBe(400);
      expect((await fetch(new URL(`/api/todoist/files?url=${encodeURIComponent("https://user:pass@files.todoist.com/x.png")}`, server.url))).status).toBe(400);
      expect((await fetch(new URL("/api/todoist/files", server.url))).status).toBe(400);
      expect(upstreamCalled).toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("serves the app shell", async () => {
    const server = createServer({ port: 0 });
    try {
      const response = await fetch(server.url);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("Keydo");
      expect(body).toContain("task-list");
      expect(body).toContain('"fractional-indexing":"/src/fractional-indexing.js"');
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors 'none'");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    } finally {
      server.stop(true);
    }
  });

  test("serves the task view module", async () => {
    const server = createServer({ port: 0 });
    try {
      const response = await fetch(new URL("/src/task-view.js", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/javascript");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toContain("projectVisibleTree");
    } finally {
      server.stop(true);
    }
  });

  test("serves the fractional indexing dependency", async () => {
    const server = createServer({ port: 0 });
    try {
      const response = await fetch(new URL("/src/fractional-indexing.js", server.url));
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/javascript");
      expect(await response.text()).toContain("generateKeyBetween");
    } finally {
      server.stop(true);
    }
  });

  test("returns not found for unknown paths", async () => {
    const server = createServer({ port: 0 });
    try {
      const response = await fetch(new URL("/missing", server.url));
      expect(response.status).toBe(404);
    } finally {
      server.stop(true);
    }
  });
});
