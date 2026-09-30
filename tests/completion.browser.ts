import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createServer } from "../src/server";

// An explicitly fake upstream exercises the real browser -> server -> Todoist
// adapter, including cascaded close and target/ancestor-only reopen semantics.
// No live credential or external network request is used.
type Item = { id: string; content: string; description: string; project_id: string; parent_id: string | null; checked: boolean; completed_at: string | null; priority: number; due: { date: string; is_recurring: boolean } | null; child_order: number };
function upstream() {
  const today = new Date().toLocaleDateString("en-CA");
  const items: Item[] = [
    { id: "root", content: "Recovery parent", description: "", project_id: "inbox", parent_id: null, checked: false, completed_at: null, priority: 1, due: { date: today, is_recurring: false }, child_order: 1 },
    { id: "done", content: "Previously finished child", description: "", project_id: "inbox", parent_id: "root", checked: true, completed_at: "2026-09-01T00:00:00Z", priority: 1, due: null, child_order: 1 }
  ];
  const closed: string[] = [];
  const reopened: string[] = [];
  let sequence = 0;
  let version = 0;
  const changedAt = new Map<string, number>();
  let failReopenId = "";
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://todoist.fixture");
    if (url.pathname === "/api/v1/sync") {
      const body = init!.body as URLSearchParams;
      if (body.has("commands")) {
        const commands = JSON.parse(body.get("commands")!);
        assert.equal(commands.length, 1);
        const command = commands[0];
        assert.equal(command.type, "item_add");
        const item: Item = { ...items[0], id: `child-${++sequence}`, content: command.args.content, parent_id: command.args.parent_id ?? null, checked: false, completed_at: null, due: null, child_order: sequence + 1 };
        items.push(item);
        changedAt.set(item.id, ++version);
        return Response.json({ sync_token: `cursor-${version}`, sync_status: { [command.uuid]: "ok" }, temp_id_mapping: { [command.temp_id]: item.id }, items: [item] });
      }
      const full = body.get("sync_token") === "*";
      const previousVersion = Number(body.get("sync_token")?.replace("cursor-", ""));
      return Response.json({ full_sync: full, sync_token: `cursor-${version}`, projects: [{ id: "inbox", name: "Inbox", inbox_project: true }], sections: [], notes: [], items: items.filter(item => full ? !item.checked : (changedAt.get(item.id) ?? 0) > previousVersion).map(item => ({ ...item })) });
    }
    if (url.pathname === "/api/v1/tasks/completed/by_completion_date") return Response.json({ items: items.filter(item => item.checked).map(item => ({ ...item })) });
    const match = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)(?:\/(close|reopen))?$/);
    assert.ok(match, `Unexpected fixture URL ${url.pathname}`);
    const item = items.find(item => item.id === match[1]);
    assert.ok(item);
    if (!match[2]) return Response.json({ ...item });
    if (match[2] === "close") {
      closed.push(item.id);
      const ids = new Set([item.id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const child of items) if (child.parent_id && ids.has(child.parent_id) && !ids.has(child.id)) { ids.add(child.id); changed = true; }
      }
      version++;
      for (const child of items) if (ids.has(child.id) && !child.checked) { child.checked = true; child.completed_at = "2026-09-30T18:00:00Z"; changedAt.set(child.id, version); }
    } else {
      if (item.id === failReopenId) return Response.json({ error: "fixture reopen failure" }, { status: 503 });
      reopened.push(item.id);
      version++;
      let current: Item | undefined = item;
      while (current) { current.checked = false; current.completed_at = null; changedAt.set(current.id, version); current = items.find(child => child.id === current!.parent_id); }
    }
    return new Response(null, { status: 204 });
  };
  return { items, closed, reopened, fetcher, failReopen: (id: string) => { failReopenId = id; } };
}

