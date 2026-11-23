import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Avatar,
  AvatarBadge,
  Badge,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarFooter,
  SidebarList,
  SidebarListGroup,
  SidebarListItem,
  Text,
} from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import { useEffect, useState } from "react";
import {
  CalendarCheck2,
  CalendarDays,
  CircleAlert,
  House,
  NotebookPen,
  Settings,
  Video,
} from "lucide-react";
import type { AppSettings, SourceId, SourceResult } from "@main/shared-types";

import { assistantProvider } from "../lib/ai-models";
import { eventDayKey, formatTimeOfDay, isEventPast, toISODate } from "../lib/dates";
import { connectionStatus } from "../lib/connection-status";
import { sidebarRows, type NavItem } from "../lib/navigation";
import { needsYou } from "../lib/home";
import { readTriageMap, useTriageChanges } from "../lib/triage";
import { dueFollowUps, useMailSchedule } from "../lib/mail-schedule";
import { useNotes } from "../lib/agent-data";
import { invoke, openExternal, openSettings } from "../lib/ipc";
import { useProfileAvatar } from "../lib/profile-avatar";
import { useAccounts, useCalendar, useMail, useReminders, useTasks } from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { COLOR_CLASS, SOURCE_META, sourceColor, sourceColorVar } from "../lib/sources";
import { buildTodos } from "../lib/todos";
import { useAgendaClock } from "../lib/use-agenda-clock";
import { NewItemButton } from "./new-item-button";
import { EventDetail } from "./event-detail";
import { ProviderMark } from "./provider-logo";
import { LicenseStatusControl, ProBadge } from "./license-gate";
import { sourceStatusShort } from "./source-gate";

/**
 * The name from Settings, else the name on this Mac's user account, else one derived from the
 * Google address ("first.last" → "First Last").
 */
export function knownName(
  settings: AppSettings | undefined,
  email?: string | null,
  macName?: string,
): string {
  const configured = settings?.general.userName.trim() || macName?.trim();
  if (configured) return configured;
  const local = email?.split("@", 1)[0] ?? "";
  const words = local.split(/[._-]+/).filter((word) => /^[a-z]+$/i.test(word));
  return words.length
    ? words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(" ")
    : (email ?? "");
}

/** A name to show for the person; "You" when DayBoard knows neither a name nor an address. */
export function displayName(
  settings: AppSettings | undefined,
  email?: string | null,
  macName?: string,
): string {
  return knownName(settings, email, macName) || "You";
}

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2);
  return letters.toUpperCase() || "D";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** What is wrong with a source, if anything. A healthy source shows only its count. */
function sourceProblem(query: {
  isPending: boolean;
  isError: boolean;
  data?: SourceResult<unknown>;
}): string | undefined {
  if (query.isPending) return undefined;
  if (!query.data) return "Unavailable";
  if (query.data.state !== "ok") return sourceStatusShort(query.data) ?? undefined;
  if (query.isError || query.data.refreshError) return "Refresh failed";
  if (query.data.coverage?.complete === false) return "Partially loaded";
  return undefined;
}

const CONNECTION_BADGE = { ok: "green", attention: "orange", off: "gray" } as const;
const CONNECTION_TEXT = { ok: "green", attention: "orange", off: "secondary" } as const;

type MainNavId = "home" | "agenda" | "notes" | SourceId;

/** A count pill; overdue counts carry an icon so they don't rely on color alone. */
function SidebarCount({
  count,
  label,
  overdue = false,
}: {
  count: number;
  label: string;
  overdue?: boolean;
}) {
  return (
    <Badge
      color={overdue ? "red" : "secondary"}
      className="app-sidebar-badge min-w-6 shrink-0 justify-center tabular-nums"
      title={label}
      role="img"
      aria-label={label}
    >
      {overdue ? <CircleAlert aria-hidden="true" /> : null}
      {count}
    </Badge>
  );
}

function SidebarSymbol({ children, className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn("app-sidebar-symbol text-secondary", className)}
      {...props}
    >
      {children}
    </span>
  );
}

