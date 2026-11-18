import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button, Text, cn } from "@renderer/ui";
import type { CalendarEventItem } from "@main/shared-types";

import { SourceDot } from "../components/source-dot";
import { buildAgenda, type AgendaSources } from "../lib/agenda";
import { identifyCalendarEvents } from "../lib/calendar-identity";
import { dayHeading, parseISODate, toISODate } from "../lib/dates";
import { useCalendarRange } from "../lib/queries";
import type { Todo } from "../lib/todos";
import { dayLine } from "./day-line";
import {
  MONTH_GRID_DAYS,
  dayMarks,
  monthGrid,
  monthOf,
  monthTitle,
  shiftMonth,
} from "./month-grid";
import { DayRows } from "./panel-rows";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A month at a glance, with the picked day's line underneath. Everything opens in place. */
export function MonthView({
  todos,
  sources,
  now,
  completed,
}: {
  todos: Todo[];
  sources: AgendaSources;
  now: Date;
  /** To-dos to list as checked off on their day; empty when that is switched off. */
  completed: Todo[];
}) {
  const today = toISODate(now);
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => monthOf(today));
  const grid = monthGrid(month);
  const calendar = useCalendarRange(grid.start, MONTH_GRID_DAYS);
  const events: CalendarEventItem[] = identifyCalendarEvents(
    calendar.data?.state === "ok" ? calendar.data.items : [],
  );
  const agenda = buildAgenda({
    events,
    todos,
    startDate: grid.start,
    days: MONTH_GRID_DAYS,
    now,
    sources,
  });
  const marks = dayMarks(agenda);
  const picked = agenda.days.find((day) => day.date === selected);
  const go = (delta: number) => setMonth(shiftMonth(month, delta));
  const pick = (date: string) => {
    setSelected(date);
    if (monthOf(date) !== month) setMonth(monthOf(date));
  };

  return (
    <section aria-label="Month" className="flex flex-col gap-2">
      <div className="flex items-center gap-1 px-1">
        <Text as="h2" variant="strong" className="flex-1" aria-live="polite">
          {monthTitle(month)}
        </Text>
        {selected === today && month === monthOf(today) ? null : (
          <Button size="small" variant="transparent" onClick={() => pick(today)}>
            Today
          </Button>
        )}
        <Button
          size="small"
          variant="transparent"
          iconOnly
          aria-label="Previous month"
          onClick={() => go(-1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          size="small"
          variant="transparent"
          iconOnly
          aria-label="Next month"
          onClick={() => go(1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <div role="grid" aria-label={monthTitle(month)} className="flex flex-col gap-0.5">
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((weekday) => (
            <Text
              key={weekday}
              role="columnheader"
              as="span"
              variant="mini"
              color="tertiary"
              align="center"
            >
              {weekday}
            </Text>
          ))}
        </div>
        {grid.weeks.map((week) => (
          <div key={week[0].date} role="row" className="grid grid-cols-7">
            {week.map((cell) => {
              const mark = marks.get(cell.date);
              const isSelected = cell.date === selected;
              return (
                <div key={cell.date} role="gridcell" className="flex justify-center">
                  <button
                    type="button"
                    aria-label={parseISODate(cell.date).toLocaleDateString([], {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                    aria-pressed={isSelected}
                    aria-current={cell.date === today ? "date" : undefined}
                    onClick={() => pick(cell.date)}
                    className={cn(
                      "flex h-9 w-10 flex-col items-center justify-center gap-0.5 rounded-lg text-small tabular-nums",
                      "hover:bg-list-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                      !cell.inMonth && "text-tertiary",
                      cell.date === today && !isSelected && "font-semibold text-accent",
                      isSelected && "bg-accent font-semibold text-accent-contrast hover:bg-accent",
                    )}
                  >
                    {cell.day}
                    <span className="flex h-1 gap-0.5" aria-hidden="true">
                      {mark?.events ? (
                        <SourceDot
                          source="calendar"
                          className={cn("size-1", isSelected && "bg-accent-contrast")}
                        />
                      ) : null}
                      {mark?.todos ? (
                        <span
                          className={cn(
                            "size-1 rounded-full",
                            isSelected ? "bg-accent-contrast" : "bg-tertiary",
                          )}
                        />
                      ) : null}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <section aria-label={dayHeading(selected)} className="flex flex-col gap-1">
        <Text as="h3" variant="small-strong" color="secondary" className="px-2">
          {dayHeading(selected)}
        </Text>
        {calendar.isPending && sources.calendar !== false ? (
          <Text as="p" variant="small" color="secondary" role="status" className="px-2">
            Loading this month…
          </Text>
        ) : (
          <DayRows
            line={dayLine(picked, now, completed)}
            empty="Nothing on this day in available sources."
          />
        )}
      </section>
    </section>
  );
}
