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

export async function navigateHistory(history: RouterHistory, direction: "back" | "forward") {
  const guard = guards.get(history);
  if (guard) {
    const attempt = ++guard.attempt;
    if (!(await guard.canLeave())) return;
    // An unmount or a newer command supersedes a navigation still waiting for a save.
    if (guards.get(history) !== guard || guard.attempt !== attempt) return;
  }
  history[direction]();
}
