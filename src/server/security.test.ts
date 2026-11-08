import { describe, expect, it } from "vitest";
import { checkRequest } from "./security.ts";

const base = { method: "POST", path: "/api/tickets", host: "localhost:4317", origin: "http://localhost:4317", fetchSite: "same-origin", hasAgentToken: false };

describe("checkRequest", () => {
  it("allows Relay's own page", () => {
    expect(checkRequest(base, 4317)).toEqual({ ok: true });
  });

  it("rejects writes from another origin", () => {
    expect(checkRequest({ ...base, origin: "https://evil.example" }, 4317).ok).toBe(false);
  });

  it("rejects writes without an Origin", () => {
    expect(checkRequest({ ...base, origin: undefined, fetchSite: undefined }, 4317).ok).toBe(false);
  });

  it("rejects a foreign Host (DNS rebinding)", () => {
    expect(checkRequest({ ...base, method: "GET", host: "evil.example:4317", origin: undefined }, 4317).ok).toBe(false);
  });

  it("rejects cross-site reads", () => {
    expect(checkRequest({ ...base, method: "GET", origin: undefined, fetchSite: "cross-site" }, 4317).ok).toBe(false);
  });

  it("allows same-origin reads without Origin", () => {
    expect(checkRequest({ ...base, method: "GET", origin: undefined }, 4317).ok).toBe(true);
  });

  it("lets agent calls through only with a token", () => {
    const agent = { ...base, path: "/api/agent/comments", origin: undefined, fetchSite: undefined };
    expect(checkRequest(agent, 4317).ok).toBe(false);
    expect(checkRequest({ ...agent, hasAgentToken: true }, 4317).ok).toBe(true);
  });

  it("doesn't let a token excuse a foreign Origin", () => {
    expect(checkRequest({ ...base, path: "/api/agent/comments", origin: "https://evil.example", hasAgentToken: true }, 4317).ok).toBe(false);
  });
});
