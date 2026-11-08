import { useRef, useState, type ReactNode } from "react";
import {
  MODEL_CHOICES,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  TOGGLE_KEYS,
  type Comment,
  type Priority,
  type SpendItem,
  type Status,
  type TicketDetail,
  type ToggleKey,
} from "../shared/types.ts";
import { api, errorMessage } from "./api.ts";
import { Comments } from "./Comments.tsx";
import { LogView } from "./LogView.tsx";
import { SpendBox } from "./SpendBox.tsx";
import { Button } from "./components/Button.tsx";
import { controlClass, TextField } from "./components/Field.tsx";
import { Icon, type IconName } from "./components/Icon.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { RunBadge } from "./components/RunBadge.tsx";
import { StatusIcon } from "./components/StatusIcon.tsx";
import { Switch } from "./components/Switch.tsx";
import { useToast } from "./components/Toast.tsx";
import { useBoardEvents } from "./events.ts";
import { formatSize, useDebouncedCallback, useNow, useResource } from "./hooks.ts";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const TOGGLE_LABELS: Record<ToggleKey, string> = { send: "Send", push: "Push", publish: "Publish", merge: "Merge", deploy: "Deploy", spend: "Spend" };

function Section({ title, icon, id, children }: { title: string; icon: IconName; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
        <Icon name={icon} className="size-3.5" />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function TicketPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const toast = useToast();
  const now = useNow(30_000);
  const base = `/api/tickets/${id}`;
  const { data: ticket, error, reload, retry, setData } = useResource((signal) => api.get<TicketDetail>(base, signal), id);
  const debouncedReload = useDebouncedCallback(reload, 150);

  useBoardEvents((m) => {
    if (m.type === "reconnect" || (m.type === "ticket" && m.ticketId === id)) debouncedReload();
    else if (m.type === "log" && m.line.ticketId === id) {
      const line = m.line;
      setData((prev) => (prev && prev.id === id && (prev.log.at(-1)?.id ?? -1) < line.id ? { ...prev, log: [...prev.log, line] } : prev));
    }
  });

  /** Runs a request; on failure shows the server's message and re-syncs from the server. */
  const attempt = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      toast(errorMessage(e));
      reload();
      return undefined;
    }
  };

  const merge = (patch: Partial<TicketDetail>) => setData((prev) => (prev ? { ...prev, ...patch } : prev));

  const patch = async (body: Record<string, unknown>) => {
    const r = await attempt(() => api.patch<TicketDetail>(base, body));
    if (r) merge(r);
    return r !== undefined;
  };

  const header = (
    <header className="flex flex-col gap-2.5 border-b border-line px-5 py-4">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">{ticket?.key ?? `R-${id}`}</span>
        {ticket && <RunBadge ticket={ticket} now={now} />}
        <span className="flex-1" />
        {ticket && (ticket.runState === "running" || ticket.runState === "waiting_limit") && (
          <Button
            variant="danger"
            icon="stop"
            onClick={async () => {
              const r = await attempt(() => api.post<TicketDetail>(`${base}/stop`));
              if (r) merge(r);
            }}
          >
            Stop
          </Button>
        )}
        <Button variant="ghost" icon="x" aria-label="Close ticket panel" onClick={onClose} />
      </div>
      {ticket && (
        <h2 className="m-0 font-ui text-base leading-snug font-semibold">
          <TextField aria-label="Title" value={ticket.title} onCommit={(title) => title.trim() && void patch({ title: title.trim() })} />
        </h2>
      )}
    </header>
  );

  return (
    <aside aria-label={`Ticket R-${id}`} className="flex min-h-0 min-w-0 flex-col border-t border-line bg-panel md:w-[46%] md:flex-none md:border-t-0 md:border-l">
      {header}
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
        <div className="flex min-h-0 flex-col gap-5 overflow-auto px-5 py-4">
          <Section id="sec-log" title="Live log" icon="terminal">
            <LogView lines={ticket.log} />
          </Section>

          <Section id="sec-actions" title="Allowed actions" icon="shield">
            <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
              {TOGGLE_KEYS.map((k) => (
                <div key={k} className="flex flex-col items-start gap-1.5 rounded-ctl border border-line bg-card px-2.5 py-2 text-[11px]">
                  <span aria-hidden="true">{TOGGLE_LABELS[k]}</span>
                  <Switch
                    label={`${TOGGLE_LABELS[k]} allowed`}
                    checked={ticket.toggles[k]}
                    onChange={(v) => {
                      merge({ toggles: { ...ticket.toggles, [k]: v } });
                      void patch({ toggles: { [k]: v } });
                    }}
                  />
                </div>
              ))}
            </div>
            {ticket.toggles.spend && (
              <SpendBox
                items={ticket.spend}
                onSetMax={async (itemId, max) => {
                  const items = await attempt(() => api.patch<SpendItem[]>(`${base}/spend/${itemId}`, { max }));
                  if (items) merge({ spend: items });
                }}
              />
            )}
          </Section>

          <Section id="sec-props" title="Properties" icon="tag">
            <Properties ticket={ticket} patch={patch} onStatus={async (s) => {
              merge({ status: s });
              const r = await attempt(() => api.post<TicketDetail>(`${base}/status`, { status: s }));
              if (r) merge(r);
            }} />
          </Section>

          <Section id="sec-desc" title="Description" icon="file">
            <Description key={ticket.id} value={ticket.description} onSave={(description) => patch({ description })} />
          </Section>

          <Section id="sec-comments" title="Comments" icon="chat">
            <Comments
              ticketId={id}
              comments={ticket.comments}
              onSubmit={async (body) => {
                const c = await attempt(() => api.post<Comment>(`${base}/comments`, { body }));
                if (c) setData((prev) => (prev && !prev.comments.some((x) => x.id === c.id) ? { ...prev, comments: [...prev.comments, c] } : prev));
                return c !== undefined;
              }}
            />
          </Section>

          <Section id="sec-files" title="Attachments" icon="clip">
            <Attachments ticket={ticket} onAdded={(a) => merge({ attachments: [...ticket.attachments, a] })} />
          </Section>
        </div>
      )}
    </aside>
  );
}

