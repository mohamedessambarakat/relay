import { PRIORITY_LABELS, type Priority } from "../../shared/types.ts";
import { Icon } from "./Icon.tsx";

const STYLE: Record<Exclude<Priority, 0>, string> = {
  1: "text-muted",
  2: "text-text",
  3: "text-review",
  4: "text-blocked",
};

/** A flag plus the priority word. "None" renders nothing visible, only screen-reader text. */
export function PriorityBars({ priority }: { priority: Priority; showLabel?: boolean }) {
  if (priority === 0) return <span className="sr-only">Priority: None</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${STYLE[priority]}`}>
      <Icon name="flag" className="size-3.5" />
      <span>
        <span className="sr-only">Priority: </span>
        {PRIORITY_LABELS[priority]}
      </span>
    </span>
  );
}
