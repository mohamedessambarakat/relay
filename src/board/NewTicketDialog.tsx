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
import { useConfirm } from "./components/ConfirmDialog.tsx";
import { useToast } from "./components/Toast.tsx";

const control = controlClass;

const TOGGLE_HINTS: Record<string, string> = {
  send: "Messages and emails",
  push: "git push",
  publish: "Public posts",
  merge: "Branches and PRs",
  deploy: "Deployments",
  spend: "Money or paid credits",
};

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
  const [titleError, setTitleError] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();

  // showModal gives a native focus trap; on unmount close it and give focus back to the opener.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    titleInput.current?.focus();
    return () => {
      d?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const dirty = title.trim() !== "" || description.trim() !== "";
  const requestClose = async () => {
    if (busy) return;
    if (dirty && !(await confirm({ title: "Discard this ticket?", body: "What you typed will be lost.", confirmLabel: "Discard", danger: true }))) return;
    onClose();
  };

  const create = async (asStatus: Status) => {
    if (!title.trim()) {
      setTitleError(true);
      titleInput.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { title: title.trim(), priority, status: asStatus, toggles };
      if (description.trim()) body.description = description;
      const l = labels.split(",").map((s) => s.trim()).filter(Boolean);
      if (l.length) body.labels = l;
      if (dueDate) body.dueDate = dueDate;
      if (linkedPath.trim()) body.linkedPath = linkedPath.trim();
      const t = await api.post<TicketDetail>("/api/tickets", body);
      dialog.current?.close();
      toast(asStatus === "agent_ready" ? `${t.key} sent to the agent` : `${t.key} created`, "success");
      onCreated(t);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void create(status);
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="new-ticket-title"
      onCancel={(e) => {
        e.preventDefault();
        void requestClose();
      }}
      className="m-auto w-[min(36rem,calc(100%-2rem))] animate-pop-in rounded-md border border-control bg-panel p-0 text-text backdrop:animate-fade-in backdrop:bg-black/70"
    >
      <form onSubmit={submit} noValidate className="flex max-h-[90dvh] flex-col gap-3 overflow-auto p-5">
        <h2 id="new-ticket-title" className="font-ui text-base font-semibold">New ticket</h2>

        <Field label="Title (required)" htmlFor="nt-title">
          <input
            ref={titleInput}
            id="nt-title"
            required
            aria-required="true"
            aria-invalid={titleError || undefined}
            aria-describedby={titleError ? "nt-title-error" : undefined}
            className={control}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              if (e.target.value.trim()) setTitleError(false);
            }}
            maxLength={200}
          />
          {titleError && <p id="nt-title-error" className="font-ui text-xs text-blocked">Title is required.</p>}
        </Field>
        <Field label="Description (markdown)" htmlFor="nt-desc">
          <textarea id="nt-desc" rows={4} className={`${control} resize-y font-ui`} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Priority" htmlFor="nt-prio">
            <select id="nt-prio" className={control} value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
              {PRIORITIES.map((n) => <option key={n} value={n}>{PRIORITY_LABELS[n]}</option>)}
            </select>
          </Field>
          <Field label="Status" htmlFor="nt-status">
            <select id="nt-status" className={control} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
              {STATUSES.filter((s) => s !== "in_progress").map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
          <Field label="Labels (comma separated)" htmlFor="nt-labels">
            <input id="nt-labels" className={control} value={labels} onChange={(e) => setLabels(e.target.value)} />
          </Field>
          <Field label="Due date" htmlFor="nt-due">
            <input id="nt-due" type="date" className={control} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <p className="-mt-1 font-ui text-xs text-muted">Agent Ready: Claude starts as soon as a slot is free.</p>
        <Field label="Linked folder / repo path" htmlFor="nt-path">
          <input id="nt-path" className={control} placeholder="C:\path\to\repo" value={linkedPath} onChange={(e) => setLinkedPath(e.target.value)} />
        </Field>

        <fieldset className="rounded-ctl border border-control p-3">
          <legend className="px-1 text-xs text-muted">Allowed actions</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TOGGLE_KEYS.map((k) => {
              const name = k.charAt(0).toUpperCase() + k.slice(1);
              return (
                <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Switch label={name} checked={toggles[k]} onChange={(v) => setToggles((t) => ({ ...t, [k]: v }))} />
                  <span>
                    {name}
                    <span className="block font-ui text-xs text-muted">{TOGGLE_HINTS[k]}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-2 font-ui text-xs text-muted">
            Spend: when on, the agent lists the paid services it needs and pre-fills each max with its own estimate.
          </p>
        </fieldset>

        {error && (
          <p role="alert" className="font-ui text-sm text-blocked">{error}</p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => void requestClose()}>Cancel</Button>
          {status !== "agent_ready" && (
            <Button disabled={busy} onClick={() => void create("agent_ready")}>Create &amp; send to agent</Button>
          )}
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create ticket"}</Button>
        </div>
      </form>
    </dialog>
  );
}
