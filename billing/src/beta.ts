import { securityHeaders } from "./http.ts";

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  const at = email.indexOf("@");
  if (email.length > 254 || at < 1 || at > 64 || at !== email.lastIndexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return null;
  if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  return email;
}

// Workers pass an execution context; direct calls (unit tests) omit it.
export type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

// The website waitlist closed with the official 1.3.0 release on 2026-11-12. Both routes answer
// 410 without reading the request or touching D1. Earlier signups stay in beta_signups.
export function waitlistClosed(): Response {
  return new Response(JSON.stringify({ error: "waitlist_closed" }), {
    status: 410,
    headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
