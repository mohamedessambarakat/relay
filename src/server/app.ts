import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { NotFoundError, RuleError, type Store } from "./store.ts";
import type { EventBus } from "./events.ts";
import { requestGuard, securityHeaders } from "./security.ts";
import { routeComment } from "./rules.ts";
import * as s from "./schemas.ts";
import type { BoardEvent, Comment, ModelRole, Status, SystemState } from "../shared/types.ts";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** What the API needs from the agent runner. */
export interface RunnerPort {
  onStatusChange(ticketId: number, from: Status, to: Status): void;
  onUserComment(ticketId: number, comment: Comment, route: "inject" | "resume"): void;
  /** "user": the Stop button (kills the run, moves the ticket to Blocked). "delete": the ticket is about to be deleted. */
  stop(ticketId: number, reason: "user" | "delete"): Promise<void>;
  ticketForToken(token: string): number | null;
  /** Called once the agent has set Review or Blocked; ends the run. */
  onAgentFinished(ticketId: number): void;
  systemState(): SystemState;
}

export interface ModelSettingsPort {
  list(): ModelRole[];
  save(input: { main: string; agents: Record<string, string> }): ModelRole[];
}

export interface AppDeps {
  store: Store;
  bus: EventBus;
  runner: RunnerPort;
  models: ModelSettingsPort;
  port: number;
  attachmentsDir: string;
  boardDir?: string; // built board; omitted in dev (Vite serves it)
}

class HttpError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 413,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function parse<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Body must be JSON");
  }
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, "invalid_body", r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  return r.data;
}

function id(c: Context, name = "id"): number {
  const r = s.idParam.safeParse(c.req.param(name));
  if (!r.success) throw new HttpError(400, "invalid_id", `Invalid ${name}`);
  return r.data;
}

/** Keeps a display name safe for headers and the file system listing. */
export function safeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ()]/g, "_").slice(0, 150);
  return base || "file";
}

