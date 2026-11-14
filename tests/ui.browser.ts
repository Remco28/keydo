import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { createServer } from "../src/server";

// Never inherit the project's live Todoist token: these checks mutate demo data only.
const server = createServer({ hostname: "127.0.0.1", port: 0, todoistToken: "", trustTailscaleServe: false });
const executablePath = process.env.KEYDO_TEST_BROWSER
  || Bun.which("google-chrome") || Bun.which("chromium") || Bun.which("chromium-browser");
const artifacts = process.env.KEYDO_BROWSER_ARTIFACTS || await mkdtemp(join(tmpdir(), "keydo-ui-"));
let browser;
let checks = 0;
const errors: string[] = [];

async function check(name: string, run: () => Promise<void>) {
  await run();
  checks++;
  console.log(`PASS ${name}`);
}

async function noOverflow(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
}

try {
  assert.ok(executablePath, "Set KEYDO_TEST_BROWSER to an installed Chrome/Chromium executable.");
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  // A demo server should not make any external network requests.
  page.on("request", request => {
    if (!request.url().startsWith(server.url.origin) && !request.url().startsWith("data:")) {
      errors.push(`Unexpected external request: ${request.url()}`);
    }
  });
  await page.goto(server.url.href);
  await page.locator("#boot-overlay").waitFor({ state: "hidden" });
  assert.match(await page.locator("#sync-state").innerText(), /Demo/);

  await check("supplied logo and checkmark favicon load without distorting the header", async () => {
    const logo = page.locator(".brand-logo");
    assert.equal(await logo.getAttribute("alt"), "Keydo");
    assert.equal(await logo.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth === 768), true);
    const dimensions = await logo.boundingBox();
    assert.ok(dimensions && dimensions.height === 44 && dimensions.width > 130);
    assert.equal(await page.locator(".brand-mark").count(), 0);
    assert.equal(await page.locator("link[rel='icon'][type='image/png']").getAttribute("href"), "/assets/favicon.png");
    for (const path of ["/assets/favicon.png", "/favicon.ico"]) {
      assert.equal((await page.request.get(new URL(path, server.url).href)).status(), 200);
    }
    await noOverflow(page);
  });

  await check("Chrome reports Keydo as installable as a desktop app", async () => {
    const session = await page.context().newCDPSession(page);
    const { installabilityErrors } = await session.send("Page.getInstallabilityErrors");
    // Playwright pages are incognito, which Chrome never installs from; any other reason is ours.
    assert.deepEqual(installabilityErrors.filter(error => error.errorId !== "in-incognito"), []);
    const { url, errors: manifestErrors } = await session.send("Page.getAppManifest");
    assert.equal(url, new URL("/manifest.webmanifest", server.url).href);
    assert.deepEqual(manifestErrors, []);
    await session.detach();
  });

  await check("header removes placeholder identity and presents quiet grouped task counts", async () => {
    assert.equal(await page.locator(".user-chip, .avatar").count(), 0);
    assert.doesNotMatch(await page.locator(".side").innerText(), /Remco/);
    const date = await page.locator("#view-eyebrow").innerText();
    assert.doesNotMatch(date, /workspace|Task browser/i);
    assert.match(await page.locator("#view-eyebrow").getAttribute("datetime") || "", /^\d{4}-\d{2}-\d{2}$/);
    const metrics = () => page.locator("#view-subtitle .summary-metric").evaluateAll(elements => elements.map(element => [element.querySelector("strong")?.textContent, element.querySelector("span")?.textContent]));
    assert.deepEqual(await metrics(), [["4", "tasks"], ["2", "high priority"], ["1", "overdue"]]);
    for (const view of ["upcoming", "priority", "completed"]) {
      await page.locator(`[data-view='${view}']`).click();
      assert.equal(await page.locator("#view-eyebrow").innerText(), date);
      assert.equal(await page.locator("#view-subtitle .summary-metric").count(), 1);
    }
    assert.match(await page.locator("#view-subtitle").innerText(), /Space\s+to reopen/);
    await page.locator("[data-view='today']").click();
    await page.locator("#search-input").fill("Pick up prescription");
    // A search looks through every task, so it carries its own title and count, and no view is marked.
    assert.deepEqual(await metrics(), [["1", "result in all tasks"]]);
    assert.equal(await page.locator("#view-title").innerText(), "Search");
    assert.equal(await page.locator(".nav-item.active").count(), 0);
    await page.locator("#search-input").fill("no-task-matches-this-header-check");
    assert.deepEqual(await metrics(), [["0", "results in all tasks"]]);
    await page.locator("#search-input").fill("");
    assert.equal(await page.locator("#view-title").innerText(), "Today");
    assert.deepEqual(await metrics(), [["4", "tasks"], ["2", "high priority"], ["1", "overdue"]]);
    await page.locator(".task-row.selected").focus();
  });

  await check("switching views selects the first task", async () => {
    await page.locator(".task-row").nth(1).click();
    assert.match(await page.locator(".task-row.selected").innerText(), /Write the project update/);
    await page.locator("[data-view='priority']").click();
    assert.equal(await page.locator(".task-row").first().getAttribute("aria-current"), "true");
    assert.match(await page.locator(".task-row").first().innerText(), /Review the launch plan/);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.locator("[data-view='today']").click();
    assert.equal(await page.locator(".task-row").first().getAttribute("aria-current"), "true");
  });

  await check("up from the first task returns the list to the top", async () => {
    await page.setViewportSize({ width: 1100, height: 360 });
    await page.locator(".task-row").first().click();
    const list = page.locator("#list-scroll");
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    assert.ok(await list.evaluate(element => element.scrollTop > 0), "the list is long enough to scroll");
    await page.keyboard.press("ArrowUp");
    assert.equal(await list.evaluate(element => element.scrollTop), 0);
    assert.equal(await page.locator(".task-row").first().getAttribute("aria-current"), "true");
    // Each pane scrolls on its own; the window never does.
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  await check("page down to the last task brings it fully into view", async () => {
    await page.setViewportSize({ width: 1100, height: 360 });
    await page.locator(".task-row").first().click();
    await page.locator("#list-scroll").evaluate(element => { element.scrollTop = 0; });
    for (let press = 0; press < 4; press += 1) await page.keyboard.press("PageDown");
    assert.equal(await page.locator(".task-row").last().getAttribute("aria-current"), "true");
    assert.ok(await page.evaluate(() => {
      const row = document.querySelector(".task-row.selected")!.getBoundingClientRect();
      const list = document.querySelector("#list-scroll")!.getBoundingClientRect();
      return row.top >= list.top && row.bottom <= list.bottom;
    }));
    await page.locator(".task-row").first().click();
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  await check("readable task typography and quiet default selection", async () => {
    assert.equal(await page.locator(".task-title").first().evaluate(element => getComputedStyle(element).fontSize), "15px");
    assert.equal(await page.locator(".select-box").first().isVisible(), false);
    assert.equal(await page.locator(".task-row[aria-current='true']").count(), 1);
    await noOverflow(page);
  });
  await page.screenshot({ path: join(artifacts, "desktop-list.png"), fullPage: true });

  await check("keyboard range selection is distinct from the active task", async () => {
    await page.locator(".task-row").first().focus();
    await page.keyboard.press("Shift+ArrowDown");
    assert.equal(await page.locator(".bulk-selected").count(), 2);
    assert.equal(await page.locator(".select-box[aria-pressed='true']").count(), 2);
    assert.equal(await page.locator(".task-row[aria-current='true']").count(), 1);
    assert.equal(await page.locator("#bulk-bar").isVisible(), true);
    await page.locator("#bulk-clear").click();
    assert.equal(await page.locator(".select-box").first().isVisible(), false);
  });

  await check("mouse selection mode is usable and can be dismissed", async () => {
    await page.locator("#bulk-button").click();
    assert.equal(await page.locator("#bulk-button").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".select-box").first().isVisible(), true);
    assert.equal(await page.locator(".select-box").first().getAttribute("aria-pressed"), "false");
    await page.locator(".select-box").nth(1).click();
    assert.equal(await page.locator(".bulk-selected").count(), 1);
    await page.locator("#bulk-clear").click();
    assert.equal(await page.locator("#bulk-button").getAttribute("aria-pressed"), "false");
    await page.locator("#bulk-button").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".select-box").first().isVisible(), false);
    await page.locator("#bulk-button").click();
    await page.locator("[data-view='upcoming']").click();
    assert.equal(await page.locator("#bulk-button").getAttribute("aria-pressed"), "false");
    await page.locator("[data-view='today']").click();
    await page.locator("#bulk-button").click();
    await page.locator("#bulk-button").click();
    assert.equal(await page.locator(".task-row.selected").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#detail-pane.editing").isVisible(), true);
    await page.keyboard.press("Escape");
  });

  await check("the key bar shows the keys for the list, then for details", async () => {
    await page.locator(".task-row").first().focus();
    assert.equal(await page.locator("#key-context").textContent(), "List");
    assert.match(await page.locator("#key-list").innerText(), /Complete[\s\S]*Details/);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#detail-pane.editing").isVisible(), true);
    assert.equal(await page.locator("#key-context").textContent(), "Details");
    assert.match(await page.locator("#key-list").innerText(), /Title[\s\S]*Notes[\s\S]*Back to list/);
    assert.equal(await page.locator(".preview-column").isVisible(), true);
    await page.locator("#detail-pane").focus();
    await page.keyboard.press("n");
    assert.equal(await page.locator("#description-editor").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("t");
    assert.equal(await page.locator("#detail-title-input").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  await check("capture creates an isolated empty-note task", async () => {
    await page.keyboard.press("n");
    await page.locator("#capture-input").fill("Browser polish check today");
    await page.keyboard.press("Enter");
    await page.locator("#quick-capture").waitFor({ state: "hidden" });
    assert.equal(await page.locator(".task-row.selected").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#detail-pane.editing").isVisible(), true);
    assert.equal(await page.locator("#detail-title-input").inputValue(), "Browser polish check");
    assert.equal(await page.locator("#description-editor").inputValue(), "");
    assert.equal(await page.locator(".preview-column").isVisible(), false);
    const editorHeight = await page.locator("#description-editor").evaluate(element => element.getBoundingClientRect().height);
    assert.ok(editorHeight >= 144 && editorHeight <= 200, `Empty editor height: ${editorHeight}`);
    assert.equal(await page.locator("#subtask-create-input").isVisible(), true);
    await page.locator("#toggle-notes-width").click();
    assert.equal(await page.locator(".preview-column").isVisible(), true);
    await page.locator("#toggle-notes-width").click();
    assert.equal(await page.locator(".preview-column").isVisible(), false);
  });
  await page.screenshot({ path: join(artifacts, "desktop-empty-detail.png"), fullPage: true });

  await check("notes preview and editor adapt as content changes", async () => {
    await page.locator("#description-editor").fill("**Browser test notes**\n\n- First action\n- Second action");
    // A manual Hide preview preference is preserved while typing.
    assert.equal(await page.locator(".preview-column").isVisible(), false);
    await page.locator("#toggle-notes-width").click();
    assert.equal(await page.locator("#description-preview strong").innerText(), "Browser test notes");
    assert.equal(await page.locator("#description-preview li").count(), 2);
    const before = await page.locator("#description-editor").evaluate(element => element.getBoundingClientRect().height);
    await page.locator("#description-editor").fill(Array.from({ length: 25 }, (_, index) => `Line ${index}`).join("\n"));
    const after = await page.locator("#description-editor").evaluate(element => element.getBoundingClientRect().height);
    assert.ok(after > before && after <= 480, `Editor heights: ${before}, ${after}`);
    assert.equal(await page.locator("#description-editor").evaluate(element => getComputedStyle(element).resize), "none");
    await page.locator("#description-editor").fill("**Browser test notes**\n\n- First action\n- Second action");
    await page.keyboard.press("Control+Enter");
    assert.equal(await page.locator("#task-list").isVisible(), true);
    assert.equal(await page.locator(".task-row.selected").evaluate(element => document.activeElement === element), true);
    await page.locator(".task-row.selected").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".preview-column").isVisible(), true);
    assert.match(await page.locator("#description-editor").inputValue(), /Browser test notes/);
  });

  await check("due-date chooser works from details and the list", async () => {
    await page.locator("#detail-pane").focus();
    const originalDate = await page.locator("#detail-due-date").inputValue();
    await page.keyboard.press("d");
    assert.equal(await page.locator("#due-backdrop").isVisible(), true);
    assert.match(await page.locator("#due-task-name").innerText(), /Browser polish check/);
    await page.screenshot({ path: join(artifacts, "desktop-due-chooser.png"), fullPage: true });
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.locator("#due-cancel").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.locator("[data-due-choice='today']").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#detail-due-date").inputValue(), originalDate);
    assert.equal(await page.locator("#detail-pane").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("r");
    await page.keyboard.press("d");
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator("[data-due-choice='tomorrow']").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Enter");
    await page.locator("#due-backdrop").waitFor({ state: "hidden" });
    await page.keyboard.press("Enter");
    const tomorrow = await page.evaluate(() => {
      const date = new Date(); date.setDate(date.getDate() + 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    });
    assert.equal(await page.locator("#detail-due-date").inputValue(), tomorrow);
    await page.locator("#description-editor").focus();
    await page.keyboard.press("Alt+d");
    assert.equal(await page.locator("#due-backdrop").isVisible(), true);
    await page.keyboard.press("d");
    assert.equal(await page.locator("#due-specific-input").evaluate(element => document.activeElement === element), true);
    await page.locator("#due-specific-input").fill("");
    await page.locator("#due-specific-form button").click();
    assert.equal(await page.locator("#due-backdrop").isVisible(), true);
    assert.equal(await page.locator("#detail-due-date").inputValue(), tomorrow);
    await page.locator("#due-specific-input").fill("2030-12-20");
    await page.screenshot({ path: join(artifacts, "desktop-specific-date.png"), fullPage: true });
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => (document.querySelector("#detail-due-date") as HTMLInputElement).value === "2030-12-20");
    await page.locator("#detail-pane").focus();
    await page.keyboard.press("d");
    await page.keyboard.press("c");
    await page.waitForFunction(() => (document.querySelector("#detail-due-date") as HTMLInputElement).value === "");
    await page.keyboard.press("d");
    await page.keyboard.press("t");
    await page.waitForFunction(() => (document.querySelector("#detail-due-date") as HTMLInputElement).value !== "");
    assert.equal(await page.locator("#detail-due-date").inputValue(), originalDate);
    const notes = await page.locator("#description-editor").inputValue();
    await page.locator("#description-editor").fill("");
    await page.keyboard.type("ds");
    assert.equal(await page.locator("#description-editor").inputValue(), "ds");
    assert.equal(await page.locator("#due-backdrop").isVisible(), false);
    assert.equal(await page.locator("#description-editor").evaluate(element => document.activeElement === element), true);
    await page.locator("#description-editor").fill(notes);
    await page.locator("#detail-pane").focus();
  });

  await check("S adds subtasks and Shift+S browses existing children", async () => {
    await page.keyboard.press("s");
    assert.equal(await page.locator("#subtask-create-input").evaluate(element => document.activeElement === element), true);
    await page.locator("#subtask-create-input").fill("Browser child task");
    await page.keyboard.press("Enter");
    await page.locator("#subtask-list [data-subtask]").waitFor();
    assert.equal(await page.locator("#subtask-create-input").inputValue(), "");
    await page.locator("#description-editor").focus();
    await page.keyboard.press("Alt+s");
    assert.equal(await page.locator("#subtask-create-input").evaluate(element => document.activeElement === element), true);
    await page.locator("#detail-pane").focus();
    await page.keyboard.press("Shift+s");
    assert.equal(await page.locator("#subtask-list [data-subtask]").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#detail-title-input").inputValue(), "Browser child task");
    assert.equal(await page.locator(".preview-column").isVisible(), false);
    await page.keyboard.press("Escape");
    await page.keyboard.press("s");
    assert.equal(await page.locator("#detail-pane.editing").isVisible(), true);
    assert.equal(await page.locator("#subtask-create-input").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  await check("reopening a parent restores its unfinished subtasks", async () => {
    const recoveryPage = await browser!.newPage();
    try {
      await recoveryPage.goto(server.url.href);
      await recoveryPage.locator("#boot-overlay").waitFor({ state: "hidden" });
      await recoveryPage.locator("#capture-button").click();
      await recoveryPage.locator("#capture-input").fill("Recovery parent today");
      await recoveryPage.keyboard.press("Enter");
      await recoveryPage.locator("#quick-capture").waitFor({ state: "hidden" });
      await recoveryPage.keyboard.press("s");
      for (const title of ["Unfinished child one", "Unfinished child two"]) {
        await recoveryPage.locator("#subtask-create-input").fill(title);
        await recoveryPage.keyboard.press("Enter");
      }
      assert.equal(await recoveryPage.locator("#subtask-list [data-subtask]").count(), 2);
      await recoveryPage.locator("#detail-pane").focus();
      await recoveryPage.keyboard.press("c");
      await recoveryPage.locator("[data-view='completed']").click();
      const parent = recoveryPage.locator(".task-row").filter({ hasText: "Recovery parent" });
      await parent.locator("[data-complete]").click();
      await recoveryPage.locator("[data-view='today']").click();
      await parent.click();
      await recoveryPage.keyboard.press("Enter");
      await recoveryPage.locator("#detail-pane.editing").waitFor({ state: "visible" });
      assert.equal(await recoveryPage.locator("#subtask-list [data-subtask]").count(), 2);
      assert.equal(await recoveryPage.locator("#subtask-list .done").count(), 0);
    } finally {
      await recoveryPage.close();
    }
  });

  await check("project tree, search, and empty states still work", async () => {
    await page.locator(".task-row.selected").focus();
    await page.keyboard.press("r");
    const toggle = page.locator(".task-row.selected [data-collapse]");
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await toggle.click();
    assert.equal(await page.locator(".task-row.selected [data-collapse]").getAttribute("aria-expanded"), "false");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator(".task-row.selected [data-collapse]").getAttribute("aria-expanded"), "true");
    await page.locator("#search-input").fill("unmatched browser check");
    assert.equal(await page.locator(".empty-state strong").innerText(), "No matching tasks");
    await page.locator("#search-input").fill("Browser polish check");
    assert.equal(await page.locator(".task-row").count(), 1);
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator(".task-row.selected").evaluate(element => document.activeElement === element), true);
    // Delete asks first; Enter answers the button that has the keyboard, and the key bar says which.
    await page.keyboard.press("Delete");
    assert.equal(await page.locator("#delete-backdrop").isVisible(), true);
    assert.match(await page.locator("#delete-copy").innerText(), /cannot be undone/);
    await page.waitForFunction(() => /↵\s*Delete/.test(document.querySelector("#key-list")?.textContent ?? ""));
    await page.keyboard.press("Tab");
    await page.waitForFunction(() => /↵\s*Cancel/.test(document.querySelector("#key-list")?.textContent ?? ""));
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#delete-backdrop").isVisible(), false);
    assert.equal(await page.locator(".task-row").count(), 1);
    // The buttons answer the mouse too.
    await page.keyboard.press("Delete");
    await page.locator("#delete-cancel").click();
    assert.equal(await page.locator("#delete-backdrop").isVisible(), false);
    assert.equal(await page.locator(".task-row").count(), 1);
    await page.locator("#search-input").fill("");
    await page.locator("[data-view='today']").click();
  });

  await check("header help and command controls are real controls", async () => {
    await page.locator("#help-button").click();
    assert.equal(await page.locator("#help-backdrop").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.locator("#commands-button").click();
    assert.equal(await page.locator("#command-backdrop").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    assert.equal(await page.locator("#command-backdrop").isVisible(), true);
    await page.keyboard.press("Escape");
  });

  await check("header dialogs dismiss before capture and preserve draft focus", async () => {
    await page.locator("#capture-button").click();
    assert.equal(await page.locator("#capture-input").inputValue(), "");
    await page.locator("#capture-input").fill("Keep this capture draft");
    for (const [button, backdrop] of [["#commands-button", "#command-backdrop"], ["#help-button", "#help-backdrop"]]) {
      await page.locator(button!).click();
      assert.equal(await page.locator(backdrop!).isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(backdrop!).isVisible(), false);
      assert.equal(await page.locator("#quick-capture").isVisible(), true);
      assert.equal(await page.locator("#capture-input").inputValue(), "Keep this capture draft");
      assert.equal(await page.locator("#capture-input").evaluate(element => document.activeElement === element), true);
    }
    await page.locator("#commands-button").click();
    await page.locator("#command-search").fill("Show keyboard help");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#command-backdrop").isVisible(), false);
    assert.equal(await page.locator("#help-backdrop").isVisible(), true);
    await page.keyboard.press("Escape");
    await page.locator("#commands-button").click();
    await page.locator("#command-backdrop").click({ position: { x: 5, y: 5 } });
    assert.equal(await page.locator("#capture-input").evaluate(element => document.activeElement === element), true);
    await page.keyboard.type("!");
    assert.equal(await page.locator("#capture-input").inputValue(), "Keep this capture draft!");
    await page.keyboard.press("Escape");
  });

  await check("attachments stay visible when the text preview was hidden", async () => {
    await page.locator(".task-row.selected").focus();
    await page.keyboard.press("Enter");
    await page.locator("#toggle-notes-width").click();
    assert.equal(await page.locator(".preview-column").isVisible(), false);
    // Generate an actual raster file, then exercise the app's paste handler.
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 96; canvas.height = 64;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#356f68";
      context.fillRect(0, 0, 96, 64);
      canvas.toBlob(blob => {
        const data = new DataTransfer();
        data.items.add(new File([blob!], "browser-attachment.png", { type: "image/png" }));
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
      }, "image/png");
    });
    await page.locator("#preview-media img").waitFor();
    // Screenshots have their own section, so hiding the text preview never hides them.
    assert.equal(await page.locator(".preview-column").isVisible(), false);
    assert.equal(await page.locator("#preview-media img").isVisible(), true);
    await page.waitForFunction(() => {
      const image = document.querySelector("#preview-media img") as HTMLImageElement;
      return image?.complete && image.naturalWidth === 96;
    });
    await page.screenshot({ path: join(artifacts, "desktop-attachment.png"), fullPage: true });
    await page.locator("[data-remove-attachment]").click();
    assert.equal(await page.locator("#preview-media img").count(), 0);
    assert.equal(await page.locator(".preview-column").isVisible(), false);
    await page.keyboard.press("Escape");
  });

  await check("narrow list, selection, detail, and capture do not overflow", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".task-row.selected").focus();
    await page.keyboard.press("d");
    assert.equal(await page.locator("#due-backdrop").isVisible(), true);
    await noOverflow(page);
    await page.screenshot({ path: join(artifacts, "narrow-due-chooser.png"), fullPage: true });
    await page.keyboard.press("d");
    await noOverflow(page);
    await page.screenshot({ path: join(artifacts, "narrow-specific-date.png"), fullPage: true });
    await page.locator("#due-cancel").click();
    await noOverflow(page);
    await page.screenshot({ path: join(artifacts, "narrow-list.png"), fullPage: true });
    await page.locator("#bulk-button").click();
    await page.locator(".select-box").first().click();
    await noOverflow(page);
    await page.screenshot({ path: join(artifacts, "narrow-selection.png"), fullPage: true });
    await page.locator("#bulk-clear").click();
    await page.locator(".task-row").first().focus();
    await page.keyboard.press("Enter");
    await noOverflow(page);
    await page.screenshot({ path: join(artifacts, "narrow-detail.png"), fullPage: true });
    await page.keyboard.press("Escape");
    await page.locator("#capture-button").click();
    assert.equal(await page.locator("#capture-input").inputValue(), "");
    await noOverflow(page);
    await page.screenshot({ path: join(artifacts, "narrow-capture.png"), fullPage: true });
    await page.keyboard.press("Escape");
  });

  await check("B sorts each view and the view remembers it", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator("[data-view='priority']").click();
    assert.equal(await page.locator("#view-sort-label").innerText(), "Sort: Priority · P1 first");
    const rootTitles = () => page.locator(".task-row.depth-0 .task-title").allInnerTexts();
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    await page.keyboard.press("b");
    assert.equal(await page.locator("#sort-backdrop").isVisible(), true);
    assert.equal(await page.locator("[data-sort-choice='priority']").getAttribute("aria-checked"), "true");
    await page.screenshot({ path: join(artifacts, "desktop-sort-chooser.png"), fullPage: true });
    await page.keyboard.press("t");
    await page.locator("#sort-backdrop").waitFor({ state: "hidden" });
    const ascending = await rootTitles();
    assert.ok(ascending.length > 1, "priority view needs several tasks");
    assert.deepEqual(ascending, [...ascending].sort(collator.compare));
    assert.equal(await page.locator("#view-sort-label").innerText(), "Sort: Title · A–Z");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: join(artifacts, "desktop-sorted-view.png") });
    await page.keyboard.press("b");
    await page.keyboard.press("t");
    assert.deepEqual(await rootTitles(), [...ascending].reverse());
    await page.locator("[data-view='today']").click();
    assert.equal(await page.locator("#view-sort-label").innerText(), "Sort");
    await page.locator("[data-view='priority']").click();
    assert.equal(await page.locator("#view-sort-label").innerText(), "Sort: Title · Z–A");
    assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("keydo.viewSort.v1") ?? "{}")).priority, { key: "title", reverse: true });
    await page.reload();
    await page.locator("#boot-overlay").waitFor({ state: "hidden" });
    await page.locator("[data-view='priority']").click();
    assert.equal(await page.locator("#view-sort-label").innerText(), "Sort: Title · Z–A");
    await page.keyboard.press("b");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#sort-backdrop").isVisible(), false);
    assert.equal(await page.locator("#view-sort-label").innerText(), "Sort: Title · Z–A");
    await page.keyboard.press("b");
    await page.keyboard.press("p");
    assert.equal(await page.locator("#view-sort-label").innerText(), "Sort: Priority · P1 first");
  });

  await check("number keys open the views and the sidebar lists projects", async () => {
    await page.locator("[data-view='today']").click();
    for (const [key, title] of [["2", "Upcoming"], ["3", "Priority"], ["4", "Inbox"], ["5", "Completed"], ["1", "Today"]]) {
      await page.keyboard.press(key!);
      assert.equal(await page.locator("#view-title").innerText(), title);
      assert.equal(await page.locator(".view-switcher .nav-item.active").getAttribute("data-view"), title!.toLowerCase());
    }
    await page.locator("#nav-projects [data-project='Personal']").click();
    assert.equal(await page.locator("#view-title").innerText(), "Personal");
    assert.equal(await page.locator("#nav-projects .nav-item.active").innerText().then(text => text.includes("Personal")), true);
    assert.equal(await page.locator(".view-switcher .nav-item.active").count(), 0);
    await page.keyboard.press("1");
    assert.match(await page.title(), /^Today · \d+ — Keydo$/);
  });

  await check("the on-screen keycap presses with the real key", async () => {
    await page.locator(".task-row").first().click();
    await page.keyboard.down("ArrowDown");
    await page.locator("#key-list kbd.pressed").waitFor();
    assert.match(await page.locator("#key-list kbd.pressed").getAttribute("data-k") ?? "", /↓/);
    await page.keyboard.up("ArrowDown");
    await page.locator("#key-list kbd.pressed").waitFor({ state: "detached" });
  });

  await check("Z takes back a new priority, a new date and a completion", async () => {
    await page.keyboard.press("n");
    await page.locator("#capture-input").fill("Undo check today");
    await page.keyboard.press("Enter");
    await page.locator("#quick-capture").waitFor({ state: "hidden" });
    const id = await page.locator(".task-row.selected").getAttribute("data-task-id");
    const row = page.locator(`.task-row[data-task-id='${id}']`);
    const today = await page.locator("#detail-due-date").inputValue();
    assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
    const undo = async () => { await page.keyboard.press("z"); };

    await page.keyboard.press("+");
    assert.match(await row.locator(".complete-button").getAttribute("class") ?? "", /\bp2\b/);
    assert.equal(await page.locator("#toast-undo").isVisible(), true);
    await undo();
    await page.waitForFunction(taskId => document.querySelector(`.task-row[data-task-id='${taskId}'] .complete-button`)?.classList.contains("p1"), id);

    await page.keyboard.press("Shift+T");
    await row.waitFor({ state: "detached" });
    await undo();
    await row.waitFor();
    await page.waitForFunction(taskId => document.querySelector(`.task-row[data-task-id='${taskId}']`)?.getAttribute("aria-current") === "true", id);
    assert.equal(await page.locator("#detail-due-date").inputValue(), today);

    await page.keyboard.press(" ");
    await row.waitFor({ state: "detached" });
    assert.equal(await page.locator("#day-ring .num").innerText().then(text => text.startsWith("1 of")), true);
    await undo();
    await row.waitFor();
    await page.waitForFunction(taskId => document.querySelector(`.task-row[data-task-id='${taskId}']`)?.getAttribute("aria-current") === "true", id);
    assert.equal(await page.locator("#day-ring .num").innerText().then(text => text.startsWith("0 of")), true);
    await undo();
    assert.equal(await page.locator("#toast").innerText(), "Nothing to undo");
  });

  await check("a key that changes nothing leaves the undo offer standing", async () => {
    await page.keyboard.press("1");
    const first = page.locator(".task-row").first();
    const last = page.locator(".task-row").last();
    const id = await last.getAttribute("data-task-id");
    await last.click();
    await page.keyboard.press(" ");
    await page.locator(`.task-row[data-task-id='${id}']`).waitFor({ state: "detached" });
    await first.click();
    for (let step = 0; step < 4; step += 1) await page.keyboard.press("+");
    assert.equal(await page.locator("#toast").innerText(), "Already at highest priority");
    await page.keyboard.press("z");
    await page.keyboard.press("z");
    await page.locator(`.task-row[data-task-id='${id}']`).waitFor();
  });

  await check("the command list finds Undo first for \"undo\"", async () => {
    await page.keyboard.press("1");
    await page.keyboard.press("Control+k");
    await page.locator("#command-search").fill("undo");
    assert.match(await page.locator(".command-item.active").innerText(), /^Undo the last change/);
    await page.keyboard.press("Escape");
  });

  await check("in details the command list shows a key only where it works, and T selects the title", async () => {
    await page.keyboard.press("1");
    await page.locator(".task-row").first().click();
    await page.keyboard.press("Enter");
    await page.locator("#detail-pane.editing").waitFor();
    await page.keyboard.press("Control+k");
    await page.locator("#command-search").fill("clear selected task date");
    assert.equal(await page.locator(".command-item.active kbd").count(), 0, "C clears a date in the list only");
    await page.locator("#command-search").fill("complete selected task");
    assert.equal(await page.locator(".command-item.active kbd").innerText(), "C");
    await page.keyboard.press("Escape");
    await page.keyboard.press("t");
    const title = page.locator("#detail-title-input");
    assert.deepEqual(await title.evaluate((input: HTMLInputElement) => [document.activeElement === input, input.selectionStart, input.selectionEnd === input.value.length]), [true, 0, true]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator("#detail-pane.editing").waitFor({ state: "detached" });
  });

  await check("Escape clears a search and returns to the view; Enter goes to the first result", async () => {
    await page.keyboard.press("1");
    await page.keyboard.press("/");
    await page.keyboard.type("design");
    assert.equal(await page.locator("#view-title").innerText(), "Search");
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".task-row.selected").evaluate(element => document.activeElement === element), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#search-input").inputValue(), "");
    assert.equal(await page.locator("#view-title").innerText(), "Today");
    await page.keyboard.press("/");
    await page.keyboard.type("design");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#search-input").inputValue(), "");
    assert.equal(await page.locator(".task-row.selected").evaluate(element => document.activeElement === element), true);
  });

  await check("Space with tasks selected completes all of them", async () => {
    await page.keyboard.press("1");
    const rows = page.locator(".task-row");
    const before = await rows.count();
    await rows.nth(0).click();
    await page.keyboard.press("Shift+ArrowDown");
    const picked = await page.locator(".task-row.bulk-selected").evaluateAll(list => list.map(row => (row as HTMLElement).dataset.taskId));
    assert.equal(picked.length, 2);
    assert.match(await page.locator("#key-list").innerText(), /Complete the selection/);
    await page.keyboard.press(" ");
    for (const id of picked) await page.locator(`.task-row[data-task-id='${id}']`).waitFor({ state: "detached" });
    assert.ok(await rows.count() <= before - 2);
    assert.equal(await page.locator(".task-row.bulk-selected").count(), 0);
    await page.keyboard.press("5");
    for (const id of picked) await page.locator(`.task-row[data-task-id='${id}']`).waitFor();
    // Put them back for the checks that follow (reopening a parent also reopens its subtask).
    for (const id of picked) {
      const row = page.locator(`.task-row[data-task-id='${id}']`);
      if (!await row.count()) continue;
      await row.click();
      await page.keyboard.press(" ");
      await row.waitFor({ state: "detached" });
    }
    await page.keyboard.press("1");
  });

  await check("tasks completed several at once count as done today", async () => {
    await page.keyboard.press("1");
    const before = await page.locator("#day-ring .num").innerText();
    const done = Number(before.split(" ")[0]);
    await page.locator(".task-row").first().click();
    await page.keyboard.press("Shift+ArrowDown");
    assert.ok(await page.locator(".task-row.bulk-selected").count() >= 2);
    await page.locator("#bulk-complete").click();
    // A parent completed with its subtask counts once, as it does when completed alone.
    await page.waitForFunction(before => Number(document.querySelector("#day-ring .num")?.textContent?.split(" ")[0]) > before, done);
  });

  await check("the date chooser has a next-week key and a calendar the arrows walk", async () => {
    await page.keyboard.press("r");
    const shifted = (key: string, days: number) => page.evaluate(([from, by]) => {
      const date = new Date(`${from}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + (by as number));
      return date.toISOString().slice(0, 10);
    }, [key, days]);
    const today = await page.locator("#detail-due-date").inputValue();
    await page.keyboard.press("d");
    assert.equal(await page.locator("#due-calendar .is-today").getAttribute("data-cal-date"), today);
    await page.keyboard.press("d");
    assert.equal(await page.locator("#due-specific-input").evaluate(element => document.activeElement === element), true);
    // The key bar follows the keyboard a frame later.
    await page.waitForFunction(() => document.querySelector("#key-context")?.textContent === "Calendar");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    const picked = await shifted(today, 8);
    assert.equal(await page.locator("#due-specific-input").inputValue(), picked);
    assert.equal(await page.locator("#due-calendar .is-picked").getAttribute("data-cal-date"), picked);
    await page.keyboard.press("Enter");
    await page.waitForFunction(value => (document.querySelector("#detail-due-date") as HTMLInputElement).value === value, picked);
    await page.keyboard.press("d");
    await page.keyboard.press("w");
    await page.waitForFunction(value => (document.querySelector("#detail-due-date") as HTMLInputElement).value !== value, picked);
    const nextWeek = await page.locator("#detail-due-date").inputValue();
    assert.equal(new Date(`${nextWeek}T00:00:00Z`).getUTCDay(), 1, "next week is a Monday");
    assert.ok(nextWeek > today && nextWeek <= await shifted(today, 7));
    await page.keyboard.press("d");
    await page.locator(`#due-calendar [data-cal-date='${today}']`).click();
    await page.waitForFunction(value => (document.querySelector("#detail-due-date") as HTMLInputElement).value === value, today);
    await page.keyboard.press("1");
  });

  await check("the keyboard map opens on ? and shows the keys for a list and for details", async () => {
    await page.keyboard.press("?");
    assert.equal(await page.locator("#help-backdrop").isVisible(), true);
    assert.equal(await page.locator(".map-key[data-k='Space'] em").innerText(), "Complete");
    assert.equal(await page.locator(".map-key[data-k='T'] em").innerText(), "Today");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator(".map-key[data-k='T'] em").innerText(), "Title");
    await noOverflow(page);
    await page.keyboard.press("?");
    assert.equal(await page.locator("#help-backdrop").isVisible(), false);
  });

  await check("the theme switch is remembered and the logo stays readable in the dark", async () => {
    await page.locator("#theme-button").click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
    assert.equal(await page.evaluate(() => localStorage.getItem("keydo.theme.v1")), "dark");
    assert.equal(await page.locator(".brand-word").isVisible(), true);
    await page.reload();
    await page.locator("#boot-overlay").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
    await page.locator("#theme-button").click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    assert.equal(await page.locator(".brand-word").isVisible(), false);
  });

  await check("DOM IDs and runtime are clean", async () => {
    const duplicates = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map(element => element.id);
      return ids.filter((id, index) => ids.indexOf(id) !== index);
    });
    assert.deepEqual(duplicates, []);
    assert.deepEqual(errors, []);
  });
  console.log(JSON.stringify({ checks, artifacts, todoistConfigured: false, runtimeErrors: errors }, null, 2));
} finally {
  await browser?.close();
  server.stop(true);
}
