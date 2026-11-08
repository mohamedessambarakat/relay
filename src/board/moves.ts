import { STATUS_LABELS, type RunState, type Status } from "../shared/types.ts";

interface MovableTicket {
  key: string;
  status: Status;
  runState: RunState;
}

export interface MoveWarning {
  title: string;
  body: string;
  confirmLabel: string;
  danger: boolean;
}

/**
 * Moves that start or kill an agent run need a confirmation; everything else moves straight away.
 * Leaving Agent Ready kills a running run (the runner treats it like Stop) or drops a queued one.
 */
export function moveWarning(t: MovableTicket, to: Status): MoveWarning | null {
  if (t.status === to) return null;
  if (t.status === "in_progress" || (t.status === "agent_ready" && t.runState === "waiting_limit")) {
    return {
      title: `Stop ${t.key} and move it to ${STATUS_LABELS[to]}?`,
      body: "The running agent is killed. Work it already did stays in the workspace.",
      confirmLabel: `Stop and move`,
      danger: true,
    };
  }
  if (t.status === "agent_ready" && t.runState === "queued") {
    return {
      title: `Take ${t.key} out of the queue?`,
      body: `It moves to ${STATUS_LABELS[to]} and won't start.`,
      confirmLabel: "Move",
      danger: false,
    };
  }
  if (to === "agent_ready") {
    return {
      title: `Send ${t.key} to the agent?`,
      body: "Claude starts working on it as soon as a slot is free, using the ticket's allowed actions.",
      confirmLabel: "Send to agent",
      danger: false,
    };
  }
  return null;
}