export function AppSidebar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const settings = useSettings().data;
  const accounts = useAccounts();
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const calendar = useCalendar();
  const avatar = useProfileAvatar();
  const provider = assistantProvider(settings);

  const now = useAgendaClock();
  const today = toISODate(now);
  const open = buildTodos(tasks.data, reminders.data).filter((todo) => !todo.completed);
  const todayEvents =
    calendar.data?.state === "ok"
      ? calendar.data.items.filter((event) => eventDayKey(event) === today && !isEventPast(event))
      : [];
  const nextEvent = todayEvents.find((event) => !event.allDay && new Date(event.end) > now);
  const unread = mail.data?.state === "ok" ? mail.data.items.filter((item) => item.unread) : [];

  const counts: Record<SourceId, number> = {
    tasks: open.filter((todo) => todo.source === "tasks").length,
    reminders: open.filter((todo) => todo.source === "reminders").length,
    mail: unread.length,
    calendar: todayEvents.length,
  };
  const problems: Record<SourceId, string | undefined> = {
    tasks: sourceProblem(tasks),
    reminders: sourceProblem(reminders),
    mail: sourceProblem(mail),
    calendar: sourceProblem(calendar),
  };

  const google = accounts.data?.google;
  const name = knownName(settings, google?.email, accounts.data?.macName) || "DayBoard";
  const remindersOk = accounts.data?.reminders === "full-access";
  const connection = connectionStatus({
    google,
    googleSources: [
      sourceOn(settings, "tasks") ? tasks.data : undefined,
      sourceOn(settings, "calendar") ? calendar.data : undefined,
    ],
    remindersOk: remindersOk || !sourceOn(settings, "reminders"),
  });
  const connectionDetail = [
    connection.googleDetail,
    `Apple Reminders: ${remindersOk ? "allowed" : "not allowed"}`,
    "Change your name or picture in Settings → General.",
  ].join("\n");
  const showAssistant = featureOn(settings, "assistant");
  const showReview = featureOn(settings, "weeklyReview");
  const [upNextOpen, setUpNextOpen] = useState(false);
  const agendaDue = open.filter((todo) => todo.dueDate === today).length;
  const agendaLate = open.filter((todo) => todo.dueDate && todo.dueDate < today).length;

  useTriageChanges();
  const schedule = useMailSchedule();
  const waiting = needsYou({
    messages: mail.data?.state === "ok" && sourceOn(settings, "mail") ? mail.data.items : [],
    triage: featureOn(settings, "triage") ? readTriageMap() : {},
    now: now.getTime(),
    followUps: sourceOn(settings, "mail") ? dueFollowUps(schedule.data) : [],
  }).length;

  // The Dock badge shows what Settings picks: what waits on you, unread mail, or nothing.
  const notes = useNotes();
  const showCounts = settings?.general.sidebar.counts ?? true;
  const rows = sidebarRows(settings) as { item: NavItem & { id: MainNavId }; nested: boolean }[];
  const badgeSetting = settings?.system.dockBadge;
  const badgeCount =
    badgeSetting === "waiting" ? waiting : badgeSetting === "unread" ? counts.mail : 0;
  useEffect(() => {
    if (badgeSetting === undefined) return;
    void invoke("app:setBadge", { count: badgeCount }).catch(() => undefined);
  }, [badgeCount, badgeSetting]);

  function navIcon(id: MainNavId) {
    if (id === "home")
      return (
        <SidebarSymbol>
          <House className="size-[18px]" strokeWidth={1.75} />
        </SidebarSymbol>
      );
    if (id === "agenda")
      return (
        <SidebarSymbol>
          <CalendarDays className="size-[18px]" strokeWidth={1.75} />
        </SidebarSymbol>
      );
    if (id === "notes")
      return (
        <SidebarSymbol>
          <NotebookPen className="size-[18px]" strokeWidth={1.75} />
        </SidebarSymbol>
      );
    const Icon = SOURCE_META[id].icon;
    const color = sourceColor(settings, id);
    return (
      <SidebarSymbol
        className={COLOR_CLASS[color].text}
        style={{
          background: `color-mix(in srgb, ${sourceColorVar(color)} 12%, transparent)`,
        }}
      >
        <Icon className="size-[18px]" />
      </SidebarSymbol>
    );
  }

  function navSelected(_id: MainNavId, route: string): boolean {
    return pathname === route;
  }

  // Rows are one line; a second line appears only when a source needs attention.
  function navSubtitle(id: MainNavId): string | undefined {
    return id === "home" || id === "agenda" || id === "notes" ? undefined : problems[id];
  }

  function navAccessory(id: MainNavId) {
    if (id === "home")
      return waiting ? (
        <SidebarCount count={waiting} label={`${waiting} waiting on you`} />
      ) : undefined;
    if (id === "agenda") {
      return agendaLate ? (
        <SidebarCount count={agendaLate} label={plural(agendaLate, "overdue item")} overdue />
      ) : agendaDue ? (
        <SidebarCount count={agendaDue} label={`${plural(agendaDue, "item")} due today`} />
      ) : undefined;
    }
    if (id === "notes") {
      const count = notes.data?.length ?? 0;
      return count ? <SidebarCount count={count} label={plural(count, "note")} /> : undefined;
    }
    const count = counts[id];
    const label =
      id === "mail"
        ? plural(count, "unread message")
        : id === "calendar"
          ? `${plural(count, "event")} left today`
          : plural(count, id === "tasks" ? "open task" : "open reminder");
    return count ? <SidebarCount count={count} label={label} /> : undefined;
  }

  return (
    <Sidebar
      className="app-sidebar"
      toolbar={
        <div className="drag-region flex h-13 shrink-0 items-center justify-end pr-3">
          <NewItemButton />
        </div>
      }
      footer={
        <SidebarFooter>
          <LicenseStatusControl />
          <div className="flex flex-col gap-1.5 px-2 py-1.5 min-w-0">
            {nextEvent && sourceOn(settings, "calendar") ? (
              <div
                role="button"
                tabIndex={0}
                aria-label={`Open next event: ${nextEvent.title}`}
                onClick={() => setUpNextOpen(true)}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    setUpNextOpen(true);
                  }
                }}
                className="flex cursor-default items-center gap-2 rounded-lg bg-control-subtle px-2 py-1.5 text-left hover:bg-control"
              >
                <span
                  aria-hidden="true"
                  className="h-7 w-[3px] shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      nextEvent.calendarColor ?? sourceColorVar(sourceColor(settings, "calendar")),
                  }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <Text variant="small" color="secondary">
                    {new Date(nextEvent.start) <= now
                      ? "Now"
                      : `Up next · ${formatTimeOfDay(nextEvent.start)}`}
                  </Text>
                  <Text variant="small-strong" truncate>
                    {nextEvent.title}
                  </Text>
                </span>
                {nextEvent.meetLink ? (
                  <Button
                    size="small"
                    iconOnly
                    aria-label={`Join ${nextEvent.title}`}
                    title="Join"
                    onClick={(event) => {
                      event.stopPropagation();
                      void openExternal(nextEvent.meetLink!);
                    }}
                  >
                    <Video />
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center gap-1.5 min-w-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-control-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    title={connectionDetail}
                    aria-label={`Profile menu for ${name}`}
                  >
                    <Avatar size="small" className="shrink-0">
                      {avatar.dataUrl ? <AvatarImage src={avatar.dataUrl} alt={name} /> : null}
                      <AvatarFallback>{initials(name)}</AvatarFallback>
                      <AvatarBadge color={CONNECTION_BADGE[connection.tone]} />
                    </Avatar>
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Text variant="small-strong" truncate>
                          {name}
                        </Text>
                        <ProBadge />
                      </div>
                      {connection.tone === "ok" ? null : (
                        <Text variant="small" color={CONNECTION_TEXT[connection.tone]} truncate>
                          {connection.label}
                        </Text>
                      )}
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start">
                  <DropdownMenuItem
                    icon="photo"
                    disabled={avatar.busy}
                    onSelect={() => avatar.pick()}
                  >
                    Change picture…
                  </DropdownMenuItem>
                  {avatar.hasAvatar ? (
                    <DropdownMenuItem
                      icon="trash"
                      color="red"
                      disabled={avatar.busy}
                      onSelect={() => avatar.clear()}
                    >
                      Remove picture
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon="gear" onSelect={() => void openSettings()}>
                    Settings…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                iconOnly
                size="small"
                variant="transparent"
                className="shrink-0"
                aria-label="Settings"
                title="Settings"
                onClick={() => void openSettings()}
              >
                <Settings />
              </Button>
            </div>
          </div>
        </SidebarFooter>
      }
    >
      <SidebarList role="navigation" aria-label="Main navigation">
        {rows.map(({ item, nested }) => (
          <SidebarListItem
            key={item.id}
            className={nested ? "app-sidebar-nested" : undefined}
            icon={navIcon(item.id)}
            title={item.title}
            subtitle={navSubtitle(item.id)}
            accessory={showCounts ? navAccessory(item.id) : undefined}
            selected={navSelected(item.id, item.route)}
            onClick={() => void navigate({ to: item.route })}
          />
        ))}
        {showAssistant || showReview ? (
          <div className="my-[var(--density-section-gap)]">
            <SidebarListGroup title="AI">
              {showAssistant ? (
                <SidebarListItem
                  icon={
                    <SidebarSymbol>
                      <ProviderMark provider={provider} className="size-[18px]" />
                    </SidebarSymbol>
                  }
                  title="Assistant"
                  subtitle={
                    settings?.ai.providerChosen === false
                      ? "Choose an AI provider in Settings"
                      : undefined
                  }
                  selected={pathname === "/assistant"}
                  onClick={() => void navigate({ to: "/assistant" })}
                />
              ) : null}
              {showReview ? (
                <SidebarListItem
                  icon={
                    <SidebarSymbol>
                      <CalendarCheck2 className="size-[18px]" strokeWidth={1.75} />
                    </SidebarSymbol>
                  }
                  title="Weekly Review"
                  selected={pathname === "/review"}
                  onClick={() => void navigate({ to: "/review" })}
                />
              ) : null}
            </SidebarListGroup>
          </div>
        ) : null}
      </SidebarList>
      {upNextOpen && nextEvent ? (
        <EventDetail
          key={nextEvent.id}
          event={nextEvent}
          presentation="dialog"
          onClose={() => setUpNextOpen(false)}
        />
      ) : null}
    </Sidebar>
  );
}
