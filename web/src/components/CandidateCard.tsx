import { AlertTriangle, Check, Sparkles } from "lucide-react";

import type { Candidate } from "../../../src/templates/pricing/model.js";
import { cn } from "../lib/cn.js";
import { money, moneyInt, num, pct } from "../lib/format.js";
import { CountUp } from "./CountUp.js";
import { Pill } from "./Primitives.js";

export function CandidateCard({
  candidate,
  recommended,
  selected,
  disabled,
  onSelect,
}: {
  readonly candidate: Candidate;
  readonly recommended: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  const risks = candidate.risks;
  return (
    <button
      type="button"
      disabled={disabled && !selected}
      onClick={onSelect}
      className={cn(
        "group relative flex h-full w-full flex-col gap-1 rounded-xl border px-2.5 py-1.5 text-left transition-all duration-200 md:gap-3 md:rounded-2xl md:p-4",
        selected
          ? "border-seal-500 bg-paper-50 shadow-lift ring-1 ring-seal-500/30"
          : "border-paper-300/80 bg-paper-50/70 hover:-translate-y-0.5 hover:border-paper-400 hover:shadow-card",
        disabled && !selected ? "opacity-60" : "",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 md:flex-col md:items-start md:gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            {recommended ? (
              <Pill tone="seal">
                <Sparkles className="h-3 w-3" /> 推荐
              </Pill>
            ) : selected ? (
              <Pill tone="jade">
                <Check className="h-3 w-3" strokeWidth={3} /> 已选
              </Pill>
            ) : null}
            <span className="truncate text-[13px] font-semibold text-ink-900 md:text-[13.5px]">{candidate.label}</span>
          </div>
          <div className="hidden text-[11px] text-ink-400 md:mt-0.5 md:block">{candidate.tagline}</div>
        </div>

        <div className="flex items-end gap-1.5 md:gap-2">
          <span className="font-display text-[20px] font-semibold leading-none tabular tracking-tight text-ink-900 md:text-[34px]">
            <CountUp value={candidate.priceCents} format={money} />
          </span>
          {candidate.promoPriceCents !== candidate.priceCents ? (
            <span className="text-[10.5px] text-ink-400 md:pb-1 md:text-[11.5px]">活动价 {money(candidate.promoPriceCents)}</span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-paper-100/80 px-2 py-1 md:gap-2 md:rounded-xl md:px-2.5 md:py-2">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5 md:block">
          <div className="text-[10px] text-ink-400 md:text-[10.5px]">毛利率</div>
          <div
            className={cn(
              "tabular text-[12.5px] font-semibold md:text-[15px]",
              candidate.evaluation.daily.margin >= 0.2
                ? "text-jade-600"
                : candidate.evaluation.daily.margin >= 0.08
                  ? "text-ochre-500"
                  : "text-seal-600",
            )}
          >
            {pct(candidate.evaluation.daily.margin)}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5 md:block">
          <div className="text-[10px] text-ink-400 md:text-[10.5px]">日均单量</div>
          <div className="tabular text-[12.5px] font-semibold text-ink-800 md:text-[15px]">
            {num(candidate.evaluation.daily.orders, 0)}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5 md:block">
          <div className="text-[10px] text-ink-400 md:text-[10.5px]">单件净利</div>
          <div className="tabular text-[12.5px] font-semibold text-ink-800 md:text-[15px]">
            {money(candidate.evaluation.daily.netPerOrderCents)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-[10.5px] md:flex md:flex-col md:gap-1.5 md:text-[11px]">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5 md:gap-2">
          <span className="text-ink-400">30 天利润</span>
          <span className="tabular font-display text-[12px] font-semibold text-ink-900 md:text-[17px]">
            {moneyInt(candidate.sim.p50Cents)}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5 md:gap-2">
          <span className="text-ink-400">最差 10%</span>
          <span className="tabular text-[11.5px] font-medium text-ink-600 md:text-[12.5px]">{moneyInt(candidate.sim.p10Cents)}</span>
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-1 gap-y-0.5 md:gap-2">
          <span className="text-ink-400">缺货天数</span>
          <span
            className={cn(
              "tabular text-[11.5px] font-medium md:text-[12.5px]",
              candidate.sim.stockoutDays === 0 ? "text-jade-600" : "text-ochre-500",
            )}
          >
            {candidate.sim.stockoutDays} 天
          </span>
        </div>
      </div>

      <div className="mt-auto border-t border-paper-200 pt-1 md:pt-2">
        {risks.length === 0 ? (
          <div className="flex items-center gap-1 text-[11px] text-jade-600 md:text-[11.5px]">
            <Check className="h-3 w-3" strokeWidth={3} /> 风控没发现硬伤
          </div>
        ) : (
          <div className="flex items-start gap-1 text-[11px] leading-snug text-ochre-500 md:text-[11.5px]">
            <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
            <span className="line-clamp-1 md:line-clamp-2">{risks[0]}</span>
          </div>
        )}
      </div>
    </button>
  );
}