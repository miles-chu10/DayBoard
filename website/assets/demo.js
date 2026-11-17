import { createDemoState, demoMeetings, reduceDemo } from "./demo-state.js";

// The homepage's hands-on sample of the Mac app. It follows the app's own layout (sidebar,
// toolbar, Home with Agenda, Needs you and Suggested) and its demo data, on a fictional day frozen
// at 2:02 PM. Everything stays in this tab; nothing reaches DayBoard or any account.
const root = document.querySelector("[data-demo]");
if (root) startDemo(root);

function startDemo(root) {
  let state = createDemoState();
  let previous = null;
  let view = "Home";
  let span = "today";
  let folder = "inbox";
  let selectedMail = null;
  let selectedEvent = null;
  let noteMode = "write";
  let assistantOpen = false;
  let calendarOpen = false;
  let peekOffset = 0;
  let renderedView = null;
  const history = ["Home"];
  let historyIndex = 0;

  const svg = "http://www.w3.org/2000/svg";
  const icons = {
    Home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5Z",
    Agenda: "M4 5h16v16H4V5Zm0 5h16M8 3v4m8-4v4M8 14h3m-3 3h6",
    Notes: "M14 3H6v18h12V7l-4-4Zm0 0v4h4M9 13h6m-6 4h4",
    Assistant: "M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4",
    Back: "m15 18-6-6 6-6",
    Forward: "m9 18 6-6-6-6",
    Chevron: "m9 18 6-6-6-6",
    Ask: "M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12Z",
    Plus: "M12 5v14M5 12h14",
    Mail: "M3 6h18v12H3V6Zm0 1 9 6 9-6",
    Alert: "M12 8v5m0 3.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z",
    Close: "M18 6 6 18M6 6l12 12",
    Circle: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
    Sidebar: "M4 4h16v16H4V4Zm5 0v16",
    Video: "m15 10 5-3v10l-5-3M3 7h12v10H3V7Z",
    Sparkles:
      "M11 3l1.7 4.3L17 9l-4.3 1.7L11 15l-1.7-4.3L5 9l4.3-1.7L11 3Zm7 11 .8 1.7 1.7.8-1.7.8L18 19l-.8-1.7-1.7-.8 1.7-.8L18 14Z",
    Archive: "M3 4h18v4H3V4Zm2 4v12h14V8M10 12h4",
    Snooze: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    Lines: "M5 7h14M5 12h14M5 17h9",
    CalendarDays:
      "M8 2v4m8-4v4M4 5h16v16H4V5Zm0 5h16M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01",
    Expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  };
  const logos = {
    Calendar: "assets/app-logos/google-calendar.svg",
    Inbox: "assets/app-logos/gmail.svg",
    Tasks: "assets/app-logos/google-tasks.svg",
    Reminders: "assets/app-logos/apple-reminders.webp",
  };
  const listTone = {
    Work: "blue",
    Personal: "blue",
    Reminders: "orange",
    Family: "orange",
    Errands: "orange",
  };
  const calendarTone = { Work: "blue", Personal: "green", Family: "orange" };
  const NOW = 14 * 60 + 2;
  const today = new Date();
  const weekday = (offset) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset).toLocaleDateString(
      "en-US",
      { weekday: "long" },
    );
  const dayLabel = (offset) =>
    offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : weekday(offset);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name, className) {
    const node = document.createElementNS(svg, "svg");
    for (const [key, value] of Object.entries({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    }))
      node.setAttribute(key, value);
    if (className) node.setAttribute("class", className);
    const path = document.createElementNS(svg, "path");
    path.setAttribute("d", icons[name]);
    node.append(path);
    return node;
  }

  function symbol(name) {
    const holder = el("span", `demo-symbol demo-symbol-${name.toLowerCase()}`);
    if (logos[name]) {
      const image = el("img");
      image.src = logos[name];
      image.alt = "";
      image.width = 18;
      image.height = 18;
      holder.append(image);
    } else holder.append(icon(name));
    return holder;
  }

  function button(label, onClick, className = "demo-button", iconName) {
    const node = el("button", className);
    node.type = "button";
    if (iconName) node.append(icon(iconName));
    if (label) node.append(el("span", "", label));
    node.addEventListener("click", onClick);
    return node;
  }

  function focusKey(key) {
    [...root.querySelectorAll("[data-key]")].find((node) => node.dataset.key === key)?.focus();
  }

  function minutes(time) {
    const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time ?? "");
    if (!match) return -1;
    return ((Number(match[1]) % 12) + (match[3] === "PM" ? 12 : 0)) * 60 + Number(match[2]);
  }

  function dueLabel(item) {
    if (item.day === null) return "";
    if (item.day === -1) return "Yesterday";
    if (item.day === -7) return "A week ago";
    if (item.day < 0) return `${-item.day} days ago`;
    if (item.day === 0) return item.time ? `Today ${item.time}` : "Today";
    if (item.day === 1) return "Tomorrow";
    return weekday(item.day);
  }

  const open = (source) => state.tasks.filter((item) => !item.done && item.source === source);
  const waiting = () =>
    state.mail.filter((mail) => mail.status === "inbox" && mail.triage === "Needs reply");
  const todayMeetings = () => demoMeetings.filter((item) => item.day === 0 && !item.allDay);

  // ── Window chrome ─────────────────────────────────────
  const windowNode = el("div", "demo-app");
  const layout = el("div", "demo-layout");
  const nav = el("nav", "demo-navigation");
  nav.setAttribute("aria-label", "Demo views");
  nav.id = "demo-navigation";
  const sidebarTop = el("div", "demo-sidebar-top");
  const lights = el("span", "demo-window-dots");
  lights.setAttribute("aria-hidden", "true");
  lights.append(el("i"), el("i"), el("i"));
  const sidebarToggle = button("", () => setSidebar(false), "demo-icon-button", "Sidebar");
  sidebarToggle.setAttribute("aria-label", "Hide sidebar");
  sidebarToggle.setAttribute("aria-controls", "demo-navigation");
  const newItem = button("", () => newTask(), "demo-circle-button", "Plus");
  newItem.setAttribute("aria-label", "New sample task");
  sidebarTop.append(lights, sidebarToggle, newItem);
  const navList = el("div", "demo-nav-list");
  const navFoot = el("div", "demo-sidebar-foot");
  nav.append(sidebarTop, navList, navFoot);

  const workspace = el("div", "demo-workspace");
  const toolbar = el("div", "demo-toolbar");
  const back = button("", () => step(-1), "demo-circle-button is-quiet", "Back");
  back.setAttribute("aria-label", "Back");
  const forward = button("", () => step(1), "demo-circle-button is-quiet", "Forward");
  forward.setAttribute("aria-label", "Forward");
  const viewTitle = el("strong", "demo-toolbar-title", "Home");
  // With the sidebar hidden, the traffic lights and its toggle move into the toolbar, as in the app.
  const toolbarLead = el("div", "demo-toolbar-lead");
  const leadDots = el("span", "demo-window-dots");
  leadDots.setAttribute("aria-hidden", "true");
  leadDots.append(el("i"), el("i"), el("i"));
  const showSidebar = button("", () => setSidebar(true), "demo-icon-button", "Sidebar");
  showSidebar.setAttribute("aria-label", "Show sidebar");
  showSidebar.setAttribute("aria-controls", "demo-navigation");
  toolbarLead.append(leadDots, showSidebar);
  toolbarLead.hidden = true;
  const calendarButton = button(
    "",
    () => setCalendar(!calendarOpen),
    "demo-circle-button",
    "CalendarDays",
  );
  calendarButton.setAttribute("aria-controls", "demo-calendar-pane");
  const ask = button("Ask", () => setAssistant(!assistantOpen), "demo-pill-button", "Ask");
  ask.setAttribute("aria-label", "Open sample Assistant");
  ask.setAttribute("aria-expanded", "false");
  ask.setAttribute("aria-controls", "demo-assistant");
  const add = button("", () => newTask(), "demo-circle-button", "Plus");
  add.setAttribute("aria-label", "Add a sample task");
  const actions = el("div", "demo-toolbar-actions");
  actions.append(calendarButton, ask, add);
  toolbar.append(toolbarLead, back, forward, viewTitle, actions);
  const content = el("div", "demo-content");
  content.tabIndex = -1;
  const assistant = el("aside", "demo-assistant");
  assistant.id = "demo-assistant";
  assistant.setAttribute("aria-label", "Sample Assistant");
  assistant.hidden = true;
  const calendarPane = el("aside", "demo-calendar-pane");
  calendarPane.id = "demo-calendar-pane";
  calendarPane.setAttribute("aria-label", "Calendar beside this page");
  calendarPane.hidden = true;
  const main = el("div", "demo-main");
  main.append(toolbar, content);

  // ── Resizable, collapsible sidebars (sizes and open state are remembered in this browser) ──
  const SIZES = {
    nav: { key: "sidebar-width", fallback: 220, min: 180, max: 320, variable: "--demo-nav-width" },
    pane: { key: "pane-width", fallback: 320, min: 260, max: 440, variable: "--demo-pane-width" },
  };
  const MAIN_MIN = 360;
  const store = (() => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  })();
  function readPref(key) {
    try {
      return store?.getItem(`dayboard-demo:${key}`) ?? null;
    } catch {
      return null;
    }
  }
  function writePref(key, value) {
    try {
      store?.setItem(`dayboard-demo:${key}`, String(value));
    } catch {
      // Blocked storage only means the layout isn't remembered.
    }
  }
  const widths = {};
  for (const [name, size] of Object.entries(SIZES)) {
    const stored = Number(readPref(size.key));
    widths[name] = Number.isFinite(stored) && stored > 0 ? stored : size.fallback;
  }

  function maxWidth(name) {
    const size = SIZES[name];
    const total = layout.clientWidth;
    if (!total) return size.max;
    const other =
      name === "nav"
        ? assistantOpen || calendarOpen
          ? widths.pane
          : 0
        : nav.hidden
          ? 0
          : widths.nav;
    return Math.max(size.min, Math.min(size.max, total - other - MAIN_MIN));
  }

  function setWidth(name, value, persist) {
    const size = SIZES[name];
    widths[name] = Math.round(Math.min(maxWidth(name), Math.max(size.min, value)));
    layout.style?.setProperty(size.variable, `${widths[name]}px`);
    handles[name].setAttribute("aria-valuenow", String(widths[name]));
    handles[name].setAttribute("aria-valuemax", String(Math.round(maxWidth(name))));
    if (persist) writePref(size.key, widths[name]);
  }

  // A separator like the app's: drag, arrow keys (Shift for bigger steps), Home/End, and
  // double-click to return to the default width.
  function resizeHandle(name, label, controls, direction) {
    const size = SIZES[name];
    const handle = el("div", "demo-resize");
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", label);
    handle.setAttribute("aria-controls", controls);
    handle.setAttribute("aria-valuemin", String(size.min));
    handle.setAttribute("title", `${label}. Double-click to reset.`);
    let startX = 0;
    let startWidth = 0;
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      startX = event.clientX;
      startWidth = widths[name];
      handle.setPointerCapture?.(event.pointerId);
      handle.classList?.add("is-dragging");
      handle.focus({ preventScroll: true });
    });
    handle.addEventListener("pointermove", (event) => {
      if (!handle.hasPointerCapture?.(event.pointerId)) return;
      setWidth(name, startWidth + (event.clientX - startX) * direction, false);
    });
    const finish = (event) => {
      if (!handle.hasPointerCapture?.(event.pointerId)) return;
      handle.releasePointerCapture(event.pointerId);
      handle.classList?.remove("is-dragging");
      setWidth(name, widths[name], true);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("dblclick", () => setWidth(name, size.fallback, true));
    handle.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 40 : 10;
      const next = {
        ArrowLeft: widths[name] - step * direction,
        ArrowRight: widths[name] + step * direction,
        Home: size.min,
        End: maxWidth(name),
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      setWidth(name, next, true);
    });
    return handle;
  }
  const handles = {
    nav: resizeHandle("nav", "Resize sidebar", "demo-navigation", 1),
    pane: resizeHandle("pane", "Resize side panel", "demo-calendar-pane demo-assistant", -1),
  };
  handles.pane.hidden = true;

  workspace.append(main, handles.pane, assistant, calendarPane);
  layout.append(nav, handles.nav, workspace);
  windowNode.append(layout);

  const feedback = el("div", "demo-feedback");
  const message = el("p", "", "Fictional sample data. Click around; changes stay in this tab.");
  message.setAttribute("role", "status");
  const undo = button(
    "Undo",
    () => {
      if (!previous) return;
      state = previous;
      previous = null;
      render();
      announce("Last change undone.");
      content.focus({ preventScroll: true });
    },
    "demo-text-button",
  );
  undo.hidden = true;
  const reset = button(
    "Reset",
    () => {
      state = createDemoState();
      previous = null;
      selectedMail = null;
      selectedEvent = null;
      folder = "inbox";
      span = "today";
      noteMode = "write";
      renderedView = null;
      history.splice(0, history.length, "Home");
      historyIndex = 0;
      setAssistant(false, false);
      view = "Home";
      render();
      announce("The sample day has been reset.");
      reset.focus();
    },
    "demo-text-button",
  );
  reset.setAttribute("aria-label", "Reset demo");
  feedback.append(message, undo, reset);
  root.append(windowNode, feedback);

  function announce(text) {
    message.textContent = text;
    undo.hidden = !previous;
  }

  function change(action, text, key) {
    previous = state;
    state = reduceDemo(state, action);
    render();
    announce(text);
    if (key) focusKey(key);
  }

  function go(name, options = {}) {
    if (name !== view) {
      history.splice(historyIndex + 1);
      history.push(name);
      historyIndex = history.length - 1;
    }
    view = name;
    selectedMail = options.mail ?? null;
    selectedEvent = options.event ?? null;
    if (options.folder) folder = options.folder;
    if (name !== "Assistant") setAssistant(false, false);
    render();
    if (options.key) focusKey(options.key);
    else content.focus({ preventScroll: true });
  }

  function step(delta) {
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    historyIndex = next;
    view = history[next];
    selectedMail = null;
    selectedEvent = null;
    render();
  }

  function newTask() {
    go(view === "Reminders" ? "Reminders" : "Tasks", { key: "new-task" });
  }

  // ── Shared pieces ─────────────────────────────────────
  function segment(items, selected, callback, label) {
    const group = el("div", "demo-segments");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    for (const [value, title] of items) {
      const node = button(title, () => callback(value), "demo-segment");
      node.setAttribute("aria-pressed", String(value === selected));
      node.dataset.key = `segment-${value}`;
      group.append(node);
    }
    return group;
  }

  function card(title, children, count, action) {
    const section = el("section", "demo-card");
    section.setAttribute("aria-label", title);
    const heading = el("div", "demo-card-heading");
    heading.append(el("h4", "", title));
    if (count !== undefined) heading.append(el("span", "demo-count", String(count)));
    if (action) heading.append(action);
    section.append(heading, ...children);
    return section;
  }

  function chip(text, tone, className = "demo-chip") {
    const node = el("span", `${className}${tone ? ` is-${tone}` : ""}`);
    node.append(el("i"), el("span", "", text));
    return node;
  }

  function viewHeading(title, detail, control) {
    const head = el("div", "demo-view-heading");
    const intro = el("div");
    intro.append(el("h3", "", title));
    if (detail) intro.append(el("p", "demo-muted", detail));
    head.append(intro);
    if (control) head.append(control);
    return head;
  }

  function spanControl(label) {
    return segment(
      [
        ["today", "Today"],
        ["week", "This week"],
      ],
      span,
      (value) => {
        span = value;
        render();
        focusKey(`segment-${value}`);
      },
      label,
    );
  }

  function taskRow(item) {
    const row = el("div", `demo-task${item.done ? " is-done" : ""}`);
    const label = el("label", "demo-task-check");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.done;
    checkbox.dataset.key = item.id;
    checkbox.setAttribute("aria-label", item.title);
    checkbox.addEventListener("change", () =>
      change(
        { type: "toggle-task", id: item.id },
        item.done ? "Task reopened in the demo." : "Task completed in the demo.",
        item.id,
      ),
    );
    label.append(checkbox, el("span", "demo-task-title", item.title));
    row.append(label);
    const meta = el("span", "demo-task-meta");
    if (item.notes) {
      const notes = icon("Lines", "demo-notes-glyph");
      meta.append(notes);
    }
    meta.append(chip(item.list, listTone[item.list] ?? "blue"));
    const due = dueLabel(item);
    if (due)
      meta.append(
        el(
          "span",
          `demo-due${item.day < 0 ? " is-overdue" : item.day === 0 ? " is-today" : ""}`,
          due,
        ),
      );
    meta.append(icon("Chevron", "demo-row-chevron"));
    row.append(meta);
    return row;
  }

  function eventRow(
    meeting,
    onClick = () => go("Calendar", { event: meeting.id, key: meeting.id }),
  ) {
    const row = button(
      "",
      onClick,
      `demo-event-row is-${calendarTone[meeting.calendar]}${meeting.allDay ? " is-all-day" : ""}`,
    );
    const past = meeting.day === 0 && !meeting.allDay && minutes(meeting.end) <= NOW;
    if (past) row.className += " is-past";
    row.setAttribute(
      "aria-label",
      `${meeting.title}, ${dayLabel(meeting.day)} ${meeting.allDay ? "all day" : `${meeting.time} to ${meeting.end}`}`,
    );
    row.replaceChildren(
      el("span", "demo-event-when", meeting.allDay ? "All day" : `${meeting.time}–${meeting.end}`),
      el("strong", "", meeting.title),
    );
    if (meeting.location) row.append(el("span", "demo-event-where", meeting.location));
    return row;
  }

  // Events, timed reminders and the day's other to-dos, in the order the app's Agenda uses.
  function agendaBody(days, sources = ["Tasks", "Reminders"]) {
    const body = el("div", "demo-agenda");
    const overdue = state.tasks
      .filter((item) => item.day !== null && item.day < 0 && sources.includes(item.source))
      .sort((a, b) => a.day - b.day);
    if (overdue.length) {
      const group = el("div", "demo-agenda-group");
      group.append(el("h5", "", "Overdue"));
      const list = el("div", "demo-list");
      list.append(...overdue.map(taskRow));
      group.append(list);
      body.append(group);
    }
    for (const offset of days) {
      const events = demoMeetings.filter((item) => item.day === offset);
      const todos = state.tasks.filter(
        (item) => item.day === offset && sources.includes(item.source),
      );
      if (!events.length && !todos.length && days.length > 1) continue;
      const group = el("div", "demo-agenda-group");
      group.append(el("h5", "", dayLabel(offset)));
      const timed = [
        ...events.filter((item) => !item.allDay).map((item) => [minutes(item.time), item]),
        ...todos.filter((item) => item.time).map((item) => [minutes(item.time), item]),
      ].sort((a, b) => a[0] - b[0]);
      const entries = [
        ...events.filter((item) => item.allDay),
        ...timed.map(([, item]) => item),
        ...todos.filter((item) => !item.time),
      ];
      let list = null;
      for (const entry of entries) {
        if ("calendar" in entry) {
          list = null;
          group.append(eventRow(entry));
        } else {
          if (!list) {
            list = el("div", "demo-list");
            group.append(list);
          }
          list.append(taskRow(entry));
        }
      }
      if (!entries.length) group.append(el("p", "demo-empty", "Nothing scheduled today."));
      body.append(group);
    }
    return body;
  }

  // ── Views ─────────────────────────────────────────────
  function renderHome() {
    const needs = waiting();
    const meetingCount = demoMeetings.filter(
      (item) => !item.allDay && (span === "week" || item.day === 0),
    ).length;
    const summary = [
      `${needs.length} waiting on you`,
      ...(state.suggestions.length
        ? [
            `${state.suggestions.length} suggested ${state.suggestions.length === 1 ? "task" : "tasks"}`,
          ]
        : []),
    ];
    const date = today.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    content.append(
      viewHeading(
        "Good afternoon, Alex",
        `${date}. ${summary.join(", ")} and ${meetingCount} meetings ${span === "today" ? "today" : "this week"}.`,
        spanControl("Home range"),
      ),
    );

    const next = el("section", "demo-meeting-card is-next");
    next.setAttribute("aria-label", "Up next meeting");
    const nextText = el("div");
    nextText.append(
      el("small", "", "Starts in 58 min · 3:00 PM – 4:00 PM"),
      el("strong", "", "Q4 roadmap sync"),
      el("small", "", "1 other attendee"),
    );
    const prepare = button(
      "Prepare",
      () => {
        setAssistant(true);
        respond("Prepare for Q4 roadmap sync");
      },
      "demo-pill-button is-small",
      "Sparkles",
    );
    nextText.append(prepare);
    const join = button(
      "Join",
      () => announce("This sample meeting has no call to join."),
      "demo-accent-button",
      "Video",
    );
    next.append(nextText, join);

    const ended = el("section", "demo-meeting-card");
    ended.setAttribute("aria-label", "Meeting that just ended");
    ended.append(
      el("small", "", "Just ended · 11:00 AM – 12:00 PM"),
      el("strong", "", "Design review: onboarding flow"),
    );

    const days = span === "today" ? [0] : [0, 1, 2, 3, 4, 5, 6];
    const agendaCount =
      state.tasks.filter((item) => item.day !== null && (item.day < 0 || days.includes(item.day)))
        .length + demoMeetings.filter((item) => days.includes(item.day)).length;
    const agenda = card(
      "Agenda",
      [agendaBody(days)],
      agendaCount,
      button("Open Agenda", () => go("Agenda"), "demo-text-button"),
    );
    agenda.tabIndex = -1;
    agenda.dataset.key = "home-agenda";

    const rows = needs.map((mail) => {
      const row = button(
        "",
        () => go("Inbox", { mail: mail.id, folder: "inbox", key: "message-heading" }),
        "demo-needs-row",
      );
      row.setAttribute("aria-label", `${mail.from}: ${mail.subject}, ${mail.chip}, ${mail.age}`);
      const age = el("span", `demo-age${mail.stale ? " is-stale" : ""}`);
      if (mail.stale) age.append(icon("Alert"));
      age.append(el("span", "", mail.age));
      const detail = el("span", "demo-needs-detail");
      detail.append(el("span", "", mail.subject), chip(mail.chip, "orange"));
      row.replaceChildren(icon("Mail"), el("strong", "", mail.from), detail, age);
      return row;
    });
    if (!rows.length)
      rows.push(el("p", "demo-empty", "All caught up. Nothing needs you right now."));

    const suggestions = state.suggestions.map((item) => {
      const row = el("div", "demo-suggestion");
      const text = el("div");
      text.append(el("strong", "", item.title), el("small", "", item.from));
      const addButton = button(
        "Add",
        () =>
          change(
            { type: "add-suggestion", id: item.id },
            `“${item.title}” added to your sample tasks.`,
            "home-agenda",
          ),
        "demo-pill-button is-small",
        "Plus",
      );
      addButton.setAttribute("aria-label", `Add suggested task: ${item.title}`);
      const dismiss = button(
        "",
        () =>
          change(
            { type: "dismiss-suggestion", id: item.id },
            "Suggestion dismissed in the demo.",
            "home-agenda",
          ),
        "demo-icon-button",
        "Close",
      );
      dismiss.setAttribute("aria-label", `Dismiss suggestion: ${item.title}`);
      row.append(icon("Circle", "demo-dashed"), text, addButton, dismiss);
      return row;
    });
    if (!suggestions.length)
      suggestions.push(el("p", "demo-empty", "You're up to date with the sample suggestions."));

    content.append(
      next,
      ended,
      agenda,
      card(
        "Needs you",
        rows,
        needs.length,
        button("Open Inbox", () => go("Inbox", { folder: "inbox" }), "demo-text-button"),
      ),
      card(
        "Suggested",
        suggestions,
        state.suggestions.length,
        el("small", "demo-muted", "From your mail"),
      ),
    );
  }

  function renderAgenda() {
    content.append(
      viewHeading(
        "Agenda",
        "Events, tasks and reminders in time order.",
        spanControl("Agenda range"),
      ),
      agendaBody(span === "today" ? [0] : [0, 1, 2, 3, 4, 5, 6]),
    );
  }

  function renderTodos(source) {
    const form = el("form", "demo-add-task");
    const input = el("input");
    input.type = "text";
    input.maxLength = 120;
    input.required = true;
    input.placeholder = source === "Tasks" ? "Add a task…" : "Add a reminder…";
    input.dataset.key = "new-task";
    input.setAttribute(
      "aria-label",
      source === "Tasks" ? "New sample task" : "New sample reminder",
    );
    const submit = button("Add", () => {}, "demo-pill-button is-small", "Plus");
    submit.type = "submit";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!input.value.trim()) {
        input.setCustomValidity("Enter a title.");
        input.reportValidity();
        return;
      }
      if (state.tasks.length >= 30) {
        announce("The sample holds up to 30 items. Reset to start again.");
        return;
      }
      const key = `new${state.nextTask}`;
      change({ type: "add-task", title: input.value }, "Task added to the sample day.", key);
    });
    input.addEventListener("input", () => input.setCustomValidity(""));
    form.append(input, submit);
    const items = state.tasks.filter((item) => item.source === source);
    content.append(
      viewHeading(
        source === "Tasks" ? "Google Tasks" : "Reminders",
        `${items.filter((item) => !item.done).length} open`,
      ),
      form,
    );
    for (const list of [...new Set(items.map((item) => item.list))]) {
      const rows = items.filter((item) => item.list === list);
      const group = el("section", "demo-list-group");
      group.setAttribute("aria-label", list);
      const heading = el("h4", `demo-list-heading is-${listTone[list] ?? "blue"}`);
      heading.append(el("i"), el("span", "", list), el("small", "", String(rows.length)));
      const listNode = el("div", "demo-list is-boxed");
      listNode.append(...rows.map(taskRow));
      group.append(heading, listNode);
      content.append(group);
    }
  }

  function renderMail() {
    const inbox = state.mail.filter((mail) => mail.status === "inbox");
    content.append(
      viewHeading(
        "Gmail",
        `${inbox.length} recent · ${inbox.filter((mail) => mail.unread).length} unread`,
        segment(
          [
            ["inbox", "Inbox"],
            ["snoozed", "Later"],
          ],
          folder,
          (value) => {
            folder = value;
            selectedMail = null;
            render();
            focusKey(`segment-${value}`);
          },
          "Mail folder",
        ),
      ),
    );
    const columns = el("div", `demo-mail-columns${selectedMail ? " has-message" : ""}`);
    const list = el("div", "demo-mail-list");
    const messages = state.mail.filter((mail) => mail.status === folder);
    for (const mail of messages) {
      const row = button(
        "",
        () => {
          selectedMail = mail.id;
          if (mail.unread) state = reduceDemo(state, { type: "read-mail", id: mail.id });
          render();
          focusKey("message-heading");
        },
        `demo-mail-row${mail.unread ? " is-unread" : ""}`,
      );
      row.setAttribute("aria-label", `${mail.from}: ${mail.subject}`);
      row.setAttribute("aria-pressed", String(mail.id === selectedMail));
      const top = el("span", "demo-mail-top");
      top.append(
        el("i", "demo-unread-dot"),
        el("strong", "", mail.from),
        el("span", `demo-triage is-${mail.triage.split(" ")[0].toLowerCase()}`, mail.triage),
        el("small", "", folder === "snoozed" ? "Tomorrow" : mail.time),
      );
      const subject = el("span", "demo-mail-subject");
      subject.append(el("span", "", mail.subject), chip(mail.chip, "blue"));
      row.replaceChildren(top, subject, el("small", "demo-mail-snippet", mail.snippet));
      list.append(row);
    }
    if (!messages.length)
      list.append(
        el(
          "p",
          "demo-empty",
          folder === "inbox"
            ? "Inbox clear. Your snoozed messages are in Later."
            : "No snoozed messages yet.",
        ),
      );
    const detail = el("div", "demo-mail-detail");
    const mail = messages.find((item) => item.id === selectedMail);
    if (mail) {
      detail.append(
        button(
          "Back to messages",
          () => {
            selectedMail = null;
            render();
            content.focus({ preventScroll: true });
          },
          "demo-text-button",
          "Back",
        ),
      );
      const title = el("h4", "", mail.subject);
      title.tabIndex = -1;
      title.dataset.key = "message-heading";
      detail.append(
        title,
        el("p", "demo-muted", `${mail.from} → Alex Rivera`),
        el("p", "demo-mail-body", mail.body),
      );
      const buttons = el("div", "demo-mail-actions");
      const move = (status, text) => {
        selectedMail = null;
        change({ type: "mail-status", id: mail.id, status }, text);
        content.focus({ preventScroll: true });
      };
      buttons.append(
        button(
          "Archive",
          () => move("archived", "Message archived in the demo."),
          "demo-pill-button",
          "Archive",
        ),
      );
      buttons.append(
        folder === "inbox"
          ? button(
              "Snooze until tomorrow",
              () => move("snoozed", "Message moved to Later in the demo."),
              "demo-pill-button",
              "Snooze",
            )
          : button(
              "Return to Inbox",
              () => move("inbox", "Message returned to the sample inbox."),
              "demo-pill-button",
            ),
      );
      detail.append(buttons);
    } else {
      detail.append(
        icon("Mail"),
        el("p", "demo-muted", "Select a message to read it, archive it or try snoozing."),
      );
    }
    columns.append(list, detail);
    content.append(columns);
  }

  function renderCalendar() {
    content.append(
      viewHeading(
        "Calendar",
        "Schedule · Work, Personal and Family",
        spanControl("Calendar range"),
      ),
    );
    const schedule = el("div", "demo-schedule");
    for (const offset of span === "today" ? [0] : [0, 1, 2]) {
      const events = demoMeetings.filter((item) => item.day === offset);
      if (!events.length) continue;
      const group = el("div", "demo-agenda-group");
      group.append(el("h5", "", dayLabel(offset)));
      for (const meeting of events) {
        const row = eventRow(meeting, () => {
          selectedEvent = selectedEvent === meeting.id ? null : meeting.id;
          render();
          focusKey(meeting.id);
        });
        row.dataset.key = meeting.id;
        row.setAttribute("aria-expanded", String(selectedEvent === meeting.id));
        group.append(row);
        if (selectedEvent === meeting.id) {
          const info = el("div", "demo-event-detail");
          info.append(
            el(
              "strong",
              "",
              `${dayLabel(meeting.day)} · ${meeting.allDay ? "All day" : `${meeting.time} – ${meeting.end}`}`,
            ),
            el("p", "", meeting.detail),
            el("small", "demo-muted", `${meeting.calendar} calendar`),
          );
          group.append(info);
        }
      }
      schedule.append(group);
    }
    content.append(schedule);
  }

  function previewNote(value, target) {
    target.replaceChildren();
    if (!value.trim()) {
      target.append(el("p", "demo-muted", "Your note preview will appear here."));
      return;
    }
    for (const line of value.split("\n")) {
      if (!line.trim()) continue;
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      const node = heading
        ? el(heading[1].length === 1 ? "h4" : "h5", "", heading[2])
        : el(
            "p",
            line.startsWith("- ") ? "demo-note-bullet" : "",
            line.startsWith("- ") ? `• ${line.slice(2)}` : line,
          );
      target.append(node);
    }
  }

  function renderNotes() {
    content.append(
      viewHeading(
        "Launch checklist",
        "Markdown note · Saved only in this demo tab",
        segment(
          [
            ["write", "Write"],
            ["preview", "Preview"],
          ],
          noteMode,
          (value) => {
            noteMode = value;
            render();
            focusKey(`segment-${value}`);
          },
          "Note mode",
        ),
      ),
    );
    const area = el("div", "demo-notes");
    area.dataset.mode = noteMode;
    const editor = el("textarea", "demo-note-editor");
    editor.setAttribute("aria-label", "Sample note in Markdown");
    editor.maxLength = 4000;
    editor.value = state.note;
    editor.spellcheck = false;
    const preview = el("div", "demo-note-preview");
    preview.setAttribute("aria-label", "Note preview");
    previewNote(state.note, preview);
    editor.addEventListener("input", () => {
      state = reduceDemo(state, { type: "note", value: editor.value });
      previous = null;
      undo.hidden = true;
      previewNote(state.note, preview);
    });
    editor.addEventListener("change", () => announce("Sample note saved in this tab."));
    area.append(editor, preview);
    content.append(area);
  }

  // ── Assistant ─────────────────────────────────────────
  const answer = el("div", "demo-answer");
  answer.setAttribute("role", "status");

  function respond(label) {
    let response;
    if (label === "What needs my attention?") {
      const count = waiting().length;
      const overdue = state.tasks.filter((item) => !item.done && item.day < 0).length;
      response = `You have ${count} ${count === 1 ? "message" : "messages"} waiting on you and ${overdue} overdue ${overdue === 1 ? "to-do" : "to-dos"}. Start with Priya's launch copy before the 3 PM roadmap sync.`;
    } else if (label === "Help me reply to Priya")
      response =
        "Thanks, Priya. I’ll review the headline before the roadmap sync and send my notes. The draft is a useful starting point.";
    else if (label === "Prepare for Q4 roadmap sync")
      response =
        "Q4 roadmap sync at 3:00 PM with Morgan. Bring the launch timeline and the open question on mobile from last week's notes. Finish the launch announcement first; it's due today.";
    else
      response =
        "Block 30 minutes after this for the launch announcement, then keep 2:30–3:00 PM to prep for the roadmap sync.";
    answer.replaceChildren(
      el("span", "demo-answer-label", "Example response"),
      el("p", "", response),
    );
  }

  function setAssistant(isOpen, restoreFocus = true) {
    assistantOpen = isOpen;
    if (isOpen && calendarOpen) setCalendar(false, false, false);
    assistant.hidden = !isOpen;
    workspace.dataset.assistant = isOpen ? "open" : "closed";
    ask.setAttribute("aria-expanded", String(isOpen));
    ask.setAttribute("aria-label", isOpen ? "Close sample Assistant" : "Open sample Assistant");
    syncPane();
    renderSidebar();
    if (!isOpen) {
      if (restoreFocus) ask.focus();
      return;
    }
    assistant.replaceChildren();
    const heading = el("div", "demo-card-heading");
    const close = button("", () => setAssistant(false), "demo-icon-button", "Close");
    close.setAttribute("aria-label", "Close sample Assistant");
    heading.append(el("h4", "", "Assistant"), close);
    answer.replaceChildren();
    const prompts = el("div", "demo-prompts");
    for (const label of [
      "What needs my attention?",
      "Help me reply to Priya",
      "Plan a focus block",
    ])
      prompts.append(button(label, () => respond(label), "demo-prompt"));
    assistant.append(
      heading,
      el("p", "demo-muted", "Example responses for this sample day. No live AI requests."),
      prompts,
      answer,
    );
    close.focus();
  }

  // ── Calendar beside the page (the app's day peek) ─────
  const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];
  const dateAt = (offset) =>
    new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);

  // The calendar and the Assistant share the right side, one at a time, as in the app. The
  // calendar's open state is remembered; on Calendar itself the panel steps aside.
  function syncPane() {
    const onCalendar = view === "Calendar";
    calendarButton.hidden = onCalendar;
    calendarPane.hidden = !calendarOpen || onCalendar;
    handles.pane.hidden = assistant.hidden && calendarPane.hidden;
    calendarButton.setAttribute("aria-pressed", String(calendarOpen));
    calendarButton.setAttribute(
      "aria-label",
      calendarOpen ? "Hide the calendar beside this page" : "Show the calendar beside this page",
    );
    calendarButton.className = `demo-circle-button${calendarOpen ? " is-active" : ""}`;
  }

  function setCalendar(isOpen, persist = true, restoreFocus = true) {
    calendarOpen = isOpen;
    if (persist) writePref("calendar", isOpen ? "open" : "closed");
    if (isOpen && assistantOpen) setAssistant(false, false);
    if (isOpen) peekOffset = 0;
    syncPane();
    renderPeek();
    if (!isOpen && restoreFocus && !calendarButton.hidden) calendarButton.focus();
  }

  function setSidebar(isOpen) {
    nav.hidden = !isOpen;
    handles.nav.hidden = !isOpen;
    toolbarLead.hidden = isOpen;
    writePref("sidebar", isOpen ? "open" : "closed");
    (isOpen ? sidebarToggle : showSidebar).focus();
  }

  function peekTask(item) {
    const row = el("div", `demo-peek-task${item.done ? " is-done" : ""}`);
    const label = el("label", "demo-task-check");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.done;
    checkbox.dataset.key = `peek-${item.id}`;
    checkbox.setAttribute("aria-label", item.title);
    checkbox.addEventListener("change", () =>
      change(
        { type: "toggle-task", id: item.id },
        item.done ? "Task reopened in the demo." : "Task completed in the demo.",
        `peek-${item.id}`,
      ),
    );
    const text = el("span", "demo-peek-task-text");
    text.append(el("span", "demo-task-title", item.title));
    const due = dueLabel(item);
    if (due) text.append(el("span", `demo-due${item.day === 0 ? " is-today" : ""}`, due));
    label.append(checkbox, text);
    row.append(label);
    return row;
  }

  function renderPeek() {
    if (calendarPane.hidden) {
      calendarPane.replaceChildren();
      return;
    }
    const selected = dateAt(peekOffset);
    const heading = el("div", "demo-peek-heading");
    const title = el(
      "h4",
      "",
      selected.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    );
    if (peekOffset === 0) title.append(el("small", "", "Today"));
    const weekStep = (delta) => () => {
      peekOffset += delta;
      renderPeek();
    };
    const previousWeek = button("", weekStep(-7), "demo-icon-button", "Back");
    previousWeek.setAttribute("aria-label", "Previous week");
    const nextWeek = button("", weekStep(7), "demo-icon-button", "Forward");
    nextWeek.setAttribute("aria-label", "Next week");
    const openCalendar = button(
      "",
      () => go("Calendar", { key: "nav-Calendar" }),
      "demo-icon-button",
      "Expand",
    );
    openCalendar.setAttribute("aria-label", "Open Calendar");
    const close = button("", () => setCalendar(false), "demo-icon-button", "Close");
    close.setAttribute("aria-label", "Close the calendar panel");
    heading.append(title, previousWeek, nextWeek, openCalendar, close);

    const week = el("div", "demo-peek-week");
    week.setAttribute("role", "group");
    week.setAttribute("aria-label", "Days");
    const start = peekOffset - selected.getDay();
    for (let offset = start; offset < start + 7; offset++) {
      const date = dateAt(offset);
      const day = button(
        "",
        () => {
          peekOffset = offset;
          renderPeek();
          focusKey(`peek-day-${offset}`);
        },
        `demo-peek-day${offset === 0 ? " is-today" : ""}`,
      );
      day.dataset.key = `peek-day-${offset}`;
      day.setAttribute("aria-pressed", String(offset === peekOffset));
      day.setAttribute(
        "aria-label",
        date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
      );
      day.append(el("span", "", WEEKDAY[date.getDay()]), el("b", "", String(date.getDate())));
      week.append(day);
    }

    const events = demoMeetings
      .filter((item) => item.day === peekOffset)
      .sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : minutes(a.time) - minutes(b.time)));
    const todos = state.tasks.filter((item) => !item.done && item.day === peekOffset);
    const list = el("div", "demo-peek-list");
    for (const meeting of events) {
      const row = button(
        "",
        () => go("Calendar", { event: meeting.id, key: meeting.id }),
        `demo-peek-event is-${calendarTone[meeting.calendar]}`,
      );
      row.setAttribute(
        "aria-label",
        `${meeting.title}, ${meeting.allDay ? "all day" : `${meeting.time} to ${meeting.end}`}`,
      );
      row.append(
        el("strong", "", meeting.title),
        el("small", "", meeting.allDay ? "All day" : meeting.time),
      );
      list.append(row);
    }
    list.append(...todos.map(peekTask));
    if (!events.length && !todos.length)
      list.append(el("p", "demo-empty", "Nothing scheduled or due."));
    calendarPane.replaceChildren(heading, week, list);
  }

  // ── Sidebar ───────────────────────────────────────────
  function renderSidebar() {
    navList.replaceChildren();
    const tasks = open("Tasks");
    const reminders = open("Reminders");
    const due = (items) => items.filter((item) => item.day === 0).length;
    const overdue = state.tasks.filter((item) => !item.done && item.day !== null && item.day < 0);
    // The app's own wording: short enough to read at the sidebar's width.
    const dueSummary = (today, late) =>
      today && late
        ? `${today} due · ${late} overdue`
        : today
          ? `${today} due today`
          : late
            ? `${late} overdue`
            : "Nothing due";
    const unread = state.mail.filter((mail) => mail.status === "inbox" && mail.unread).length;
    const latest = state.mail.find((mail) => mail.status === "inbox");
    const upcoming = todayMeetings().filter((item) => minutes(item.time) > NOW);
    const items = [
      ["Home", `${waiting().length} waiting on you`, waiting().length],
      [
        "Agenda",
        dueSummary(due(tasks) + due(reminders), overdue.length),
        overdue.length,
        overdue.length ? "alert" : "",
      ],
      ["Calendar", "Next 3:00 PM · Q4 roadmap sync", upcoming.length],
      ["Inbox", latest ? `Latest: ${latest.from}` : "Inbox clear", unread],
      ["Tasks", dueSummary(due(tasks), overdue.length), tasks.length],
      ["Reminders", `${due(reminders)} due today`, reminders.length],
      ["Notes", "1 note", undefined],
    ];
    for (const [name, detail, count, tone] of items) {
      const node = button("", () => go(name), "demo-nav-button");
      node.dataset.key = `nav-${name}`;
      // The label text is hidden at phone width, so the name can't come from it alone.
      node.setAttribute("aria-label", `${name}, ${detail}`);
      const text = el("span", "demo-nav-text");
      text.append(el("strong", "", name), el("small", "", detail));
      node.replaceChildren(symbol(name), text);
      if (count !== undefined && count > 0) {
        const badge = el("span", `demo-nav-count${tone ? ` is-${tone}` : ""}`);
        if (tone === "alert") badge.append(icon("Alert"));
        badge.append(el("span", "", String(count)));
        node.append(badge);
      }
      if (name === view && !assistantOpen) node.setAttribute("aria-current", "page");
      navList.append(node);
    }
    navList.append(el("span", "demo-nav-group", "AI"));
    const ai = button("", () => setAssistant(!assistantOpen), "demo-nav-button");
    const aiText = el("span", "demo-nav-text");
    aiText.append(el("strong", "", "Assistant"), el("small", "", "Sample answers · no live AI"));
    ai.replaceChildren(symbol("Assistant"), aiText);
    ai.setAttribute("aria-pressed", String(assistantOpen));
    navList.append(ai);

    navFoot.replaceChildren();
    const upNext = button("", () => go("Calendar", { event: "e4", key: "e4" }), "demo-up-next");
    upNext.setAttribute("aria-label", "Up next at 3:00 PM: Q4 roadmap sync");
    const upText = el("span");
    upText.append(el("small", "", "Up next · 3:00 PM"), el("strong", "", "Q4 roadmap sync"));
    upNext.replaceChildren(upText);
    const profile = el("div", "demo-profile");
    const avatar = el("span", "demo-avatar", "AR");
    const who = el("span");
    who.append(el("strong", "", "Alex Rivera"), el("small", "", "Connected"));
    profile.append(avatar, who);
    navFoot.append(upNext, profile);
  }

  function render() {
    const scroll = renderedView === view ? content.scrollTop : 0;
    content.replaceChildren();
    content.setAttribute("aria-label", `${view} demo`);
    viewTitle.textContent = view;
    back.disabled = historyIndex === 0;
    forward.disabled = historyIndex === history.length - 1;
    renderSidebar();
    ({
      Home: renderHome,
      Agenda: renderAgenda,
      Calendar: renderCalendar,
      Inbox: renderMail,
      Tasks: () => renderTodos("Tasks"),
      Reminders: () => renderTodos("Reminders"),
      Notes: renderNotes,
    })[view]();
    syncPane();
    renderPeek();
    content.scrollTop = scroll;
    renderedView = view;
    undo.hidden = !previous;
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && assistantOpen) {
      event.preventDefault();
      setAssistant(false);
    }
  });
  setWidth("nav", widths.nav, false);
  setWidth("pane", widths.pane, false);
  if (readPref("sidebar") === "closed") {
    nav.hidden = true;
    handles.nav.hidden = true;
    toolbarLead.hidden = false;
  }
  // The calendar opens beside Home only where it fits next to the page (narrower windows show it
  // over the page, so it waits for a click there). First visit: open on a wide window, as in the
  // app's screenshots; after that the visitor's last choice wins.
  const fits = (width) => Boolean(globalThis.matchMedia?.(`(min-width: ${width}px)`).matches);
  const storedCalendar = readPref("calendar");
  calendarOpen = fits(1101) && (storedCalendar === null ? fits(1180) : storedCalendar === "open");
  render();
  root.hidden = false;
}
