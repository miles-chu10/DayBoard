import { fixtureImport, macCalendarOffStub } from "./fixture-imports.mjs";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer, request } from "node:http";
import path from "node:path";
import { URL } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let bundleSequence = 0;

const backendStub = `
export const ipcMain = { broadcast(...args) { (globalThis.__mcpBroadcasts ??= []).push(args); } };
export const logger = { error() {}, warn() {}, info() {} };
`;

const googleStub = `
export async function createEvent() { throw new Error("write should not run"); }
export async function createReplyDraft() { throw new Error("write should not run"); }
export async function createTask() { throw new Error("write should not run"); }
export async function getMessageBody() { return "body"; }
export async function listCompletedTasks() { return globalThis.__mcpCompletedGoogleTasks ?? []; }
export async function listEventsBetweenWithCoverage() {
  globalThis.__mcpGoogleCalendarCalls = (globalThis.__mcpGoogleCalendarCalls ?? 0) + 1;
  const items = globalThis.__mcpGoogleEvents ?? [];
  return { items, coverage: { complete: true, loaded: items.length } };
}
export async function listInbox() { return []; }
export async function listTasks() { return globalThis.__mcpGoogleTasks ?? []; }
export async function modifyMessage() { throw new Error("write should not run"); }
export async function setTaskCompleted() { throw new Error("write should not run"); }
`;

const authStub = `export class GoogleAuthError extends Error {} export const getGoogleStatus = async () => globalThis.__mcpGoogleStatus ?? ({ connected: false, email: null });`;
const remindersStub = `
export async function createReminder() { throw new Error("write should not run"); }
export async function getRemindersAccess() { return "full-access"; }
export async function listCompletedReminders() { return []; }
export async function listReminders() { return []; }
export async function setReminderCompleted(ref, completed) {
  if (!globalThis.__mcpReminderResult) throw new Error("write should not run");
  return { ...globalThis.__mcpReminderResult, ref, completed };
}
`;
const settingsStub = `
export async function getSettings() {
  return {
    sources: { tasks: { enabled: true }, reminders: { enabled: true }, mail: { enabled: true }, calendar: { enabled: true } },
    mail: { maxMessages: 25 },
    calendar: { range: "next-7-days", visibility: {}, newEvents: "" },
    mcpServer: globalThis.__mcpServerSettings ?? { enabled: true, allowWrites: true },
    ai: globalThis.__mcpAiSettings ?? { provider: "openai", assistantProvider: "" },
  };
}
`;
const accessKeyStub = `
export async function getMcpAccessKey() { return "fixture-key"; }
export async function isValidMcpBearer(header) { return header === "Bearer fixture-key"; }
`;
const EXTERNAL_AUTH = { authorization: "Bearer fixture-key" };
const calendarRangeStub = `export function calendarRangeDays() { return 7; }`;

function mcpPlugin() {
  const stubs = new Map([
    ["dayboard:platform", backendStub],
    ["./google-api.js", googleStub],
    ["./gmail-imap.js", googleStub],
    ["./google-auth.js", authStub],
    ["./apple-reminders.js", remindersStub],
    ["./apple-calendar.js", macCalendarOffStub],
    ["./settings-store.js", settingsStub],
    ["./mcp-access-key.js", accessKeyStub],
    ["./calendar-range.js", calendarRangeStub],
    [
      "./license/index.js",
      // Records any license use: MCP source writes must never check the AI license or start its trial.
      `export async function assertLicenseAccess() { globalThis.__mcpLicenseCalls = (globalThis.__mcpLicenseCalls ?? 0) + 1; if (globalThis.__mcpLicenseBlocked) throw new Error("A DayBoard license is required for changes."); }
export async function getLicenseStatus() { globalThis.__mcpLicenseCalls = (globalThis.__mcpLicenseCalls ?? 0) + 1; return { status: { state: "expired" }, checkoutUrl: "" }; }
export async function refreshLicenseStatus() { return getLicenseStatus(); }`,
    ],
    ["./demo-data.js", `export const isDemoMode = () => false;`],
    [
      "./agent-stores.js",
      // In-memory stand-ins that record what the tools wrote and every call the log received.
      `const state = () => (globalThis.__mcpAgent ??= { activity: [], memories: [], notes: [] });
export function recordToolCall(call) { state().activity.push(call); }
export async function listMemories() { return state().memories; }
export async function addMemoryEntry(text, source) { state().memories.push({ id: String(state().memories.length + 1), text, source, createdAt: 0 }); return state().memories; }
export async function listNotes() { return state().notes; }
export async function getNote(id) { return state().notes.find((note) => note.id === id) ?? null; }
export async function putNote(input) {
  const notes = state().notes;
  const existing = notes.find((note) => note.id === input.id);
  const note = { id: input.id ?? "n" + (notes.length + 1), title: input.title || input.body.split("\\n")[0], body: input.body, createdAt: 0, updatedAt: 1 };
  if (existing) Object.assign(existing, note); else notes.push(note);
  return note;
}`,
    ],
    [
      "./agenda-store.js",
      `export const reconcileAgendaKeys = async () => {
      if (globalThis.__mcpReconcileError) throw new Error("agenda state is temporarily unavailable");
      return { changed: false, state: { focusKeys: [], duplicateLinks: [], scheduledBlocks: [] } };
    };`,
    ],
  ]);
  return {
    name: "mcp-built-in-fixtures",
    setup(buildApi) {
      buildApi.onResolve({ filter: /.*/ }, (args) => {
        if (stubs.has(fixtureImport(args.path)))
          return { path: fixtureImport(args.path), namespace: "mcp-fixture" };
        return undefined;
      });
      buildApi.onLoad({ filter: /.*/, namespace: "mcp-fixture" }, (args) => ({
        contents: stubs.get(args.path),
        loader: "js",
      }));
    },
  };
}

