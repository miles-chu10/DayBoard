import { ChevronDown, CornerDownLeft, Plus, RefreshCw, Settings } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
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
  SegmentedControl,
  SegmentedControlItem,
  Text,
  cn,
} from "@renderer/ui";

import { formatAccelerator } from "@shared/accelerator";
import { availableKinds } from "@shared/capture";

import { MeetingCard } from "../components/meeting-card";
import { SourceDot } from "../components/source-dot";
import { buildAgenda } from "../lib/agenda";
import { identifyCalendarEvents } from "../lib/calendar-identity";
import { dayHeading, parseISODate, toISODate } from "../lib/dates";
import { ageLabel, isStale, needsYou } from "../lib/home";
import { errorMessage, invoke, openSettings } from "../lib/ipc";
import { useLicenseSnapshot } from "../lib/license";
import { dueFollowUps, useMailSchedule } from "../lib/mail-schedule";
import {
  queryKeys,
  useAccounts,
  useAgendaState,
  useCalendarRange,
  useItemLists,
  useMail,
  useReminders,
  useTasks,
  useToggleTodo,
} from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { readStored, writeStored } from "../lib/storage";
import { buildTodos, mergeLinkedTodos, type Todo } from "../lib/todos";
import { readTriageMap } from "../lib/triage";
import { useAgendaClock } from "../lib/use-agenda-clock";
import { panelAiCapture, type CaptureRecordView } from "./capture-panel-state";
import { chooseTarget, targetOptions } from "./capture-target";
import { CatchUp } from "./catch-up";
import { dayLine, matchGroups, overdueLine, weekStrip, type StripDay } from "./day-line";
import { afterRejection } from "./menubar-capture";
import { MenuBarTasks } from "./menubar-tasks";
import { MonthView } from "./month-view";
import { PanelAsk, usePanelAsk } from "./panel-ask";
import {
  hidePanel,
  showPanel,
  useFitPanelHeight,
  usePanelEscape,
  usePanelShown,
} from "./panel-ipc";
import { usePanelPrefs } from "./use-panel-prefs";
import { DayRows, EventItem, RowsProvider, TodoItem } from "./panel-rows";
import { PanelSettings } from "./panel-settings";
import { ALL, usePanelWrites, type PanelWrites } from "./panel-writes";
import { taskGroups } from "./task-groups";
import { canEditTodo } from "./todo-edit";
import { mayShareGoogleData } from "../lib/google-data";

type MenuBarView = "day" | "lists" | "month";
type MenuBarPage = "settings" | "ask" | "catch-up";
const VIEWS: { id: MenuBarView; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "lists", label: "Lists" },
  { id: "month", label: "Month" },
];

const OVERDUE_OPEN_KEY = "menubar:overdueOpen:v1";
const DESTINATION_KEY = "menubar:captureDestination:v1";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
/** Typing this much starts looking for matches; less is still just a draft. */
const SEARCH_FROM = 2;

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

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <Text
      as="h2"
      variant="small-strong"
      color="secondary"
      className="px-2 pb-0.5"
      aria-label={`${label} · ${count}`}
    >
      {label}
      <span className="ml-1.5 font-normal tabular-nums opacity-70">{count}</span>
    </Text>
  );
}

