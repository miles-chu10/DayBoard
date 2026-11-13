import { CalendarDays, ChevronDown, ChevronUp, ListTodo, Plus, Settings, Sun } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  Button,
  Callout,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Text,
} from "@renderer/ui";

import { availableKinds } from "@shared/capture";

import { MeetingCard } from "../components/meeting-card";
import { SourceDot } from "../components/source-dot";
import { buildAgenda } from "../lib/agenda";
import { identifyCalendarEvents } from "../lib/calendar-identity";
import { dayHeading, longToday, todayISO } from "../lib/dates";
import { ageLabel, isStale, needsYou } from "../lib/home";
import { errorMessage, invoke, openSettings } from "../lib/ipc";
import { useLicenseSnapshot } from "../lib/license";
import { dueFollowUps, useMailSchedule } from "../lib/mail-schedule";
import {
  useAccounts,
  useAgendaState,
  useCalendarRange,
  useItemLists,
  useMail,
  useReminders,
  useTasks,
} from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { buildTodos, mergeLinkedTodos } from "../lib/todos";
import { readStored, writeStored } from "../lib/storage";
import { readTriageMap } from "../lib/triage";
import { useAgendaClock } from "../lib/use-agenda-clock";
import { panelAiCapture, type CaptureRecordView } from "./capture-panel-state";
import { chooseTarget, targetOptions } from "./capture-target";
import { afterRejection } from "./menubar-capture";
import {
  hidePanel,
  showPanel,
  useFitPanelHeight,
  usePanelEscape,
  usePanelShown,
} from "./panel-ipc";
import { upcomingItems, todayItems, type TodayItem } from "./today-items";

const OVERDUE_OPEN_KEY = "menubar:overdueOpen:v1";
const COLLAPSED_DAYS_KEY = "menubar:collapsedEventDays:v1";
const DESTINATION_KEY = "menubar:captureDestination:v1";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isDayMap = (value: unknown): value is Record<string, boolean> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(isBoolean);

function rowClass(extra = "") {
  return `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${extra}`;
}

/** A to-do: its source dot, the title, then its due time or age on the right (red once late). */
function TodoRow({ item }: { item: TodayItem }) {
  return (
    <button type="button" className={rowClass()} onClick={() => void openMain("/agenda")}>
      <SourceDot source={item.source} />
      <Text as="span" variant="regular" truncate title={item.title} className="min-w-0 flex-1">
        {item.title}
      </Text>
      {item.time ? (
        <Text
          as="span"
          variant="small"
          color={item.overdue ? "red" : "secondary"}
          className="shrink-0 tabular-nums"
        >
          {item.time}
        </Text>
      ) : null}
    </button>
  );
}

function eventTime(item: TodayItem) {
  if (!item.end || item.end === item.time) return item.time ?? "";
  return `${item.time}–${item.end}`;
}

/**
 * A day's events in one card, each with its calendar bar. The chevron folds the card to a
 * one-line count; the panel remembers that per day.
 */
