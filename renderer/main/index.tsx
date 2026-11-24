import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router, queryClient } from "./router";
import "../styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { Text, TooltipProvider, Toaster } from "@renderer/ui";
import { applyCachedAppearance } from "../lib/appearance";
import { initializeDemoMode } from "../lib/demo";
import { invoke } from "../lib/ipc";
import { hydrateLaunchCache, startLaunchCacheWriter } from "../lib/launch-cache";
import { queryKeys } from "../lib/queries";
import type { AccountsStatus } from "@main/shared-types";
import { UpdateBoundary } from "../components/update-boundary";

declare const __APP_DISPLAY_NAME__: string | undefined;

document.title = __APP_DISPLAY_NAME__ || document.title;

// Get the root element
const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = ReactDOM.createRoot(rootElement);
try {
  // Fail closed if the backend cannot determine the mode: no cached real data may render first.
  const demo = await initializeDemoMode();
  applyCachedAppearance();
  // Demo data is already instant and must never mix with a real account's saved copy.
  if (!demo) await restoreLastDashboard();
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <UpdateBoundary>
            <RouterProvider router={router} />
          </UpdateBoundary>
        </TooltipProvider>
        <Toaster />
      </QueryClientProvider>
    </React.StrictMode>,
  );
} catch {
  root.render(
    <main className="h-full grid place-items-center p-8 text-center">
      <div>
        <Text as="h1" variant="heading2">
          DayBoard couldn’t start safely
        </Text>
        <Text as="p" variant="regular" color="secondary" className="mt-2">
          Quit DayBoard and reopen it to try again.
        </Text>
      </div>
    </main>,
  );
}

/**
 * Shows the last session's dashboard at once when it belongs to the account signed in now. The
 * account check is bounded: if it is slow, DayBoard starts empty and loads as it always did.
 */
async function restoreLastDashboard(): Promise<void> {
  try {
    const accounts = await Promise.race([
      invoke<AccountsStatus>("accounts:getStatus"),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500)),
    ]);
    if (accounts) {
      queryClient.setQueryData(queryKeys.accounts, accounts);
      hydrateLaunchCache(queryClient, accounts);
    }
  } catch {
    // Without a known account nothing saved is shown.
  }
  startLaunchCacheWriter(queryClient, queryKeys.accounts);
}

// Hot Module Replacement (HMR) support
if (import.meta.hot) {
  import.meta.hot.accept();
}
