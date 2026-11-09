import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { createEmptyProfile, createTestProfile, launchDemo, launchEmptyProfile } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

/** An empty profile as a new install would have it: the welcome still to show. */
async function createNewInstallProfile(): Promise<string> {
  const profile = await createEmptyProfile();
  const file = path.join(profile, "settings.json");
  const settings = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...settings, general: { onboarded: false } }));
  return profile;
}

function onboarded(page: Page) {
  return page.evaluate(async () => {
    const settings = await (globalThis as AppGlobal).dayboard.ipc.invoke<{
      general: { onboarded: boolean };
    }>("settings:get");
    return settings.general.onboarded;
  });
}

async function useTheme(app: ElectronApplication, page: Page, theme: "light" | "dark") {
  await app.evaluate(({ nativeTheme }, scheme) => (nativeTheme.themeSource = scheme), theme);
  await page.emulateMedia({ colorScheme: theme });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1200, 800),
  );
}

/**
 * What a fresh Mac with Claude Code installed reports, so every run sees the same steps: test
 * builds carry no license service (a release build starts in the trial), CI has no Google client
 * or Reminders access, and which AI tools are installed depends on the machine.
 */
async function standInFreshMac(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("license:refresh");
    ipcMain.handle("license:refresh", () => ({
      status: { state: "trial", daysLeft: 14 },
      checkoutUrl: "",
    }));
    ipcMain.removeHandler("accounts:getStatus");
    ipcMain.handle("accounts:getStatus", () => ({
      google: { hasCredentials: true, connected: false, email: null, clientIdHint: null },
      reminders: "not-determined",
    }));
    ipcMain.removeHandler("ai:providerStatus");
    ipcMain.handle("ai:providerStatus", (_event, payload: { provider: string }) =>
      payload.provider === "claude"
        ? { ok: true, version: "2.1.0" }
        : { ok: false, reason: "missing", message: "This tool isn’t installed on this Mac." },
    );
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: a new install walks through the welcome once`, async ({
    playwright: _playwright,
  }, testInfo) => {
    const profile = await createNewInstallProfile();
    const first = await launchEmptyProfile(profile);
    const shot = (name: string) =>
      first.page.screenshot({
        path: testInfo.outputPath(`onboarding-${theme}-${name}.png`),
        animations: "disabled",
      });
    try {
      const page = first.page;
      await standInFreshMac(first.app);
      await useTheme(first.app, page, theme);

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Welcome to DayBoard" })).toBeVisible();
      await expect(dialog).toContainText("There’s no DayBoard account to create.");
      // Nothing is focused with a ring on launch; Tab still moves into the dialog.
      await expect(dialog).toBeFocused();
      await shot("1-welcome");

      await dialog.getByRole("button", { name: "Get started" }).click();
      await expect(dialog.getByRole("heading", { name: "Connect your accounts" })).toBeVisible();
      await expect(dialog.getByText("Google", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Apple Reminders", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Allow Access" })).toBeVisible();
      await shot("2-connect");

      await dialog.getByRole("button", { name: "Continue" }).click();
      await expect(dialog.getByRole("heading", { name: "Set up AI (optional)" })).toBeVisible();
      const providers = dialog.getByRole("radiogroup", { name: "AI provider" });
      await expect(providers.getByRole("radio")).toHaveCount(4);
      await expect(dialog).toContainText("Your AI trial has 14 days left");
      await expect(dialog).toContainText("Everything else in DayBoard stays free.");
      await expect(dialog).not.toContainText("$");
      // Nothing chosen: the step can be passed by without turning AI on.
      await expect(dialog.getByRole("button", { name: "Turn on AI" })).toHaveCount(0);
      // A tool that isn't installed can't be turned on; its row says why.
      await providers.getByRole("radio", { name: /ChatGPT/ }).click();
      await expect(dialog.getByRole("button", { name: "Turn on AI" })).toBeDisabled();
      await expect(dialog).toContainText("This tool isn’t installed on this Mac.");
      await providers.getByRole("radio", { name: /Claude/ }).click();
      await expect(dialog.getByRole("button", { name: "Turn on AI" })).toBeEnabled();
      await shot("3-ai");
      await dialog.getByRole("button", { name: "Not now" }).click();

      await expect(dialog.getByRole("heading", { name: "You’re all set" })).toBeVisible();
      await expect(dialog).toContainText("Search and jump anywhere");
      await expect(dialog).toContainText("Help → Send Feedback");
      await expect(
        dialog.getByRole("switch", { name: "Open DayBoard when you log in" }),
      ).toBeVisible();
      await shot("4-done");

      // Back returns through the steps without saving anything.
      await dialog.getByRole("button", { name: "Back", exact: true }).click();
      await expect(dialog.getByRole("heading", { name: "Set up AI (optional)" })).toBeVisible();
      await dialog.getByRole("button", { name: "Continue" }).click();

      expect(await onboarded(page)).toBe(false);
      await dialog.getByRole("button", { name: "Start using DayBoard" }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => onboarded(page)).toBe(true);
      // "Not now" left AI off.
      expect(
        await page.evaluate(() =>
          (globalThis as AppGlobal).dayboard.ipc.invoke<{ ai: { enabled: boolean } }>(
            "settings:get",
          ),
        ),
      ).toMatchObject({ ai: { enabled: false } });
      expect(first.errors).toEqual([]);
    } finally {
      await first.close(false);
    }

    const second = await launchEmptyProfile(profile);
    try {
      await expect(second.page.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
      await expect(second.page.getByRole("dialog")).toHaveCount(0);
      expect(second.errors).toEqual([]);
    } finally {
      await second.close();
    }
  });
}

test("Turn on AI saves the chosen provider and moves on", async () => {
  const app = await launchEmptyProfile(await createNewInstallProfile());
  try {
    const page = app.page;
    await standInFreshMac(app.app);
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Get started" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog
      .getByRole("radiogroup", { name: "AI provider" })
      .getByRole("radio", { name: /Claude/ })
      .click();
    await dialog.getByRole("button", { name: "Turn on AI" }).click();
    await expect(dialog.getByRole("heading", { name: "You’re all set" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (globalThis as AppGlobal).dayboard.ipc.invoke<{
            ai: { enabled: boolean; provider: string; providerChosen: boolean };
          }>("settings:get"),
        ),
      )
      .toMatchObject({ ai: { enabled: true, provider: "claude", providerChosen: true } });

    // Back on the AI step, the provider in use is already chosen and nothing needs saving.
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(
      dialog
        .getByRole("radiogroup", { name: "AI provider" })
        .getByRole("radio", { name: /Claude/ }),
    ).toBeChecked();
    await expect(dialog.getByRole("button", { name: "Turn on AI" })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Start using DayBoard" }).click();
    await expect(dialog).toHaveCount(0);
    expect(app.errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test("Skip setup and Escape both finish the welcome; existing settings never show it", async () => {
  const skipped = await launchEmptyProfile(await createNewInstallProfile());
  try {
    const dialog = skipped.page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Welcome to DayBoard" })).toBeVisible();
    await dialog.getByRole("button", { name: "Skip setup" }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => onboarded(skipped.page)).toBe(true);
    expect(skipped.errors).toEqual([]);
  } finally {
    await skipped.close();
  }

  const escaped = await launchEmptyProfile(await createNewInstallProfile());
  try {
    const dialog = escaped.page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Welcome to DayBoard" })).toBeVisible();
    await escaped.page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => onboarded(escaped.page)).toBe(true);
    expect(escaped.errors).toEqual([]);
  } finally {
    await escaped.close();
  }

  // A settings file saved before the welcome existed (no `general.onboarded`) counts as done.
  const existing = await launchEmptyProfile();
  try {
    await expect(existing.page.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
    await expect(existing.page.getByRole("dialog")).toHaveCount(0);
    expect(await onboarded(existing.page)).toBe(true);
  } finally {
    await existing.close();
  }
});

test("demo mode opens on the dashboard; Help → Welcome to DayBoard… shows the welcome", async () => {
  const demo = await launchDemo(await createTestProfile());
  try {
    const page = demo.page;
    await expect(page.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await demo.app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById("welcome")?.click(),
    );
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Welcome to DayBoard" })).toBeVisible();
    await dialog.getByRole("button", { name: "Get started" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog).toContainText("Demo mode uses sample AI responses.");
    await dialog.getByRole("button", { name: "Skip setup" }).click();
    await expect(dialog).toHaveCount(0);

    // It opens again each time it's asked for, from the first step.
    await demo.app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById("welcome")?.click(),
    );
    await expect(dialog.getByRole("heading", { name: "Welcome to DayBoard" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
