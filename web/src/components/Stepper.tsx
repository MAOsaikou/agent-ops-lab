import { Check } from "lucide-react";

import { cn } from "../lib/cn.js";

export const STEPS = [
  { id: 1, label: "填数字", hint: "成本 · 竞品价 · 目标" },
  { id: 2, label: "AI 核算", hint: "四个角色分工算" },
  { id: 3, label: "挑方案", hint: "三套价选一套" },
  { id: 4, label: "复制上架", hint: "标题 · 卖点 · 价格表" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export function Stepper({
  current,
  reached,
  onJump,
}: {
  readonly current: StepId;
  readonly reached: StepId;
  readonly onJump: (step: StepId) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-stretch gap-1 rounded-2xl border border-paper-300/80 bg-paper-50/80 p-1.5 shadow-card backdrop-blur">
      {STEPS.map((step, index) => {
        const done = step.id < current;
        const active = step.id === current;
        const locked = step.id > reached;
        return (
          <div key={step.id} className="flex flex-1 items-center gap-1">
            <button
              type="button"
              disabled={locked}
              onClick={() => {
                onJump(step.id);
              }}
              className={cn(
                "group flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                active ? "bg-seal-100/70" : locked ? "cursor-not-allowed opacity-45" : "hover:bg-paper-150",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12.5px] font-semibold transition-all",
                  active
                    ? "bg-seal-500 text-paper-50 shadow-[0_0_0_4px_rgba(196,68,43,0.14)]"
                    : done
                      ? "bg-jade-500 text-paper-50"
                      : "bg-paper-200 text-ink-500",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : step.id}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block truncate text-[13px] font-semibold",
                    active ? "text-seal-600" : done ? "text-jade-600" : "text-ink-700",
                  )}
                >
                  {step.label}
                </span>
                <span className="hidden truncate text-[11px] text-ink-400 sm:block">{step.hint}</span>
              </span>
            </button>
            {index < STEPS.length - 1 ? (
              <span className="hidden h-[2px] w-4 shrink-0 rounded-full bg-paper-200 sm:block">
                <span
                  className={cn(
                    "block h-full rounded-full bg-jade-500 transition-transform duration-500",
                    done ? "draw-line scale-x-100" : "scale-x-0",
                  )}
                  style={{ transformOrigin: "left center" }}
                />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}