interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name. Omit when the switch sits inside a <label> with visible text. */
  label?: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 transition-colors duration-150 disabled:opacity-50 motion-reduce:transition-none ${
        checked ? "border-accent bg-accent" : "border-control bg-transparent"
      }`}
    >
      <span
        className={`size-4.5 rounded-full transition-transform duration-150 motion-reduce:transition-none ${
          checked ? "translate-x-5 bg-accent-text" : "bg-muted"
        }`}
      />
    </button>
  );
}
