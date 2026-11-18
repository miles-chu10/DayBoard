// The only app channels the floating panels may invoke or stream (enforced in platform/ipc.ts).
// Settings writes, account changes, MCP configuration and event creation or deletion stay with
// the main windows. Nothing here opens the main window: the menu bar does its work in place.

export const PANEL_CHANNELS: ReadonlySet<string> = new Set([
  // Startup, theme and source reads
  "app:isDemo",
  "settings:get",
  "nativeTheme:getInfo",
  "accounts:getStatus",
  "agenda:getScope",
  "agenda:getState",
  "tasks:list",
  "reminders:list",
  "calendar:list",
  "calendar:listRange",
  "tasks:lists",
  "reminders:lists",
  "ai:availability",
  "license:status",
  // Quick Capture
  "capture:submit",
  "capture:undo",
  "capture:recent",
  // Meeting prep
  "ai:run",
  "mail:related",
  // Waiting on you
  "mail:list",
  "mail:schedule",
  // Meeting notes and their follow-ups
  "meetings:notesStatus",
  "meetings:findNotes",
  "meetings:importNotes",
  "meetings:getNotes",
  "tasks:create",
  "reminders:create",
  // The menu bar's task list: check items off (and unpin a completed focus item)
  "tasks:setCompleted",
  "reminders:setCompleted",
  "agenda:setFocus",
  // Edit in place: retitle, re-date and delete a to-do; retitle and move an event. Each handler
  // validates its payload and the account scope the edit started under.
  "tasks:update",
  "reminders:update",
  "tasks:delete",
  "reminders:delete",
  "calendar:update",
  // Panel control
  "panel:hide",
  "panel:show",
  "panel:resize",
  "panel:quit",
  "window:openSettings",
  "app:openExternal",
]);
