import { useState } from "react";
import { STATUSES, STATUS_LABELS, type Status, type TicketSummary } from "../shared/types.ts";
import { Chip } from "./components/Chip.tsx";
import { Icon } from "./components/Icon.tsx";
import { MoveMenu } from "./components/MoveMenu.tsx";
import { PriorityBars } from "./components/PriorityBars.tsx";
import { RunBadge } from "./components/RunBadge.tsx";
import { StatusIcon } from "./components/StatusIcon.tsx";
import { useNow } from "./hooks.ts";

interface BoardProps {
  tickets: TicketSummary[];
  selectedId: number | null;
  runningLabel: string;
  onSelect: (id: number) => void;
  onMove: (ticket: TicketSummary, status: Status) => void;
  onDelete: (ticket: TicketSummary) => void;
}

const repoName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function Board({ tickets, selectedId, runningLabel, onSelect, onMove, onDelete }: BoardProps) {
  const now = useNow(30_000);
  const [dragOver, setDragOver] = useState<Status | null>(null);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3.5 md:flex-row md:overflow-x-auto md:overflow-y-hidden">
      {STATUSES.map((status) => {
        const items = tickets.filter((t) => t.status === status);
        return (
          <div
            key={status}
            role="group"
            aria-labelledby={`col-${status}`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDragOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              const id = Number(e.dataTransfer.getData("text/plain"));
              const ticket = tickets.find((t) => t.id === id);
              // In Progress is set by the runner when an agent starts; dropping there does nothing.
              if (ticket && status !== "in_progress") onMove(ticket, status);
            }}
            className={`flex w-full shrink-0 flex-col gap-2 rounded-md border p-2 transition-colors md:min-h-0 md:w-auto md:min-w-[176px] md:flex-1 md:shrink md:self-stretch ${
              dragOver === status && status !== "in_progress" ? "border-accent bg-card/60" : "border-line bg-panel"
            }`}
          >
            <h2 id={`col-${status}`} className="flex min-w-0 items-center gap-2 px-1 pt-1 pb-1.5 text-[11px] font-semibold tracking-widest whitespace-nowrap uppercase">
              <StatusIcon status={status} className="size-3.5 shrink-0" />
              <span className="shrink-0">{STATUS_LABELS[status]}</span>
              <span className="shrink-0 font-normal text-muted">{items.length}</span>
              {status === "in_progress" && <span className="ml-auto min-w-0 truncate font-normal tracking-normal text-running normal-case">{runningLabel}</span>}
            </h2>
            {items.length === 0 ? (
              <p className="rounded-ctl border border-dashed border-line px-2 py-4 text-center text-xs text-muted">No tickets</p>
            ) : (
              <ul className="flex min-h-0 flex-col gap-2 md:flex-1 md:overflow-y-auto">
                {items.map((t) => (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(t.id));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="group relative animate-rise-in"
                  >
                    <Card ticket={t} selected={t.id === selectedId} now={now} onSelect={() => onSelect(t.id)} />
                    <div className="absolute top-1.5 right-1.5 z-10 opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                      <MoveMenu
                        status={t.status}
                        label={`Actions for ${t.key}`}
                        compact
                        trigger="dots"
                        onMove={(to) => onMove(t, to)}
                        actions={[{ label: "Delete", icon: "trash", danger: true, onSelect: () => onDelete(t) }]}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Card({ ticket: t, selected, now, onSelect }: { ticket: TicketSummary; selected: boolean; now: number; onSelect: () => void }) {
  const overdue = t.dueDate !== null && t.status !== "done" && t.dueDate < new Date().toLocaleDateString("sv-SE");
  const running = t.runState === "running";
  const tone = t.status === "blocked" ? "border-blocked/50 bg-blocked/5 hover:bg-blocked/10" : "border-line bg-card hover:bg-card-hover";
  return (
    <button
      type="button"
      data-ticket-id={t.id}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`flex w-full flex-col gap-2 rounded-md border p-2.5 text-left transition-colors ${tone} ${running ? "border-l-2 border-l-running" : ""} ${
        selected ? "ring-1 ring-text/40" : ""
      }`}
    >
      <span className="flex items-center gap-2 pr-8">
        <span className="shrink-0 text-xs whitespace-nowrap text-muted">{t.key}</span>
        <PriorityBars priority={t.priority} />
        {t.attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Icon name="clip" className="size-3" />
            {t.attachmentCount}
            <span className="sr-only"> attachments</span>
          </span>
        )}
      </span>
      <span className="line-clamp-3 font-ui text-sm leading-snug font-semibold break-words">{t.title}</span>
      <span className="sr-only">Status: {STATUS_LABELS[t.status]}</span>
      <span className="flex items-center gap-1.5 empty:hidden">
        <RunBadge ticket={t} now={now} />
      </span>
      {running && (
        <span className="h-[3px] overflow-hidden rounded-sm bg-line" aria-hidden="true">
          <span className="indeterminate block h-full bg-running" />
        </span>
      )}
      {t.labels.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {t.labels.map((l) => (
            <Chip key={l}>{l}</Chip>
          ))}
        </span>
      )}
      {(t.linkedPath || t.dueDate) && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {t.linkedPath && (
            <span className="inline-flex min-w-0 items-center gap-1" title={t.linkedPath}>
              <Icon name="folder" className="size-3" />
              <span className="truncate">{repoName(t.linkedPath)}</span>
            </span>
          )}
          {t.dueDate && (
            <span className={`inline-flex items-center gap-1 ${overdue ? "text-blocked" : ""}`}>
              <Icon name="cal" className="size-3" />
              {t.dueDate}
              {overdue && " (overdue)"}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