export function createApp(deps: AppDeps) {
  const { store, bus, runner, models } = deps;
  const app = new Hono();
  fs.mkdirSync(deps.attachmentsDir, { recursive: true });

  app.use("*", securityHeaders);
  app.use("/api/*", requestGuard(deps.port));
  app.use("/api/*", async (c, next) => {
    const isUpload = c.req.method === "POST" && /\/attachments$/.test(c.req.path) && !c.req.path.startsWith("/api/agent/");
    const max = isUpload ? MAX_ATTACHMENT_BYTES + 1024 * 1024 : 1024 * 1024;
    return bodyLimit({ maxSize: max, onError: (c) => c.json({ error: { code: "too_large", message: "Request body too large" } }, 413) })(c, next);
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: { code: err.code, message: err.message } }, err.status);
    if (err instanceof NotFoundError) return c.json({ error: { code: "not_found", message: err.message } }, 404);
    if (err instanceof RuleError) return c.json({ error: { code: "rule", message: err.message } }, 409);
    console.error("[relay] unhandled", err);
    return c.json({ error: { code: "internal", message: "Something went wrong. Check the Relay console." } }, 500);
  });

  // ---------- board API ----------

  app.get("/api/tickets", (c) => c.json(store.listTickets()));

  app.post("/api/tickets", async (c) => {
    const body = await parse(c, s.createTicketSchema);
    const t = store.createTicket(body);
    if (t.status === "agent_ready") runner.onStatusChange(t.id, "backlog", "agent_ready");
    return c.json(store.getTicket(t.id), 201);
  });

  app.get("/api/tickets/:id", (c) => c.json(store.getTicket(id(c))));

  app.patch("/api/tickets/:id", async (c) => c.json(store.updateTicket(id(c), await parse(c, s.patchTicketSchema))));

  app.delete("/api/tickets/:id", async (c) => {
    const tid = id(c);
    const info = store.runInfo(tid);
    if (info.runState !== "idle") await runner.stop(tid, "delete");
    store.deleteTicket(tid);
    return c.body(null, 204);
  });

  app.post("/api/tickets/:id/status", async (c) => {
    const tid = id(c);
    const { status } = await parse(c, s.statusSchema);
    const from = store.runInfo(tid).status;
    store.setStatus(tid, status, "user");
    if (from !== status) runner.onStatusChange(tid, from, status);
    return c.json(store.getTicket(tid));
  });

  app.post("/api/tickets/:id/stop", async (c) => {
    const tid = id(c);
    await runner.stop(tid, "user");
    return c.json(store.getTicket(tid));
  });

  app.post("/api/tickets/:id/comments", async (c) => {
    const tid = id(c);
    const { body } = await parse(c, s.commentSchema);
    const info = store.runInfo(tid);
    const comment = store.addComment(tid, "user", body);
    const route = routeComment(info.status, info.runState, body);
    if (route !== "note") runner.onUserComment(tid, comment, route);
    return c.json(comment, 201);
  });

  app.post("/api/tickets/:id/attachments", async (c) => {
    const tid = id(c);
    store.runInfo(tid); // 404 before writing anything
    const form = await c.req.parseBody();
    const file = form["file"];
    if (!(file instanceof File)) throw new HttpError(400, "invalid_body", "Send one file in the 'file' field");
    if (file.size > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "too_large", "Files are capped at 25 MB");
    const att = saveAttachment(tid, file.name, file.type, Buffer.from(await file.arrayBuffer()));
    return c.json(att, 201);
  });

  app.get("/api/tickets/:id/attachments/:aid", (c) => {
    const a = store.attachmentFile(id(c), id(c, "aid"));
    const data = fs.readFileSync(path.join(deps.attachmentsDir, a.storedName));
    // Always a download, never rendered inline, so an uploaded HTML/SVG file can't run in Relay's origin.
    return c.body(data, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName(a.name)}"`,
    });
  });

  app.patch("/api/tickets/:id/spend/:itemId", async (c) => {
    const { max } = await parse(c, s.spendMaxSchema);
    return c.json(store.setSpendMax(id(c), id(c, "itemId"), max));
  });

  app.get("/api/settings/models", (c) => c.json(models.list()));
  app.put("/api/settings/models", async (c) => c.json(models.save(await parse(c, s.modelSettingsSchema))));

  app.get("/api/system", (c) => c.json(runner.systemState()));

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const queue: BoardEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe((e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        unsubscribe();
        wake?.();
      });
      await stream.writeSSE({ event: "ready", data: "{}" });
      while (!stream.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            wake = r;
            setTimeout(r, 25_000); // heartbeat
          });
          wake = null;
          if (queue.length === 0 && !stream.aborted) await stream.writeSSE({ event: "ping", data: "{}" });
          continue;
        }
        const e = queue.shift()!;
        await stream.writeSSE({ event: "message", data: JSON.stringify(e) });
      }
      unsubscribe();
    }),
  );

  // ---------- agent API (called by the Relay MCP server) ----------

  const agentTicket = (c: Context): number => {
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer /, "");
    const tid = runner.ticketForToken(token);
    if (tid === null) throw new HttpError(403, "forbidden", "Unknown or expired run token");
    return tid;
  };

  app.get("/api/agent/ticket", (c) => {
    const t = store.getTicket(agentTicket(c));
    const { log: _log, ...rest } = t;
    return c.json(rest);
  });

  app.post("/api/agent/comments", async (c) => {
    const tid = agentTicket(c);
    const { body } = await parse(c, s.commentSchema);
    return c.json(store.addComment(tid, "agent", body), 201);
  });

  app.post("/api/agent/attachments", async (c) => {
    const tid = agentTicket(c);
    const body = await parse(c, s.agentAttachmentSchema);
    const stat = fs.statSync(body.path, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new HttpError(400, "invalid_body", `Not a file: ${body.path}`);
    if (stat.size > MAX_ATTACHMENT_BYTES) throw new HttpError(413, "too_large", "Files are capped at 25 MB");
    const name = body.name ?? path.basename(body.path);
    return c.json(saveAttachment(tid, name, "", fs.readFileSync(body.path)), 201);
  });

  app.post("/api/agent/status", async (c) => {
    const tid = agentTicket(c);
    const { status } = await parse(c, s.agentStatusSchema);
    const startedAt = store.getTicket(tid).runStartedAt;
    if (startedAt && !store.agentCommentedSince(tid, startedAt)) {
      throw new RuleError("Post the final comment (add_comment) before setting the status.");
    }
    const from = store.runInfo(tid).status;
    // Mark the run as finishing first so the status change ends it gracefully instead of killing it.
    runner.onAgentFinished(tid);
    store.setStatus(tid, status, "agent");
    runner.onStatusChange(tid, from, status);
    return c.json({ ok: true, status });
  });

  app.post("/api/agent/spend-plan", async (c) => {
    const tid = agentTicket(c);
    if (!store.getTicket(tid).toggles.spend) throw new RuleError("Spend is off on this ticket. Don't do paid work.");
    const { items } = await parse(c, s.spendPlanSchema);
    return c.json(store.setSpendPlan(tid, items));
  });

  app.post("/api/agent/spend", async (c) => {
    const tid = agentTicket(c);
    const { service, amount } = await parse(c, s.reportSpendSchema);
    return c.json(store.reportSpend(tid, service, amount));
  });

  app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "No such endpoint" } }, 404));

  // ---------- board (built) ----------

  if (deps.boardDir) {
    const root = path.relative(process.cwd(), deps.boardDir);
    app.use("/*", serveStatic({ root }));
    app.get("*", serveStatic({ path: path.join(root, "index.html") }));
  }

  function saveAttachment(ticketId: number, name: string, mime: string, data: Buffer) {
    const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
    const storedName = `${randomUUID()}${ext}`;
    fs.writeFileSync(path.join(deps.attachmentsDir, storedName), data);
    return store.addAttachment(ticketId, {
      name: safeName(name),
      storedName,
      size: data.length,
      mime: mime || "application/octet-stream",
    });
  }

  return app;
}