function EventGroup({
  events,
  collapsed,
  onCollapsedChange,
}: {
  events: TodayItem[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  if (!events.length) return null;
  const label = `${events.length} ${events.length === 1 ? "event" : "events"}`;
  return (
    <div
      role="group"
      aria-label="Events"
      className="flex items-start gap-1 rounded-lg bg-control-subtle p-1"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {collapsed ? (
          <button type="button" className={rowClass()} onClick={() => onCollapsedChange(false)}>
            <SourceDot source="calendar" className="h-4 w-0.5 rounded-full" />
            <Text as="span" variant="small" color="secondary">
              {label}
            </Text>
          </button>
        ) : (
          events.map((item) => (
            <button
              key={item.key}
              type="button"
              className={rowClass()}
              onClick={() => void openMain("/calendar")}
            >
              <SourceDot
                source={item.source}
                className={`h-4 w-0.5 rounded-full ${item.past ? "opacity-50" : ""}`}
              />
              <Text
                as="span"
                variant="small"
                color={item.past ? "tertiary" : "secondary"}
                className="shrink-0 tabular-nums"
              >
                {eventTime(item)}
              </Text>
              <Text
                as="span"
                variant="small"
                color={item.past ? "tertiary" : undefined}
                truncate
                title={item.title}
                data-past={item.past ? "" : undefined}
                className="min-w-0 flex-1"
              >
                {item.title}
              </Text>
            </button>
          ))
        )}
      </div>
      <Button
        size="small"
        variant="transparent"
        iconOnly
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Show ${label}` : `Hide ${label}`}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        {collapsed ? <ChevronDown aria-hidden="true" /> : <ChevronUp aria-hidden="true" />}
      </Button>
    </div>
  );
}

/** Small-caps section label with its count, as "TODAY 3"; overdue reads red. */
function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <>
      <span className="text-[11px] font-semibold tracking-wide uppercase">{label}</span>
      <span className="ml-1.5 text-[11px] font-medium tabular-nums opacity-70">{count}</span>
    </>
  );
}

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <Text
      as="h2"
      variant="small"
      color="secondary"
      className="px-2 pb-0.5"
      aria-label={`${label} · ${count}`}
    >
      <SectionLabel label={label} count={count} />
    </Text>
  );
}

/** A day's events (one foldable card) and then its open to-dos. */
function DayItems({
  items,
  collapsed,
  onCollapsedChange,
}: {
  items: TodayItem[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const events = items.filter((item) => item.kind === "event");
  const todos = items.filter((item) => item.kind === "todo");
  return (
    <>
      <EventGroup events={events} collapsed={collapsed} onCollapsedChange={onCollapsedChange} />
      {todos.map((item) => (
        <TodoRow key={item.key} item={item} />
      ))}
    </>
  );
}

function openMain(route: string, prompt?: string) {
  return invoke("panel:openMain", prompt ? { route, prompt } : { route });
}

function useRecentCaptures(): CaptureRecordView[] {
  const [records, setRecords] = useState<CaptureRecordView[]>([]);
  useEffect(() => {
    const apply = (value: unknown) => {
      if (Array.isArray(value)) setRecords(value as CaptureRecordView[]);
    };
    let revision = 0;
    const stopAccounts = window.dayboard.ipc.onNotification("accounts:changed", () => {
      revision += 1;
      setRecords([]);
    });
    const stopRecords = window.dayboard.ipc.onNotification("capture:changed", (params) => {
      revision += 1;
      apply((params as { records?: unknown } | null)?.records);
    });
    void invoke<unknown>("capture:recent").then(
      (records) => {
        if (revision === 0) apply(records);
      },
      () => undefined,
    );
    return () => {
      revision += 1;
      stopAccounts();
      stopRecords();
    };
  }, []);
  return records;
}

/** HeroSpace's menu-bar feed: the emails and follow-ups waiting on you, newest worries first. */
function WaitingOnYou({ now }: { now: Date }) {
  const settings = useSettings().data;
  const mail = useMail();
  const schedule = useMailSchedule();
  const waiting = needsYou({
    messages: mail.data?.state === "ok" ? mail.data.items : [],
    triage: featureOn(settings, "triage") ? readTriageMap() : {},
    now: now.getTime(),
    followUps: dueFollowUps(schedule.data),
  });
  if (!waiting.length) return null;
  return (
    <section aria-label="Waiting on you" className="flex flex-col">
      <SectionHeading label="Waiting on you" count={waiting.length} />
      {waiting.slice(0, 3).map((item) => (
        <button
          key={item.key}
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          onClick={() => void openMain("/")}
        >
          <SourceDot source="mail" />
          <Text as="span" variant="regular" truncate className="min-w-0 flex-1" title={item.detail}>
            {item.title} · {item.detail}
          </Text>
          <Text
            as="span"
            variant="small"
            color={isStale(item.since, now.getTime()) ? "orange" : "secondary"}
            className="shrink-0 tabular-nums"
          >
            {ageLabel(item.since, now.getTime())}
          </Text>
        </button>
      ))}
    </section>
  );
}

export function MenuBarPanel() {
  const container = useFitPanelHeight<HTMLDivElement>("menubar");
  const settings = useSettings().data;
  const now = useAgendaClock();
  const today = todayISO();
  const calendar = useCalendarRange(today, 7);
  const [view, setView] = useState<"today" | "upcoming">("today");
  const tasks = useTasks();
  const reminders = useReminders();
  const planning = useAgendaState();
  const records = useRecentCaptures();
  const accounts = useAccounts().data;
  const [savedDestination, setSavedDestination] = useState(() =>
    readStored(DESTINATION_KEY, (value): value is string => typeof value === "string"),
  );
  const { data: license, refetch: refetchLicense } = useLicenseSnapshot();
  const [text, setText] = useState("");
  // The rejection arrives later; it must see what is typed by then, not when it was submitted.
  const latestText = useRef(text);
  const accountRevision = useRef(0);
  useEffect(() => {
    latestText.current = text;
  }, [text]);
  const [error, setError] = useState<string | null>(null);
  // Overdue starts collapsed so today stays in view; the panel remembers if you expand it.
  const [overdueOpen, setOverdueOpenState] = useState(
    () => readStored(OVERDUE_OPEN_KEY, isBoolean) ?? false,
  );
  const setOverdueOpen = (next: boolean) => {
    setOverdueOpenState(next);
    writeStored(OVERDUE_OPEN_KEY, next);
  };
  // Folded event cards, by date; past dates drop out the next time one changes.
  const [collapsedDays, setCollapsedDays] = useState(
    () => readStored(COLLAPSED_DAYS_KEY, isDayMap) ?? {},
  );
  const setDayCollapsed = (date: string, next: boolean) => {
    const updated = Object.fromEntries(
      Object.entries({ ...collapsedDays, [date]: next }).filter(
        ([day, folded]) => folded && day >= today,
      ),
    );
    setCollapsedDays(updated);
    writeStored(COLLAPSED_DAYS_KEY, updated);
  };

  useEffect(
    () =>
      window.dayboard.ipc.onNotification("accounts:changed", () => {
        accountRevision.current += 1;
        latestText.current = "";
        setText("");
        setError(null);
      }),
    [],
  );

  usePanelShown(() => {
    setError(null);
    void refetchLicense();
  });
  usePanelEscape("menubar");

  const on = {
    tasks: sourceOn(settings, "tasks"),
    reminders: sourceOn(settings, "reminders"),
    calendar: sourceOn(settings, "calendar"),
  };
  const todos = mergeLinkedTodos(
    buildTodos(tasks.data, reminders.data),
    planning.data?.duplicateLinks,
    on,
  );
  const scheduleLoading =
    (on.calendar && calendar.isPending) ||
    (on.tasks && tasks.isPending) ||
    (on.reminders && reminders.isPending);
  const schedulePartial =
    (on.calendar && (calendar.isError || (calendar.data && calendar.data.state !== "ok"))) ||
    (on.tasks && tasks.isError) ||
    (on.reminders && reminders.isError);
  const events = identifyCalendarEvents(calendar.data?.state === "ok" ? calendar.data.items : []);
  const agenda = buildAgenda({ events, todos, startDate: today, days: 7, now, sources: on });
  const { overdueCount, overdue, items, hiddenCount } = todayItems(agenda, now);
  const upcoming = upcomingItems(agenda, now);
  // The AI-only box would only fail while the license locks AI; the manual form stays free.
  const ai = panelAiCapture(settings, license?.status);
  const canAsk = featureOn(settings, "assistant");
  const shown = records.filter((record) => record.state !== "processing").slice(0, 3);
  const kinds =
    settings && accounts
      ? availableKinds({
          googleConnected: accounts.google.connected,
          remindersAccess: accounts.reminders,
          sources: settings.sources,
        })
      : null;
  const taskLists = useItemLists("tasks", Boolean(kinds?.task));
  const reminderLists = useItemLists("reminders", Boolean(kinds?.reminder));
  const destinations = targetOptions({
    ai: ai.available,
    tasks: kinds?.task ? (taskLists.data ?? null) : null,
    reminders: kinds?.reminder ? (reminderLists.data ?? null) : null,
  });
  const destination = chooseTarget(destinations, savedDestination);
  const chooseDestination = (key: string) => {
    setSavedDestination(key);
    writeStored(DESTINATION_KEY, key);
  };
  const addPlaceholder = !destination
    ? "Connect a list to add here…"
    : destination.target
      ? `Add to “${destination.title}”…`
      : canAsk
        ? "Add or ask…"
        : "Add…";

  function capture() {
    const started = accountRevision.current;
    const value = text.trim();
    if (!value) return;
    const target = destination?.target ?? null;
    // Without AI the line is the title, added as is to the chosen list.
    const payload = ai.available
      ? { text: value, target }
      : target
        ? {
            draft: { kind: target.kind, title: value, notes: "", date: "", time: "", endTime: "" },
            target,
          }
        : null;
    if (!payload) return;
    setText("");
    setError(null);
    void invoke("capture:submit", payload).catch((reason: unknown) => {
      if (started !== accountRevision.current) return;
      const next = afterRejection(latestText.current, value, errorMessage(reason));
      setText(next.text);
      setError(next.error);
    });
  }

  function undo(id: string) {
    const started = accountRevision.current;
    void invoke("capture:undo", { id }).catch((reason: unknown) => {
      if (started === accountRevision.current) setError(errorMessage(reason));
    });
  }

  return (
    <div ref={container} className="flex max-h-[560px] flex-col gap-3 p-3">
      <div className="flex shrink-0 items-baseline justify-between gap-2">
        <div>
          <Text as="h1" variant="large-strong">
            {view === "today" ? "Today" : "Upcoming"}
          </Text>
          <Text as="p" variant="small" color="secondary">
            {longToday()}
            {overdueCount ? ` · ${overdueCount} overdue` : ""}
          </Text>
        </div>
        <Button size="small" variant="transparent" onClick={() => void openMain("/")}>
          Open DayBoard
        </Button>
      </div>

      {error ? <Callout color="red">{error}</Callout> : null}
      <div className="flex shrink-0 gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-md bg-control-subtle pl-2 focus-within:outline-2 focus-within:outline-accent">
          <Plus className="size-4 shrink-0 text-tertiary" aria-hidden="true" />
          <Input
            aria-label={ai.available ? "Add or ask" : "Quick add"}
            className="flex-1 border-0 bg-transparent focus-visible:outline-none"
            placeholder={addPlaceholder}
            value={text}
            disabled={!ai.available && !destination}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                capture();
              }
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="small"
                variant="transparent"
                iconOnly
                aria-label={`Add to: ${destination?.title ?? "choose a list"}`}
                title="Choose where to add"
              >
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
              {destinations.map((option, index) => (
                <Fragment key={option.key}>
                  {option.group && option.group !== destinations[index - 1]?.group ? (
                    <>
                      {index ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuLabel>{option.group}</DropdownMenuLabel>
                    </>
                  ) : null}
                  <DropdownMenuCheckboxItem
                    checked={option.key === destination?.key}
                    onCheckedChange={() => chooseDestination(option.key)}
                  >
                    {option.title}
                  </DropdownMenuCheckboxItem>
                </Fragment>
              ))}
              {destinations.length ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                onSelect={() => {
                  void hidePanel("menubar");
                  void showPanel("capture");
                }}
              >
                Add with details…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {ai.available && canAsk ? (
          <Button disabled={!text.trim()} onClick={() => void openMain("/assistant", text.trim())}>
            Ask
          </Button>
        ) : null}
        {ai.lock ? (
          <Button variant="transparent" onClick={() => void openSettings("license")}>
            Unlock AI
          </Button>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto" aria-label="Agenda feed">
        {scheduleLoading ? (
          <Text as="p" variant="small" color="secondary" role="status">
            Loading schedule…
          </Text>
        ) : null}
        {schedulePartial ? (
          <Text as="p" variant="small" color="secondary" role="status">
            Some sources are unavailable. Open DayBoard to check connections.
          </Text>
        ) : null}
        {view === "today" ? (
          <>
            <MeetingCard surface="menubar" />

            {sourceOn(settings, "mail") ? <WaitingOnYou now={now} /> : null}

            <section aria-label="Today's items" className="flex flex-col gap-1">
              <SectionHeading label="Today" count={items.length + hiddenCount} />
              {items.length ? (
                <DayItems
                  items={items}
                  collapsed={collapsedDays[today] ?? false}
                  onCollapsedChange={(next) => setDayCollapsed(today, next)}
                />
              ) : (
                <Text as="p" variant="small" color="secondary" className="px-2">
                  {scheduleLoading ? "" : "Nothing else today in available sources."}
                </Text>
              )}
              {hiddenCount ? (
                <Button
                  size="small"
                  variant="transparent"
                  className="self-start"
                  onClick={() => void openMain("/agenda")}
                >
                  {hiddenCount} more in DayBoard
                </Button>
              ) : null}
            </section>

            {overdueCount ? (
              <section aria-label="Overdue items" className="flex flex-col gap-1">
                <CollapsibleRoot open={overdueOpen} onOpenChange={setOverdueOpen}>
                  <CollapsibleTrigger
                    aria-label={`${overdueCount} overdue ${overdueCount === 1 ? "task" : "tasks"}`}
                    className="w-full rounded-md px-2 py-0.5 text-support-red hover:bg-list-hover"
                  >
                    <SectionLabel label="Overdue" count={overdueCount} />
                    <CollapsibleChevron className="ml-auto" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="flex flex-col pt-1">
                      {overdue.map((item) => (
                        <TodoRow key={item.key} item={item} />
                      ))}
                      {overdueCount > overdue.length ? (
                        <Button
                          size="small"
                          variant="transparent"
                          className="self-start"
                          onClick={() => void openMain("/agenda")}
                        >
                          {overdueCount - overdue.length} more in DayBoard
                        </Button>
                      ) : null}
                    </div>
                  </CollapsibleContent>
                </CollapsibleRoot>
              </section>
            ) : null}
          </>
        ) : (
          <section aria-label="Upcoming items" className="flex flex-col gap-4">
            {upcoming.length ? (
              upcoming.map((day) => (
                <section
                  key={day.date}
                  aria-label={dayHeading(day.date)}
                  className="flex flex-col gap-1"
                >
                  <SectionHeading
                    label={dayHeading(day.date)}
                    count={day.items.length + day.hiddenCount}
                  />
                  <DayItems
                    items={day.items}
                    collapsed={collapsedDays[day.date] ?? false}
                    onCollapsedChange={(next) => setDayCollapsed(day.date, next)}
                  />
                  {day.hiddenCount ? (
                    <Button
                      size="small"
                      variant="transparent"
                      className="self-start"
                      onClick={() => void openMain("/agenda")}
                    >
                      {day.hiddenCount} more in DayBoard
                    </Button>
                  ) : null}
                </section>
              ))
            ) : (
              <Text as="p" variant="small" color="secondary" className="px-2">
                {scheduleLoading
                  ? ""
                  : "No scheduled items in the next six days in available sources."}
              </Text>
            )}
          </section>
        )}

        {shown.length ? (
          <section aria-label="Recent captures" className="flex flex-col gap-1">
            <Text as="h2" variant="small" color="secondary">
              Recently added
            </Text>
            {shown.map((record) => (
              <div key={record.id} className="flex items-center gap-2">
                <Text as="span" variant="small" truncate className="flex-1">
                  {record.state === "undone" ? `Undone: ${record.text}` : record.text}
                  {record.error ? ` — ${record.error}` : ""}
                </Text>
                {record.canUndo ? (
                  <Button size="small" variant="transparent" onClick={() => undo(record.id)}>
                    Undo
                  </Button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
      </div>
      <nav
        aria-label="Menu bar navigation"
        className="-mx-3 -mb-3 grid shrink-0 grid-cols-4 border-t border-separator px-3 py-1"
      >
        {(
          [
            { id: "today", label: "Today", Icon: Sun },
            { id: "upcoming", label: "Upcoming", Icon: CalendarDays },
          ] as const
        ).map(({ id, label, Icon }) => (
          <Button
            key={id}
            variant="transparent"
            iconOnly
            className={`justify-self-center ${view === id ? "text-accent" : "text-secondary"}`}
            aria-label={label}
            title={label}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            <Icon aria-hidden="true" />
          </Button>
        ))}
        <Button
          variant="transparent"
          iconOnly
          className="justify-self-center text-secondary"
          aria-label="Open agenda"
          title="Open Agenda in DayBoard"
          onClick={() => void openMain("/agenda")}
        >
          <ListTodo aria-hidden="true" />
        </Button>
        <Button
          variant="transparent"
          iconOnly
          className="justify-self-center text-secondary"
          aria-label="Open settings"
          title="Settings"
          onClick={() => void openSettings()}
        >
          <Settings aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
