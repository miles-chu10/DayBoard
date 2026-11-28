import type { AIProvider } from "../../main/shared-types";
import { aiMayReceiveGoogleData } from "../../shared/ai-google-data";
import { isRendererDemoMode } from "./demo";

/**
 * Whether to include Calendar and Tasks items in the local AI context. Demo fixtures may
 * appear regardless of provider because the backend keeps demo requests on this Mac.
 */
export function mayShareGoogleData(provider: AIProvider | "" | undefined | null): boolean {
  return isRendererDemoMode() || aiMayReceiveGoogleData(provider);
}
