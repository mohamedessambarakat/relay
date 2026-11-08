import { AGENT_MENTION, type RunState, type Status } from "../shared/types.ts";

export type CommentRoute = "inject" | "resume" | "note";

/**
 * Where a user comment goes:
 * - @agent on a running ticket: into the live session.
 * - @agent in Review or Blocked: back to Agent Ready, resuming the session.
 * - Anything else: just a note.
 */
export function routeComment(status: Status, runState: RunState, body: string): CommentRoute {
  if (!AGENT_MENTION.test(body)) return "note";
  if (runState === "running") return "inject";
  if (status === "review" || status === "blocked") return "resume";
  return "note";
}
