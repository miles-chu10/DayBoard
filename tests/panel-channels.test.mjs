import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { PANEL_CHANNELS } = await loadTs("main/system-panels/panel-channels.ts");

test("panel allow-list is exactly the reviewed set", () => {
  assert.deepEqual([...PANEL_CHANNELS].sort(), [
    "accounts:getStatus",
    "agenda:getScope",
    "agenda:getState",
    "agenda:setFocus",
    "ai:availability",
    "ai:run",
    "app:isDemo",
    "app:openExternal",
    "calendar:list",
    "calendar:listRange",
    "calendar:update",
    "capture:recent",
    "capture:submit",
    "capture:undo",
    "license:status",
    "mail:list",
    "mail:related",
    "mail:schedule",
    "meetings:findNotes",
    "meetings:getNotes",
    "meetings:importNotes",
    "meetings:notesStatus",
    "nativeTheme:getInfo",
    "panel:hide",
    "panel:quit",
    "panel:resize",
    "panel:show",
    "reminders:create",
    "reminders:delete",
    "reminders:list",
    "reminders:lists",
    "reminders:setCompleted",
    "reminders:update",
    "settings:get",
    "tasks:create",
    "tasks:delete",
    "tasks:list",
    "tasks:lists",
    "tasks:setCompleted",
    "tasks:update",
    "window:openSettings",
  ]);
});

test("panel allow-list excludes settings, MCP, account, event-removal and main-window channels", () => {
  for (const channel of [
    "settings:update",
    "mcp:save",
    "mcp:test",
    "google:connect",
    "google:disconnect",
    "calendar:delete",
    "calendar:getForEditing",
    "panel:openMain",
    "calendar:create",
    "ai:assistant",
    "system:suspendHotkey",
    "meetings:checkProviders",
  ]) {
    assert.equal(PANEL_CHANNELS.has(channel), false, channel);
  }
});
