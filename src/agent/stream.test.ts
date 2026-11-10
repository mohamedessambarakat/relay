import { describe, expect, it } from "vitest";
import { parseCodexLine, parseStreamLine } from "./stream.ts";
import { parseAgentFile } from "./models.ts";

describe("parseStreamLine", () => {
  it("reads the session id from init", () => {
    const ev = parseStreamLine(JSON.stringify({ type: "system", subtype: "init", session_id: "abc", model: "claude-haiku-5-5" }));
    expect(ev[0]).toEqual({ kind: "session", sessionId: "abc" });
  });

  it("logs text and tool calls of the main agent only", () => {
    const main = parseStreamLine(
      JSON.stringify({
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "Working" }, { type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] },
      }),
    );
    expect(main).toEqual([
      { kind: "log", level: "text", text: "Working" },
      { kind: "log", level: "tool", text: "Bash pnpm test" },
    ]);
    const sub = parseStreamLine(JSON.stringify({ type: "assistant", parent_tool_use_id: "t1", message: { content: [{ type: "text", text: "x" }] } }));
    expect(sub).toEqual([]);
  });

  it("ignores allowed rate-limit events and reports rejected ones with the reset time", () => {
    expect(parseStreamLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "allowed", resetsAt: 1 } }))).toEqual([]);
    const ev = parseStreamLine(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1794154200 } }));
    expect(ev).toEqual([{ kind: "limit", resetsAt: new Date(1794154200 * 1000) }]);
  });

  it("ends a turn on result and flags 429s as the limit", () => {
    const ev = parseStreamLine(JSON.stringify({ type: "result", is_error: true, api_error_status: 429, result: "limit" }));
    expect(ev.map((e) => e.kind)).toEqual(["limit", "log", "turn-end"]);
  });
});

describe("parseCodexLine", () => {
  const line = (o: unknown) => parseCodexLine(JSON.stringify(o));

  it("reads the thread id as the session", () => {
    expect(line({ type: "thread.started", thread_id: "th" })[0]).toEqual({ kind: "session", sessionId: "th" });
  });

  it("logs messages, shell commands, MCP calls and file edits", () => {
    expect(line({ type: "item.completed", item: { type: "agent_message", text: "PONG" } })).toEqual([{ kind: "log", level: "text", text: "PONG" }]);
    expect(line({ type: "item.started", item: { type: "command_execution", command: "pnpm test" } })).toEqual([{ kind: "log", level: "tool", text: "shell pnpm test" }]);
    expect(line({ type: "item.started", item: { type: "mcp_tool_call", server: "relay", tool: "get_ticket" } })).toEqual([{ kind: "log", level: "tool", text: "relay/get_ticket" }]);
    expect(line({ type: "item.completed", item: { type: "file_change", changes: [{ path: "a.ts" }, { path: "b.ts" }] } })).toEqual([{ kind: "log", level: "tool", text: "edit a.ts, b.ts" }]);
  });

  it("ends a turn on turn.completed and turn.failed", () => {
    expect(line({ type: "turn.completed", usage: {} }).map((e) => e.kind)).toEqual(["log", "turn-end"]);
    const failed = line({ type: "turn.failed", error: { message: "model_not_found" } });
    expect(failed.map((e) => e.kind)).toEqual(["log", "turn-end"]);
    expect(failed[1]).toEqual({ kind: "turn-end", isError: true });
  });

  it("treats usage-limit errors as the limit", () => {
    expect(line({ type: "turn.failed", error: { message: "You've hit your usage limit." } }).map((e) => e.kind)).toEqual(["limit", "log", "turn-end"]);
    // A top-level error may be a transient retry, so it's only logged.
    expect(line({ type: "error", message: "429 Too Many Requests, retrying" }).map((e) => e.kind)).toEqual(["log"]);
    expect(line({ type: "error", message: "status 400 model_not_found" }).map((e) => e.kind)).toEqual(["log"]);
  });
});

describe("parseAgentFile", () => {
  it("reads name, description, tools, model and prompt", () => {
    const a = parseAgentFile("---\nname: researcher\ndescription: Finds facts\ntools: Read, Grep\nmodel: haiku\n---\n\nYou find facts.\n");
    expect(a).toEqual({ name: "researcher", description: "Finds facts", tools: ["Read", "Grep"], model: "haiku", prompt: "You find facts." });
  });

  it("skips files without frontmatter", () => {
    expect(parseAgentFile("just text")).toBeNull();
  });
});
