import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright-core";
import { createServer } from "../src/server";

// D-017: actions keep you in your view and your place. Demo data covers the
// optimistic paths; a fake Todoist upstream (no credential, no network)
// covers Smart Add, sync-driven removal, project deletion and live restore.

const executablePath = process.env.KEYDO_TEST_BROWSER
  || Bun.which("google-chrome") || Bun.which("chromium") || Bun.which("chromium-browser");
assert.ok(executablePath, "Set KEYDO_TEST_BROWSER to an installed Chrome/Chromium executable.");
const browser: Browser = await chromium.launch({ executablePath, headless: true });
let checks = 0;

async function check(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}

async function openPage(url: URL) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (!request.url().startsWith(url.origin) && !request.url().startsWith("data:")) errors.push(`External request ${request.url()}`);
  });
  await page.goto(url.href);
  await page.locator("#boot-overlay").waitFor({ state: "hidden" });
  return { page, errors, close: () => context.close() };
}

const rowIds = (page: Page) => page.locator(".task-row").evaluateAll(rows => rows.map(row => (row as HTMLElement).dataset.taskId!));
const selectedId = (page: Page) => page.locator(".task-row.selected").getAttribute("data-task-id");
const viewTitle = (page: Page) => page.locator("#view-title").innerText();
const toast = (page: Page) => page.locator("#toast").innerText();

// The task that took `removed`'s place: the next row still shown, else the
// nearest one above.
function expectedReplacement(before: string[], removedIndex: number, after: string[]) {
  return before.slice(removedIndex + 1).find(id => after.includes(id))
    ?? before.slice(0, removedIndex).reverse().find(id => after.includes(id));
}

async function selectRow(page: Page, id: string) {
  await page.locator(`.task-row[data-task-id='${id}'] .task-title`).click();
  assert.equal(await selectedId(page), id);
}

async function goToProject(page: Page, name: string) {
  await page.keyboard.press("g");
  await page.locator("#command-search").fill(name);
  await page.keyboard.press("Enter");
  assert.equal(await viewTitle(page), name);
}

