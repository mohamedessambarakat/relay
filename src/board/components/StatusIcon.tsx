import type { Status } from "../../shared/types.ts";
import { Icon, type IconName } from "./Icon.tsx";

const STATUS_ICON: Record<Status, { icon: IconName; color: string }> = {
  backlog: { icon: "dashed", color: "text-muted" },
  todo: { icon: "circle", color: "text-text" },
  agent_ready: { icon: "bolt", color: "text-accent" },
  in_progress: { icon: "relay", color: "text-running" },
  blocked: { icon: "alert", color: "text-blocked" },
  review: { icon: "eye", color: "text-review" },
  done: { icon: "check", color: "text-done" },
};

export function StatusIcon({ status, className = "size-4" }: { status: Status; className?: string }) {
  const s = STATUS_ICON[status];
  return <Icon name={s.icon} className={`${className} ${s.color}`} />;
}
