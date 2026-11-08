import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Store } from "../server/store.ts";
import type { ModelSettingsPort } from "../server/app.ts";
import type { ModelRole } from "../shared/types.ts";

export interface AgentDef {
  name: string;
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

interface SavedModels {
  main: string;
  agents: Record<string, string>;
}

const DEFAULT_MAIN = "opus";

/** Parses an agent file: YAML-ish frontmatter (one `key: value` per line) and a prompt body. */
export function parseAgentFile(text: string): AgentDef | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "").trim();
  }
  if (!fields.name || !fields.description) return null;
  return {
    name: fields.name,
    description: fields.description,
    prompt: m[2]!.trim(),
    tools: fields.tools ? fields.tools.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
    model: fields.model || undefined,
  };
}

export class ModelSettings implements ModelSettingsPort {
  constructor(
    private store: Store,
    private agentsDir = path.join(os.homedir(), ".claude", "agents"),
  ) {}

  userAgents(): AgentDef[] {
    let files: string[];
    try {
      files = fs.readdirSync(this.agentsDir).filter((f) => f.endsWith(".md"));
    } catch {
      return [];
    }
    return files
      .map((f) => parseAgentFile(fs.readFileSync(path.join(this.agentsDir, f), "utf8")))
      .filter((a): a is AgentDef => a !== null);
  }

  private saved(): SavedModels {
    return this.store.getSetting<SavedModels>("models", { main: DEFAULT_MAIN, agents: {} });
  }

  list(): ModelRole[] {
    const saved = this.saved();
    return [
      { name: "main", description: "Runs every ticket end to end", source: "relay", model: saved.main },
      ...this.userAgents().map((a) => ({
        name: a.name,
        description: a.description,
        source: "user-agent" as const,
        model: saved.agents[a.name] ?? a.model ?? "inherit",
      })),
    ];
  }

  save(input: SavedModels): ModelRole[] {
    const known = new Set(this.userAgents().map((a) => a.name));
    const agents = Object.fromEntries(Object.entries(input.agents).filter(([name]) => known.has(name)));
    this.store.setSetting("models", { main: input.main, agents });
    return this.list();
  }

  mainModel(ticketModel: string | null): string {
    return ticketModel ?? this.saved().main;
  }

  /** `--agents` JSON re-declaring each user agent whose model was changed in Settings. */
  agentsOverride(): string | null {
    const saved = this.saved().agents;
    const out: Record<string, Omit<AgentDef, "name">> = {};
    for (const a of this.userAgents()) {
      const model = saved[a.name];
      if (!model || model === a.model) continue;
      out[a.name] = { description: a.description, prompt: a.prompt, ...(a.tools ? { tools: a.tools } : {}), model };
    }
    return Object.keys(out).length ? JSON.stringify(out) : null;
  }
}
