import { ipcMain } from "../platform/index.js";

import {
  getAssistantHistory,
  normalizeChat,
  importLegacyAssistantChat,
  saveAssistantChat,
  selectAssistantChat,
} from "../services/assistant-history-store.js";
import { trackPendingWrite } from "../services/pending-writes.js";
import { createCoalescedSaveQueue } from "../services/coalesced-save-queue.js";
import { requireAgendaScope, requireExpectedAgendaScope } from "./productivity.js";

function asObject(value: unknown, channel: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${channel}: expected an object payload`);
  return value as Record<string, unknown>;
}

export function registerAssistantHistoryHandlers(): void {
  // Include scope lookup in request order: a fast reload must never overtake
  // a submitted save whose account lookup is still awaiting the native store.
  const requests = createCoalescedSaveQueue(async (input: Record<string, unknown>) => {
    const scope = await requireAgendaScope();
    requireExpectedAgendaScope(input, scope, "assistant:saveChat");
    return saveAssistantChat(scope, input.chat);
  });
  ipcMain.handle("assistant:getHistory", () =>
    requests.run(async () => {
      const scope = await requireAgendaScope();
      const history = await getAssistantHistory(scope);
      // Account changes can race a slow disk read. Never return one account's
      // history after the provider has resolved to another account.
      if ((await requireAgendaScope()) !== scope)
        throw new Error(
          "assistant:getHistory: account changed while history was loading. Refresh and try again.",
        );
      return history;
    }),
  );

  ipcMain.handle("assistant:saveChat", async (_event, payload: unknown) => {
    const channel = "assistant:saveChat";
    const input = asObject(payload, channel);
    const chat = normalizeChat(input.chat);
    // Track the batching window too: quitting must wait for the latest submitted snapshot.
    return trackPendingWrite(() =>
      requests.save(JSON.stringify([input.expectedScope, chat.id]), { ...input, chat }),
    );
  });

  ipcMain.handle("assistant:selectChat", async (_event, payload: unknown) => {
    const channel = "assistant:selectChat";
    const input = asObject(payload, channel);
    return trackPendingWrite(() =>
      requests.run(async () => {
        const scope = await requireAgendaScope();
        requireExpectedAgendaScope(input, scope, channel);
        return selectAssistantChat(scope, input.id);
      }),
    );
  });

  ipcMain.handle("assistant:importLegacyChat", async (_event, payload: unknown) => {
    const channel = "assistant:importLegacyChat";
    const input = asObject(payload, channel);
    return trackPendingWrite(() =>
      requests.run(async () => {
        const scope = await requireAgendaScope();
        requireExpectedAgendaScope(input, scope, channel);
        return importLegacyAssistantChat(scope, input.messages);
      }),
    );
  });
}
