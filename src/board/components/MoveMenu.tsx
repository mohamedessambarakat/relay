import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATUSES, STATUS_LABELS, type Status } from "../../shared/types.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { StatusIcon } from "./StatusIcon.tsx";

export interface MenuAction {
  label: string;
  icon: IconName;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  status: Status;
  /** Called with the chosen status; the caller confirms (see moves.ts) and moves. */
  onMove: (to: Status) => void;
  /** Accessible name, e.g. "Move R-5". */
  label: string;
  compact?: boolean;
  /** "dots" shows a ⋯ button, for menus that hold more than moves. */
  trigger?: "move" | "dots";
  /** Extra items after the moves, e.g. Delete. */
  actions?: MenuAction[];
}

type Pos = { right: number } & ({ top: number } | { bottom: number });
const MENU_SPACE = 260;

/** Opens below the button, or above it when there isn't room at the bottom of the window. */
function placeMenu(r: DOMRect): Pos {
  const right = Math.max(8, window.innerWidth - r.right);
  return window.innerHeight - r.bottom < MENU_SPACE && r.top > MENU_SPACE
    ? { right, bottom: window.innerHeight - r.top + 4 }
    : { right, top: r.bottom + 4 };
}

/** Keyboard-friendly alternative to drag and drop: a button that opens a list of columns. */
export function MoveMenu({ status, onMove, label, compact = false, trigger = "move", actions = [] }: Props) {
  const [open, setOpen] = useState(false);
  // The menu is position: fixed so a column's scroll area can't clip it.
  const [pos, setPos] = useState<Pos | null>(null);
  const openMenu = () => {
    const r = button.current?.getBoundingClientRect();
    if (r) setPos(placeMenu(r));
    setOpen(true);
  };
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const id = useId();
  // In Progress is set by the runner when an agent starts, never by hand.
  const options = STATUSES.filter((s) => s !== status && s !== "in_progress");

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (r) setPos(placeMenu(r));
    };
    const closeOnScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", closeOnScroll, true);
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDoc = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && e.target !== button.current) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Home") items[0]?.focus();
    else if (e.key === "End") items.at(-1)?.focus();
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") close(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
        className={`inline-flex items-center gap-1.5 rounded-ctl border border-control text-muted hover:bg-card-hover hover:text-text ${
          compact ? "size-7 justify-center" : "px-2.5 py-1.5 text-sm"
        }`}
      >
        <Icon name={trigger === "dots" ? "dots" : "move"} className="size-4" />
        {!compact && <span>{trigger === "dots" ? "More" : "Move"}</span>}
      </button>
      {open &&
        createPortal(
        <ul
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          style={pos ?? undefined}
          className="fixed z-50 max-h-[70vh] min-w-44 animate-fade-in overflow-y-auto rounded-ctl border border-control bg-panel py-1 shadow-xl"
        >
          {trigger === "dots" && (
            <li role="none" className="px-3 pt-1 pb-0.5 text-[11px] tracking-wider text-muted uppercase">
              Move to
            </li>
          )}
          {options.map((s) => (
            <li key={s} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  onMove(s);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-card-hover focus:bg-card-hover focus:outline-none"
              >
                <StatusIcon status={s} className="size-4" />
                {STATUS_LABELS[s]}
              </button>
            </li>
          ))}
          {actions.length > 0 && <li role="separator" className="my-1 border-t border-line" />}
          {actions.map((a) => (
            <li key={a.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  a.onSelect();
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-card-hover focus:bg-card-hover focus:outline-none ${a.danger ? "text-blocked" : ""}`}
              >
                <Icon name={a.icon} className="size-4" />
                {a.label}
              </button>
            </li>
          ))}
        </ul>,
          // Portal: an animated (transformed) card would otherwise become the fixed menu's containing block.
          document.body,
        )}
    </div>
  );
}
