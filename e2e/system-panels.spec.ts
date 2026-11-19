import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { DayboardBridge } from "../shared/bridge-protocol";
import { createTestProfile, launchDemo } from "./fixtures";

type AppGlobal = typeof globalThis & { dayboard: DayboardBridge };

async function openQuickCapture(app: ElectronApplication): Promise<Page> {
  // The main window's first show takes focus, which would immediately hide a panel opened earlier.
  await expect
    .poll(
      () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (window) =>
              window.webContents.getURL().includes("main-window.html") && window.isVisible(),
          ),
        ),
      // Cold native startup can exceed the assertion default on a busy developer Mac.
      { timeout: 15_000 },
    )
    .toBe(true);
  const opened = app.waitForEvent("window", (page) => page.url().endsWith("#capture"));
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById("quick-capture")?.click(),
  );
  const panel = await opened;
  await expect.poll(() => panelVisible(app, "#capture")).toBe(true);
  return panel;
}

async function panelVisible(app: ElectronApplication, hash: string): Promise<boolean> {
  return app.evaluate(
    ({ BrowserWindow }, hash) =>
      BrowserWindow.getAllWindows().some(
        (window) => window.webContents.getURL().endsWith(hash) && window.isVisible(),
      ),
    hash,
  );
}

test("File → Quick Capture opens the capture panel with its input focused", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    const input = panel.getByRole("textbox", { name: "Quick Capture" });
    await expect(input).toBeFocused();
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Escape hides the capture panel", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    await panel.getByRole("textbox", { name: "Quick Capture" }).press("Escape");
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
  } finally {
    await demo.close();
  }
});

test("Escape that cancels an IME composition leaves the panel open", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    await panel.getByRole("textbox", { name: "Quick Capture" }).evaluate((node) => {
      const { KeyboardEvent } = globalThis as unknown as {
        KeyboardEvent: new (type: string, init: Record<string, unknown>) => unknown;
      };
      (node as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await panel.waitForTimeout(300);
    expect(await panelVisible(demo.app, "#capture")).toBe(true);
    await panel.keyboard.press("Escape");
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
  } finally {
    await demo.close();
  }
});

test("the capture panel cannot call unlisted channels", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    const message = await panel.evaluate(() => {
      const { dayboard } = globalThis as unknown as {
        dayboard: {
          ipc: {
            invoke(channel: string, ...args: unknown[]): Promise<unknown>;
          };
        };
      };
      return dayboard.ipc.invoke("settings:update", {}).then(
        () => "allowed",
        (error: Error) => error.message,
      );
    });
    expect(message).toBe("This DayBoard window can't use settings:update.");
  } finally {
    await demo.close();
  }
});

test("Dock activation shows the main window while a panel is open", async () => {
  const demo = await launchDemo();
  try {
    await openQuickCapture(demo.app);
    await demo.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes("main-window.html"))
        ?.hide();
    });
    await demo.app.evaluate(({ app }) => app.emit("activate", {}, true));
    await expect
      .poll(() =>
        demo.app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (window) =>
              window.webContents.getURL().includes("main-window.html") && window.isVisible(),
          ),
        ),
      )
      .toBe(true);
  } finally {
    await demo.close();
  }
});

test("submitting in demo mode shows the demo refusal in the panel", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    const input = panel.getByRole("textbox", { name: "Quick Capture" });
    await input.fill("Call dentist Thursday 3pm");
    await input.press("Enter");
    await expect(panel.getByText("Couldn’t add “Call dentist Thursday 3pm”.")).toBeVisible();
    await expect(panel.getByText(/turned off in demo mode/)).toBeVisible();
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    await expect(input).toHaveValue("");
  } finally {
    await demo.close();
  }
});

async function reopenQuickCapture(app: ElectronApplication) {
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById("quick-capture")?.click(),
  );
  await expect.poll(() => panelVisible(app, "#capture")).toBe(true);
}

test("the first keystrokes after each reopen reach the capture input", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    const input = panel.getByRole("textbox", { name: "Quick Capture" });
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    // The first show can land before the input has mounted on a slow runner; a key sent in that
    // gap goes nowhere. The later reopens type at once, with the input already mounted.
    await expect(input).toBeFocused();
    await panel.keyboard.type("a");
    await expect(input).toHaveValue("a");

    await panel.keyboard.press("Escape");
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
    await reopenQuickCapture(demo.app);
    await panel.keyboard.type("b");
    await expect(input).toHaveValue("ab");

    // Click-away: another DayBoard window takes focus after the show grace period
    // (SHOW_GRACE_MS, 300 ms, in main/system-panels/panel-window.ts).
    await panel.waitForTimeout(400);
    await demo.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes("main-window.html"))
        ?.focus(),
    );
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
    await reopenQuickCapture(demo.app);
    await panel.keyboard.type("c");
    await expect(input).toHaveValue("abc");

    // A rejected submit hides the panel and shows it again with the refusal.
    await panel.keyboard.press("Enter");
    await expect(panel.getByText(/turned off in demo mode/)).toBeVisible();
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    await panel.keyboard.type("d");
    await expect(input).toHaveValue("d");
  } finally {
    await demo.close();
  }
});

