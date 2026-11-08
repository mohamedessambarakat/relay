import { useState } from "react";
import type { SpendItem } from "../shared/types.ts";

interface Props {
  items: SpendItem[];
  onSetMax: (itemId: number, max: number) => void;
}

export function SpendBox({ items, onSetMax }: Props) {
  return (
    <div className="mt-2 rounded-ctl border border-line bg-card p-3">
      <h4 className="mb-2 text-xs font-semibold text-muted">Spend limits</h4>
      {items.length === 0 ? (
        <p className="text-sm text-muted">The agent lists the paid services it needs when it starts.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <SpendRow key={item.id} item={item} onSetMax={(max) => onSetMax(item.id, max)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SpendRow({ item, onSetMax }: { item: SpendItem; onSetMax: (max: number) => void }) {
  const [draft, setDraft] = useState(String(item.max));
  const [seen, setSeen] = useState(item.max);
  if (item.max !== seen) {
    setSeen(item.max);
    setDraft(String(item.max));
  }
  const inputId = `spend-max-${item.id}`;
  const pct = item.max > 0 ? Math.min(100, (item.used / item.max) * 100) : item.used > 0 ? 100 : 0;
  const over = item.used > item.max;

  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n) || n < 0) {
      setDraft(String(item.max));
      return;
    }
    if (n !== item.max) onSetMax(n);
  };

  return (
    <li className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span>
          <b className="font-semibold">{item.service}</b> <span className="text-muted">{item.reason}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="w-24 rounded-ctl border border-line bg-bg px-2 py-1 text-text"
        />
        <span className="text-xs text-muted">{item.max === item.estimate ? "Agent's estimate" : `Agent estimated ${item.estimate}`}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span
          role="progressbar"
          aria-label={`${item.service} used`}
          aria-valuemin={0}
          aria-valuemax={item.max}
          aria-valuenow={Math.min(item.used, item.max)}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"
        >
          <span className={`block h-full ${over ? "bg-blocked" : "bg-running"}`} style={{ width: `${pct}%` }} />
        </span>
        <span className={over ? "text-blocked" : ""}>
          {item.used} of {item.max} {item.unit} used{over ? " (over limit)" : ""}
        </span>
      </div>
    </li>
  );
}
