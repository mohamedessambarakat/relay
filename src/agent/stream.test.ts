import { describe, expect, it } from "vitest";
import { parseStreamLine } from "./stream.ts";
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

describe("parseAgentFile", () => {
  it("reads name, description, tools, model and prompt", () => {
    const a = parseAgentFile("---\nname: researcher\ndescription: Finds facts\ntools: Read, Grep\nmodel: haiku\n---\n\nYou find facts.\n");
    expect(a).toEqual({ name: "researcher", description: "Finds facts", tools: ["Read", "Grep"], model: "haiku", prompt: "You find facts." });
  });

  it("skips files without frontmatter", () => {
    expect(parseAgentFile("just text")).toBeNull();
  });
});