async function loadMcpHarness() {
  const result = await build({
    stdin: {
      contents: `export * from "./main/services/mcp-http-server.ts"; export * from "./main/services/mcp-port.ts"; export * from "./main/services/runtime-activity.ts";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [mcpPlugin()],
    logLevel: "silent",
  });
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function loadResolverHarness() {
  const builtIn = {
    id: "dashboard-assistant-readonly",
    name: "Dashboard",
    enabled: true,
    transport: "http",
    command: "",
    args: [],
    env: {},
    url: "http://127.0.0.1:62895/assistant-mcp",
    headers: { Authorization: "Bearer fixture" },
  };
  const result = await build({
    entryPoints: [path.join(root, "main/services/ai/assistant-mcp.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
    plugins: [
      {
        name: "assistant-mcp-fixture",
        setup(buildApi) {
          buildApi.onResolve({ filter: /mcp-http-server\.js$/ }, () => ({
            path: "mcp-http-server",
            namespace: "assistant-mcp-fixture",
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "assistant-mcp-fixture" }, () => ({
            contents: `export function getActiveAssistantMcpServerConfig() { return ${JSON.stringify(builtIn)}; }`,
            loader: "js",
          }));
        },
      },
    ],
  });
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  return {
    module: await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`),
    builtIn,
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function rawRequest(port, headers, requestPath = "/assistant-mcp") {
  return rawMcpRequest(
    port,
    headers,
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    requestPath,
  ).then(({ status }) => status);
}

function rawMcpRequest(port, headers, body, requestPath = "/assistant-mcp") {
  return new Promise((resolve, reject) => {
    const client = request({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        ...headers,
      },
    });
    client.on("response", (response) => {
      let text = "";
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.resume();
      response.on("end", () => resolve({ status: response.statusCode, body: text }));
    });
    client.on("error", reject);
    client.end(JSON.stringify(body));
  });
}

test("MCP rejects oversized JSON structures before validation on both authenticated routes", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  const wide = Array(10_001).fill(null);
  const aggregate = Array.from({ length: 101 }, () => Array(100).fill(null));
  const members = Object.fromEntries(wide.map((_, index) => [String(index), null]));
  let deep = null;
  for (let level = 0; level < 65; level++) deep = { nested: deep };
  try {
    for (const requestPath of ["/mcp", "/assistant-mcp"]) {
      const headers =
        requestPath === "/mcp"
          ? EXTERNAL_AUTH
          : module.getAssistantMcpServerConfig("fixture").headers;
      const client = new Client({ name: "input-budget-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}${requestPath}`),
        { requestInit: { headers } },
      );
      try {
        const initialization = await rawMcpRequest(
          port,
          headers,
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "invalid-icons", version: "1.0.0", icons: wide },
            },
          },
          requestPath,
        );
        assert.equal(initialization.status, 413);
        await client.connect(transport);
        const sessionHeaders = { ...headers, "mcp-session-id": transport.sessionId };
        for (const body of [
          wide,
          { jsonrpc: "2.0", id: 2, method: "initialize", params: { _meta: { wide } } },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "list_reminders", arguments: { aggregate } },
          },
          { jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: { deep } } },
          { jsonrpc: "2.0", id: 5, method: "tools/list", params: { _meta: { members } } },
        ]) {
          assert.ok(Buffer.byteLength(JSON.stringify(body)) < 1024 * 1024);
          const result = await rawMcpRequest(port, sessionHeaders, body, requestPath);
          assert.equal(result.status, 413);
          assert.match(result.body, /MCP request too complex/);
        }
        assert.ok((await client.listTools()).tools.length > 0);
        const ordinary = await client.callTool({
          name: "list_reminders",
          arguments: { optional: Array(100).fill(null), notes: "x".repeat(20_000) },
        });
        assert.notEqual(ordinary.isError, true);
        assert.equal(await rawRequest(port, {}, requestPath), 401);
      } finally {
        await transport.terminateSession().catch(() => undefined);
        await client.close();
      }
    }
  } finally {
    await close(server);
  }
});