try {
  const demo = createServer({ hostname: "127.0.0.1", port: 0, todoistToken: "", trustTailscaleServe: false });
  try {
    await check("Space on a middle task hands the cursor to the next task, the last task to the one above", async () => {
      const { page, errors, close } = await openPage(demo.url);
      const before = await rowIds(page);
      assert.ok(before.length >= 4, "Today needs several tasks");
      const index = before.length - 3;
      await selectRow(page, before[index]);
      await page.keyboard.press(" ");
      const after = await rowIds(page);
      assert.ok(!after.includes(before[index]));
      assert.equal(await selectedId(page), expectedReplacement(before, index, after));
      assert.notEqual(await selectedId(page), after[0], "cursor must not jump to the top");

      const last = after[after.length - 1];
      await selectRow(page, last);
      await page.keyboard.press(" ");
      const afterLast = await rowIds(page);
      assert.equal(await selectedId(page), expectedReplacement(after, after.length - 1, afterLast));
      assert.equal(await page.locator(".task-row.selected").evaluate(row => document.activeElement === row), true);
      assert.deepEqual(errors, []);
      await close();
    });

    await check("rescheduling and deleting keep your place", async () => {
      const { page, errors, close } = await openPage(demo.url);
      let before = await rowIds(page);
      let index = before.length - 2;
      await selectRow(page, before[index]);
      await page.keyboard.press("Shift+T");
      let after = await rowIds(page);
      assert.ok(!after.includes(before[index]), "Tomorrow leaves Today");
      assert.equal(await selectedId(page), expectedReplacement(before, index, after));

      before = after;
      index = 1;
      await selectRow(page, before[index]);
      await page.keyboard.press("Delete");
      await page.locator("#delete-confirm").click();
      after = await rowIds(page);
      assert.ok(!after.includes(before[index]));
      assert.equal(await selectedId(page), expectedReplacement(before, index, after));
      assert.notEqual(await selectedId(page), after[0]);
      assert.deepEqual(errors, []);
      await close();
    });

    await check("C in details returns to the list on the next task; from a subtask, to the parent", async () => {
      const { page, errors, close } = await openPage(demo.url);
      await goToProject(page, "Launch plan");
      const before = await rowIds(page);
      const parent = await page.locator(".task-row.depth-0").filter({ has: page.locator("[data-collapse]") }).first().getAttribute("data-task-id");
      assert.ok(parent, "Launch plan needs a parent task");
      await selectRow(page, parent);
      await page.keyboard.press("Enter");
      await page.locator("#detail-pane").waitFor({ state: "visible" });
      await page.keyboard.press("Shift+S");
      const child = await page.locator("#subtask-list [data-subtask]:not(.done)").first().getAttribute("data-subtask");
      assert.ok(child);
      await page.locator(`#subtask-list [data-subtask='${child}']`).focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#detail-title").innerText(), await page.evaluate(id => document.querySelector(`.task-row[data-task-id='${id}'] .task-title`)?.textContent ?? "", child));
      await page.keyboard.press("c");
      assert.equal(await page.locator("#detail-pane").isVisible(), true, "stays in details");
      assert.equal(await selectedId(page), parent, "back on the parent");
      assert.equal(await page.locator(`#subtask-list [data-subtask='${child}']`).getAttribute("class").then(value => value?.includes("done")), true);

      const parentIndex = before.indexOf(parent);
      await page.keyboard.press("c");
      await page.locator("#detail-pane").waitFor({ state: "hidden" });
      const after = await rowIds(page);
      assert.ok(!after.includes(parent), "a completed task leaves the project view");
      assert.equal(await viewTitle(page), "Launch plan");
      assert.equal(await selectedId(page), expectedReplacement(before, parentIndex, after));
      assert.deepEqual(errors, []);
      await close();
    });

    await check("capture stays in the current view", async () => {
      const { page, errors, close } = await openPage(demo.url);
      await page.locator("[data-view='upcoming']").click();
      const cursor = await selectedId(page);
      await page.keyboard.press("n");
      await page.locator("#capture-input").fill("Captured from Upcoming");
      await page.keyboard.press("Enter");
      assert.equal(await viewTitle(page), "Upcoming");
      assert.equal(await selectedId(page), cursor, "cursor stays put");
      assert.match(await toast(page), /^Added to Inbox, due Today/);

      await page.locator("[data-view='today']").click();
      await page.keyboard.press("n");
      await page.locator("#capture-input").fill("Captured right here");
      await page.keyboard.press("Enter");
      assert.equal(await viewTitle(page), "Today");
      assert.equal(await page.locator(".task-row.selected .task-title").innerText(), "Captured right here");
      assert.match(await toast(page), /^Task captured/);

      await page.locator("#search-input").fill("Captured");
      await page.keyboard.press("Escape");
      await page.locator(".task-row.selected").focus();
      await page.keyboard.press("n");
      await page.locator("#capture-input").fill("Captured during search");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#search-input").inputValue(), "Captured", "capture keeps the search");
      assert.equal(await page.locator(".task-row.selected .task-title").innerText(), "Captured during search");
      assert.deepEqual(errors, []);
      await close();
    });

    await check("reload resumes the last view, and an unknown project opens Today", async () => {
      const { page, errors, close } = await openPage(demo.url);
      await goToProject(page, "Reading");
      await page.reload();
      await page.locator("#boot-overlay").waitFor({ state: "hidden" });
      assert.equal(await viewTitle(page), "Reading");
      assert.equal(await selectedId(page), (await rowIds(page))[0]);
      await page.locator("[data-view='upcoming']").click();
      await page.reload();
      await page.locator("#boot-overlay").waitFor({ state: "hidden" });
      assert.equal(await viewTitle(page), "Upcoming");
      await page.evaluate(() => localStorage.setItem("keydo.lastView.v1", JSON.stringify({ view: "project", project: "No such project", projectId: null, workspace: "Personal" })));
      await page.reload();
      await page.locator("#boot-overlay").waitFor({ state: "hidden" });
      assert.equal(await viewTitle(page), "Today");
      assert.deepEqual(errors, []);
      await close();
    });
  } finally {
    demo.stop(true);
  }

  const fixture = upstream();
  const live = createServer({ port: 0, hostname: "127.0.0.1", todoistToken: "fixture-token", todoistApiBase: "https://todoist.fixture", fetcher: fixture.fetcher, completionRecoveryPath: ":memory:", trustTailscaleServe: false });
  try {
    await check("live: Smart Add without a project stays in Today and says it went to Inbox", async () => {
      const { page, errors, close } = await openPage(live.url);
      assert.match(await page.locator("#sync-state").innerText(), /Synced/);
      assert.equal(await viewTitle(page), "Today");
      await selectRow(page, "bravo");
      await page.keyboard.press("n");
      await page.locator("#capture-input").fill("Plain inbox thought");
      await page.keyboard.press("Enter");
      await page.locator("#quick-capture").waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.startsWith("Added to Inbox"));
      assert.equal(await viewTitle(page), "Today");
      assert.equal(await selectedId(page), "bravo");
      assert.equal(await toast(page), "Added to Inbox · saved to Todoist");
      assert.deepEqual(errors, []);
      await close();
    });

    await check("live: a task deleted in Todoist hands the cursor to the next task", async () => {
      const { page, errors, close } = await openPage(live.url);
      const before = await rowIds(page);
      await selectRow(page, "bravo");
      fixture.deleteItem("bravo");
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.locator(".task-row[data-task-id='bravo']").waitFor({ state: "detached" });
      const after = await rowIds(page);
      assert.equal(await selectedId(page), expectedReplacement(before, before.indexOf("bravo"), after));
      assert.equal(await selectedId(page), "charlie");
      assert.deepEqual(errors, []);
      await close();
    });

    await check("live: reload resumes a project by its own name; deleting it opens Today", async () => {
      const { page, errors, close } = await openPage(live.url);
      await goToProject(page, "Side");
      await page.reload();
      await page.locator("#boot-overlay").waitFor({ state: "hidden" });
      assert.equal(await viewTitle(page), "Side");
      assert.deepEqual(await rowIds(page), ["side-task"]);
      fixture.deleteProject("side");
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await page.waitForFunction(() => document.querySelector("#view-title")?.textContent === "Today");
      assert.equal(await toast(page), "Project deleted · showing Today");
      await page.reload();
      await page.locator("#boot-overlay").waitFor({ state: "hidden" });
      assert.equal(await viewTitle(page), "Today");
      assert.deepEqual(errors, []);
      await close();
    });
  } finally {
    live.stop(true);
  }
  console.log(JSON.stringify({ checks, liveTodoistUsed: false }));
} finally {
  await browser.close();
}

