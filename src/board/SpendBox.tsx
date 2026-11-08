import { useState } from "react";
import type { SpendItem } from "../shared/types.ts";
import { controlClass } from "./components/Field.tsx";
import { Icon } from "./components/Icon.tsx";

interface Props {
  items: SpendItem[];
  /** Resolves false when the save failed (the caller already showed the error). */
  onSetMax: (itemId: number, max: number) => Promise<boolean>;
}

const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_6.5rem] items-start gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_6.5rem_11rem]";

export function SpendBox({ items, onSetMax }: Props) {
  return (
    <div className="mt-3 rounded-ctl border border-line bg-card p-3">
      <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
        <Icon name="bolt" className="size-3.5" />
        Spend limits
      </h4>
      <p className="mb-3 text-xs text-muted">
        {items.length === 0
          ? "The agent lists the paid services it needs when it starts, with its estimate as the max."
          : "Using the agent's estimates. Change any max."}
      </p>
      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <SpendRow key={item.id} item={item} onSetMax={(max) => onSetMax(item.id, max)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SpendRow({ item, onSetMax }: { item: SpendItem; onSetMax: (max: number) => Promise<boolean> }) {
  const [draft, setDraft] = useState(String(item.max));
  const [seen, setSeen] = useState(item.max);
  const [focused, setFocused] = useState(false);
  // Server updates must not overwrite what the user is typing.
  if (item.max !== seen && !focused) {
    setSeen(item.max);
    setDraft(String(item.max));
  }
  const inputId = `spend-max-${item.id}`;
  const over = item.used > item.max;
  const pct = item.max > 0 ? Math.min(100, (item.used / item.max) * 100) : item.used > 0 ? 100 : 0;
  const barColor = over || pct >= 100 ? "bg-blocked" : pct >= 90 ? "bg-review" : "bg-running";
  const valueMax = item.max > 0 ? item.max : Math.max(item.used, 1);

  const commit = async () => {
    setFocused(false);
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0) {
      setDraft(String(item.max));
      return;
    }
    if (n === item.max) return;
    if (!(await onSetMax(n))) setDraft(String(item.max));
  };

  return (
    <li className={`${ROW_GRID} text-sm`}>
      <div className="min-w-0">
        <b className="font-semibold">{item.service}</b> <span className="font-ui text-muted">{item.reason}</span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-xs text-muted">
          Max ({item.unit})
        </label>
        <input
          id={inputId}
          type="number"
          min={0}
          step="any"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => void commit()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={`${controlClass} py-1`}
        />
        <span className="text-xs text-muted">
          Agent estimate: {item.estimate} {item.unit}
        </span>
      </div>
      <div className="col-span-2 flex flex-col gap-1.5 pt-0.5 text-xs text-muted sm:col-span-1 sm:pt-5">
        <span
          role="progressbar"
          aria-label={`${item.service} used`}
          aria-valuemin={0}
          aria-valuemax={valueMax}
          aria-valuenow={Math.min(item.used, valueMax)}
          className="h-1.5 overflow-hidden rounded-full bg-line"
        >
          <span className={`block h-full transition-[width] ${barColor}`} style={{ width: `${pct}%` }} />
        </span>
        <span className={over ? "text-blocked" : pct >= 90 ? "text-review" : ""}>
          {item.used} of {item.max} {item.unit} used{over ? " (over limit)" : ""}
        </span>
      </div>
    </li>
  );
}