test("Assistant MCP exposes exactly six read-only tools and rejects unauthenticated or foreign requests", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  try {
    const config = module.getAssistantMcpServerConfig("fixture");
    const url = new URL(`http://127.0.0.1:${port}/assistant-mcp`);
    const client = new Client({ name: "mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: config.headers },
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
        "get_weekly_review",
        "list_events",
        "list_inbox",
        "list_reminders",
        "list_tasks",
        "read_email",
      ]);
      const write = await client.callTool({ name: "create_task", arguments: { title: "nope" } });
      assert.equal(write.isError, true);
    } finally {
      await transport.terminateSession();
      await client.close();
    }

    const externalClient = new Client({ name: "external-mcp-test", version: "1.0.0" });
    try {
      await externalClient.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
          requestInit: { headers: EXTERNAL_AUTH },
        }),
      );
      assert.equal((await externalClient.listTools()).tools.length, 17);
    } finally {
      await externalClient.close();
    }

    assert.equal(await rawRequest(port, {}), 401);
    assert.equal(await rawRequest(port, { origin: "https://example.test" }), 403);
    assert.equal(await rawRequest(port, { host: "example.test" }), 403);

    const clientBuild = await build({
      entryPoints: [path.join(root, "main/services/ai/mcp-client.ts")],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      logLevel: "silent",
      plugins: [
        {
          name: "offline-client",
          setup(api) {
            api.onResolve({ filter: /^@modelcontextprotocol\/sdk\/client\/stdio\.js$/ }, () => ({
              path: "stdio",
              namespace: "offline-client",
            }));
            api.onResolve(
              { filter: /(?:^|\/)platform\/index\.(?:js|ts)$|shell-env\.js$/ },
              (args) => ({ path: args.path, namespace: "offline-client" }),
            );
            api.onLoad({ filter: /.*/, namespace: "offline-client" }, (args) => ({
              contents:
                args.path === "stdio"
                  ? 'export class StdioClientTransport { constructor() { throw new Error("No stdio processes in this fixture"); } }'
                  : `${backendStub}\nexport const getToolEnv = async () => ({}); export const toStringEnv = (env) => env;`,
              loader: "js",
            }));
          },
        },
      ],
    });
    const { openMcpSession } = await import(
      `data:text/javascript;base64,${Buffer.from(clientBuild.outputFiles[0].text).toString("base64")}`
    ).catch((error) => {
      throw new Error(error.message);
    });
    let sessionId;
    server.on("request", (request) => {
      if (request.headers["mcp-session-id"]) sessionId = request.headers["mcp-session-id"];
    });
    const session = await openMcpSession([{ ...config, url: url.toString() }]);
    assert.equal(session.tools.length, 6);
    const previousSessionId = sessionId;
    assert.ok(previousSessionId);
    await session.close();
    const terminated = await rawMcpRequest(
      port,
      { ...config.headers, "mcp-session-id": previousSessionId },
      { jsonrpc: "2.0", id: 4, method: "tools/list" },
    );
    assert.equal(
      terminated.status,
      400,
      "closing an HTTP client must invalidate its server session",
    );
  } finally {
    await close(server);
  }
});