type Item = { id: string; content: string; description: string; project_id: string; parent_id: string | null; checked: boolean; is_deleted?: boolean; priority: number; due: { date: string; is_recurring: boolean } | null; child_order: number };
type Project = { id: string; name: string; inbox_project?: boolean; is_deleted?: boolean };

function upstream() {
  const today = new Date().toLocaleDateString("en-CA");
  const due = { date: today, is_recurring: false };
  const items: Item[] = ["alpha", "bravo", "charlie", "delta"].map((id, index) => ({
    id, content: id.charAt(0).toUpperCase() + id.slice(1), description: "", project_id: "inbox", parent_id: null, checked: false, priority: 1, due, child_order: index + 1
  }));
  items.push({ id: "side-task", content: "Side task", description: "", project_id: "side", parent_id: null, checked: false, priority: 1, due: null, child_order: 1 });
  const projects: Project[] = [{ id: "inbox", name: "Inbox", inbox_project: true }, { id: "side", name: "Side" }];
  let version = 0;
  let sequence = 0;
  const changedAt = new Map<string, number>();
  const touch = (item: Item) => changedAt.set(item.id, ++version);
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://todoist.fixture");
    if (url.pathname === "/api/v1/sync") {
      const body = init!.body as URLSearchParams;
      assert.ok(!body.has("commands"), "this fixture only serves reads");
      const full = body.get("sync_token") === "*";
      const since = Number(body.get("sync_token")?.replace("cursor-", "") || 0);
      return Response.json({
        full_sync: full,
        sync_token: `cursor-${version}`,
        projects: projects.filter(project => !full || !project.is_deleted).map(project => ({ ...project })),
        sections: [],
        notes: [],
        items: items.filter(item => full ? !item.checked && !item.is_deleted : (changedAt.get(item.id) ?? 0) > since).map(item => ({ ...item }))
      });
    }
    if (url.pathname === "/api/v1/tasks/quick") {
      const { text } = JSON.parse(String(init!.body));
      const item: Item = { id: `quick-${++sequence}`, content: text, description: "", project_id: "inbox", parent_id: null, checked: false, priority: 1, due: null, child_order: 100 + sequence };
      items.push(item);
      touch(item);
      return Response.json({ ...item });
    }
    if (url.pathname === "/api/v1/tasks/completed/by_completion_date") return Response.json({ items: [] });
    throw new Error(`Unexpected fixture URL ${url.pathname}`);
  };
  return {
    fetcher,
    deleteItem(id: string) {
      const item = items.find(entry => entry.id === id)!;
      item.is_deleted = true;
      touch(item);
    },
    deleteProject(id: string) {
      projects.find(project => project.id === id)!.is_deleted = true;
      for (const item of items) if (item.project_id === id) { item.is_deleted = true; touch(item); }
    }
  };
}
