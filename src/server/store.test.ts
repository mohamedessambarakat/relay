import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { EventBus } from "./events.ts";
import { RuleError, Store } from "./store.ts";

let store: Store;
beforeEach(() => {
  store = new Store(openDb(":memory:"), new EventBus());
});

describe("Store", () => {
  it("creates tickets with default toggles (Spend off)", () => {
    const t = store.createTicket({ title: "Write README" });
    expect(t.key).toBe(`R-${t.id}`);
    expect(t.status).toBe("backlog");
    expect(t.toggles).toEqual({ send: true, push: true, publish: true, merge: true, deploy: true, spend: false });
  });

  it("orders the queue by priority, then oldest", async () => {
    const low = store.createTicket({ title: "low", priority: 1, status: "agent_ready" });
    await new Promise((r) => setTimeout(r, 5));
    const high = store.createTicket({ title: "high", priority: 3, status: "agent_ready" });
    await new Promise((r) => setTimeout(r, 5));
    const high2 = store.createTicket({ title: "high later", priority: 3, status: "agent_ready" });
    expect(store.queueOrder().map((q) => q.id)).toEqual([high.id, high2.id, low.id]);
  });

  it("only lets the agent move tickets to Review or Blocked", () => {
    const t = store.createTicket({ title: "x", status: "agent_ready" });
    expect(() => store.setStatus(t.id, "done", "agent")).toThrow(RuleError);
    expect(() => store.setStatus(t.id, "done", "runner")).toThrow(RuleError);
    expect(store.setStatus(t.id, "review", "agent").status).toBe("review");
    expect(store.setStatus(t.id, "done", "user").status).toBe("done");
  });

  it("pre-fills spend maxes with the agent's estimate and keeps the user's max on re-plan", () => {
    const t = store.createTicket({ title: "reel", toggles: { spend: true } });
    const [item] = store.setSpendPlan(t.id, [{ service: "ElevenLabs", unit: "credits", reason: "voiceover", estimate: 20000 }]);
    expect(item!.max).toBe(20000);
    store.setSpendMax(t.id, item!.id, 15000);
    const [again] = store.setSpendPlan(t.id, [{ service: "ElevenLabs", unit: "credits", reason: "voiceover v2", estimate: 25000 }]);
    expect(again!.max).toBe(15000);
    expect(again!.estimate).toBe(25000);
  });

  it("refuses spend that would pass the max", () => {
    const t = store.createTicket({ title: "reel", toggles: { spend: true } });
    store.setSpendPlan(t.id, [{ service: "API", unit: "USD", reason: "", estimate: 10 }]);
    expect(store.reportSpend(t.id, "API", 6).used).toBe(6);
    expect(() => store.reportSpend(t.id, "API", 5)).toThrow(RuleError);
    expect(() => store.reportSpend(t.id, "Unknown", 1)).toThrow(RuleError);
  });
});
