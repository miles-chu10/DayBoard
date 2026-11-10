import type { RouterHistory } from "@tanstack/react-router";
import { canNavigate } from "./navigation-guard";
import { activeTab, type TabsState } from "./tabs";

const TRANSITION_KEY = "dayboardTabTransition";

/** Tab edits become visible only when the router actually accepts their navigation. */
export function createTabNavigation(options: {
  history: RouterHistory;
  commit: (next: TabsState) => void;
  navigate: (
    route: string,
    search: Record<string, string>,
    state: Record<string, string>,
  ) => Promise<unknown>;
}) {
  const owner = crypto.randomUUID();
  let sequence = 0;
  let pending: { key: string; next: TabsState } | undefined;

  return {
    subscribe() {
      const unsubscribe = options.history.subscribe(({ location, action }) => {
        const key = (location.state as unknown as Record<string, unknown>)[TRANSITION_KEY];
        const proposal = pending;
        const isCommit = action.type === "PUSH" || action.type === "REPLACE";
        pending = undefined;
        if (proposal && proposal.key === key && isCommit) options.commit(proposal.next);
      });
      return () => {
        pending = undefined;
        unsubscribe();
      };
    },
    async show(next: TabsState) {
      const key = `${owner}:${++sequence}`;
      pending = { key, next };
      // Do not enqueue router pushes while an editor save is pending: an older blocked
      // push can otherwise reach history after a newer navigation.
      if (!(await canNavigate(options.history)) || pending?.key !== key) {
        if (pending?.key === key) pending = undefined;
        return;
      }
      const tab = activeTab(next);
      // A unique history state also makes switching between identical routes observable.
      void options.navigate(tab.route, tab.search, { [TRANSITION_KEY]: key }).catch(() => {
        if (pending?.key === key) pending = undefined;
      });
    },
    commit(next: TabsState) {
      // Closing an inactive tab must invalidate a still-waiting proposal based on the old list.
      pending = undefined;
      options.commit(next);
    },
  };
}
