import { cn } from "../lib/cn.js";

export function Field({
  label,
  hint,
  suffix,
  value,
  onChange,
  placeholder,
  className,
  inputMode = "decimal",
}: {
  readonly label: string;
  readonly hint?: string;
  readonly suffix?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
  readonly inputMode?: "text" | "decimal" | "numeric";
}): React.JSX.Element {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="flex items-baseline gap-1.5 text-[11.5px] text-ink-500">
        {label}
        {hint === undefined ? null : <span className="text-[10.5px] text-ink-400">{hint}</span>}
      </span>
      <span className="relative flex items-center">
        <input
          value={value}
          inputMode={inputMode}
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className={cn(
            "h-10 w-full rounded-xl bg-paper-100 px-3 text-[13.5px] tabular text-ink-900 outline-none ring-1 ring-inset ring-paper-300 transition-shadow placeholder:text-ink-300 focus:bg-paper-50 focus:ring-2 focus:ring-seal-500/45",
            suffix === undefined ? "" : "pr-9",
          )}
        />
        {suffix === undefined ? null : (
          <span className="pointer-events-none absolute right-3 text-[11.5px] text-ink-400">{suffix}</span>
        )}
      </span>
    </label>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => {
        onChange(!checked);
      }}
      className={cn(
        "flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px] transition-colors",
        checked ? "bg-seal-100/70 text-seal-600 ring-1 ring-inset ring-seal-500/25" : "bg-paper-100 text-ink-600 ring-1 ring-inset ring-paper-300",
      )}
    >
      <span
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors",
          checked ? "bg-seal-500" : "bg-paper-300",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-paper-50 transition-all",
            checked ? "left-3.5" : "left-0.5",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint === undefined ? null : <span className="block text-[11px] text-ink-400">{hint}</span>}
      </span>
    </button>
  );
}

export function Chips<T extends string>({
  options,
  selected,
  onToggle,
}: {
  readonly options: readonly T[];
  readonly selected: readonly T[];
  readonly onToggle: (option: T) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            onClick={() => {
              onToggle(option);
            }}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-[12px] transition-colors",
              active
                ? "bg-jade-500 text-paper-50"
                : "bg-paper-100 text-ink-600 ring-1 ring-inset ring-paper-300 hover:bg-paper-150",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}