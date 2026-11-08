import type { Db } from "./db.ts";
import { tx } from "./db.ts";
import type { EventBus } from "./events.ts";
import {
  DEFAULT_TOGGLES,
  ticketKey,
  type Attachment,
  type Comment,
  type LogLine,
  type Priority,
  type RunState,
  type SpendItem,
  type Status,
  type TicketDetail,
  type TicketSummary,
  type Toggles,
} from "../shared/types.ts";

interface TicketRow {
  id: number;
  title: string;
  description: string;
  status: Status;
  priority: number;
  labels: string;
  due_date: string | null;
  linked_path: string | null;
  toggles: string;
  model: string | null;
  session_id: string | null;
  workspace: string | null;
  branch: string | null;
  run_state: RunState;
  run_started_at: string | null;
  ready_at: string | null;
  failures: number;
  created_at: string;
  updated_at: string;
  attachment_count?: number;
}

export interface NewTicket {
  title: string;
  description?: string;
  status?: Status;
  priority?: Priority;
  labels?: string[];
  dueDate?: string | null;
  linkedPath?: string | null;
  toggles?: Partial<Toggles>;
  model?: string | null;
}

export type TicketPatch = Partial<Omit<NewTicket, "status">>;

export interface SpendPlanItem {
  service: string;
  unit: string;
  reason: string;
  estimate: number;
}

/** Fields the runner needs that the board never sees. */
export interface RunInfo {
  id: number;
  status: Status;
  runState: RunState;
  sessionId: string | null;
  workspace: string | null;
  failures: number;
  priority: number;
  readyAt: string | null;
}

const now = () => new Date().toISOString();
const LOG_LIMIT = 500; // lines sent with a ticket's detail

export class NotFoundError extends Error {}
export class RuleError extends Error {}

export class Store {
  constructor(
    private db: Db,
    private bus: EventBus,
  ) {}

  // ---------- tickets ----------

  createTicket(input: NewTicket): TicketDetail {
    const ts = now();
    const status = input.status ?? "backlog";
    const res = this.db
      .prepare(
        `INSERT INTO tickets (title, description, status, priority, labels, due_date, linked_path, toggles, model, ready_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.title,
        input.description ?? "",
        status,
        input.priority ?? 0,
        JSON.stringify(input.labels ?? []),
        input.dueDate ?? null,
        input.linkedPath ?? null,
        JSON.stringify({ ...DEFAULT_TOGGLES, ...input.toggles }),
        input.model ?? null,
        status === "agent_ready" ? ts : null,
        ts,
        ts,
      );
    const id = Number(res.lastInsertRowid);
    this.bus.emit({ type: "tickets" });
    return this.getTicket(id);
  }

  updateTicket(id: number, patch: TicketPatch): TicketDetail {
    const row = this.row(id);
    const toggles = patch.toggles ? { ...this.toggles(row), ...patch.toggles } : this.toggles(row);
    this.db
      .prepare(
        `UPDATE tickets SET title = ?, description = ?, priority = ?, labels = ?, due_date = ?, linked_path = ?, toggles = ?, model = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        patch.title ?? row.title,
        patch.description ?? row.description,
        patch.priority ?? row.priority,
        patch.labels ? JSON.stringify(patch.labels) : row.labels,
        patch.dueDate !== undefined ? patch.dueDate : row.due_date,
        patch.linkedPath !== undefined ? patch.linkedPath : row.linked_path,
        JSON.stringify(toggles),
        patch.model !== undefined ? patch.model : row.model,
        now(),
        id,
      );
    this.changed(id);
    return this.getTicket(id);
  }

  deleteTicket(id: number) {
    this.row(id);
    this.db.prepare("DELETE FROM tickets WHERE id = ?").run(id);
    this.bus.emit({ type: "tickets" });
  }