test("Assistant MCP resolver honors the global switch and replaces same-app write-capable loopback configs", async () => {
  const { module, builtIn } = await loadResolverHarness();
  const sameApp = {
    ...builtIn,
    id: "saved-dashboard",
    url: "http://localhost:62895/mcp/",
    headers: {},
  };
  const savedAssistant = {
    ...builtIn,
    id: "saved-assistant",
    url: "http://[::1]:62895/assistant-mcp/",
  };
  const external = {
    ...builtIn,
    id: "external",
    name: "External",
    url: "https://example.test/mcp",
  };
  const disabled = { ...external, id: "disabled", enabled: false };
  const saved = [sameApp, savedAssistant, external, disabled];
  const before = globalThis.structuredClone(saved);

  assert.deepEqual(module.resolveAssistantMcpServers(false, saved, builtIn), []);
  assert.deepEqual(
    module.resolveAssistantMcpServers(true, saved, builtIn).map((server) => server.id),
    [builtIn.id, external.id],
  );
  assert.deepEqual(
    module.resolveAssistantMcpServers(true, saved, null).map((server) => server.id),
    [sameApp.id, savedAssistant.id, external.id],
  );
  assert.deepEqual(saved, before);
});

test("the installed app keeps port 54809 and every other profile gets its own stable port", async () => {
  const module = await loadMcpHarness();
  const installed = module.stableMcpPort(module.mcpProjectIdForProfile(undefined));
  assert.equal(installed, 54809, "clients set up from Settings point at this port");
  const dev = module.stableMcpPort(module.mcpProjectIdForProfile("/tmp/DayBoard License Test"));
  const other = module.stableMcpPort(module.mcpProjectIdForProfile("/tmp/DayBoard License Test 2"));
  assert.notEqual(dev, installed);
  assert.notEqual(other, dev);
  assert.equal(
    module.stableMcpPort(module.mcpProjectIdForProfile("/tmp/DayBoard License Test")),
    dev,
    "a profile keeps its port across launches",
  );
  for (const port of [installed, dev, other]) {
    assert.ok(port >= 49152 && port < 65152, `${port} is a dynamic port`);
  }
});

function listenOn(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function eventually(read) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the MCP server state to change");
}