/** The emails and follow-ups waiting on you. A row opens in place to show what it says. */
function WaitingOnYou({ now }: { now: Date }) {
  const settings = useSettings().data;
  const mail = useMail();
  const schedule = useMailSchedule();
  const [openKey, setOpenKey] = useState<string | null>(null);
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
      <ul className="flex flex-col">
        {waiting.slice(0, 3).map((item) => {
          const open = openKey === item.key;
          return (
            <li key={item.key}>
              <button
                type="button"
                aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                onClick={() => setOpenKey(open ? null : item.key)}
              >
                <SourceDot source="mail" />
                <Text
                  as="span"
                  variant="regular"
                  truncate
                  className="min-w-0 flex-1"
                  title={item.detail}
                >
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
              {open ? (
                <div className="mt-1 mb-2 flex flex-col gap-1 rounded-xl bg-well p-2.5">
                  <Text as="p" variant="small-strong">
                    {item.detail}
                  </Text>
                  <Text as="p" variant="small" color="secondary">
                    {item.mail.from} · {item.chip}
                  </Text>
                  {item.mail.snippet ? (
                    <Text as="p" variant="small" color="secondary" className="line-clamp-5">
                      {item.mail.snippet}
                    </Text>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Seven days across the top: pick one and the line below becomes that day. */
function WeekStrip({
  days,
  selected,
  onSelect,
}: {
  days: StripDay[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div role="group" aria-label="Next seven days" className="grid shrink-0 grid-cols-7">
      {days.map((day) => {
        const isSelected = day.date === selected;
        return (
          <button
            key={day.date}
            type="button"
            aria-label={parseISODate(day.date).toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
            aria-pressed={isSelected}
            aria-current={day.today ? "date" : undefined}
            onClick={() => onSelect(day.date)}
            className="group flex flex-col items-center gap-0.5 rounded-lg py-1 hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            <Text as="span" variant="mini" color={day.today ? "accent" : "tertiary"}>
              {day.weekday}
            </Text>
            <span
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-regular tabular-nums",
                isSelected
                  ? "bg-accent font-semibold text-accent-contrast"
                  : day.today && "font-semibold text-accent",
              )}
            >
              {day.day}
            </span>
            <span className="flex h-1 gap-0.5" aria-hidden="true">
              {day.events ? <SourceDot source="calendar" className="size-1" /> : null}
              {day.todos ? <span className="size-1 rounded-full bg-tertiary" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Everything overdue, behind one row so today stays in view. Open, it is the whole list, each
 * item movable where it sits; Catch up goes through them one at a time.
 */
function OverdueCard({
  todos,
  oldest,
  today,
  writes,
  onCatchUp,
}: {
  todos: Todo[];
  oldest: string | null;
  today: string;
  writes: PanelWrites;
  onCatchUp: () => void;
}) {
  const [open, setOpenState] = useState(() => readStored(OVERDUE_OPEN_KEY, isBoolean) ?? false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    writeStored(OVERDUE_OPEN_KEY, next);
  };
  const [confirming, setConfirming] = useState(false);
  const movable = todos.filter(canEditTodo);
  const moving = writes.busy === ALL;
  return (
    <section aria-label="Overdue items" className="rounded-xl border border-separator bg-well p-1">
      <CollapsibleRoot open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-1">
          <CollapsibleTrigger
            aria-label={`${todos.length} overdue ${todos.length === 1 ? "task" : "tasks"}`}
            className="min-w-0 flex-1 rounded-lg px-2 py-1 hover:bg-list-hover"
          >
            <CollapsibleChevron />
            <Text as="span" variant="small-strong" color="red">
              Overdue
            </Text>
            <Text as="span" variant="small" color="red" className="tabular-nums">
              {todos.length}
            </Text>
            {oldest ? (
              <Text as="span" variant="small" color="tertiary" truncate className="min-w-0">
                · oldest {oldest.toLowerCase()}
              </Text>
            ) : null}
          </CollapsibleTrigger>
          <Button size="small" variant="accent" onClick={onCatchUp}>
            Catch up
          </Button>
        </div>
        <CollapsibleContent>
          <ul className="flex flex-col pt-1">
            {todos.map((todo) => (
              <TodoItem key={todo.key} todo={todo} due />
            ))}
          </ul>
          {movable.length > 1 ? (
            <div className="flex items-center gap-1 px-1 pt-1">
              {confirming ? (
                <>
                  <Text as="span" variant="small" color="secondary" className="flex-1 px-1">
                    Move {movable.length} to today?
                  </Text>
                  <Button
                    size="small"
                    variant="accent"
                    disabled={moving}
                    onClick={() =>
                      void writes.moveAll(movable, today, "Today").then(() => setConfirming(false))
                    }
                  >
                    {moving ? "Moving…" : "Move"}
                  </Button>
                  <Button
                    size="small"
                    variant="transparent"
                    disabled={moving}
                    onClick={() => setConfirming(false)}
                  >
                    Keep
                  </Button>
                </>
              ) : (
                <Button size="small" variant="transparent" onClick={() => setConfirming(true)}>
                  Move all to today
                </Button>
              )}
            </div>
          ) : null}
        </CollapsibleContent>
      </CollapsibleRoot>
    </section>
  );
}

const MATCH_LABEL: Record<string, string> = { overdue: "Overdue", undated: "No date" };

export function MenuBarPanel() {
  const container = useFitPanelHeight<HTMLDivElement>("menubar");
  const settings = useSettings().data;
  const now = useAgendaClock();
  const today = toISODate(now);
  const calendar = useCalendarRange(today, 7);
  const [view, setView] = useState<MenuBarView>("day");
  const [page, setPage] = useState<MenuBarPage | null>(null);
  const [picked, setPicked] = useState(today);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [prefs, setPrefs] = usePanelPrefs();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const tasks = useTasks();
  const reminders = useReminders();
  const mail = useMail();
  const planning = useAgendaState();
  const records = useRecentCaptures();
  const accounts = useAccounts().data;
  const toggle = useToggleTodo();
  const writes = usePanelWrites();
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

  const on = {
    tasks: sourceOn(settings, "tasks") && prefs.tasks,
    reminders: sourceOn(settings, "reminders") && prefs.reminders,
    calendar: sourceOn(settings, "calendar") && prefs.calendar,
  };
  const todos = mergeLinkedTodos(
    buildTodos(tasks.data, reminders.data),
    planning.data?.duplicateLinks,
    on,
  );
  const ask = usePanelAsk(
    () => ({
      todos,
      todosAvailable: tasks.data?.state === "ok" || reminders.data?.state === "ok",
      calendar: calendar.data,
      mail: mail.data,
      triage: featureOn(settings, "triage") ? readTriageMap() : {},
      userEmail: accounts?.google.email ?? null,
      // One-shot asks use the default provider, like every useAITask feature.
      googleData: mayShareGoogleData(settings?.ai.provider),
    }),
    settings?.ai.provider,
  );

  useEffect(
    () =>
      window.dayboard.ipc.onNotification("accounts:changed", () => {
        accountRevision.current += 1;
        latestText.current = "";
        setText("");
        setError(null);
        setOpenKey(null);
        setPage(null);
      }),
    [],
  );

  usePanelShown(() => {
    setError(null);
    void refetchLicense();
  });
  const closePage = () => {
    if (page === "ask") ask.reset();
    setPage(null);
  };
  // Esc steps back one layer at a time; with nothing open it closes the panel.
  usePanelEscape("menubar", () => {
    if (openKey) setOpenKey(null);
    else if (page) closePage();
    else if (text) setText("");
    else return false;
    return true;
  });

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
  const strip = weekStrip(agenda, now);
  // A day picked before midnight may have left the strip since.
  const selected = agenda.days.some((day) => day.date === picked) ? picked : today;
  const line = dayLine(
    agenda.days.find((day) => day.date === selected),
    now,
    prefs.completed ? todos : [],
  );
  const overdue = overdueLine(agenda, now);
  const query = text.trim();
  const matches =
    !page && query.length >= SEARCH_FROM
      ? matchGroups(
          buildAgenda({
            events,
            todos,
            startDate: today,
            days: 7,
            now,
            search: query,
            sources: on,
          }),
          now,
        )
      : [];

  // The AI-only box would only fail while the license locks AI; the manual form stays free.
  const ai = panelAiCapture(settings, license?.status);
  const canAsk = ai.available && featureOn(settings, "assistant");
  const shown = records.filter((record) => record.state !== "processing").slice(0, 3);
  const kinds =
    settings && accounts
      ? availableKinds({
          googleConnected: accounts.google.connected,
          remindersAccess: accounts.reminders,
          calendarAccess: accounts.calendar,
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
  const groups = taskGroups(todos, now);
  const openCount = groups.reduce((count, group) => count + group.rows.length, 0);

  // Re-reads every source the panel shows; the backend's own caches answer for what it fetched.
  function sync() {
    for (const queryKey of [
      queryKeys.tasks,
      queryKeys.reminders,
      queryKeys.calendar,
      queryKeys.mail,
      queryKeys.agenda,
      queryKeys.itemLists("tasks"),
      queryKeys.itemLists("reminders"),
    ])
      void queryClient.invalidateQueries({ queryKey });
  }
  const quit = () => void invoke("panel:quit");
  const quickCaptureKeys = settings?.system.quickCapture.enabled
    ? formatAccelerator(settings.system.quickCapture.hotkey)
    : null;
  const show = (next: MenuBarView) => {
    setView(next);
    setPage(null);
    setOpenKey(null);
  };

  function startAsk() {
    if (!canAsk || !query) return;
    setText("");
    setOpenKey(null);
    setPage("ask");
    ask.ask(query);
  }

  // The panel holds key focus without activating DayBoard, so the app menu's key equivalents
  // never reach it; its shortcuts are handled here instead.
  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.defaultPrevented || event.isComposing) return;
    const key = event.key.toLowerCase();
    const views: Record<string, MenuBarView> = { "1": "day", "2": "lists", "3": "month" };
    const action =
      key === "r"
        ? sync
        : key === ","
          ? () => setPage(page === "settings" ? null : "settings")
          : key === "q"
            ? quit
            : views[key]
              ? () => show(views[key])
              : null;
    if (!action) return;
    event.preventDefault();
    action();
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const addPlaceholder = !destination
    ? "Connect a list to add here…"
    : destination.target
      ? `Add to “${destination.title}”…`
      : canAsk
        ? "Add, ask or search…"
        : "Add or search…";

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

  const dayTitle = parseISODate(selected).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const eventCount = line.rows.filter((row) => row.kind === "event").length;
  const todoCount = line.rows.length - eventCount;
  const summary =
    view === "lists"
      ? `${openCount} open${overdue.todos.length ? ` · ${overdue.todos.length} overdue` : ""}`
      : [
          eventCount ? `${eventCount} ${eventCount === 1 ? "event" : "events"}` : null,
          todoCount ? `${todoCount} to do` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Nothing scheduled";

  return (
    <RowsProvider value={{ now, openKey, setOpenKey, writes, toggle: toggle.mutate }}>
      <div ref={container} className="flex max-h-[620px] flex-col gap-2.5 p-3">
        <header className="flex shrink-0 items-center gap-1">
          <SegmentedControl
            size="small"
            aria-label="View"
            value={page ? "" : view}
            onValueChange={(next: string) => show(next as MenuBarView)}
          >
            {VIEWS.map(({ id, label }) => (
              <SegmentedControlItem key={id} value={id}>
                {label}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <span className="flex-1" />
          <Button
            size="small"
            variant="transparent"
            iconOnly
            aria-label="Sync"
            title="Sync (⌘R)"
            onClick={sync}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
          <Button
            size="small"
            variant="transparent"
            iconOnly
            aria-label="Panel settings"
            title="Panel settings (⌘,)"
            aria-pressed={page === "settings"}
            className={page === "settings" ? "text-accent" : undefined}
            onClick={() => setPage(page === "settings" ? null : "settings")}
          >
            <Settings aria-hidden="true" />
          </Button>
        </header>

        {!page && view !== "month" && !matches.length ? (
          <div className="flex shrink-0 items-baseline justify-between gap-2 px-1">
            <Text as="h1" variant="large-strong" truncate>
              {view === "lists" ? "Lists" : dayTitle}
            </Text>
            <Text as="p" variant="small" color="secondary" className="shrink-0 tabular-nums">
              {summary}
            </Text>
          </div>
        ) : null}
        {!page && view === "day" && !matches.length ? (
          <WeekStrip
            days={strip}
            selected={selected}
            onSelect={(date) => {
              setPicked(date);
              setOpenKey(null);
            }}
          />
        ) : null}

        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
          aria-label="Agenda feed"
        >
          {page === "settings" ? (
            <PanelSettings
              settings={settings}
              prefs={prefs}
              onPrefs={setPrefs}
              destinations={destinations}
              destination={destination}
              onDestination={chooseDestination}
              quickCaptureKeys={quickCaptureKeys}
              onSync={sync}
              onQuit={quit}
              onClose={closePage}
            />
          ) : page === "ask" ? (
            <PanelAsk state={ask} onClose={closePage} />
          ) : page === "catch-up" ? (
            <CatchUp
              todos={overdue.todos}
              now={now}
              writes={writes}
              toggle={toggle.mutate}
              onExit={closePage}
            />
          ) : (
            <>
              {scheduleLoading ? (
                <Text as="p" variant="small" color="secondary" role="status" className="px-2">
                  Loading schedule…
                </Text>
              ) : null}
              {schedulePartial ? (
                <Text as="p" variant="small" color="secondary" role="status" className="px-2">
                  Some sources are unavailable. Check accounts from Panel settings.
                </Text>
              ) : null}
              {matches.length ? (
                <section aria-label="Matches" className="flex flex-col gap-2">
                  {matches.map((group) => (
                    <section key={group.id} className="flex flex-col">
                      <SectionHeading
                        label={MATCH_LABEL[group.id] ?? dayHeading(group.id)}
                        count={group.rows.length}
                      />
                      <ul className="flex flex-col">
                        {group.rows.map((row) =>
                          row.kind === "event" ? (
                            <EventItem key={row.key} row={row} />
                          ) : (
                            <TodoItem key={row.key} todo={row.todo} due />
                          ),
                        )}
                      </ul>
                    </section>
                  ))}
                </section>
              ) : view === "lists" ? (
                groups.length ? (
                  <MenuBarTasks
                    groups={groups}
                    canAddTo={(key) => destinations.some((option) => option.key === key)}
                    onAddTo={(key) => {
                      chooseDestination(key);
                      inputRef.current?.focus();
                    }}
                  />
                ) : (
                  <Text as="p" variant="small" color="secondary" className="px-2">
                    {scheduleLoading ? "" : "No open tasks in available lists."}
                  </Text>
                )
              ) : view === "month" ? (
                <MonthView
                  todos={todos}
                  sources={on}
                  now={now}
                  completed={prefs.completed ? todos : []}
                />
              ) : (
                <>
                  {selected === today ? (
                    <>
                      {on.calendar ? <MeetingCard surface="menubar" /> : null}
                      {sourceOn(settings, "mail") && prefs.mail ? <WaitingOnYou now={now} /> : null}
                      {overdue.todos.length ? (
                        <OverdueCard
                          todos={overdue.todos}
                          oldest={overdue.oldest}
                          today={today}
                          writes={writes}
                          onCatchUp={() => {
                            setOpenKey(null);
                            setPage("catch-up");
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <section
                    aria-label={selected === today ? "Today's items" : dayHeading(selected)}
                    className="flex flex-col"
                  >
                    <DayRows
                      line={line}
                      empty={
                        scheduleLoading
                          ? ""
                          : selected === today
                            ? "Nothing else today in available sources."
                            : "Nothing on this day in available sources."
                      }
                    />
                  </section>
                </>
              )}

              {shown.length ? (
                <section aria-label="Recent captures" className="flex flex-col gap-1 px-2">
                  <Text as="h2" variant="small-strong" color="secondary">
                    Recently added
                  </Text>
                  {shown.map((record) => (
                    <div key={record.id} className="flex items-center gap-2">
                      <Text as="span" variant="small" truncate className="flex-1">
                        {record.state === "undone" ? `Undone: ${record.text}` : record.text}
                        {record.error ? ` · ${record.error}` : ""}
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
            </>
          )}
        </div>

        {error ? <Callout color="red">{error}</Callout> : null}
        <div className="flex shrink-0 flex-col gap-1">
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-xl bg-control-subtle pl-2.5 focus-within:outline-2 focus-within:outline-accent">
              <Plus className="size-4 shrink-0 text-tertiary" aria-hidden="true" />
              <Input
                ref={inputRef}
                aria-label={canAsk ? "Add, ask or search" : "Add or search"}
                className="flex-1 border-0 bg-transparent focus-visible:outline-none"
                placeholder={addPlaceholder}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  if (event.metaKey) startAsk();
                  else capture();
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
                <DropdownMenuContent side="top" align="end" className="max-h-80 overflow-y-auto">
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
            {ai.lock ? (
              <Button
                variant="transparent"
                title="Opens the Settings window"
                onClick={() => void openSettings("license")}
              >
                Unlock AI
              </Button>
            ) : null}
          </div>
          {query ? (
            <Text
              as="p"
              variant="small"
              color="tertiary"
              className="flex items-center gap-1 px-1"
              role="status"
            >
              <CornerDownLeft className="size-3" aria-hidden="true" />
              {destination
                ? destination.target
                  ? `Add to “${destination.title}”`
                  : "Add"
                : "Connect a list to add"}
              {canAsk ? " · ⌘↩ Ask" : ""}
              {matches.length ? " · matches above" : ""}
            </Text>
          ) : null}
        </div>
      </div>
    </RowsProvider>
  );
}
