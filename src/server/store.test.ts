import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { EventBus } from "./events.ts";
import { RuleError, Store } from "./store.ts";

let store: Store;
beforeEach(() => {
  store = new Store(openDb(":memory:"), new EventBus());
});

describe("openDb migration", () => {
  it("adds in_progress to an old tickets table and keeps its rows", async () => {
    const { DatabaseSync } = await import("node:sqlite");
    const os = await import("node:os");
    const path = await import("node:path");
    const fs = await import("node:fs");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "relay-mig-")), "old.db");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200), description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('backlog','todo','agent_ready','blocked','review','done')), priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4), labels TEXT NOT NULL DEFAULT '[]', due_date TEXT, linked_path TEXT, toggles TEXT NOT NULL, model TEXT, session_id TEXT, workspace TEXT, branch TEXT, run_state TEXT NOT NULL DEFAULT 'idle' CHECK (run_state IN ('idle','queued','running','waiting_limit')), run_started_at TEXT, ready_at TEXT, failures INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    old.prepare("INSERT INTO tickets (title, status, toggles, created_at, updated_at) VALUES ('old', 'review', '{}', 'x', 'x')").run();
    old.close();
    const s = new Store(openDb(file), new EventBus());
    const [t] = s.listTickets();
    expect(t!.title).toBe("old");
    s.setStatus(t!.id, "agent_ready", "user");
    expect(s.setStatus(t!.id, "in_progress", "runner").status).toBe("in_progress");
  });
});

describe("Store", () => {
  it("creates tickets with every outward toggle off", () => {
    const t = store.createTicket({ title: "Write README" });
    expect(t.key).toBe(`R-${t.id}`);
    expect(t.status).toBe("backlog");
    expect(t.toggles).toEqual({ send: false, push: false, publish: false, merge: false, deploy: false, spend: false });
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