test("a busy MCP port says why instead of 'starting', and the server starts once it's free", async () => {
  const module = await loadMcpHarness();
  const blocker = createServer();
  let projectId;
  let port;
  for (let attempt = 0; port === undefined; attempt++) {
    projectId = `busy-port-${process.pid}-${attempt}`;
    try {
      await listenOn(blocker, module.stableMcpPort(projectId));
      port = module.stableMcpPort(projectId);
    } catch {
      // Something else already holds that port; try another project id.
    }
  }
  const server = module.startMcpHttpServer(projectId, 20);
  try {
    const error = await eventually(() => module.getExternalMcpStartError());
    assert.equal(
      error,
      `Port ${port} is in use, probably by another copy of DayBoard. Quit it and DayBoard's MCP server starts on its own.`,
    );
    assert.equal(module.getExternalMcpUrl(), null);

    await close(blocker);
    assert.equal(
      await eventually(() => module.getExternalMcpUrl()),
      `http://127.0.0.1:${port}/mcp`,
    );
    assert.equal(module.getExternalMcpStartError(), null);
    const client = new Client({ name: "after-retry", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(module.getExternalMcpUrl()), {
      requestInit: { headers: EXTERNAL_AUTH },
    });
    try {
      await client.connect(transport);
      assert.ok((await client.listTools()).tools.length > 0);
    } finally {
      await transport.terminateSession().catch(() => undefined);
      await client.close();
    }
  } finally {
    if (blocker.listening) await close(blocker);
    await module.checkAssistantMcpConnection();
    await close(server);
  }
});

test("External MCP is keyed, can be turned off, and hides or blocks writes when changes are off", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  try {
    globalThis.__mcpServerSettings = { enabled: false, allowWrites: true };
    // 503, not 403: clients would otherwise report the (valid) key as rejected.
    assert.deepEqual(
      await rawMcpRequest(
        port,
        EXTERNAL_AUTH,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
        "/mcp",
      ),
      {
        status: 503,
        body: "DayBoard's MCP server is turned off. Turn it on in Settings → MCP Servers.",
      },
      "off refuses even a valid key",
    );

    globalThis.__mcpServerSettings = { enabled: true, allowWrites: false };
    assert.equal(await rawRequest(port, {}, "/mcp"), 401, "missing key");
    assert.equal(
      await rawRequest(port, { authorization: "Bearer wrong" }, "/mcp"),
      401,
      "wrong key",
    );
    assert.equal(await rawRequest(port, { ...EXTERNAL_AUTH, host: "example.test" }, "/mcp"), 403);

    const readOnly = new Client({ name: "read-only", version: "1.0.0" });
    const readOnlyTransport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: EXTERNAL_AUTH },
    });
    try {
      await readOnly.connect(readOnlyTransport);
      assert.deepEqual((await readOnly.listTools()).tools.map((tool) => tool.name).sort(), [
        "get_weekly_review",
        "list_events",
        "list_inbox",
        "list_memories",
        "list_notes",
        "list_reminders",
        "read_email",
        "read_note",
      ]);
    } finally {
      await readOnlyTransport.terminateSession();
      await readOnly.close();
    }

    globalThis.__mcpServerSettings = { enabled: true, allowWrites: true };
    const writer = new Client({ name: "writer", version: "1.0.0" });
    const writerTransport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: EXTERNAL_AUTH },
    });
    try {
      await writer.connect(writerTransport);
      const writerTools = (await writer.listTools()).tools.map((tool) => tool.name);
      assert.equal(writerTools.length, 17);
      // Outside AI tools get no Google Tasks at all.
      for (const google of ["list_tasks", "create_task", "complete_task"])
        assert.ok(!writerTools.includes(google), google);
      // An expired AI license neither blocks source writes nor starts the AI trial.
      globalThis.__mcpLicenseBlocked = true;
      globalThis.__mcpLicenseCalls = 0;
      globalThis.__mcpReminderResult = { identity: "expired-ai-reminder", recurring: false };
      const unlicensed = await writer.callTool({
        name: "complete_reminder",
        arguments: { ref: "expired-ai-ref", completed: true },
      });
      assert.notEqual(unlicensed.isError, true);
      assert.match(unlicensed.content[0].text, /Reminder marked done/);
      assert.equal(globalThis.__mcpLicenseCalls, 0);
      const stillReadable = await writer.callTool({ name: "list_reminders", arguments: {} });
      assert.notEqual(stillReadable.isError, true);
      delete globalThis.__mcpReminderResult;
      // Turning changes off applies to sessions that are already open.
      globalThis.__mcpServerSettings = { enabled: true, allowWrites: false };
      // The Allow changes switch still blocks writes, with the AI license still expired.
      const blocked = await writer.callTool({
        name: "create_reminder",
        arguments: { title: "nope" },
      });
      assert.equal(blocked.isError, true);
      assert.match(blocked.content[0].text, /Allow changes/);
      assert.equal(globalThis.__mcpLicenseCalls, 0);
      delete globalThis.__mcpLicenseBlocked;
    } finally {
      await writerTransport.terminateSession().catch(() => undefined);
      await writer.close();
    }
  } finally {
    delete globalThis.__mcpServerSettings;
    delete globalThis.__mcpLicenseBlocked;
    delete globalThis.__mcpLicenseCalls;
    delete globalThis.__mcpReminderResult;
    await close(server);
  }
});

test("an MCP reminder write reports link reconciliation separately from its confirmed provider result", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  try {
    globalThis.__mcpServerSettings = { enabled: true, allowWrites: true };
    globalThis.__mcpGoogleStatus = { connected: false, email: null };
    globalThis.__mcpReminderResult = { identity: "stable-reminder", recurring: false };
    globalThis.__mcpReconcileError = true;
    globalThis.__mcpBroadcasts = [];
    const client = new Client({ name: "reminder-write", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: EXTERNAL_AUTH },
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "complete_reminder",
        arguments: { ref: "old-ref", completed: true },
      });
      assert.notEqual(result.isError, true);
      assert.match(result.content[0].text, /Reminder marked done/);
      assert.match(result.content[0].text, /could not update its saved link yet/);
      assert.ok(
        globalThis.__mcpBroadcasts.some(
          ([channel, event]) => channel === "data:changed" && event.source === "reminders",
        ),
      );
    } finally {
      await transport.terminateSession().catch(() => undefined);
      await client.close();
    }
  } finally {
    delete globalThis.__mcpServerSettings;
    delete globalThis.__mcpGoogleStatus;
    delete globalThis.__mcpReminderResult;
    delete globalThis.__mcpReconcileError;
    delete globalThis.__mcpBroadcasts;
    await close(server);
  }
});

