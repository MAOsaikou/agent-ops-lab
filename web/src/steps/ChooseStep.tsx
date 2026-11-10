import { ArrowRight, Lock } from "lucide-react";
import { Suspense, lazy } from "react";

import type { CandidateId, PlanResult } from "../../../src/templates/pricing/model.js";
import { CandidateCard } from "../components/CandidateCard.js";
import { ChecksList } from "../components/ChecksList.js";
import { CostBreakdown } from "../components/CostBreakdown.js";

import { ActionButton, Metric, Panel, PanelHead, Pill, StickyAction } from "../components/Primitives.js";
import { SealStamp } from "../components/SealStamp.js";
import { money, moneyInt, pct } from "../lib/format.js";

const ProfitCurve = lazy(async () => {
  const module = await import("../components/ProfitCurve.js");
  return { default: module.ProfitCurve };
});

export function ChooseStep({
  plan,
  selectedId,
  onSelect,
  onLock,
  locking,
  error,
  onNext,
}: {
  readonly plan: PlanResult;
  readonly selectedId: CandidateId;
  readonly onSelect: (id: CandidateId) => void;
  readonly onLock: () => void;
  readonly locking: boolean;
  readonly error: string | null;
  readonly onNext: () => void;
}): React.JSX.Element {
  const selected =
    plan.candidates.find((candidate) => candidate.id === selectedId) ?? plan.candidates[0];
  const locked = plan.locked;
  if (selected === undefined) {
    return <Panel>方案数据缺失，请重新核算。</Panel>;
  }
  const lockedCandidate = plan.candidates.find((candidate) => candidate.id === locked?.candidateId);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {plan.candidates.map((candidate, index) => (
          <div key={candidate.id} className="rise" style={{ "--i": index } as React.CSSProperties}>
            <CandidateCard
              candidate={candidate}
              recommended={candidate.id === plan.recommendedId}
              selected={candidate.id === selectedId}
              disabled={locked !== null}
              onSelect={() => {
                onSelect(candidate.id);
              }}
            />
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3">
          <Panel className="rise">
            <PanelHead
              title={`「${selected.label}」卖 ${money(selected.priceCents)} 会发生什么`}
              desc={`30 天推演：每天下单量随机波动 ±28%，按 ${String(plan.input.settleDays)} 天账期回款。柱子是当天利润，绿线是累计利润。`}
              right={<Pill tone="plain">跑 200 次</Pill>}
            />
            <div className="px-2 pb-1 pt-3">
              <Suspense fallback={<div className="h-[200px] shimmer rounded-lg" />}>
                <ProfitCurve sim={selected.sim} />
              </Suspense>
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-paper-200 px-4 py-3">
              <Metric label="最差 10%" value={moneyInt(selected.sim.p10Cents)} hint="别只看好的那天" size="sm" />
              <Metric label="中位" value={moneyInt(selected.sim.p50Cents)} size="sm" />
              <Metric label="最好 10%" value={moneyInt(selected.sim.p90Cents)} size="sm" />
              <Metric label="30 天卖出" value={`${String(selected.sim.totalOrders)} 单`} size="sm" />
              <Metric
                label="最低现金"
                value={moneyInt(selected.sim.minCashCents)}
                hint={selected.sim.stockoutDays > 0 ? `${String(selected.sim.stockoutDays)} 天备货不足` : "没断过货"}
                size="sm"
                tone={selected.sim.stockoutDays > 0 ? "ochre" : "jade"}
              />
              <Metric label="月末应收" value={moneyInt(selected.sim.receivableCents)} hint="平台还没打过来" size="sm" />
            </div>
          </Panel>

          <Panel className="rise" style={{ "--i": 1 } as React.CSSProperties}>
            <PanelHead
              title="这一单的钱花在哪"
              desc={`售价 ${money(selected.priceCents)} 拆开看，绿色那块才是你的。`}
            />
            <div className="px-4 py-3.5">
              <CostBreakdown evaluation={selected.evaluation} />
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-3">
          <Panel className="rise" style={{ "--i": 2 } as React.CSSProperties}>
            <PanelHead title="风控逐项检查" desc="不通过的地方会写在下面，别忽略。" />
            <div className="px-4 py-3.5">
              <ChecksList rows={selected.checks} />
            </div>
          </Panel>

          <Panel className="rise" style={{ "--i": 3 } as React.CSSProperties}>
            <div className="flex flex-col gap-2.5 px-4 py-3.5">
              {locked === null ? (
                <>
                  <div className="text-[12.5px] leading-relaxed text-ink-600">
                    定下来就锁定：锁定后这一版方案不能改，要改价请重新核算。
                  </div>
                  <ActionButton size="lg" onClick={onLock} disabled={locking} className="w-full">
                    <Lock className="h-4 w-4" />
                    {locking ? "正在锁定…" : `锁定 ${money(selected.priceCents)}`}
                  </ActionButton>
                  {error === null ? null : (
                    <p className="rounded-lg bg-seal-100/70 px-2.5 py-2 text-[11.5px] text-seal-600">{error}</p>
                  )}
                </>
              ) : (
                <>
                  <SealStamp
                    hash={locked.hash}
                    at={locked.at}
                    label={`${lockedCandidate?.label ?? selected.label} · ${money(
                      lockedCandidate?.priceCents ?? selected.priceCents,
                    )}`}
                  />
                  <ActionButton size="lg" variant="jade" onClick={onNext} className="w-full">
                    去复制上架
                    <ArrowRight className="h-4 w-4" />
                  </ActionButton>
                  <p className="text-[11px] leading-relaxed text-ink-400">
                    这一版已存档，随时能在「算过的方案」里翻回来。
                  </p>
                </>
              )}
            </div>
          </Panel>

          {plan.revisions.length === 0 ? null : (
            <Panel className="rise border-ochre-500/30 bg-ochre-100/40">
              <div className="px-4 py-3">
                <div className="text-[12px] font-semibold text-ochre-500">核算时被退回过</div>
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

          <Panel className="rise">
            <PanelHead title="这套价怎么来的" desc={`毛利率 ${pct(selected.evaluation.daily.margin)}`} />
            <div className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-600">
              {selected.verdict}
            </div>
          </Panel>
        </div>
      </div>

      <StickyAction
        label={locked === null ? "选好了就锁定" : "已锁定，可以抄去上架"}
        hint={`${selected.label} · ${money(selected.priceCents)}`}
      >
        {locked === null ? (
          <ActionButton onClick={onLock} disabled={locking}>
            <Lock className="h-4 w-4" />
            {locking ? "正在锁定…" : "锁定这个价"}
          </ActionButton>
        ) : (
          <ActionButton variant="jade" onClick={onNext}>
            去复制上架
            <ArrowRight className="h-4 w-4" />
          </ActionButton>
        )}
      </StickyAction>
    </div>
  );
}