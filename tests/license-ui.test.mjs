import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "dayboard-license-ui-"));
await symlink(path.join(root, "node_modules"), path.join(tempDir, "node_modules"));

const fixture = {
  query: {},
  buttons: [],
  dialogs: [],
  calls: [],
  retries: 0,
  // Mutations started by a click, the IPC calls they made and the toasts they showed.
  runs: [],
  invocations: [],
  toasts: [],
};
globalThis.__dayboardLicenseUiFixture = fixture;

const uiModule = `
  import React from "react";
  import { Button as RealButton } from ${JSON.stringify(path.join(root, "renderer/ui/button.tsx"))};
  import { AlertDialog as RealAlertDialog } from ${JSON.stringify(path.join(root, "renderer/ui/alert-dialog.tsx"))};
  export { EmptyState } from ${JSON.stringify(path.join(root, "renderer/ui/empty-state.tsx"))};
  export { Callout } from ${JSON.stringify(path.join(root, "renderer/ui/callout.tsx"))};
  export { Field, FieldSet } from ${JSON.stringify(path.join(root, "renderer/ui/field.tsx"))};
  export { Input } from ${JSON.stringify(path.join(root, "renderer/ui/input.tsx"))};
  export { Status } from ${JSON.stringify(path.join(root, "renderer/ui/status.tsx"))};
  export { Text } from ${JSON.stringify(path.join(root, "renderer/ui/text.tsx"))};
  export { cn } from ${JSON.stringify(path.join(root, "renderer/ui/utils.ts"))};
  export { Popover, PopoverTrigger, PopoverContent } from ${JSON.stringify(path.join(root, "renderer/ui/popover.tsx"))};
  const fixture = () => globalThis.__dayboardLicenseUiFixture;
  export function Button(props) {
    fixture().buttons.push({ label: props.children, onClick: props.onClick });
    return React.createElement(RealButton, props);
  }
  export function AlertDialog(props) {
    fixture().dialogs.push({ title: props.title, open: props.open, onConfirm: props.onConfirm });
    return React.createElement(RealAlertDialog, props);
  }
  const record = (kind) => (message) => fixture().toasts.push([kind, message]);
  export const toast = { error: record("error"), success: record("success"), warning: record("warning") };
`;

const fixturePlugin = {
  name: "license-ui-boundaries",
  setup(api) {
    api.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({
      path: "react-query",
      namespace: "license-ui-fixture",
    }));
    api.onResolve({ filter: /^(\.\.\/ui|\.\.\/lib\/ipc|\.\/ipc)$/ }, (args) => ({
      path: args.path === "../ui" ? "ui" : "ipc",
      namespace: "license-ui-fixture",
    }));
    api.onLoad({ filter: /.*/, namespace: "license-ui-fixture" }, (args) => ({
      contents:
        args.path === "ui"
          ? uiModule
          : args.path === "ipc"
            ? `
              export function openSettings(tab) {
                globalThis.__dayboardLicenseUiFixture.calls.push(["settings", tab]);
              }
              export function openExternal(url) {
                globalThis.__dayboardLicenseUiFixture.calls.push(["external", url]);
              }
              export function errorMessage(error) { return String(error); }
            `
            : `
              const fixture = () => globalThis.__dayboardLicenseUiFixture;
              export function useQuery() { return fixture().query; }
              export function useQueryClient() { return { setQueryData() {} }; }
              // Runs the real mutationFn and onSuccess/onError, as React Query would.
              export function useMutation(options) {
                return {
                  isPending: false,
                  data: undefined,
                  mutate(variables) {
                    fixture().runs.push(
                      Promise.resolve()
                        .then(() => options.mutationFn(variables))
                        .then(
                          (data) => options.onSuccess?.(data, variables),
                          (error) => options.onError?.(error, variables),
                        ),
                    );
                  },
                };
              }
            `,
      resolveDir: root,
      loader: "js",
    }));
  },
};