async function openMenuBarAgenda(app: ElectronApplication): Promise<Page> {
  await expect
    .poll(
      () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (window) =>
              window.webContents.getURL().includes("main-window.html") && window.isVisible(),
          ),
        ),
      // Cold native startup can exceed the assertion default on a busy developer Mac.
      { timeout: 15_000 },
    )
    .toBe(true);
  const opened = app.waitForEvent("window", (page) => page.url().endsWith("#menubar"));
  await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById("menubar-agenda")?.click(),
  );
  return opened;
}

test("File → Menu Bar Agenda shows today's panel", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await expect(panel.getByRole("radio", { name: "Day" })).toBeChecked();
    await expect(panel.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(panel.getByRole("region", { name: "Today's items" })).toBeVisible();
    await expect.poll(() => panelVisible(demo.app, "#menubar")).toBe(true);

    // Overdue to-dos fold into one row, like Home, and the panel remembers when it's open.
    const overdue = panel
      .getByRole("region", { name: "Overdue items" })
      .getByRole("button", { name: "3 overdue tasks" });
    const lateTask = panel.getByText("Send Q4 budget to finance", { exact: true });
    await expect(overdue).toHaveAttribute("aria-expanded", "false");
    await expect(lateTask).toBeHidden();
    await panel.screenshot({ path: testInfo.outputPath("menubar-overdue-collapsed.png") });
    await overdue.click();
    await expect(overdue).toHaveAttribute("aria-expanded", "true");
    await expect(lateTask).toBeVisible();
    await panel.waitForTimeout(250);
    await panel.screenshot({ path: testInfo.outputPath("menubar-overdue-open.png") });
    await panel.reload();
    await expect(
      panel.getByRole("region", { name: "Overdue items" }).getByRole("button", {
        name: "3 overdue tasks",
      }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByText("Send Q4 budget to finance", { exact: true })).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("the menu-bar panel lists the mail waiting on you and opens it in place", async () => {
  const demo = await launchDemo();
  try {
    // Home triages the demo inbox; the panel reads the same saved triage.
    await expect(
      demo.page
        .getByRole("region", { name: "Needs you" })
        .getByRole("button", { name: /^Sam Patel: Lunch today\?/ }),
    ).toBeVisible();
    const panel = await openMenuBarAgenda(demo.app);
    await hideMainWindow(demo.app);
    const waiting = panel.getByRole("region", { name: "Waiting on you" });
    // The same two emails as Home's Needs you: Sam's question and Priya's decision request.
    await expect(waiting.getByRole("heading", { name: "Waiting on you · 2" })).toBeVisible();
    const sam = waiting.getByRole("button", {
      name: /Sam Patel · Lunch today\?/,
    });
    await expect(sam).toBeVisible();
    await expect(
      waiting.getByRole("button", {
        name: /^Priya Shah · Launch announcement/,
      }),
    ).toBeVisible();
    await expect(waiting.getByRole("button")).toHaveCount(2);
    // The row opens where it is: the panel stays and the main window stays hidden.
    await sam.click();
    await expect(sam).toHaveAttribute("aria-expanded", "true");
    await expect(waiting.getByText("Still good for 12:30?", { exact: false })).toBeVisible();
    expect(await panelVisible(demo.app, "#menubar")).toBe(true);
    expect(await mainWindowVisible(demo.app)).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("mail notifications and the Dock badge are set from Mail settings", async () => {
  const demo = await launchDemo();
  try {
    await demo.page.evaluate(() =>
      (globalThis as AppGlobal).dayboard.ipc.invoke("window:openSettings"),
    );
    await expect
      .poll(() => demo.app.windows().find((window) => /settings-window/.test(window.url())))
      .not.toBeUndefined();
    const settings = demo.app.windows().find((window) => /settings-window/.test(window.url()))!;
    await settings.waitForLoadState("domcontentloaded");
    await settings.getByRole("tab", { name: "General", exact: true }).click();
    const notify = settings.getByRole("combobox", {
      name: "Mail notifications",
    });
    const badge = settings.getByRole("combobox", { name: "Dock badge" });
    await expect(notify).toContainText("Off");
    await expect(badge).toContainText("Waiting on you");
    await notify.click();
    await settings.getByRole("option", { name: "Snoozes and follow-ups" }).click();
    await expect(notify).toContainText("Snoozes and follow-ups");
    await expect
      .poll(() =>
        demo.page.evaluate(async () => {
          const value = (await (globalThis as AppGlobal).dayboard.ipc.invoke("settings:get")) as {
            system: { mailNotifications: string };
          };
          return value.system.mailNotifications;
        }),
      )
      .toBe("reminders");
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

type KeyProbe = {
  addEventListener(
    type: "keydown",
    listener: (event: { key: string }) => void,
    capture: boolean,
  ): void;
  document: { hasFocus(): boolean };
  __escapeProbe?: { key: string; documentFocused: boolean }[];
};

/** Where key focus is: the panel's native window and its document. */
async function panelFocus(app: ElectronApplication, panel: Page, hash: string) {
  const window = await app.evaluate(
    ({ BrowserWindow }, hash) =>
      BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().endsWith(hash))
        ?.isFocused() ?? false,
    hash,
  );
  const document = await panel.evaluate(() =>
    (globalThis as unknown as KeyProbe).document.hasFocus(),
  );
  return { window, document };
}

/** Records keydowns that reach the page, ahead of the app's own handlers. */
function recordKeys(panel: Page) {
  return panel.evaluate(() => {
    const page = globalThis as unknown as KeyProbe;
    page.__escapeProbe = [];
    page.addEventListener(
      "keydown",
      (event) =>
        page.__escapeProbe?.push({
          key: event.key,
          documentFocused: page.document.hasFocus(),
        }),
      true,
    );
  });
}

test("Escape hides a freshly shown menu-bar panel", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await expect(panel.getByRole("region", { name: "Today's items" })).toBeVisible();
    await expect.poll(() => panelVisible(demo.app, "#menubar")).toBe(true);
    await recordKeys(panel);
    const focusWhenShown = await panelFocus(demo.app, panel, "#menubar");
    test.info().annotations.push({
      type: "escape-focus",
      description: JSON.stringify(focusWhenShown),
    });
    // macOS can make another window key just after the panel shows (see panel-window.ts); a
    // person presses Escape on a panel that has key focus, so wait to observe it, never force it.
    await expect
      .poll(() => panelFocus(demo.app, panel, "#menubar"))
      .toEqual({ window: true, document: true });
    await panel.keyboard.press("Escape");
    // Separates a key that never reached the page from a hide that never happened.
    await expect
      .poll(() => panel.evaluate(() => (globalThis as unknown as KeyProbe).__escapeProbe ?? []))
      .toEqual([expect.objectContaining({ key: "Escape" })]);
    await expect.poll(() => panelVisible(demo.app, "#menubar")).toBe(false);
  } finally {
    await demo.close();
  }
});

// DayBoard Design System (v21, render 1791573676-ee86; live 1792522028-b5ac): popovers stay
// solid, placeholders end in an ellipsis, rows show their full title on hover and line up their
// times, failures with a way forward are red, labels are sentence case.
type DomGlobal = {
  document: { documentElement: unknown; activeElement: unknown };
  getComputedStyle(node: unknown): {
    backgroundColor: string;
    color: string;
    fontVariantNumeric: string;
    outlineOffset: string;
    outlineWidth: string;
    outlineStyle: string;
  };
};

test("the panels follow the design system's ground, input, row and copy rules", async () => {
  const demo = await launchDemo();
  try {
    const capture = await openQuickCapture(demo.app);
    const opaque = (page: Page) =>
      page.evaluate(() => {
        const dom = globalThis as unknown as DomGlobal;
        return dom.getComputedStyle(dom.document.documentElement).backgroundColor;
      });
    expect(await opaque(capture)).toMatch(/^rgb\(/);
    const input = capture.getByRole("textbox", { name: "Quick Capture" });
    await expect(input).toHaveAttribute("placeholder", /…$/);
    await input.fill("Call dentist Thursday 3pm");
    await input.press("Enter");
    const failure = capture.getByText(/turned off in demo mode/);
    await expect(failure).toBeVisible();
    expect(
      await failure.evaluate((node) => node.closest("[class*='bg-support-']")?.className ?? ""),
    ).toContain("bg-support-red-10");
    await capture.keyboard.press("Escape");

    const menubar = await openMenuBarAgenda(demo.app);
    expect(await opaque(menubar)).toMatch(/^rgb\(/);
    await expect(menubar.getByRole("textbox", { name: "Add, ask or search" })).toHaveAttribute(
      "placeholder",
      /^.{1,32}…$/,
    );
    const today = menubar.getByRole("region", { name: "Today's items" });
    const row = today.getByRole("button").first();
    const title = row.locator("span").first();
    await expect(title).toHaveAttribute("title", (await title.textContent()) ?? "");
    // The time column lines up down the day.
    expect(
      await today
        .locator("li > div > span")
        .first()
        .evaluate(
          (node) => (globalThis as unknown as DomGlobal).getComputedStyle(node).fontVariantNumeric,
        ),
    ).toContain("tabular-nums");

    // Rows take an inset 2px keyboard ring, like the app's other list rows (ListRow).
    for (let step = 0; step < 30; step += 1) {
      if (
        await row.evaluate(
          (node) => node === (globalThis as unknown as DomGlobal).document.activeElement,
        )
      )
        break;
      await menubar.keyboard.press("Tab");
    }
    // With Reduce Motion on, every property gets a 0.01ms transition, so a read in the same
    // frame as the focus can still see the unfocused width and offset.
    await expect
      .poll(() =>
        row.evaluate((node) => {
          const style = (globalThis as unknown as DomGlobal).getComputedStyle(node);
          return {
            offset: style.outlineOffset,
            width: style.outlineWidth,
            style: style.outlineStyle,
          };
        }),
      )
      .toEqual({ offset: "-2px", width: "2px", style: "solid" });
  } finally {
    await demo.close();
  }
});

test("nothing in the menu-bar panel opens the main window", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await hideMainWindow(demo.app);
    await expect(panel.getByRole("region", { name: "Today's items" })).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /Open DayBoard|Open Main Window|more in DayBoard/ }),
    ).toHaveCount(0);

    // An event opens where it sits, with its own fields.
    const today = panel.getByRole("region", { name: "Today's items" });
    await today.getByRole("button", { name: /^Lunch with Sam/ }).click();
    const eventEditor = panel.getByRole("group", { name: "Edit “Lunch with Sam”" });
    await expect(eventEditor.getByRole("textbox", { name: "Title" })).toHaveValue("Lunch with Sam");
    await expect(eventEditor.getByRole("button", { name: "Move to tomorrow" })).toBeVisible();
    // Esc closes the editor first and leaves the panel open.
    await panel.keyboard.press("Escape");
    await expect(eventEditor).toHaveCount(0);
    expect(await panelVisible(demo.app, "#menubar")).toBe(true);

    // So does a to-do. Demo mode never writes; the refusal proves Save reached the write.
    await today.getByRole("button", { name: /^Pick up dry cleaning/ }).click();
    const editor = panel.getByRole("group", { name: "Edit “Pick up dry cleaning”" });
    await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
    await editor.getByRole("textbox", { name: "Title" }).fill("Pick up dry cleaning today");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(panel.getByText(/Demo content is read-only/)).toBeVisible();
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Tomorrow", exact: true }).click();
    await expect(panel.getByText(/Demo content is read-only/).first()).toBeVisible();

    // The old ⌘O shortcut is gone, and the panel has no channel left that shows the main window.
    await panel.keyboard.press("Meta+o");
    const refused = await panel.evaluate(() => {
      const { dayboard } = globalThis as unknown as {
        dayboard: { ipc: { invoke(channel: string, ...args: unknown[]): Promise<unknown> } };
      };
      return dayboard.ipc.invoke("panel:openMain", { route: "/" }).then(
        () => "allowed",
        (error: Error) => error.message,
      );
    });
    expect(refused).not.toBe("allowed");
    expect(await panelVisible(demo.app, "#menubar")).toBe(true);
    expect(await mainWindowVisible(demo.app)).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

async function atTodayTime(page: Page, hours: number, minutes: number) {
  const now = new Date();
  await page.clock.install({
    time: new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes),
  });
  await page.reload();
}

test("the Up Next card shows the next demo meeting on Agenda", async () => {
  const demo = await launchDemo();
  try {
    await atTodayTime(demo.page, 9, 25);
    const card = demo.page.getByRole("region", { name: "Up next meeting" });
    await expect(card).toBeVisible();
    await expect(card.getByText("Team standup")).toBeVisible();
    await expect(card.getByText(/Starts in 5 min/)).toBeVisible();
    await expect(card.getByRole("button", { name: "Join" })).toBeVisible();
  } finally {
    await demo.close();
  }
});

test("turning off the Up Next card hides it on Agenda", async () => {
  const profile = await createTestProfile();
  await writeFile(
    path.join(profile, "demo-settings.json"),
    JSON.stringify({ system: { meetings: { upNext: false } } }),
  );
  const demo = await launchDemo(profile);
  try {
    await atTodayTime(demo.page, 9, 25);
    await expect(demo.page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(demo.page.getByRole("region", { name: "Up next meeting" })).toHaveCount(0);
  } finally {
    await demo.close();
  }
});

test("account changes clear capture failures and recovered drafts", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openQuickCapture(demo.app);
    await panel.getByRole("textbox", { name: "Quick Capture" }).fill("Private account A draft");
    await demo.app.evaluate(({ BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().endsWith("#capture"),
      );
      panel?.webContents.send("dayboard:notification", {
        channel: "capture:changed",
        params: {
          records: [
            {
              id: "old-account",
              text: "Private account A failure",
              state: "failed",
              draft: null,
              partial: { title: "Private account A failure" },
              error: "Could not save",
              createdAt: "2026-10-20T00:00:00Z",
              canUndo: false,
            },
          ],
        },
      });
    });
    await expect(panel.getByText(/Private account A failure/)).toBeVisible();
    await demo.app.evaluate(({ BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().endsWith("#capture"),
      );
      panel?.webContents.send("dayboard:notification", {
        channel: "accounts:changed",
        params: {},
      });
      panel?.webContents.send("dayboard:notification", {
        channel: "capture:changed",
        params: { records: [] },
      });
    });
    await expect(panel.getByText(/Private account A failure/)).toHaveCount(0);
    await expect(panel.getByRole("textbox", { name: "Quick Capture" })).toHaveValue("");
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

for (const surface of ["capture", "menubar"] as const) {
  test(`${surface} discards a recent-capture read that completes after an account change`, async () => {
    const demo = await launchDemo();
    try {
      await demo.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("capture:recent");
        ipcMain.handle(
          "capture:recent",
          () =>
            new Promise((resolve) => {
              (globalThis as unknown as { releaseRecent: () => void }).releaseRecent = () =>
                resolve([
                  {
                    id: "old-account",
                    text: "Private stale account A record",
                    state: "failed",
                    draft: null,
                    partial: null,
                    error: "Private failure",
                    canUndo: false,
                    createdAt: "2026-10-20T00:00:00Z",
                  },
                ]);
            }),
        );
      });
      const panel =
        surface === "capture"
          ? await openQuickCapture(demo.app)
          : await openMenuBarAgenda(demo.app);
      await expect
        .poll(() =>
          demo.app.evaluate(
            () => typeof (globalThis as unknown as { releaseRecent?: unknown }).releaseRecent,
          ),
        )
        .toBe("function");
      await demo.app.evaluate(({ BrowserWindow }, surface) => {
        const panel = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().endsWith(`#${surface}`),
        );
        panel?.webContents.send("dayboard:notification", {
          channel: "accounts:changed",
          params: {},
        });
        (globalThis as unknown as { releaseRecent: () => void }).releaseRecent();
      }, surface);
      await panel.waitForTimeout(200);
      await expect(panel.getByText(/Private stale account A/)).toHaveCount(0);
      expect(demo.errors).toEqual([]);
    } finally {
      await demo.close();
    }
  });

  test(`${surface} discards a submit rejection that completes after an account change`, async () => {
    const demo = await launchDemo();
    try {
      await demo.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler("capture:submit");
        ipcMain.handle(
          "capture:submit",
          () =>
            new Promise((_resolve, reject) => {
              (globalThis as unknown as { rejectCapture: () => void }).rejectCapture = () =>
                reject(new Error("Private old-account error"));
            }),
        );
      });
      const panel =
        surface === "capture"
          ? await openQuickCapture(demo.app)
          : await openMenuBarAgenda(demo.app);
      const input = panel.getByRole("textbox", {
        name: surface === "capture" ? "Quick Capture" : "Add, ask or search",
      });
      await input.fill("Private account A submission");
      await input.press("Enter");
      await expect
        .poll(() =>
          demo.app.evaluate(
            () => typeof (globalThis as unknown as { rejectCapture?: unknown }).rejectCapture,
          ),
        )
        .toBe("function");
      if (surface === "capture")
        await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
      await demo.app.evaluate(({ BrowserWindow }, surface) => {
        const panel = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().endsWith(`#${surface}`),
        );
        panel?.webContents.send("dayboard:notification", {
          channel: "accounts:changed",
          params: {},
        });
        (globalThis as unknown as { rejectCapture: () => void }).rejectCapture();
      }, surface);
      await panel.waitForTimeout(200);
      await expect(input).toHaveValue("");
      await expect(panel.getByText(/Private old-account error/)).toHaveCount(0);
      await expect(panel.getByText(/Private account A submission/)).toHaveCount(0);
      if (surface === "capture")
        await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
      expect(demo.errors).toEqual([]);
    } finally {
      await demo.close();
    }
  });
}

test("an account change closes a capture error already reopened by a rejection", async () => {
  const demo = await launchDemo();
  try {
    await demo.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("capture:submit");
      ipcMain.handle("capture:submit", () => {
        throw new Error("Private old-account error");
      });
    });
    const panel = await openQuickCapture(demo.app);
    const input = panel.getByRole("textbox", { name: "Quick Capture" });
    await input.fill("Private account A submission");
    await input.press("Enter");
    await expect(panel.getByText(/Private old-account error/)).toBeVisible();
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(true);
    await demo.app.evaluate(({ BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().endsWith("#capture"),
      );
      panel?.webContents.send("dayboard:notification", {
        channel: "accounts:changed",
        params: {},
      });
    });
    await expect.poll(() => panelVisible(demo.app, "#capture")).toBe(false);
    await expect(panel.getByText(/Private old-account error/)).toHaveCount(0);
    await reopenQuickCapture(demo.app);
    await expect(input).toHaveValue("");
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

for (const surface of ["agenda", "menubar"] as const) {
  for (const notesImport of [true, false]) {
    test(`${surface} post-meeting notes ${notesImport ? "remain visible" : "are hidden"} with Up Next off`, async () => {
      const profile = await createTestProfile();
      await writeFile(
        path.join(profile, "demo-settings.json"),
        JSON.stringify({
          system: { meetings: { upNext: false, notesImport } },
        }),
      );
      const demo = await launchDemo(profile);
      try {
        const page = surface === "agenda" ? demo.page : await openMenuBarAgenda(demo.app);
        await atTodayTime(page, 9, 50);
        await expect(page.getByRole("heading").first()).toBeVisible();
        await expect(page.getByRole("region", { name: "Up next meeting" })).toHaveCount(0);
        const ended = page.getByRole("region", {
          name: "Meeting that just ended",
        });
        if (notesImport) {
          await expect(ended).toBeVisible();
          await expect(ended.getByText("Team standup")).toBeVisible();
        } else {
          await expect(ended).toHaveCount(0);
        }
        expect(demo.errors).toEqual([]);
      } finally {
        await demo.close();
      }
    });
  }
}

test("manual capture waits for account availability and selects a usable destination", async () => {
  const profile = await createTestProfile();
  await writeFile(
    path.join(profile, "demo-settings.json"),
    JSON.stringify({ ai: { features: { capture: false } } }),
  );
  const demo = await launchDemo(profile);
  try {
    await demo.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("accounts:getStatus");
      ipcMain.handle(
        "accounts:getStatus",
        () =>
          new Promise((resolve) => {
            (globalThis as unknown as { releaseAccounts: () => void }).releaseAccounts = () =>
              resolve({ google: { connected: true }, reminders: "denied" });
          }),
      );
    });
    const panel = await openQuickCapture(demo.app);
    // Typing works while availability loads; Enter waits for it.
    const input = panel.getByRole("textbox", { name: "Quick Capture" });
    await input.pressSequentially("Buy milk");
    await input.press("Enter");
    await expect(input).toHaveValue("Buy milk");
    await expect
      .poll(() =>
        demo.app.evaluate(
          () => typeof (globalThis as unknown as { releaseAccounts?: unknown }).releaseAccounts,
        ),
      )
      .toBe("function");
    await demo.app.evaluate(() =>
      (globalThis as unknown as { releaseAccounts: () => void }).releaseAccounts(),
    );
    await expect(panel.getByRole("button", { name: "Add task", exact: true })).toBeEnabled();
    await expect(
      panel.getByRole("group").filter({ hasText: "Title" }).getByRole("textbox"),
    ).toHaveValue("Buy milk");
    await expect(panel.getByRole("radio", { name: "Task", exact: true })).toBeChecked();
    await expect(panel.getByRole("radio", { name: "Reminder", exact: true })).toBeDisabled();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("a notes-changed notification refreshes Agenda and Menubar together", async () => {
  const demo = await launchDemo();
  try {
    await demo.app.evaluate(({ ipcMain }) => {
      (globalThis as unknown as { notesImported: boolean }).notesImported = false;
      ipcMain.removeHandler("meetings:getNotes");
      ipcMain.handle(
        "meetings:getNotes",
        (_event, { events }: { events: { calendarId: string; eventId: string }[] }) =>
          Object.fromEntries(
            events.map((event) => [
              `${event.calendarId}/${event.eventId}`,
              {
                providerMeetingId: "synthetic-meeting",
                providerUrl: null,
                title: "Synthetic notes",
                importedAt: "2026-10-20T09:45:00Z",
                text: (globalThis as unknown as { notesImported: boolean }).notesImported
                  ? "Fresh complete meeting notes"
                  : "Previous meeting notes",
              },
            ]),
          ),
      );
    });
    await atTodayTime(demo.page, 9, 50);
    const menubar = await openMenuBarAgenda(demo.app);
    await atTodayTime(menubar, 9, 50);
    for (const page of [demo.page, menubar])
      await expect(page.getByText("Previous meeting notes", { exact: true })).toBeVisible();
    await demo.app.evaluate(({ BrowserWindow }) => {
      (globalThis as unknown as { notesImported: boolean }).notesImported = true;
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send("dayboard:notification", {
          channel: "meetings:notesChanged",
          params: { calendarId: "work", eventId: "e1" },
        });
    });
    for (const page of [demo.page, menubar]) {
      await expect(page.getByText("Fresh complete meeting notes", { exact: true })).toBeVisible();
      await expect(page.getByText("Previous meeting notes", { exact: true })).toHaveCount(0);
    }
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("the menu bar switches views and days without losing what is typed", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    const view = (name: string) => panel.getByRole("radio", { name, exact: true });
    const input = panel.getByRole("textbox", { name: "Add, ask or search" });
    await input.fill("Unsent idea");
    await view("Lists").click();
    await expect(panel.getByRole("heading", { name: "Lists", exact: true })).toBeVisible();
    await expect(view("Lists")).toBeChecked();
    await view("Month").click();
    await expect(panel.getByRole("region", { name: "Month", exact: true })).toBeVisible();
    await expect(input).toHaveValue("Unsent idea");
    await view("Day").click();
    await expect(panel.getByRole("region", { name: "Today's items", exact: true })).toBeVisible();

    // The week strip moves the line to another day; overdue work stays with today.
    const strip = panel.getByRole("group", { name: "Next seven days" });
    await expect(strip.getByRole("button")).toHaveCount(7);
    await expect(strip.getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
    await strip.getByRole("button").nth(2).click();
    await expect(strip.getByRole("button").nth(2)).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByRole("region", { name: "Today's items", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("region", { name: "Overdue items" })).toHaveCount(0);
    await expect(input).toHaveValue("Unsent idea");
    await panel.screenshot({ path: "test-results/menubar-day-line-other-day.png" });
    await strip.getByRole("button").first().click();

    // The command bar stays at the bottom, under the feed, inside the window. Today's line is
    // longer than the other day's, and the window grows to fit it a moment after the click
    // (ResizeObserver → panel:resize → setBounds), so measure once that has happened.
    const measure = () =>
      panel.evaluate(() => {
        const { document, innerHeight } = globalThis as unknown as {
          innerHeight: number;
          document: {
            querySelector(
              selector: string,
            ): { getBoundingClientRect(): { bottom: number; top: number } } | null;
          };
        };
        const input = document.querySelector("input")!.getBoundingClientRect();
        const feed = document.querySelector('[aria-label="Agenda feed"]')!.getBoundingClientRect();
        return { height: innerHeight, inputTop: input.top, inputBottom: input.bottom, feed };
      });
    await expect
      .poll(async () => {
        const { height, inputBottom } = await measure();
        return inputBottom <= height;
      })
      .toBe(true);
    const layout = await measure();
    expect(layout.inputBottom).toBeLessThanOrEqual(layout.height);
    expect(layout.feed.bottom).toBeLessThanOrEqual(layout.inputTop);
    await panel.screenshot({ path: "test-results/menubar-day-line.png" });
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("the menu-bar day scrolls through every item and marks now", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await atTodayTime(panel, 12, 5);
    const today = panel.getByRole("region", { name: "Today's items", exact: true });
    await expect(today.getByRole("listitem", { name: "Now" })).toHaveCount(1);
    // Every event and to-do of the day is in the list; none is held back for the main window.
    const rows = await today.getByRole("listitem").count();
    expect(rows).toBeGreaterThanOrEqual(10);
    await expect(panel.getByText(/more in DayBoard/)).toHaveCount(0);
    const feed = panel.getByLabel("Agenda feed");
    const scroll = await feed.evaluate((node) => {
      const element = node as unknown as {
        scrollHeight: number;
        clientHeight: number;
        scrollTop: number;
        scrollTo(x: number, y: number): void;
      };
      element.scrollTo(0, element.scrollHeight);
      return {
        overflows: element.scrollHeight > element.clientHeight,
        scrolled: element.scrollTop > 0,
      };
    });
    expect(scroll).toEqual({ overflows: true, scrolled: true });
    await expect(today.getByRole("listitem").last()).toBeInViewport();
    await panel.screenshot({ path: "test-results/menubar-day-line-bottom.png" });
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Catch up goes through overdue items one at a time inside the panel", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await hideMainWindow(demo.app);
    await panel
      .getByRole("region", { name: "Overdue items" })
      .getByRole("button", { name: "Catch up" })
      .click();
    const catchUp = panel.getByRole("region", { name: "Catch up" });
    await expect(catchUp.getByRole("status")).toHaveText("1 of 3");
    await expect(catchUp.getByRole("heading", { level: 3 })).toHaveText(
      "Follow up with design agency",
    );
    await expect(catchUp.getByRole("button", { name: /^(Today|Tomorrow|No date)/ })).toHaveCount(3);
    await panel.screenshot({ path: "test-results/menubar-catch-up.png" });
    // S skips; a move in demo mode is refused and the item stays put.
    await panel.keyboard.press("s");
    await expect(catchUp.getByRole("status")).toHaveText("2 of 3");
    await panel.keyboard.press("2");
    await expect(panel.getByText(/Demo content is read-only/)).toBeVisible();
    await expect(catchUp.getByRole("status")).toHaveText("2 of 3");
    await panel.keyboard.press("s");
    await panel.keyboard.press("s");
    await expect(catchUp.getByRole("heading", { name: "All Caught Up" })).toBeVisible();
    // Esc steps back to the day, not out of the panel.
    await panel.keyboard.press("Escape");
    await expect(panel.getByRole("region", { name: "Today's items", exact: true })).toBeVisible();
    expect(await panelVisible(demo.app, "#menubar")).toBe(true);
    expect(await mainWindowVisible(demo.app)).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("the menu-bar month opens a day's line in place and the command bar searches", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await panel.getByRole("radio", { name: "Month", exact: true }).click();
    const month = panel.getByRole("region", { name: "Month", exact: true });
    await expect(month.getByRole("gridcell")).toHaveCount(42);
    await expect(month.locator('button[aria-current="date"]')).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(month.getByRole("button", { name: /^Team standup/ })).toBeVisible();
    await month.getByRole("button", { name: /^Team standup/ }).click();
    await expect(panel.getByRole("group", { name: "Edit “Team standup”" })).toBeVisible();
    await panel.keyboard.press("Escape");
    const title = await month.getByRole("heading", { level: 2 }).textContent();
    await month.getByRole("button", { name: "Next month" }).click();
    await expect(month.getByRole("heading", { level: 2 })).not.toHaveText(title ?? "");
    await month.getByRole("button", { name: "Today", exact: true }).click();
    await expect(month.getByRole("heading", { level: 2 })).toHaveText(title ?? "");
    await panel.screenshot({ path: "test-results/menubar-month.png" });

    // Typing looks through the week; the matches open in place like any other row.
    const input = panel.getByRole("textbox", { name: "Add, ask or search" });
    await input.fill("launch");
    const matches = panel.getByRole("region", { name: "Matches" });
    await expect(matches.getByRole("button", { name: /^Launch week/ })).toBeVisible();
    await expect(
      matches.getByRole("button", { name: /^Finalize launch announcement/ }),
    ).toBeVisible();
    await expect(matches.getByText("Team standup")).toHaveCount(0);
    await panel.screenshot({ path: "test-results/menubar-search.png" });
    // Esc clears what is typed before it would close the panel.
    await input.press("Escape");
    await expect(input).toHaveValue("");
    await expect(matches).toHaveCount(0);
    expect(await panelVisible(demo.app, "#menubar")).toBe(true);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("the menu-bar quick add aims at a chosen list and remembers it", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    const input = () => panel.getByRole("textbox", { name: "Add, ask or search" });
    await expect(input()).toHaveAttribute("placeholder", "Add, ask or search…");
    await panel.getByRole("button", { name: "Add to: Let AI decide" }).click();
    await expect(panel.getByRole("menuitemcheckbox", { name: "Let AI decide" })).toBeChecked();
    await expect(panel.getByText("Google Tasks", { exact: true })).toBeVisible();
    await expect(panel.getByRole("menuitemcheckbox", { name: "Errands" })).toBeVisible();
    await expect(panel.getByRole("menu")).toHaveCSS("opacity", "1");
    await panel.screenshot({ path: "test-results/menubar-list-picker.png" });
    await panel.getByRole("menuitemcheckbox", { name: "Work" }).click();
    await expect(input()).toHaveAttribute("placeholder", "Add to “Work”…");

    await input().fill("Book flights");
    await input().press("Enter");
    // Demo mode never writes; the refusal proves the targeted submit reached capture.
    await expect(panel.getByText(/turned off in demo mode/)).toBeVisible();
    await expect(input()).toHaveValue("Book flights");

    // The choice survives a fresh renderer, not just this open panel.
    await panel.reload();
    await expect(input()).toHaveAttribute("placeholder", "Add to “Work”…");
    await expect(panel.getByRole("button", { name: "Add to: Work" })).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

async function mainWindowFocused(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (window) =>
        window.webContents.getURL().includes("main-window.html") &&
        window.isVisible() &&
        window.isFocused(),
    ),
  );
}

async function mainWindowVisible(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (window) => window.webContents.getURL().includes("main-window.html") && window.isVisible(),
    ),
  );
}

async function hideMainWindow(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes("main-window.html"))
      ?.hide();
  });
}

test("the menu-bar lists stay in the panel, grouped by list, and edit in place", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await hideMainWindow(demo.app);
    await panel.getByRole("radio", { name: "Lists", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Lists", exact: true })).toBeVisible();
    const list = panel.getByRole("region", { name: "All tasks", exact: true });
    // Google Tasks lists lead, then Reminders lists; each header counts its open items.
    await expect(list.getByRole("button", { name: /, \d+ open$/ })).toHaveText([
      /^Work\d+$/,
      /^Personal\d+$/,
      /^Reminders\d+$/,
      /^Family\d+$/,
      /^Errands\d+$/,
    ]);
    const work = list.getByRole("region", { name: "Work", exact: true });
    await expect(work.getByText("Follow up with design agency")).toBeVisible();
    await expect(work.getByText("Update team wiki")).toBeVisible();
    await panel.screenshot({ path: "test-results/menubar-lists.png" });

    // A list's + aims the command bar at it and focuses the field, still inside the panel.
    await list.getByRole("button", { name: "Add to Errands" }).click();
    const input = panel.getByRole("textbox", { name: "Add, ask or search" });
    await expect(input).toHaveAttribute("placeholder", "Add to “Errands”…");
    await expect(input).toBeFocused();

    // Folding a list keeps it folded after the renderer reloads.
    await list.getByRole("button", { name: /^Personal, \d+ open$/ }).click();
    await expect(list.getByText("Book flights for conference")).toHaveCount(0);
    await panel.reload();
    await panel.getByRole("radio", { name: "Lists", exact: true }).click();
    await expect(panel.getByText("Update team wiki")).toBeVisible();
    await expect(panel.getByText("Book flights for conference")).toHaveCount(0);

    // Checking an item off writes from the panel; demo mode refuses and the item comes back.
    await panel.getByRole("checkbox", { name: "Complete “Update team wiki”" }).click();
    await expect(panel.getByText(/Couldn't update “Update team wiki”/)).toBeVisible();
    await expect(panel.getByText("Update team wiki", { exact: true })).toBeVisible();

    // A row opens in place to edit, move or delete; delete asks once more before it writes.
    await panel.getByRole("button", { name: "Update team wiki", exact: true }).click();
    const editor = panel.getByRole("group", { name: "Edit “Update team wiki”" });
    await expect(editor.getByRole("textbox", { name: "Notes" })).toBeVisible();
    await expect(editor.getByRole("group", { name: "Move to" }).getByRole("button")).toHaveText([
      "Today",
      "Tomorrow",
      /weekend$/,
      "Next week",
    ]);
    await editor.getByRole("button", { name: "Delete “Update team wiki”" }).click();
    await expect(editor.getByRole("button", { name: "Keep" })).toBeVisible();
    await panel.screenshot({ path: "test-results/menubar-edit-in-place.png" });
    await editor.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(panel.getByText(/Demo content is read-only/)).toBeVisible();
    await expect(panel.getByText("Update team wiki", { exact: true }).first()).toBeVisible();

    expect(await panelVisible(demo.app, "#menubar")).toBe(true);
    expect(await mainWindowFocused(demo.app)).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("the menu-bar gear opens settings inside the panel", async () => {
  const demo = await launchDemo();
  try {
    const panel = await openMenuBarAgenda(demo.app);
    await hideMainWindow(demo.app);
    const settingsOpen = () =>
      demo.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some(
          (window) => window.webContents.getURL().includes("settings-window") && window.isVisible(),
        ),
      );
    await panel.getByRole("button", { name: "Panel settings" }).click();
    const settings = panel.getByRole("region", { name: "Panel settings" });
    await expect(settings.getByRole("switch")).toHaveCount(5);
    await expect(settings.getByRole("region", { name: "Keyboard shortcuts" })).toContainText(
      "Back, then close",
    );
    expect(await settingsOpen()).toBe(false);
    expect(await panelVisible(demo.app, "#menubar")).toBe(true);
    await panel.screenshot({ path: "test-results/menubar-panel-settings.png" });

    // Hiding a source applies to this panel at once and survives a fresh renderer.
    await settings.getByRole("switch", { name: "Calendar", exact: true }).click();
    await settings.getByRole("button", { name: "Sync", exact: true }).click();
    // Esc steps back to the day; the panel stays open.
    await panel.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    const today = panel.getByRole("region", { name: "Today's items", exact: true });
    await expect(today).toBeVisible();
    await expect(today.getByText("Team standup")).toHaveCount(0);
    await expect(today.getByText("Pick up dry cleaning")).toBeVisible();
    await panel.reload();
    await expect(
      panel.getByRole("region", { name: "Today's items", exact: true }).getByText("Team standup"),
    ).toHaveCount(0);
    await panel.keyboard.press("Meta+,");
    await panel
      .getByRole("region", { name: "Panel settings" })
      .getByRole("switch", { name: "Calendar", exact: true })
      .click();
    await panel.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      panel.getByRole("region", { name: "Today's items", exact: true }).getByText("Team standup"),
    ).toBeVisible();
    expect(await panelVisible(demo.app, "#menubar")).toBe(true);
    expect(await settingsOpen()).toBe(false);
    expect(await mainWindowFocused(demo.app)).toBe(false);

    // Accounts, AI and the license are the one thing that opens a window, and it says so.
    await panel.getByRole("button", { name: "Panel settings" }).click();
    const accounts = panel.getByRole("button", { name: /^Accounts, AI and license/ });
    await expect(accounts).toContainText("Opens the Settings window");
    await accounts.click();
    await expect.poll(settingsOpen).toBe(true);
    expect(await mainWindowVisible(demo.app)).toBe(false);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
