import type { RunState, TicketSummary } from "../../shared/types.ts";
import { formatElapsed } from "../hooks.ts";
import { Icon } from "./Icon.tsx";

type RunFields = Pick<TicketSummary, "runState" | "runStartedAt" | "queuePosition" | "status">;

/** Text + icon for what the runner is doing; null when there is nothing to show. */
export function RunBadge({ ticket, now }: { ticket: RunFields; now: number }) {
  const state: RunState = ticket.runState;
  if (state === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-running">
        <Icon name="terminal" className="size-3.5" />
        Running{ticket.runStartedAt ? ` · ${formatElapsed(ticket.runStartedAt, now)}` : ""}
      </span>
    );
  }
  if (state === "queued") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-queued">
        <Icon name="clock" className="size-3.5" />
        Queued{ticket.queuePosition ? ` #${ticket.queuePosition}` : ""}
      </span>
    );
  }
  if (state === "waiting_limit") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-review">
        <Icon name="clock" className="size-3.5" />
        Waiting for limit reset
      </span>
    );
  }
  if (ticket.status === "blocked") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blocked">
        <Icon name="alert" className="size-3.5" />
        Blocked
      </span>
    );
  }
  return null;
}
