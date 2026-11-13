import type { DayboardBridge } from "../shared/bridge-protocol";
import type { AppSettings } from "../main/shared-types";
import { expect, test, type Page } from "@playwright/test";
import { launchDemo } from "./fixtures";

function sidebarItem(page: Page, title: string) {
  return page
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
}

test("Home greets, ranks what needs you, suggests tasks from mail and shows the Agenda", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    await expect(sidebarItem(page, "Home")).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: /^Good (morning|afternoon|evening), Alex$/,
      }),
    ).toBeVisible();

    const needsYou = page.getByRole("region", { name: "Needs you" });
    const suggested = page.getByRole("region", { name: "Suggested" });
    const agenda = page.getByRole("region", { name: "Agenda" });

    // New mail is triaged on its own: what needs a reply stays, FYI mail drops out.
    const sam = needsYou.getByRole("button", {
      name: /^Sam Patel: Lunch today\?, Confirm lunch plans/,
    });
    await expect(sam).toBeVisible();
    await expect(
      needsYou.getByRole("button", {
        name: /^Priya Shah: Launch announcement.*Final-copy decision requested/,
      }),
    ).toBeVisible();
    await expect(needsYou.getByRole("button", { name: /^Jordan Lee:/ })).toHaveCount(0);
    await expect(needsYou.getByRole("button", { name: "Review inbox" })).toHaveCount(0);
    await expect(suggested.getByText("Review launch copy", { exact: true })).toBeVisible();
    await expect(suggested.getByText("Submit the Q4 budget", { exact: true })).toBeVisible();

    await suggested
      .getByRole("button", { name: "Dismiss suggestion: Submit the Q4 budget" })
      .click();
    await expect(suggested.getByText("Submit the Q4 budget", { exact: true })).toHaveCount(0);

    // Past meetings render without a button, so match the row by text at any time of day.
    // One Agenda card holds today's events and tasks together.
    await expect(agenda).toContainText("Team standup");
    await expect(agenda.getByText("Finalize launch announcement", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Meetings" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Your tasks" })).toHaveCount(0);

    // Overdue items fold into one row, like the Agenda page, and Home remembers when it's open.
    const overdue = agenda.getByRole("button", { name: "3 overdue tasks" });
    const lateTask = agenda.getByText("Send Q4 budget to finance", { exact: true });
    await expect(overdue).toHaveAttribute("aria-expanded", "false");
    await expect(lateTask).toBeHidden();
    await page.getByRole("heading", { level: 2, name: /^Good / }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath("home-overdue-collapsed.png") });
    await overdue.click();
    await expect(overdue).toHaveAttribute("aria-expanded", "true");
    await expect(lateTask).toBeVisible();
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath("home-today.png") });

    await page.getByRole("radio", { name: "This week" }).click();
    await expect(page.getByText(/meetings? this week\.$/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("home-week.png") });

    // A waiting email opens in the Inbox.
    await sam.click();
    await expect(page.getByRole("dialog", { name: "Lunch today?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sidebarItem(page, "Inbox")).toHaveAttribute("aria-current", "page");

    // The full Agenda keeps its own place in the sidebar.
    await sidebarItem(page, "Agenda").click();
    await expect(sidebarItem(page, "Agenda")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-agenda-range]")).toBeVisible();

    // Home remembers the range and the dismissed suggestion.
    await sidebarItem(page, "Home").click();
    await expect(page.getByRole("radio", { name: "This week" })).toBeChecked();
    await expect(agenda.getByRole("button", { name: "3 overdue tasks" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(suggested.getByText("Review launch copy", { exact: true })).toBeVisible();
    await expect(suggested.getByText("Submit the Q4 budget", { exact: true })).toHaveCount(0);
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});

test("Home cards customize, persist, collapse, reset and fit narrow windows", async ({
  playwright: _playwright,
}, testInfo) => {
  const demo = await launchDemo();
  try {
    const page = demo.page;
    const cards = page.locator("[data-home-module]");
    await expect(cards).toHaveCount(4);
    await page.screenshot({ path: testInfo.outputPath("home-default.png") });
    await page.getByRole("button", { name: "Collapse Agenda", exact: true }).click();
    await page.getByRole("button", { name: "Customize", exact: true }).click();
    await page
      .getByRole("button", { name: "Drag Needs you", exact: true })
      .dragTo(page.getByRole("button", { name: "Drag Suggested", exact: true }));
    await expect(cards.nth(2)).toHaveAttribute("data-home-module", "waiting");
    await page.getByRole("button", { name: "Reset layout", exact: true }).click();
    await page.getByRole("button", { name: "Move Needs you up", exact: true }).click();
    await expect(cards.nth(2)).toHaveAttribute("data-home-module", "waiting");
    await page.getByRole("button", { name: "Hide Suggested", exact: true }).click();
    await page.getByRole("button", { name: "Set Agenda wide", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("region", { name: "Suggested", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Collapse Agenda", exact: true }).click();
    await expect(page.getByRole("button", { name: "Expand Agenda", exact: true })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand Agenda", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Suggested", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Customize", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("home-customize.png") });
    await page.getByRole("button", { name: "Reset layout", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(cards.nth(2)).toHaveAttribute("data-home-module", "suggested");
    await expect(page.getByRole("button", { name: "Collapse Agenda", exact: true })).toBeVisible();
    await demo.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setSize(760, 850),
    );
    const windowWidth = await demo.app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getContentBounds().width,
    );
    for (const card of await cards.all()) {
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBeLessThanOrEqual(windowWidth);
    }
    await page.screenshot({ path: testInfo.outputPath("home-narrow.png") });
    await page.evaluate(async () => {
      const bridge = (globalThis as typeof globalThis & { dayboard: DayboardBridge }).dayboard;
      const settings = await bridge.ipc.invoke<AppSettings>("settings:get");
      await bridge.ipc.invoke("settings:update", {
        ...settings,
        // Demo mode keeps every source on, so turn the meeting card's own options off.
        system: {
          ...settings.system,
          meetings: { ...settings.system.meetings, upNext: false, notesImport: false },
        },
      });
    });
    await page.reload();
    // With nothing up next, the meeting card stays out of the way until you customize Home.
    const noMeeting = page.getByText("No meeting card available right now.", { exact: true });
    await expect(page.getByRole("region", { name: "Agenda" })).toBeVisible();
    await expect(page.locator('[data-home-module="meeting"]')).toBeHidden();
    await expect(noMeeting).toBeHidden();
    await page.getByRole("button", { name: "Customize" }).click();
    await expect(noMeeting).toBeVisible();
    expect(demo.errors).toEqual([]);
  } finally {
    await demo.close();
  }
});
