import {
  AlertTriangle,
  BookOpenCheck,
  Bot,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  Gavel,
  History,
  Layers3,
  Play,
  RotateCcw,
  Scale,
  Settings2,
  Sparkles,
  StepForward,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AgentRun,
  LoopAction,
  LoopIteration,
  RunEvent,
  RunStatus,
  RunSummary,
  VerificationStatus,
} from "../../../src/templates/agentops/types.js";
import type { Candidate, CandidateId } from "../../../src/templates/pricing/model.js";
import {
  fetchAgentCatalog,
  fetchAgentRun,
  fetchAgentRuns,
  fetchLlmSettings,
  streamAgentTask,
  submitRunDecision,
  type AgentCatalog,
  type LlmSettingsView,
} from "../lib/agentops.js";
import { cn } from "../lib/cn.js";
import { money, moneyInt, num, pct, shortHash } from "../lib/format.js";
import { CandidateCard } from "./CandidateCard.js";
import { ChecksList } from "./ChecksList.js";
import { CopyBlock } from "./CopyBlock.js";
import { CostBreakdown } from "./CostBreakdown.js";
import { ModelSettingsPanel } from "./ModelSettings.js";
import { ActionButton, Panel, PanelHead, Pill, type PillTone } from "./Primitives.js";
import { ProfitCurve } from "./ProfitCurve.js";
import { SealStamp } from "./SealStamp.js";

const VERIFICATION_META: Record<
  VerificationStatus,
  { readonly label: string; readonly tone: PillTone }
> = {
  pass: { label: "通过", tone: "jade" },
  warn: { label: "待确认", tone: "ochre" },
  fail: { label: "需修正", tone: "seal" },
};

const RUN_STATUS_META: Record<
  RunStatus,
  { readonly label: string; readonly tone: PillTone; readonly summary: string }
> = {
  running: {
    label: "会签进行中",
    tone: "ochre",
    summary: "各角色正在按依赖核算并写入实时事件链",
  },
  "awaiting-approval": {
    label: "待掌柜拍板",
    tone: "seal",
    summary: "前序核算、风控与修正已就绪，等待掌柜选定策略并拍板通过或驳回",
  },
  completed: {
    label: "已拍板封存",
    tone: "jade",
    summary: "上架评审已通过最终一致性校验并生成封存指纹",
  },
  rejected: {
    label: "已驳回封存",
    tone: "seal",
    summary: "掌柜已驳回本次上架方案，不生成通过报告，事件链已封存",
  },
};

const STRATEGY_LABELS: Readonly<Record<string, string>> = {
  profit: "稳价 · 保目标毛利",
  match: "跟价 · 对齐竞品",
  volume: "冲量 · 压价抢单",
};

const LOOP_ACTION_LABELS: Readonly<Record<LoopAction, string>> = {
  "ad-budget": "下调日推广预算（削减单均推广分摊）",
  "promo-discount": "上调活动折扣率（守住保本红线）",
  "switch-candidate": "收紧推荐策略（改善毛利与备货周期）",
};

type ScenarioPreset = {
  readonly id: string;
  readonly label: string;
  readonly badge: string;
  readonly text: string;
};

const SCENARIO_PRESETS: readonly ScenarioPreset[] = [
  {
    id: "pdd-evidence-boundary",
    label: "场景 1：拼多多短袖（证据与备货边界）",
    badge: "0 轮经济修正 · 留待掌柜拍板",
    text: "分析这个拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。分享文案：纯棉短袖女夏季宽松，券后 ¥39.90，已拼 10 万+，包邮、七天无理由。采购 16 元，包材 1.5 元，快递 6.5 元，目标毛利 25%，可周转资金 300 元。",
  },
  {
    id: "jd-pillow-2loops",
    label: "场景 2：京东护颈枕（推广超标 2 轮修正）",
    badge: "触发 2 轮定向降预算",
    text: "评估护颈枕价格与现金流。京东价 ¥89，竞品日单量约 50，采购 18 元，包装 2 元，快递 7 元，平台费率按默认，目标毛利 30%，预算 500 元。",
  },
  {
    id: "pdd-ad-converge",
    label: "场景 3：拼多多短袖（推广冲突 1 轮收敛）",
    badge: "1 轮修正后经济项全过",
    text: "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。商品名：纯棉短袖，券后价 ¥39.90。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 15，目标毛利 25%，推广预算 220 元，可周转资金 5000 元。",
  },
  {
    id: "pdd-promo-floor",
    label: "场景 4：加厚收纳箱（活动破保本修正）",
    badge: "1 轮上调活动折扣守保本",
    text: "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。商品名：加厚收纳箱，售价 ¥38.90。采购价 25 元，包材 2 元，快递 6 元，竞品主流价 38.90 元，日单量 60，目标毛利 5%，推广预算 10 元，可周转资金 5000 元。",
  },
];

function strategyName(id: string | null | undefined): string {
  if (!id) return "待定";
  return STRATEGY_LABELS[id] ?? id;
}

function isCandidateId(value: string | null | undefined): value is CandidateId {
  return value === "profit" || value === "match" || value === "volume";
}

function llmBadgeMeta(
  runLlm: AgentRun["llm"] | null,
  settings: LlmSettingsView | null,
): { readonly label: string; readonly tone: PillTone; readonly detail: string } {
  if (runLlm !== null) {
    if (runLlm.mode === "live") {
      return {
        label: `模型已启用 · ${runLlm.model ?? "LLM"}`,
        tone: "jade",
        detail: runLlm.note,
      };
    }
    if (runLlm.mode === "fallback") {
      return {
        label: `模型回退 · 规则兜底`,
        tone: "seal",
        detail: runLlm.note,
      };
    }
    return {
      label: "规则 Harness",
      tone: "ochre",
      detail: runLlm.note,
    };
  }
  if (settings?.active === true) {
    return {
      label: `模型已启用 · ${settings.model}`,
      tone: "jade",
      detail: settings.note,
    };
  }
  return {
    label: "规则 Harness",
    tone: "ochre",
    detail:
      settings?.note ??
      "未启用外部模型；当前调度、核算、风控与文案均由本地确定性规则 Harness 执行，绝不伪装成模型推理。",
  };
}