  /**
   * Moves a ticket between columns. The agent may only move to Review or Blocked;
   * only the user moves tickets to Done.
   */
  setStatus(id: number, status: Status, by: "user" | "agent" | "runner"): TicketDetail {
    const row = this.row(id);
    if (by === "agent" && status !== "review" && status !== "blocked") {
      throw new RuleError("The agent can only move a ticket to review or blocked.");
    }
    if (by === "runner" && status === "done") throw new RuleError("Only the user moves tickets to Done.");
    if (row.status === status) return this.getTicket(id);
    const ts = now();
    // ready_at orders the queue; re-entering Agent Ready puts the ticket at the back of its priority.
    const readyAt = status === "agent_ready" ? ts : row.ready_at;
    this.db.prepare("UPDATE tickets SET status = ?, ready_at = ?, updated_at = ? WHERE id = ?").run(status, readyAt, ts, id);
    this.changed(id);
    return this.getTicket(id);
  }

  listTickets(): TicketSummary[] {
    const rows = this.db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM attachments a WHERE a.ticket_id = t.id) AS attachment_count
         FROM tickets t ORDER BY t.priority DESC, t.created_at ASC`,
      )
      .all() as unknown as TicketRow[];
    const queue = this.queueOrder().map((r) => r.id);
    return rows.map((r) => this.summary(r, queue));
  }

  getTicket(id: number): TicketDetail {
    const row = this.db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM attachments a WHERE a.ticket_id = t.id) AS attachment_count FROM tickets t WHERE t.id = ?`,
      )
      .get(id) as TicketRow | undefined;
    if (!row) throw new NotFoundError(`Ticket ${id} not found`);
    const queue = this.queueOrder().map((r) => r.id);
    const log = (
      this.db
        .prepare("SELECT * FROM (SELECT * FROM log_lines WHERE ticket_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC")
        .all(id, LOG_LIMIT) as unknown as LogRow[]
    ).map(toLogLine);
    return {
      ...this.summary(row, queue),
      description: row.description,
      toggles: this.toggles(row),
      model: row.model,
      branch: row.branch,
      workspace: row.workspace,
      comments: this.comments(id),
      attachments: this.attachments(id),
      spend: this.spend(id),
      log,
    };
  }

  // ---------- runner fields ----------

  runInfo(id: number): RunInfo {
    const r = this.row(id);
    return {
      id: r.id,
      status: r.status,
      runState: r.run_state,
      sessionId: r.session_id,
      workspace: r.workspace,
      failures: r.failures,
      priority: r.priority,
      readyAt: r.ready_at,
    };
  }

  /** Agent Ready tickets not yet running, highest priority first, then oldest. */
  queueOrder(): RunInfo[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tickets WHERE status = 'agent_ready' AND run_state IN ('idle','queued')
         ORDER BY priority DESC, ready_at ASC, id ASC`,
      )
      .all() as unknown as TicketRow[];
    return rows.map((r) => this.runInfo(r.id));
  }

  setRunState(id: number, state: RunState) {
    const started = state === "running" ? now() : null;
    this.db
      .prepare("UPDATE tickets SET run_state = ?, run_started_at = CASE WHEN ? IS NULL THEN run_started_at ELSE ? END WHERE id = ?")
      .run(state, started, started, id);
    if (state === "idle") this.db.prepare("UPDATE tickets SET run_started_at = NULL WHERE id = ?").run(id);
    this.changed(id);
  }

  setSession(id: number, sessionId: string | null) {
    this.db.prepare("UPDATE tickets SET session_id = ? WHERE id = ?").run(sessionId, id);
  }

  setWorkspace(id: number, workspace: string, branch: string | null) {
    this.db.prepare("UPDATE tickets SET workspace = ?, branch = ? WHERE id = ?").run(workspace, branch, id);
    this.changed(id);
  }

  setFailures(id: number, failures: number) {
    this.db.prepare("UPDATE tickets SET failures = ? WHERE id = ?").run(failures, id);
  }

  /** Tickets whose run state survived a restart; the runner re-queues them. */
  staleRuns(): RunInfo[] {
    const rows = this.db.prepare("SELECT id FROM tickets WHERE run_state <> 'idle'").all() as unknown as { id: number }[];
    return rows.map((r) => this.runInfo(r.id));
  }

  // ---------- comments ----------

  addComment(ticketId: number, author: Comment["author"], body: string): Comment {
    this.row(ticketId);
    const ts = now();
    const res = this.db
      .prepare("INSERT INTO comments (ticket_id, author, body, created_at) VALUES (?, ?, ?, ?)")
      .run(ticketId, author, body, ts);
    this.touch(ticketId);
    return { id: Number(res.lastInsertRowid), ticketId, author, body, createdAt: ts };
  }

  comments(ticketId: number): Comment[] {
    return (
      this.db.prepare("SELECT * FROM comments WHERE ticket_id = ? ORDER BY id ASC").all(ticketId) as unknown as {
        id: number;
        ticket_id: number;
        author: Comment["author"];
        body: string;
        created_at: string;
      }[]
    ).map((r) => ({ id: r.id, ticketId: r.ticket_id, author: r.author, body: r.body, createdAt: r.created_at }));
  }

  /** True when the agent has commented since `since` (ISO time). */
  agentCommentedSince(ticketId: number, since: string): boolean {
    return !!this.db
      .prepare("SELECT 1 FROM comments WHERE ticket_id = ? AND author = 'agent' AND created_at >= ? LIMIT 1")
      .get(ticketId, since);
  }

  // ---------- attachments ----------

  addAttachment(ticketId: number, a: { name: string; storedName: string; size: number; mime: string }): Attachment {
    this.row(ticketId);
    const ts = now();
    const res = this.db
      .prepare("INSERT INTO attachments (ticket_id, name, stored_name, size, mime, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(ticketId, a.name, a.storedName, a.size, a.mime, ts);
    this.touch(ticketId);
    return { id: Number(res.lastInsertRowid), ticketId, name: a.name, size: a.size, mime: a.mime, createdAt: ts };
  }

  attachments(ticketId: number): Attachment[] {
    return (
      this.db.prepare("SELECT * FROM attachments WHERE ticket_id = ? ORDER BY id ASC").all(ticketId) as unknown as AttachmentRow[]
    ).map(toAttachment);
  }

  attachmentFile(ticketId: number, attachmentId: number): Attachment & { storedName: string } {
    const r = this.db
      .prepare("SELECT * FROM attachments WHERE id = ? AND ticket_id = ?")
      .get(attachmentId, ticketId) as AttachmentRow | undefined;
    if (!r) throw new NotFoundError("Attachment not found");
    return { ...toAttachment(r), storedName: r.stored_name };
  }

  // ---------- spend ----------

  /**
   * The agent declares the paid services it needs. New services get max = estimate;
   * services the user already capped keep the user's max.
   */
  setSpendPlan(ticketId: number, items: SpendPlanItem[]): SpendItem[] {
    this.row(ticketId);
    tx(this.db, () => {
      for (const it of items) {
        this.db
          .prepare(
            `INSERT INTO spend_items (ticket_id, service, unit, reason, estimate, max) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (ticket_id, service) DO UPDATE SET unit = excluded.unit, reason = excluded.reason, estimate = excluded.estimate`,
          )
          .run(ticketId, it.service, it.unit, it.reason, it.estimate, it.estimate);
      }
    });
    this.touch(ticketId);
    return this.spend(ticketId);
  }

  setSpendMax(ticketId: number, itemId: number, max: number): SpendItem[] {
    const res = this.db.prepare("UPDATE spend_items SET max = ? WHERE id = ? AND ticket_id = ?").run(max, itemId, ticketId);
    if (res.changes === 0) throw new NotFoundError("Spend item not found");
    this.touch(ticketId);
    return this.spend(ticketId);
  }

  /** Records spend the agent reports. Refuses amounts that would pass the max. */
  reportSpend(ticketId: number, service: string, amount: number): SpendItem {
    const item = this.spend(ticketId).find((s) => s.service === service);
    if (!item) throw new RuleError(`No spend limit for "${service}". Declare it with set_spend_plan first.`);
    if (item.used + amount > item.max) {
      throw new RuleError(
        `This would bring ${service} to ${item.used + amount} ${item.unit}, over the max of ${item.max}. Don't spend it; move the ticket to Blocked.`,
      );
    }
    this.db.prepare("UPDATE spend_items SET used = used + ? WHERE id = ?").run(amount, item.id);
    this.touch(ticketId);
    return { ...item, used: item.used + amount };
  }

  spend(ticketId: number): SpendItem[] {
    return (
      this.db.prepare("SELECT * FROM spend_items WHERE ticket_id = ? ORDER BY id ASC").all(ticketId) as unknown as {
        id: number;
        ticket_id: number;
        service: string;
        unit: string;
        reason: string;
        estimate: number;
        max: number;
        used: number;
      }[]
    ).map((r) => ({
      id: r.id,
      ticketId: r.ticket_id,
      service: r.service,
      unit: r.unit,
      reason: r.reason,
      estimate: r.estimate,
      max: r.max,
      used: r.used,
    }));
  }

  // ---------- log ----------

  appendLog(ticketId: number, kind: LogLine["kind"], text: string): LogLine {
    const ts = now();
    const res = this.db
      .prepare("INSERT INTO log_lines (ticket_id, ts, kind, text) VALUES (?, ?, ?, ?)")
      .run(ticketId, ts, kind, text);
    const line: LogLine = { id: Number(res.lastInsertRowid), ticketId, ts, kind, text };
    this.bus.emit({ type: "log", line });
    return line;
  }

  // ---------- settings ----------

  getSetting<T>(key: string, fallback: T): T {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : fallback;
  }

  setSetting(key: string, value: unknown) {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  // ---------- helpers ----------

  private row(id: number): TicketRow {
    const r = this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as TicketRow | undefined;
    if (!r) throw new NotFoundError(`Ticket ${id} not found`);
    return r;
  }

  private toggles(r: TicketRow): Toggles {
    return { ...DEFAULT_TOGGLES, ...(JSON.parse(r.toggles) as Partial<Toggles>) };
  }

  private summary(r: TicketRow, queue: number[]): TicketSummary {
    const pos = queue.indexOf(r.id);
    return {
      id: r.id,
      key: ticketKey(r.id),
      title: r.title,
      status: r.status,
      priority: r.priority as Priority,
      labels: JSON.parse(r.labels) as string[],
      dueDate: r.due_date,
      linkedPath: r.linked_path,
      runState: r.run_state,
      runStartedAt: r.run_started_at,
      queuePosition: r.run_state === "queued" && pos >= 0 ? pos + 1 : null,
      attachmentCount: r.attachment_count ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private touch(id: number) {
    this.db.prepare("UPDATE tickets SET updated_at = ? WHERE id = ?").run(now(), id);
    this.changed(id);
  }

  private changed(id: number) {
    this.bus.emit({ type: "tickets" });
    this.bus.emit({ type: "ticket", ticketId: id });
  }
}

interface LogRow {
  id: number;
  ticket_id: number;
  ts: string;
  kind: LogLine["kind"];
  text: string;
}
const toLogLine = (r: LogRow): LogLine => ({ id: r.id, ticketId: r.ticket_id, ts: r.ts, kind: r.kind, text: r.text });

interface AttachmentRow {
  id: number;
  ticket_id: number;
  name: string;
  stored_name: string;
  size: number;
  mime: string;
  created_at: string;
}
const toAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  ticketId: r.ticket_id,
  name: r.name,
  size: r.size,
  mime: r.mime,
  createdAt: r.created_at,
});
