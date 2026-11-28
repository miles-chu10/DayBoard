import type { AIProvider } from "../main/shared-types.js";

// Google's API Services User Data Policy bars sending Google Workspace API data (here, Google
// Calendar and Google Tasks) to AI services that may train on it. Only API providers whose terms
// say they don't train on API data by default qualify. Command-line providers depend on the
// user's own plan and settings, which DayBoard can't check, so they don't. Gmail is read over
// IMAP, not a Google API, and Apple Reminders and Mac calendars aren't covered.
// OpenRouter qualifies only because every request asks for providers that don't collect data
// (see `withOpenRouterNoDataCollection`).
export const GOOGLE_DATA_AI_PROVIDERS: readonly AIProvider[] = [
  "openai",
  "anthropic",
  "xai",
  "groq",
  "openrouter",
];

/** Whether Google Calendar and Google Tasks data may go to this AI provider. */
export function aiMayReceiveGoogleData(provider: AIProvider | "" | undefined | null): boolean {
  return !!provider && GOOGLE_DATA_AI_PROVIDERS.includes(provider);
}

/** Events without a provider come from Google Calendar. */
export function isGoogleCalendarEvent(event: { provider?: "google" | "apple" }): boolean {
  return event.provider !== "apple";
}

/** Tasks from Google Tasks; Apple Reminders use `source: "reminders"`. */
export function isGoogleTask(todo: { source: string }): boolean {
  return todo.source === "tasks";
}

/** Told to the AI where Google data was left out, so it doesn't read the gap as "nothing due". */
export const GOOGLE_DATA_WITHHELD =
  "Google Calendar and Google Tasks are not shared with this AI provider, so they are left out here. Only Mac calendars and Apple Reminders are included. Don't conclude the user has no Google events or tasks.";

/** Short user-facing note for Settings and the AI consent screen. */
export const GOOGLE_DATA_WITHHELD_NOTICE =
  "Google Calendar and Google Tasks aren't shared with this provider, because its use of your data for training depends on your own plan or settings. Use an OpenAI, Anthropic, xAI, Groq or OpenRouter API key to include them.";

/**
 * Adds `provider.data_collection: "deny"` to an OpenRouter request body, so it is only routed to
 * providers that don't store or train on prompts. Fails closed: a body it can't read is refused.
 */
export function withOpenRouterNoDataCollection(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("OpenRouter request blocked: the request body couldn't be read.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("OpenRouter request blocked: unexpected request body.");
  const request = parsed as Record<string, unknown>;
  const current = request.provider;
  const routing =
    typeof current === "object" && current !== null && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return JSON.stringify({ ...request, provider: { ...routing, data_collection: "deny" } });
}
