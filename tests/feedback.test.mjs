import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const { FEEDBACK_EMAIL, feedbackMailto } = await loadTs("shared/feedback.ts");

test("feedback email goes to support with the version details filled in", () => {
  const url = new URL(
    feedbackMailto({ appVersion: "1.3.0-beta.19", osVersion: "15.1.0", arch: "arm64" }),
  );
  assert.equal(FEEDBACK_EMAIL, "support@getdayboard.com");
  assert.equal(url.protocol, "mailto:");
  assert.equal(url.pathname, FEEDBACK_EMAIL);
  assert.equal(url.searchParams.get("subject"), "DayBoard feedback (1.3.0-beta.19)");
  const body = url.searchParams.get("body");
  assert.match(body, /^What happened, or what would you like DayBoard to do\?\r\n/);
  assert.match(body, /\r\nDayBoard 1\.3\.0-beta\.19\r\nmacOS 15\.1\.0 \(arm64\)$/);
  assert.match(body, /leave out passwords, account tokens and private mail/);
});

test("mail apps get spaces as %20, not +", () => {
  const url = feedbackMailto({ appVersion: "1.3.0", osVersion: "14.6", arch: "arm64" });
  assert.doesNotMatch(url, /\+/);
  assert.match(url, /subject=DayBoard%20feedback%20\(1\.3\.0\)/);
});

test("Help menu and Settings both offer feedback", async () => {
  const [menu, handlers, settings] = await Promise.all([
    readFile(new URL("../main/window.ts", import.meta.url), "utf8"),
    readFile(new URL("../main/handlers/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../renderer/settings/settings-view.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(menu, /role: "help",\s*submenu: \[[^\]]*?label: "Send Feedback…"/);
  assert.match(
    menu,
    /label: "Copy Feedback Address",\s*id: "copy-feedback-address",\s*click: copyFeedbackAddress/,
  );
  assert.match(handlers, /ipcMain\.handle\("app:sendFeedback"/);
  assert.match(handlers, /ipcMain\.handle\("app:copyFeedbackAddress"/);
  assert.match(settings, /<UpdatesTab \/>\s*<FeedbackSettings \/>/);
});