let LicenseGate;
let LicenseStatusControl;
let LicenseTab;
let TrialReminder;
let proPrice;
let proBuyUrl;
let trialReminderStage;
try {
  await build({
    entryPoints: [
      path.join(root, "renderer/components/license-gate.tsx"),
      path.join(root, "renderer/settings/license-tab.tsx"),
      path.join(root, "renderer/components/trial-reminder.tsx"),
      path.join(root, "renderer/lib/license.ts"),
    ],
    outdir: tempDir,
    entryNames: "[name]",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    splitting: true,
    format: "esm",
    jsx: "automatic",
    platform: "node",
    packages: "external",
    plugins: [fixturePlugin],
    logLevel: "silent",
  });
  ({ LicenseGate, LicenseStatusControl } = await import(
    pathToFileURL(path.join(tempDir, "license-gate.mjs"))
  ));
  ({ LicenseTab } = await import(pathToFileURL(path.join(tempDir, "license-tab.mjs"))));
  ({ TrialReminder } = await import(pathToFileURL(path.join(tempDir, "trial-reminder.mjs"))));
  ({ proPrice, proBuyUrl, trialReminderStage } = await import(
    pathToFileURL(path.join(tempDir, "license.mjs"))
  ));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function render(Component, query) {
  fixture.query = {
    data: undefined,
    isPending: false,
    isLoading: false,
    isError: false,
    refetch: () => {
      fixture.retries++;
    },
    ...query,
  };
  fixture.buttons = [];
  fixture.dialogs = [];
  fixture.calls = [];
  fixture.retries = 0;
  fixture.runs = [];
  fixture.invocations = [];
  fixture.toasts = [];
  return renderToStaticMarkup(React.createElement(Component));
}

/** Runs `action` (a click or a dialog confirm) with `window.dayboard.ipc` answering `reply`. */
async function withIpc(reply, action) {
  globalThis.window = {
    dayboard: {
      ipc: {
        invoke: async (channel, ...args) => {
          fixture.invocations.push([channel, ...args]);
          return reply;
        },
      },
    },
  };
  try {
    action();
    await Promise.all(fixture.runs);
  } finally {
    delete globalThis.window;
  }
}

function dialog(title) {
  const found = fixture.dialogs.find((item) => item.title === title);
  assert.ok(found, `Expected a ${title} dialog`);
  assert.equal(found.open, false, `${title} starts closed`);
  return found;
}

function gate(query) {
  return render(() => React.createElement(LicenseGate, null, "PRIVATE ACTION CONTENT"), query);
}

function status(state, checkoutUrl = "https://example.invalid/checkout") {
  const details = {
    trial: { daysLeft: 5 },
    licensed: { keyHint: "1234" },
    invalid: { keyHint: "1234", message: "Key rejected" },
    "network-error": { keyHint: "1234", lastValidatedAt: "2026-09-01" },
  };
  return { data: { status: { state, ...details[state] }, checkoutUrl } };
}

function click(label) {
  const button = fixture.buttons.find((item) => item.label === label);
  assert.ok(button, `Expected a rendered ${label} button`);
  assert.equal(typeof button.onClick, "function");
  button.onClick();
}

test("gate withholds protected content while loading and on status lookup failure", () => {
  const loading = gate({ isPending: true, isLoading: true });
  assert.match(loading, /Checking license/);
  assert.doesNotMatch(loading, /PRIVATE ACTION CONTENT/);

  const error = gate({ isPending: false, isError: true });
  assert.match(error, /License status unavailable/);
  assert.match(error, /saved data remains available/);
  assert.doesNotMatch(error, /Checking license|PRIVATE ACTION CONTENT/);
  click("Retry");
  assert.equal(fixture.retries, 1);

  const staleLicensed = gate({ ...status("licensed"), isError: true });
  assert.match(staleLicensed, /License status unavailable/);
  assert.doesNotMatch(staleLicensed, /PRIVATE ACTION CONTENT/);
});

test("Settings shows a recoverable storage error instead of endless loading", () => {
  const loading = render(LicenseTab, { isLoading: true });
  assert.match(loading, /Checking/);
  assert.doesNotMatch(loading, /Retry|License key|Buy DayBoard/);

  const error = render(LicenseTab, { isError: true, isLoading: false });
  assert.match(error, /could not read your license status/);
  assert.match(error, />Retry</);
  assert.doesNotMatch(error, /Checking/);
  click("Retry");
  assert.equal(fixture.retries, 1);
});

test("gate renders intended content for trial, licensed, demo, and unconfigured statuses", () => {
  for (const state of ["trial", "licensed", "demo", "unconfigured"]) {
    const html = gate(status(state));
    assert.match(html, /PRIVATE ACTION CONTENT/, state);
    assert.doesNotMatch(html, /Buy DayBoard|Open License Settings/, state);
  }
});

test("gate blocks expired and invalid statuses and opens License Settings", () => {
  for (const [state, settingsLabel] of [
    ["expired", "I have a license key"],
    ["invalid", "Open License Settings"],
  ]) {
    const html = gate(status(state));
    assert.doesNotMatch(html, /PRIVATE ACTION CONTENT/, state);
    assert.match(html, new RegExp(settingsLabel), state);
    click(settingsLabel);
    assert.deepEqual(fixture.calls, [["settings", "license"]], state);
  }
});

test("an ended trial names Pro's price on the gate and tags its buy link", () => {
  const html = gate(status("expired"));
  assert.match(html, /AI trial ended/);
  assert.match(html, /keep working for free/);
  assert.match(
    html,
    /DayBoard Pro brings back the Assistant, Quick Capture AI and dictation for \$(5|9) once, on up to 3 Macs/,
  );
  assert.match(html, /14-day refunds/);
  const buy = fixture.buttons.find((item) => /^Get DayBoard Pro — \$(5|9)$/.test(item.label));
  assert.ok(buy, "the buy button names the price");
  buy.onClick();
  assert.deepEqual(fixture.calls, [
    ["external", "https://example.invalid/checkout?from=app-ai-locked"],
  ]);
  assert.doesNotMatch(html, /Open License Settings/);
});

test("an invalid key shows the service's reason instead of a generic one", () => {
  const released = {
    data: {
      status: {
        state: "invalid",
        keyHint: "1234",
        message:
          "This Mac's activation was released. Enter your license key again to reactivate it.",
      },
      checkoutUrl: "https://example.invalid/checkout",
    },
  };
  for (const html of [gate(released), render(LicenseTab, released)]) {
    assert.match(html, /This Mac(&#x27;|')s activation was released/);
    assert.doesNotMatch(html, /isn(&#x27;|')t valid|no longer valid|not valid/);
  }
});

test("network error names the DayBoard license service and withholds protected content", () => {
  const html = gate(status("network-error"));
  assert.match(html, /DayBoard license service/);
  assert.doesNotMatch(html, /Lemon Squeezy|PRIVATE ACTION CONTENT/);
  assert.match(html, /Open License Settings/);
});

test("demo and unconfigured Settings never expose activation or checkout", () => {
  for (const state of ["demo", "unconfigured"]) {
    const html = render(LicenseTab, status(state));
    assert.match(html, state === "demo" ? /Demo/ : /Preview build/);
    assert.doesNotMatch(html, /License key|Activate|Buy DayBoard|Paste your license key/);
    assert.equal(fixture.buttons.length, 0, state);
  }
});

test("license status control opens the License tab when status needs attention", () => {
  render(LicenseStatusControl, status("unreadable"));
  click("License data needs attention");
  assert.deepEqual(fixture.calls, [["settings", "license"]]);

  render(LicenseStatusControl, status("invalid"));
  click("Unlock AI · DayBoard Pro");
  assert.deepEqual(fixture.calls, [["settings", "license"]]);

  // Without a checkout address there is no card to show, so the counter opens Settings.
  render(LicenseStatusControl, status("expired", ""));
  click("Unlock AI · DayBoard Pro");
  assert.deepEqual(fixture.calls, [["settings", "license"]]);
});

test("during and after the trial, the sidebar counter opens a Pro card instead of Settings", () => {
  for (const [state, label] of [
    ["trial", "5 days left in your AI trial"],
    ["expired", "Unlock AI · DayBoard Pro"],
  ]) {
    const html = render(LicenseStatusControl, status(state));
    assert.match(html, new RegExp(`aria-haspopup="dialog"[^>]*>${label}<`), state);
    assert.deepEqual(fixture.calls, [], state);
  }
});

test("unreadable license data blocks AI and points to Settings", () => {
  const html = gate(status("unreadable"));
  assert.doesNotMatch(html, /PRIVATE ACTION CONTENT/);
  assert.match(html, /Can(&#x27;|')t read license data/);
  assert.match(html, /reset license data on this Mac/);
  click("Open License Settings");
  assert.deepEqual(fixture.calls, [["settings", "license"]]);
});

test("Settings offers Retry, key entry and a confirmed reset for unreadable license data", () => {
  const html = render(LicenseTab, status("unreadable"));
  assert.match(html, /Can(&#x27;|')t read license data/);
  assert.match(html, /Keychain access/);
  assert.match(html, /Paste your license key/);
  assert.match(html, />Reset license data on this Mac</);
  assert.doesNotMatch(html, /Deactivate this device|Remove saved key/);
  // The reset itself waits for the confirmation dialog, which starts closed.
  assert.doesNotMatch(html, /Reset license data on this Mac\?/);
  click("Retry");
  assert.equal(fixture.retries, 1);

  for (const state of ["trial", "licensed", "invalid", "network-error"]) {
    assert.doesNotMatch(render(LicenseTab, status(state)), /Reset license data/, state);
  }
});

function pendingRelease(state, releasePending = true) {
  const query = status(state);
  return { data: { ...query.data, releasePending } };
}

test("a saved, unconfirmed release shows how to free the slot, only while no key is saved", () => {
  for (const state of ["trial", "expired"]) {
    const html = render(LicenseTab, pendingRelease(state));
    assert.match(
      html,
      /couldn(&#x27;|')t confirm with the license service that this Mac(&#x27;|')s/,
    );
    assert.match(html, /may still count toward the key(&#x27;|')s 3-Mac limit/, state);
    assert.match(html, /keeps the key encrypted on this Mac only until the license service/);
    assert.doesNotMatch(html, /couldn(&#x27;|')t reach/, state);
    assert.match(html, /support@getdayboard\.com/, state);
    assert.match(html, />Try again</, state);
    assert.match(html, />Forget without releasing</, state);
  }
  for (const state of ["licensed", "invalid", "network-error", "unreadable"]) {
    const html = render(LicenseTab, pendingRelease(state));
    assert.doesNotMatch(html, /3-Mac limit|>Try again<|Forget without releasing/, state);
  }
  // Once a retry confirms (or with nothing pending) the warning is gone.
  for (const query of [pendingRelease("trial", false), status("trial")]) {
    assert.doesNotMatch(render(LicenseTab, query), /3-Mac limit|Forget without releasing/);
  }
});

test("Try again retries the release; Forget without releasing asks first, then deletes the key", async () => {
  render(LicenseTab, pendingRelease("trial"));
  await withIpc(
    {
      status: { state: "trial", daysLeft: 5 },
      checkoutUrl: "",
      releasePending: false,
      release: "released",
    },
    () => click("Try again"),
  );
  assert.deepEqual(fixture.invocations, [["license:deactivate"]]);
  assert.deepEqual(fixture.toasts, [
    ["success", "Removed the license from this Mac. Its activation slot is free."],
  ]);

  render(LicenseTab, pendingRelease("trial"));
  const forget = dialog("Delete the key without freeing its slot?");
  await withIpc({ status: { state: "trial", daysLeft: 5 }, checkoutUrl: "" }, () =>
    forget.onConfirm(),
  );
  assert.deepEqual(fixture.invocations, [
    ["license:forget-release", "forget-license-key-without-releasing"],
  ]);
  assert.deepEqual(fixture.toasts, [
    [
      "success",
      "Deleted the license key from this Mac. Its activation slot may still be in use; email support@getdayboard.com to free it.",
    ],
  ]);
});

test("deactivation toasts say whether the activation slot was freed", async () => {
  for (const [release, toast] of [
    ["released", ["success", "Removed the license from this Mac. Its activation slot is free."]],
    ["none", ["success", "Removed the license key from this Mac."]],
    [
      "pending",
      [
        "warning",
        "DayBoard stopped using the license on this Mac, but couldn't confirm its activation slot is free.",
      ],
    ],
  ]) {
    for (const state of ["licensed", "invalid"]) {
      render(LicenseTab, status(state));
      // A working key is removed from the confirmation dialog; a rejected one right away.
      const act =
        state === "licensed"
          ? dialog("Deactivate DayBoard Pro on this Mac?").onConfirm
          : () => click("Remove saved key");
      await withIpc(
        {
          status: { state: "trial", daysLeft: 5 },
          checkoutUrl: "",
          releasePending: release === "pending",
          release,
        },
        act,
      );
      assert.deepEqual(fixture.invocations, [["license:deactivate"]], `${state} ${release}`);
      assert.deepEqual(fixture.toasts, [toast], `${state} ${release}`);
    }
  }
});

test("Deactivate this device asks first and removes nothing until confirmed", async () => {
  const html = render(LicenseTab, status("licensed"));
  assert.match(html, />Deactivate this device</);
  // The dialog starts closed, and opening it makes no license call.
  assert.doesNotMatch(html, /Deactivate DayBoard Pro on this Mac\?/);
  const confirm = dialog("Deactivate DayBoard Pro on this Mac?");
  await withIpc({ status: { state: "trial", daysLeft: 5 }, checkoutUrl: "" }, () =>
    click("Deactivate this device"),
  );
  assert.deepEqual(fixture.invocations, []);
  assert.deepEqual(fixture.toasts, []);

  await withIpc(
    { status: { state: "trial", daysLeft: 5 }, checkoutUrl: "", release: "released" },
    () => confirm.onConfirm(),
  );
  assert.deepEqual(fixture.invocations, [["license:deactivate"]]);

  // Only a working key offers it.
  for (const state of ["trial", "expired", "invalid", "network-error", "unreadable"]) {
    render(LicenseTab, status(state));
    assert.ok(!fixture.buttons.some((item) => item.label === "Deactivate this device"), state);
  }
});

test("confirming the reset dialog sends license:reset with its exact confirmation", async () => {
  render(LicenseTab, status("unreadable"));
  const reset = dialog("Reset license data on this Mac?");
  await withIpc({ status: { state: "trial", daysLeft: 7 }, checkoutUrl: "" }, () =>
    reset.onConfirm(),
  );
  assert.deepEqual(fixture.invocations, [["license:reset", "reset-license-data-on-this-mac"]]);
  assert.deepEqual(fixture.toasts, [
    ["success", "License data on this Mac was reset. The old file was kept as a backup."],
  ]);

  // A refused reset shows the error instead.
  render(LicenseTab, status("unreadable"));
  const refused = dialog("Reset license data on this Mac?");
  globalThis.window = {
    dayboard: { ipc: { invoke: async () => Promise.reject(new Error("Keychain refused")) } },
  };
  try {
    refused.onConfirm();
    await Promise.all(fixture.runs);
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(fixture.toasts, [["error", "Error: Keychain refused"]]);
});

test("Settings leads the trial with Pro's price and what it adds, then key entry", () => {
  for (const state of ["trial", "expired"]) {
    const html = render(LicenseTab, status(state));
    const offer = html.search(/DayBoard Pro · \$(5|9) once/);
    const keyEntry = html.indexOf("License key");
    assert.ok(offer > 0, state);
    assert.ok(keyEntry > offer, `${state}: key entry follows the offer`);
    assert.match(
      html,
      /Already bought Pro\? Paste the key from your receipt page or email\./,
      state,
    );
    assert.match(html, /The Assistant, on the Claude or ChatGPT plan you already have/, state);
    assert.match(html, /One payment, no subscription\. 14-day refunds\./, state);
    assert.doesNotMatch(html, /After checkout, copy your license key/, state);
    const buys = fixture.buttons.filter((item) => item.label === "Get DayBoard Pro");
    assert.equal(buys.length, 1, `${state}: one buy button`);
    buys[0].onClick();
    assert.deepEqual(fixture.calls, [
      ["external", "https://example.invalid/checkout?from=app-settings"],
    ]);
  }
});

test("Settings keeps fixing a saved key first, with a tagged buy button last", () => {
  const html = render(LicenseTab, status("invalid"));
  assert.doesNotMatch(html, /DayBoard Pro · \$|Already bought Pro\?/);
  assert.ok(html.indexOf("Get DayBoard Pro") > html.indexOf("License key"));
  click("Get DayBoard Pro");
  assert.deepEqual(fixture.calls, [
    ["external", "https://example.invalid/checkout?from=app-settings"],
  ]);

  const noCheckout = render(LicenseTab, status("trial", ""));
  assert.doesNotMatch(noCheckout, /DayBoard Pro · \$|Get DayBoard Pro/);
  assert.match(noCheckout, /After checkout, copy your license key/);
});

test("Pro's price follows the launch date the website and checkout page give", () => {
  const pst = (iso) => Date.parse(`${iso}-08:00`);
  assert.deepEqual(proPrice(pst("2026-11-01T09:00")), {
    price: "$5",
    note: "Launch price until December 31, then $9.",
  });
  assert.deepEqual(proPrice(pst("2026-11-19T09:00")), {
    price: "$5",
    note: "Launch price for 43 more days, then $9.",
  });
  assert.deepEqual(proPrice(pst("2026-12-31T09:00")), {
    price: "$5",
    note: "Last day at the $5 launch price, then $9.",
  });
  assert.deepEqual(proPrice(pst("2026-12-31T23:58")), {
    price: "$5",
    note: "Last day at the $5 launch price, then $9.",
  });
  assert.deepEqual(proPrice(pst("2027-01-01T00:00")), { price: "$9", note: "" });
});

test("buy links carry where in the app they sit, and nothing without a checkout address", () => {
  assert.equal(
    proBuyUrl("https://api.getdayboard.com/buy", "app-sidebar"),
    "https://api.getdayboard.com/buy?from=app-sidebar",
  );
  assert.equal(proBuyUrl("", "app-sidebar"), "");
  assert.equal(proBuyUrl("not a url", "app-sidebar"), "");
});

test("the trial reminder is due at 3 days left and on the last day, and never otherwise", () => {
  const trial = (daysLeft) => ({ state: "trial", daysLeft });
  assert.equal(trialReminderStage(trial(14)), null);
  assert.equal(trialReminderStage(trial(4)), null);
  assert.equal(trialReminderStage(trial(3)), "3-days");
  assert.equal(trialReminderStage(trial(2)), "3-days");
  assert.equal(trialReminderStage(trial(1)), "last-day");
  for (const state of ["expired", "licensed", "demo", "disabled", "unconfigured"])
    assert.equal(trialReminderStage({ state, keyHint: "1234" }), null, state);
  assert.equal(trialReminderStage(undefined), null);
});

test("Home's trial reminder shows once per stage and Not now hides it until the next", () => {
  const stored = new Map();
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  const reminder = (daysLeft, checkoutUrl = "https://example.invalid/checkout") =>
    render(TrialReminder, { data: { status: { state: "trial", daysLeft }, checkoutUrl } });
  try {
    assert.equal(reminder(5), "");
    assert.equal(reminder(3, ""), "");
    const html = reminder(3);
    assert.match(html, /3 days left in your AI trial\./);
    assert.match(
      html,
      /Keep the Assistant, Quick Capture AI and dictation with DayBoard Pro: \$(5|9) once/,
    );
    click("Get DayBoard Pro");
    assert.deepEqual(fixture.calls, [
      ["external", "https://example.invalid/checkout?from=app-trial-reminder"],
    ]);
    click("Not now");
    assert.equal(stored.get("home:trial-reminder:v1"), JSON.stringify("3-days"));
    assert.equal(reminder(2), "");
    assert.match(reminder(1), /Last day of your AI trial\./);
    for (const state of ["expired", "licensed", "demo"])
      assert.equal(
        render(TrialReminder, {
          data: {
            status: { state, keyHint: "1234" },
            checkoutUrl: "https://example.invalid/checkout",
          },
        }),
        "",
        state,
      );
  } finally {
    delete globalThis.localStorage;
  }
});