test("an existing MCP client cannot start source changes while update installation is paused", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  const client = new Client({ name: "update-gate-fixture", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: EXTERNAL_AUTH },
  });
  try {
    await client.connect(transport);
    await module.pauseAndDrainAppOperations();
    const result = await client.callTool({
      name: "create_reminder",
      arguments: { title: "blocked fixture" },
    });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /preparing to install/);
    module.resumeAppOperations();
    const read = await client.callTool({ name: "list_reminders", arguments: {} });
    assert.notEqual(read.isError, true);
  } finally {
    module.resumeAppOperations();
    await transport.terminateSession().catch(() => undefined);
    await client.close();
    await close(server);
  }
});

test("MCP tools read and write DayBoard memory and notes, and every call lands in the activity log", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  globalThis.__mcpAgent = { activity: [], memories: [], notes: [] };
  globalThis.__mcpServerSettings = { enabled: true, allowWrites: true };
  const client = new Client({ name: "notes-agent", version: "2.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: EXTERNAL_AUTH },
  });
  try {
    await client.connect(transport);
    const remembered = await client.callTool({
      name: "remember",
      arguments: { text: "Prefers morning meetings" },
    });
    assert.notEqual(remembered.isError, true);
    assert.deepEqual(
      globalThis.__mcpAgent.memories.map(({ text, source }) => ({ text, source })),
      [{ text: "Prefers morning meetings", source: "agent" }],
    );
    const memories = await client.callTool({ name: "list_memories", arguments: {} });
    assert.deepEqual(JSON.parse(memories.content[0].text), {
      memories: [{ text: "Prefers morning meetings", source: "agent" }],
    });

    const created = await client.callTool({
      name: "create_note",
      arguments: { body: "Trip plan\n- Book hotel" },
    });
    const id = JSON.parse(created.content[0].text).created.id;
    await client.callTool({
      name: "update_note",
      arguments: { note_id: id, body: "Trip plan\n- Book hotel\n- Rent a car" },
    });
    const read = await client.callTool({ name: "read_note", arguments: { note_id: id } });
    assert.match(JSON.parse(read.content[0].text).body, /Rent a car/);
    const missing = await client.callTool({ name: "read_note", arguments: { note_id: "nope" } });
    assert.equal(missing.isError, true);

    // Turning changes off blocks DayBoard's own writes too, for sessions already open.
    globalThis.__mcpServerSettings = { enabled: true, allowWrites: false };
    const blocked = await client.callTool({ name: "remember", arguments: { text: "Nope" } });
    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /Allow changes/);
    assert.equal(globalThis.__mcpAgent.memories.length, 1);

    assert.deepEqual(
      globalThis.__mcpAgent.activity.map(({ tool, client: caller, ok }) => [tool, caller, ok]),
      [
        ["remember", "notes-agent", true],
        ["list_memories", "notes-agent", true],
        ["create_note", "notes-agent", true],
        ["update_note", "notes-agent", true],
        ["read_note", "notes-agent", true],
        ["read_note", "notes-agent", false],
        ["remember", "notes-agent", false],
      ],
    );
    assert.match(globalThis.__mcpAgent.activity.at(-1).error, /Allow changes/);
    assert.ok(globalThis.__mcpAgent.activity.every((call) => call.durationMs >= 0));
  } finally {
    delete globalThis.__mcpServerSettings;
    delete globalThis.__mcpAgent;
    await transport.terminateSession().catch(() => undefined);
    await client.close();
    await close(server);
  }
});

