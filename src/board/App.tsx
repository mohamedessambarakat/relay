import { useCallback, useEffect, useMemo, useState } from "react";
import { STATUS_LABELS, type Status, type SystemState, type TicketSummary } from "../shared/types.ts";
import { api, errorMessage } from "./api.ts";
import { Board } from "./Board.tsx";
import { NewTicketDialog } from "./NewTicketDialog.tsx";
import { Settings } from "./Settings.tsx";
import { TicketPanel } from "./TicketPanel.tsx";
import { Button } from "./components/Button.tsx";
import { useConfirm } from "./components/ConfirmDialog.tsx";
import { Icon, type IconName } from "./components/Icon.tsx";
import { useToast } from "./components/Toast.tsx";
import { useBoardEvents, useConnected } from "./events.ts";
import { useDebouncedCallback, useNow, useResource } from "./hooks.ts";
import { moveWarning } from "./moves.ts";

type View = "board" | "settings";
type Override = { base: Status; to: Status };

export function App() {
  const toast = useToast();
  const confirm = useConfirm();
  const connected = useConnected();
  const now = useNow(30_000);
  const [view, setView] = useState<View>("board");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  // Optimistic moves, applied on top of server data while the server still reports the old status.
  // A reload that started before the move therefore can't flick the card back.
  const [overrides, setOverrides] = useState<Record<number, Override>>({});

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

  const closePanel = useCallback(() => {
    const id = selectedId;
    setSelectedId(null);
    if (id === null) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-ticket-id="${id}"]`)?.focus());
  }, [selectedId]);

  useEffect(() => {
    if (selectedId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog], [role=alertdialog], [role=menu]")) return;
      if (document.querySelector("[role=dialog], [role=alertdialog], [role=menu]")) return;
      closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, closePanel]);

  const displayed = useMemo(
    () =>
      tickets.data?.map((t) => {
        const o = overrides[t.id];
        return o && t.status === o.base ? { ...t, status: o.to } : t;
      }),
    [tickets.data, overrides],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = displayed ?? [];
    return q ? all.filter((t) => t.title.toLowerCase().includes(q) || t.key.toLowerCase().includes(q)) : all;
  }, [displayed, query]);

  const move = async (ticket: TicketSummary, to: Status) => {
    if (ticket.status === to) return;
    const warning = moveWarning(ticket, to);
    if (warning && !(await confirm(warning))) return;
    const base = tickets.data?.find((t) => t.id === ticket.id)?.status ?? ticket.status;
    setOverrides((o) => ({ ...o, [ticket.id]: { base, to } }));
    const drop = () =>
      setOverrides((o) => {
        const { [ticket.id]: _gone, ...rest } = o;
        return rest;
      });
    try {
      await api.post(`/api/tickets/${ticket.id}/status`, { status: to });
      setAnnouncement(`${ticket.key} moved to ${STATUS_LABELS[to]}`);
      if (to === "agent_ready") toast(`${ticket.key} sent to the agent`, "success");
      tickets.reload();
      window.setTimeout(drop, 3000);
    } catch (e) {
      drop();
      toast(errorMessage(e));
      tickets.reload();
    }
  };

  const remove = async (ticket: TicketSummary) => {
    const active = ticket.runState === "running" || ticket.runState === "waiting_limit";
    const ok = await confirm({
      title: `Delete ${ticket.key} "${ticket.title}"?`,
      body: `This permanently deletes the ticket, its comments and attachments.${active ? " This also stops the running agent." : ""}`,
      confirmLabel: "Delete ticket",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/tickets/${ticket.id}`);
      if (selectedId === ticket.id) setSelectedId(null);
      setAnnouncement(`${ticket.key} deleted`);
      toast(`Deleted ${ticket.key}`, "success");
    } catch (e) {
      toast(errorMessage(e));
    }
    tickets.reload();
  };

  const sys = system.data;
  const running = sys?.running ?? tickets.data?.filter((t) => t.runState === "running").length ?? 0;
  const max = sys?.maxParallel ?? 3;
  const queued = sys?.queued ?? 0;
  const resetAtMs = sys?.limitResetAt ? new Date(sys.limitResetAt).getTime() : null;
  const resetClock = resetAtMs ? new Date(resetAtMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
  const resetMins = resetAtMs ? Math.max(1, Math.ceil((resetAtMs - now) / 60_000)) : null;

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <a
        href="#main"
        className="sr-only rounded-ctl bg-accent px-3 py-2 text-accent-text focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <Sidebar view={view} onView={setView} system={sys} />
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-5">
          <h1 className="text-base font-semibold">{view === "board" ? "Board" : "Settings"}</h1>
          {view === "board" && (
            <div className="flex min-w-44 items-center gap-2 rounded-ctl border border-control bg-card px-2.5 py-1.5 text-muted focus-within:outline-2 focus-within:outline-accent">
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
            <span className="hidden gap-1.5 sm:flex" aria-hidden="true">
              {Array.from({ length: max }, (_, i) => (
                <span key={i} className={`h-1.5 w-4.5 rounded-sm ${i < running ? "bg-running" : "bg-line"}`} />
              ))}
            </span>
            {running > 0 && <span className="size-1.5 animate-live-dot rounded-full bg-running" aria-hidden="true" />}
            <span>{sys ? `${running}/${max} running · ${queued} queued` : "Agents …"}</span>
          </div>
          {view === "board" && (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              New ticket
            </Button>
          )}
        </header>

        {!connected && (
          <div role="status" className="flex animate-fade-in items-center gap-2 border-b border-blocked/40 bg-blocked/10 px-4 py-1.5 text-xs text-blocked md:px-5">
            <Icon name="wifi" className="size-3.5" />
            Disconnected from Relay, reconnecting…
          </div>
        )}

        <div className="flex flex-1 flex-col md:min-h-0 md:flex-row">
          <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none md:min-h-0">
            {view === "settings" ? (
              <Settings />
            ) : (
              <>
                {resetClock && (
                  <div role="status" className="mx-4 mt-3 flex animate-fade-in items-center gap-2 rounded-ctl border border-review/40 bg-review/10 px-3 py-2 text-sm text-review md:mx-5">
                    <Icon name="clock" className="size-4 shrink-0" />
                    Usage limit reached. Agents resume at {resetClock} (in {resetMins}m). New tickets wait.
                  </div>
                )}
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
                    {tickets.data.length > 0 && query && visible.length === 0 && (
                      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 text-sm text-muted md:px-5">
                        <Icon name="search" className="size-4" />
                        <span>No tickets match "{query}".</span>
                        <Button onClick={() => setQuery("")}>Clear search</Button>
                      </div>
                    )}
                    <Board tickets={visible} selectedId={selectedId} runningLabel={`${running}/${max}`} onSelect={setSelectedId} onMove={move} onDelete={(t) => void remove(t)} />
                  </>
                )}
              </>
            )}
          </main>
          {view === "board" && selectedId !== null && (
            <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-panel md:static md:z-auto md:flex md:w-[46%] md:max-w-[760px] md:shrink-0 md:animate-slide-in md:min-h-0 md:overflow-hidden md:border-l md:border-line">
              <TicketPanel key={selectedId} id={selectedId} onClose={closePanel} />
            </div>
          )}
        </div>
      </div>

      <p role="status" className="sr-only">
        {announcement}
      </p>

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
            className={`grid size-9 place-items-center rounded-md transition-colors ${view === n.id ? "bg-card text-text" : "text-muted hover:text-text"}`}
          >
            <Icon name={n.icon} className="size-4.5" />
          </button>
        ))}
      </nav>
      <ul className="ml-auto flex gap-3 text-[11px] leading-tight text-muted md:mt-auto md:ml-0 md:flex-col md:gap-3" aria-label="System status">
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
