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
        "group relative flex h-full flex-col gap-3 rounded-2xl border p-4 text-left transition-all duration-200",
        selected
          ? "border-seal-500 bg-paper-50 shadow-lift ring-1 ring-seal-500/30"
          : "border-paper-300/80 bg-paper-50/70 hover:-translate-y-0.5 hover:border-paper-400 hover:shadow-card",
        disabled && !selected ? "opacity-60" : "",
      )}
    >
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
          <span className="truncate text-[13.5px] font-semibold text-ink-900">{candidate.label}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-ink-400">{candidate.tagline}</div>
      </div>

      <div className="flex items-end gap-2">
        <span className="font-display text-[34px] font-semibold leading-none tabular tracking-tight text-ink-900">
          <CountUp value={candidate.priceCents} format={money} />
        </span>
        {candidate.promoPriceCents !== candidate.priceCents ? (
          <span className="pb-1 text-[11.5px] text-ink-400">活动价 {money(candidate.promoPriceCents)}</span>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl bg-paper-100/80 px-2.5 py-2">
        <div>
          <div className="text-[10.5px] text-ink-400">毛利率</div>
          <div
            className={cn(
              "tabular text-[15px] font-semibold",
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
        <div>
          <div className="text-[10.5px] text-ink-400">日均单量</div>
          <div className="tabular text-[15px] font-semibold text-ink-800">
            {num(candidate.evaluation.daily.orders, 0)}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] text-ink-400">单件净利</div>
          <div className="tabular text-[15px] font-semibold text-ink-800">
            {money(candidate.evaluation.daily.netPerOrderCents)}
          </div>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-ink-400">30 天利润（中位）</span>
        <span className="tabular font-display text-[17px] font-semibold text-ink-900">
          {moneyInt(candidate.sim.p50Cents)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-ink-400">最差 10% 的情况</span>
        <span className="tabular text-[12.5px] font-medium text-ink-600">{moneyInt(candidate.sim.p10Cents)}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-ink-400">30 天缺货天数</span>
        <span
          className={cn(
            "tabular text-[12.5px] font-medium",
            candidate.sim.stockoutDays === 0 ? "text-jade-600" : "text-ochre-500",
          )}
        >
          {candidate.sim.stockoutDays} 天
        </span>
      </div>

      <div className="mt-auto border-t border-paper-200 pt-2">
        {risks.length === 0 ? (
          <div className="flex items-center gap-1 text-[11.5px] text-jade-600">
            <Check className="h-3 w-3" strokeWidth={3} /> 风控没发现硬伤
          </div>
        ) : (
          <div className="flex items-start gap-1 text-[11.5px] leading-snug text-ochre-500">
            <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" />
            <span className="line-clamp-2">{risks[0]}</span>
          </div>
        )}
      </div>
    </button>
  );
}