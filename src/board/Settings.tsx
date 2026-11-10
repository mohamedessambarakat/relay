import { useState } from "react";
import { MODEL_CHOICES, PROVIDER_LABELS, PROVIDERS, type ModelRole, type ProviderId, type ProviderSettings } from "../shared/types.ts";
import { api, errorMessage } from "./api.ts";
import { Button } from "./components/Button.tsx";
import { controlClass, TextField } from "./components/Field.tsx";
import { useToast } from "./components/Toast.tsx";
import { useResource } from "./hooks.ts";

const isChoice = (m: string) => MODEL_CHOICES.some((c) => c.id === m);

export function Settings() {
  const toast = useToast();
  const { data: roles, error, loading, retry, reload, setData } = useResource((signal) => api.get<ModelRole[]>("/api/settings/models", signal), "models");

  const change = async (name: string, model: string) => {
    if (!roles) return;
    const next = roles.map((r) => (r.name === name ? { ...r, model } : r));
    const main = next.find((r) => r.name === "main");
    if (!main) return;
    const agents: Record<string, string> = {};
    // Agents still on "inherit" have no model of their own, so they are not sent.
    for (const r of next) if (r.source === "user-agent" && isChoice(r.model)) agents[r.name] = r.model;
    const prev = roles;
    setData(() => next);
    try {
      const saved = await api.put<ModelRole[]>("/api/settings/models", { main: main.model, agents });
      setData(() => saved);
      toast("Model saved", "success");
    } catch (e) {
      setData(() => prev);
      toast(errorMessage(e));
      reload();
    }
  };

  return (
    <div className="flex-1 overflow-auto px-4 py-4 md:px-5">
      <AgentSettings />
      <h2 className="mb-1 mt-8 text-base font-semibold">Claude models</h2>
      <p className="mb-4 max-w-2xl font-ui text-sm text-muted">
        Used when a ticket runs on Claude Code. Pick which model each role uses. "Not set (inherits)" means the agent has no model of its own and uses the main agent's model. Built-in subagents (Explore, Plan, general-purpose) aren't listed because overriding them would replace their built-in prompts.
      </p>
      {loading && <p role="status" className="text-muted">Loading models…</p>}
      {error && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-blocked">Couldn't load models: {error}</p>
          <Button onClick={retry}>Retry</Button>
        </div>
      )}
      {roles && roles.length === 0 && <p className="text-muted">No roles found.</p>}
      {roles && roles.length > 0 && (
        <div tabIndex={0} role="region" aria-label="Model per role" className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-xl border-collapse text-left text-sm">
            <caption className="sr-only">Model per role</caption>
            <thead className="bg-panel text-xs text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Role</th>
                <th scope="col" className="px-3 py-2 font-semibold">Source</th>
                <th scope="col" className="px-3 py-2 font-semibold">Description</th>
                <th scope="col" className="px-3 py-2 font-semibold">Model</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.name} className="border-t border-line align-top">
                  <th scope="row" className="px-3 py-2 font-semibold">{r.name}</th>
                  <td className="px-3 py-2 text-muted">{r.source === "relay" ? "Relay" : "~/.claude/agents"}</td>
                  <td className="px-3 py-2 font-ui text-muted">{r.description}</td>
                  <td className="px-3 py-2">
                    <label htmlFor={`model-${r.name}`} className="sr-only">Model for {r.name}</label>
                    <select id={`model-${r.name}`} className={`${controlClass} min-w-36`} value={r.model} onChange={(e) => void change(r.name, e.target.value)}>
                      {!isChoice(r.model) && <option value={r.model}>{r.model === "inherit" ? "Not set (inherits)" : r.model}</option>}
                      {MODEL_CHOICES.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Default agent CLI for tickets, and the Codex model. */
function AgentSettings() {
  const toast = useToast();
  const { data, error, retry, setData } = useResource((signal) => api.get<ProviderSettings>("/api/settings/provider", signal), "provider-settings");
  const [saving, setSaving] = useState(false);

  const save = async (next: ProviderSettings) => {
    if (!data) return;
    const prev = data;
    setData(() => next);
    setSaving(true);
    try {
      const saved = await api.put<ProviderSettings>("/api/settings/provider", next);
      setData(() => saved);
      toast("Saved", "success");
      return true;
    } catch (e) {
      setData(() => prev);
      toast(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="agent-settings">
      <h2 id="agent-settings" className="mb-1 text-base font-semibold">Agent</h2>
      <p className="mb-4 max-w-2xl font-ui text-sm text-muted">
        Which coding agent runs tickets that don't pick one. Each ticket can override it. Codex runs one turn at a time, so an @agent comment on a running Codex ticket is sent when the current turn ends.
      </p>
      {error && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-blocked">Couldn't load agent settings: {error}</p>
          <Button onClick={retry}>Retry</Button>
        </div>
      )}
      {data && (
        <dl className="grid max-w-xl grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
          <dt><label htmlFor="default-agent" className="text-muted">Default agent</label></dt>
          <dd className="m-0">
            <select id="default-agent" className={controlClass} value={data.provider} disabled={saving} onChange={(e) => void save({ ...data, provider: e.target.value as ProviderId })}>
              {PROVIDERS.map((id) => <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>)}
            </select>
          </dd>
          <dt><label htmlFor="codex-model" className="text-muted">Codex model</label></dt>
          <dd className="m-0">
            <TextField
              id="codex-model"
              placeholder="Codex's own default (~/.codex/config.toml)"
              value={data.codexModel}
              onCommit={(v) => save({ ...data, codexModel: v.trim() })}
            />
          </dd>
        </dl>
      )}
    </section>
  );
}
