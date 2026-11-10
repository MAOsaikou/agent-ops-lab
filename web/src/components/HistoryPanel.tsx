import { History, X } from "lucide-react";

import type { PlanSummary } from "../../../src/templates/pricing/model.js";
import { PLATFORM_PRESETS } from "../../../src/templates/pricing/platform.js";
import { cn } from "../lib/cn.js";
import { moneyInt, pct } from "../lib/format.js";
import { Pill } from "./Primitives.js";

export function HistoryPanel({
  open,
  plans,
  currentId,
  onClose,
  onOpen,
}: {
  readonly open: boolean;
  readonly plans: readonly PlanSummary[];
  readonly currentId: string | null;
  readonly onClose: () => void;
  readonly onOpen: (id: string) => void;
}): React.JSX.Element | null {
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink-900/20 backdrop-blur-[1px]">
      <button type="button" aria-label="关闭" className="flex-1 cursor-default" onClick={onClose} />
      <aside className="fade-in flex h-full w-[min(380px,92vw)] flex-col border-l border-paper-300 bg-paper-50 shadow-lift">
        <div className="flex items-center gap-2 border-b border-paper-200 px-4 py-3">
          <History className="h-4 w-4 text-ink-500" />
          <span className="text-[13.5px] font-semibold text-ink-900">算过的方案</span>
          <span className="text-[11.5px] text-ink-400">{plans.length} 份</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-500 hover:bg-paper-150"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {plans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-paper-300 px-3 py-8 text-center text-[12px] text-ink-400">
              还没有算过方案。填完数字点「开始核算」，这里会留下记录。
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpen(plan.id);
                      onClose();
                    }}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                      plan.id === currentId
                        ? "border-seal-500/40 bg-seal-100/40"
                        : "border-paper-300/70 bg-paper-100/50 hover:bg-paper-150",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-medium text-ink-900">{plan.name}</span>
                      {plan.locked ? <Pill tone="jade">已锁定</Pill> : <Pill tone="plain">未锁定</Pill>}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-500">
                      <span>{PLATFORM_PRESETS[plan.platform].short}</span>
                      <span className="tabular">{moneyInt(plan.priceCents)}</span>
                      <span className="tabular">毛利 {pct(plan.margin)}</span>
                      <span className="ml-auto text-ink-400">{plan.createdAt.slice(5, 16).replace("T", " ")}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}