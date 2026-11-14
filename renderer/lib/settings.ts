import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@renderer/ui";
import { isAppStoreBuild } from "../../shared/app-store-build";
import type { AssistantProvider } from "../../shared/assistant-history";
import type {
  AIFeature,
  AIProvider,
  ApiProviderId,
  AppSettings,
  CliProviderId,
  SourceId,
} from "@main/shared-types";

import { errorMessage, invoke } from "./ipc";

export const settingsQueryKey = ["settings"] as const;

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => invoke<AppSettings>("settings:get"),
    staleTime: Infinity,
  });
}

// Saves this window has sent and not heard back about. Each save carries the whole settings
// object, so while any is in flight the cache holds the newest edit and must not be replaced by
// an older save's echo: the next edit would start from it and silently undo the one before.
let savesInFlight = 0;

/** True while this window's own settings saves are still on their way. */
export function settingsSaveInFlight(): boolean {
  return savesInFlight > 0;
}

/** Applies a change to a copy of the current settings, optimistically, and persists it. */
export function useSettingsEditor() {
  const queryClient = useQueryClient();
  const settings = useSettings().data;
  const mutation = useMutation({
    mutationFn: (next: AppSettings) => invoke<AppSettings>("settings:update", next),
    onMutate: (next) => {
      savesInFlight += 1;
      const previous = queryClient.getQueryData<AppSettings>(settingsQueryKey);
      queryClient.setQueryData(settingsQueryKey, next);
      return { previous };
    },
    onError: (error, _next, context) => {
      // With later saves still pending, their edits stay; the refetch below settles the rest.
      if (context?.previous && savesInFlight === 1)
        queryClient.setQueryData(settingsQueryKey, context.previous);
      toast.error(`Couldn't save settings: ${errorMessage(error)}`);
    },
    onSettled: () => {
      savesInFlight = Math.max(0, savesInFlight - 1);
      // Pick up what was actually stored, including changes skipped while saves were pending.
      if (!savesInFlight) void queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });

  function edit(recipe: (draft: AppSettings) => void) {
    const current = queryClient.getQueryData<AppSettings>(settingsQueryKey);
    if (!current) return;
    const draft = structuredClone(current);
    recipe(draft);
    mutation.mutate(draft);
  }

  return { settings, edit };
}

export function featureOn(settings: AppSettings | undefined, feature: AIFeature): boolean {
  return Boolean(settings?.ai.enabled && settings.ai.features[feature]);
}

export function sourceOn(settings: AppSettings | undefined, source: SourceId): boolean {
  return settings?.sources[source].enabled ?? true;
}

/** New mail is triaged without a click once a provider is chosen and the option is on. */
export function autoTriageOn(settings: AppSettings | undefined): boolean {
  return Boolean(
    featureOn(settings, "triage") && settings?.ai.providerChosen && settings.mail.autoTriage,
  );
}

// "glaze" is retired and can no longer be selected (see settings-store.ts's PROVIDERS list);
// its entries below only label older Assistant messages sent before the removal.
export const PROVIDER_LABEL: Record<AssistantProvider, string> = {
  glaze: "Glaze AI",
  claude: "Claude",
  codex: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
  // Retired: labels Assistant replies sent through Meta's Muse Code before it was removed.
  muse: "Muse",
  openai: "OpenAI API",
  anthropic: "Anthropic API",
  google: "Gemini API",
  xai: "xAI Grok",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  groq: "Groq",
  openrouter: "OpenRouter",
};

/** Subscription accounts vs. pay-per-use API keys, for grouping in pickers. */
/** Empty in the App Store edition, whose sandbox can't run the subscription CLIs. */
export const SUBSCRIPTION_PROVIDERS: readonly CliProviderId[] = isAppStoreBuild
  ? []
  : ["claude", "codex", "gemini", "grok"];
export const API_KEY_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "mistral",
  "deepseek",
  "groq",
  "openrouter",
] as const satisfies readonly ApiProviderId[];

export function isApiKeyProvider(provider: AIProvider): provider is ApiProviderId {
  return (API_KEY_PROVIDERS as readonly AIProvider[]).includes(provider);
}

/** Antigravity and Grok run without per-request MCP configuration. */
export function providerUsesMcp(provider: AIProvider): boolean {
  return provider !== "gemini" && provider !== "grok";
}

export const PROVIDER_DETAIL: Record<AIProvider, string> = {
  claude: "Uses your Claude subscription through Claude Code.",
  codex: "Uses your ChatGPT subscription through the Codex CLI.",
  gemini: "Uses your Google AI subscription through the Antigravity CLI (agy).",
  grok: "Uses your SuperGrok or X subscription through xAI's Grok Build CLI.",
  openai: "Pay per use with your OpenAI API key.",
  anthropic: "Pay per use with your Anthropic API key.",
  google: "Pay per use with your Gemini API key from Google AI Studio.",
  xai: "Grok models with your xAI API key.",
  mistral: "Mistral models with your Mistral API key.",
  deepseek: "DeepSeek models with your DeepSeek API key.",
  groq: "Very fast open models with your Groq API key.",
  openrouter: "Hundreds of models from one OpenRouter key.",
};
