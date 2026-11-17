import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useOptionalSplitView } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import { Plus, X } from "lucide-react";

import { createTabNavigation } from "../lib/tab-navigation";
import { invoke } from "../lib/ipc";
import { NAV_ITEMS } from "../lib/navigation";
import { readStored, writeStored } from "../lib/storage";
import {
  cleanSearch,
  closeTab,
  openTab,
  parseTabs,
  selectTab,
  stepTab,
  updateActive,
  type Tab,
  type TabsState,
} from "../lib/tabs";

const STORAGE_KEY = "tabs";
const ROUTES = new Set<string>(NAV_ITEMS.map((item) => item.route));

function newTab(route = "/", search: Record<string, string> = {}): Tab {
  return { id: crypto.randomUUID(), route, search };
}

export function tabTitle(tab: Tab): string {
  return NAV_ITEMS.find((item) => item.route === tab.route)?.title ?? "DayBoard";
}

interface TabsContextValue {
  state: TabsState;
  open: () => void;
  close: (id: string) => void;
  select: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function useTabs(): TabsContextValue {
  const value = useContext(TabsContext);
  if (!value) throw new Error("useTabs must be used inside <TabsProvider>");
  return value;
}

/** Tabs follow the router: the active tab records each navigation, and switching tabs navigates. */
export function TabsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const location = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      search: state.location.search,
    }),
  });
  const [state, setState] = useState<TabsState>(() =>
    parseTabs(
      readStored(STORAGE_KEY, (value): value is unknown => typeof value === "object"),
      (route) => ROUTES.has(route),
      newTab(location.pathname, cleanSearch(location.search)),
    ),
  );

  // Each navigation is recorded in the active tab, during render so the strip never lags a frame.
  const search = cleanSearch(location.search);
  const locationKey = `${location.pathname}?${JSON.stringify(search)}`;
  // Starts empty so the launch view replaces whatever the saved active tab last showed.
  const [recorded, setRecorded] = useState("");
  if (recorded !== locationKey) {
    setRecorded(locationKey);
    setState((current) => updateActive(current, location.pathname, search));
  }

  useEffect(() => {
    writeStored(STORAGE_KEY, state);
  }, [state]);

  const count = state.tabs.length;
  useEffect(() => {
    void invoke("tabs:setCount", { count }).catch(() => undefined);
  }, [count]);

  const [navigation] = useState(() =>
    createTabNavigation({
      history: router.history,
      commit: setState,
      navigate: (route, search, state) =>
        // The registered editor guard was just flushed. Do not enqueue it a second time.
        router.navigate({
          to: route as never,
          search: search as never,
          state,
          ignoreBlocker: true,
        }),
    }),
  );
  useEffect(() => navigation.subscribe(), [navigation]);
  const show = navigation.show;

  const value = useMemo<TabsContextValue>(
    () => ({
      state,
      open: () => show(openTab(state, newTab())),
      close: (id) => {
        const next = closeTab(state, id);
        if (next.active !== state.active) show(next);
        else navigation.commit(next);
      },
      select: (id) => show(selectTab(state, id)),
    }),
    [state, show, navigation],
  );

  // ⌘T and ⌘W arrive from the app menu; ⌃Tab, ⌃⇧Tab and ⌘1–9 switch tabs here.
  useEffect(
    () =>
      window.dayboard.ipc.onNotification("tabs:command", (params) => {
        const action = (params as { action?: unknown } | null)?.action;
        if (modalOpen()) return;
        if (action === "new") value.open();
        if (action === "close") value.close(value.state.active);
      }),
    [value],
  );
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || value.state.tabs.length < 2) return;
      if (modalOpen()) return;
      if (event.key === "Tab" && event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        show(stepTab(value.state, event.shiftKey ? -1 : 1));
        return;
      }
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (digit && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        const tabs = value.state.tabs;
        // ⌘9 is always the last tab, as in browsers.
        const tab = digit === "9" ? tabs[tabs.length - 1] : tabs[Number(digit) - 1];
        if (tab) value.select(tab.id);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [value, show]);

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
}

/**
 * A dialog on screen (an editor, a reply, a new email) belongs to the current tab. Changing
 * tabs would unmount it and throw away what was typed, so tab shortcuts wait until it closes.
 */
function modalOpen(): boolean {
  return document.querySelector('[data-modal][data-state="open"]') !== null;
}

/** Shown once a second tab is open, like Safari's tab bar. */
export function TabStrip() {
  const { state, open, close, select } = useTabs();
  const split = useOptionalSplitView();
  if (state.tabs.length < 2) return null;
  return (
    <div
      className={cn(
        "drag-region flex h-10 shrink-0 items-center gap-1 border-b border-separator px-2",
        split?.sidebarCollapsed && "pl-[132px]",
      )}
    >
      <div role="tablist" aria-label="Tabs" className="no-drag flex min-w-0 flex-1 gap-1">
        {state.tabs.map((tab, index) => {
          const selected = tab.id === state.active;
          const title = tabTitle(tab);
          return (
            <div
              key={tab.id}
              role="presentation"
              className={cn(
                "group flex h-7 min-w-0 max-w-56 flex-1 items-center rounded-md text-regular",
                selected ? "bg-control text-primary" : "text-secondary hover:bg-list-hover",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onKeyDown={(event) => {
                  const last = state.tabs.length - 1;
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % (last + 1)
                      : event.key === "ArrowLeft"
                        ? (index + last) % (last + 1)
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? last
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  const tablist = event.currentTarget.closest('[role="tablist"]');
                  select(state.tabs[next].id);
                  requestAnimationFrame(() =>
                    tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus(),
                  );
                }}
                title={index < 9 ? `${title} (⌘${index + 1})` : title}
                className="h-full min-w-0 flex-1 truncate px-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
                onClick={() => select(tab.id)}
              >
                {title}
              </button>
              <button
                type="button"
                aria-label={`Close ${title} tab`}
                title="Close tab (⌘W)"
                className={cn(
                  "mr-1 flex size-5 shrink-0 items-center justify-center rounded hover:bg-list-hover",
                  selected
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
                onClick={() => close(tab.id)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New tab"
        title="New tab (⌘T)"
        className="no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-secondary hover:bg-list-hover"
        onClick={open}
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
