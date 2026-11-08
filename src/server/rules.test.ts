import { describe, expect, it } from "vitest";
import { routeComment } from "./rules.ts";

describe("routeComment", () => {
  it("injects @agent comments into a running ticket", () => {
    expect(routeComment("agent_ready", "running", "@agent also do X")).toBe("inject");
  });

  it("resumes Review and Blocked tickets on @agent", () => {
    expect(routeComment("review", "idle", "please fix @agent")).toBe("resume");
    expect(routeComment("blocked", "idle", "@Agent go")).toBe("resume");
  });

  it("treats comments without @agent as notes", () => {
    expect(routeComment("agent_ready", "running", "just a note")).toBe("note");
    expect(routeComment("review", "idle", "email me at x@agentmail.com")).toBe("note");
  });

  it("treats @agent elsewhere as a note", () => {
    expect(routeComment("todo", "idle", "@agent")).toBe("note");
    expect(routeComment("done", "idle", "@agent")).toBe("note");
    expect(routeComment("agent_ready", "queued", "@agent")).toBe("note");
  });
});
