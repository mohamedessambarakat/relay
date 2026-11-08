import { memo, useEffect, useRef, useState } from "react";
import { AGENT_MENTION, type Comment, type RunState, type Status } from "../shared/types.ts";
import { Button } from "./components/Button.tsx";
import { controlClass } from "./components/Field.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { useToast } from "./components/Toast.tsx";
import { formatDateTime } from "./hooks.ts";

const WHO: Record<Comment["author"], string> = { user: "You", agent: "Agent", system: "System" };

interface Props {
  ticketId: number;
  status: Status;
  runState: RunState;
  comments: Comment[];
  onSubmit: (body: string) => Promise<boolean>;
  /** Bump `nonce` to fill the box with `text` and focus it (e.g. "Request changes"). */
  prefill?: { text: string; nonce: number };
}

function hint(status: Status, runState: RunState): string {
  if (runState === "running") return "@agent comments go straight to the running agent.";
  if (status === "review" || status === "blocked") return "@agent sends the ticket back to the agent.";
  return "Comments are notes. Move to Agent Ready to run the agent.";
}

export const Comments = memo(function Comments({ ticketId, status, runState, comments, onSubmit, prefill }: Props) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // Comments present on first render don't animate; later ones rise in.
  const [baseline] = useState(() => comments.reduce((m, c) => Math.max(m, c.id), -1));
  const inputId = `comment-${ticketId}`;

  useEffect(() => {
    if (!prefill) return;
    setBody(prefill.text);
    const el = area.current;
    if (el) {
      el.focus();
      el.setSelectionRange(prefill.text.length, prefill.text.length);
      el.scrollIntoView({ block: "nearest" });
    }
  }, [prefill]);

  const submit = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    const ok = await onSubmit(text);
    setSending(false);
    if (!ok) return;
    setBody("");
    if (AGENT_MENTION.test(text)) {
      if (runState === "running") toast("Sent to the agent", "success");
      else if (status === "review" || status === "blocked") toast("Sent back to the agent", "success");
    }
  };

  const insertMention = () => {
    const el = area.current;
    const at = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? at;
    const before = body.slice(0, at);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const insert = `${pad}@agent `;
    setBody(before + insert + body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + insert.length, at + insert.length);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 ? (
        <p className="text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className={`flex gap-2.5 ${c.id > baseline ? "animate-rise-in" : ""}`}>
              <span
                aria-hidden="true"
                className={`grid size-6.5 shrink-0 place-items-center rounded-full border text-[11px] font-bold ${
                  c.author === "agent" ? "border-transparent bg-accent text-accent-text" : "border-line bg-card text-muted"
                }`}
              >
                {c.author === "user" ? "Y" : c.author === "agent" ? "A" : "S"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 text-xs text-muted">
                  <b className={c.author === "system" ? "font-semibold" : "font-semibold text-text"}>{WHO[c.author]}</b> · {formatDateTime(c.createdAt)}
                </div>
                <div className={`font-ui text-sm ${c.author === "system" ? "text-muted" : ""}`}>
                  <Markdown mentions>{c.body}</Markdown>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2">
        <label htmlFor={inputId} className="text-xs text-muted">
          Add a comment
        </label>
        <textarea
          ref={area}
          id={inputId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              // Escape in the box must not close the panel.
              e.stopPropagation();
            }
          }}
          aria-describedby={`${inputId}-hint`}
          rows={3}
          className={`${controlClass} min-h-16 resize-y font-ui`}
        />
        <p id={`${inputId}-hint`} className="text-xs text-muted">
          {hint(status, runState)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon="send" disabled={!body.trim() || sending} onClick={() => void submit()}>
            {sending ? "Sending…" : "Comment"}
          </Button>
          <Button onClick={insertMention}>@agent</Button>
          <span className="text-xs text-muted">Ctrl+Enter to send.</span>
        </div>
      </div>
    </div>
  );
});
