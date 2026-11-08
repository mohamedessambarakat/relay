import { MODEL_CHOICES, type ModelRole } from "../shared/types.ts";
import { api, errorMessage } from "./api.ts";
import { Button } from "./components/Button.tsx";
import { controlClass } from "./components/Field.tsx";
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
      <h2 className="mb-1 text-base font-semibold">Models</h2>
      <p className="mb-4 max-w-2xl font-ui text-sm text-muted">
        Pick which model each role uses. "Not set (inherits)" means the agent has no model of its own and uses the main agent's model. Built-in subagents (Explore, Plan, general-purpose) aren't listed because overriding them would replace their built-in prompts.
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
