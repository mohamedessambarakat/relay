import { useState } from "react";
import { STATUSES, STATUS_LABELS, type Status, type TicketSummary } from "../shared/types.ts";
import { Chip } from "./components/Chip.tsx";
import { Icon } from "./components/Icon.tsx";
import { PriorityBars } from "./components/PriorityBars.tsx";
import { RunBadge } from "./components/RunBadge.tsx";
import { StatusIcon } from "./components/StatusIcon.tsx";
import { useNow } from "./hooks.ts";

interface BoardProps {
  tickets: TicketSummary[];
  selectedId: number | null;
  runningLabel: string;
  onSelect: (id: number) => void;
  onMove: (id: number, status: Status) => void;
}

const repoName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function Board({ tickets, selectedId, runningLabel, onSelect, onMove }: BoardProps) {
  const now = useNow(30_000);
  const [dragOver, setDragOver] = useState<Status | null>(null);

  return (
    <div className="relative flex min-h-0 flex-1 items-start gap-2.5 overflow-x-auto overflow-y-auto px-4 py-3.5">
      {STATUSES.map((status) => {
        const items = tickets.filter((t) => t.status === status);
        return (
          <section
            key={status}
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
              if (id) onMove(id, status);
            }}
            className={`flex w-60 shrink-0 flex-col gap-2 rounded-md border bg-panel p-2 ${dragOver === status ? "border-accent" : "border-line"}`}
          >
            <h2 id={`col-${status}`} className="flex items-center gap-2 px-1 pt-1 pb-1.5 text-[11px] font-semibold tracking-widest whitespace-nowrap uppercase">
              <StatusIcon status={status} className="size-3.5" />
              {STATUS_LABELS[status]}
              <span className="font-normal text-muted">{items.length}</span>
              {status === "agent_ready" && <span className="ml-auto font-normal tracking-normal text-running normal-case">{runningLabel}</span>}
            </h2>
            {items.length === 0 ? (
              <p className="rounded-ctl border border-dashed border-line px-2 py-4 text-center text-xs text-muted">No tickets</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((t) => (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(t.id));
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <Card ticket={t} selected={t.id === selectedId} now={now} onSelect={() => onSelect(t.id)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Card({ ticket: t, selected, now, onSelect }: { ticket: TicketSummary; selected: boolean; now: number; onSelect: () => void }) {
  const overdue = t.dueDate !== null && t.status !== "done" && t.dueDate < new Date().toLocaleDateString("sv-SE");
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full flex-col gap-2 rounded-md border bg-card p-2.5 text-left hover:bg-card-hover ${
        selected ? "border-accent shadow-[inset_3px_0_0_var(--color-accent)]" : "border-line"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{t.key}</span>
        <PriorityBars priority={t.priority} />
      </span>
      <span className="font-ui text-sm leading-snug font-semibold break-words">{t.title}</span>
      <RunBadge ticket={t} now={now} />
      {t.runState === "running" && (
        <span className="h-[3px] overflow-hidden rounded-sm bg-line" role="progressbar" aria-label="Run in progress">
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
      {(t.linkedPath || t.dueDate || t.attachmentCount > 0) && (
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
          {t.attachmentCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon name="clip" className="size-3" />
              {t.attachmentCount}
              <span className="sr-only"> attachments</span>
            </span>
          )}
        </span>
      )}
    </button>
  );
}
