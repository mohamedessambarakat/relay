import { useEffect, useRef } from "react";
import type { LogLine } from "../shared/types.ts";
import { formatTime } from "./hooks.ts";

const KIND_CLASS: Record<LogLine["kind"], string> = {
  tool: "text-log-tool",
  text: "text-log-text",
  result: "text-log-ok",
  error: "text-blocked",
  user: "text-log-user",
  info: "text-log-dim",
};

// Rendering is capped so a very long run can't slow the panel down.
const MAX_LINES = 1000;

export function LogView({ lines }: { lines: LogLine[] }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const shown = lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines;

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={box}
      role="log"
      aria-live="polite"
      aria-label="Live log"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="max-h-[40vh] min-h-48 overflow-auto rounded-ctl border border-line bg-log-bg px-3 py-2.5 font-mono text-xs leading-relaxed"
    >
      {lines.length === 0 && <p className="text-log-dim">No output yet.</p>}
      {lines.length > shown.length && <p className="text-log-dim">… {lines.length - shown.length} earlier lines hidden</p>}
      {shown.map((l) => (
        <div key={l.id} className={`break-words whitespace-pre-wrap ${KIND_CLASS[l.kind]}`}>
          <span className="text-log-dim">{formatTime(l.ts)}</span> {l.text}
        </div>
      ))}
    </div>
  );
}