test("Google Calendar and Google Tasks reach only Assistant providers that don't train on them, and never outside AI tools", async () => {
  const module = await loadMcpHarness();
  const server = module.createMcpHttpServer();
  const port = await listen(server);
  const googleEvent = {
    id: "g-1",
    title: "Google board meeting",
    start: "2026-11-28T09:00:00-08:00",
    end: "2026-11-28T10:00:00-08:00",
    allDay: false,
    calendarId: "primary",
    calendarName: "Work",
  };
  globalThis.__mcpGoogleEvents = [googleEvent];
  globalThis.__mcpGoogleTasks = [{ id: "t-1", title: "Google tax filing" }];
  globalThis.__mcpCompletedGoogleTasks = [{ id: "t-2", title: "Google budget review" }];
  globalThis.__mcpServerSettings = { enabled: true, allowWrites: true };
  globalThis.__mcpGoogleStatus = { connected: true, email: "user@example.test" };
  const connect = async (path, headers, inProcessTransport = null) => {
    const client = new Client({ name: "google-gate", version: "1.0.0" });
    const transport =
      inProcessTransport ??
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}${path}`), {
        requestInit: { headers },
      });
    await client.connect(transport);
    return {
      call: async (name, args = {}) =>
        (await client.callTool({ name, arguments: args })).content[0].text,
      result: (name, args = {}) => client.callTool({ name, arguments: args }),
      close: async () => {
        if (!inProcessTransport) await transport.terminateSession().catch(() => undefined);
        await client.close();
      },
    };
  };
  try {
    const assistantConfig = module.getAssistantMcpServerConfig("fixture");
    const assistantHeaders = assistantConfig.headers;
    globalThis.__mcpAiSettings = { provider: "claude", assistantProvider: "" };
    const cli = await connect("/assistant-mcp", assistantHeaders);
    try {
      assert.doesNotMatch(await cli.call("list_tasks"), /Google tax filing/);
      globalThis.__mcpAiSettings = { provider: "openai", assistantProvider: "" };
      assert.doesNotMatch(await cli.call("list_tasks"), /Google tax filing/);
      assert.doesNotMatch(await cli.call("list_events"), /Google board meeting/);
      assert.doesNotMatch(
        await cli.call("get_weekly_review"),
        /Google board meeting|Google budget review/,
      );
      assert.equal(globalThis.__mcpGoogleCalendarCalls ?? 0, 0, "CLI never read Google Calendar");
    } finally {
      await cli.close();
    }
    assert.equal(await module.createAssistantMcpTransport({ ...assistantConfig }, "openai"), null);
    const cases = [
      ["openai", true],
      ["anthropic", true],
      ["groq", true],
      ["xai", true],
      ["openrouter", true],
      ["claude", false],
      ["codex", false],
      ["google", false],
      ["deepseek", false],
    ];
    for (const [provider, shared] of cases) {
      // Deliberately set the global preference to the opposite access decision.
      globalThis.__mcpAiSettings = {
        provider: shared ? "claude" : "openai",
        assistantProvider: "",
      };
      const inProcess = await module.createAssistantMcpTransport(assistantConfig, provider);
      assert.equal(Boolean(inProcess), shared, `${provider} private connection`);
      const assistant = await connect("/assistant-mcp", assistantHeaders, inProcess);
      try {
        const tasks = await assistant.call("list_tasks");
        const events = await assistant.call("list_events");
        const review = await assistant.call("get_weekly_review");
        assert.equal(tasks.includes("Google tax filing"), shared, `${provider} tasks`);
        assert.equal(events.includes("Google board meeting"), shared, `${provider} events`);
        assert.equal(review.includes("Google board meeting"), shared, `${provider} review`);
        assert.equal(
          review.includes("Google budget review"),
          shared,
          `${provider} completed tasks`,
        );
        if (!shared) {
          assert.match(tasks, /aren't shared with this AI provider/);
          assert.match(events, /aren't shared with this AI provider/);
        }
      } finally {
        await assistant.close();
      }
    }

    // Outside AI tools: Google Calendar isn't even read, and Google writes are refused.
    globalThis.__mcpAiSettings = { provider: "openai", assistantProvider: "" };
    globalThis.__mcpGoogleCalendarCalls = 0;
    const external = await connect("/mcp", EXTERNAL_AUTH);
    try {
      const events = await external.call("list_events");
      assert.ok(!events.includes("Google board meeting"));
      assert.match(events, /Google Calendar isn't shared with outside AI tools/);
      const review = await external.call("get_weekly_review");
      assert.ok(!review.includes("Google board meeting"));
      assert.equal(globalThis.__mcpGoogleCalendarCalls, 0, "Google Calendar was never called");
      const created = await external.result("create_event", {
        title: "nope",
        date: "2026-12-01",
      });
      assert.equal(created.isError, true);
      assert.match(created.content[0].text, /outside AI tools can't change/);
      const tasks = await external.result("list_tasks");
      assert.equal(tasks.isError, true);
    } finally {
      await external.close();
    }
  } finally {
    delete globalThis.__mcpGoogleEvents;
    delete globalThis.__mcpGoogleTasks;
    delete globalThis.__mcpCompletedGoogleTasks;
    delete globalThis.__mcpGoogleCalendarCalls;
    delete globalThis.__mcpAiSettings;
    delete globalThis.__mcpServerSettings;
    delete globalThis.__mcpGoogleStatus;
    await close(server);
  }
});
