import assert from "node:assert/strict";
import test from "node:test";

import { aiPlanCopy, ONBOARDING_STEPS, providerIndicator } from "./onboarding";

test("the welcome walks through welcome, connect, AI and done, in that order", () => {
  assert.deepEqual(ONBOARDING_STEPS, ["welcome", "connect", "ai", "done"]);
});

test("the AI step explains the trial without a price, and stays quiet where nothing is sold", () => {
  const trial = aiPlanCopy({ state: "trial", daysLeft: 14 });
  assert.match(trial ?? "", /^Your AI trial has 14 days left, counted from the first time/);
  assert.match(trial ?? "", /one-time purchase\. Everything else in DayBoard stays free\.$/);
  assert.doesNotMatch(trial ?? "", /\$/);
  assert.match(aiPlanCopy({ state: "trial", daysLeft: 1 }) ?? "", /has 1 day left/);
  assert.match(aiPlanCopy({ state: "expired" }) ?? "", /^Your AI trial has ended\./);
  assert.equal(
    aiPlanCopy({ state: "licensed", keyHint: "ABCD" }),
    "DayBoard Pro is unlocked on this Mac.",
  );
  for (const status of [
    { state: "invalid", message: "Revoked.", keyHint: "ABCD" },
    { state: "network-error", keyHint: "ABCD", lastValidatedAt: "2026-11-01T00:00:00Z" },
    { state: "unreadable" },
  ] as const) {
    assert.match(aiPlanCopy(status) ?? "", /needs attention\. Open Settings → License/);
  }
  assert.equal(aiPlanCopy({ state: "disabled" }), null);
  assert.equal(aiPlanCopy({ state: "unconfigured" }), null);
  assert.equal(aiPlanCopy(undefined), null);
});

test("each command-line tool shows whether it's ready", () => {
  assert.deepEqual(providerIndicator(undefined), { variant: "loading", text: "Checking…" });
  assert.deepEqual(providerIndicator({ ok: true, version: "2.1.0" }), {
    variant: "success",
    text: "Installed",
  });
  assert.deepEqual(providerIndicator({ ok: false, reason: "not-logged-in", message: "" }), {
    variant: "warning",
    text: "Not signed in",
  });
  assert.deepEqual(providerIndicator({ ok: false, reason: "missing", message: "" }), {
    variant: "error",
    text: "Not installed",
  });
  assert.deepEqual(
    providerIndicator({ ok: false, reason: "failed", message: "" }).text,
    "Unavailable",
  );
});
