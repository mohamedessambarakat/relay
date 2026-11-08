import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_TOGGLES,
  PRIORITIES,
  PRIORITY_LABELS,
  STATUSES,
  STATUS_LABELS,
  TOGGLE_KEYS,
  type Priority,
  type Status,
  type TicketDetail,
  type Toggles,
} from "../shared/types.ts";
import { api, errorMessage } from "./api.ts";
import { Button } from "./components/Button.tsx";
import { controlClass, Field } from "./components/Field.tsx";
import { Switch } from "./components/Switch.tsx";

interface Props {
  onClose: () => void;
  onCreated: (t: TicketDetail) => void;
}

export function NewTicketDialog({ onClose, onCreated }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>(0);
  const [labels, setLabels] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [linkedPath, setLinkedPath] = useState("");
  const [status, setStatus] = useState<Status>("backlog");
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // showModal gives a native focus trap and Escape handling.
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    titleInput.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      titleInput.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { title: title.trim(), priority, status, toggles };
      if (description.trim()) body.description = description;
      const l = labels.split(",").map((s) => s.trim()).filter(Boolean);
      if (l.length) body.labels = l;
      if (dueDate) body.dueDate = dueDate;
      if (linkedPath.trim()) body.linkedPath = linkedPath.trim();
      onCreated(await api.post<TicketDetail>("/api/tickets", body));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="new-ticket-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-auto w-[min(36rem,calc(100%-2rem))] rounded-md border border-line bg-panel p-0 text-text backdrop:bg-black/70"
    >
      <form onSubmit={submit} noValidate className="flex max-h-[90dvh] flex-col gap-3 overflow-auto p-5">
        <h2 id="new-ticket-title" className="text-base font-semibold">New ticket</h2>

        <Field label="Title (required)" htmlFor="nt-title">
          <input ref={titleInput} id="nt-title" required aria-required="true" className={controlClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="Description (markdown)" htmlFor="nt-desc">
          <textarea id="nt-desc" rows={4} className={`${controlClass} resize-y font-ui`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Priority" htmlFor="nt-prio">
            <select id="nt-prio" className={controlClass} value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
              {PRIORITIES.map((n) => <option key={n} value={n}>{PRIORITY_LABELS[n]}</option>)}
            </select>
          </Field>
          <Field label="Status" htmlFor="nt-status">
            <select id="nt-status" className={controlClass} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
          <Field label="Labels (comma separated)" htmlFor="nt-labels">
            <input id="nt-labels" className={controlClass} value={labels} onChange={(e) => setLabels(e.target.value)} />
          </Field>
          <Field label="Due date" htmlFor="nt-due">
            <input id="nt-due" type="date" className={controlClass} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Linked folder / repo path" htmlFor="nt-path">
          <input id="nt-path" className={controlClass} placeholder="C:\path\to\repo" value={linkedPath} onChange={(e) => setLinkedPath(e.target.value)} />
        </Field>

        <fieldset className="rounded-ctl border border-line p-3">
          <legend className="px-1 text-xs text-muted">Allowed actions</legend>
          <div className="grid grid-cols-3 gap-2">
            {TOGGLE_KEYS.map((k) => (
              <div key={k} className="flex items-center gap-2 text-sm">
                <Switch label={`${k} allowed`} checked={toggles[k]} onChange={(v) => setToggles((t) => ({ ...t, [k]: v }))} />
                <span aria-hidden="true" className="capitalize">{k}</span>
              </div>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-blocked">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create ticket"}</Button>
        </div>
      </form>
    </dialog>
  );
}
