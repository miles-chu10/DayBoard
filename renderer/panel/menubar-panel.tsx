import { CalendarDays, ListTodo, Settings, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Callout, Input, Text } from "@renderer/ui";

import { MeetingCard } from "../components/meeting-card";
import { OverdueSummary } from "../components/overdue-summary";
import { SourceDot } from "../components/source-dot";
import { buildAgenda } from "../lib/agenda";
import { identifyCalendarEvents } from "../lib/calendar-identity";
import { dayHeading, longToday, todayISO } from "../lib/dates";
import { ageLabel, isStale, needsYou } from "../lib/home";
import { errorMessage, invoke, openSettings } from "../lib/ipc";
import { useLicenseSnapshot } from "../lib/license";
import { dueFollowUps, useMailSchedule } from "../lib/mail-schedule";
import { useAgendaState, useCalendarRange, useMail, useReminders, useTasks } from "../lib/queries";
import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { buildTodos, mergeLinkedTodos } from "../lib/todos";
import { readStored, writeStored } from "../lib/storage";
import { readTriageMap } from "../lib/triage";
import { useAgendaClock } from "../lib/use-agenda-clock";
import { panelAiCapture, type CaptureRecordView } from "./capture-panel-state";
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
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

function ItemRow({ item, wideTime = false }: { item: TodayItem; wideTime?: boolean }) {
  return (
    <button
      type="button"
      className={`flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${item.kind === "event" ? "bg-control-subtle" : ""}`}
      onClick={() => void openMain(item.kind === "event" ? "/calendar" : "/agenda")}
    >
      <SourceDot
        source={item.source}
        className={`${item.kind === "event" ? "h-6 w-0.5 rounded-full" : ""} ${item.past ? "opacity-50" : ""}`}
      />
      <Text
        as="span"
        variant="small"
        color={item.past ? "tertiary" : "secondary"}
        className={`${wideTime ? "w-20" : "w-16"} shrink-0 tabular-nums`}
        truncate
      >
        {item.time ?? "Anytime"}
      </Text>
      <Text
        as="span"
        variant="regular"
        color={item.past ? "tertiary" : undefined}
        truncate
        title={item.title}
        data-past={item.past ? "" : undefined}
      >
        {item.title}
      </Text>
    </button>
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
      <Text as="h2" variant="small" color="secondary" className="px-1.5 pb-0.5">
        Waiting on you · {waiting.length}
      </Text>
      {waiting.slice(0, 3).map((item) => (
        <button
          key={item.key}
          type="button"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
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

  function capture() {
    const started = accountRevision.current;
    const value = text.trim();
    if (!value) return;
    setText("");
    setError(null);
    void invoke("capture:submit", { text: value }).catch((reason: unknown) => {
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
      {ai.available ? (
        <div className="flex shrink-0 gap-2">
          <Input
            aria-label="Add or ask"
            className="flex-1"
            placeholder="Add or ask…"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                capture();
              }
            }}
          />
          {canAsk ? (
            <Button
              disabled={!text.trim()}
              onClick={() => void openMain("/assistant", text.trim())}
            >
              Ask
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex shrink-0 gap-2">
          <Button
            className="flex-1"
            onClick={() => {
              void hidePanel("menubar");
              void showPanel("capture");
            }}
          >
            Add an item…
          </Button>
          {ai.lock ? (
            <Button variant="transparent" onClick={() => void openSettings("license")}>
              Unlock AI
            </Button>
          ) : null}
        </div>
      )}

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

            {overdueCount ? (
              <section aria-label="Overdue items" className="flex flex-col">
                <OverdueSummary
                  count={overdueCount}
                  open={overdueOpen}
                  onOpenChange={setOverdueOpen}
                >
                  <div className="flex flex-col">
                    {overdue.map((item) => (
                      <ItemRow key={item.key} item={item} wideTime />
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
                </OverdueSummary>
              </section>
            ) : null}

            <section aria-label="Today's items" className="flex flex-col gap-1">
              <Text as="h2" variant="small" color="secondary">
                Today · {items.length + hiddenCount}
              </Text>
              {items.length ? (
                items.map((item) => <ItemRow key={item.key} item={item} />)
              ) : (
                <Text as="p" variant="small" color="secondary">
                  {scheduleLoading ? "" : "Nothing else today in available sources."}
                </Text>
              )}
            </section>

            {hiddenCount ? (
              <Button size="small" variant="transparent" onClick={() => void openMain("/agenda")}>
                {hiddenCount} more in DayBoard
              </Button>
            ) : null}
          </>
        ) : (
          <section aria-label="Upcoming items" className="flex flex-col gap-4">
            <Text as="p" variant="small" color="secondary">
              The next six days
            </Text>
            {upcoming.length ? (
              upcoming.map((day) => (
                <section
                  key={day.date}
                  aria-label={dayHeading(day.date)}
                  className="flex flex-col gap-1"
                >
                  <Text as="h2" variant="small" color="secondary" className="px-2">
                    {dayHeading(day.date)} · {day.items.length + day.hiddenCount}
                  </Text>
                  {day.items.map((item) => (
                    <ItemRow key={item.key} item={item} />
                  ))}
                  {day.hiddenCount ? (
                    <Button
                      size="small"
                      variant="transparent"
                      onClick={() => void openMain("/agenda")}
                    >
                      {day.hiddenCount} more in DayBoard
                    </Button>
                  ) : null}
                </section>
              ))
            ) : (
              <Text as="p" variant="small" color="secondary">
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
        className="flex shrink-0 items-center gap-1 border-t border-separator pt-2"
      >
        <Button
          size="small"
          variant={view === "today" ? "muted" : "transparent"}
          aria-pressed={view === "today"}
          onClick={() => setView("today")}
        >
          <Sun aria-hidden="true" />
          Today
        </Button>
        <Button
          size="small"
          variant={view === "upcoming" ? "muted" : "transparent"}
          aria-pressed={view === "upcoming"}
          onClick={() => setView("upcoming")}
        >
          <CalendarDays aria-hidden="true" />
          Upcoming
        </Button>
        <div className="flex-1" />
        <Button
          size="small"
          variant="transparent"
          iconOnly
          aria-label="Open agenda"
          onClick={() => void openMain("/agenda")}
        >
          <ListTodo aria-hidden="true" />
        </Button>
        <Button
          size="small"
          variant="transparent"
          iconOnly
          aria-label="Open settings"
          onClick={() => void openSettings()}
        >
          <Settings aria-hidden="true" />
        </Button>
      </nav>
    </div>
  );
}
