import { memo } from "react";
import type { Attachment, Comment } from "../shared/types.ts";
import { Button } from "./components/Button.tsx";
import { Icon } from "./components/Icon.tsx";
import { Markdown } from "./components/Markdown.tsx";
import { formatDateTime, formatSize } from "./hooks.ts";

export function AttachmentChip({ ticketId, a }: { ticketId: number; a: Attachment }) {
  return (
    <a
      href={`/api/tickets/${ticketId}/attachments/${a.id}`}
      download={a.name}
      className="flex items-center gap-2 rounded-ctl border border-line bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-card-hover"
    >
      <Icon name="file" className="size-3.5" />
      <span className="break-all">{a.name}</span>
      <span className="text-muted">{formatSize(a.size)}</span>
      <span className="sr-only">Download</span>
    </a>
  );
}

interface Props {
  ticketId: number;
  status: "review" | "blocked";
  comment: Comment;
  attachments: Attachment[];
  onRequestChanges: () => void;
  onDone: () => void;
}

/** The agent's final report, pinned above the log once a run ends in Review or Blocked. */
export const ResultCard = memo(function ResultCard({ ticketId, status, comment, attachments, onRequestChanges, onDone }: Props) {
  const blocked = status === "blocked";
  return (
    <section
      aria-labelledby="sec-result"
      className={`animate-pop-in rounded-ctl border bg-card p-3.5 ${blocked ? "border-blocked/60" : "border-review/60"}`}
    >
      <h3
        id="sec-result"
        className={`mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase ${blocked ? "text-blocked" : "text-review"}`}
      >
        <Icon name={blocked ? "alert" : "eye"} className="size-3.5" />
        Result · {blocked ? "Blocked" : "Ready for review"}
        <span className="ml-auto font-normal tracking-normal text-muted normal-case">{formatDateTime(comment.createdAt)}</span>
      </h3>
      <div className="font-ui text-sm">
        <Markdown mentions>{comment.body}</Markdown>
      </div>
      {attachments.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li key={a.id}>
              <AttachmentChip ticketId={ticketId} a={a} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button icon="chat" onClick={onRequestChanges}>
          Request changes
        </Button>
        <Button variant="primary" icon="check" onClick={onDone}>
          Mark Done
        </Button>
      </div>
    </section>
  );
});
