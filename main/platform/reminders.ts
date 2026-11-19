// Apple Reminders via the bundled Swift EventKit helper (native/reminders-helper), matching the
// `reminders` surface documented in main/platform/README.md. Re-implemented from the operations
// main/services/apple-reminders.ts uses; no Glaze SDK source was copied.

import { app } from "electron";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

import {
  decodeResponse,
  encodeRequest,
  LineBuffer,
  type HelperResponse,
} from "./reminders-codec.js";

export type RemindersAuthorizationStatus =
  | "not-determined"
  | "denied"
  | "restricted"
  | "full-access"
  | "unknown";

export interface ReminderRef {
  value: string;
}

export type EventTime =
  | { kind: "date"; date: string }
  | { kind: "date-time"; dateTime: string; timeZone: string | null };

export interface RecurrenceRule {
  calendarIdentifier: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  firstDayOfWeek: number | null;
  daysOfTheWeek: unknown[];
  daysOfTheMonth: number[];
  daysOfTheYear: number[];
  weeksOfTheYear: number[];
  monthsOfTheYear: number[];
  setPositions: number[];
  end: unknown | null;
}

export interface CalendarInfo {
  id: string;
  title: string;
  color: string | null;
  type: "local" | "caldav" | "exchange" | "subscription" | "birthday" | "unknown";
  source: string | null;
  sourceId: string;
  entityTypes: Array<"event" | "reminder">;
  supportedAvailabilities: string[];
  allowsContentModifications: boolean;
  isSubscribed: boolean;
  isImmutable: boolean;
}

export interface Reminder {
  ref: ReminderRef;
  externalId: string | null;
  calendarId: string;
  title: string;
  location: string | null;
  notes: string | null;
  url: string | null;
  creationDate: string | null;
  lastModifiedDate: string | null;
  start: EventTime | null;
  due: EventTime | null;
  isCompleted: boolean;
  completionDate: string | null;
  priority: number;
  alarms: unknown[];
  recurrenceRules: RecurrenceRule[];
}

export interface GetRemindersOptions {
  completed?: boolean;
  limit?: number;
}

export interface GetRemindersResult {
  reminders: Reminder[];
  truncated: boolean;
}

export interface CreateReminderInput {
  title: string;
  calendarId?: string;
  notes?: string;
  due?: EventTime;
}

export type ClearableReminderField =
  | "notes"
  | "url"
  | "location"
  | "start"
  | "due"
  | "completionDate";

export interface UpdateReminderPatch {
  title?: string;
  calendarId?: string;
  notes?: string;
  priority?: number;
  isCompleted?: boolean;
  due?: EventTime;
  clearFields?: ClearableReminderField[];
}

/** Locates one Mac Calendar event, or one occurrence of a recurring event. */
export interface CalendarEventRef {
  id: string;
  /** The occurrence's original start as an instant; stays fixed when the occurrence is moved. */
  occurrenceDate: string | null;
  /** The current start instant, a search hint for a moved occurrence. */
  start?: string | null;
}

export interface NativeCalendarEvent {
  id: string;
  occurrenceDate: string | null;
  startInstant: string | null;
  externalId: string | null;
  calendarId: string;
  title: string;
  /** YYYY-MM-DD for all-day events, otherwise an RFC 3339 instant with the Mac's offset. */
  start: string;
  /** Exclusive YYYY-MM-DD for all-day events, otherwise an RFC 3339 instant. */
  end: string;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  url: string | null;
  recurring: boolean;
  attendees: string[];
  hasAttendees: boolean;
  organizerIsSelf: boolean;
  selfStatus: "accepted" | "declined" | "tentative" | "needsAction" | null;
}

export interface GetEventsOptions {
  /** RFC 3339 instants. */
  start: string;
  end: string;
  /** Only these calendars; an empty list returns no events. Omit for every calendar. */
  calendarIds?: string[];
  limit?: number;
}

export interface GetEventsResult {
  events: NativeCalendarEvent[];
  truncated: boolean;
}

/** All-day: YYYY-MM-DD dates, end exclusive. Timed: RFC 3339 instants or wall-clock times in a zone. */
export type CalendarEventTimes =
  | { allDay: true; start: string; end: string }
  | {
      allDay: false;
      start: string | EventTime;
      end: string | EventTime;
      timeZone?: string;
    };

export interface CalendarEventPatch {
  title?: string;
  /** Empty clears. */
  notes?: string;
  /** Empty clears. */
  location?: string;
  calendarId?: string;
  times?: CalendarEventTimes;
}

export interface CreateCalendarEventInput extends CalendarEventPatch {
  title: string;
  times: CalendarEventTimes;
}

const REQUEST_TIMEOUT_MS = 15_000;
const PERMISSION_TIMEOUT_MS = 5 * 60_000;

interface Pending {
  id: string;
  op: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

function helperPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "bin", "reminders-helper");
  return path.join(app.getAppPath(), "resources", "bin", "reminders-helper");
}

class RemindersProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private active: Pending | null = null;
  private readonly queued: Pending[] = [];

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;

    const child = spawn(helperPath(), [], { stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    const buffer = new LineBuffer();

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (this.child !== child) return;
      for (const line of buffer.push(chunk)) this.handleLine(child, line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
      if (this.child !== child) return;
      // The helper reports failures per-request over stdout; stderr is unstructured diagnostics.
    });
    child.on("error", (error) => this.retire(child, error, true));
    child.on("exit", (code) => {
      this.retire(
        child,
        new Error(`Reminders helper exited unexpectedly (code ${code ?? "unknown"}).`),
        false,
      );
    });

    return child;
  }

  private handleLine(child: ChildProcessWithoutNullStreams, line: string): void {
    if (this.child !== child) return;
    let response: HelperResponse;
    try {
      response = decodeResponse(line);
    } catch {
      return;
    }
    const pending = this.active;
    if (!pending || response.id !== pending.id) return;
    this.active = null;
    if (pending.timer) clearTimeout(pending.timer);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(new Error(response.error));
    this.startNext();
  }

  private retire(child: ChildProcessWithoutNullStreams, error: Error, kill: boolean): void {
    if (this.child !== child) return;
    this.child = null;
    const pending = [...(this.active ? [this.active] : []), ...this.queued.splice(0)];
    this.active = null;
    for (const request of pending) {
      if (request.timer) clearTimeout(request.timer);
      request.reject(error);
    }
    if (kill) child.kill("SIGKILL");
  }

  private startNext(): void {
    if (this.active || this.queued.length === 0) return;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = this.ensureStarted();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const pending of this.queued.splice(0)) pending.reject(failure);
      return;
    }
    const pending = this.queued.shift()!;
    this.active = pending;
    pending.timer = setTimeout(
      () => {
        if (this.child !== child || this.active !== pending) return;
        this.retire(
          child,
          new Error(`Reminders helper timed out waiting for "${pending.op}".`),
          true,
        );
      },
      pending.op === "requestAccess" || pending.op === "requestEventAccess"
        ? PERMISSION_TIMEOUT_MS
        : REQUEST_TIMEOUT_MS,
    );
    try {
      child.stdin.write(
        encodeRequest({ id: pending.id, op: pending.op, params: pending.params }),
        (error) => {
          if (error && this.child === child && this.active === pending) {
            this.retire(child, error, true);
          }
        },
      );
    } catch (error) {
      this.retire(child, error instanceof Error ? error : new Error(String(error)), true);
    }
  }

  request<T>(op: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queued.push({
        id: randomUUID(),
        op,
        params,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.startNext();
    });
  }
}

const process_ = new RemindersProcess();

export const reminders = {
  status(): Promise<RemindersAuthorizationStatus> {
    return process_.request("status");
  },
  requestAccess(): Promise<RemindersAuthorizationStatus> {
    return process_.request("requestAccess");
  },
  getCalendars(): Promise<CalendarInfo[]> {
    return process_.request("getCalendars");
  },
  getReminders(options: GetRemindersOptions = {}): Promise<GetRemindersResult> {
    return process_.request("getReminders", { ...options });
  },
  getReminder(reference: ReminderRef): Promise<Reminder> {
    return process_.request("getReminder", { reference });
  },
  createReminder(input: CreateReminderInput): Promise<Reminder> {
    return process_.request("createReminder", { input });
  },
  updateReminder(reference: ReminderRef, patch: UpdateReminderPatch): Promise<Reminder> {
    return process_.request("updateReminder", { reference, patch });
  },
  deleteReminder(reference: ReminderRef): Promise<void> {
    return process_.request("deleteReminder", { reference });
  },
  // Mac Calendar events share the helper; macOS grants calendar access separately from Reminders.
  eventStatus(): Promise<RemindersAuthorizationStatus> {
    return process_.request("eventStatus");
  },
  requestEventAccess(): Promise<RemindersAuthorizationStatus> {
    return process_.request("requestEventAccess");
  },
  getEventCalendars(): Promise<CalendarInfo[]> {
    return process_.request("getEventCalendars");
  },
  getEvents(options: GetEventsOptions): Promise<GetEventsResult> {
    return process_.request("getEvents", { ...options });
  },
  getEvent(reference: CalendarEventRef): Promise<NativeCalendarEvent> {
    return process_.request("getEvent", { reference });
  },
  createEvent(input: CreateCalendarEventInput): Promise<NativeCalendarEvent> {
    return process_.request("createEvent", { input });
  },
  updateEvent(
    reference: CalendarEventRef,
    patch: CalendarEventPatch,
  ): Promise<NativeCalendarEvent> {
    return process_.request("updateEvent", { reference, patch });
  },
  deleteEvent(reference: CalendarEventRef): Promise<void> {
    return process_.request("deleteEvent", { reference });
  },
};
