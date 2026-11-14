/* Keydo redesign mockup. Demo data only: nothing is read from or sent to Todoist. */
(() => {
  "use strict";

  // ── helpers ────────────────────────────────────────────────────────────────
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (n, cls = "") => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const KEY_LABEL = { Enter: "↵", "-": "−", "↑ ↓": "↑↓", "← →": "←→", PageUp: "PgUp", PageDown: "PgDn" };
  const key = (id, label) => `<kbd class="key" data-k="${esc(id)}">${esc(label ?? KEY_LABEL[id] ?? id)}</kbd>`;
  const keys = (...ids) => (ids.length > 1 ? `<span class="keys">${ids.map((id) => key(id)).join("")}</span>` : key(ids[0]));
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EASE = "cubic-bezier(.2,.8,.2,1)";
  const store = {
    get(k) { try { return localStorage.getItem("keydo.mockup." + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem("keydo.mockup." + k, v); } catch (e) { /* private window */ } },
  };

  // ── dates ──────────────────────────────────────────────────────────────────
  const D0 = new Date(); D0.setHours(0, 0, 0, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const shift = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const TODAY = iso(D0);
  const day = (n) => shift(TODAY, n);
  const diff = (s) => Math.round((parse(s) - D0) / 864e5);
  const fmt = (s, o) => parse(s).toLocaleDateString("en-GB", o);
  const nextMonday = () => day(((8 - D0.getDay()) % 7) || 7);
  function dueLabel(s) {
    const n = diff(s);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n === -1) return "Yesterday";
    if (n > 1 && n < 7) return fmt(s, { weekday: "long" });
    return fmt(s, { day: "numeric", month: "short" });
  }
  const dueLong = (s) => fmt(s, { weekday: "short", day: "numeric", month: "short" });

  // ── demo data ──────────────────────────────────────────────────────────────
  const PROJECTS = [
    { id: "inbox", name: "Inbox", color: "#8a8fa3" },
    { id: "launch", name: "Launch plan", color: "#7c5cff" },
    { id: "personal", name: "Personal", color: "#2c9a6a" },
    { id: "home", name: "Home", color: "#d97a06" },
    { id: "keydo", name: "Keydo", color: "#e0302c" },
    { id: "reading", name: "Reading list", color: "#2f6fdb" },
  ];
  const project = (id) => PROJECTS.find((p) => p.id === id) || PROJECTS[0];
  let seq = 0;
  const TASKS = [];
  function mk(title, proj, o = {}) {
    const t = { id: "t" + ++seq, title, project: proj, parent: null, due: null, pri: 4, notes: "", images: [], done: false, doneAt: null, doneSeq: 0, ord: seq, added: seq, ...o };
    TASKS.push(t);
    return t.id;
  }
  const launch = mk("Review the launch plan", "launch", {
    due: TODAY, pri: 1,
    notes: "The plan is in good shape. Before sign-off, check these:\n\n- [x] Timeline matches the engineering estimate\n- [ ] Pricing page copy is final\n- [ ] Support has the FAQ\n\n**Decision needed:** ship on Thursday, or hold for the `1.1` fixes.",
  });
  mk("Confirm the release date", "launch", { parent: launch, done: true, doneAt: day(-1), doneSeq: 1 });
  mk("Check pricing copy with Sam", "launch", { parent: launch, due: TODAY, pri: 2 });
  mk("Sign off on the announcement", "launch", { parent: launch });
  mk("Write the project update", "launch", { due: TODAY, pri: 2, notes: "Three paragraphs: what shipped, what slipped, what is next.\n\nKeep it short. Link the [launch board](https://example.com/board)." });
  mk("Renew car insurance", "home", { due: day(-2), pri: 2, notes: "Quote reference is in the email from last year. Compare two other providers first." });
  mk("Book a dentist appointment", "personal", { due: day(-1) });
  mk("Reply to the design review", "inbox", { due: TODAY, pri: 3 });
  mk("Update the README screenshot", "keydo", { due: TODAY, pri: 3, images: ["../docs/images/keydo-today.png"], notes: "Retake it once the new layout lands. This is the current one, for reference." });
  mk("Pick up prescription", "personal", { due: TODAY });
  mk("Draft the Q1 roadmap", "launch", { due: day(1), pri: 2 });
  mk("Call Alex about the venue", "personal", { due: day(1), pri: 3 });
  mk("Fix the leaking tap", "home", { due: day(2), pri: 3 });
  const slides = mk("Prepare slides for Thursday", "launch", { due: day(3), pri: 1 });
  mk("Outline the story", "launch", { parent: slides, due: day(2) });
  mk("Collect the numbers", "launch", { parent: slides, due: day(3) });
  mk("Order a birthday gift for Mum", "personal", { due: day(4), pri: 2 });
  mk("Pay council tax", "home", { due: day(6), pri: 2 });
  mk("Plan the spring trip", "personal", { due: day(12) });
  mk("Try the Todoist OAuth flow", "keydo", { pri: 3, notes: "Needs an app registration first. See `docs/decision-log.md`, open decisions." });
  mk("Read Shape Up, chapter 3", "reading");
  mk("Sort the garage shelves", "home");
  mk("Look into standing desk options", "inbox");
  mk("Cancel unused subscriptions", "inbox", { pri: 3 });
  mk("Morning review", "personal", { done: true, doneAt: TODAY, doneSeq: 2 });
  mk("Send the invoice to Northwind", "inbox", { done: true, doneAt: TODAY, doneSeq: 3 });
  mk("Water the plants", "home", { done: true, doneAt: TODAY, doneSeq: 4 });
  mk("Back up the laptop", "home", { done: true, doneAt: day(-1), doneSeq: 1 });
  let doneSeq = 10;

  const byId = (id) => TASKS.find((t) => t.id === id);
  const kidsOf = (id) => TASKS.filter((t) => t.parent === id).sort((a, b) => a.ord - b.ord);

  // ── state ──────────────────────────────────────────────────────────────────
  const VIEWS = [
    { id: "today", name: "Today", k: "1" },
    { id: "upcoming", name: "Upcoming", k: "2" },
    { id: "priority", name: "Priority", k: "3" },
    { id: "inbox", name: "Inbox", k: "4" },
    { id: "completed", name: "Completed", k: "5" },
  ];
  const SORTS = [
    { k: "D", by: "due", label: "Due date" },
    { k: "P", by: "priority", label: "Priority" },
    { k: "T", by: "title", label: "Title" },
    { k: "J", by: "project", label: "Project" },
    { k: "A", by: "added", label: "Date added" },
    { k: "M", by: "default", label: "Keydo order" },
  ];
  const S = {
    view: "today", back: "today", query: "",
    sel: null, order: [], anchor: null, bulk: new Set(), collapsed: new Set(),
    focus: "list", drill: [], dsub: null, edit: null,
    modal: null, pal: null, due: null, sortUi: null, helpCtx: "list", del: null,
    sort: {}, undo: [], exitKind: new Map(), pulse: new Set(), flash: null,
    sound: store.get("sound") === "on", counts: {}, cleared: false,
  };

  const el = {
    app: $("#app"), ls: $("#ls"), cursor: $("#cursor"), dp: $("#dp"), kb: $("#kb"),
    views: $("#nav-views"), projects: $("#nav-projects"), title: $("#view-title"), eyebrow: $("#eyebrow"),
    sum: $("#view-sum"), ring: $("#ring"), search: $("#search"), sortLabel: $("#sort-label"),
    toast: $("#toast"), overlay: $("#overlay"), fx: $("#fx"),
  };
  let modalEl = null;
  let rendering = false;
  const rowEls = new Map();

  // ── view model ─────────────────────────────────────────────────────────────
  const viewName = () => S.view === "search" ? "Search" : S.view.startsWith("p:") ? project(S.view.slice(2)).name : VIEWS.find((v) => v.id === S.view).name;
  const sortKey = () => (S.view.startsWith("p:") ? "project" : S.view);
  const sortOf = () => S.sort[sortKey()] || { by: "default", dir: 1 };
  const isStructured = () => S.view === "inbox" || S.view.startsWith("p:");

  function matches(t) {
    const v = S.view;
    if (v === "completed") return t.done;
    if (t.done) return false;
    if (v === "today") return !!t.due && t.due <= TODAY;
    if (v === "upcoming") return !!t.due && t.due > TODAY;
    if (v === "priority") return t.pri < 4;
    if (v === "inbox") return t.project === "inbox";
    if (v === "search") {
      const q = S.query.trim().toLowerCase();
      return !!q && (t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q));
    }
    return t.project === v.slice(2);
  }
  function groupOf(t) {
    switch (S.view) {
      case "today": return t.due < TODAY ? { k: "over", label: "Overdue", warn: true, o: 0 } : { k: "today", label: "Today", o: 1 };
      case "upcoming": return { k: t.due, label: dueLabel(t.due) + (diff(t.due) < 7 ? " · " + fmt(t.due, { day: "numeric", month: "short" }) : ""), o: t.due };
      case "priority": return { k: "p" + t.pri, label: "Priority " + t.pri, o: t.pri };
      case "completed": return t.doneAt >= TODAY ? { k: "d0", label: "Today", o: 0 } : { k: "d1", label: "Earlier", o: 1 };
      case "search": return { k: "r", label: "Results", o: 0 };
      default: return { k: "all", label: null, o: 0 };
    }
  }
  function comparator() {
    const { by, dir } = sortOf();
    const dueCmp = (a, b) => (a.due === b.due ? 0 : !a.due ? 1 : !b.due ? -1 : (a.due < b.due ? -1 : 1) * dir);
    if (by === "due") return (a, b) => dueCmp(a, b) || a.ord - b.ord;
    if (by === "priority") return (a, b) => (a.pri - b.pri) * dir || dueCmp(a, b) || a.ord - b.ord;
    if (by === "title") return (a, b) => a.title.localeCompare(b.title, "en", { numeric: true }) * dir;
    if (by === "project") return (a, b) => project(a.project).name.localeCompare(project(b.project).name) * dir || a.ord - b.ord;
    if (by === "added") return (a, b) => (b.added - a.added) * dir;
    const d = dir;
    switch (S.view) {
      case "today": case "upcoming": return (a, b) => ((a.pri - b.pri) || (a.ord - b.ord)) * d;
      case "priority": return (a, b) => (dueCmp(a, b) || a.ord - b.ord) * d;
      case "completed": return (a, b) => (b.doneSeq - a.doneSeq) * d;
      default: return (a, b) => (a.ord - b.ord) * d;
    }
  }
  function items() {
    const grouped = sortOf().by === "default";
    const m = TASKS.filter(matches);
    const ids = new Set(m.map((t) => t.id));
    const cmp = comparator();
    const roots = m.filter((t) => !(t.parent && ids.has(t.parent)));
    const g = (t) => (grouped ? groupOf(t) : { k: "all", label: null, o: 0 });
    roots.sort((a, b) => { const x = g(a).o, y = g(b).o; return x < y ? -1 : x > y ? 1 : cmp(a, b); });
    const out = [];
    let head = null;
    for (const t of roots) {
      const gr = g(t);
      if (gr.label && (!head || head.k !== gr.k)) { head = { type: "g", key: "g:" + gr.k, k: gr.k, label: gr.label, warn: gr.warn, n: 0 }; out.push(head); }
      const kids = m.filter((c) => c.parent === t.id).sort(cmp);
      const open = !S.collapsed.has(t.id);
      out.push({ type: "t", key: t.id, t, kids: kids.length, open });
      if (head) head.n += 1 + kids.length;
      if (open) for (const c of kids) out.push({ type: "t", key: c.id, t: c, child: true });
    }
    return out;
  }
  const dayStats = () => {
    const done = TASKS.filter((t) => t.done && t.doneAt === TODAY).length;
    const open = TASKS.filter((t) => !t.done && t.due && t.due <= TODAY).length;
    return { done, total: done + open };
  };

  // ── sound and sparkle ──────────────────────────────────────────────────────
  let ac = null;
  function tone(f, at, dur, vol = 0.05, type = "triangle") {
    if (!S.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + at;
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* audio unavailable */ }
  }
  const sfx = {
    done() { tone(784, 0, 0.16); tone(1174.7, 0.07, 0.3, 0.045); },
    back() { tone(587, 0, 0.12, 0.035, "sine"); },
    move() { tone(523, 0, 0.1, 0.035, "sine"); },
    add() { tone(659, 0, 0.1, 0.04, "sine"); tone(880, 0.06, 0.16, 0.035, "sine"); },
    clear() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.08, 0.34, 0.045)); },
  };
  function burst(target, n = 10, dist = 34) {
    if (reduceMotion || !target) return;
    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const cols = ["var(--p1)", "var(--p2)", "var(--p3)", "var(--ink)"];
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i");
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const d = dist * (0.6 + Math.random() * 0.6);
      const dash = i % 2;
      p.style.cssText = `left:${cx}px;top:${cy}px;width:${dash ? 9 : 5}px;height:${dash ? 3 : 5}px;background:${cols[i % 4]}`;
      el.fx.appendChild(p);
      const at = (x, s) => `translate(-50%,-50%) rotate(${a}rad) translateX(${x}px) scale(${s})`;
      p.animate(
        [{ transform: at(9, 1), opacity: 1 }, { transform: at(d * 0.85, 1), opacity: 1, offset: 0.55 }, { transform: at(d, 0.4), opacity: 0 }],
        { duration: 620, easing: "cubic-bezier(.15,.7,.3,1)" },
      ).onfinish = () => p.remove();
    }
  }

  // ── toast ──────────────────────────────────────────────────────────────────
  let toastTimer = 0;
  function toast(msg, o = {}) {
    el.toast.innerHTML = `${o.plain ? "" : icon("check")}<span class="msg">${esc(msg)}</span>${o.undo ? `<button type="button" data-act="undo" tabindex="-1">Undo ${key("Z")}</button>` : ""}`;
    el.toast.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("on"), o.undo ? 5000 : 2600);
  }

  // ── render: sidebar and header ─────────────────────────────────────────────
  function renderSide() {
    const open = TASKS.filter((t) => !t.done);
    const counts = {
      today: open.filter((t) => t.due && t.due <= TODAY).length,
      upcoming: open.filter((t) => t.due && t.due > TODAY).length,
      priority: open.filter((t) => t.pri < 4).length,
      inbox: open.filter((t) => t.project === "inbox").length,
      completed: TASKS.filter((t) => t.done && t.doneAt === TODAY).length,
    };
    for (const p of PROJECTS) if (p.id !== "inbox") counts["p:" + p.id] = open.filter((t) => t.project === p.id).length;
    const overdue = open.some((t) => t.due && t.due < TODAY);
    const ct = (id, hot) => {
      const changed = S.counts[id] != null && S.counts[id] !== counts[id];
      return `<span class="ct ${hot ? "hot" : ""} ${changed ? "bump" : ""}">${counts[id] || ""}</span>`;
    };
    el.views.innerHTML = VIEWS.map((v) =>
      `<button class="nav-item ${S.view === v.id ? "on" : ""}" type="button" tabindex="-1" data-go="${v.id}">${key(v.k)}<span class="nm">${v.name}</span>${ct(v.id, v.id === "today" && overdue)}</button>`).join("");
    el.projects.innerHTML = PROJECTS.filter((p) => p.id !== "inbox").map((p) =>
      `<button class="nav-item ${S.view === "p:" + p.id ? "on" : ""}" type="button" tabindex="-1" data-go="p:${p.id}"><span class="dot" style="color:${p.color}"></span><span class="nm">${esc(p.name)}</span>${ct("p:" + p.id)}</button>`).join("");
    S.counts = counts;
    const dark = document.documentElement.dataset.theme === "dark";
    $("#theme-btn").innerHTML = icon(dark ? "sun" : "moon");
    $("#theme-btn").title = dark ? "Switch to light theme" : "Switch to dark theme";
    $("#sound-btn").innerHTML = icon(S.sound ? "sound" : "mute");
    $("#sound-btn").title = S.sound ? "Turn sound off" : "Turn sound on";
  }

  function renderHead(its) {
    const tasks = its.filter((i) => i.type === "t").map((i) => i.t);
    const n = tasks.length;
    el.title.textContent = viewName();
    const eyebrow = {
      today: fmt(TODAY, { weekday: "long", day: "numeric", month: "long" }),
      upcoming: "From tomorrow", priority: "Priority 1 to 3", inbox: "Not yet in a project",
      completed: "Finished tasks", search: "All open tasks",
    };
    el.eyebrow.textContent = eyebrow[S.view] || "Project";
    let sum = n ? `<span><b>${n}</b> ${n === 1 ? "task" : "tasks"}</span>` : `<span>Nothing open</span>`;
    if (S.view === "today") {
      const hi = tasks.filter((t) => t.pri <= 2).length, od = tasks.filter((t) => t.due < TODAY).length;
      if (hi) sum += `<span><b>${hi}</b> high priority</span>`;
      if (od) sum += `<span class="warn"><b>${od}</b> overdue</span>`;
    } else if (S.view === "search") {
      sum = `<span><b>${n}</b> ${n === 1 ? "result" : "results"} for “${esc(S.query.trim())}”</span>`;
    } else if (S.view === "completed") {
      sum = `<span><b>${tasks.filter((t) => t.doneAt === TODAY).length}</b> done today</span><span><b>${n}</b> in total</span>`;
    }
    el.sum.innerHTML = sum;
    const so = sortOf();
    el.sortLabel.textContent = so.by === "default" && so.dir === 1 ? "Sort" : `${SORTS.find((s) => s.by === so.by).label} ${so.dir === 1 ? "↑" : "↓"}`;

    const { done, total } = dayStats();
    const C = 2 * Math.PI * 10;
    if (!el.ring.firstChild) {
      el.ring.innerHTML = `<svg viewBox="0 0 26 26"><circle class="trk" cx="13" cy="13" r="10"/><circle class="val" cx="13" cy="13" r="10" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><span class="num"></span><small>done today</small>`;
    }
    $(".val", el.ring).setAttribute("stroke-dashoffset", String(C * (1 - (total ? done / total : 0))));
    const num = $(".num", el.ring), txt = `${done} of ${total}`;
    if (num.textContent && num.textContent !== txt) { num.classList.remove("bump"); void num.offsetWidth; num.classList.add("bump"); }
    num.textContent = txt;
    document.title = `${viewName()}${n ? " · " + n : ""} — Keydo`;
  }

  // ── render: list ───────────────────────────────────────────────────────────
  function rowHtml(it) {
    const t = it.t, p = project(t.project);
    const subs = kidsOf(t.id);
    const meta = [];
    if (t.notes) meta.push(icon("note"));
    if (t.images.length) meta.push(icon("image"));
    if (subs.length) meta.push(`<span class="row-sub">${icon("tree")}${subs.filter((c) => c.done).length}/${subs.length}</span>`);
    if (!S.view.startsWith("p:") && S.view !== "inbox") meta.push(`<span class="row-proj"><span class="dot" style="color:${p.color}"></span><span>${esc(p.name)}</span></span>`);
    let due = "";
    if (t.done) due = `<span class="row-due">${t.doneAt ? dueLabel(t.doneAt) : ""}</span>`;
    else if (t.due) { const n = diff(t.due); due = `<span class="row-due ${n < 0 ? "over" : n === 0 ? "now" : ""}">${dueLabel(t.due)}</span>`; }
    else due = `<span class="row-due"></span>`;
    const tw = it.kids
      ? `<button class="tw ${it.open ? "open" : ""}" type="button" tabindex="-1" data-act="fold" aria-label="${it.open ? "Collapse" : "Expand"} subtasks">${icon("chev")}</button>`
      : `<span class="tw"></span>`;
    return `${tw}<button class="cb p${t.pri} ${t.done ? "done" : ""} ${S.pulse.has(t.id) ? "pulse" : ""}" type="button" tabindex="-1" data-act="check" aria-label="${t.done ? "Reopen" : "Complete"}">${icon("check")}</button><span class="row-title">${esc(t.title)}</span><span class="row-meta">${meta.join("")}${due}</span>`;
  }

  function emptyHtml() {
    if (S.view === "today") {
      const { done } = dayStats();
      return `<div class="keycheck"></div><strong>All clear for today</strong><p>${done ? plural(done, "task") + " done. " : ""}Press ${key("2")} to look ahead, or ${key("N")} to add something.</p>`;
    }
    if (S.view === "search") return `<strong>No matches</strong><p>Nothing open matches “${esc(S.query.trim())}”. Press ${key("Esc")} to clear the search.</p>`;
    if (S.view === "completed") return `<strong>Nothing finished yet</strong><p>Select a task and press ${key("Space")}.</p>`;
    return `<strong>Nothing here</strong><p>Press ${key("N")} to add a task.</p>`;
  }

  function startExit(k, node) {
    if (node.dataset.type !== "t") { node._gone = true; return; }
    const kind = S.exitKind.get(k) || "x-del";
    node._exit = true;
    node.classList.remove("sel", "bulk");
    node.classList.add(kind);
    if (kind === "x-done") burst($(".cb", node));
    node._t = setTimeout(() => { node._gone = true; renderList(); }, kind === "x-done" && !reduceMotion ? 470 : 200);
  }

  function renderList(o = {}) {
    const its = items();
    S.order = its.filter((i) => i.type === "t").map((i) => i.t.id);
    if (!S.order.includes(S.sel)) S.sel = S.order[0] ?? null;
    renderHead(its);

    if (o.fresh) {
      for (const node of rowEls.values()) { clearTimeout(node._t); node.remove(); }
      rowEls.clear();
      el.ls.scrollTop = 0;
    }
    const before = new Map();
    for (const [k, node] of rowEls) before.set(k, node.offsetTop);
    for (const [k, node] of rowEls) if (node._gone) { node.remove(); rowEls.delete(k); }

    const exiting = [...rowEls.values()].some((n) => n._exit);
    const list = its.length || exiting ? its : [{ type: "e", key: "empty" }];
    const want = new Set(list.map((i) => i.key));
    for (const [k, node] of rowEls) if (!want.has(k) && !node._exit) startExit(k, node);
    for (const [k, node] of rowEls) if (node._gone) { node.remove(); rowEls.delete(k); }

    let ref = el.cursor.nextElementSibling;
    list.forEach((it, n) => {
      let node = rowEls.get(it.key);
      if (node && node._exit) { clearTimeout(node._t); node._exit = false; }
      if (!node) {
        node = document.createElement("div");
        node.dataset.type = it.type;
        if (it.type === "t") { node.dataset.id = it.key; node.setAttribute("role", "listitem"); }
        node._new = n;
        rowEls.set(it.key, node);
      }
      let html, cls;
      if (it.type === "g") { html = `<span>${esc(it.label)}</span><span class="gh-n">${it.n}</span>`; cls = `gh ${it.warn ? "warn" : ""}`; }
      else if (it.type === "e") { html = emptyHtml(); cls = "empty"; }
      else {
        html = rowHtml(it);
        cls = `row ${it.child ? "child" : ""} ${it.t.done ? "is-done" : ""} ${S.sel === it.key ? "sel" : ""} ${S.bulk.has(it.key) ? "bulk" : ""} ${S.flash === it.key ? "flash" : ""}`;
      }
      if (node._sig !== html) { node.innerHTML = html; node._sig = html; }
      if (node.className !== cls) node.className = cls;
      while (ref && ref._exit) ref = ref.nextElementSibling;
      if (node === ref) ref = ref.nextElementSibling;
      else el.ls.insertBefore(node, ref);
    });
    S.pulse.clear();
    S.exitKind.clear();

    for (const [k, node] of rowEls) {
      if (node._exit || reduceMotion) { delete node._new; continue; }
      if (node._new != null) {
        const delay = o.fresh ? Math.min(node._new, 14) * 16 : 0;
        delete node._new;
        if (node.dataset.type === "e") { if (S.cleared) { S.cleared = false; setTimeout(() => { burst($(".keycheck", node), 26, 96); sfx.clear(); }, 180); } continue; }
        node.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 200, delay, easing: EASE, fill: "backwards" });
        continue;
      }
      const d = before.get(k) - node.offsetTop;
      if (d) node.animate([{ transform: `translateY(${d}px)` }, { transform: "none" }], { duration: 220, easing: EASE });
    }
    placeCursor(o.fresh);
  }

  function placeCursor(jump) {
    const node = S.sel && rowEls.get(S.sel);
    if (!node || node._exit) { el.cursor.classList.remove("on"); return; }
    const wasOn = el.cursor.classList.contains("on");
    if (jump || !wasOn) el.cursor.style.transition = "none";
    el.cursor.style.transform = `translateY(${node.offsetTop}px)`;
    el.cursor.classList.add("on");
    if (jump || !wasOn) { void el.cursor.offsetWidth; el.cursor.style.transition = ""; }
    if (S.order[0] === S.sel) el.ls.scrollTop = 0;
    else node.scrollIntoView({ block: "nearest" });
  }

  // ── render: details ────────────────────────────────────────────────────────
  const detailId = () => (S.drill.length ? S.drill[S.drill.length - 1] : S.sel);
  function md(src) {
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const out = [];
    let list = null;
    const flush = () => { if (list) { out.push(`<ul class="${list.chk ? "chk" : ""}">${list.items.join("")}</ul>`); list = null; } };
    for (const line of src.split("\n")) {
      let m;
      if ((m = line.match(/^\s*[-*] \[( |x)\] (.*)$/i))) { if (!list || !list.chk) { flush(); list = { chk: true, items: [] }; } list.items.push(`<li class="${m[1] !== " " ? "x" : ""}"><span>${inline(m[2])}</span></li>`); }
      else if ((m = line.match(/^\s*[-*] (.*)$/))) { if (!list || list.chk) { flush(); list = { chk: false, items: [] }; } list.items.push(`<li>${inline(m[1])}</li>`); }
      else if ((m = line.match(/^#{1,3} (.*)$/))) { flush(); out.push(`<h4>${inline(m[1])}</h4>`); }
      else if (line.trim() === "") flush();
      else { flush(); out.push(`<p>${inline(line)}</p>`); }
    }
    flush();
    return out.join("");
  }

  function renderDetail() {
    const t = byId(detailId());
    if (!t) {
      el.dp.innerHTML = `<div class="dp-empty"><p>No task selected.<br>Details appear here as you move through a list.</p></div>`;
      return;
    }
    rendering = true;
    const live = {};
    for (const f of $$("[data-field]", el.dp)) live[f.dataset.field] = f.value;
    const p = project(t.project), parent = t.parent && byId(t.parent);
    const subs = kidsOf(t.id), subsDone = subs.filter((c) => c.done).length;
    const over = t.due && !t.done && t.due < TODAY;
    const crumb = `<span class="crumb"><span class="dot" style="color:${p.color}"></span>${esc(p.name)}${parent ? `<span class="sep">›</span>${esc(parent.title)}` : ""}</span>`;
    const title = S.edit === "title"
      ? `<input class="field" data-field="title" value="${esc(live.title ?? t.title)}" aria-label="Task title">`
      : `<h2>${esc(t.title)}</h2><span class="k">${key("T")}</span>`;
    const notes = S.edit === "notes"
      ? `<textarea class="field" data-field="notes" aria-label="Task notes" placeholder="Add a note, a link, or a little context. Markdown works.">${esc(live.notes ?? t.notes)}</textarea><div class="hint">${keys("Ctrl", "Enter")} save · ${key("Esc")} done</div>`
      : t.notes ? `<div class="md" data-act="notes">${md(t.notes)}</div>` : `<div class="md none" data-act="notes">No notes yet.</div>`;
    el.dp.innerHTML = `<div class="dp-in">
      <div class="dp-top">${crumb}<span class="open-hint">${key("Enter")} to work on it</span></div>
      <div class="dp-title ${t.done ? "is-done" : ""}">
        <button class="cb cb-lg p${t.pri} ${t.done ? "done" : ""}" type="button" tabindex="-1" data-act="dcheck" aria-label="${t.done ? "Reopen" : "Complete"}">${icon("check")}</button>${title}
      </div>
      <div class="props">
        <button class="prop" type="button" tabindex="-1" data-act="due"><span class="prop-l">Due<span class="k">${key("D")}</span></span><span class="prop-v ${over ? "over" : ""} ${t.due ? "" : "none"}">${icon("cal")}${t.due ? (Math.abs(diff(t.due)) > 1 ? dueLong(t.due) : dueLabel(t.due)) : "No date"}</span></button>
        <button class="prop" type="button" tabindex="-1" data-act="pri"><span class="prop-l">Priority<span class="k">${keys("-", "+")}</span></span><span class="prop-v">${icon("flag", "flag")}Priority ${t.pri}</span></button>
        <button class="prop" type="button" tabindex="-1" data-act="move"><span class="prop-l">Project<span class="k">${key("M")}</span></span><span class="prop-v"><span class="dot" style="color:${p.color}"></span>${esc(p.name)}</span></button>
      </div>
      <section class="sec">
        <div class="sec-h"><h3>Notes</h3><span class="sp"></span><span class="k">${key("N")}</span></div>
        ${notes}
      </section>
      <section class="sec">
        <div class="sec-h"><h3>Subtasks</h3>${subs.length ? `<span class="cnt">${subsDone} of ${subs.length}</span>` : ""}<span class="sp"></span><span class="k">${key("S")}</span></div>
        ${subs.length ? `<div class="bar"><i style="width:${(subsDone / subs.length) * 100}%"></i></div>` : ""}
        <div class="subs">${subs.map((c) => `<div class="sub ${c.done ? "is-done" : ""} ${S.focus === "detail" && S.dsub === c.id ? "cur" : ""}" data-sub="${c.id}"><button class="cb p${c.pri} ${c.done ? "done" : ""}" type="button" tabindex="-1" data-act="subcheck" aria-label="${c.done ? "Reopen" : "Complete"}">${icon("check")}</button><span class="t">${esc(c.title)}</span>${c.due && !c.done ? `<span class="due">${dueLabel(c.due)}</span>` : ""}</div>`).join("")}</div>
        <input class="field" data-field="subadd" placeholder="Add a subtask" autocomplete="off" aria-label="New subtask title" value="${esc(live.subadd ?? "")}">
      </section>
      <section class="sec">
        <div class="sec-h"><h3>Screenshots</h3>${t.images.length ? `<span class="cnt">${t.images.length}</span>` : ""}</div>
        ${t.images.length ? `<div class="shots">${t.images.map((src) => `<img src="${esc(src)}" alt="Screenshot attached to this task">`).join("")}</div>` : ""}
        <div class="hint">Paste with ${keys("Ctrl", "V")} to attach a screenshot.</div>
      </section>
      <div class="dp-foot"><span>${t.done ? "Completed " + dueLabel(t.doneAt || TODAY).toLowerCase() : "Open"} · in ${esc(p.name)}</span><a href="#" data-act="todoist">Open in Todoist ${icon("ext")}</a></div>
    </div>`;
    el.dp.querySelector(".prop-v .flag").parentElement.style.setProperty("--c", `var(--p${t.pri})`);
    if (S.edit) {
      const f = $(`[data-field="${S.edit}"]`, el.dp);
      if (f && document.activeElement !== f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
    }
    rendering = false;
  }

  // ── render: key bar ────────────────────────────────────────────────────────
  function context() {
    if (S.modal) return S.modal;
    if (document.activeElement === el.search) return "search";
    if (S.edit) return S.edit;
    if (S.bulk.size) return "bulk";
    return S.focus;
  }
  function renderBar() {
    const t = byId(detailId());
    const BARS = {
      list: ["List", [[["↑ ↓"], "Select"], [["Space"], S.view === "completed" ? "Reopen" : "Complete"], [["Enter"], "Details"], [["T"], "Today"], [["D"], "Date"], [["-", "+"], "Priority"], [["M"], "Move"], [["N"], "New"], [["/"], "Search"], [["Z"], "Undo"]]],
      detail: ["Details", [[["T"], "Title"], [["N"], "Notes"], [["D"], "Date"], [["S"], "Add subtask"], [["Shift", "S"], "Browse subtasks"], [["C"], t && t.done ? "Reopen" : "Complete"], [["Esc"], "Back to list"]]],
      bulk: [`${S.bulk.size} selected`, [[["Space"], "Complete"], [["T"], "Today"], [["Shift", "T"], "Tomorrow"], [["C"], "No date"], [["M"], "Move"], [["Del"], "Delete"], [["Esc"], "Clear selection"]]],
      search: ["Search", [[["Enter"], "Go to results"], [["Esc"], "Clear"]]],
      title: ["Title", [[["Enter"], "Save"], [["Esc"], "Cancel"]]],
      notes: ["Notes", [[["Ctrl", "Enter"], "Save"], [["Esc"], "Done"], [["Alt", "T"], "Title"], [["Alt", "S"], "Add subtask"]]],
      subadd: ["Subtask", [[["Enter"], "Add"], [["Esc"], "Done"]]],
      palette: ["Commands", [[["↑ ↓"], "Choose"], [["Enter"], "Run"], [["Esc"], "Close"]]],
      due: ["Date", [[["↑ ↓"], "Choose"], [["Enter"], "Apply"], [["Esc"], "Cancel"]]],
      sort: ["Sort", [[["↑ ↓"], "Choose"], [["Enter"], "Apply"], [["Esc"], "Cancel"]]],
      capture: ["New task", [[["Enter"], "Add"], [["Esc"], "Cancel"]]],
      help: ["Keyboard map", [[["← →"], "List or details"], [["Esc"], "Close"]]],
      delete: ["Delete", [[["Enter"], "Delete"], [["Esc"], "Cancel"]]],
    };
    const c = context();
    const [label, list] = BARS[c] || BARS.list;
    const cell = ([ks, text]) => `<span>${keys(...ks)}${text}</span>`;
    el.kb.innerHTML = `<span class="kb-ctx ${c === "list" ? "" : "alt"}">${esc(label)}</span><div class="kb-keys">${list.map(cell).join("")}</div><div class="kb-right">${[["goto", ["G"], "Go to"], ["all", ["Ctrl", "K"], "Commands"], ["help", ["?"], "All keys"]].map(([act, ks, text]) => `<button type="button" tabindex="-1" data-kb="${act}">${keys(...ks)}${text}</button>`).join("")}</div>`;
    el.app.dataset.focus = S.focus;
  }

  function render(o = {}) {
    renderSide();
    renderList(o);
    renderDetail();
    renderBar();
  }

  // ── actions ────────────────────────────────────────────────────────────────
  const current = () => byId(S.focus === "detail" ? (S.dsub || detailId()) : S.sel);
  const targets = () => (S.bulk.size ? [...S.bulk] : current() ? [current().id] : []);
  const nameOf = (ids) => (ids.length === 1 ? `“${byId(ids[0]).title}”` : plural(ids.length, "task"));

  /** Apply a change, keep the cursor where D-017 says it belongs, and offer undo. */
  function commit(o) {
    const old = S.order.slice(), i = old.indexOf(S.sel), selBefore = S.sel, view = S.view;
    const now = new Set(items().filter((x) => x.type === "t").map((x) => x.t.id));
    if (!now.has(S.sel)) {
      let pick = null;
      for (let j = i + 1; j < old.length && !pick; j++) if (now.has(old[j])) pick = old[j];
      for (let j = i - 1; j >= 0 && !pick; j--) if (now.has(old[j])) pick = old[j];
      S.sel = pick;
    }
    if (o.select && now.has(o.select)) S.sel = o.select;
    S.bulk.clear(); S.anchor = null;
    if (o.undo) S.undo.push({ fn: o.undo, sel: selBefore, view });
    if (S.view === "today" && !now.size && old.length && o.sfx === "done") S.cleared = true;
    render();
    if (o.toast) toast(o.toast, { undo: !!o.undo });
    if (o.sfx && !S.cleared) sfx[o.sfx]();
  }
  function undo() {
    const u = S.undo.pop();
    if (!u) { toast("Nothing to undo", { plain: true }); return; }
    u.fn();
    if (u.view === S.view && u.sel) S.sel = u.sel;
    S.bulk.clear();
    render();
    toast("Undone");
    sfx.back();
  }

  function complete(ids) {
    const ts = ids.map(byId).filter(Boolean);
    if (!ts.length) return;
    const reopen = ts.every((t) => t.done);
    const changed = [];
    const set = (t, v) => {
      if (t.done === v) return;
      changed.push([t, t.done, t.doneAt, t.doneSeq]);
      t.done = v; t.doneAt = v ? TODAY : null; t.doneSeq = v ? ++doneSeq : 0;
      S.exitKind.set(t.id, v ? "x-done" : "x-back");
    };
    for (const t of ts) { set(t, !reopen); if (!reopen) kidsOf(t.id).forEach((c) => set(c, true)); }
    commit({
      toast: `${reopen ? "Reopened" : "Completed"} ${nameOf(ids)}`,
      sfx: reopen ? "back" : "done",
      undo: () => changed.forEach(([t, d, a, s]) => { t.done = d; t.doneAt = a; t.doneSeq = s; }),
    });
  }
  function setDue(ids, due) {
    const ts = ids.map(byId).filter((t) => t && !t.done && t.due !== due);
    if (!ts.length) { toast(due === TODAY ? "Already due today" : due ? "Already on that date" : "No date to clear", { plain: true }); return; }
    const prev = ts.map((t) => [t, t.due]);
    for (const t of ts) { S.exitKind.set(t.id, !due || (t.due && due > t.due) || !t.due ? "x-away" : "x-back"); t.due = due; }
    const what = due === TODAY ? "Moved to Today" : due === day(1) ? "Moved to Tomorrow" : due ? `Due ${dueLong(due)}` : "Date cleared";
    commit({ toast: `${what} · ${nameOf(ts.map((t) => t.id))}`, sfx: "move", undo: () => prev.forEach(([t, d]) => { t.due = d; }) });
  }
  function bumpPri(ids, delta) {
    const ts = ids.map(byId).filter((t) => t && !t.done);
    const prev = ts.map((t) => [t, t.pri]);
    let any = false;
    for (const t of ts) { const n = clamp(t.pri - delta, 1, 4); if (n !== t.pri) { t.pri = n; any = true; S.pulse.add(t.id); S.exitKind.set(t.id, "x-away"); } }
    if (!any) { toast(delta > 0 ? "Already the highest priority" : "Already the lowest priority", { plain: true }); return; }
    commit({ toast: ts.length === 1 ? `Priority ${ts[0].pri}` : `Priority changed for ${plural(ts.length, "task")}`, sfx: "move", undo: () => prev.forEach(([t, v]) => { t.pri = v; }) });
  }
  function moveTo(ids, pid) {
    const ts = ids.map(byId).filter((t) => t && t.project !== pid);
    if (!ts.length) return;
    const all = ts.flatMap((t) => [t, ...kidsOf(t.id)]);
    const prev = all.map((t) => [t, t.project, t.parent]);
    for (const t of ts) { t.parent = null; S.exitKind.set(t.id, "x-away"); }
    for (const t of all) t.project = pid;
    commit({ toast: `Moved to ${project(pid).name} · ${nameOf(ts.map((t) => t.id))}`, sfx: "move", undo: () => prev.forEach(([t, p, par]) => { t.project = p; t.parent = par; }) });
  }
  function remove(ids) {
    const all = new Set(ids.flatMap((id) => [id, ...kidsOf(id).map((c) => c.id)]));
    const label = nameOf(ids);
    for (let i = TASKS.length - 1; i >= 0; i--) if (all.has(TASKS[i].id)) TASKS.splice(i, 1);
    S.drill = []; S.dsub = null;
    commit({ toast: `Deleted ${label}`, sfx: "back" });
  }
  function reorder(d) {
    const t = byId(S.sel);
    if (!t) return;
    if (!isStructured() || sortOf().by !== "default") { toast(isStructured() ? "Switch to Keydo order to reorder: B, then M" : "Reordering works in a project. Press R to open this task’s project", { plain: true }); return; }
    const sib = TASKS.filter((x) => matches(x) && x.parent === t.parent).sort((a, b) => a.ord - b.ord);
    const o = sib[sib.indexOf(t) + d];
    if (!o) return;
    [t.ord, o.ord] = [o.ord, t.ord];
    render();
  }
  function fold(id, open) {
    const it = items().find((x) => x.key === id);
    if (!it || !it.kids) { const t = byId(id); if (t && t.parent && open === false && S.order.includes(t.parent)) { S.sel = t.parent; render(); } return; }
    const want = open ?? !it.open;
    if (want) S.collapsed.delete(id); else S.collapsed.add(id);
    render();
  }

  function go(view, selId) {
    S.view = view; S.bulk.clear(); S.anchor = null; S.focus = "list"; S.drill = []; S.dsub = null; S.edit = null;
    if (view !== "search") { S.query = ""; el.search.value = ""; }
    S.sel = selId || null;
    render({ fresh: true });
  }
  function move(d, extend) {
    if (!S.order.length) return;
    const i = Math.max(0, S.order.indexOf(S.sel)), j = clamp(i + d, 0, S.order.length - 1);
    if (extend) {
      if (S.anchor == null) S.anchor = i;
      S.bulk = new Set(S.order.slice(Math.min(S.anchor, j), Math.max(S.anchor, j) + 1));
    } else S.anchor = null;
    S.sel = S.order[j];
    render();
  }
  function openDetail() { if (!byId(S.sel)) return; S.focus = "detail"; S.dsub = null; render(); }
  function leaveDetail() { S.focus = "list"; S.drill = []; S.dsub = null; S.edit = null; render(); }
  function edit(what) { if (!byId(detailId())) return; S.focus = "detail"; S.edit = what; S.dsub = null; render(); }
  function saveEdit(cancel) {
    const t = byId(detailId()), what = S.edit;
    if (!what) return;
    const f = $(`[data-field="${what}"]`, el.dp);
    S.edit = null;
    if (t && f && !cancel && what !== "subadd") {
      const v = what === "title" ? f.value.trim() : f.value.replace(/\s+$/, "");
      if (what === "title" && v && v !== t.title) { t.title = v; toast("Title saved"); }
      if (what === "notes" && v !== t.notes) { t.notes = v; toast("Notes saved"); }
    }
    if (f) { f.value = ""; f.blur(); }
    render();
  }
  function addSub(title) {
    const t = byId(detailId());
    if (!t || !title.trim()) return;
    const id = mk(title.trim(), t.project, { parent: t.id });
    $(`[data-field="subadd"]`, el.dp).value = "";
    S.undo.push({ fn: () => { const i = TASKS.findIndex((x) => x.id === id); if (i >= 0) TASKS.splice(i, 1); }, sel: S.sel, view: S.view });
    render();
    sfx.add();
  }
  function browseSubs() {
    const subs = kidsOf(detailId());
    if (!subs.length) return edit("subadd");
    S.focus = "detail"; S.edit = null; S.dsub = subs[0].id; render();
  }

  // ── overlays ───────────────────────────────────────────────────────────────
  function openModal(name, cls, center) {
    S.modal = name;
    el.overlay.innerHTML = `<div class="ov ${center ? "center" : ""}"><div class="modal ${cls}" role="dialog" aria-modal="true"></div></div>`;
    const ov = el.overlay.firstChild;
    modalEl = ov.firstChild;
    ov.addEventListener("mousedown", (e) => { if (e.target === ov) closeModal(); });
  }
  function closeModal() { S.modal = null; el.overlay.innerHTML = ""; modalEl = null; render(); }

  // command palette
  function commands(mode) {
    const t = current(), ids = targets(), list = [];
    const add = (sec, label, ks, run, extra) => list.push({ sec, label, ks, run, ...extra });
    if (mode === "move") {
      for (const p of PROJECTS) add("Move to project", p.name, null, () => moveTo(ids, p.id), { dot: p.color, on: t && t.project === p.id });
      return list;
    }
    if (mode === "all" && t) {
      const sec = ids.length > 1 ? `${ids.length} selected tasks` : "This task";
      add(sec, t.done ? "Reopen" : "Complete", ["Space"], () => complete(ids));
      add(sec, "Move to Today", ["T"], () => setDue(ids, TODAY));
      add(sec, "Move to Tomorrow", ["Shift", "T"], () => setDue(ids, day(1)));
      add(sec, "Change date…", ["D"], () => openDue());
      add(sec, "Clear date", ["C"], () => setDue(ids, null));
      add(sec, "Raise priority", ["+"], () => bumpPri(ids, 1));
      add(sec, "Lower priority", ["-"], () => bumpPri(ids, -1));
      add(sec, "Move to project…", ["M"], () => openPalette("move"));
      add(sec, "Add subtask", ["S"], () => edit("subadd"));
      add(sec, "Delete…", ["Del"], () => openDelete(), { danger: true });
    }
    for (const v of VIEWS) add("Go to", v.name, [v.k], () => go(v.id));
    for (const p of PROJECTS) if (p.id !== "inbox") add("Go to", p.name, null, () => go("p:" + p.id), { dot: p.color });
    if (mode === "all") {
      const dark = document.documentElement.dataset.theme === "dark";
      add("Keydo", "New task", ["N"], () => openCapture());
      add("Keydo", "Sort this view…", ["B"], () => openSort());
      add("Keydo", "Search all tasks", ["/"], () => el.search.focus());
      add("Keydo", "Undo", ["Z"], () => undo());
      add("Keydo", "Keyboard map", ["?"], () => openHelp());
      add("Keydo", dark ? "Switch to light theme" : "Switch to dark theme", null, () => toggleTheme());
      add("Keydo", S.sound ? "Turn sound off" : "Turn sound on", null, () => toggleSound());
    }
    return list;
  }
  function fuzzy(label, q) {
    if (!q) return { score: 0, html: esc(label) };
    const l = label.toLowerCase();
    const at = l.indexOf(q);
    if (at >= 0) return { score: at === 0 ? 0 : /\s/.test(l[at - 1]) ? 1 : 2, html: esc(label.slice(0, at)) + "<b>" + esc(label.slice(at, at + q.length)) + "</b>" + esc(label.slice(at + q.length)) };
    let i = 0, html = "";
    for (const ch of label) { if (i < q.length && ch.toLowerCase() === q[i]) { html += "<b>" + esc(ch) + "</b>"; i++; } else html += esc(ch); }
    return i === q.length ? { score: 5, html } : null;
  }
  function openPalette(mode) {
    openModal("palette", "");
    S.pal = { mode, q: "", i: 0, list: [] };
    const ph = { all: "Type a command, a view or a project", goto: "Go to a view or project", move: "Move to which project?" }[mode];
    modalEl.innerHTML = `<input class="big-input" id="pal-in" placeholder="${ph}" autocomplete="off" spellcheck="false" aria-label="${ph}"><div class="opts" id="pal-list"></div><div class="modal-f"><span>${key("↑ ↓")} choose</span><span>${key("Enter")} run</span><span class="sp"></span><span>${key("Esc")} close</span></div>`;
    const input = $("#pal-in");
    input.addEventListener("input", () => { S.pal.q = input.value.trim().toLowerCase(); S.pal.i = 0; renderPal(); });
    renderPal();
    input.focus();
    renderBar();
  }
  function renderPal() {
    const { mode, q } = S.pal;
    let list = commands(mode).map((c) => ({ ...c, m: fuzzy(c.label, q) })).filter((c) => c.m);
    if (q) list.sort((a, b) => a.m.score - b.m.score);
    S.pal.list = list;
    S.pal.i = clamp(S.pal.i, 0, Math.max(0, list.length - 1));
    let sec = null;
    $("#pal-list").innerHTML = list.length ? list.map((c, i) => {
      const head = !q && c.sec !== sec ? `<div class="opt-sec">${esc(c.sec)}</div>` : "";
      sec = c.sec;
      return `${head}<div class="opt ${i === S.pal.i ? "cur" : ""} ${c.on ? "on" : ""} ${c.danger ? "danger" : ""}" data-pal="${i}">${c.dot ? `<span class="dot" style="color:${c.dot}"></span>` : ""}<span class="lb">${c.m.html}</span>${c.on ? `<span class="sub-l">current</span>` : ""}${q && c.sec ? `<span class="sub-l">${esc(c.sec)}</span>` : ""}${c.ks ? `<span>${keys(...c.ks)}</span>` : ""}</div>`;
    }).join("") : `<div class="opts-none">No command matches. Press ${key("Esc")} to close.</div>`;
    const cur = $(".opt.cur", modalEl);
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }
  function runPal(i) { const c = S.pal.list[i]; if (!c) return; closeModal(); c.run(); }

  // due date chooser
  const DUE_OPTS = () => [
    { k: "T", label: "Today", date: TODAY },
    { k: "Y", label: "Tomorrow", date: day(1) },
    { k: "W", label: "Next week", date: nextMonday() },
    { k: "D", label: "Pick a date", cal: true },
    { k: "C", label: "No date", date: null },
  ];
  function openDue() {
    const ids = targets();
    if (!ids.length) return;
    openModal("due", "due-modal");
    const t = byId(ids[0]);
    S.due = { ids, i: 0, cal: false, date: t.due && t.due > TODAY ? t.due : TODAY };
    renderDue();
    renderBar();
  }
  function renderDue() {
    const d = S.due, t = byId(d.ids[0]);
    const cur = parse(d.date), y = cur.getFullYear(), m = cur.getMonth();
    const first = new Date(y, m, 1), start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
    let cells = "";
    for (let i = 0; i < 42; i++) {
      const c = new Date(start); c.setDate(start.getDate() + i);
      const s = iso(c);
      cells += `<span class="${c.getMonth() !== m ? "out" : ""} ${s === TODAY ? "tdy" : ""} ${s === d.date ? "cur" : ""} ${s === t.due ? "has" : ""}" data-date="${s}">${c.getDate()}</span>`;
    }
    modalEl.innerHTML = `<div class="modal-h"><h2>Due date</h2><p>${esc(d.ids.length > 1 ? plural(d.ids.length, "task") : t.title)}</p></div>
      <div class="due-body">
        <div class="opts">${DUE_OPTS().map((o, i) => `<div class="opt ${!d.cal && i === d.i ? "cur" : ""}" data-due="${i}"><span class="lb">${o.label}</span>${o.date ? `<span class="sub-l">${dueLong(o.date)}</span>` : ""}${key(o.k)}</div>`).join("")}</div>
        <div class="cal ${d.cal ? "on" : ""}"><div class="cal-h"><span>${fmt(d.date, { month: "long", year: "numeric" })}</span><span>${d.cal ? dueLong(d.date) : ""}</span></div>
          <div class="cal-g">${["M", "T", "W", "T", "F", "S", "S"].map((w) => `<span class="wd">${w}</span>`).join("")}${cells}</div></div>
      </div>
      <div class="modal-f">${d.cal ? `<span>${keys("← →", "↑ ↓")} move</span><span>${keys("PageUp", "PageDown")} month</span><span>${key("Enter")} apply</span>` : `<span>${key("↑ ↓")} choose</span><span>${key("Enter")} apply</span>`}<span class="sp"></span><span>${key("Esc")} cancel</span></div>`;
  }
  function applyDue(date) { const ids = S.due.ids; closeModal(); setDue(ids, date); }
  function dueKey(e, k) {
    const d = S.due;
    if (k === "Esc") return closeModal();
    const quick = DUE_OPTS().find((o) => o.k === k);
    if (quick && !quick.cal) return applyDue(quick.date);
    if (k === "D") { d.cal = !d.cal; d.i = 3; return renderDue(); }
    if (d.cal) {
      const step = { "←": -1, "→": 1, "↑": -7, "↓": 7 }[k];
      if (step) { d.date = shift(d.date, step); return renderDue(); }
      if (k === "PageUp" || k === "PageDown") { const c = parse(d.date); c.setMonth(c.getMonth() + (k === "PageDown" ? 1 : -1)); d.date = iso(c); return renderDue(); }
      if (k === "Enter") return applyDue(d.date);
      return;
    }
    if (k === "↓" || k === "↑") { d.i = clamp(d.i + (k === "↓" ? 1 : -1), 0, 4); return renderDue(); }
    if (k === "Enter" || k === "→") { const o = DUE_OPTS()[d.i]; if (o.cal) { d.cal = true; return renderDue(); } if (k === "Enter") return applyDue(o.date); }
  }

  // sort chooser
  function openSort() {
    openModal("sort", "confirm");
    S.sortUi = { i: Math.max(0, SORTS.findIndex((s) => s.by === sortOf().by)) };
    renderSort();
    renderBar();
  }
  function renderSort() {
    const so = sortOf();
    modalEl.innerHTML = `<div class="modal-h"><h2>Sort by</h2><p>${esc(viewName())} · display only, Todoist order never changes</p></div>
      <div class="opts">${SORTS.map((s, i) => `<div class="opt ${i === S.sortUi.i ? "cur" : ""} ${s.by === so.by ? "on" : ""}" data-sort="${i}"><span class="lb">${s.label}</span>${s.by === so.by ? `<span class="sub-l">${so.dir === 1 ? "ascending" : "reversed"}</span>` : ""}${key(s.k)}</div>`).join("")}
      <div class="opt" data-sort="r"><span class="lb">Reverse direction</span>${key("R")}</div></div>
      <div class="modal-f"><span>${key("↑ ↓")} choose</span><span>${key("Enter")} apply</span><span class="sp"></span><span>${key("Esc")} cancel</span></div>`;
  }
  function applySort(by) {
    const so = sortOf();
    S.sort[sortKey()] = by === "r" ? { by: so.by, dir: -so.dir } : by === so.by ? { by, dir: -so.dir } : { by, dir: 1 };
    closeModal();
    const now = sortOf();
    toast(`Sorted by ${SORTS.find((s) => s.by === now.by).label.toLowerCase()}${now.dir === -1 ? ", reversed" : ""}`);
    sfx.move();
  }
  function sortKeyDown(e, k) {
    if (k === "Esc") return closeModal();
    if (k === "R") return applySort("r");
    const s = SORTS.find((x) => x.k === k);
    if (s) return applySort(s.by);
    if (k === "↓" || k === "↑") { S.sortUi.i = clamp(S.sortUi.i + (k === "↓" ? 1 : -1), 0, SORTS.length - 1); return renderSort(); }
    if (k === "Enter") return applySort(SORTS[S.sortUi.i].by);
  }

  // capture
  function parseCapture(text) {
    let title = text, due = null, pri = 4, proj = null;
    title = title.replace(/(^|\s)p([1-4])(?=\s|$)/i, (m, a, n) => { pri = +n; return a; });
    title = title.replace(/(^|\s)#([\w-]+)/, (m, a, name) => {
      const p = PROJECTS.find((x) => x.name.toLowerCase().replace(/\s+/g, "").startsWith(name.toLowerCase()));
      if (!p) return m;
      proj = p.id; return a;
    });
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    title = title.replace(/(^|\s)(today|tomorrow|next week|in (\d+) days?|(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*)(?=\s|$)/i, (m, a, w, n) => {
      const s = w.toLowerCase();
      if (s === "today") due = TODAY;
      else if (s === "tomorrow") due = day(1);
      else if (s === "next week") due = nextMonday();
      else if (n) due = day(+n);
      else { const i = days.findIndex((d) => d.startsWith(s) || s.startsWith(d.slice(0, 3)) && d.startsWith(s.slice(0, 3))); if (i < 0) return m; due = day(((i - D0.getDay() + 7) % 7) || 7); }
      return a;
    });
    return { title: title.replace(/\s+/g, " ").trim(), due, pri, proj };
  }
  function openCapture() {
    openModal("capture", "");
    modalEl.innerHTML = `<input class="big-input" id="cap-in" placeholder="What needs doing?" autocomplete="off" aria-label="New task"><div class="chips" id="cap-chips"></div><div class="modal-f"><span>${key("Enter")} add</span><span class="sp"></span><span>${key("Esc")} cancel</span></div>`;
    const input = $("#cap-in");
    input.addEventListener("input", renderChips);
    renderChips();
    input.focus();
    renderBar();
  }
  function renderChips() {
    const c = parseCapture($("#cap-in").value);
    const chips = [];
    if (c.due) chips.push(`<span class="chip">${icon("cal")}${dueLabel(c.due)}</span>`);
    if (c.proj) chips.push(`<span class="chip"><span class="dot" style="color:${project(c.proj).color}"></span>${esc(project(c.proj).name)}</span>`);
    if (c.pri < 4) chips.push(`<span class="chip">${icon("flag")}<span style="color:var(--p${c.pri})">Priority ${c.pri}</span></span>`);
    const html = chips.length ? chips.join("") : `Try <b>Call Alex tomorrow #personal p2</b>. Dates, <b>#project</b> and <b>p1</b> to <b>p4</b> are picked out as you type.`;
    const box = $("#cap-chips");
    if (box.dataset.sig !== html) { box.innerHTML = html; box.dataset.sig = html; }
  }
  function addCapture() {
    const c = parseCapture($("#cap-in").value);
    if (!c.title) return;
    const proj = c.proj || (S.view.startsWith("p:") ? S.view.slice(2) : "inbox");
    const id = mk(c.title, proj, { due: c.due, pri: c.pri });
    closeModal();
    const shown = matches(byId(id));
    if (shown) { S.flash = id; setTimeout(() => { if (S.flash === id) S.flash = null; }, 1300); }
    commit({
      select: id,
      toast: shown ? `Added ${`“${c.title}”`}` : `Added to ${project(proj).name}${c.due ? " · " + dueLabel(c.due) : ""}`,
      sfx: "add",
      undo: () => { const i = TASKS.findIndex((x) => x.id === id); if (i >= 0) TASKS.splice(i, 1); },
    });
  }

  // delete confirmation
  function openDelete() {
    const ids = targets();
    if (!ids.length) return;
    S.del = ids;
    openModal("delete", "confirm", true);
    const subs = ids.reduce((n, id) => n + kidsOf(id).length, 0);
    modalEl.innerHTML = `<div class="modal-h"><h2>Delete ${ids.length === 1 ? "this task" : plural(ids.length, "task")}?</h2><p>${ids.length === 1 ? esc(nameOf(ids)) + " is" : "They are"} removed from Keydo and Todoist${subs ? `, with ${plural(subs, "subtask")}` : ""}. This cannot be undone.</p></div>
      <div class="modal-f"><button class="btn" type="button" data-act="close" tabindex="-1">Cancel ${key("Esc")}</button><button class="btn primary" type="button" data-act="del" tabindex="-1">Delete ${key("Enter")}</button></div>`;
    renderBar();
  }

  // keyboard map
  const MAP_ROWS = [
    [["Esc", 1.25], ["1"], ["2"], ["3"], ["4"], ["5"], ["6"], ["7"], ["8"], ["9"], ["0"], ["-"], ["+"], ["Del", 1.5]],
    [["Tab", 1.75], ["Q"], ["W"], ["E"], ["R"], ["T"], ["Y"], ["U"], ["I"], ["O"], ["P"], ["Enter", 3]],
    [["Caps", 2.25], ["A"], ["S"], ["D"], ["F"], ["G"], ["H"], ["J"], ["K"], ["L"], [";"], ["'"], ["PageUp", 1.5]],
    [["Shift", 2.75], ["Z"], ["X"], ["C"], ["V"], ["B"], ["N"], ["M"], [","], ["."], ["/"], ["↑"], ["PageDown", 1]],
    [["Ctrl", 1.5], ["Alt", 1.5], ["Space", 8.75], ["←"], ["↓"], ["→"]],
  ];
  const MAP = {
    list: {
      Esc: "Back", 1: "Today", 2: "Upcoming", 3: "Priority", 4: "Inbox", 5: "Completed", "-": "Priority", "+": "Priority", Del: "Delete",
      R: "Reorder", T: "Today", Enter: "Open details", S: "Subtask", D: "Date", G: "Go to", PageUp: "Page",
      Z: "Undo", C: "No date", B: "Sort", N: "New", M: "Move", "/": "Search", "↑": "Select", PageDown: "Page",
      Space: "Complete", "←": "Collapse", "↓": "Select", "→": "Expand",
    },
    detail: {
      Esc: "To list", "-": "Priority", "+": "Priority", Del: "Delete", T: "Title", Enter: "Open subtask", S: "Subtask", D: "Date",
      Z: "Undo", C: "Complete", N: "Notes", M: "Move", "↑": "Subtasks", "↓": "Subtasks", "←": "Parent", Space: "Complete subtask",
    },
  };
  const COMBOS = {
    list: [[["Shift", "T"], "Move to Tomorrow"], [["Shift", "↑ ↓"], "Select a range"], [["Shift", "Space"], "Select one more"], [["Alt", "↑ ↓"], "Reorder in a project"], [["Alt", "← →"], "Nest or outdent"], [["Shift", "M"], "Move under a task"], [["Ctrl", "K"], "Commands"], [["Ctrl", "V"], "Attach a screenshot"], [["?"], "This map"]],
    detail: [[["Shift", "S"], "Browse subtasks"], [["Ctrl", "Enter"], "Save title or notes"], [["Alt", "T"], "Same keys while typing"], [["Ctrl", "K"], "Commands"], [["Ctrl", "V"], "Attach a screenshot"], [["?"], "This map"]],
  };
  function openHelp() { openModal("help", "help", true); S.helpCtx = S.focus === "detail" ? "detail" : "list"; renderHelp(); renderBar(); }
  function renderHelp() {
    const map = MAP[S.helpCtx];
    const cap = { PageUp: "PgUp", PageDown: "PgDn", "-": "−" };
    modalEl.innerHTML = `<div class="help-h"><h2>Keyboard map</h2><div class="seg"><button type="button" tabindex="-1" data-help="list" class="${S.helpCtx === "list" ? "on" : ""}">In a list</button><button type="button" tabindex="-1" data-help="detail" class="${S.helpCtx === "detail" ? "on" : ""}">In details</button></div>${key("← →")}</div>
      <div class="kbd-map">${MAP_ROWS.map((row) => `<div class="kbd-row">${row.map(([id, w]) => `<div class="kc ${map[id] ? "has" : ""} ${id === "Space" && map[id] ? "red" : ""}" data-k="${esc(id)}" style="--w:${w || 1}"><span>${esc(cap[id] ?? id)}</span>${map[id] ? `<em>${map[id]}</em>` : ""}</div>`).join("")}</div>`).join("")}</div>
      <div class="combos">${COMBOS[S.helpCtx].map(([ks, text]) => `<div><span>${text}</span><span>${keys(...ks)}</span></div>`).join("")}</div>
      <div class="modal-f"><span>Press any key to see it on the map</span><span class="sp"></span><span>${key("Esc")} close</span></div>`;
  }

  // ── theme and sound ────────────────────────────────────────────────────────
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("theme", next);
    render();
  }
  function toggleSound() {
    S.sound = !S.sound;
    store.set("sound", S.sound ? "on" : "off");
    render();
    toast(S.sound ? "Sound on" : "Sound off");
    sfx.done();
  }

  // ── keyboard ───────────────────────────────────────────────────────────────
  function keyId(e) {
    const k = e.key;
    const named = { " ": "Space", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Delete: "Del", "=": "+", _: "-", Control: "Ctrl", Meta: "Ctrl" };
    if (named[k]) return named[k];
    return k.length === 1 ? k.toUpperCase() : k;
  }
  const held = new Map(); // key id -> whether it was pressed in a list context
  const capsFor = (id) => $$(`[data-k~="${id.replace(/["\\]/g, "\\$&")}"]`);
  function showPressed() {
    for (const [id, inList] of held) for (const n of capsFor(id)) {
      if (!inList && n.closest(".side")) continue; // the sidebar's keys only apply in a list
      n.classList.add("pressed");
    }
  }
  function press(id) {
    const c = context();
    held.set(id, c === "list" || c === "bulk");
    showPressed();
    clearTimeout(press["t" + id]);
    press["t" + id] = setTimeout(() => { held.delete(id); for (const n of capsFor(id)) n.classList.remove("pressed"); }, 170);
  }

  function listKey(e, k) {
    const sh = e.shiftKey;
    if (e.altKey) {
      if (k === "↑" || k === "↓") { e.preventDefault(); reorder(k === "↓" ? 1 : -1); }
      if (k === "←" || k === "→") { e.preventDefault(); toast("Nesting is not wired up in this mockup", { plain: true }); }
      return;
    }
    const ids = targets();
    switch (k) {
      case "↓": case "↑": e.preventDefault(); move(k === "↓" ? 1 : -1, sh); break;
      case "PageDown": case "PageUp": e.preventDefault(); move(k === "PageDown" ? 8 : -8); break;
      case "Home": case "End": e.preventDefault(); move(k === "End" ? 999 : -999); break;
      case "←": case "→": e.preventDefault(); if (S.sel) fold(S.sel, k === "→"); break;
      case "Space":
        e.preventDefault();
        if (sh) { if (S.sel) { S.bulk.has(S.sel) ? S.bulk.delete(S.sel) : S.bulk.add(S.sel); render(); } }
        else complete(ids);
        break;
      case "Enter": e.preventDefault(); if (S.bulk.size) openPalette("all"); else openDetail(); break;
      case "Del": if (ids.length) openDelete(); break;
      case "T": setDue(ids, sh ? day(1) : TODAY); break;
      case "C": setDue(ids, null); break;
      case "D": openDue(); break;
      case "S": if (byId(S.sel)) { S.bulk.clear(); S.focus = "detail"; sh ? browseSubs() : edit("subadd"); e.preventDefault(); } break;
      case "+": bumpPri(ids, 1); break;
      case "-": bumpPri(ids, -1); break;
      case "R": { const t = byId(S.sel); if (t) go(t.project === "inbox" ? "inbox" : "p:" + t.project, t.id); break; }
      case "M": if (sh) toast("Move under a task is not wired up in this mockup", { plain: true }); else if (ids.length) { e.preventDefault(); openPalette("move"); } break;
      case "G": e.preventDefault(); openPalette("goto"); break;
      case "B": openSort(); break;
      case "/": e.preventDefault(); el.search.focus(); el.search.select(); break;
      case "N": e.preventDefault(); openCapture(); break;
      case "?": openHelp(); break;
      case "Z": undo(); break;
      case "Esc":
        if (S.bulk.size) { S.bulk.clear(); S.anchor = null; render(); }
        else if (S.view === "search") go(S.back);
        break;
      default:
        if (/^[1-5]$/.test(k)) go(VIEWS[+k - 1].id);
    }
  }

  function detailKey(e, k) {
    const sh = e.shiftKey, t = byId(detailId());
    if (!t) return leaveDetail();
    const subs = kidsOf(t.id);
    switch (k) {
      case "Esc": leaveDetail(); break;
      case "T": e.preventDefault(); edit("title"); break;
      case "N": e.preventDefault(); edit("notes"); break;
      case "D": openDue(); break;
      case "S": e.preventDefault(); sh ? browseSubs() : edit("subadd"); break;
      case "C": case "Space":
        e.preventDefault();
        if (S.dsub && k === "Space") { complete([S.dsub]); break; }
        if (k === "Space") break;
        if (t.done) complete([t.id]);
        else if (S.drill.length) { S.drill.pop(); complete([t.id]); }
        else { S.focus = "list"; complete([t.id]); }
        break;
      case "↓": case "↑": {
        e.preventDefault();
        if (!subs.length) break;
        const i = subs.findIndex((c) => c.id === S.dsub);
        S.dsub = subs[i < 0 ? 0 : clamp(i + (k === "↓" ? 1 : -1), 0, subs.length - 1)].id;
        render();
        const cur = $(".sub.cur", el.dp);
        if (cur) cur.scrollIntoView({ block: "nearest" });
        break;
      }
      case "Enter": if (S.dsub) { S.drill.push(S.dsub); S.dsub = null; render(); } break;
      case "←": if (S.drill.length) { S.dsub = S.drill.pop(); render(); } break;
      case "+": bumpPri([S.dsub || t.id], 1); break;
      case "-": bumpPri([S.dsub || t.id], -1); break;
      case "M": e.preventDefault(); openPalette("move"); break;
      case "Del": openDelete(); break;
      case "G": e.preventDefault(); openPalette("goto"); break;
      case "?": openHelp(); break;
      case "Z": undo(); break;
      default:
    }
  }

  function typingKey(e, k, a) {
    if (a === el.search) {
      if (k === "Esc") { e.preventDefault(); el.search.blur(); if (S.view === "search") go(S.back); else renderBar(); }
      else if (k === "Enter" || k === "↓") { e.preventDefault(); el.search.blur(); renderBar(); }
      return;
    }
    const f = a.dataset.field;
    if (!f) return;
    if (e.altKey && !e.ctrlKey) {
      const jump = { T: "title", N: "notes", S: "subadd" }[k];
      if (jump) { e.preventDefault(); saveEdit(); if (k === "S" && e.shiftKey) browseSubs(); else edit(jump); return; }
      if (k === "D") { e.preventDefault(); saveEdit(); openDue(); return; }
      if (k === "C") { e.preventDefault(); saveEdit(); detailKey(e, "C"); return; }
    }
    if (k === "Esc") { e.preventDefault(); saveEdit(f === "title"); return; }
    if (k === "Enter" && f === "subadd") { e.preventDefault(); addSub(a.value); return; }
    if (k === "Enter" && (f === "title" || e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(); }
  }

  function modalKey(e, k) {
    switch (S.modal) {
      case "palette":
        if (k === "Esc") { e.preventDefault(); closeModal(); }
        else if (k === "↓" || k === "↑") { e.preventDefault(); const n = S.pal.list.length; if (n) { S.pal.i = (S.pal.i + (k === "↓" ? 1 : -1) + n) % n; renderPal(); } }
        else if (k === "Enter") { e.preventDefault(); runPal(S.pal.i); }
        break;
      case "due": e.preventDefault(); dueKey(e, k); break;
      case "sort": e.preventDefault(); sortKeyDown(e, k); break;
      case "capture":
        if (k === "Esc") { e.preventDefault(); closeModal(); }
        else if (k === "Enter") { e.preventDefault(); addCapture(); }
        break;
      case "delete":
        e.preventDefault();
        if (k === "Esc") closeModal();
        else if (k === "Enter") { const ids = S.del; closeModal(); remove(ids); }
        break;
      case "help":
        if (k === "Esc" || k === "?") { e.preventDefault(); closeModal(); }
        else if (k === "←" || k === "→") { e.preventDefault(); S.helpCtx = k === "←" ? "list" : "detail"; renderHelp(); press(k); }
        else if (k !== "F5" && k !== "F12" && !e.ctrlKey) e.preventDefault();
        break;
      default:
    }
  }

  document.addEventListener("keydown", (e) => {
    const k = keyId(e);
    if (e.ctrlKey || e.metaKey) press("Ctrl");
    if (e.shiftKey) press("Shift");
    if (e.altKey) press("Alt");
    press(k);
    try { onKey(e, k); } finally { showPressed(); }
  });
  function onKey(e, k) {
    if ((e.ctrlKey || e.metaKey) && k === "K") { e.preventDefault(); if (S.modal === "palette") closeModal(); else { if (S.modal) closeModal(); saveEdit(); openPalette("all"); } return; }
    if (S.modal) return modalKey(e, k);
    const a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return typingKey(e, k, a);
    if (e.ctrlKey || e.metaKey) { if (k === "Z") { e.preventDefault(); undo(); } return; }
    if (k === "Tab") { e.preventDefault(); return; }
    if (S.focus === "detail") detailKey(e, k); else listKey(e, k);
  }

  // ── mouse ──────────────────────────────────────────────────────────────────
  el.ls.addEventListener("click", (e) => {
    const row = e.target.closest(".row");
    if (!row || row._exit) return;
    const id = row.dataset.id, act = e.target.closest("[data-act]");
    if (act && act.dataset.act === "check") { S.sel = S.focus === "list" ? S.sel : id; return complete([id]); }
    if (act && act.dataset.act === "fold") return fold(id);
    S.sel = id; S.focus = "list"; S.drill = []; S.dsub = null; S.edit = null;
    render();
  });
  el.ls.addEventListener("dblclick", (e) => { if (e.target.closest(".row") && !e.target.closest("[data-act]")) openDetail(); });
  el.dp.addEventListener("click", (e) => {
    const t = byId(detailId());
    if (!t) return;
    const act = e.target.closest("[data-act]"), sub = e.target.closest("[data-sub]");
    if (S.focus !== "detail") { S.focus = "detail"; }
    if (act) {
      const a = act.dataset.act;
      if (a === "todoist") { e.preventDefault(); toast("In the real app this opens the task in Todoist", { plain: true }); }
      else if (a === "dcheck") { if (!t.done && !S.drill.length) S.focus = "list"; complete([t.id]); return; }
      else if (a === "subcheck") { complete([sub.dataset.sub]); return; }
      else if (a === "due") { render(); openDue(); return; }
      else if (a === "pri") { bumpPri([t.id], t.pri === 1 ? -3 : 1); return; }
      else if (a === "move") { render(); openPalette("move"); return; }
      else if (a === "notes" && !e.target.closest("a")) { edit("notes"); return; }
    } else if (sub) { S.dsub = sub.dataset.sub; }
    else if (e.target.closest("h2")) { edit("title"); return; }
    else if (e.target.dataset.field) { S.edit = e.target.dataset.field; renderBar(); return; }
    render();
  });
  el.dp.addEventListener("focusin", (e) => { const f = e.target.dataset.field; if (f && !rendering && S.edit !== f) { S.focus = "detail"; S.edit = f; renderBar(); el.app.dataset.focus = "detail"; } });
  el.dp.addEventListener("focusout", (e) => { if (rendering || !S.edit || !e.target.dataset.field) return; setTimeout(() => { const a = document.activeElement; if (S.edit && !(a && a.dataset && a.dataset.field === S.edit) && !S.modal) saveEdit(); }, 0); });
  $(".side").addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g) return go(g.dataset.go);
    if (e.target.closest("#new-btn")) return openCapture();
    if (e.target.closest("#help-btn")) return openHelp();
    if (e.target.closest("#theme-btn")) return toggleTheme();
    if (e.target.closest("#sound-btn")) return toggleSound();
  });
  $("#sort-btn").addEventListener("click", openSort);
  el.kb.addEventListener("click", (e) => {
    const b = e.target.closest("[data-kb]");
    if (!b) return;
    if (S.modal) closeModal();
    saveEdit();
    if (b.dataset.kb === "help") openHelp(); else openPalette(b.dataset.kb);
  });
  // A clicked button must not keep focus, or Space would press it again.
  document.addEventListener("mouseup", () => setTimeout(() => { const a = document.activeElement; if (a && a.tagName === "BUTTON") a.blur(); }, 0));
  el.toast.addEventListener("click", (e) => { if (e.target.closest("[data-act=undo]")) undo(); });
  el.overlay.addEventListener("click", (e) => {
    const p = e.target.closest("[data-pal]"), d = e.target.closest("[data-due]"), s = e.target.closest("[data-sort]"), c = e.target.closest("[data-date]"), h = e.target.closest("[data-help]"), a = e.target.closest("[data-act]");
    if (p) return runPal(+p.dataset.pal);
    if (c) return applyDue(c.dataset.date);
    if (d) { const o = DUE_OPTS()[+d.dataset.due]; if (o.cal) { S.due.cal = true; S.due.i = 3; return renderDue(); } return applyDue(o.date); }
    if (s) return applySort(s.dataset.sort === "r" ? "r" : SORTS[+s.dataset.sort].by);
    if (h) { S.helpCtx = h.dataset.help; return renderHelp(); }
    if (a && a.dataset.act === "close") return closeModal();
    if (a && a.dataset.act === "del") { const ids = S.del; closeModal(); return remove(ids); }
  });
  el.search.addEventListener("input", () => {
    S.query = el.search.value;
    if (S.query.trim()) { const fresh = S.view !== "search"; if (fresh) { S.back = S.view; S.view = "search"; S.bulk.clear(); } render({ fresh }); }
    else if (S.view === "search") { S.view = S.back; render({ fresh: true }); }
  });
  el.search.addEventListener("focus", () => { S.focus = "list"; S.edit = null; renderBar(); });
  el.search.addEventListener("blur", () => setTimeout(renderBar, 0));
  document.addEventListener("paste", (e) => {
    const file = [...(e.clipboardData ? e.clipboardData.files : [])].find((f) => f.type.startsWith("image/"));
    const t = byId(detailId());
    if (!file || !t || S.modal) return;
    e.preventDefault();
    const r = new FileReader();
    r.onload = () => { t.images.push(String(r.result)); render(); toast(`Screenshot attached to “${t.title}”`); sfx.add(); };
    r.readAsDataURL(file);
  });
  window.addEventListener("resize", () => placeCursor(true));

  render({ fresh: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeCursor(true));
})();
