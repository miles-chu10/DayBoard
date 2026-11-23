import { ExternalLink, Trash2, Video } from "lucide-react";
import { createContext, useContext, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, Checkbox, Input, Text, Textarea, cn } from "@renderer/ui";
import type { CalendarEventItem } from "@main/shared-types";

import { extractJoinUrl } from "@shared/meetings";
import { SourceDot } from "../components/source-dot";
import { formatTimeOfDay, relativeDue } from "../lib/dates";
import { openExternal } from "../lib/ipc";
import { SOURCE_META } from "../lib/sources";
import type { Todo } from "../lib/todos";
import type { DayLine, DayRow } from "./day-line";
import {
  eventDraft,
  eventFields,
  eventFieldsChanged,
  eventMovedBy,
  type EventFields,
} from "./event-edit";
import type { PanelWrites } from "./panel-writes";
import {
  RECURRING_NOTE,
  canEditTodo,
  draftChanged,
  moveChoices,
  todoDraft,
  type TodoDraft,
} from "./todo-edit";

interface RowsContextValue {
  now: Date;
  /** The one row open for editing, if any. */
  openKey: string | null;
  setOpenKey: (key: string | null) => void;
  writes: PanelWrites;
  toggle: (todo: Todo) => void;
}

const RowsContext = createContext<RowsContextValue | null>(null);

export function RowsProvider({
  value,
  children,
}: {
  value: RowsContextValue;
  children: ReactNode;
}) {
  return <RowsContext.Provider value={value}>{children}</RowsContext.Provider>;
}

function useRows(): RowsContextValue {
  const value = useContext(RowsContext);
  if (!value) throw new Error("Panel rows need a RowsProvider.");
  return value;
}

const ROW = "flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-list-hover";
const ROW_BUTTON =
  "min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent";
const TIME = "w-[52px] shrink-0 pt-px text-right tabular-nums";

/** Brings an editor that opened below the fold into view. */
function reveal(node: HTMLElement | null) {
  node?.scrollIntoView({ block: "nearest" });
}

/** ⌘↩ saves from any field; ↩ saves from a single-line one. */
function saveKey(event: KeyboardEvent, save: () => void) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  if (!event.metaKey && event.target instanceof HTMLTextAreaElement) return;
  event.preventDefault();
  save();
}

export function MoveChips({ todo, onMoved }: { todo: Todo; onMoved?: () => void }) {
  const { now, writes } = useRows();
  return (
    <div role="group" aria-label="Move to" className="flex flex-wrap gap-1">
      {moveChoices(now, todo.dueDate).map((choice) => (
        <Button
          key={choice.id}
          size="small"
          variant="muted"
          disabled={writes.busy === todo.key}
          onClick={() =>
            void writes.moveTodo(todo, choice.date, choice.label).then((moved) => {
              if (moved) onMoved?.();
            })
          }
        >
          {choice.label}
        </Button>
      ))}
    </div>
  );
}

/** Delete asks once more in place, so nothing leaves on a stray click. */
export function DeleteButton({ todo, onDeleted }: { todo: Todo; onDeleted?: () => void }) {
  const { writes } = useRows();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button
        size="small"
        variant="transparent"
        iconOnly
        aria-label={`Delete “${todo.title}”`}
        title="Delete"
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button
        size="small"
        variant="destructive"
        disabled={writes.busy === todo.key}
        onClick={() =>
          void writes.deleteTodo(todo).then((deleted) => {
            if (deleted) onDeleted?.();
            else setConfirming(false);
          })
        }
      >
        Delete
      </Button>
      <Button size="small" variant="transparent" onClick={() => setConfirming(false)}>
        Keep
      </Button>
    </span>
  );
}

