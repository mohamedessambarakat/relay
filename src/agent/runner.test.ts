import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app.ts";
import { openDb } from "../server/db.ts";
import { EventBus } from "../server/events.ts";
import { Store } from "../server/store.ts";
import type { Status } from "../shared/types.ts";
import { ModelSettings } from "./models.ts";
import { Runner, type RunProcess } from "./runner.ts";

class FakeProc extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  written: string[] = [];
  killed = false;
  token: string;
  constructor(
    public args: string[],
    public cwd: string,
  ) {
    super();
    this.stdin.on("data", (d: Buffer) => this.written.push(d.toString()));
    // The runner deletes the MCP config when the run ends, so read the token at launch.
    const file = args[args.indexOf("--mcp-config") + 1]!;
    this.token = JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.relay.env.RELAY_TOKEN;
  }
  kill() {
    this.killed = true;
    setImmediate(() => this.emit("exit", null));
  }
  line(obj: unknown) {
    this.stdout.write(JSON.stringify(obj) + "\n");
  }
}

const PORT = 4317;
const ORIGIN = `http://localhost:${PORT}`;
let tmp: string;
let store: Store;
let runner: Runner;
let procs: FakeProc[];
let pushes: { key: string; status: Status }[];
let app: ReturnType<typeof createApp>;

const flush = () => new Promise((r) => setTimeout(r, 20));

function req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(url, {
    method,
    headers: { host: `localhost:${PORT}`, "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const board = (method: string, url: string, body?: unknown) => req(method, url, body, { origin: ORIGIN });
const agent = (token: string, method: string, url: string, body?: unknown) => req(method, url, body, { authorization: `Bearer ${token}` });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));
  const bus = new EventBus();
  store = new Store(openDb(":memory:"), bus);
  procs = [];
  pushes = [];
  const models = new ModelSettings(store, path.join(tmp, "no-agents"));
  runner = new Runner({
    store,
    models,
    notifier: { enabled: true, ticketStatus: async (key, _title, status) => void pushes.push({ key, status }) },
    keepAwake: { set: () => undefined, active: false },
    serverUrl: `http://127.0.0.1:${PORT}`,
    workspacesDir: path.join(tmp, "ws"),
    runFilesDir: path.join(tmp, "runs"),
    prepare: async (root, key) => ({ dir: path.join(root, key), branch: null, kind: "folder" }),
    launch: (args, cwd) => {
      const p = new FakeProc(args, cwd);
      procs.push(p);
      return p as unknown as RunProcess;
    },
    mcpCommand: { command: "node", args: ["mcp.js"] },
  });
  app = createApp({ store, bus, runner, models, port: PORT, attachmentsDir: path.join(tmp, "att") });
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function readyTickets(n: number) {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await board("POST", "/api/tickets", { title: `Ticket ${i + 1}`, status: "agent_ready", priority: 2 });
    expect(res.status).toBe(201);
    ids.push(((await res.json()) as { id: number }).id);
    await new Promise((r) => setTimeout(r, 3));
  }
  await flush();
  return ids;
}

