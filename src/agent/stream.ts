import type { LogLine } from "../shared/types.ts";

export type StreamEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "log"; level: LogLine["kind"]; text: string }
  | { kind: "turn-end"; isError: boolean }
  | { kind: "limit"; resetsAt: Date };

const OK_LIMIT = new Set(["allowed", "allowed_warning"]);
const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

function toolSummary(name: string, input: Record<string, unknown>): string {
  const pick = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description;
  return `${name.replace(/^mcp__/, "")}${typeof pick === "string" ? ` ${clip(pick, 160)}` : ""}`;
}

/** Turns one line of `claude -p --output-format stream-json` into what the runner cares about. */
export function parseStreamLine(line: string): StreamEvent[] {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line.trim() ? [{ kind: "log", level: "info", text: clip(line) }] : [];
  }
  const out: StreamEvent[] = [];
  switch (m.type) {
    case "system":
      if (m.subtype === "init" && typeof m.session_id === "string") {
        out.push({ kind: "session", sessionId: m.session_id });
        out.push({ kind: "log", level: "info", text: `Session started (${String(m.model ?? "model ?")})` });
      }
      break;
    case "assistant": {
      // Subagent messages carry parent_tool_use_id; keep the log to the main agent.
      if (m.parent_tool_use_id) break;
      const content = (m.message as { content?: unknown[] } | undefined)?.content ?? [];
      for (const c of content as Record<string, unknown>[]) {
        if (c.type === "text" && typeof c.text === "string" && c.text.trim()) out.push({ kind: "log", level: "text", text: clip(c.text, 600) });
        if (c.type === "tool_use") out.push({ kind: "log", level: "tool", text: toolSummary(String(c.name), (c.input ?? {}) as Record<string, unknown>) });
      }
      break;
    }
    case "rate_limit_event": {
      const info = m.rate_limit_info as { status?: string; resetsAt?: number } | undefined;
      if (info?.status && !OK_LIMIT.has(info.status)) {
        const resetsAt = info.resetsAt ? new Date(info.resetsAt * 1000) : new Date(Date.now() + 60 * 60 * 1000);
        out.push({ kind: "limit", resetsAt });
      }
      break;
    }
    case "result": {
      const isError = m.is_error === true;
      if (m.api_error_status === 429) out.push({ kind: "limit", resetsAt: new Date(Date.now() + 60 * 60 * 1000) });
      out.push({
        kind: "log",
        level: isError ? "error" : "result",
        text: `Turn finished${isError ? " with an error" : ""}${typeof m.result === "string" && isError ? `: ${clip(m.result)}` : ""}`,
      });
      out.push({ kind: "turn-end", isError });
      break;
    }
  }
  return out;
}

// Codex reports usage limits as error text; the exact wording wasn't seen in testing, so this is a best guess.
const CODEX_LIMIT = /usage limit|rate limit|too many requests|\b429\b/i;
const LIMIT_WAIT_MS = 60 * 60 * 1000;

/** Only a failed turn counts as the limit: top-level errors can be transient retries within a turn. */
function codexError(message: string, out: StreamEvent[], turnFailed: boolean) {
  if (turnFailed && CODEX_LIMIT.test(message)) out.push({ kind: "limit", resetsAt: new Date(Date.now() + LIMIT_WAIT_MS) });
  out.push({ kind: "log", level: "error", text: clip(message) });
}

/** Turns one line of `codex exec --json` into what the runner cares about. */
export function parseCodexLine(line: string): StreamEvent[] {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return line.trim() ? [{ kind: "log", level: "info", text: clip(line) }] : [];
  }
  const out: StreamEvent[] = [];
  const item = (m.item ?? {}) as Record<string, unknown>;
  switch (m.type) {
    case "thread.started":
      if (typeof m.thread_id === "string") {
        out.push({ kind: "session", sessionId: m.thread_id });
        out.push({ kind: "log", level: "info", text: "Codex session started" });
      }
      break;
    case "item.started":
      if (item.type === "command_execution") out.push({ kind: "log", level: "tool", text: `shell ${clip(String(item.command ?? ""), 160)}` });
      else if (item.type === "mcp_tool_call") out.push({ kind: "log", level: "tool", text: `${String(item.server)}/${String(item.tool)}` });
      else if (item.type === "web_search") out.push({ kind: "log", level: "tool", text: `web_search ${clip(String(item.query ?? ""), 160)}` });
      break;
    case "item.completed":
      if (item.type === "agent_message" && typeof item.text === "string" && item.text.trim()) {
        out.push({ kind: "log", level: "text", text: clip(item.text, 600) });
      } else if (item.type === "file_change" && Array.isArray(item.changes)) {
        const paths = (item.changes as { path?: string }[]).map((c) => c.path).filter(Boolean).join(", ");
        out.push({ kind: "log", level: "tool", text: `edit ${clip(paths, 160)}` });
      } else if (item.type === "error" && typeof item.message === "string") {
        // Item-level errors are warnings (e.g. unknown model metadata); the turn carries on.
        out.push({ kind: "log", level: "info", text: clip(item.message) });
      }
      break;
    case "turn.completed":
      out.push({ kind: "log", level: "result", text: "Turn finished" });
      out.push({ kind: "turn-end", isError: false });
      break;
    case "turn.failed": {
      const msg = (m.error as { message?: string } | undefined)?.message ?? "unknown error";
      codexError(`Turn failed: ${msg}`, out, true);
      out.push({ kind: "turn-end", isError: true });
      break;
    }
    case "error":
      if (typeof m.message === "string") codexError(m.message, out, false);
      break;
  }
  return out;
}
