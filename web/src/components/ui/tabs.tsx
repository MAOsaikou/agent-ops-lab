import { cn } from "../../lib/utils.js";

export type TabItem = {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
};

type Props = {
  readonly items: readonly TabItem[];
  readonly value: string;
  readonly onValueChange: (id: string) => void;
  readonly className?: string;
};

export function Tabs({ items, value, onValueChange, className }: Props): React.JSX.Element {
  return (
    <div className={cn("flex flex-wrap items-center gap-1 rounded-xl border border-ink-700/70 bg-ink-900/70 p-1", className)}>
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onValueChange(item.id);
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              active ? "bg-flow-400/15 text-flow-400 ring-1 ring-flow-400/40" : "text-mist-500 hover:bg-ink-800 hover:text-mist-100",
            )}
          >
            {item.label}
            {item.hint === undefined ? null : <span className="ml-1.5 text-[10px] text-mist-500">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
