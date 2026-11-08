import { useState } from "react";
import type { Comment } from "../shared/types.ts";
import { Button } from "./components/Button.tsx";
import { controlClass } from "./components/Field.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { formatDateTime } from "./hooks.ts";

const WHO: Record<Comment["author"], string> = { user: "You", agent: "Agent", system: "System" };

interface Props {
  ticketId: number;
  comments: Comment[];
  onSubmit: (body: string) => Promise<boolean>;
}

export function Comments({ ticketId, comments, onSubmit }: Props) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const inputId = `comment-${ticketId}`;

  const submit = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    const ok = await onSubmit(body.trim());
    setSending(false);
    if (ok) setBody("");
  };

  return (
    <div className="flex flex-col gap-3">
      {comments.length === 0 ? (
        <p className="text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
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
                <div className={c.author === "system" ? "text-muted" : ""}>
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
          id={inputId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          rows={3}
          className={`${controlClass} min-h-16 resize-y font-ui`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon="send" disabled={!body.trim() || sending} onClick={() => void submit()}>
            {sending ? "Sending…" : "Comment"}
          </Button>
          <span className="text-xs text-muted">Only comments with @agent reach Claude. Ctrl+Enter to send.</span>
        </div>
      </div>
    </div>
  );
}
