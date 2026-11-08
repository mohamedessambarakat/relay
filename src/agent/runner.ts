import { spawn, execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import type { RunnerPort } from "../server/app.ts";
import type { Store } from "../server/store.ts";
import { ticketKey, type Comment, type Status, type SystemState } from "../shared/types.ts";
import type { ModelSettings } from "./models.ts";
import type { Notifier } from "./notify.ts";
import { firstMessage, injectMessage, limitResumeMessage, nudgeMessage, resumeMessage, systemPrompt } from "./prompt.ts";
import { parseStreamLine } from "./stream.ts";
import { prepareWorkspace, type Workspace } from "./workspace.ts";

export const MAX_PARALLEL = 3;
const IDLE_MS = 10 * 60 * 1000;

/** The bits of a child process the runner uses, so tests can fake it. */
export interface RunProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(): void;
  on(event: "exit", fn: (code: number | null) => void): void;
  on(event: "error", fn: (err: Error) => void): void;
}

export type Launcher = (args: string[], cwd: string) => RunProcess;

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
  mcpCommand?: { command: string; args: string[] };
  idleMs?: number;
}

type Pending = { kind: "resume"; comment: Comment | null } | { kind: "limit" } | { kind: "restart" };

interface Run {
  ticketId: number;
  proc: RunProcess | null; // null while the workspace is being prepared
  token: string;
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

export function defaultLauncher(bin: string): Launcher {
  return (args, cwd) => spawn(bin, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: process.env });
}

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
  private limitUntil: Date | null = null;
  private limitTimer: NodeJS.Timeout | null = null;
  private o: Required<Omit<RunnerOptions, "mcpCommand">> & { mcpCommand: { command: string; args: string[] } };

  constructor(opts: RunnerOptions) {
    this.o = {
      launch: defaultLauncher(process.env.CLAUDE_BIN || "claude"),
      prepare: prepareWorkspace,
      idleMs: IDLE_MS,
      mcpCommand: opts.mcpCommand ?? defaultMcpCommand(),
      ...opts,
    } as typeof this.o;
    fs.mkdirSync(this.o.runFilesDir, { recursive: true });
  }

  /** After a restart: anything that was running or queued goes back in the queue. */
  recover() {
    for (const info of this.o.store.staleRuns()) {
      if (info.status !== "agent_ready") {
        this.o.store.setRunState(info.id, "idle");
        continue;
      }
      if (info.runState === "running" || info.runState === "waiting_limit") this.pending.set(info.id, { kind: "restart" });
      this.o.store.setRunState(info.id, "queued");
    }
    this.schedule();
  }

  // ---------- RunnerPort ----------

  onStatusChange(ticketId: number, from: Status, to: Status) {
    const run = this.runs.get(ticketId);
    if (to === "agent_ready") {
      if (!run) this.o.store.setRunState(ticketId, "queued");
    } else if (from === "agent_ready") {
      if (run && !run.finishing) this.kill(run);
      if (!run) this.o.store.setRunState(ticketId, "idle");
      this.pending.delete(ticketId);
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
      if (run?.proc && !run.finishing) {
        this.send(run, injectMessage(comment));
        this.o.store.appendLog(ticketId, "user", `@agent comment sent to the session: ${comment.body.slice(0, 200)}`);
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
    // Closing stdin lets Claude finish the current turn and exit.
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
    const run: Run = {
      ticketId,
      proc: null,
      token,
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

    let ticket = store.getTicket(ticketId);
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
    const resume = pending !== null && info.sessionId !== null;
    run.resumed = resume;

    const key = ticketKey(ticketId);
    const promptFile = path.join(this.o.runFilesDir, `${key}.prompt.md`);
    const mcpFile = path.join(this.o.runFilesDir, `${key}.mcp.json`);
    fs.writeFileSync(promptFile, systemPrompt(ticket, ws));
    fs.writeFileSync(
      mcpFile,
      JSON.stringify({
        mcpServers: {
          relay: { ...this.o.mcpCommand, env: { RELAY_URL: this.o.serverUrl, RELAY_TOKEN: token } },
        },
      }),
    );
    run.files.push(promptFile, mcpFile);

    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--model", this.o.models.mainModel(ticket.model),
      "--mcp-config", mcpFile,
      "--append-system-prompt-file", promptFile,
    ];
    const agents = this.o.models.agentsOverride();
    if (agents) args.push("--agents", agents);
    if (resume) args.push("--resume", info.sessionId!);

    let message: string;
    if (!pending) message = firstMessage(ticket);
    else if (!resume) message = `${firstMessage(ticket)}\n\n(Earlier work on this ticket happened in a session that's gone. The comments above are the history.)`;
    else if (pending.kind === "resume") message = resumeMessage(ticket, pending.comment);
    else if (pending.kind === "limit") message = limitResumeMessage;
    else message = "Relay restarted while you were working. Continue where you left off, then finish as usual.";

    store.appendLog(ticketId, "info", resume ? "Resuming the earlier session" : `Starting in ${ws.dir}`);
    let proc: RunProcess;
    try {
      proc = this.o.launch(args, ws.dir);
    } catch (err) {
      this.cleanup(run);
      this.fail(ticketId, `Couldn't start Claude: ${(err as Error).message}`);
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
        for (const ev of parseStreamLine(line)) {
          if (ev.kind === "session") {
            run.sawSession = true;
            store.setSession(run.ticketId, ev.sessionId);
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
    proc.on("exit", (code) => this.onExit(run, code));
  }

  private onExit(run: Run, code: number | null) {
    const { store } = this.o;
    const id = run.ticketId;
    this.cleanup(run);
    if (run.stopped) return this.schedule();

    if (run.limitResetAt) {
      store.setRunState(id, "waiting_limit");
      store.appendLog(id, "info", `Waiting for the usage limit to reset (${run.limitResetAt.toLocaleString()})`);
      this.pending.set(id, { kind: "limit" });
      this.pauseUntil(run.limitResetAt);
      return this.schedule();
    }

    const status = store.runInfo(id).status;
    if (status !== "agent_ready") {
      // Agent finished (or the user moved the ticket).
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
      store.setRunState(id, "queued");
      return this.schedule();
    }

    const detail = run.stderrTail.trim().split(/\r?\n/).slice(-5).join("\n");
    this.fail(id, `Claude exited (code ${code}) without finishing the ticket.${detail ? `\n\n${detail}` : ""}`);
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
    run.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
  }

  private armIdle(run: Run) {
    this.clearIdle(run);
    run.idleTimer = setTimeout(() => {
      if (this.o.store.runInfo(run.ticketId).status !== "agent_ready") return;
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
