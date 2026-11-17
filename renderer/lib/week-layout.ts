import type { CalendarEventItem } from "@main/shared-types";

import { addDays, parseISODate } from "./dates";

/** Hours on the clock face since local midnight of `dayStart`, which a DST change can't shift. */
function clockHours(time: number, dayStart: number, dayEnd: number): number {
  if (time <= dayStart) return 0;
  if (time >= dayEnd) return 24;
  const date = new Date(time);
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/**
 * Places a day's timed events on the 24 hour-rows of the week grid, overlapping ones side by
 * side (greedy lanes per overlapping cluster). `top` and `height` are in hour-rows, read from
 * the clock rather than elapsed time, so events line up with the hour labels on the days
 * clocks change.
 */
export function layoutDay(events: CalendarEventItem[], date: string) {
  const dayStart = parseISODate(date).getTime();
  const dayEnd = parseISODate(addDays(date, 1)).getTime();
  const items = events
    .map((event) => {
      const start = Math.max(new Date(event.start).getTime(), dayStart);
      const end = Math.min(Math.max(new Date(event.end).getTime(), start + 15 * 60_000), dayEnd);
      return { event, start, end, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: typeof items = [];
  let clusterEnd = 0;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((item) => item.lane + 1));
    for (const item of cluster) item.lanes = lanes;
    cluster = [];
  };
  for (const item of items) {
    if (cluster.length && item.start >= clusterEnd) flush();
    const taken = new Set(
      cluster.filter((other) => other.end > item.start).map((other) => other.lane),
    );
    while (taken.has(item.lane)) item.lane++;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return items.map((item) => {
    const top = clockHours(item.start, dayStart, dayEnd);
    // An event inside the hour a clock change skips or repeats still gets a visible height.
    const height = Math.max(clockHours(item.end, dayStart, dayEnd) - top, 0.25);
    return { ...item, top, height: Math.min(height, 24 - top) };
  });
}
