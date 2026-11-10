import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  MODEL_CHOICES,
  PRIORITIES,
  PRIORITY_LABELS,
  PROVIDER_LABELS,
  PROVIDERS,
  STATUS_LABELS,
  TOGGLE_KEYS,
  type Comment,
  type Priority,
  type ProviderId,
  type ProviderSettings,
  type SpendItem,
  type Status,
  type TicketDetail,
  type ToggleKey,
} from "../shared/types.ts";
import { api, errorMessage } from "./api.ts";
import { Comments } from "./Comments.tsx";
import { LogSection } from "./LogView.tsx";
import { AttachmentChip, ResultCard } from "./ResultCard.tsx";
import { SpendBox } from "./SpendBox.tsx";
import { Button } from "./components/Button.tsx";
import { useConfirm } from "./components/ConfirmDialog.tsx";
import { controlClass, TextField } from "./components/Field.tsx";
import { Icon, type IconName } from "./components/Icon.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { MoveMenu } from "./components/MoveMenu.tsx";
import { RunBadge } from "./components/RunBadge.tsx";
import { StatusIcon } from "./components/StatusIcon.tsx";
import { Switch } from "./components/Switch.tsx";
import { useToast } from "./components/Toast.tsx";
import { useBoardEvents } from "./events.ts";
import { formatSize, useDebouncedCallback, useNow, useResource } from "./hooks.ts";
import { moveWarning } from "./moves.ts";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const TOGGLE_LABELS: Record<ToggleKey, string> = { send: "Send", push: "Push", publish: "Publish", merge: "Merge", deploy: "Deploy", spend: "Spend" };

