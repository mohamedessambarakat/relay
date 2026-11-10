import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import type { RunnerPort } from "../server/app.ts";
import type { Store } from "../server/store.ts";
import { ticketKey, type Comment, type Status, type SystemState, type TicketDetail } from "../shared/types.ts";
import type { ModelSettings } from "./models.ts";
import type { Notifier } from "./notify.ts";
import { firstMessage, injectMessage, limitResumeMessage, nudgeMessage, resumeMessage, systemPrompt } from "./prompt.ts";
import { PROVIDER_IMPLS, type McpCommand, type Provider } from "./providers.ts";
import { prepareWorkspace, type Workspace } from "./workspace.ts";

export const MAX_PARALLEL = 3;
const IDLE_MS = 10 * 60 * 1000;
const EXIT_DRAIN_MS = 2000;

/** The bits of a child process the runner uses, so tests can fake it. */
export interface RunProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(): void;
  on(event: "exit" | "close", fn: (code: number | null) => void): void;
  on(event: "error", fn: (err: Error) => void): void;
}

export type Launcher = (command: string, args: string[], cwd: string) => RunProcess;

export interface RunnerOptions {
  store: Store;
  models: ModelSettings;
  notifier: Notifier;
  keepAwake: { set(on: boolean): void; active: boolean };
  serverUrl: string;
  workspacesDir: string;
  runFilesDir: string;
  launch?: Launcher;
  prepare?: (root: string, key: string, linkedPath: string | null) => Promise<Workspace>;
  mcpCommand?: McpCommand;
  providers?: Record<string, Provider>;
  idleMs?: number;
}

type Pending = { kind: "resume"; comment: Comment | null } | { kind: "limit" } | { kind: "restart" };

interface Run {
  ticketId: number;
  provider: Provider;
  proc: RunProcess | null; // null while the workspace is being prepared
  token: string;
  dir: string;
  model: string | null;
  heldComments: string[]; // comments that couldn't go into the live session; sent with the next turn
  resumed: boolean;
  sawSession: boolean;
  limitResetAt: Date | null;
  stopped: boolean; // killed by the user or a status change
  finishing: boolean; // agent set Review/Blocked; stdin closed
  nudged: boolean;
  idleTimer: NodeJS.Timeout | null;
  stderrTail: string;
  files: string[];
}

export const defaultLauncher: Launcher = (command, args, cwd) =>
  spawn(command, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: process.env });

function killTree(proc: RunProcess & { pid?: number }) {
  if (process.platform === "win32" && proc.pid) {
    execFile("taskkill", ["/PID", String(proc.pid), "/T", "/F"], () => undefined);
  } else {
    proc.kill();
  }
}

export class Runner implements RunnerPort {
  private runs = new Map<number, Run>();
  private tokens = new Map<string, number>();
  private pending = new Map<number, Pending>();
  private held = new Map<number, string[]>(); // @agent comments a one-shot run didn't get to send
  private limitUntil: Date | null = null;
  private limitTimer: NodeJS.Timeout | null = null;
  private o: Required<RunnerOptions>;

  constructor(opts: RunnerOptions) {
    this.o = {
      launch: defaultLauncher,
      prepare: prepareWorkspace,
      providers: PROVIDER_IMPLS,
      idleMs: IDLE_MS,
      mcpCommand: opts.mcpCommand ?? defaultMcpCommand(),
      ...opts,
    } as typeof this.o;
    fs.mkdirSync(this.o.runFilesDir, { recursive: true });
  }

  /** After a restart: anything that was running or queued goes back in the queue. */
  recover() {
    const { store } = this.o;
    for (const info of store.staleRuns()) {
      if (info.status !== "agent_ready" && info.status !== "in_progress") {
        store.setRunState(info.id, "idle");
        continue;
      }
      if (info.runState === "running" || info.runState === "waiting_limit" || info.status === "in_progress") {
        this.pending.set(info.id, { kind: "restart" });
      }
      if (info.status === "in_progress") store.setStatus(info.id, "agent_ready", "runner");
      store.setRunState(info.id, "queued");
    }
    this.schedule();
  }

  // ---------- RunnerPort ----------

