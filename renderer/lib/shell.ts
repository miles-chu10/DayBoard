/** Reconciled from the private DayBoard design-system v21 handoff. */
export const INSPECTOR_SIZE = { default: 280, min: 240, max: 380 } as const;
export const CONTENT_MIN = 440;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function inspectorWidth(available: number, remembered: number): number | null {
  const room = available - CONTENT_MIN - 1;
  return room < INSPECTOR_SIZE.min
    ? null
    : Math.min(clamp(remembered, INSPECTOR_SIZE.min, INSPECTOR_SIZE.max), room);
}

export function separatorKey(
  key: string,
  shift: boolean,
  current: number,
  min: number,
  max: number,
  direction: 1 | -1 = 1,
): number | null {
  const step = shift ? 32 : 8;
  if (key === "ArrowRight") return clamp(current + step * direction, min, max);
  if (key === "ArrowLeft") return clamp(current - step * direction, min, max);
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}

interface PaneSize {
  width: number;
  min: number;
  max: number;
}

/**
 * Widths for the sidebar and the right-hand pane that leave the content its minimum. Both are
 * narrowed first; when the window is still too small for all three, the sidebar steps aside
 * (null) while the pane is open, since the pane is what was just asked for.
 */
export function fitColumns(
  available: number,
  contentMin: number,
  sidebar: PaneSize | null,
  inspector: PaneSize | null,
): { sidebar: number | null; sidebarMax: number; inspector: number | null } {
  const HANDLE = 1;
  let room = available - contentMin;
  let sidebarShown = sidebar !== null;
  let inspectorWidth: number | null = null;
  if (inspector) {
    if (sidebar && room - 2 * HANDLE - sidebar.min < inspector.min) sidebarShown = false;
    const forInspector = room - HANDLE - (sidebar && sidebarShown ? sidebar.min + HANDLE : 0);
    inspectorWidth = clamp(inspector.width, inspector.min, Math.max(inspector.min, forInspector));
    inspectorWidth = Math.min(inspectorWidth, inspector.max);
    room -= inspectorWidth + HANDLE;
  }
  if (!sidebar || !sidebarShown) return { sidebar: null, sidebarMax: 0, inspector: inspectorWidth };
  const sidebarMax = Math.max(sidebar.min, Math.min(sidebar.max, room - HANDLE));
  return {
    sidebar: clamp(sidebar.width, sidebar.min, sidebarMax),
    sidebarMax,
    inspector: inspectorWidth,
  };
}
