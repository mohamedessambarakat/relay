import { memo, useEffect, useRef, useState } from "react";
import type { LogLine, RunState } from "../shared/types.ts";
import { Icon } from "./components/Icon.tsx";
import { useBoardEvents } from "./events.ts";
import { formatTime } from "./hooks.ts";

const KIND_CLASS: Record<LogLine["kind"], string> = {
  tool: "text-log-tool",
  text: "text-log-text",
  result: "text-log-ok",
  error: "text-blocked",
  user: "text-log-user",
  info: "text-log-dim",
};

// Not color-only: a glyph for sighted users, a word for screen readers.
const KIND_MARK: Record<LogLine["kind"], { glyph: string; word: string }> = {
  tool: { glyph: "›", word: "tool" },
  text: { glyph: "", word: "" },
  result: { glyph: "✓", word: "done" },
  error: { glyph: "!", word: "error" },
  user: { glyph: "»", word: "you" },
  info: { glyph: "·", word: "" },
};

// Stored lines are capped so a very long run can't slow the panel down.
const MAX_LINES = 1000;

const cap = (lines: LogLine[]) => (lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines);

/** Fetched lines win; local lines newer than the newest fetched one (appended via SSE meanwhile) are kept. */
function mergeLines(fetched: LogLine[], local: LogLine[]): LogLine[] {
  const maxFetched = fetched.at(-1)?.id ?? -1;
  const seen = new Set<number>();
  const extra = local.filter((l) => l.id > maxFetched && !seen.has(l.id) && seen.add(l.id));
  return cap(extra.length ? [...fetched, ...extra] : fetched);
}

interface Props {
  ticketId: number;
  /** Log from the last ticket fetch. */
  fetched: LogLine[];
  runState: RunState;
}

/** Owns the log lines and their SSE subscription, so a new line re-renders only this section. */
export const LogSection = memo(function LogSection({ ticketId, fetched, runState }: Props) {
  const [lines, setLines] = useState(fetched);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [announce, setAnnounce] = useState("");
  const [prevRun, setPrevRun] = useState(runState);
  const [prevFetched, setPrevFetched] = useState(fetched);
  if (fetched !== prevFetched) {
    setPrevFetched(fetched);
    setLines((local) => mergeLines(fetched, local));
  }

  useBoardEvents((m) => {
    if (m.type !== "log" || m.line.ticketId !== ticketId) return;
    const line = m.line;
    setLines((prev) => ((prev.at(-1)?.id ?? -1) < line.id ? cap([...prev, line]) : prev));
  });

  // Derived during render (not in an effect) from the run-state change.
  if (prevRun !== runState) {
    setPrevRun(runState);
    if (runState === "running") setAnnounce("Agent started running.");
    else if (runState === "waiting_limit") setAnnounce("Agent is waiting for the usage limit to reset.");
    else if (runState === "idle" && (prevRun === "running" || prevRun === "waiting_limit")) setAnnounce("Agent run finished.");
    else if (runState === "queued") setAnnounce("Ticket is queued.");
  }

  const live = runState === "running";
  const active = live || runState === "waiting_limit" || runState === "queued";
  const open = userOpen ?? active;
  const bodyId = `log-body-${ticketId}`;

  return (
    <section aria-labelledby="sec-log">
      <div className="mb-2 flex items-center gap-2">
        <h3 id="sec-log" className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
          <Icon name="terminal" className="size-3.5" />
          Live log
        </h3>
        {live && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-running">
            <span aria-hidden="true" className="size-1.5 animate-live-dot rounded-full bg-running" />
            live
          </span>
        )}
        <span className="flex-1" />
        {!active && lines.length === 0 && <span className="text-xs text-muted">No runs yet</span>}
        {!active && lines.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setUserOpen(!open)}
            className="rounded-ctl px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-text"
          >
            {open ? "Hide log" : `Show log (${lines.length} lines)`}
          </button>
        )}
      </div>
      <p role="status" className="sr-only">
        {announce}
      </p>
      {open && (
        <div id={bodyId}>
          <LogView lines={lines} live={live} />
        </div>
      )}
    </section>
  );
});

function LogView({ lines, live }: { lines: LogLine[]; live: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // Lines present on first render don't animate; later ones fade in.
  const [baseline] = useState(() => lines.at(-1)?.id ?? -1);
  const lastId = lines.at(-1)?.id;

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const jump = () => {
    const el = box.current;
    if (!el) return;
    stick.current = true;
    setAtBottom(true);
    el.scrollTop = el.scrollHeight;
  };

  return (
    <div className="relative">
      <div
        ref={box}
        role="log"
        aria-live="off"
        aria-label="Agent log"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          stick.current = near;
          setAtBottom(near);
        }}
        className="max-h-[50vh] min-h-[120px] overflow-auto rounded-ctl border border-line bg-log-bg px-3 py-2.5 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 && <p className="text-log-dim">No output yet.</p>}
        {lines.map((l) => {
          const mark = KIND_MARK[l.kind];
          return (
            <div key={l.id} className={`flex gap-2 ${KIND_CLASS[l.kind]} ${l.id > baseline ? "animate-fade-in" : ""}`}>
              <span className="shrink-0 text-log-dim">{formatTime(l.ts)}</span>
              <span aria-hidden="true" className="w-3 shrink-0 text-center">
                {mark.glyph}
              </span>
              <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
                {mark.word && <span className="sr-only">{mark.word}: </span>}
                {l.text}
              </span>
            </div>
          );
        })}
        {live && (
          <span aria-hidden="true" className="animate-blink text-log-text">
            ▌
          </span>
        )}
      </div>
      {!atBottom && (
        <button
          type="button"
          onClick={jump}
          className="absolute right-3 bottom-3 animate-fade-in rounded-ctl border border-control bg-panel px-2 py-1 text-xs text-text shadow-lg transition-colors hover:bg-card-hover"
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}
