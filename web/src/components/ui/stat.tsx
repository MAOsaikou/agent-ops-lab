import { cn } from "../../lib/utils.js";

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly hint?: string;
  readonly tone?: "default" | "lock" | "warn" | "risk" | "flow";
}): React.JSX.Element {
  const toneClass =
    tone === "lock"
      ? "text-lock-400"
      : tone === "warn"
        ? "text-warn-400"
        : tone === "risk"
          ? "text-risk-400"
          : tone === "flow"
            ? "text-flow-400"
            : "text-mist-100";
  return (
    <div className="rounded-lg border border-ink-700/60 bg-ink-900/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-mist-500">{label}</div>
      <div className={cn("mt-0.5 text-sm font-semibold tabular-nums", toneClass)}>{value}</div>
      {hint === undefined ? null : <div className="mt-0.5 text-[10px] text-mist-500">{hint}</div>}
    </div>
  );
}

export function Separator({ className }: { readonly className?: string }): React.JSX.Element {
  return <div className={cn("h-px w-full bg-ink-700/60", className)} />;
}