function Properties({ ticket, patch, onStatus }: { ticket: TicketDetail; patch: (b: Record<string, unknown>) => Promise<boolean>; onStatus: (s: Status) => void }) {
  const p = `p${ticket.id}`;
  return (
    <dl className="grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
      <dt><label htmlFor={`${p}-status`} className="text-muted">Status</label></dt>
      <dd className="m-0 flex items-center gap-2">
        <StatusIcon status={ticket.status} />
        <select id={`${p}-status`} className={controlClass} value={ticket.status} onChange={(e) => onStatus(e.target.value as Status)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
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
          onCommit={(v) => void patch({ labels: v.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </dd>

      <dt><label htmlFor={`${p}-due`} className="text-muted">Due date</label></dt>
      <dd className="m-0">
        <input id={`${p}-due`} type="date" className={controlClass} value={ticket.dueDate ?? ""} onChange={(e) => void patch({ dueDate: e.target.value || null })} />
      </dd>

      <dt><label htmlFor={`${p}-path`} className="text-muted">Folder / repo</label></dt>
      <dd className="m-0">
        <TextField id={`${p}-path`} placeholder="C:\path\to\repo" value={ticket.linkedPath ?? ""} onCommit={(v) => void patch({ linkedPath: v.trim() || null })} />
      </dd>

      <dt className="text-muted">Branch</dt>
      <dd className="m-0 flex items-center gap-1.5 break-all">
        {ticket.branch ? (
          <>
            <Icon name="branch" className="size-3.5" />
            {ticket.branch}
          </>
        ) : (
          <span className="text-muted">None yet</span>
        )}
      </dd>

      <dt><label htmlFor={`${p}-model`} className="text-muted">Model</label></dt>
      <dd className="m-0">
        <select id={`${p}-model`} className={controlClass} value={ticket.model ?? ""} onChange={(e) => void patch({ model: e.target.value || null })}>
          <option value="">Default (from Settings)</option>
          {MODEL_CHOICES.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </dd>
    </dl>
  );
}

function Description({ value, onSave }: { value: string; onSave: (v: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor="desc-edit" className="sr-only">Description (markdown)</label>
        <textarea id="desc-edit" autoFocus rows={8} value={draft} onChange={(e) => setDraft(e.target.value)} className={`${controlClass} resize-y font-mono text-xs`} />
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
  return (
    <div className="flex flex-col items-start gap-2">
      {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-muted">No description.</p>}
      <Button
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        Edit description
      </Button>
    </div>
  );
}

function Attachments({ ticket, onAdded }: { ticket: TicketDetail; onAdded: (a: TicketDetail["attachments"][number]) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name} is ${formatSize(file.size)}. Files are capped at 25 MB.`);
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      onAdded(await api.postForm(`/api/tickets/${ticket.id}/attachments`, form));
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {ticket.attachments.length === 0 ? (
        <p className="text-sm text-muted">No attachments.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {ticket.attachments.map((a) => (
            <li key={a.id}>
              <a
                href={`/api/tickets/${ticket.id}/attachments/${a.id}`}
                download={a.name}
                className="flex items-center gap-2 rounded-ctl border border-line bg-card px-2.5 py-1.5 text-xs hover:bg-card-hover"
              >
                <Icon name="file" className="size-3.5" />
                <span className="break-all">{a.name}</span>
                <span className="text-muted">{formatSize(a.size)}</span>
                <span className="sr-only">Download</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a file to attach"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <Button icon="plus" disabled={uploading} onClick={() => input.current?.click()}>
        {uploading ? "Uploading…" : "Add attachment"}
      </Button>
    </div>
  );
}