function TodoEditor({ todo, onClose }: { todo: Todo; onClose: () => void }) {
  const { writes } = useRows();
  const [draft, setDraft] = useState<TodoDraft>(() => todoDraft(todo));
  const set = (patch: Partial<TodoDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const busy = writes.busy === todo.key;
  const source = `${SOURCE_META[todo.source].label} · ${todo.listTitle}`;

  if (!canEditTodo(todo)) {
    return (
      <div className="mt-1 mb-2 flex flex-col gap-1 rounded-xl bg-well p-2.5">
        <Text as="p" variant="small" color="secondary">
          {RECURRING_NOTE}
        </Text>
        <Text as="p" variant="small" color="tertiary">
          {source}
        </Text>
      </div>
    );
  }
  const canSave = Boolean(draft.title.trim()) && draftChanged(todo, draft) && !busy;
  const save = () => {
    if (!canSave) return;
    void writes.saveTodo(todo, draft).then((saved) => {
      if (saved) onClose();
    });
  };
  return (
    <div
      ref={reveal}
      role="group"
      aria-label={`Edit “${todo.title}”`}
      className="mt-1 mb-2 flex flex-col gap-2 rounded-xl bg-well p-2.5"
      onKeyDown={(event) => saveKey(event, save)}
    >
      <Input
        autoFocus
        size="small"
        aria-label="Title"
        value={draft.title}
        onChange={(event) => set({ title: event.target.value })}
      />
      <Textarea
        size="small"
        aria-label="Notes"
        placeholder="Notes"
        className="text-small"
        value={draft.notes}
        onChange={(event) => set({ notes: event.target.value })}
      />
      <div className="flex gap-2">
        <Input
          size="small"
          type="date"
          aria-label="Due date"
          value={draft.dueDate}
          onChange={(event) => set({ dueDate: event.target.value })}
        />
        {todo.source === "reminders" ? (
          <Input
            size="small"
            type="time"
            aria-label="Due time"
            disabled={!draft.dueDate}
            value={draft.dueDate ? draft.dueTime : ""}
            onChange={(event) => set({ dueTime: event.target.value })}
          />
        ) : null}
      </div>
      <MoveChips todo={todo} onMoved={onClose} />
      <div className="flex items-center gap-1">
        <Text as="span" variant="small" color="tertiary" truncate className="min-w-0 flex-1">
          {source}
        </Text>
        <DeleteButton todo={todo} onDeleted={onClose} />
        <Button size="small" variant="transparent" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="accent" disabled={!canSave} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * A to-do that does everything where it sits: the circle checks it off, the title opens it to
 * edit, move or delete. `time` reserves the timeline's time column; `due` shows its age instead.
 */
export function TodoItem({
  todo,
  time,
  late,
  due,
  plain,
}: {
  todo: Todo;
  /** The timeline's time column: a due time, or null for an anytime to-do. Omit off the timeline. */
  time?: string | null;
  late?: boolean;
  /** Show the due date relative to now on the right (overdue list, lists, search). */
  due?: boolean;
  /** Leave out the list name, under a heading that already gives it. */
  plain?: boolean;
}) {
  const { now, openKey, setOpenKey, toggle } = useRows();
  const open = openKey === todo.key;
  const dueLabel = due && todo.dueDate ? relativeDue(todo.dueDate, todo.dueTime, now) : null;
  return (
    <li className="relative">
      <div className={ROW}>
        {time !== undefined ? (
          <Text as="span" variant="small" color={late ? "red" : "secondary"} className={TIME}>
            {time ?? ""}
          </Text>
        ) : null}
        <Checkbox
          className="mt-px rounded-full"
          checked={todo.completed}
          onCheckedChange={() => toggle(todo)}
          aria-label={todo.completed ? `Mark “${todo.title}” not done` : `Complete “${todo.title}”`}
        />
        <button
          type="button"
          className={ROW_BUTTON}
          aria-expanded={open}
          onClick={() => setOpenKey(open ? null : todo.key)}
        >
          <Text
            as="span"
            variant="regular"
            color={todo.completed ? "tertiary" : undefined}
            className={cn("block", todo.completed && "line-through", !open && "truncate")}
            title={todo.title}
          >
            {todo.title}
          </Text>
          {plain ? null : (
            <span className="flex items-center gap-1.5">
              <SourceDot source={todo.source} className="size-1.5" />
              <Text as="span" variant="small" color="tertiary" truncate>
                {todo.listTitle}
                {todo.linked?.length ? ` · ${todo.linked.length + 1} linked` : ""}
              </Text>
            </span>
          )}
        </button>
        {dueLabel ? (
          <Text
            as="span"
            variant="small"
            color={dueLabel.tone === "overdue" ? "red" : "secondary"}
            className="shrink-0 pt-px tabular-nums"
          >
            {dueLabel.label}
          </Text>
        ) : null}
      </div>
      {open ? <TodoEditor todo={todo} onClose={() => setOpenKey(null)} /> : null}
    </li>
  );
}

function EventEditor({ event, onClose }: { event: CalendarEventItem; onClose: () => void }) {
  const { writes } = useRows();
  const [fields, setFields] = useState<EventFields>(() => eventFields(event));
  const set = (patch: Partial<EventFields>) => setFields((current) => ({ ...current, ...patch }));
  const busy = writes.busy === `${event.calendarId}/${event.id}`;
  const readOnly = Boolean(event.readOnly);
  const draft = eventDraft(event, fields);
  const canSave = Boolean(draft) && eventFieldsChanged(event, fields) && !busy && !readOnly;
  const joinUrl = extractJoinUrl(event);
  const tomorrow = readOnly ? null : eventMovedBy(event, 1);
  const done = (saved: boolean) => {
    if (saved) onClose();
  };
  const save = () => {
    if (draft && canSave) void writes.saveEvent(event, draft).then(done);
  };
  const guests = event.attendees.length;
  return (
    <div
      ref={reveal}
      role="group"
      aria-label={`Edit “${event.title}”`}
      className="mt-1 mb-2 flex flex-col gap-2 rounded-xl bg-well p-2.5"
      onKeyDown={(keyEvent) => saveKey(keyEvent, save)}
    >
      <Input
        autoFocus
        size="small"
        aria-label="Title"
        disabled={readOnly}
        value={fields.title}
        onChange={(change) => set({ title: change.target.value })}
      />
      {(["start", "end"] as const).map((field) => (
        <label key={field} className="flex items-center gap-2">
          <Text as="span" variant="small" color="secondary" className="w-10 shrink-0">
            {field === "start" ? "Starts" : "Ends"}
          </Text>
          <Input
            size="small"
            type={fields.allDay ? "date" : "datetime-local"}
            disabled={readOnly}
            aria-invalid={field === "end" && !draft && Boolean(fields.title.trim())}
            value={fields[field]}
            onChange={(change) => set({ [field]: change.target.value })}
          />
        </label>
      ))}
      <Input
        size="small"
        aria-label="Location"
        placeholder="Location"
        disabled={readOnly}
        value={fields.location}
        onChange={(change) => set({ location: change.target.value })}
      />
      <div className="flex flex-wrap gap-1">
        {joinUrl ? (
          <Button size="small" variant="accent" onClick={() => void openExternal(joinUrl)}>
            <Video aria-hidden="true" />
            Join
          </Button>
        ) : null}
        {tomorrow ? (
          <Button
            size="small"
            variant="muted"
            disabled={busy}
            onClick={() => void writes.saveEvent(event, tomorrow).then(done)}
          >
            Move to tomorrow
          </Button>
        ) : null}
        {event.htmlLink ? (
          <Button
            size="small"
            variant="muted"
            title="Opens Google Calendar in your browser"
            onClick={() => void openExternal(event.htmlLink!)}
          >
            <ExternalLink aria-hidden="true" />
            Google Calendar
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <Text as="span" variant="small" color="tertiary" truncate className="min-w-0 flex-1">
          {event.calendarName}
          {readOnly ? " · Read-only" : ""}
          {guests ? ` · ${guests} ${guests === 1 ? "guest" : "guests"}` : ""}
        </Text>
        <Button size="small" variant="transparent" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="accent" disabled={!canSave} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function EventItem({ row }: { row: Extract<DayRow, { kind: "event" }> }) {
  const { openKey, setOpenKey } = useRows();
  const { event } = row;
  const open = openKey === row.key;
  const detail = [row.end ? `Until ${row.end}` : null, event.location].filter(Boolean).join(" · ");
  return (
    <li className="relative">
      <div className={ROW}>
        <Text
          as="span"
          variant="small"
          color={row.live ? "accent" : row.past ? "tertiary" : "secondary"}
          className={TIME}
        >
          {row.live ? "Now" : row.time}
        </Text>
        <span className="flex w-4 shrink-0 justify-center pt-1">
          <SourceDot
            source="calendar"
            className={cn("size-2.5 ring-2 ring-background", row.past && "opacity-50")}
          />
        </span>
        <button
          type="button"
          className={ROW_BUTTON}
          aria-expanded={open}
          onClick={() => setOpenKey(open ? null : row.key)}
        >
          <Text
            as="span"
            variant="regular"
            color={row.past ? "tertiary" : undefined}
            data-past={row.past ? "" : undefined}
            className={cn("block", !open && "truncate")}
            title={event.title}
          >
            {event.title}
          </Text>
          {detail ? (
            <Text as="span" variant="small" color="tertiary" className="block truncate">
              {detail}
            </Text>
          ) : null}
        </button>
      </div>
      {open ? <EventEditor event={event} onClose={() => setOpenKey(null)} /> : null}
    </li>
  );
}

function NowMarker({ now }: { now: Date }) {
  return (
    <li aria-label="Now" className="flex items-center gap-2 px-2 py-0.5">
      <Text as="span" variant="small" color="accent" className={cn(TIME, "pt-0 font-medium")}>
        {formatTimeOfDay(now.toISOString())}
      </Text>
      <span className="flex w-4 shrink-0 justify-center">
        <span className="size-2 rounded-full bg-accent ring-2 ring-background" />
      </span>
      <span className="h-px flex-1 bg-accent/70" />
    </li>
  );
}

/**
 * One day as a line of time: a rail down the left, events and to-dos on it in order, and a marker
 * for now. Every item of the day is here; the panel scrolls.
 */
export function DayRows({ line, empty }: { line: DayLine; empty: string }) {
  const { now } = useRows();
  if (!line.rows.length && !line.done.length) {
    return (
      <Text as="p" variant="small" color="secondary" className="px-2 py-1">
        {empty}
      </Text>
    );
  }
  return (
    <ol className="relative flex flex-col before:absolute before:top-3 before:bottom-3 before:left-[75.5px] before:w-px before:bg-separator">
      {line.rows.map((row, index) => (
        <RowWithMarker key={row.key} marker={line.nowIndex === index} now={now}>
          {row.kind === "event" ? (
            <EventItem row={row} />
          ) : (
            <TodoItem todo={row.todo} time={row.time} late={row.late} />
          )}
        </RowWithMarker>
      ))}
      {line.nowIndex === line.rows.length ? <NowMarker now={now} /> : null}
      {line.done.map((todo) => (
        <TodoItem key={todo.key} todo={todo} time={null} />
      ))}
    </ol>
  );
}

function RowWithMarker({
  marker,
  now,
  children,
}: {
  marker: boolean;
  now: Date;
  children: ReactNode;
}) {
  return (
    <>
      {marker ? <NowMarker now={now} /> : null}
      {children}
    </>
  );
}
