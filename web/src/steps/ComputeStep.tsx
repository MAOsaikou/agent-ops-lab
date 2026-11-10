import { ArrowRight, FastForward } from "lucide-react";
import { useEffect } from "react";

import type { PlanResult } from "../../../src/templates/pricing/model.js";
import { AgentCards, TraceList } from "../components/AgentTrace.js";
import { ActionButton, Metric, Panel, PanelHead, Pill } from "../components/Primitives.js";
import { money, moneyInt, num, pct } from "../lib/format.js";

export function ComputeStep({
  plan,
  played,
  onPlayed,
  onNext,
}: {
  readonly plan: PlanResult;
  readonly played: number;
  readonly onPlayed: (count: number) => void;
  readonly onNext: () => void;
}): React.JSX.Element {
  const total = plan.trace.length;

  useEffect(() => {
    if (played >= total) {
      return;
    }
    const timer = window.setTimeout(() => {
      onPlayed(played + 1);
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [played, total, onPlayed]);

  const progress = Math.round((Math.min(played, total) / total) * 100);
  const done = played >= total;
  const recommended = plan.candidates.find((candidate) => candidate.id === plan.recommendedId);

  return (
    <div className="flex flex-col gap-3">
      <Panel className="rise overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-ink-900">
                {done ? "核算完了" : "四个角色正在分工算"}
              </span>
              <Pill tone={done ? "jade" : "seal"}>{progress}%</Pill>
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-500">
              {done
                ? `一共 ${String(total)} 步，每一步都有指纹，改一个数字就换一份方案。`
                : "成本会计先拆成本，定价参谋出三套价，风控跑 30 天推演，文案手写标题卖点。"}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {done ? null : (
              <ActionButton
                variant="ghost"
                size="sm"
                onClick={() => {
                  onPlayed(total);
                }}
              >
                <FastForward className="h-3.5 w-3.5" />
                跳过动画
              </ActionButton>
            )}
            <ActionButton onClick={onNext} disabled={!done} size="md">
              看三套方案
              <ArrowRight className="h-4 w-4" />
            </ActionButton>
          </div>
        </div>
        <div className="h-1 w-full bg-paper-200">
          <div
            className="h-full bg-seal-500 transition-[width] duration-300 ease-out"
            style={{ width: `${String(progress)}%` }}
          />
        </div>
      </Panel>

      <AgentCards steps={plan.trace} played={played} />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel className="rise" style={{ "--i": 1 } as React.CSSProperties}>
          <PanelHead title="每一步在算什么" desc="指纹是这一步的哈希，用来核对结果没被改过。" />
          <div className="px-4 py-3.5">
            <TraceList steps={plan.trace} played={played} />
          </div>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel className="rise" style={{ "--i": 2 } as React.CSSProperties}>
            <PanelHead title="推出来的结果" />
            <div className="grid grid-cols-2 gap-3 px-4 py-3.5">
              <Metric
                label="推荐价"
                value={done && recommended !== undefined ? money(recommended.priceCents) : "—"}
                tone="seal"
                size="lg"
              />
              <Metric
                label="毛利率"
                value={done && recommended !== undefined ? pct(recommended.evaluation.daily.margin) : "—"}
                size="md"
              />
              <Metric
                label="日均单量"
                value={done && recommended !== undefined ? num(recommended.evaluation.daily.orders, 0) : "—"}
                size="md"
              />
              <Metric
                label="30 天利润"
                value={done && recommended !== undefined ? moneyInt(recommended.sim.p50Cents) : "—"}
                hint="中位情况"
                size="md"
              />
            </div>
          </Panel>

          {done && recommended !== undefined ? (
            <Panel className="rise" style={{ "--i": 3 } as React.CSSProperties}>
              <PanelHead title="这套价的底细" desc={recommended.verdict} />
              <div className="grid grid-cols-2 gap-3 px-4 py-3.5">
                <Metric
                  label="保本价"
                  value={money(recommended.evaluation.breakEvenCents)}
                  hint="低于它就亏"
                  tone="seal"
                  size="sm"
                />
                <Metric
                  label="一件成本"
                  value={money(recommended.evaluation.unit.totalCents)}
                  hint="含退货摊销"
                  size="sm"
                />
                <Metric
                  label="推广摊销/单"
                  value={money(recommended.evaluation.daily.adPerOrderCents)}
                  size="sm"
                />
                <Metric
                  label="单件净利"
                  value={money(recommended.evaluation.daily.netPerOrderCents)}
                  tone="jade"
                  size="sm"
                />
              </div>
            </Panel>
          ) : null}

          {plan.revisions.length === 0 ? null : (
            <Panel className="rise border-ochre-500/30 bg-ochre-100/40">
              <div className="px-4 py-3">
                <div className="text-[12px] font-semibold text-ochre-500">风控退回过一次</div>
                <ul className="mt-1 flex flex-col gap-1">
                  {plan.revisions.map((revision) => (
                    <li key={revision.attempt} className="text-[11.5px] leading-relaxed text-ink-600">
                      {revision.reason} → {revision.change}
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}