  onStatusChange(ticketId: number, from: Status, to: Status) {
    const run = this.runs.get(ticketId);
    const wasActive = from === "agent_ready" || from === "in_progress";
    // Leaving Agent Ready / In Progress (other than the agent finishing) kills or dequeues the run.
    if (wasActive && to !== "in_progress") {
      if (run && !run.finishing) this.kill(run);
      this.pending.delete(ticketId);
    }
    if (to === "agent_ready") {
      if (!this.runs.has(ticketId)) this.o.store.setRunState(ticketId, "queued");
    } else if (wasActive && to !== "in_progress" && !this.runs.has(ticketId)) {
      this.o.store.setRunState(ticketId, "idle");
    }
    if (to === "review" || to === "blocked") {
      const t = this.o.store.getTicket(ticketId);
      void this.o.notifier.ticketStatus(t.key, t.title, to);
    }
    this.schedule();
  }

  onUserComment(ticketId: number, comment: Comment, route: "inject" | "resume") {
    if (route === "inject") {
      const run = this.runs.get(ticketId);
      if (!run) return;
      if (run.proc && !run.finishing && run.provider.persistent) {
        this.send(run, injectMessage(comment.body));
        this.o.store.appendLog(ticketId, "user", `@agent comment sent to the session: ${comment.body.slice(0, 200)}`);
      } else {
        // One-shot turn in progress, or the agent already set its final status and is exiting:
        // the comment goes with the next turn, or sends the ticket back to work when the run ends.
        run.heldComments.push(comment.body);
        this.o.store.appendLog(ticketId, "user", `@agent comment held until the current turn ends: ${comment.body.slice(0, 200)}`);
      }
      return;
    }
    const from = this.o.store.runInfo(ticketId).status;
    this.pending.set(ticketId, { kind: "resume", comment });
    this.o.store.setStatus(ticketId, "agent_ready", "runner");
    this.onStatusChange(ticketId, from, "agent_ready");
  }

  async stop(ticketId: number, reason: "user" | "delete") {
    const { store } = this.o;
    const run = this.runs.get(ticketId);
    if (run) this.kill(run);
    this.pending.delete(ticketId);
    this.held.delete(ticketId);
    store.setRunState(ticketId, "idle");
    if (reason === "delete") {
      // The ticket is deleted right after this returns; fill the freed slot afterwards.
      setImmediate(() => this.schedule());
      return;
    }
    if (store.runInfo(ticketId).status !== "blocked") {
      store.addComment(ticketId, "system", "Stopped by you. The run was killed.");
      store.setStatus(ticketId, "blocked", "runner");
      const t = store.getTicket(ticketId);
      void this.o.notifier.ticketStatus(t.key, t.title, "blocked");
    }
    this.schedule();
  }

  ticketForToken(token: string): number | null {
    return this.tokens.get(token) ?? null;
  }

  onAgentFinished(ticketId: number) {
    const run = this.runs.get(ticketId);
    if (!run || run.finishing) return;
    run.finishing = true;
    this.clearIdle(run);
    // Closing stdin lets a persistent agent finish its turn and exit; one-shot runs exit on their own.
    run.proc?.stdin.end();
  }

  systemState(): SystemState {
    return {
      running: this.runs.size,
      queued: this.o.store.queueOrder().length,
      maxParallel: MAX_PARALLEL,
      limitResetAt: this.limitUntil?.toISOString() ?? null,
      keepingAwake: this.o.keepAwake.active,
      ntfyEnabled: this.o.notifier.enabled,
    };
  }

  // ---------- queue ----------

  schedule() {
    if (this.limitUntil && this.limitUntil > new Date()) {
      this.updateKeepAwake();
      return;
    }
    for (const next of this.o.store.queueOrder()) {
      if (this.runs.size >= MAX_PARALLEL) break;
      if (this.runs.has(next.id)) continue;
      this.start(next.id).catch((err: Error) => console.error(`[relay] couldn't start ${ticketKey(next.id)}: ${err.message}`));
    }
    // Mark everything still waiting as queued so the board shows its position.
    for (const q of this.o.store.queueOrder()) if (q.runState !== "queued") this.o.store.setRunState(q.id, "queued");
    this.updateKeepAwake();
  }

