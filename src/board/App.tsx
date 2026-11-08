import { useEffect, useMemo, useState } from "react";
import type { Status, SystemState, TicketSummary } from "../shared/types.ts";
import { api, errorMessage } from "./api.ts";
import { Board } from "./Board.tsx";
import { NewTicketDialog } from "./NewTicketDialog.tsx";
import { Settings } from "./Settings.tsx";
import { TicketPanel } from "./TicketPanel.tsx";
import { Button } from "./components/Button.tsx";
import { Icon, type IconName } from "./components/Icon.tsx";
import { useToast } from "./components/Toast.tsx";
import { useBoardEvents } from "./events.ts";
import { useDebouncedCallback, useResource } from "./hooks.ts";

type View = "board" | "settings";

export function App() {
  const toast = useToast();
  const [view, setView] = useState<View>("board");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const tickets = useResource((signal) => api.get<TicketSummary[]>("/api/tickets", signal), "tickets");
  const system = useResource((signal) => api.get<SystemState>("/api/system", signal), "system");

  const reloadTickets = useDebouncedCallback(tickets.reload, 150);
  const reloadSystem = useDebouncedCallback(system.reload, 150);

  useBoardEvents((m) => {
    if (m.type === "tickets") reloadTickets();
    else if (m.type === "system") system.setData(() => m.state);
    else if (m.type === "reconnect") {
      reloadTickets();
      reloadSystem();
    }
  });

  useEffect(() => {
    if (!selectedId || creating) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, creating]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = tickets.data ?? [];
    return q ? all.filter((t) => t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q)) : all;
  }, [tickets.data, query]);

  const move = async (id: number, status: Status) => {
    const current = tickets.data?.find((t) => t.id === id);
    if (!current || current.status === status) return;
    tickets.setData((prev) => prev?.map((t) => (t.id === id ? { ...t, status } : t)));
    try {
      await api.post(`/api/tickets/${id}/status`, { status });
    } catch (e) {
      toast(errorMessage(e));
    }
    tickets.reload();
  };

  const sys = system.data;
  const running = sys?.running ?? tickets.data?.filter((t) => t.runState === "running").length ?? 0;
  const max = sys?.maxParallel ?? 3;

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row">
      <Sidebar view={view} onView={setView} system={sys} />
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-5">
          <h1 className="text-base font-semibold">{view === "board" ? "Board" : "Settings"}</h1>
          {view === "board" && (
            <div className="flex min-w-44 items-center gap-2 rounded-ctl border border-line bg-card px-2.5 py-1.5 text-muted focus-within:outline-2 focus-within:outline-accent">
              <Icon name="search" />
              <input
                type="search"
                aria-label="Search tickets"
                placeholder="Search tickets"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-transparent text-text outline-none placeholder:text-muted"
              />
            </div>
          )}
          <span className="flex-1" />
          <div className="flex items-center gap-2 text-xs whitespace-nowrap text-muted" title="Agents running now and tickets waiting">
            <span className="flex gap-1.5" aria-hidden="true">
              {Array.from({ length: max }, (_, i) => (
                <span key={i} className={`h-1.5 w-4.5 rounded-sm ${i < running ? "bg-running" : "bg-line"}`} />
              ))}
            </span>
            <span>
              {sys ? `${running}/${max} · ${sys.queued} queued` : "Agents …"}
              <span className="sr-only"> agent slots in use</span>
            </span>
          </div>
          {view === "board" && (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New ticket
            </Button>
          )}
        </header>

        {view === "settings" ? (
          <Settings />
        ) : (
          <div className="flex flex-1 flex-col md:min-h-0 md:flex-row">
            <main className="flex min-w-0 flex-1 flex-col md:min-h-0">
              {tickets.loading && (
                <p role="status" className="p-5 text-muted">
                  Loading tickets…
                </p>
              )}
              {tickets.error && (
                <div role="alert" className="flex flex-col items-start gap-2 p-5">
                  <p className="text-blocked">Couldn't load tickets: {tickets.error}</p>
                  <Button onClick={tickets.retry}>Retry</Button>
                </div>
              )}
              {tickets.data && (
                <>
                  {tickets.data.length === 0 && <p className="px-4 pt-4 text-sm text-muted md:px-5">No tickets yet. Create one with New ticket.</p>}
                  {tickets.data.length > 0 && query && visible.length === 0 && <p className="px-4 pt-4 text-sm text-muted md:px-5">No tickets match "{query}".</p>}
                  <Board tickets={visible} selectedId={selectedId} runningLabel={`${running}/${max} running`} onSelect={setSelectedId} onMove={move} />
                </>
              )}
            </main>
            {selectedId !== null && <TicketPanel key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} />}
          </div>
        )}
      </div>

      {creating && (
        <NewTicketDialog
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            setSelectedId(t.id);
            tickets.reload();
          }}
        />
      )}
    </div>
  );
}

function Sidebar({ view, onView, system }: { view: View; onView: (v: View) => void; system: SystemState | undefined }) {
  const nav: { id: View; label: string; icon: IconName }[] = [
    { id: "board", label: "Board", icon: "board" },
    { id: "settings", label: "Settings", icon: "settings" },
  ];
  const resetAt = system?.limitResetAt ? new Date(system.limitResetAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <aside className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2 md:w-14 md:flex-col md:border-r md:border-b-0 md:px-2 md:py-3">
      <div className="grid size-7 place-items-center rounded-md bg-accent text-accent-text" title="Relay">
        <Icon name="relay" />
        <span className="sr-only">Relay</span>
      </div>
      <nav aria-label="Main" className="flex gap-1 md:mt-3 md:flex-col">
        {nav.map((n) => (
          <button
            key={n.id}
            type="button"
            aria-label={n.label}
            title={n.label}
            aria-current={view === n.id ? "page" : undefined}
            onClick={() => onView(n.id)}
            className={`grid size-9 place-items-center rounded-md ${view === n.id ? "bg-card text-text" : "text-muted hover:text-text"}`}
          >
            <Icon name={n.icon} className="size-4.5" />
          </button>
        ))}
      </nav>
      <ul className="ml-auto flex gap-3 text-[9px] text-muted md:mt-auto md:ml-0 md:flex-col md:gap-3" aria-label="System status">
        <Status icon="clock" ok={!resetAt} onText="Limit OK" offText={resetAt ? `Paused until ${resetAt}` : "Paused"} shortOn="OK" shortOff="Paused" loaded={!!system} />
        <Status icon="moon" ok={!!system?.keepingAwake} onText="Keeping PC awake" offText="Not keeping PC awake" shortOn="Awake" shortOff="Sleep" loaded={!!system} />
        <Status icon="bell" ok={!!system?.ntfyEnabled} onText="ntfy notifications on" offText="ntfy notifications off" shortOn="ntfy" shortOff="No ntfy" loaded={!!system} />
      </ul>
    </aside>
  );
}

function Status({ icon, ok, onText, offText, shortOn, shortOff, loaded }: { icon: IconName; ok: boolean; onText: string; offText: string; shortOn: string; shortOff: string; loaded: boolean }) {
  const text = !loaded ? "Status unknown" : ok ? onText : offText;
  return (
    <li className="flex flex-col items-center gap-0.5" title={text}>
      <Icon name={icon} className={`size-4 ${loaded && ok ? "text-done" : "text-muted"}`} />
      <span aria-hidden="true">{loaded ? (ok ? shortOn : shortOff) : "…"}</span>
      <span className="sr-only">{text}</span>
    </li>
  );
}
