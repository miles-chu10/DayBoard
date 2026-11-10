import type { RouterHistory } from "@tanstack/react-router";

const guards = new WeakMap<RouterHistory, { canLeave: () => Promise<boolean>; attempt: number }>();

/** Memory history skips route blockers on back/forward; editors can guard those commands too. */
export function registerNavigationGuard(history: RouterHistory, canLeave: () => Promise<boolean>) {
  const guard = { canLeave, attempt: 0 };
  guards.set(history, guard);
  return () => {
    if (guards.get(history) === guard) guards.delete(history);
  };
}

/** Flushes the current editor without navigating; callers must commit synchronously if allowed. */
export async function canNavigate(history: RouterHistory): Promise<boolean> {
  const location = history.location;
  const guard = guards.get(history);
  if (guard) {
    const attempt = ++guard.attempt;
    if (!(await guard.canLeave())) return false;
    if (guards.get(history) !== guard || guard.attempt !== attempt) return false;
  }
  return history.location === location;
}

export async function navigateHistory(history: RouterHistory, direction: "back" | "forward") {
  if (await canNavigate(history)) history[direction]();
}