  private async start(ticketId: number) {
    const { store } = this.o;
    const token = randomBytes(24).toString("hex");
    const ticket0 = store.getTicket(ticketId);
    const providerId = this.o.models.providerFor(ticket0.provider);
    const run: Run = {
      ticketId,
      provider: this.o.providers[providerId]!,
      proc: null,
      token,
      dir: "",
      model: providerId === "codex" ? this.o.models.codexModel(ticket0.model) : this.o.models.mainModel(ticket0.model),
      heldComments: [],
      resumed: false,
      sawSession: false,
      limitResetAt: null,
      stopped: false,
      finishing: false,
      nudged: false,
      idleTimer: null,
      stderrTail: "",
      files: [],
    };
    this.runs.set(ticketId, run);
    this.tokens.set(token, ticketId);
    store.setRunState(ticketId, "running");
    store.setStatus(ticketId, "in_progress", "runner");

    let ticket = ticket0;
    let ws: Workspace;
    try {
      ws = await this.o.prepare(this.o.workspacesDir, ticket.key, ticket.linkedPath);
      store.setWorkspace(ticketId, ws.dir, ws.branch);
    } catch (err) {
      this.cleanup(run);
      this.fail(ticketId, `Couldn't prepare the workspace: ${(err as Error).message}`);
      return;
    }
    if (run.stopped) return this.cleanup(run);
    ticket = store.getTicket(ticketId);

    const info = store.runInfo(ticketId);
    const pending = this.pending.get(ticketId) ?? null;
    this.pending.delete(ticketId);
    // A session can only be resumed by the CLI that created it.
    const resume = pending !== null && info.sessionId !== null && info.sessionProvider === run.provider.id;
    run.resumed = resume;
    run.dir = ws.dir;

    let message: string;
    if (!pending) message = firstMessage(ticket);
    else if (!resume) message = `${firstMessage(ticket)}\n\n(Earlier work on this ticket happened in a session that's gone. The comments above are the history.)`;
    else if (pending.kind === "resume") message = resumeMessage(ticket, pending.comment);
    else if (pending.kind === "limit") message = limitResumeMessage;
    else message = "Relay restarted while you were working. Continue where you left off, then finish as usual.";

    const held = this.held.get(ticketId);
    this.held.delete(ticketId);
    if (held) message += `\n\n${held.map((body) => injectMessage(body)).join("\n\n")}`;

    store.appendLog(ticketId, "info", resume ? `Resuming the earlier ${run.provider.label} session` : `Starting ${run.provider.label} in ${ws.dir}`);
    this.launchTurn(run, ticket, ws, message, resume ? info.sessionId : null);
  }

  /** Starts the CLI process. Persistent providers use one for the whole run; one-shot ones one per turn. */
  private launchTurn(run: Run, ticket: TicketDetail, ws: Workspace, message: string, resumeSession: string | null) {
    const key = ticketKey(run.ticketId);
    let proc: RunProcess;
    try {
      const { command, args } = run.provider.launch({
        model: run.model,
        systemPrompt: systemPrompt(ticket, ws),
        runFile: (name) => {
          const f = path.join(this.o.runFilesDir, `${key}.${name}`);
          if (!run.files.includes(f)) run.files.push(f);
          return f;
        },
        mcp: { ...this.o.mcpCommand, env: { RELAY_URL: this.o.serverUrl, RELAY_TOKEN: run.token } },
        resumeSession,
        agentsOverride: run.provider.id === "claude" ? this.o.models.agentsOverride() : null,
      });
      proc = this.o.launch(command, args, ws.dir);
    } catch (err) {
      this.cleanup(run);
      this.fail(run.ticketId, `Couldn't start ${run.provider.label}: ${(err as Error).message}`);
      return;
    }
    run.proc = proc;
    this.wire(run, proc);
    this.send(run, message);
  }

