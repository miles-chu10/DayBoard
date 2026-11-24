import type { QueryCacheNotifyEvent, QueryClient } from "@tanstack/query-core";
import type { AccountsStatus, SourceResult } from "@main/shared-types";

import { readStored, removeStored, writeStored } from "./storage";

// A full quit, a relaunch after an update or a login item start shows the last dashboard at once
// and refreshes behind it. Only source listings are kept: no tokens, passwords, message bodies or
// AI data. Each snapshot belongs to one account and is dropped when the account changes.

export const LAUNCH_CACHE_KEY = "dayboard.launchCache.v1";
/** Older than this, the saved dashboard would mislead more than it helps. */
export const LAUNCH_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60_000;
/** Kept well under the renderer's storage quota, which other caches share. */
const MAX_BYTES = 2_000_000;
const SAVE_DELAY_MS = 1_000;

export const LAUNCH_CACHED_SOURCES = ["tasks", "reminders", "mail", "calendar"] as const;
export type LaunchCachedSource = (typeof LAUNCH_CACHED_SOURCES)[number];

type OkResult = Extract<SourceResult<unknown>, { state: "ok" }>;

export interface LaunchSnapshot {
  version: 1;
  owner: string;
  savedAt: string;
  sources: Partial<Record<LaunchCachedSource, OkResult>>;
}

/**
 * Who the cached data belongs to. Null while an account is connected but its address is
 * unknown: nothing is saved or shown then, rather than guessing.
 */
export function launchCacheOwner(status: AccountsStatus | undefined): string | null {
  if (!status) return null;
  const google = status.google.connected ? status.google.email?.trim().toLowerCase() : "";
  const gmail = status.gmail.connected ? status.gmail.email?.trim().toLowerCase() : "";
  if (google === undefined || google === null || gmail === undefined || gmail === null) return null;
  return `google:${google}|gmail:${gmail}`;
}

function isOkResult(value: unknown): value is OkResult {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { state?: unknown }).state === "ok" &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export function isLaunchSnapshot(value: unknown): value is LaunchSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<LaunchSnapshot>;
  if (snapshot.version !== 1 || typeof snapshot.owner !== "string") return false;
  if (typeof snapshot.savedAt !== "string" || Number.isNaN(Date.parse(snapshot.savedAt)))
    return false;
  if (!snapshot.sources || typeof snapshot.sources !== "object") return false;
  return Object.entries(snapshot.sources).every(
    ([key, result]) =>
      (LAUNCH_CACHED_SOURCES as readonly string[]).includes(key) && isOkResult(result),
  );
}

/** The listings to keep, without per-session state such as a failed refresh. */
function savedResult(result: OkResult): OkResult {
  const { refreshError: _error, savedCopy: _saved, ...rest } = result;
  return rest;
}

export function buildLaunchSnapshot(
  queryClient: QueryClient,
  owner: string,
  now = new Date(),
): LaunchSnapshot {
  const sources: LaunchSnapshot["sources"] = {};
  for (const source of LAUNCH_CACHED_SOURCES) {
    const data = queryClient.getQueryData<SourceResult<unknown>>([source]);
    if (isOkResult(data)) sources[source] = savedResult(data);
  }
  return { version: 1, owner, savedAt: now.toISOString(), sources };
}

export function clearLaunchCache(): void {
  removeStored(LAUNCH_CACHE_KEY);
}

/**
 * Before the first render: seeds the dashboard from the last session when it belongs to the
 * account that is signed in now. Seeded entries are marked stale, so every view still refetches
 * as it mounts; until then they carry `savedCopy` so the UI can say so.
 */
export function hydrateLaunchCache(
  queryClient: QueryClient,
  accounts: AccountsStatus,
  now = Date.now(),
): LaunchCachedSource[] {
  const snapshot = readStored(LAUNCH_CACHE_KEY, isLaunchSnapshot);
  if (!snapshot) return [];
  const owner = launchCacheOwner(accounts);
  const age = now - Date.parse(snapshot.savedAt);
  if (!owner || snapshot.owner !== owner || age < 0 || age > LAUNCH_CACHE_MAX_AGE_MS) {
    clearLaunchCache();
    return [];
  }
  const seeded: LaunchCachedSource[] = [];
  for (const source of LAUNCH_CACHED_SOURCES) {
    const result = snapshot.sources[source];
    if (!result) continue;
    // A listing re-saved while offline keeps the time it was really fetched.
    const fetched = Math.min(
      Date.parse(result.refreshedAt ?? snapshot.savedAt),
      Date.parse(snapshot.savedAt),
    );
    if (Number.isNaN(fetched) || now - fetched > LAUNCH_CACHE_MAX_AGE_MS) continue;
    queryClient.setQueryData([source], { ...result, savedCopy: true } satisfies OkResult, {
      updatedAt: fetched,
    });
    // A relaunch within the stale time would otherwise keep the saved copy until it expires.
    void queryClient.invalidateQueries({ queryKey: [source], exact: true, refetchType: "none" });
    seeded.push(source);
  }
  return seeded;
}

/** Saves the source listings shortly after each successful fetch, for the next launch. */
export function startLaunchCacheWriter(
  queryClient: QueryClient,
  accountsKey: readonly unknown[],
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    timer = undefined;
    const owner = launchCacheOwner(queryClient.getQueryData<AccountsStatus>(accountsKey));
    if (!owner) return;
    const snapshot = buildLaunchSnapshot(queryClient, owner);
    // Still only what the last session had: saving it again would refresh its age.
    if (Object.values(snapshot.sources).length === 0) return clearLaunchCache();
    const allSaved = LAUNCH_CACHED_SOURCES.every(
      (source) =>
        queryClient.getQueryData<SourceResult<unknown>>([source]) === undefined ||
        (queryClient.getQueryData<OkResult>([source])?.savedCopy ?? false),
    );
    if (allSaved) return;
    try {
      const text = JSON.stringify(snapshot);
      if (text.length > MAX_BYTES) return clearLaunchCache();
      writeStored(LAUNCH_CACHE_KEY, snapshot);
    } catch {
      // Full or unavailable storage: the next launch loads normally.
      clearLaunchCache();
    }
  };
  const unsubscribe = queryClient.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
    if (event.type !== "updated" && event.type !== "removed") return;
    const key = event.query.queryKey;
    if (key.length !== 1 || !(LAUNCH_CACHED_SOURCES as readonly unknown[]).includes(key[0])) return;
    if (event.type === "updated" && event.action.type !== "success") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

export interface SavedCopyStatus {
  /** The oldest fetch time among the saved listings still on screen. */
  since: string;
  refreshing: boolean;
  failed: boolean;
}

/** What the dashboard should say while any source still shows the last session's listing. */
export function savedCopyStatus(
  sources: readonly { data?: SourceResult<unknown>; isFetching: boolean; isError: boolean }[],
): SavedCopyStatus | null {
  const saved = sources.filter(
    (source): source is typeof source & { data: OkResult } =>
      isOkResult(source.data) && source.data.savedCopy === true,
  );
  if (!saved.length) return null;
  const since = saved
    .map((source) => source.data.refreshedAt)
    .filter((value): value is string => typeof value === "string")
    .sort()[0];
  if (!since) return null;
  const refreshing = saved.some((source) => source.isFetching);
  const failed =
    !refreshing && saved.some((source) => source.isError || Boolean(source.data.refreshError));
  return { since, refreshing, failed };
}

/** "9:41 PM" today, "Nov 22, 9:41 PM" on an earlier day. */
export function savedCopyTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === now.toDateString()
    ? time
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
