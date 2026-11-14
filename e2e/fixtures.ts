import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareIsolatedProfile,
  resolveProfileOverride,
  type IsolatedProfileMode,
} from "../main/platform/isolated-profile.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface DemoApp {
  app: ElectronApplication;
  page: Page;
  profile: string;
  errors: string[];
  close: (removeProfile?: boolean) => Promise<void>;
}

/** The variables a launched Electron needs from this shell, including Linux's X display. */
export function launchEnvironment(): Record<string, string> {
  return Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "DISPLAY", "XAUTHORITY"]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key] as string]),
  );
}

export async function createTestProfile(mode: IsolatedProfileMode = "demo"): Promise<string> {
  const profile = prepareIsolatedProfile(
    await mkdtemp(path.join(tmpdir(), `dayboard-${mode}-e2e-`)),
    mode,
  );
  // Most specs drive details as a pop-up; a spec that tests another presentation (the default
  // is the side panel) writes its own settings over this.
  if (mode === "demo")
    await writeFile(
      path.join(profile, "demo-settings.json"),
      JSON.stringify({ general: { detailView: "dialog" } }),
    );
  return profile;
}

/**
 * Waits until the main window's root view has mounted. The window's shortcuts are attached in
 * effects once it has, so on a slow runner a key sent before that goes nowhere: wait for the mount
 * and one more frame. Call it again after a reload.
 */
export async function waitForWindowReady(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.locator("[data-window-content]").waitFor({ state: "attached", timeout: 30_000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const view = globalThis as unknown as {
          requestAnimationFrame(callback: () => void): void;
          setTimeout(callback: () => void, delay: number): void;
        };
        view.requestAnimationFrame(() => view.setTimeout(resolve, 0));
      }),
  );
}

async function launchIsolated(profile?: string, demoMode = true): Promise<DemoApp> {
  const requested = profile ?? (await createTestProfile(demoMode ? "demo" : "test"));
  const userData = resolveProfileOverride(requested, [
    path.join(homedir(), "Library", "Application Support", "DayBoard"),
  ]);
  prepareIsolatedProfile(userData, demoMode ? "demo" : "test");
  const errors: string[] = [];
  const environment = launchEnvironment();
  const packaged = process.env.DAYBOARD_E2E_EXECUTABLE;
  const app = await electron.launch({
    ...(packaged ? { executablePath: packaged, args: [] } : { args: [root] }),
    env: {
      ...environment,
      DAYBOARD_USER_DATA: userData,
      DAYBOARD_TEST: "1",
      ...(demoMode ? { DAYBOARD_DEMO: "1" } : {}),
    },
    timeout: 30_000,
  });
  app.on("window", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  try {
    const actual = await app.evaluate(({ app }) => ({
      userData: app.getPath("userData"),
      sessionData: app.getPath("sessionData"),
    }));
    if (
      resolveProfileOverride(actual.userData) !== userData ||
      resolveProfileOverride(actual.sessionData) !== userData
    ) {
      throw new Error("The launched app did not use the isolated test profile.");
    }
  } catch (error) {
    await app.close();
    throw error;
  }
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await waitForWindowReady(page);
  return {
    app,
    page,
    profile: userData,
    errors,
    async close(removeProfile = true) {
      await app.close();
      if (removeProfile) await rm(userData, { recursive: true, force: true });
    },
  };
}

export function launchDemo(profile?: string): Promise<DemoApp> {
  return launchIsolated(profile);
}

export async function createEmptyProfile(
  mcpServer = { enabled: false, allowWrites: false },
): Promise<string> {
  const profile = await createTestProfile("test");
  // A fresh profile alone does not isolate the system's EventKit account. Disable all
  // integrations before boot so this non-demo test can never fetch personal source data.
  await writeFile(
    path.join(profile, "settings.json"),
    JSON.stringify({
      sources: Object.fromEntries(
        ["tasks", "reminders", "mail", "calendar"].map((source) => [source, { enabled: false }]),
      ),
      ai: { enabled: false, providerChosen: false },
      mcpServer,
    }),
  );
  return profile;
}

export async function launchEmptyProfile(profile?: string): Promise<DemoApp> {
  return launchIsolated(profile ?? (await createEmptyProfile()), false);
}
