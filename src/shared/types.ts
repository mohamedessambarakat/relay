export const STATUSES = ["backlog", "todo", "agent_ready", "blocked", "review", "done"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  backlog: "Backlog",
  todo: "Todo",
  agent_ready: "Agent Ready",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

// 0 = none … 4 = urgent. Higher runs first.
export const PRIORITIES = [0, 1, 2, 3, 4] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABELS: Record<Priority, string> = { 0: "None", 1: "Low", 2: "Medium", 3: "High", 4: "Urgent" };

export const TOGGLE_KEYS = ["send", "push", "publish", "merge", "deploy", "spend"] as const;
export type ToggleKey = (typeof TOGGLE_KEYS)[number];
export type Toggles = Record<ToggleKey, boolean>;
export const DEFAULT_TOGGLES: Toggles = { send: true, push: true, publish: true, merge: true, deploy: true, spend: false };

/** What the runner is doing with a ticket, separate from its board status. */
export type RunState = "idle" | "queued" | "running" | "waiting_limit";

export interface TicketSummary {
  id: number;
  key: string; // "R-12"
  title: string;
  status: Status;
  priority: Priority;
  labels: string[];
  dueDate: string | null;
  linkedPath: string | null;
  runState: RunState;
  runStartedAt: string | null;
  queuePosition: number | null;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Comment {
  id: number;
  ticketId: number;
  author: "user" | "agent" | "system";
  body: string;
  createdAt: string;
}

export interface Attachment {
  id: number;
  ticketId: number;
  name: string;
  size: number;
  mime: string;
  createdAt: string;
}

export interface SpendItem {
  id: number;
  ticketId: number;
  service: string;
  unit: string;
  reason: string;
  estimate: number;
  max: number;
  used: number;
}

export interface LogLine {
  id: number;
  ticketId: number;
  ts: string;
  kind: "info" | "text" | "tool" | "result" | "error" | "user";
  text: string;
}

export interface TicketDetail extends TicketSummary {
  description: string;
  toggles: Toggles;
  model: string | null; // null = use Settings
  branch: string | null;
  workspace: string | null;
  comments: Comment[];
  attachments: Attachment[];
  spend: SpendItem[];
  log: LogLine[];
}

export const MODEL_CHOICES = [
  { id: "fable", name: "Fable 5.1" },
  { id: "opus", name: "Opus 5.5" },
  { id: "sonnet", name: "Sonnet 5.5" },
  { id: "haiku", name: "Haiku 5.5" },
] as const;

export interface ModelRole {
  name: string; // "main" or an agent name from ~/.claude/agents
  description: string;
  source: "relay" | "user-agent";
  model: string;
}

export interface SystemState {
  running: number;
  queued: number;
  maxParallel: number;
  limitResetAt: string | null; // set while paused on the usage limit
  keepingAwake: boolean;
  ntfyEnabled: boolean;
}

/** Server-sent events pushed to the board. */
export type BoardEvent =
  | { type: "tickets" } // something in the ticket list changed
  | { type: "ticket"; ticketId: number } // one ticket's detail changed
  | { type: "log"; line: LogLine }
  | { type: "system"; state: SystemState };

export const ticketKey = (id: number) => `R-${id}`;

export const AGENT_MENTION = /(^|\s)@agent\b/i;