describe("Runner", () => {
  it("runs 3 tickets at once and queues the 4th", async () => {
    const ids = await readyTickets(4);
    expect(procs).toHaveLength(3);
    expect(ids.map((id) => store.runInfo(id).runState)).toEqual(["running", "running", "running", "queued"]);
    expect(store.listTickets().find((t) => t.id === ids[3])!.queuePosition).toBe(1);
    expect(procs[0]!.args).toEqual(expect.arrayContaining(["-p", "--input-format", "stream-json", "--dangerously-skip-permissions", "--model", "opus"]));
    expect(procs[0]!.written[0]).toContain("Ticket 1");
  });

  it("injects an @agent comment into the running session and logs it", async () => {
    const [id] = await readyTickets(1);
    const res = await board("POST", `/api/tickets/${id}/comments`, { body: "@agent also add it to the footer" });
    expect(res.status).toBe(201);
    expect(procs[0]!.written.at(-1)).toContain("also add it to the footer");
    expect(store.getTicket(id!).log.some((l) => l.kind === "user")).toBe(true);
  });

  it("finishes in Review with a final comment and a push, then starts the next ticket", async () => {
    const ids = await readyTickets(4);
    const p = procs[0]!;
    p.line({ type: "system", subtype: "init", session_id: "sess-1" });
    await flush();

    // The agent must comment before setting the status.
    expect((await agent(p.token, "POST", "/api/agent/status", { status: "review" })).status).toBe(409);
    expect((await agent(p.token, "POST", "/api/agent/comments", { body: "Done. Confidence: high." })).status).toBe(201);
    expect((await agent(p.token, "POST", "/api/agent/status", { status: "review" })).status).toBe(200);
    expect(p.stdin.writableEnded).toBe(true);

    p.emit("exit", 0);
    await flush();
    expect(store.runInfo(ids[0]!)).toMatchObject({ status: "review", runState: "idle", sessionId: "sess-1" });
    expect(pushes).toEqual([{ key: `R-${ids[0]}`, status: "review" }]);
    expect(procs).toHaveLength(4);
    expect(store.runInfo(ids[3]!).runState).toBe("running");
  });

  it("scopes the agent token to its own ticket and drops it after the run", async () => {
    const [a] = await readyTickets(2);
    const p = procs[0]!;
    const res = await agent(p.token, "GET", "/api/agent/ticket");
    expect(((await res.json()) as { id: number }).id).toBe(a);
    expect((await agent("bogus", "GET", "/api/agent/ticket")).status).toBe(403);
    await board("POST", `/api/tickets/${a}/stop`);
    await flush();
    expect((await agent(p.token, "GET", "/api/agent/ticket")).status).toBe(403);
  });

  it("resumes the session when an @agent comment lands on a Review ticket", async () => {
    const [id] = await readyTickets(1);
    const p = procs[0]!;
    p.line({ type: "system", subtype: "init", session_id: "sess-9" });
    await agent(p.token, "POST", "/api/agent/comments", { body: "done" });
    await agent(p.token, "POST", "/api/agent/status", { status: "review" });
    p.emit("exit", 0);
    await flush();

    await board("POST", `/api/tickets/${id}/comments`, { body: "@agent make the button bigger" });
    await flush();
    expect(store.runInfo(id!).status).toBe("agent_ready");
    const resumed = procs[1]!;
    expect(resumed.args).toEqual(expect.arrayContaining(["--resume", "sess-9"]));
    expect(resumed.written[0]).toContain("make the button bigger");
  });

  it("stops a run and moves it to Blocked", async () => {
    const [id] = await readyTickets(1);
    const res = await board("POST", `/api/tickets/${id}/stop`);
    expect(res.status).toBe(200);
    await flush();
    expect(procs[0]!.killed).toBe(true);
    expect(store.runInfo(id!)).toMatchObject({ status: "blocked", runState: "idle" });
  });

  it("retries a crashed run once, then blocks it", async () => {
    const [id] = await readyTickets(1);
    procs[0]!.emit("exit", 1);
    await flush();
    expect(procs).toHaveLength(2);
    expect(store.runInfo(id!).status).toBe("agent_ready");
    procs[1]!.emit("exit", 1);
    await flush();
    expect(store.runInfo(id!).status).toBe("blocked");
    expect(pushes.at(-1)).toEqual({ key: `R-${id}`, status: "blocked" });
  });

  it("pauses on the usage limit and starts nothing new until the reset", async () => {
    const ids = await readyTickets(4);
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    const p = procs[0]!;
    p.line({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt } });
    p.line({ type: "result", is_error: true });
    await flush();
    expect(p.killed).toBe(true);
    await flush();
    expect(store.runInfo(ids[0]!).runState).toBe("waiting_limit");
    expect(runner.systemState().limitResetAt).toBe(new Date(resetsAt * 1000).toISOString());
    expect(procs).toHaveLength(3); // the queued 4th didn't start
    expect(store.runInfo(ids[3]!).runState).toBe("queued");
  });

  it("rejects board writes from another origin", async () => {
    const res = await req("POST", "/api/tickets", { title: "x" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(store.listTickets()).toHaveLength(0);
  });

  it("validates request bodies", async () => {
    const res = await board("POST", "/api/tickets", { title: "", priority: 9 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("invalid_body");
  });
});
