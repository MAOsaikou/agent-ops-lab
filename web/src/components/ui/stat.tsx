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
    <div className="rounded-xl border border-white/[0.05] bg-ink-900/45 px-3 py-2.5">
      <div className="text-[11px] text-mist-400">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold leading-tight tracking-tight tabular-nums", toneClass)}>{value}</div>
      {hint === undefined ? null : <div className="mt-0.5 text-[11px] text-mist-400">{hint}</div>}
    </div>
  );
}

export function Separator({ className }: { readonly className?: string }): React.JSX.Element {
  return <div className={cn("h-px w-full bg-white/[0.06]", className)} />;
}
