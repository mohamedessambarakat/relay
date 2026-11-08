import { PRIORITY_LABELS, type Priority } from "../../shared/types.ts";

const HEIGHTS = ["h-1", "h-2", "h-2.5", "h-3"];

/** Four bars; the number lit equals the priority. The label is text for screen readers (and optionally shown). */
export function PriorityBars({ priority, showLabel = false }: { priority: Priority; showLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`Priority: ${PRIORITY_LABELS[priority]}`}>
      <span className="inline-flex h-3 items-end gap-px" aria-hidden="true">
        {HEIGHTS.map((h, i) => (
          <i key={i} className={`w-[3px] rounded-[1px] ${h} ${i < priority ? "bg-text" : "bg-line"}`} />
        ))}
      </span>
      <span className={showLabel ? "text-xs text-muted" : "sr-only"}>
        {showLabel ? PRIORITY_LABELS[priority] : `Priority: ${PRIORITY_LABELS[priority]}`}
      </span>
    </span>
  );
}
