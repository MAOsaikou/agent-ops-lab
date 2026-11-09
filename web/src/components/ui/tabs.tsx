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
    <div className={cn("flex flex-wrap items-center gap-1 rounded-2xl bg-white/[0.035] p-1 ring-1 ring-inset ring-white/[0.06]", className)}>
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
              "rounded-xl px-3.5 py-2 text-[13px] font-medium transition-colors",
              active ? "bg-flow-400/15 text-flow-400 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset]" : "text-mist-400 hover:bg-white/[0.05] hover:text-mist-100",
            )}
          >
            {item.label}
            {item.hint === undefined ? null : <span className="ml-1.5 text-[11px] text-mist-500">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
