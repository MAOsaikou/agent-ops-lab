import type { PlatformId, PlatformPreset } from "../../../src/templates/pricing/platform.js";
import { cn } from "../lib/cn.js";

export function PlatformPicker({
  platforms,
  value,
  onChange,
}: {
  readonly platforms: readonly PlatformPreset[];
  readonly value: PlatformId;
  readonly onChange: (id: PlatformId) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 xl:grid-cols-6">
      {platforms.map((platform) => {
        const active = platform.id === value;
        return (
          <button
            key={platform.id}
            type="button"
            onClick={() => {
              onChange(platform.id);
            }}
            className={cn(
              "rounded-xl px-2.5 py-2 text-left transition-all",
              active
                ? "bg-seal-500 text-paper-50 shadow-[0_8px_20px_-14px_rgba(196,68,43,0.95)]"
                : "bg-paper-100 text-ink-700 ring-1 ring-inset ring-paper-300 hover:bg-paper-150",
            )}
          >
            <div className="truncate text-[12.5px] font-semibold">{platform.label}</div>
            <div className={cn("truncate text-[10.5px]", active ? "text-paper-100/80" : "text-ink-400")}>
              佣金 {(platform.commissionRate * 100).toFixed(1)}% · {platform.titleMax} 字
            </div>
          </button>
        );
      })}
    </div>
  );
}