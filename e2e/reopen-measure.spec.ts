import { expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { launchDemo, waitForWindowReady } from "./fixtures";

// Measurement only, for the evidence in the pull request that carries it. Not meant for main.

type Marked = { keptLoaded?: boolean };

const mainWindowVisible = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (window) => window.webContents.getURL().includes("main-window.html") && window.isVisible(),
    ),
  );

const agendaButton = (page: Page) => page.getByRole("button", { name: /^Agenda\b/ }).first();

const mark = (page: Page) =>
  page.evaluate(() => {
    (globalThis as Marked).keptLoaded = true;
  });

const marked = (page: Page) => page.evaluate(() => (globalThis as Marked).keptLoaded === true);

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test("measure reopening the dashboard: kept loaded (1.3.9) against rebuilt (1.3.8)", async () => {
  test.setTimeout(180_000);
  const demo = await launchDemo();
  const kept: Record<string, unknown>[] = [];
  const rebuilt: Record<string, unknown>[] = [];
  try {
    await agendaButton(demo.page).click();
    await expect(agendaButton(demo.page)).toHaveAttribute("aria-current", "page");

    // What main does now: Close hides the window, and the Dock click shows the same one.
    for (let round = 0; round < 5; round++) {
      await mark(demo.page);
      let loads = 0;
      const onLoad = () => loads++;
      demo.page.on("load", onLoad);
      await demo.app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()?.getMenuItemById("close")?.click(),
      );
      await expect.poll(() => mainWindowVisible(demo.app)).toBe(false);
      await demo.page.waitForTimeout(1_000);
      const started = Date.now();
      await demo.app.evaluate(({ app }) => app.emit("activate", {}, false));
      await expect.poll(() => mainWindowVisible(demo.app), { intervals: [5] }).toBe(true);
      await expect(agendaButton(demo.page)).toHaveAttribute("aria-current", "page");
      kept.push({
        msUntilShown: Date.now() - started,
        sameRenderer: await marked(demo.page),
        pageLoads: loads,
        stillOnAgenda: true,
      });
      demo.page.off("load", onLoad);
    }

    // What 1.3.8 did on Close: the window was destroyed, and the Dock click built a new one.
    let page = demo.page;
    for (let round = 0; round < 5; round++) {
      await agendaButton(page).click();
      await expect(agendaButton(page)).toHaveAttribute("aria-current", "page");
      await mark(page);
      await demo.app.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      });
      await expect.poll(() => demo.app.windows().length).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const started = Date.now();
      const opened = demo.app.waitForEvent("window");
      await demo.app.evaluate(({ app }) => app.emit("activate", {}, false));
      page = await opened;
      await waitForWindowReady(page);
      await expect(agendaButton(page)).toBeVisible();
      rebuilt.push({
        msUntilShown: Date.now() - started,
        sameRenderer: await marked(page),
        pageLoads: 1,
        stillOnAgenda: (await agendaButton(page).getAttribute("aria-current")) === "page",
      });
    }
  } finally {
    await demo.close();
  }
  const result = {
    keptLoaded: { medianMs: median(kept.map((run) => run.msUntilShown as number)), runs: kept },
    rebuilt: {
      medianMs: median(rebuilt.map((run) => run.msUntilShown as number)),
      runs: rebuilt,
    },
  };
  console.log(`REOPEN_MEASUREMENT ${JSON.stringify(result)}`);
  expect(kept.every((run) => run.sameRenderer === true && run.pageLoads === 0)).toBe(true);
  expect(rebuilt.every((run) => run.sameRenderer === false)).toBe(true);
});
