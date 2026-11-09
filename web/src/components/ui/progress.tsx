import { cn } from "../../lib/utils.js";

export function Progress({ value, className }: { readonly value: number; readonly className?: string }): React.JSX.Element {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink-700/70", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-flow-400 to-lock-400 transition-[width] duration-200"
        style={{ width: `${(clamped * 100).toFixed(1)}%` }}
      />
    </div>
  );
}
