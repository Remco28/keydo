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
    assert.equal(await page.locator("#detail-pane").isVisible(), true);
    await page.keyboard.press("Escape");
  });

  await check("detail keyboard map is available but collapsed", async () => {
    await page.locator(".task-row").first().focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator("#detail-pane").isVisible(), true);
    assert.equal(await page.locator(".detail-shortcuts").getAttribute("open"), null);
    assert.equal(await page.locator(".preview-column").isVisible(), true);
    await page.locator(".detail-shortcuts summary").click();
    assert.equal(await page.locator(".detail-shortcuts").getAttribute("open"), "");
    await page.locator(".detail-shortcuts summary").click();
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
    assert.equal(await page.locator("#detail-pane").isVisible(), true);
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
    assert.equal(await page.locator("#detail-pane").isVisible(), true);
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
      await recoveryPage.locator("#detail-pane").waitFor({ state: "visible" });
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
    await page.keyboard.press("Delete");
    assert.equal(await page.locator("#delete-backdrop").isVisible(), true);
    await page.keyboard.press("Escape");
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
    assert.equal(await page.locator(".preview-column").isVisible(), true);
    assert.equal(await page.locator("#toggle-notes-width").isVisible(), false);
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
