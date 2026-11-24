import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { displayVersion } from "../shared/release-notes";
import { createEmptyProfile, launchDemo, launchEmptyProfile, packageVersion } from "./fixtures";

const title = `What’s New in DayBoard ${displayVersion(packageVersion())}`;

test("What's New opens once after an update, and again from Help", async ({
  playwright: _playwright,
}, testInfo) => {
  const profile = await createEmptyProfile();
  // No record but a finished welcome: an install from before What's New existed, just updated.
  await rm(path.join(profile, "whats-new.json"));

  const first = await launchEmptyProfile(profile);
  try {
    const dialog = first.page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    // The notes ship with the build, so they show without a network.
    await expect(dialog.getByRole("heading", { name: "New features" })).toBeVisible();
    // Nothing is focused with a ring on launch; the dialog itself has focus.
    await expect(dialog).toBeFocused();
    await first.page.waitForTimeout(500);
    await first.page.screenshot({ path: testInfo.outputPath("whats-new-light.png") });
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => JSON.parse(await readFile(path.join(profile, "whats-new.json"), "utf8")))
      .toEqual({ seenVersion: packageVersion() });
    expect(first.errors).toEqual([]);
  } finally {
    await first.close(false);
  }

  const second = await launchEmptyProfile(profile);
  try {
    const page = second.page;
    await expect(page.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await second.app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById("whats-new")?.click(),
    );
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    await second.app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = "dark";
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath("whats-new-dark.png") });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    expect(second.errors).toEqual([]);
  } finally {
    await second.close();
  }
});

test("demo mode never opens What's New on its own, but Help and Settings still show it", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await expect(page.getByRole("button", { name: /^Agenda\b/ }).first()).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await demo.app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById("whats-new")?.click(),
    );
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog).toHaveCount(0);

    // Settings > Updates opens it in the main window too.
    await page.evaluate(() =>
      (
        globalThis as unknown as {
          dayboard: { ipc: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } };
        }
      ).dayboard.ipc.invoke("window:openSettings", { tab: "updates" }),
    );
    await expect
      .poll(() => demo.app.windows().find((window) => /settings-window/.test(window.url())))
      .not.toBeUndefined();
    const settings = demo.app.windows().find((window) => /settings-window/.test(window.url()))!;
    const button = settings.getByRole("button", { name: "What’s New", exact: true });
    await expect(button).toBeVisible();
    await settings.waitForTimeout(300);
    await settings.screenshot({ path: testInfo.outputPath("settings-updates.png") });
    await button.click();
    await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