function CredentialLine({
  events,
  nodeId,
  run,
}: {
  readonly events: readonly RunEvent[];
  readonly nodeId: string;
  readonly run: AgentRun | null;
}): React.JSX.Element | null {
  const nodeEvents = events.filter((event) => event.nodeId === nodeId);
  if (nodeEvents.length === 0) return null;
  const lastEvent = nodeEvents.at(-1);
  const dispatches = run?.dispatches.filter((item) => item.nodeId === nodeId) ?? [];
  const latestDispatch = dispatches.at(-1);
  const agentSpec = run?.agents.find((agent) => agent.id === (latestDispatch?.chosen ?? lastEvent?.agentId));
  const winnerScore = latestDispatch?.candidates.find(
    (candidate) => candidate.agentId === latestDispatch.chosen,
  )?.score;

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-paper-200/80 pt-2 font-mono text-[10.5px] text-ink-400">
      <span>
        凭证：{agentSpec ? `${agentSpec.name} (v${agentSpec.version})` : (lastEvent?.agentId ?? nodeId)}
      </span>
      {winnerScore === undefined ? null : <span>调度分 {winnerScore}</span>}
      {dispatches.length > 1 ? <span>累计调度 {dispatches.length} 次</span> : null}
      {lastEvent === undefined ? null : (
        <span>
          事件 #{String(lastEvent.seq).padStart(2, "0")} · 链指纹 {shortHash(lastEvent.prevHash, 8)} →{" "}
          {shortHash(lastEvent.hash, 8)}
        </span>
      )}
    </div>
  );
}

