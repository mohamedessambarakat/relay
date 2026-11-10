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
    public command: string,
    public args: string[],
    public cwd: string,
  ) {
    super();
    this.stdin.on("data", (d: Buffer) => this.written.push(d.toString()));
    if (args.includes("--mcp-config")) {
      // The runner deletes the MCP config when the run ends, so read the token at launch.
      const file = args[args.indexOf("--mcp-config") + 1]!;
      this.token = JSON.parse(fs.readFileSync(file, "utf8")).mcpServers.relay.env.RELAY_TOKEN;
    } else {
      // Codex gets the MCP server as a -c TOML override.
      const env = args.find((a) => a.startsWith("mcp_servers.relay.env="))!;
      this.token = /RELAY_TOKEN="([^"]+)"/.exec(env)![1]!;
    }
  }
  kill() {
    this.killed = true;
    setImmediate(() => this.emit("close", null));
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
    launch: (command, args, cwd) => {
      const p = new FakeProc(command, args, cwd);
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
    // Running tickets move to In Progress; the waiting one stays in Agent Ready.
    expect(ids.map((id) => store.runInfo(id).status)).toEqual(["in_progress", "in_progress", "in_progress", "agent_ready"]);
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

    p.emit("close", 0);
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
    p.emit("close", 0);
    await flush();

    await board("POST", `/api/tickets/${id}/comments`, { body: "@agent make the button bigger" });
    await flush();
    expect(store.runInfo(id!).status).toBe("in_progress");
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
    procs[0]!.emit("close", 1);
    await flush();
    expect(procs).toHaveLength(2);
    expect(store.runInfo(id!).status).toBe("in_progress");
    procs[1]!.emit("close", 1);
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
    expect(store.runInfo(ids[0]!)).toMatchObject({ status: "agent_ready", runState: "waiting_limit" });
    expect(runner.systemState().limitResetAt).toBe(new Date(resetsAt * 1000).toISOString());
    expect(procs).toHaveLength(3); // the queued 4th didn't start
    expect(store.runInfo(ids[3]!).runState).toBe("queued");
  });

  it("doesn't let the user move a ticket to In Progress", async () => {
    const res = await board("POST", "/api/tickets", { title: "x" });
    const { id } = (await res.json()) as { id: number };
    expect((await board("POST", `/api/tickets/${id}/status`, { status: "in_progress" })).status).toBe(409);
  });

  it("kills the run when the user moves an In Progress ticket away", async () => {
    const [id] = await readyTickets(1);
    expect((await board("POST", `/api/tickets/${id}/status`, { status: "todo" })).status).toBe(200);
    await flush();
    expect(procs[0]!.killed).toBe(true);
    expect(store.runInfo(id!)).toMatchObject({ status: "todo", runState: "idle" });
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
  it("sends the ticket back to work when an @agent comment lands after the agent set Review but before it exited", async () => {
    const [id] = await readyTickets(1);
    const p = procs[0]!;
    p.line({ type: "system", subtype: "init", session_id: "sess-late" });
    await agent(p.token, "POST", "/api/agent/comments", { body: "done" });
    await agent(p.token, "POST", "/api/agent/status", { status: "review" });
    await board("POST", `/api/tickets/${id}/comments`, { body: "@agent one more thing" });
    p.emit("close", 0);
    await flush();
    expect(store.runInfo(id!).status).toBe("in_progress");
    expect(procs[1]!.args).toEqual(expect.arrayContaining(["--resume", "sess-late"]));
    expect(procs[1]!.written.join("")).toContain("one more thing");
  });

  describe("with Codex", () => {
    async function codexTicket(extra: Record<string, unknown> = {}) {
      const res = await board("POST", "/api/tickets", { title: "Codex job", status: "agent_ready", provider: "codex", ...extra });
      expect(res.status).toBe(201);
      await flush();
      return ((await res.json()) as { id: number }).id;
    }

    it("runs codex exec with the message on stdin, Relay's MCP server and the ticket's model", async () => {
      await codexTicket({ model: "gpt-5.6-luna" });
      const p = procs[0]!;
      expect(p.args).toEqual(expect.arrayContaining(["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "-m", "gpt-5.6-luna", "-"]));
      expect(p.args.some((a) => a.startsWith("developer_instructions="))).toBe(true);
      expect(p.args).not.toContain("resume");
      expect(p.written.join("")).toContain("Codex job");
      expect(p.stdin.writableEnded).toBe(true);
    });

    it("uses the Settings default provider and Codex model when the ticket has none", async () => {
      expect((await board("PUT", "/api/settings/provider", { provider: "codex", codexModel: "gpt-5.6-terra" })).status).toBe(200);
      await readyTickets(1);
      expect(procs[0]!.args).toEqual(expect.arrayContaining(["exec", "-m", "gpt-5.6-terra"]));
    });

    it("holds an @agent comment during a turn and resumes the session with it after", async () => {
      const id = await codexTicket();
      const p = procs[0]!;
      p.line({ type: "thread.started", thread_id: "th-1" });
      p.line({ type: "turn.started" });
      await flush();
      await board("POST", `/api/tickets/${id}/comments`, { body: "@agent use blue" });
      await flush();
      expect(procs).toHaveLength(1);

      p.line({ type: "turn.completed", usage: {} });
      p.emit("close", 0);
      await flush();
      const next = procs[1]!;
      expect(next.args).toEqual(expect.arrayContaining(["exec", "resume", "th-1"]));
      expect(next.written.join("")).toContain("use blue");
      expect(next.token).toBe(p.token); // same run, same token
      expect(store.runInfo(id).status).toBe("in_progress");
    });

    it("nudges once when a turn ends without a status, then fails the run", async () => {
      const id = await codexTicket();
      procs[0]!.line({ type: "thread.started", thread_id: "th-2" });
      await flush();
      procs[0]!.emit("close", 0);
      await flush();
      expect(procs[1]!.args).toEqual(expect.arrayContaining(["resume", "th-2"]));
      procs[1]!.emit("close", 0);
      await flush();
      // The failure retries once with a fresh launch that resumes the session.
      expect(store.getTicket(id).comments.at(-1)?.body).toContain("will retry once");
    });

    it("ends normally once the agent sets Review", async () => {
      const id = await codexTicket();
      const p = procs[0]!;
      p.line({ type: "thread.started", thread_id: "th-3" });
      await flush();
      await agent(p.token, "POST", "/api/agent/comments", { body: "Done." });
      await agent(p.token, "POST", "/api/agent/status", { status: "review" });
      p.emit("close", 0);
      await flush();
      expect(procs).toHaveLength(1);
      expect(store.runInfo(id)).toMatchObject({ status: "review", runState: "idle", sessionId: "th-3", sessionProvider: "codex" });
    });

    it("doesn't resume a Claude session with Codex", async () => {
      const [id] = await readyTickets(1);
      const p = procs[0]!;
      p.line({ type: "system", subtype: "init", session_id: "claude-sess" });
      await agent(p.token, "POST", "/api/agent/comments", { body: "done" });
      await agent(p.token, "POST", "/api/agent/status", { status: "review" });
      p.emit("close", 0);
      await flush();
      await board("PATCH", `/api/tickets/${id}`, { provider: "codex" });
      await board("POST", `/api/tickets/${id}/comments`, { body: "@agent one more thing" });
      await flush();
      expect(procs[1]!.args).not.toContain("resume");
      expect(procs[1]!.args).not.toContain("claude-sess");
    });
    it("sends the ticket back to work when a comment arrived during the agent's last turn", async () => {
      const id = await codexTicket();
      const p = procs[0]!;
      p.line({ type: "thread.started", thread_id: "th-4" });
      await flush();
      await board("POST", `/api/tickets/${id}/comments`, { body: "@agent also do the footer" });
      await agent(p.token, "POST", "/api/agent/comments", { body: "Done." });
      await agent(p.token, "POST", "/api/agent/status", { status: "review" });
      p.emit("close", 0);
      await flush();
      expect(store.runInfo(id).status).toBe("in_progress");
      expect(procs[1]!.args).toEqual(expect.arrayContaining(["resume", "th-4"]));
      expect(procs[1]!.written.join("")).toContain("also do the footer");
    });

    it("waits for the reset when a Codex turn fails on the usage limit", async () => {
      const id = await codexTicket();
      const p = procs[0]!;
      p.line({ type: "thread.started", thread_id: "th-5" });
      p.line({ type: "turn.failed", error: { message: "You've hit your usage limit." } });
      await flush();
      p.emit("close", 1);
      await flush();
      expect(store.runInfo(id)).toMatchObject({ status: "agent_ready", runState: "waiting_limit" });
    });

    it("ignores a Claude model on the ticket when the run uses Codex", async () => {
      await codexTicket({ model: "opus" });
      expect(procs[0]!.args).not.toContain("opus");
      expect(procs[0]!.args).not.toContain("-m");
    });
  });
});