function Section({ title, icon, id, children }: { title: string; icon: IconName; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="mb-2 flex items-center gap-1.5 font-chrome text-xs font-semibold tracking-wider text-muted uppercase">
        <Icon name={icon} className="size-3.5" />
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Only this small piece re-renders every 30 s for the "Running · 8m" label. */
function RunStatus({ ticket }: { ticket: TicketDetail }) {
  const now = useNow(30_000);
  return <RunBadge ticket={ticket} now={now} />;
}

function latestAgentComment(comments: Comment[]): Comment | undefined {
  for (let i = comments.length - 1; i >= 0; i--) if (comments[i]!.author === "agent") return comments[i];
  return undefined;
}

export function TicketPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const base = `/api/tickets/${id}`;
  const { data: ticket, error, reload, retry, setData } = useResource((signal) => api.get<TicketDetail>(base, signal), id);
  const debouncedReload = useDebouncedCallback(reload, 150);
  const heading = useRef<HTMLHeadingElement>(null);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>();

  useEffect(() => {
    heading.current?.focus();
  }, []);

  // Log lines are handled inside LogSection so they don't re-render the panel.
  useBoardEvents((m) => {
    if (m.type === "reconnect" || (m.type === "ticket" && m.ticketId === id)) debouncedReload();
  });

  /** Runs a request; on failure shows the server's message and re-syncs from the server. */
  const attempt = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (e) {
        toast(errorMessage(e));
        reload();
        return undefined;
      }
    },
    [toast, reload],
  );

  const merge = useCallback((p: Partial<TicketDetail>) => setData((prev) => (prev ? { ...prev, ...p } : prev)), [setData]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const r = await attempt(() => api.patch<TicketDetail>(base, body));
      if (r) merge(r);
      return r !== undefined;
    },
    [attempt, base, merge],
  );

  const move = async (t: TicketDetail, to: Status) => {
    const warning = moveWarning(t, to);
    if (warning && !(await confirm(warning))) return;
    const r = await attempt(() => api.post<TicketDetail>(`${base}/status`, { status: to }));
    if (r) merge(r);
  };

  const stop = async (t: TicketDetail) => {
    const ok = await confirm({
      title: `Stop ${t.key}?`,
      body: "The run is killed and the ticket moves to Blocked. Comment with @agent to resume.",
      confirmLabel: "Stop run",
      danger: true,
    });
    if (!ok) return;
    const r = await attempt(() => api.post<TicketDetail>(`${base}/stop`));
    if (r) {
      merge(r);
      toast(`Stopped ${t.key}`, "success");
    }
  };

  const remove = async (t: TicketDetail) => {
    const running = t.runState === "running" || t.runState === "waiting_limit";
    const ok = await confirm({
      title: `Delete ${t.key} "${t.title}"?`,
      body: `This permanently deletes the ticket, its comments and attachments.${running ? " This also stops the running agent." : ""}`,
      confirmLabel: "Delete ticket",
      danger: true,
    });
    if (!ok) return;
    const done = await attempt(async () => {
      await api.del(base);
      return true;
    });
    if (done) {
      toast(`Deleted ${t.key}`, "success");
      onClose();
    }
  };

  const submitComment = useCallback(
    async (body: string) => {
      const c = await attempt(() => api.post<Comment>(`${base}/comments`, { body }));
      if (c) setData((prev) => (prev && !prev.comments.some((x) => x.id === c.id) ? { ...prev, comments: [...prev.comments, c] } : prev));
      return c !== undefined;
    },
    [attempt, base, setData],
  );

  const setSpendMax = useCallback(
    async (itemId: number, max: number) => {
      const items = await attempt(() => api.patch<SpendItem[]>(`${base}/spend/${itemId}`, { max }));
      if (items) merge({ spend: items });
      return items !== undefined;
    },
    [attempt, base, merge],
  );

  const addAttachment = useCallback(
    (a: TicketDetail["attachments"][number]) =>
      setData((prev) => (prev && !prev.attachments.some((x) => x.id === a.id) ? { ...prev, attachments: [...prev.attachments, a] } : prev)),
    [setData],
  );

  const requestChanges = useCallback(() => setPrefill((p) => ({ text: "@agent ", nonce: (p?.nonce ?? 0) + 1 })), []);

  const active = ticket && (ticket.runState === "running" || ticket.runState === "waiting_limit");
  const titleId = `ticket-title-${id}`;
  const agentComment = ticket ? latestAgentComment(ticket.comments) : undefined;

  return (
    <aside aria-labelledby={titleId} className="flex h-full min-h-0 min-w-0 flex-col bg-panel">
      <header className="flex flex-col gap-2 border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-chrome text-xs text-muted">{ticket?.key ?? `R-${id}`}</span>
          {ticket && <RunStatus ticket={ticket} />}
          <span className="flex-1" />
          {ticket && active && (
            <Button variant="danger" icon="stop" onClick={() => void stop(ticket)}>
              Stop
            </Button>
          )}
          {ticket && <MoveMenu status={ticket.status} label={`Move ${ticket.key}`} onMove={(to) => void move(ticket, to)} />}
          {ticket && <Button variant="ghost" icon="trash" aria-label={`Delete ${ticket.key}`} onClick={() => void remove(ticket)} className="hover:text-blocked" />}
          <Button variant="ghost" icon="x" aria-label="Close ticket panel" onClick={onClose} />
        </div>
        <TitleEditor
          headingId={titleId}
          headingRef={heading}
          title={ticket?.title ?? `Ticket R-${id}`}
          editable={!!ticket}
          onSave={(title) => patch({ title })}
        />
      </header>
      {!ticket ? (
        <div className="p-5 text-sm">
          {error ? (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-blocked">Couldn't load this ticket: {error}</p>
              <Button onClick={retry}>Retry</Button>
            </div>
          ) : (
            <p className="text-muted" role="status">
              Loading ticket…
            </p>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 py-4 font-ui">
          {agentComment && (ticket.status === "review" || ticket.status === "blocked") && (
            <ResultCard
              ticketId={id}
              status={ticket.status}
              comment={agentComment}
              attachments={ticket.attachments}
              onRequestChanges={requestChanges}
              onDone={() => void move(ticket, "done")}
            />
          )}

          <LogSection ticketId={id} fetched={ticket.log} runState={ticket.runState} />

          <Section id="sec-actions" title="Allowed actions" icon="shield">
            <div role="group" aria-label="Allowed actions" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TOGGLE_KEYS.map((k) => (
                <label key={k} className="flex cursor-pointer items-center justify-between gap-2 rounded-ctl border border-line bg-card px-2.5 py-1.5 text-sm">
                  <span>{TOGGLE_LABELS[k]}</span>
                  <Switch
                    checked={ticket.toggles[k]}
                    onChange={(v) => {
                      merge({ toggles: { ...ticket.toggles, [k]: v } });
                      void patch({ toggles: { [k]: v } });
                    }}
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">Outward actions the agent may take on this ticket.</p>
            {ticket.toggles.spend && <SpendBox items={ticket.spend} onSetMax={setSpendMax} />}
          </Section>

          <Section id="sec-props" title="Properties" icon="tag">
            <Properties ticket={ticket} patch={patch} />
          </Section>

          <Section id="sec-desc" title="Description" icon="file">
            <Description key={ticket.id} value={ticket.description} onSave={(description) => patch({ description })} />
          </Section>

          <Section id="sec-comments" title="Comments" icon="chat">
            <Comments
              ticketId={id}
              status={ticket.status}
              runState={ticket.runState}
              comments={ticket.comments}
              onSubmit={submitComment}
              prefill={prefill}
            />
          </Section>

          <Section id="sec-files" title="Attachments" icon="clip">
            <Attachments ticketId={id} attachments={ticket.attachments} onAdded={addAttachment} />
          </Section>
        </div>
      )}
    </aside>
  );
}

function TitleEditor({
  headingId,
  headingRef,
  title,
  editable,
  onSave,
}: {
  headingId: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  title: string;
  editable: boolean;
  onSave: (title: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const cancelled = useRef(false);

  const finish = async () => {
    if (cancelled.current) return;
    cancelled.current = true;
    const next = draft.trim();
    setEditing(false);
    if (!next) toast("Title can't be empty");
    else if (next !== title) await onSave(next);
    headingRef.current?.focus();
  };

  return (
    <div className="flex items-start gap-2">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className={`m-0 min-w-0 flex-1 font-ui text-lg leading-snug font-semibold break-words outline-none ${editing ? "sr-only" : ""}`}
      >
        {title}
      </h2>
      {editing ? (
        <input
          autoFocus
          aria-label="Title"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void finish()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelled.current = true;
              setEditing(false);
              headingRef.current?.focus();
            }
          }}
          className={`${controlClass} flex-1 font-ui text-lg font-semibold`}
        />
      ) : (
        editable && (
          <button
            type="button"
            aria-label="Edit title"
            onClick={() => {
              cancelled.current = false;
              setDraft(title);
              setEditing(true);
            }}
            className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-ctl text-muted transition-colors hover:bg-card hover:text-text"
          >
            <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16z" />
              <path d="m13.5 6.5 4 4" />
            </svg>
          </button>
        )
      )}
    </div>
  );
}

const Properties = memo(function Properties({ ticket, patch }: { ticket: TicketDetail; patch: (b: Record<string, unknown>) => Promise<boolean> }) {
  const p = `p${ticket.id}`;
  const { data: settings } = useResource((signal) => api.get<ProviderSettings>("/api/settings/provider", signal), "provider-settings");
  const provider: ProviderId = ticket.provider ?? settings?.provider ?? "claude";
  return (
    <dl className="grid grid-cols-[8rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
      <dt className="text-muted">Status</dt>
      <dd className="m-0 flex items-center gap-2 px-[9px]">
        <StatusIcon status={ticket.status} />
        {STATUS_LABELS[ticket.status]}
      </dd>

      <dt><label htmlFor={`${p}-prio`} className="text-muted">Priority</label></dt>
      <dd className="m-0">
        <select id={`${p}-prio`} className={controlClass} value={ticket.priority} onChange={(e) => void patch({ priority: Number(e.target.value) as Priority })}>
          {PRIORITIES.map((n) => (
            <option key={n} value={n}>{PRIORITY_LABELS[n]}</option>
          ))}
        </select>
      </dd>

      <dt><label htmlFor={`${p}-labels`} className="text-muted">Labels</label></dt>
      <dd className="m-0">
        <TextField
          id={`${p}-labels`}
          placeholder="comma, separated"
          value={ticket.labels.join(", ")}
          onCommit={(v) => patch({ labels: v.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </dd>

      <dt><label htmlFor={`${p}-due`} className="text-muted">Due date</label></dt>
      <dd className="m-0">
        <input
          id={`${p}-due`}
          type="date"
          className={`${controlClass} ${ticket.dueDate ? "" : "text-muted!"}`}
          value={ticket.dueDate ?? ""}
          onChange={(e) => void patch({ dueDate: e.target.value || null })}
        />
      </dd>

      <dt><label htmlFor={`${p}-path`} className="text-muted">Folder / repo</label></dt>
      <dd className="m-0">
        <TextField id={`${p}-path`} placeholder="C:\path\to\repo" value={ticket.linkedPath ?? ""} onCommit={(v) => patch({ linkedPath: v.trim() || null })} />
      </dd>

      <dt className="text-muted">Branch</dt>
      <dd className="m-0 px-[9px] font-mono text-xs break-all">
        {ticket.branch ?? <span className="font-ui text-sm text-muted italic">None yet</span>}
      </dd>

      <dt><label htmlFor={`${p}-agent`} className="text-muted">Agent</label></dt>
      <dd className="m-0">
        <select id={`${p}-agent`} className={controlClass} value={ticket.provider ?? ""} onChange={(e) => void patch({ provider: e.target.value || null })}>
          <option value="">Default ({settings ? PROVIDER_LABELS[settings.provider] : "from Settings"})</option>
          {PROVIDERS.map((id) => (
            <option key={id} value={id}>{PROVIDER_LABELS[id]}</option>
          ))}
        </select>
      </dd>

      <dt><label htmlFor={`${p}-model`} className="text-muted">Model</label></dt>
      <dd className="m-0">
        {provider === "codex" ? (
          <TextField
            id={`${p}-model`}
            placeholder="Default (from Settings)"
            value={ticket.model ?? ""}
            onCommit={(v) => patch({ model: v.trim() || null })}
          />
        ) : (
          <select id={`${p}-model`} className={controlClass} value={ticket.model ?? ""} onChange={(e) => void patch({ model: e.target.value || null })}>
            <option value="">Default (from Settings)</option>
            {ticket.model && !MODEL_CHOICES.some((m) => m.id === ticket.model) && <option value={ticket.model}>{ticket.model}</option>}
            {MODEL_CHOICES.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}
      </dd>
    </dl>
  );
});

const Description = memo(function Description({ value, onSave }: { value: string; onSave: (v: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor="desc-edit" className="sr-only">Description (markdown)</label>
        <textarea
          id="desc-edit"
          autoFocus
          rows={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
          className={`${controlClass} resize-y font-mono text-xs`}
        />
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onSave(draft);
              setSaving(false);
              if (ok) setEditing(false);
            }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </div>
    );
  }
  if (!value.trim()) {
    return (
      <button type="button" onClick={startEdit} className="text-left text-sm text-muted transition-colors hover:text-text">
        No description. <span className="underline">Edit</span>
      </button>
    );
  }
  return (
    <div className="flex flex-col items-start gap-2 text-sm">
      <Markdown>{value}</Markdown>
      <Button onClick={startEdit}>Edit description</Button>
    </div>
  );
});

const Attachments = memo(function Attachments({
  ticketId,
  attachments,
  onAdded,
}: {
  ticketId: number;
  attachments: TicketDetail["attachments"];
  onAdded: (a: TicketDetail["attachments"][number]) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const uploadAll = async (files: File[]) => {
    let added = 0;
    setProgress({ done: 0, total: files.length });
    for (const [i, file] of files.entries()) {
      if (file.size > MAX_FILE_BYTES) {
        toast(`${file.name} is ${formatSize(file.size)}. Files are capped at 25 MB.`);
      } else {
        const form = new FormData();
        form.append("file", file);
        try {
          onAdded(await api.postForm(`/api/tickets/${ticketId}/attachments`, form));
          added++;
        } catch (e) {
          toast(`${file.name}: ${errorMessage(e)}`);
        }
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
    if (added > 0) toast(`Attached ${added} ${added === 1 ? "file" : "files"}`, "success");
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {attachments.length === 0 ? (
        <p className="text-sm text-muted">No attachments.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li key={a.id}>
              <AttachmentChip ticketId={ticketId} a={a} />
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose files to attach"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void uploadAll(files);
        }}
      />
      <Button icon="plus" disabled={progress !== null} onClick={() => input.current?.click()}>
        {progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : "Add attachments"}
      </Button>
    </div>
  );
});