  private wire(run: Run, proc: RunProcess) {
    const { store } = this.o;
    let buf = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      if (run.stopped) return; // the ticket may be gone
      this.clearIdle(run);
      buf += chunk.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        for (const ev of run.provider.parseLine(line)) {
          if (ev.kind === "session") {
            run.sawSession = true;
            store.setSession(run.ticketId, ev.sessionId, run.provider.id);
          } else if (ev.kind === "log") {
            store.appendLog(run.ticketId, ev.level, ev.text);
          } else if (ev.kind === "limit") {
            run.limitResetAt = ev.resetsAt;
          } else if (ev.kind === "turn-end") {
            if (run.limitResetAt) {
              this.hitLimit(run);
            } else if (!run.finishing) {
              this.armIdle(run);
            }
          }
        }
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      run.stderrTail = (run.stderrTail + chunk.toString("utf8")).slice(-2000);
    });
    proc.on("error", (err) => {
      run.stderrTail += `\n${err.message}`;
    });
    const done = (code: number | null) => {
      if (run.proc !== proc) return; // an earlier turn's process, or already handled
      run.proc = null;
      this.onExit(run, code);
    };
    // "close" fires once stdout has drained, so the last events are parsed first, and also when the binary
    // can't be spawned, where "exit" never fires. But a grandchild (e.g. an MCP server) can hold stdout
    // open after the agent exits, so after "exit" give stdout a moment to drain, then go on without it.
    proc.on("close", done);
    proc.on("exit", (code) => {
      const t = setTimeout(() => done(code), EXIT_DRAIN_MS);
      proc.stdout.once("end", () => {
        clearTimeout(t);
        setImmediate(() => done(code));
      });
    });
  }

  /**
   * A one-shot provider's turn ended cleanly but the ticket is still In Progress:
   * send the held comments, or nudge once, in the same session. Returns false if the run should end.
   */
  private continueTurn(run: Run, code: number | null): boolean {
    const { store } = this.o;
    if (run.provider.persistent || run.stopped || run.finishing || run.limitResetAt || code !== 0) return false;
    const info = store.runInfo(run.ticketId);
    if (info.status !== "in_progress" || !info.sessionId) return false;
    let message: string;
    if (run.heldComments.length) {
      message = run.heldComments.map((body) => injectMessage(body)).join("\n\n");
      run.heldComments = [];
      store.appendLog(run.ticketId, "info", "Sending the held comments");
    } else if (!run.nudged) {
      run.nudged = true;
      message = nudgeMessage;
      store.appendLog(run.ticketId, "info", "The turn ended without a final status; asking the agent to finish");
    } else {
      return false;
    }
    this.clearIdle(run);
    const ticket = store.getTicket(run.ticketId);
    const ws: Workspace = { dir: run.dir, branch: ticket.branch, kind: ticket.branch ? "worktree" : "folder" };
    this.launchTurn(run, ticket, ws, message, info.sessionId);
    return true;
  }

  private onExit(run: Run, code: number | null) {
    const { store } = this.o;
    const id = run.ticketId;
    if (this.continueTurn(run, code)) return;
    this.cleanup(run);
    if (run.stopped) return this.schedule();
    if (run.heldComments.length) this.held.set(id, run.heldComments);

    const status = store.runInfo(id).status;
    if (run.limitResetAt && status === "in_progress") {
      // Nothing is working on it while paused, so it goes back to Agent Ready.
      store.setStatus(id, "agent_ready", "runner");
      store.setRunState(id, "waiting_limit");
      store.appendLog(id, "info", `Waiting for the usage limit to reset (${run.limitResetAt.toLocaleString()})`);
      this.pending.set(id, { kind: "limit" });
      this.pauseUntil(run.limitResetAt);
      return this.schedule();
    }

    if (status !== "in_progress") {
      // Agent finished (or the user moved the ticket).
      if (this.held.has(id) && (status === "review" || status === "blocked")) {
        // The user commented during the agent's last turn, so it isn't really done.
        store.appendLog(id, "info", "@agent comments arrived during the last turn; sending the ticket back to work");
        store.setFailures(id, 0);
        this.pending.set(id, { kind: "resume", comment: null });
        store.setStatus(id, "agent_ready", "runner");
        return this.onStatusChange(id, status, "agent_ready");
      }
      this.held.delete(id);
      store.setFailures(id, 0);
      store.setRunState(id, "idle");
      store.appendLog(id, "info", `Run ended (${status})`);
      return this.schedule();
    }

    if (run.resumed && !run.sawSession) {
      // The session is gone: start fresh, reading the comment history.
      store.setSession(id, null);
      store.appendLog(id, "info", "The earlier session couldn't be resumed. Starting a fresh run.");
      this.pending.set(id, { kind: "restart" });
      store.setStatus(id, "agent_ready", "runner");
      store.setRunState(id, "queued");
      return this.schedule();
    }

    const detail = run.stderrTail.trim().split(/\r?\n/).slice(-5).join("\n");
    this.fail(id, `${run.provider.label} exited (code ${code}) without finishing the ticket.${detail ? `\n\n${detail}` : ""}`);
  }

  /** Anything that fails twice goes to Blocked. */
  private fail(ticketId: number, reason: string) {
    const { store } = this.o;
    const failures = store.runInfo(ticketId).failures + 1;
    store.setFailures(ticketId, failures);
    store.appendLog(ticketId, "error", reason);
    if (failures >= 2) {
      store.addComment(ticketId, "system", `The run failed twice, so the ticket is Blocked.\n\nLast error: ${reason}`);
      store.setFailures(ticketId, 0);
      store.setRunState(ticketId, "idle");
      store.setStatus(ticketId, "blocked", "runner");
      const t = store.getTicket(ticketId);
      void this.o.notifier.ticketStatus(t.key, t.title, "blocked");
    } else {
      store.addComment(ticketId, "system", `The run failed and will retry once.\n\nError: ${reason}`);
      if (store.runInfo(ticketId).sessionId) this.pending.set(ticketId, { kind: "restart" });
      store.setStatus(ticketId, "agent_ready", "runner");
      store.setRunState(ticketId, "queued");
    }
    this.schedule();
  }

  private hitLimit(run: Run) {
    this.o.store.appendLog(run.ticketId, "info", "Hit the usage limit");
    run.proc?.stdin.end();
    if (run.proc) killTree(run.proc);
  }

  private pauseUntil(at: Date) {
    if (this.limitUntil && this.limitUntil >= at) return;
    this.limitUntil = at;
    if (this.limitTimer) clearTimeout(this.limitTimer);
    // A little after the reset, so the first request isn't refused again.
    const wait = Math.max(0, at.getTime() - Date.now()) + 30_000;
    this.limitTimer = setTimeout(() => {
      this.limitUntil = null;
      this.limitTimer = null;
      for (const t of this.o.store.listTickets()) {
        if (t.runState === "waiting_limit") this.o.store.setRunState(t.id, "queued");
      }
      this.schedule();
    }, wait);
  }

  // ---------- helpers ----------

  private send(run: Run, text: string) {
    if (!run.proc || run.proc.stdin.writableEnded) return;
    run.proc.stdin.write(run.provider.encodeMessage(text));
    // One-shot CLIs read the whole message from stdin before starting.
    if (!run.provider.persistent) run.proc.stdin.end();
  }

  private armIdle(run: Run) {
    this.clearIdle(run);
    run.idleTimer = setTimeout(() => {
      if (this.o.store.runInfo(run.ticketId).status !== "in_progress") return;
      if (!run.provider.persistent) {
        // A one-shot process should exit right after its turn; if it hangs, end it so the slot frees up.
        this.o.store.appendLog(run.ticketId, "error", "The agent process didn't exit after its turn; ending it");
        if (run.proc) killTree(run.proc);
        return;
      }
      if (!run.nudged) {
        run.nudged = true;
        this.o.store.appendLog(run.ticketId, "info", "No activity for a while; asking the agent to wrap up");
        this.send(run, nudgeMessage);
      } else {
        this.o.store.appendLog(run.ticketId, "error", "Still no activity after a nudge; ending the run");
        run.proc?.stdin.end();
        if (run.proc) killTree(run.proc);
      }
    }, this.o.idleMs);
  }

  private clearIdle(run: Run) {
    if (run.idleTimer) clearTimeout(run.idleTimer);
    run.idleTimer = null;
  }

  private kill(run: Run) {
    run.stopped = true;
    this.clearIdle(run);
    if (run.proc) {
      run.proc.stdin.end();
      killTree(run.proc);
    }
    this.o.store.appendLog(run.ticketId, "info", "Run stopped");
    this.cleanup(run);
  }

  private cleanup(run: Run) {
    this.clearIdle(run);
    this.tokens.delete(run.token);
    if (this.runs.get(run.ticketId) === run) this.runs.delete(run.ticketId);
    for (const f of run.files) fs.rmSync(f, { force: true });
    run.files = [];
    this.updateKeepAwake();
  }

  private updateKeepAwake() {
    const busy = this.runs.size > 0 || this.o.store.queueOrder().length > 0 || this.limitUntil !== null;
    this.o.keepAwake.set(busy);
  }
}

function defaultMcpCommand() {
  const server = path.resolve(import.meta.dirname, "../mcp/server.ts");
  return { command: process.execPath, args: ["--import", import.meta.resolve("tsx"), server] };
}