function LoopComparisonSection({
  run,
  visibleEvents,
}: {
  readonly run: AgentRun | null;
  readonly visibleEvents: readonly RunEvent[];
}): React.JSX.Element {
  const loops = run?.loops ?? [];
  const loopEvents = visibleEvents.filter(
    (event) => event.type === "loop.iteration" || event.type === "loop.adjusted",
  );
  const failRows = run?.artifacts.risk?.rows.filter((row) => row.status === "fail") ?? [];

  return (
    <div
      data-testid="loop-comparison"
      className="rounded-xl border border-paper-300 bg-paper-100/70 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-ochre-500" />
          <span className="font-display text-[15px] font-semibold text-ink-900">
            五、修正前后对比（Self-Loop 协商台账）
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={loops.length > 0 ? "ochre" : "ink"}>
            已执行 {loops.length} / 2 轮额外经济修正
          </Pill>
        </div>
      </div>

      {run === null ? (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
          启动上架评审后，若独立风控发现「推广占比超 20%」「活动折后价跌破保本价」或「推荐策略毛利/备货天数不达标」，此处将逐轮记录修正前后的报价、毛利率、30 天最差利润（p10）与风控项变化。
        </p>
      ) : loops.length === 0 ? (
        <div className="mt-2.5 rounded-lg border border-paper-300/80 bg-paper-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-700">
          {failRows.length > 0 ? (
            <div>
              <div className="font-medium text-ink-900">
                本轮触发 0 次经济参数循环（不空转砍推广预算）
              </div>
              <p className="mt-1 text-ink-600">
                当前未通过项为「{failRows.map((row) => row.title).join("、")}」。
                其中证据缺失需人工核实货源与链接，或当前已是最高毛利的「稳价」方案而周转金仍不足以覆盖 30 天备货；此类问题无法靠盲目削减推广费解决，系统如实保留失败结论并移交掌柜拍板。
              </p>
            </div>
          ) : (
            <div>
              <div className="font-medium text-jade-600">
                首轮核算已满足全部刚性经济红线（0 轮修正）
              </div>
              <p className="mt-1 text-ink-600">
                成本保本价、目标毛利、推广占比与活动折扣均在首轮通过风控复核，无需触发额外修正循环。
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {loops.map((loop: LoopIteration) => {
            const actionLabel =
              loop.action !== undefined ? LOOP_ACTION_LABELS[loop.action] : "定向参数修正";
            const resolvedFails = loop.before.failTitles.filter(
              (title) => !loop.after.failTitles.includes(title),
            );
            return (
              <div
                key={loop.iteration}
                data-testid={`loop-round-${String(loop.iteration - 1)}`}
                className="rounded-xl border border-paper-300 bg-paper-50 p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-paper-200 pb-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-5 items-center rounded-md bg-ink-900 px-2 font-mono text-[11px] font-semibold text-paper-50">
                      第 {loop.iteration - 1} 轮修正（总第 {loop.iteration} 轮核算）
                    </span>
                    <span className="text-[13px] font-semibold text-ink-900">{actionLabel}</span>
                  </div>
                  <Pill tone="ochre">{loop.role}</Pill>
                </div>

                {loop.adjustment === null ? null : (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-700">
                    {loop.adjustment}
                  </p>
                )}

                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[540px] border-collapse text-left text-[12px]">
                    <thead>
                      <tr className="border-b border-paper-200 text-[11px] text-ink-500">
                        <th className="py-1.5 pr-3 font-medium">核算指标</th>
                        <th className="py-1.5 px-3 font-medium">修正前（第 {loop.iteration - 1} 轮）</th>
                        <th className="py-1.5 px-3 font-medium">修正后（第 {loop.iteration} 轮）</th>
                        <th className="py-1.5 pl-3 font-medium">协商变化</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-paper-200/70 tabular">
                      <tr>
                        <td className="py-1.5 pr-3 text-ink-600">主推策略</td>
                        <td className="py-1.5 px-3 text-ink-700">{strategyName(loop.before.chosenId)}</td>
                        <td className="py-1.5 px-3 font-semibold text-ink-900">
                          {strategyName(loop.after.chosenId)}
                        </td>
                        <td className="py-1.5 pl-3 text-ink-500">
                          {loop.before.chosenId === loop.after.chosenId
                            ? "保持策略不变"
                            : "切换至更稳健档位"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-ink-600">日常售价 / 活动价</td>
                        <td className="py-1.5 px-3 text-ink-700">
                          {money(loop.before.priceCents)} / 活动 {money(loop.before.promoPriceCents)}
                        </td>
                        <td className="py-1.5 px-3 font-semibold text-ink-900">
                          {money(loop.after.priceCents)} / 活动 {money(loop.after.promoPriceCents)}
                        </td>
                        <td className="py-1.5 pl-3 text-ink-600">
                          折扣 {pct(loop.before.promoDiscount, 0)} → {pct(loop.after.promoDiscount, 0)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-ink-600">日推广预算</td>
                        <td className="py-1.5 px-3 text-ink-700">
                          {money(loop.before.adDailyBudgetCents)}/天
                        </td>
                        <td className="py-1.5 px-3 font-semibold text-ink-900">
                          {money(loop.after.adDailyBudgetCents)}/天
                        </td>
                        <td className="py-1.5 pl-3 text-jade-600">
                          {loop.after.adDailyBudgetCents < loop.before.adDailyBudgetCents
                            ? `下调 ${money(loop.before.adDailyBudgetCents - loop.after.adDailyBudgetCents)}/天`
                            : "预算未变"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-ink-600">预计毛利率</td>
                        <td className="py-1.5 px-3 text-ink-700">{pct(loop.before.margin)}</td>
                        <td className="py-1.5 px-3 font-semibold text-ink-900">
                          {pct(loop.after.margin)}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 pl-3 font-medium",
                            loop.after.margin >= loop.before.margin ? "text-jade-600" : "text-seal-600",
                          )}
                        >
                          {loop.after.margin >= loop.before.margin ? "+" : ""}
                          {pct(loop.after.margin - loop.before.margin)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-ink-600">30 天最差 10% 利润 (p10)</td>
                        <td className="py-1.5 px-3 text-ink-700">{moneyInt(loop.before.p10Cents)}</td>
                        <td className="py-1.5 px-3 font-semibold text-ink-900">
                          {moneyInt(loop.after.p10Cents)}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 pl-3 font-medium",
                            loop.after.p10Cents >= loop.before.p10Cents
                              ? "text-jade-600"
                              : "text-ochre-500",
                          )}
                        >
                          {loop.after.p10Cents >= loop.before.p10Cents ? "改善 " : "变动 "}
                          {moneyInt(loop.after.p10Cents - loop.before.p10Cents)}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-ink-600">30 天缺货天数</td>
                        <td className="py-1.5 px-3 text-ink-700">{loop.before.stockoutDays} 天</td>
                        <td className="py-1.5 px-3 font-semibold text-ink-900">
                          {loop.after.stockoutDays} 天
                        </td>
                        <td className="py-1.5 pl-3 text-ink-600">
                          {loop.after.stockoutDays < loop.before.stockoutDays
                            ? `减少 ${String(loop.before.stockoutDays - loop.after.stockoutDays)} 天`
                            : "备货约束不变"}
                        </td>
                      </tr>
                      <tr>
                        <td className="py-1.5 pr-3 text-ink-600">风控未通过项</td>
                        <td className="py-1.5 px-3 text-seal-600">
                          {loop.before.failTitles.length > 0
                            ? loop.before.failTitles.join("、")
                            : "无"}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 px-3 font-medium",
                            loop.after.failTitles.length === 0 ? "text-jade-600" : "text-ochre-500",
                          )}
                        >
                          {loop.after.failTitles.length > 0
                            ? loop.after.failTitles.join("、")
                            : "全部消除"}
                        </td>
                        <td className="py-1.5 pl-3 text-jade-600">
                          {resolvedFails.length > 0
                            ? `已解决：${resolvedFails.join("、")}`
                            : "仍需下轮或人工拍板"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {loopEvents.length > 0 ? (
        <CredentialLine events={visibleEvents} nodeId="adjust-loop" run={run} />
      ) : null}
    </div>
  );
}

export function AgentOpsConsole(): React.JSX.Element {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [runs, setRuns] = useState<readonly RunSummary[]>([]);
  const [task, setTask] = useState<string>(SCENARIO_PRESETS[0]?.text ?? "");
  const [requireApproval, setRequireApproval] = useState<boolean>(true);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [streamEvents, setStreamEvents] = useState<readonly RunEvent[]>([]);
  const [busy, setBusy] = useState<boolean>(false);
  const [decisionBusy, setDecisionBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<CandidateId | null>(null);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [llm, setLlm] = useState<LlmSettingsView | null>(null);

  const [openedFromHistory, setOpenedFromHistory] = useState<boolean>(false);
  const [replayCount, setReplayCount] = useState<number | null>(null);
  const [replayAnimating, setReplayAnimating] = useState<boolean>(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    void fetchAgentCatalog()
      .then(setCatalog)
      .catch((caught: unknown) => {
        const reason = caught instanceof Error ? caught.message : "平台连接失败";
        setError(`${reason}。请确认后端服务已启动（pnpm dev）。`);
      });
    void fetchAgentRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
    void fetchLlmSettings()
      .then(setLlm)
      .catch(() => setLlm(null));
  }, []);

  useEffect(() => {
    if (run === null) {
      setSelectedCandidateId(null);
      return;
    }
    const preferred = run.decidedCandidateId ?? run.artifacts.chosenId;
    if (isCandidateId(preferred)) {
      setSelectedCandidateId(preferred);
    } else {
      const firstId = run.artifacts.candidates?.[0]?.id;
      if (firstId !== undefined) {
        setSelectedCandidateId(firstId);
      }
    }
  }, [run?.id, run?.artifacts.chosenId, run?.decidedCandidateId]);

  useEffect(() => {
    if (!replayAnimating || run === null) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const total = run.events.length;
    let frameTick = 0;
    const step = (): void => {
      frameTick += 1;
      if (frameTick % 4 === 0) {
        setReplayCount((prev) => {
          const next = (prev ?? 0) + 1;
          if (next >= total) {
            setReplayAnimating(false);
            return total;
          }
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [replayAnimating, run]);

  const startRun = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setOpenedFromHistory(false);
    setReplayCount(null);
    setReplayAnimating(false);
    setStreamEvents([]);
    setRun(null);

    try {
      const autoApprove = !requireApproval;
      const completedOrPaused = await streamAgentTask(
        { task, autoApprove },
        (incomingEvent) => {
          setStreamEvents((prev) => [...prev, incomingEvent]);
        },
      );
      setRun(completedOrPaused);
      setStreamEvents(completedOrPaused.events);
      const latestRuns = await fetchAgentRuns().catch(() => []);
      setRuns(latestRuns);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "上架评审运行失败");
    } finally {
      setBusy(false);
    }
  };

  const openRunFromHistory = async (id: string): Promise<void> => {
    setError(null);
    setReplayAnimating(false);
    setReplayCount(null);
    try {
      const loaded = await fetchAgentRun(id);
      setRun(loaded);
      setStreamEvents(loaded.events);
      setOpenedFromHistory(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取历史评审卷宗失败");
    }
  };

  const handleDecision = async (action: "approve" | "reject"): Promise<void> => {
    if (run === null || run.status !== "awaiting-approval") return;
    setDecisionBusy(true);
    setError(null);
    try {
      const candidateId: CandidateId | undefined =
        action === "approve"
          ? (selectedCandidateId ??
            (isCandidateId(run.artifacts.chosenId) ? run.artifacts.chosenId : undefined))
          : undefined;
      const decisionInput =
        candidateId !== undefined ? { action, candidateId } : { action };
      const updated = await submitRunDecision(run.id, decisionInput);
      setRun(updated);
      setStreamEvents(updated.events);
      const latestRuns = await fetchAgentRuns().catch(() => []);
      setRuns(latestRuns);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "提交掌柜拍板决策失败");
    } finally {
      setDecisionBusy(false);
    }
  };

  const startSealedReplay = (): void => {
    if (run === null || run.events.length === 0) return;
    setOpenedFromHistory(true);
    setReplayCount(1);
    setReplayAnimating(true);
  };

  const stopSealedReplay = (): void => {
    setReplayAnimating(false);
    setReplayCount(null);
  };

  const visibleEvents: readonly RunEvent[] = useMemo(() => {
    if (run === null) return streamEvents;
    if (replayCount !== null) {
      return run.events.slice(0, replayCount);
    }
    return run.events;
  }, [run, streamEvents, replayCount]);

  const candidates: readonly Candidate[] = run?.artifacts.candidates ?? [];
  const activeCandidateId: CandidateId | null = useMemo(() => {
    if (selectedCandidateId !== null && candidates.some((c) => c.id === selectedCandidateId)) {
      return selectedCandidateId;
    }
    if (isCandidateId(run?.artifacts.chosenId)) {
      return run.artifacts.chosenId;
    }
    return candidates[0]?.id ?? null;
  }, [selectedCandidateId, candidates, run?.artifacts.chosenId]);

  const activeCandidate: Candidate | undefined = useMemo(
    () => candidates.find((c) => c.id === activeCandidateId) ?? candidates[0],
    [candidates, activeCandidateId],
  );

  const facts = run?.scheduler?.facts ?? null;
  const unit = run?.artifacts.unit ?? activeCandidate?.evaluation.unit ?? null;
  const breakEvenCents = run?.artifacts.breakEvenCents ?? activeCandidate?.evaluation.breakEvenCents ?? 0;
  const risk = run?.artifacts.risk ?? null;
  const currentStatus: RunStatus | "idle" = busy ? "running" : (run?.status ?? "idle");
  const statusMeta = currentStatus === "idle" ? null : RUN_STATUS_META[currentStatus];
  const llmMeta = llmBadgeMeta(run?.llm ?? null, llm);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-4 px-3 py-4 text-ink-900 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 px-5 py-3.5 shadow-card">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-seal-500/40 bg-seal-100/70 text-seal-600">
            <BookOpenCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-[20px] font-semibold tracking-tight text-ink-900">
                商品上架评审会签台
              </h1>
              <span
                data-testid="status"
                data-status={currentStatus}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset",
                  statusMeta === null
                    ? "bg-paper-150 text-ink-600 ring-ink-900/10"
                    : statusMeta.tone === "jade"
                      ? "bg-jade-100 text-jade-600 ring-jade-500/30"
                      : statusMeta.tone === "ochre"
                        ? "bg-ochre-100 text-ochre-500 ring-ochre-500/30"
                        : "bg-seal-100 text-seal-600 ring-seal-500/30",
                )}
              >
                {statusMeta === null ? "待立项评审" : statusMeta.label}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-500">
              商品证据提取、成本保本价核算、三套策略现金流推演、独立风控与修正前后对比、掌柜最终拍板
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span data-testid="llm-mode-badge">
            <Pill tone={llmMeta.tone}>{llmMeta.label}</Pill>
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-paper-100 px-3 py-1.5 text-[12px] font-medium text-ink-700 ring-1 ring-inset ring-paper-300 transition-colors hover:bg-paper-150"
          >
            <Settings2 className="h-3.5 w-3.5" />
            模型配置
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <ModelSettingsPanel onClose={() => setSettingsOpen(false)} onChanged={setLlm} />
      ) : null}

      <Panel>
        <PanelHead
          title="立项委托与拍板门设置"
          desc="粘贴商品链接、分享文案与进货成本底数。系统按角色会签核算，遇到推广超标、活动破保本或断货风险时自动协商修正（最多 2 轮额外重试）。"
          right={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="gate-toggle"
                aria-pressed={requireApproval}
                data-auto-approve={String(!requireApproval)}
                onClick={() => setRequireApproval((prev) => !prev)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-[12px] font-semibold ring-1 ring-inset transition-all",
                  requireApproval
                    ? "bg-seal-100 text-seal-600 ring-seal-500/40"
                    : "bg-paper-100 text-ink-700 ring-paper-300 hover:bg-paper-150",
                )}
              >
                <Gavel className="h-3.5 w-3.5" />
                {requireApproval
                  ? "需我拍板（autoApprove: false）"
                  : "演示自动放行（autoApprove: true）"}
              </button>
            </div>
          }
        />

        <div className="flex flex-col gap-3 px-5 py-4">
          <textarea
            data-testid="task-box"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            rows={3}
            className="w-full resize-y rounded-xl bg-paper-100/90 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-900 outline-none ring-1 ring-inset ring-paper-300 focus:bg-paper-50 focus:ring-2 focus:ring-seal-500/45"
            placeholder="输入商品链接、分享文案、采购价、包材、快递、目标毛利与可周转资金…"
          />

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {SCENARIO_PRESETS.map((preset, index) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`scenario-${String(index + 1)}`}
                  onClick={() => setTask(preset.text)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] ring-1 ring-inset transition-colors",
                    task === preset.text
                      ? "bg-ink-900 text-paper-50 ring-ink-900"
                      : "bg-paper-100 text-ink-700 ring-paper-300 hover:bg-paper-150",
                  )}
                >
                  <span className="font-medium">{preset.label}</span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px]",
                      task === preset.text ? "bg-paper-50/15 text-paper-100" : "bg-paper-200 text-ink-600",
                    )}
                  >
                    {preset.badge}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2.5">
              <span className="text-[11px] text-ink-400">
                注：控制台默认停在「需我拍板」；裸调 API 未传 autoApprove 时默认 true 保持兼容
              </span>
              <ActionButton
                data-testid="run-button"
                onClick={() => {
                  void startRun();
                }}
                disabled={busy || task.trim().length < 8}
              >
                <Play className="h-3.5 w-3.5" />
                {busy ? "会签核算中…" : "开始上架评审"}
              </ActionButton>
            </div>
          </div>

          {error === null ? null : (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-seal-500/30 bg-seal-100/80 px-3.5 py-2.5 text-[12.5px] text-seal-600"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel data-testid="live-ledger">
            <PanelHead
              title={
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-display text-[17px] font-semibold text-ink-900">
                    上架评审会签台账
                  </span>
                  {run === null ? null : (
                    <span className="font-mono text-[11px] font-normal text-ink-400">
                      卷宗号 {run.id} · 指纹 {shortHash(run.fingerprint, 12)}
                    </span>
                  )}
                </div>
              }
              desc={
                statusMeta === null
                  ? "按「商品研究 → 成本保本价 → 三套策略模拟 → 独立风控会签 → 修正前后对比 → 上架文案 → 掌柜拍板」逐节记录业务产出与交接约束"
                  : statusMeta.summary
              }
              right={
                <div className="flex flex-wrap items-center gap-2">
                  {run !== null && openedFromHistory ? (
                    <Pill tone="ink">已封存历史卷宗</Pill>
                  ) : null}
                  {run !== null ? (
                    replayCount === null ? (
                      <button
                        type="button"
                        data-testid="replay-sealed-button"
                        onClick={startSealedReplay}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-paper-100 px-2.5 py-1 text-[11.5px] font-medium text-ink-700 ring-1 ring-inset ring-paper-300 hover:bg-paper-150"
                      >
                        <History className="h-3.5 w-3.5" />
                        回放已封存事件
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg bg-ochre-100 px-2.5 py-1 text-[11.5px] text-ochre-500 ring-1 ring-inset ring-ochre-500/30">
                        <span className="font-medium">
                          已封存事件回放（非实时工作）：{replayCount} / {run.events.length}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setReplayCount((prev) =>
                              Math.min(run.events.length, (prev ?? 1) + 1),
                            )
                          }
                          className="rounded bg-paper-50 px-1.5 py-0.5 text-[10.5px] text-ink-800 ring-1 ring-paper-300"
                        >
                          <StepForward className="inline h-3 w-3" /> 下一条
                        </button>
                        <button
                          type="button"
                          onClick={stopSealedReplay}
                          className="rounded bg-ink-900 px-1.5 py-0.5 text-[10.5px] text-paper-50"
                        >
                          展开全部
                        </button>
                      </div>
                    )
                  ) : null}
                </div>
              }
            />

            <div className="flex flex-col gap-3.5 p-5">
              <div className="grid gap-3.5 lg:grid-cols-2">
                <div className="rounded-xl border border-paper-300 bg-paper-100/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[14.5px] font-semibold text-ink-900">
                      一、商品证据与待确认项（商品研究员）
                    </span>
                    <Pill tone={facts !== null && facts.questions.length > 0 ? "ochre" : "jade"}>
                      {facts === null
                        ? "待提取"
                        : facts.questions.length > 0
                          ? `${String(facts.questions.length)} 项待确认`
                          : "字段齐备"}
                    </Pill>
                  </div>

                  {run === null ? (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
                      正在等待或读取链接与分享文案中的平台、商品名、参考价、承诺服务及证据摘录。
                    </p>
                  ) : (
                    <div className="mt-2.5 flex flex-col gap-2.5 text-[12.5px]">
                      <div className="rounded-lg bg-paper-50 px-3 py-2 text-ink-800 ring-1 ring-inset ring-paper-200">
                        <span className="font-medium">识别摘要：</span>
                        {facts?.headline ?? `${run.artifacts.product?.name ?? "待确认商品"}（${run.artifacts.product?.platform ?? "未知平台"}）`}
                      </div>

                      {facts !== null && facts.fields.length > 0 ? (
                        <div className="grid grid-cols-2 gap-1.5">
                          {facts.fields.map((field) => (
                            <div
                              key={field.id}
                              className="rounded-lg border border-paper-200 bg-paper-50 px-2.5 py-1.5"
                            >
                              <div className="flex items-center justify-between text-[11px] text-ink-500">
                                <span>{field.label}</span>
                                <span
                                  className={cn(
                                    "font-medium",
                                    field.needsConfirm ? "text-ochre-500" : "text-jade-600",
                                  )}
                                >
                                  {field.needsConfirm ? "待确认" : "有据"}
                                </span>
                              </div>
                              <div className="mt-0.5 truncate font-medium text-ink-900">
                                {field.display}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {facts !== null && facts.questions.length > 0 ? (
                        <div className="rounded-lg border border-ochre-500/30 bg-ochre-100/50 px-3 py-2">
                          <div className="text-[11.5px] font-semibold text-ochre-500">
                            留存待确认问题（不把短链或缺失字段伪装成已抓取事实）：
                          </div>
                          <ul className="mt-1 list-disc space-y-1 pl-4 text-[11.5px] text-ink-700">
                            {facts.questions.map((question) => (
                              <li key={question.id}>
                                <span className="font-medium text-ink-900">{question.ask}</span>
                                <span className="text-ink-500">（{question.why}）</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  )}

                  <CredentialLine events={visibleEvents} nodeId="research" run={run} />
                </div>

                <div className="rounded-xl border border-paper-300 bg-paper-100/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[14.5px] font-semibold text-ink-900">
                      二、成本核算与保本红线（成本会计）
                    </span>
                    <Pill tone={breakEvenCents > 0 ? "seal" : "ink"}>
                      {breakEvenCents > 0 ? `保本红线 ${money(breakEvenCents)}` : "待核算"}
                    </Pill>
                  </div>

                  {unit === null || breakEvenCents <= 0 ? (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
                      按采购价、包材、快递、平台佣金、支付费率及退货损耗独立计算单件总成本与保本底价。
                    </p>
                  ) : (
                    <div className="mt-2.5 flex flex-col gap-2.5">
                      <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-paper-300/80 bg-paper-50 p-3">
                        <div>
                          <div className="text-[11px] text-ink-500">核定单件成本</div>
                          <div className="tabular mt-0.5 font-display text-[24px] font-semibold leading-tight text-ink-900">
                            {money(unit.totalCents)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-400">含退货损耗与平台费率</div>
                        </div>
                        <div className="border-l border-paper-200 pl-3">
                          <div className="text-[11px] text-seal-600">刚性保本价（毛利 = 0）</div>
                          <div
                            data-testid="break-even-price"
                            className="tabular mt-0.5 font-display text-[24px] font-semibold leading-tight text-seal-600"
                          >
                            {money(breakEvenCents)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-500">
                            目标毛利 {pct(run?.artifacts.product?.targetMargin ?? 0.25, 0)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 text-[11.5px] tabular">
                        <div className="rounded-lg bg-paper-50 px-2.5 py-1.5 ring-1 ring-inset ring-paper-200">
                          <span className="text-ink-500">采购：</span>
                          <span className="font-medium text-ink-900">{money(unit.buyCents)}</span>
                        </div>
                        <div className="rounded-lg bg-paper-50 px-2.5 py-1.5 ring-1 ring-inset ring-paper-200">
                          <span className="text-ink-500">包材：</span>
                          <span className="font-medium text-ink-900">{money(unit.packagingCents)}</span>
                        </div>
                        <div className="rounded-lg bg-paper-50 px-2.5 py-1.5 ring-1 ring-inset ring-paper-200">
                          <span className="text-ink-500">快递：</span>
                          <span className="font-medium text-ink-900">{money(unit.shippingCents)}</span>
                        </div>
                        <div className="rounded-lg bg-paper-50 px-2.5 py-1.5 ring-1 ring-inset ring-paper-200">
                          <span className="text-ink-500">佣金：</span>
                          <span className="font-medium text-ink-900">{money(unit.commissionCents)}</span>
                        </div>
                        <div className="rounded-lg bg-paper-50 px-2.5 py-1.5 ring-1 ring-inset ring-paper-200">
                          <span className="text-ink-500">支付费：</span>
                          <span className="font-medium text-ink-900">{money(unit.payFeeCents)}</span>
                        </div>
                        <div className="rounded-lg bg-paper-50 px-2.5 py-1.5 ring-1 ring-inset ring-paper-200">
                          <span className="text-ink-500">退货摊销：</span>
                          <span className="font-medium text-ink-900">{money(unit.returnLossCents)}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  <CredentialLine events={visibleEvents} nodeId="account" run={run} />
                </div>
              </div>

              <div className="grid gap-3.5 lg:grid-cols-2">
                <div className="rounded-xl border border-paper-300 bg-paper-100/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[14.5px] font-semibold text-ink-900">
                      三、三套策略报价与模拟（市场分析师）
                    </span>
                    <Pill tone="jade">
                      {run?.artifacts.chosenId
                        ? `推荐：${strategyName(run.artifacts.chosenId)}`
                        : "待模拟"}
                    </Pill>
                  </div>

                  {run === null || run.artifacts.prices.length === 0 ? (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
                      消费上游保本价约束，生成「稳价 / 跟价 / 冲量」三套策略，并进行 30 天 × 200 次蒙特卡洛现金流推演。
                    </p>
                  ) : (
                    <div className="mt-2.5 flex flex-col gap-2">
                      <div className="grid grid-cols-3 gap-2">
                        {run.artifacts.prices.map((priceRow) => {
                          const fullCand = candidates.find((c) => c.id === priceRow.id);
                          const isChosen = priceRow.id === run.artifacts.chosenId;
                          return (
                            <div
                              key={priceRow.id}
                              className={cn(
                                "rounded-xl border p-2.5 tabular",
                                isChosen
                                  ? "border-seal-500 bg-seal-100/35"
                                  : "border-paper-300/80 bg-paper-50",
                              )}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[11.5px] font-semibold text-ink-900">
                                  {priceRow.label}
                                </span>
                                {isChosen ? <Pill tone="seal">推荐</Pill> : null}
                              </div>
                              <div className="mt-1 font-display text-[19px] font-semibold text-ink-900">
                                {money(priceRow.priceCents)}
                              </div>
                              <div className="mt-1 text-[11px] text-ink-600">
                                毛利 {pct(priceRow.margin, 0)} · p10 {moneyInt(priceRow.profitP10Cents)}
                              </div>
                              {fullCand === undefined ? null : (
                                <div className="mt-0.5 text-[10.5px] text-ink-400">
                                  活动 {money(fullCand.promoPriceCents)} · 缺货 {fullCand.sim.stockoutDays}天
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {run.artifacts.product === null ? null : (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-paper-50 px-3 py-1.5 text-[11.5px] text-ink-600 ring-1 ring-inset ring-paper-200 tabular">
                          <span>竞品参考价：{money(run.artifacts.product.competitorCents)}</span>
                          <span>当前日推广预算：{money(run.artifacts.product.adDailyBudgetCents)}/天</span>
                          <span>活动折扣：{pct(run.artifacts.product.promoDiscount, 0)}</span>
                          <span>周转金：{moneyInt(run.artifacts.product.cashCents)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <CredentialLine events={visibleEvents} nodeId="market" run={run} />
                </div>

                <div className="rounded-xl border border-paper-300 bg-paper-100/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[14.5px] font-semibold text-ink-900">
                      四、独立风控复核与冲突批注（风控审计）
                    </span>
                    {risk === null ? (
                      <Pill tone="ink">待复核</Pill>
                    ) : (
                      <Pill tone={VERIFICATION_META[risk.level].tone}>
                        风控结论：{VERIFICATION_META[risk.level].label}
                      </Pill>
                    )}
                  </div>

                  {risk === null ? (
                    <p className="mt-2 text-[12.5px] leading-relaxed text-ink-500">
                      对保本线、目标毛利、推广占比、退货率、竞品价格带、30 天不缺货、活动折后价及证据边界进行 8 项独立校验。
                    </p>
                  ) : (
                    <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
                      {risk.rows.map((row) => {
                        const meta = VERIFICATION_META[row.status];
                        const ownerAgent = run?.agents.find((a) => a.id === row.owner);
                        return (
                          <div
                            key={`${row.id ?? row.title}-${row.detail}`}
                            className={cn(
                              "rounded-lg border px-2.5 py-2 text-[11.5px]",
                              row.status === "fail"
                                ? "border-seal-500/40 bg-seal-100/40"
                                : row.status === "warn"
                                  ? "border-ochre-500/35 bg-ochre-100/40"
                                  : "border-paper-200 bg-paper-50",
                            )}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="font-semibold text-ink-900">{row.title}</span>
                              <Pill tone={meta.tone}>{meta.label}</Pill>
                            </div>
                            <p className="mt-1 text-[11px] leading-snug text-ink-600">{row.detail}</p>
                            {ownerAgent === undefined ? null : (
                              <div className="mt-1 text-[10px] text-ink-400">
                                责任角色：{ownerAgent.name}
                                {(run?.failures[ownerAgent.id] ?? 0) > 0
                                  ? `（累计未过 ${String(run?.failures[ownerAgent.id])} 次）`
                                  : ""}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <CredentialLine events={visibleEvents} nodeId="risk" run={run} />
                </div>
              </div>

              <LoopComparisonSection run={run} visibleEvents={visibleEvents} />

              {run === null ? null : (
                <div className="grid gap-3.5 lg:grid-cols-2">
                  <div className="rounded-xl border border-paper-300 bg-paper-100/50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-[14.5px] font-semibold text-ink-900">
                        六、上架文案与合规边界（上架文案师）
                      </span>
                      <Pill tone={llmMeta.tone}>{llmMeta.label}</Pill>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-600">
                      {run.llm.note}
                    </p>
                    {run.artifacts.copy?.titles[0] ? (
                      <div className="mt-2 rounded-lg bg-paper-50 px-3 py-2 text-[12px] text-ink-800 ring-1 ring-inset ring-paper-200">
                        <span className="text-ink-500">主标题初稿：</span>
                        <span className="font-medium">{run.artifacts.copy.titles[0].text}</span>
                      </div>
                    ) : null}
                    <CredentialLine events={visibleEvents} nodeId="copy" run={run} />
                  </div>

                  <div className="rounded-xl border border-paper-300 bg-paper-100/50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-[14.5px] font-semibold text-ink-900">
                        七、掌柜拍板与报告封存（人工门 & 报告师）
                      </span>
                      {statusMeta === null ? null : (
                        <Pill tone={statusMeta.tone}>{statusMeta.label}</Pill>
                      )}
                    </div>
                    <div className="mt-2 text-[12px] leading-relaxed text-ink-700">
                      {run.status === "awaiting-approval" ? (
                        <p>
                          当前停在人工审核门（<code className="font-mono text-[11px]">gate.awaiting</code>）。
                          请在下方「三套策略与掌柜拍板台」核对现金流曲线与成本结构，选定上架策略后点击「拍板通过并封存」或「驳回上架方案」。
                        </p>
                      ) : run.status === "rejected" ? (
                        <p className="text-seal-600">
                          掌柜已驳回本次上架方案（<code className="font-mono text-[11px]">action=reject</code>），系统如实终止报告生成并封存完整事件链。
                        </p>
                      ) : (
                        <p className="text-jade-600">
                          已选定「{strategyName(run.artifacts.chosenId)}」并完成最终一致性校验，共生成{" "}
                          {String(run.artifacts.report.length)} 条可复核审计结论。
                        </p>
                      )}
                    </div>
                    <CredentialLine events={visibleEvents} nodeId="approval" run={run} />
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Panel data-testid="three-strategies">
            <PanelHead
              title="三套策略对比与掌柜拍板台"
              desc="点击任一策略卡片即可切换查看对应的 30 天现金流曲线、单件成本拆解与风控细项；在「待掌柜拍板」状态下，所选策略即为拍板生效方案。"
              right={
                activeCandidate === undefined ? null : (
                  <Pill tone="seal">
                    当前检视：{activeCandidate.label}（{money(activeCandidate.priceCents)}）
                  </Pill>
                )
              }
            />

            <div className="flex flex-col gap-5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-seal-500/35 bg-seal-100/30 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Gavel className="h-4 w-4 text-seal-600" />
                    <span className="font-display text-[15px] font-semibold text-ink-900">
                      掌柜拍板门（Human Gate）
                    </span>
                    {run === null ? (
                      <Pill tone="plain">请先运行评审</Pill>
                    ) : run.status === "awaiting-approval" ? (
                      <Pill tone="seal">等待掌柜拍板</Pill>
                    ) : run.status === "completed" ? (
                      <Pill tone="jade">
                        {run.gateDecision === "approve" ? "掌柜已拍板通过" : "演示自动放行已封存"}
                      </Pill>
                    ) : run.status === "rejected" ? (
                      <Pill tone="seal">掌柜已驳回方案</Pill>
                    ) : (
                      <Pill tone="ochre">核算进行中</Pill>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
                    {run === null
                      ? "运行上架评审后，在此处选择「稳价 / 跟价 / 冲量」三套策略之一，执行真实拍板通过或驳回。"
                      : run.status === "awaiting-approval"
                        ? `当前拟拍板策略：「${strategyName(activeCandidateId)}」${activeCandidate ? `（售价 ${money(activeCandidate.priceCents)}，预计毛利 ${pct(activeCandidate.evaluation.daily.margin)}）` : ""}。拍板后将接着执行报告汇总与 SHA-256 指纹封存。`
                        : run.status === "rejected"
                          ? "本次评审已被掌柜驳回并封存，不允许用冲突决策覆盖。"
                          : `本次评审已按「${strategyName(run.artifacts.chosenId)}」封存落印。`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <ActionButton
                    data-testid="approve"
                    variant="jade"
                    disabled={run?.status !== "awaiting-approval" || decisionBusy}
                    onClick={() => {
                      void handleDecision("approve");
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {decisionBusy
                      ? "提交中…"
                      : `拍板通过${activeCandidate ? `（${activeCandidate.label}）` : ""}`}
                  </ActionButton>

                  <ActionButton
                    data-testid="reject"
                    variant="ghost"
                    className="border border-seal-500/40 text-seal-600 hover:bg-seal-100/50"
                    disabled={run?.status !== "awaiting-approval" || decisionBusy}
                    onClick={() => {
                      void handleDecision("reject");
                    }}
                  >
                    <XCircle className="h-4 w-4" />
                    驳回上架方案
                  </ActionButton>
                </div>
              </div>

              {candidates.length > 0 ? (
                <div className="grid gap-3.5 md:grid-cols-3">
                  {candidates.map((candidate) => (
                    <div key={candidate.id} data-testid={`strategy-${candidate.id}`}>
                      <CandidateCard
                        candidate={candidate}
                        recommended={candidate.id === run?.artifacts.chosenId}
                        selected={candidate.id === activeCandidateId}
                        disabled={decisionBusy}
                        onSelect={() => setSelectedCandidateId(candidate.id)}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-paper-300 bg-paper-100/40 px-4 py-8 text-center text-[13px] text-ink-500">
                  点击上方「开始上架评审」后，此处将展示稳价、跟价、冲量三套策略卡片与现金流对比。
                </div>
              )}

              {activeCandidate === undefined ? null : (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-paper-300 bg-paper-100/40 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-display text-[14.5px] font-semibold text-ink-900">
                          单件成本与净利拆解（{activeCandidate.label} · {money(activeCandidate.priceCents)}）
                        </div>
                        <div className="text-[11.5px] text-ink-500">
                          保本价 {money(activeCandidate.evaluation.breakEvenCents)} · 单件净利{" "}
                          {money(activeCandidate.evaluation.daily.netPerOrderCents)} · 日均单量{" "}
                          {num(activeCandidate.evaluation.daily.orders, 0)} 单
                        </div>
                      </div>
                      <Pill tone="ink">成本会计 + 市场核算</Pill>
                    </div>
                    <CostBreakdown evaluation={activeCandidate.evaluation} />
                  </div>

                  <div className="rounded-2xl border border-paper-300 bg-paper-100/40 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-display text-[14.5px] font-semibold text-ink-900">
                          30 天现金流与累计利润推演（{activeCandidate.label}）
                        </div>
                        <div className="text-[11.5px] text-ink-500">
                          中位 p50：{moneyInt(activeCandidate.sim.p50Cents)} · 最差 10% (p10)：
                          {moneyInt(activeCandidate.sim.p10Cents)} · 最低现金：
                          {moneyInt(activeCandidate.sim.minCashCents)}
                        </div>
                      </div>
                      <Pill tone={activeCandidate.sim.stockoutDays === 0 ? "jade" : "ochre"}>
                        缺货 {activeCandidate.sim.stockoutDays} 天
                      </Pill>
                    </div>
                    <ProfitCurve sim={activeCandidate.sim} />
                  </div>
                </div>
              )}

              {activeCandidate !== undefined && run !== null ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-paper-300 bg-paper-50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="font-display text-[14.5px] font-semibold text-ink-900">
                        所选策略风控细项（{activeCandidate.label}）
                      </span>
                      <span className="text-[11.5px] text-ink-500">{activeCandidate.verdict}</span>
                    </div>
                    <ChecksList rows={activeCandidate.checks} />
                  </div>

                  <div className="flex flex-col justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-display text-[14.5px] font-semibold text-ink-900">
                          会签决议与审计报告
                        </span>
                        <Pill tone={statusMeta?.tone ?? "ink"}>
                          {statusMeta?.label ?? run.status}
                        </Pill>
                      </div>

                      {run.status === "rejected" ? (
                        <div className="rounded-xl border border-seal-500/40 bg-seal-100/50 p-3.5 text-[12.5px] leading-relaxed text-seal-600">
                          <div className="font-semibold">掌柜已驳回当前上架方案</div>
                          <p className="mt-1">
                            事件链已记录 <code className="font-mono">gate.decided (action=reject)</code> 并锁定指纹。由于方案被驳回，系统未生成上架通过报告。
                          </p>
                        </div>
                      ) : run.artifacts.report.length > 0 ? (
                        <ul className="space-y-1.5 text-[12px] leading-relaxed text-ink-700">
                          {run.artifacts.report.map((line) => (
                            <li key={line} className="rounded-lg bg-paper-100/70 px-3 py-1.5">
                              {line}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[12.5px] leading-relaxed text-ink-500">
                          当前处于「待掌柜拍板」阶段，点击上方「拍板通过」后由研究报告师汇编最终审计报告并落印封存。
                        </p>
                      )}
                    </div>

                    {run.status === "completed" || run.status === "rejected" ? (
                      <SealStamp
                        hash={run.fingerprint}
                        at={run.createdAt}
                        label={
                          run.status === "rejected"
                            ? "掌柜已驳回 · 评审事件链封存"
                            : `掌柜已拍板 · ${strategyName(run.artifacts.chosenId)}`
                        }
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </Panel>

          {run === null || run.artifacts.copy === null ? null : (
            <Panel>
              <PanelHead
                title="可兑现上架文案（标题与五条卖点）"
                desc="仅在成本核算与风控会签之后生成；带「需你确认」标记的卖点需掌柜核对实物后再上架。"
                right={
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-ochre-500" />
                    <Pill tone={llmMeta.tone}>{llmMeta.label}</Pill>
                  </div>
                }
              />
              <div className="grid gap-4 p-5 lg:grid-cols-2">
                <div className="flex flex-col gap-2.5">
                  <div className="text-[12.5px] font-semibold text-ink-800">
                    候选商品标题（严格受平台字数限制）
                  </div>
                  {run.artifacts.copy.titles.map((title) => (
                    <CopyBlock
                      key={`${title.label}-${title.text}`}
                      label={title.label}
                      meta={`${String(title.length)} 字`}
                      text={title.text}
                    />
                  ))}
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
                    说明：{run.llm.note}
                  </p>
                </div>

                <div className="flex flex-col gap-2.5">
                  <div className="text-[12.5px] font-semibold text-ink-800">
                    五条可兑现卖点（按所选策略与服务标签生成）
                  </div>
                  {(activeCandidate?.bullets ?? []).length > 0
                    ? activeCandidate?.bullets.map((bullet, idx) => (
                        <CopyBlock
                          key={bullet.text}
                          label={`卖点 ${String(idx + 1)}`}
                          meta={bullet.basis}
                          text={bullet.text}
                          needsReview={bullet.needsReview}
                        />
                      ))
                    : run.artifacts.bullets.map((text, idx) => (
                        <CopyBlock key={text} label={`卖点 ${String(idx + 1)}`} text={text} />
                      ))}
                </div>
              </div>
            </Panel>
          )}
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-32px)] xl:overflow-auto">
          <Panel>
            <PanelHead
              title="近期评审卷宗"
              desc={`${String(runs.length)} 条历史记录 · 点击可检视或回放`}
              right={<FileSpreadsheet className="h-4 w-4 text-seal-500" />}
            />
            <div className="flex max-h-[240px] flex-col gap-1.5 overflow-auto px-3 py-2.5">
              {runs.length === 0 ? (
                <p className="px-2 py-3 text-[12px] text-ink-400">暂无历史评审记录</p>
              ) : (
                runs.map((item) => {
                  const itemStatus = RUN_STATUS_META[item.status];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`history-run-${item.id}`}
                      onClick={() => {
                        void openRunFromHistory(item.id);
                      }}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition-colors",
                        run?.id === item.id
                          ? "border-seal-500/50 bg-paper-100"
                          : "border-transparent bg-paper-100/50 hover:border-paper-300 hover:bg-paper-100",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <Pill tone={itemStatus.tone}>{itemStatus.label}</Pill>
                        <span className="tabular text-[11px] font-semibold text-ink-800">
                          {item.priceCents > 0 ? money(item.priceCents) : "—"} · 毛利{" "}
                          {pct(item.margin, 0)}
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11.5px] font-medium text-ink-800">
                        {item.taskText}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-400 tabular">
                        <Clock3 className="h-3 w-3" />
                        <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                        <span>{item.loops} 轮修正</span>
                        <span>{item.failures} 项未过</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="会签事件凭证流"
              desc={
                visibleEvents.length === 0
                  ? "实时流式接收节点事件与哈希链"
                  : `已接收 ${String(visibleEvents.length)} 条有序事件（SHA-256 连续链）`
              }
              right={<Scale className="h-4 w-4 text-ink-500" />}
            />
            <div className="max-h-[340px] overflow-auto px-3.5 py-3">
              {visibleEvents.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-ink-400">
                  启动评审后，此处按真实完成顺序流式推入事件凭证
                </p>
              ) : (
                <ol className="flex flex-col gap-2">
                  {visibleEvents.map((event) => {
                    const agentName =
                      event.agentId === null
                        ? null
                        : (run?.agents.find((a) => a.id === event.agentId)?.name ??
                          catalog?.agents.find((a) => a.id === event.agentId)?.name ??
                          event.agentId);
                    return (
                      <li
                        key={event.seq}
                        className="rounded-xl border border-paper-200 bg-paper-100/60 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="text-[12px] font-semibold text-ink-900">
                            {event.title}
                          </span>
                          {agentName === null ? null : <Pill tone="ink">{agentName}</Pill>}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-ink-600">
                          {event.detail}
                        </p>
                        <div className="mt-1 font-mono text-[9.5px] text-ink-400">
                          凭证 #{String(event.seq).padStart(2, "0")} · {event.type} ·{" "}
                          {shortHash(event.prevHash, 8)} → {shortHash(event.hash, 8)}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHead
              title="会签幕僚与工具册"
              desc={`${String(catalog?.agents.length ?? 7)} 个角色 · ${String(catalog?.tools.length ?? 9)} 项核验工具`}
              right={<Bot className="h-4 w-4 text-ink-500" />}
            />
            <div className="flex flex-col gap-2 px-3.5 py-3">
              {(run?.agents ?? catalog?.agents ?? []).map((agent) => {
                const calls = run?.calls[agent.id] ?? 0;
                const fails = run?.failures[agent.id] ?? 0;
                return (
                  <div
                    key={agent.id}
                    className="rounded-xl border border-paper-200/90 bg-paper-100/50 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-ink-900">{agent.name}</span>
                      <div className="flex items-center gap-1">
                        {calls > 0 ? <Pill tone="jade">调用 {calls} 次</Pill> : null}
                        {fails > 0 ? <Pill tone="seal">未过 {fails} 次</Pill> : null}
                        <Pill tone="plain">v{agent.version}</Pill>
                      </div>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{agent.role}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {agent.tools.map((tool) => (
                        <span
                          key={tool}
                          className="inline-flex items-center gap-1 rounded bg-paper-200/70 px-1.5 py-0.5 font-mono text-[9.5px] text-ink-600"
                        >
                          <Wrench className="h-2.5 w-2.5" />
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-paper-300/80 px-2 pt-3 text-[11px] leading-relaxed text-ink-500">
        <div className="flex items-center gap-2">
          <Layers3 className="h-3.5 w-3.5 text-ink-400" />
          <span>
            确定性规则 Harness 保障同一输入产出一致的保本价、三套策略与事件指纹；启用外部模型后仅由文案师调用模型并经长度与违禁词校验，未通过则显式记为模型回退。
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10.5px] text-ink-400">
          {run === null ? null : (
            <span>
              当前卷宗：{run.id} · 完整指纹 {shortHash(run.fingerprint, 16)}
            </span>
          )}
        </div>
      </footer>
    </div>
  );
}