const executablePath = process.env.KEYDO_TEST_BROWSER || Bun.which("google-chrome") || Bun.which("chromium") || Bun.which("chromium-browser");
assert.ok(executablePath);
const browser = await chromium.launch({ executablePath, headless: true });
let checks = 0;
try {
  for (const scenario of ["completed", "partial", "project", "bulk"]) {
    const partialFailure = scenario === "partial";
    const fixture = upstream();
    const server = createServer({ port: 0, hostname: "127.0.0.1", todoistToken: "fixture-token", todoistApiBase: "https://todoist.fixture", fetcher: fixture.fetcher, completionRecoveryPath: ":memory:", trustTailscaleServe: false });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (!request.url().startsWith(server.url.origin)) errors.push(`External request ${request.url()}`); });
    try {
      await page.goto(server.url.href);
      await page.locator("#boot-overlay").waitFor({ state: "hidden" });
      assert.match(await page.locator("#sync-state").innerText(), /Synced/);
      await page.locator(".task-row").filter({ hasText: "Recovery parent" }).click();
      await page.keyboard.press("s");
      for (const title of ["First unfinished child", "Second unfinished child"]) {
        await page.locator("#subtask-create-input").fill(title);
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => (document.querySelector("#subtask-create-input") as HTMLInputElement).value === "");
      }
      assert.equal(await page.locator("#subtask-list [data-subtask]").count(), 2);
      if (scenario === "project") {
        await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
        await page.keyboard.press("r"); await page.keyboard.press("Enter");
        assert.equal(await page.locator("#detail-pane").isVisible(), true);
      }
      const completed = page.waitForResponse(response => response.url().endsWith("/tasks/root") && response.request().postDataJSON().action === "complete");
      if (scenario === "bulk") {
        await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
        await page.locator("#bulk-button").click();
        await page.locator("[data-task-id='root'] [data-select]").click();
        await page.locator("[data-task-id='child-1'] [data-select]").click();
        await page.locator("#bulk-complete").click();
      } else await page.locator("#complete-detail").click();
      assert.equal((await completed).status(), 200);
      if (scenario !== "project") {
        await page.reload(); // The previous client-side state is deliberately gone.
        await page.locator("#boot-overlay").waitFor({ state: "hidden" });
      }
      if (scenario !== "project") await page.locator("[data-view='completed']").click();
      else {
        await page.locator("#detail-pane").focus(); await page.keyboard.press("Escape");
      }
      const parent = page.locator(".task-row").filter({ hasText: "Recovery parent" });
      await parent.waitFor();
      if (partialFailure) fixture.failReopen("child-2");
      const reopen = page.waitForResponse(response => response.url().endsWith("/tasks/root") && response.request().postDataJSON().action === "reopen");
      await parent.locator("[data-complete]").click();
      assert.equal((await reopen).status(), partialFailure ? 502 : 200);
      if (partialFailure) {
        await parent.getByText("Retry reopening unfinished subtasks").waitFor();
        assert.equal(fixture.items.find(item => item.id === "root")!.checked, false);
        await page.reload();
        await page.locator("#boot-overlay").waitFor({ state: "hidden" });
        await page.locator("[data-view='completed']").click();
        await parent.getByText("Retry reopening unfinished subtasks").waitFor();
        fixture.failReopen("");
        const retry = page.waitForResponse(response => response.url().endsWith("/tasks/root") && response.request().postDataJSON().action === "reopen");
        await parent.locator("[data-complete]").click();
        assert.equal((await retry).status(), 200);
        assert.deepEqual(fixture.closed, ["root"], "Retry must never complete an already-active parent");
      }
      if (scenario !== "project") await parent.waitFor({ state: "hidden" });
      await page.locator("[data-view='today']").click();
      await parent.click(); await page.keyboard.press("Enter");
      await page.locator("#detail-pane").waitFor({ state: "visible" });
      assert.equal(await page.locator("#subtask-list [data-subtask]").count(), 2);
      assert.equal(await page.locator("#subtask-list .done").count(), 0);
      assert.equal(fixture.items.find(item => item.id === "done")!.checked, true);
      assert.deepEqual(fixture.reopened, ["root", "child-1", "child-2"]);
      assert.deepEqual(errors, []);
      checks++;
      console.log(`PASS fixture Todoist ${scenario}: created subtasks restore, finished children remain finished`);
    } finally { await page.close(); server.stop(true); }
  }
  console.log(JSON.stringify({ checks, liveTodoistUsed: false }));
} finally { await browser.close(); }
