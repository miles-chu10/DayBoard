import type { AIProvider } from "../../main/shared-types";
import { aiMayReceiveGoogleData } from "../../shared/ai-google-data";
import { isRendererDemoMode } from "./demo";

/**
 * Whether this window may send Google Calendar and Google Tasks items to the AI provider. Demo
 * mode's sample items never come from Google, so the rule doesn't hold them back there.
 */
export function mayShareGoogleData(provider: AIProvider | "" | undefined | null): boolean {
  return isRendererDemoMode() || aiMayReceiveGoogleData(provider);
}
