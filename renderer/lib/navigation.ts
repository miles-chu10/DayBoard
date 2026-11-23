import type { AIFeature, AppSettings, SidebarView, SourceId } from "@main/shared-types";

export type NavRoute =
  | "/"
  | "/agenda"
  | "/calendar"
  | "/mail"
  | "/tasks"
  | "/reminders"
  | "/notes"
  | "/assistant"
  | "/review";

export type NavId = "home" | "agenda" | SourceId | "notes" | "assistant" | "review";

export interface NavItem {
  id: NavId;
  title: string;
  route: NavRoute;
  group: "main" | "ai";
  /** Extra words the command menu matches. */
  keywords: string[];
  source?: SourceId;
  feature?: AIFeature;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "home",
    title: "Home",
    route: "/",
    group: "main",
    keywords: ["up next", "today", "needs you", "start"],
  },
  {
    id: "agenda",
    title: "Agenda",
    route: "/agenda",
    group: "main",
    keywords: ["day", "schedule", "planner"],
  },
  {
    id: "calendar",
    title: "Calendar",
    route: "/calendar",
    group: "main",
    keywords: ["events", "meetings", "schedule"],
    source: "calendar",
  },
  {
    id: "mail",
    title: "Inbox",
    route: "/mail",
    group: "main",
    keywords: ["mail", "gmail", "email"],
    source: "mail",
  },
  {
    id: "tasks",
    title: "Tasks",
    route: "/tasks",
    group: "main",
    keywords: ["google tasks", "todo"],
    source: "tasks",
  },
  {
    id: "reminders",
    title: "Reminders",
    route: "/reminders",
    group: "main",
    keywords: ["apple reminders", "todo"],
    source: "reminders",
  },
  {
    id: "notes",
    title: "Notes",
    route: "/notes",
    group: "main",
    keywords: ["notes", "markdown", "write", "docs"],
  },
  {
    id: "assistant",
    title: "Assistant",
    route: "/assistant",
    group: "ai",
    keywords: ["ai", "chat", "agent"],
    feature: "assistant",
  },
  {
    id: "review",
    title: "Weekly Review",
    route: "/review",
    group: "ai",
    keywords: ["week", "review"],
    feature: "weeklyReview",
  },
];

export function navItemVisible(settings: AppSettings | undefined, item: NavItem): boolean {
  if (item.source) return settings?.sources[item.source].enabled ?? true;
  if (item.feature) return Boolean(settings?.ai.enabled && settings.ai.features[item.feature]);
  return true;
}

/** Every view that can open, main views in the sidebar's saved order, then the AI views. */
export function navTargets(settings: AppSettings | undefined): NavItem[] {
  const order = settings?.general?.sidebar?.order ?? [];
  const rank = (item: NavItem) => {
    const index = order.indexOf(item.id as SidebarView);
    return item.group === "ai" ? 1_000 : index < 0 ? 500 : index;
  };
  return NAV_ITEMS.filter((item) => navItemVisible(settings, item))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/** The views in saved order, without the ones hidden in Settings. */
export function visibleNav(settings: AppSettings | undefined): NavItem[] {
  const hidden = settings?.general?.sidebar?.hidden ?? [];
  return navTargets(settings).filter((item) => !hidden.includes(item.id as SidebarView));
}

/** The sources the Agenda combines; in the sidebar they sit under it. */
const AGENDA_SOURCES: readonly NavId[] = ["calendar", "tasks", "reminders"];

export interface SidebarRow {
  item: NavItem;
  /** Indented under the Agenda row. */
  nested: boolean;
}

/**
 * The sidebar's main rows. Calendar, Tasks and Reminders follow the Agenda as nested rows, in
 * their saved order; with the Agenda hidden they stay where the saved order puts them.
 */
export function sidebarRows(settings: AppSettings | undefined): SidebarRow[] {
  const main = visibleNav(settings).filter((item) => item.group === "main");
  if (!main.some((item) => item.id === "agenda"))
    return main.map((item) => ({ item, nested: false }));
  const nested = main.filter((item) => AGENDA_SOURCES.includes(item.id));
  return main
    .filter((item) => !AGENDA_SOURCES.includes(item.id))
    .flatMap((item) => [
      { item, nested: false },
      ...(item.id === "agenda" ? nested.map((source) => ({ item: source, nested: true })) : []),
    ]);
}

/** Every sidebar view top to bottom, AI views last; ⌃1–9 follow this list. */
export function sidebarNav(settings: AppSettings | undefined): NavItem[] {
  return [
    ...sidebarRows(settings).map((row) => row.item),
    ...visibleNav(settings).filter((item) => item.group === "ai"),
  ];
}

export interface SidebarOrderRow {
  id: SidebarView;
  nested: boolean;
}

/**
 * Settings' list of the main views, laid out as the sidebar draws them: with the Agenda shown,
 * its sources follow it as nested rows. Hidden and turned-off views stay in the list.
 */
export function sidebarOrderRows(
  order: readonly SidebarView[],
  hidden: readonly SidebarView[],
): SidebarOrderRow[] {
  if (!order.includes("agenda") || hidden.includes("agenda"))
    return order.map((id) => ({ id, nested: false }));
  const nested = order.filter((id) => AGENDA_SOURCES.includes(id));
  return order
    .filter((id) => !AGENDA_SOURCES.includes(id))
    .flatMap((id) => [
      { id, nested: false },
      ...(id === "agenda" ? nested.map((source) => ({ id: source, nested: true })) : []),
    ]);
}

/**
 * The saved order after moving a view one place up (-1) or down (1) in Settings' list. A view
 * trades places with the nearest row of its own kind, so each press changes what the sidebar
 * shows; the same array comes back when there is nowhere to go.
 */
export function moveSidebarView(
  order: readonly SidebarView[],
  hidden: readonly SidebarView[],
  id: SidebarView,
  delta: -1 | 1,
): readonly SidebarView[] {
  const rows = sidebarOrderRows(order, hidden);
  const self = rows.find((row) => row.id === id);
  if (!self) return order;
  const peers = rows.filter((row) => row.nested === self.nested);
  const other = peers[peers.indexOf(self) + delta];
  if (!other) return order;
  return order.map((item) => (item === id ? other.id : item === other.id ? id : item));
}
