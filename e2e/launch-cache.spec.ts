import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import { createEmptyProfile, launchEmptyProfile, waitForWindowReady } from "./fixtures";

const CACHE_KEY = "dayboard.launchCache.v1";
const TASK = "Send the quarterly numbers";

type TasksMode = "ok" | "hang" | "fail";

/**
 * A test profile has no Google account, so this stands in for one in the main process: the
 * account the renderer sees, and what a Google Tasks listing returns. Nothing leaves the machine.
 */
async function fakeGoogle(app: ElectronApplication, email: string | null, tasks: TasksMode) {
  await app.evaluate(
    ({ ipcMain }, { email, tasks, title }) => {
      const status = {
        google: {
          hasCredentials: true,
          connected: email !== null,
          email,
          clientIdHint: null,
          missingAccess: [],
        },
        gmail: { connected: false, email: null, rejected: false },
        reminders: "denied",
        calendar: "denied",
      };
      ipcMain.removeHandler("accounts:getStatus");
      ipcMain.handle("accounts:getStatus", () => status);
      ipcMain.removeHandler("tasks:list");
      ipcMain.handle("tasks:list", () => {
        if (tasks === "hang") return new Promise(() => {});
        if (tasks === "fail") throw new Error("Google Tasks could not be reached.");
        const due = new Date().toLocaleDateString("en-CA");
        return {
          state: "ok",
          items: [
            {
              id: "t1",
              listId: "l1",
              listTitle: "Work",
              title,
              notes: null,
              due,
              completed: false,
              completedAt: null,
            },
          ],
        };
      });
    },
    { email, tasks, title: TASK },
  );
}

async function relaunchRenderer(page: Page) {
  await page.reload();
  await waitForWindowReady(page);
}

function storedCache(page: Page) {
  return page.evaluate((key) => globalThis.localStorage.getItem(key), CACHE_KEY);
}

async function profileWithTasksOn(): Promise<string> {
  const profile = await createEmptyProfile();
  await writeFile(
    path.join(profile, "settings.json"),
    JSON.stringify({
      sources: {
        tasks: { enabled: true },
        reminders: { enabled: false },
        mail: { enabled: false },
        calendar: { enabled: false },
      },
      ai: { enabled: false, providerChosen: false },
      mcpServer: { enabled: false, allowWrites: false },
    }),
  );
  return profile;
}

test("a relaunch shows the last dashboard at once, marked as saved, then refreshes", async ({
  playwright: _playwright,
}, testInfo) => {
  const launched = await launchEmptyProfile(await profileWithTasksOn());
  const { app, page } = launched;
  try {
    await fakeGoogle(app, "tester@example.com", "ok");
    await relaunchRenderer(page);
    await expect(page.getByText(TASK).first()).toBeVisible();
    // The listing is saved a moment after it loads, for this account only.
    await expect.poll(() => storedCache(page)).toContain(TASK);
    const saved = JSON.parse((await storedCache(page)) as string);
    expect(saved.owner).toBe("google:tester@example.com|gmail:");
    expect(Object.keys(saved.sources)).toEqual(["tasks"]);
    expect(await storedCache(page)).not.toMatch(/token|secret|password/i);

    // Google is slow this time: the saved listing shows while the refresh runs.
    await fakeGoogle(app, "tester@example.com", "hang");
    await relaunchRenderer(page);
    const notice = page.getByRole("status").filter({ hasText: "Showing what DayBoard had at" });
    await expect(page.getByText(TASK).first()).toBeVisible();
    await expect(notice).toContainText("Refreshing");
    await page.screenshot({ path: testInfo.outputPath("saved-copy-refreshing.png") });

    // Google fails: the saved listing stays, and says so.
    await fakeGoogle(app, "tester@example.com", "fail");
    await relaunchRenderer(page);
    await expect(notice).toContainText("Couldn’t refresh");
    await expect(page.getByText(TASK).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("saved-copy-failed.png") });

    // Retry succeeds: the notice goes away and fresh data replaces the saved copy.
    await fakeGoogle(app, "tester@example.com", "ok");
    await notice.getByRole("button", { name: "Retry" }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByText(TASK).first()).toBeVisible();

    // Another account never sees this account's saved dashboard, and the copy is dropped.
    await fakeGoogle(app, "someone-else@example.com", "hang");
    await relaunchRenderer(page);
    await expect(page.getByText(TASK)).toHaveCount(0);
    await expect(notice).toHaveCount(0);
    await expect.poll(() => storedCache(page)).toBeNull();
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});

test("signing out drops the saved dashboard", async () => {
  const launched = await launchEmptyProfile(await profileWithTasksOn());
  const { app, page } = launched;
  try {
    await fakeGoogle(app, "tester@example.com", "ok");
    await relaunchRenderer(page);
    await expect.poll(() => storedCache(page)).toContain(TASK);

    await fakeGoogle(app, null, "hang");
    await relaunchRenderer(page);
    await expect(page.getByText(TASK)).toHaveCount(0);
    await expect.poll(() => storedCache(page)).toBeNull();
    expect(launched.errors).toEqual([]);
  } finally {
    await launched.close();
  }
});
