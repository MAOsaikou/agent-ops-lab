import {
  AlertTriangle,
  ArrowLeft,
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
import {
  appendClause,
  clauseForAnswer,
  composeTaskText,
  type ComposeFieldId,
  type ComposeForm,
} from "../../../src/templates/agentops/compose.js";
import { MerchantIntake } from "./MerchantIntake.js";
import { parseTaskFacts } from "../../../src/templates/agentops/task-facts.js";
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
import { CollaborationEvidence } from "./CollaborationEvidence.js";
import { CopyBlock } from "./CopyBlock.js";
import { CostBreakdown } from "./CostBreakdown.js";
import { DeliberationBoard } from "./DeliberationBoard.js";
import { FollowUpAnswers, type FollowUpItem } from "./FollowUpAnswers.js";
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
    summary: "各角色正在核算",
  },
  "awaiting-approval": {
    label: "待掌柜拍板",
    tone: "seal",
    summary: "核算和修正已经好了，就等你拍板",
  },
  completed: {
    label: "已拍板封存",
    tone: "jade",
    summary: "已经通过，并记下了这一次的结论",
  },
  rejected: {
    label: "已驳回封存",
    tone: "seal",
    summary: "你已驳回，这件不上架",
  },
};

const STRATEGY_LABELS: Readonly<Record<string, string>> = {
  profit: "稳价 · 保目标毛利",
  match: "跟价 · 对齐竞品",
  volume: "冲量 · 压价抢单",
};

const LOOP_ACTION_LABELS: Readonly<Record<LoopAction, string>> = {
  "ad-budget": "下调日推广预算",
  "promo-discount": "提高活动折扣，守住保本价",
  "switch-candidate": "换更稳的定价策略",
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
    label: "拼多多短袖",
    badge: "链接文案 · 紧周转",
    text: "分析这个拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。分享文案：纯棉短袖女夏季宽松，券后 ¥39.90，已拼 10 万+，包邮、七天无理由。采购 16 元，包材 1.5 元，快递 6.5 元，目标毛利 25%，可周转资金 300 元。",
  },
  {
    id: "jd-pillow-2loops",
    label: "京东护颈枕",
    badge: "无链接 · 高预算",
    text: "评估护颈枕价格与现金流。京东价 ¥89，竞品日单量约 50，采购 18 元，包装 2 元，快递 7 元，平台费率按默认，目标毛利 30%，预算 500 元。",
  },
  {
    id: "pdd-ad-converge",
    label: "拼多多短袖 · 推广偏高",
    badge: "测预算收敛",
    text: "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。商品名：纯棉短袖，券后价 ¥39.90。采购价 16 元，包材 1.5 元，快递 6.5 元，竞品主流价 39.90 元，日单量 15，目标毛利 25%，推广预算 220 元，可周转资金 5000 元。",
  },
  {
    id: "pdd-promo-floor",
    label: "加厚收纳箱",
    badge: "薄利 · 测活动保本",
    text: "分析拼多多商品是否值得上架：https://mobile.yangkeduo.com/goods.html?goods_id=412345678901。商品名：加厚收纳箱，售价 ¥38.90。采购价 25 元，包材 2 元，快递 6 元，竞品主流价 38.90 元，日单量 60，目标毛利 5%，推广预算 10 元，可周转资金 5000 元。",
  },
];

function strategyName(id: string | null | undefined): string {
  if (!id) return "待定";
  return STRATEGY_LABELS[id] ?? id;
}

const AGENT_SHORT: Readonly<Record<string, string>> = {
  planner: "任务规划师",
  "link-researcher": "商品研究员",
  "cost-accountant": "成本会计",
  "market-analyst": "市场分析师",
  "risk-auditor": "风控审计",
  copywriter: "上架文案师",
  reporter: "研究报告师",
  owner: "掌柜",
};

const TOOL_LABELS: Readonly<Record<string, string>> = {
  "workflow.plan": "拆解评审步骤与验收标准",
  "product.parse": "解析商品链接与分享文案",
  "knowledge.search": "检索平台规则与费率知识库",
  "pricing.unit-cost": "核算单件总成本",
  "pricing.break-even": "测算保本底价",
  "pricing.candidates": "测算稳价、跟价、冲量三套报价",
  "pricing.simulate": "推演 30 天现金流与断货风险",
  "pricing.verify": "逐项核验风控约束",
  "copy.generate": "生成合规标题与卖点初稿",
  "report.compile": "汇编最终会签报告",
};

function prettyToolName(toolId: string, catalog: AgentCatalog | null): string {
  return (
    TOOL_LABELS[toolId] ??
    catalog?.tools.find((item) => item.name === toolId)?.title ??
    toolId
  );
}

function prettyEventTitle(
  event: RunEvent,
  catalog: AgentCatalog | null,
): { readonly title: string; readonly rawToolId: string | null } {
  if (event.type === "tool.called" && event.title.startsWith("工具调用：")) {
    const rawToolId = event.title.slice("工具调用：".length).trim();
    return {
      title: `调用工具：${prettyToolName(rawToolId, catalog)}`,
      rawToolId,
    };
  }
  const loopMatch = /^进入第\s*(\d+)\s*轮\s*Self-Loop$/.exec(event.title);
  if (loopMatch?.[1] !== undefined) {
    const iter = Number(loopMatch[1]);
    return {
      title: `进入第 ${String(Math.max(1, iter - 1))} 次参数修正`,
      rawToolId: null,
    };
  }
  const friendlyTitles: Readonly<Record<string, string>> = {
    "规划 Agent 提交执行图": "任务规划师提交评审路线",
    "文案 Agent 提交候选内容": "上架文案师提交标题与卖点",
    "报告 Agent 提交审计报告": "研究报告师提交会签报告",
  };
  return {
    title: friendlyTitles[event.title] ?? event.title,
    rawToolId: null,
  };
}

function prettyRole(role: string): string {
  return role
    .split(/\s*(?:→|->)\s*/)
    .map((part) => AGENT_SHORT[part.trim()] ?? part.trim())
    .join(" → ");
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
        label: "模型回退",
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
      "未接外部模型，按本地规则核算，不会假装是模型在推理。",
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
  if (run === null) return null;
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
    <details className="mt-1 border-t border-paper-200/80 pt-1 sm:mt-2.5 sm:pt-2">
      <summary className="cursor-pointer select-none text-[11px] text-ink-400 hover:text-ink-600">
        查看凭证
      </summary>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink-400">
        <span>
          {agentSpec ? `${agentSpec.name} (v${agentSpec.version})` : (lastEvent?.agentId ?? nodeId)}
        </span>
        {winnerScore === undefined ? null : <span>调度分 {winnerScore}</span>}
        {dispatches.length > 1 ? <span>累计调度 {dispatches.length} 次</span> : null}
        {lastEvent === undefined ? null : (
          <span>
            事件 #{String(lastEvent.seq).padStart(2, "0")} ({lastEvent.type}) ·{" "}
            {shortHash(lastEvent.prevHash, 8)} → {shortHash(lastEvent.hash, 8)}
          </span>
        )}
      </div>
      {lastEvent === undefined ? null : (
        <div className="mt-1 break-all font-mono text-[9.5px] text-ink-400">
          hash: <span className="select-all text-ink-600">{lastEvent.hash}</span>
        </div>
      )}
    </details>
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
  const warnRows = run?.artifacts.risk?.rows.filter((row) => row.status === "warn") ?? [];

  return (
    <div
      data-testid="loop-comparison"
      className="rounded-xl border border-paper-300 bg-paper-100/70 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-ochre-500" />
          <span className="font-display text-[15px] font-semibold text-ink-900">
            五、改过什么
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {run === null ? (
            <Pill tone="ink">待核算</Pill>
          ) : loops.length === 0 ? (
            <>
              <Pill tone="ink">未改价或预算</Pill>
              {failRows.length > 0 ? (
                <Pill tone="seal">剩 {String(failRows.length)} 项需拍板</Pill>
              ) : warnRows.length > 0 ? (
                <Pill tone="ochre">剩 {String(warnRows.length)} 项待确认</Pill>
              ) : (
                <Pill tone="jade">首轮全过</Pill>
              )}
            </>
          ) : (
            <>
              <Pill tone="ochre">已改 {String(loops.length)} / 2 轮</Pill>
              {failRows.length > 0 ? (
                <Pill tone="seal">仍余 {String(failRows.length)} 项需拍板</Pill>
              ) : warnRows.length > 0 ? (
                <Pill tone="ochre">余 {String(warnRows.length)} 项待确认</Pill>
              ) : (
                <Pill tone="jade">已全部通过</Pill>
              )}
            </>
          )}
        </div>
      </div>

      {run === null ? (
        <p className="mt-2 text-[12.5px] text-ink-500">
          还没开始。要是推广超了或卖价会亏，改完的对比会记在这里。
        </p>
      ) : loops.length === 0 ? (
        <div className="mt-2.5 rounded-lg border border-paper-300/80 bg-paper-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-700">
          {failRows.length > 0 ? (
            <div>
              <div className="font-medium text-ink-900">不用改价或预算，但仍有风险需你拍板</div>
              <p className="mt-1 text-ink-600">
                未通过项：「{failRows.map((row) => row.title).join("、")}」
                {warnRows.length > 0
                  ? `；待确认项：「${warnRows.map((row) => row.title).join("、")}」`
                  : ""}
                。这类证据或备货问题削推广费解决不了，留给你拍板。
              </p>
            </div>
          ) : warnRows.length > 0 ? (
            <div>
              <div className="font-medium text-ink-900">不用改价或预算，仍需确认细节</div>
              <p className="mt-1 text-ink-600">
                保本价、毛利、推广占比和活动折扣已过红线；还有「
                {warnRows.map((row) => row.title).join("、")}」需你核对后再拍板。
              </p>
            </div>
          ) : (
            <div>
              <div className="font-medium text-jade-600">不用改价或预算，首轮全部通过</div>
              <p className="mt-1 text-ink-600">保本价、毛利、推广占比和活动折扣都已通过。</p>
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
                      第 {loop.iteration - 1} 次修正
                    </span>
                    <span className="text-[13px] font-semibold text-ink-900">{actionLabel}</span>
                  </div>
                  <Pill tone="ochre">{prettyRole(loop.role)}</Pill>
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
                        <th className="py-1.5 pr-3 font-medium">看什么</th>
                        <th className="py-1.5 px-3 font-medium">改前</th>
                        <th className="py-1.5 px-3 font-medium">改后</th>
                        <th className="py-1.5 pl-3 font-medium">变化</th>
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
                            ? "策略没变"
                            : "换成更稳的一档"}
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
                        <td className="py-1.5 pr-3 text-ink-600">30 天较差情况利润</td>
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

  const [composeForm, setComposeForm] = useState<ComposeForm>({
    name: "",
    competitorYuan: "",
    buyYuan: "",
    shippingYuan: "",
    packagingYuan: "",
    targetMarginPct: "",
    dailyOrders: "",
    cashYuan: "",
    adBudgetYuan: "",
  });
  const [composeErrors, setComposeErrors] = useState<Readonly<Partial<Record<ComposeFieldId, string>>>>({});
  const [answerValues, setAnswerValues] = useState<Record<string, string>>({});

  const handleComposeSubmit = (): void => {
    const res = composeTaskText(composeForm);
    if (!res.ok) {
      setComposeErrors(res.errors);
      return;
    }
    setComposeErrors({});
    setTask(res.text);
  };

  const [openedFromHistory, setOpenedFromHistory] = useState<boolean>(false);
  const [priorRun, setPriorRun] = useState<AgentRun | null>(null);
  const historyBackRef = useRef<HTMLButtonElement | null>(null);
  const [replayCount, setReplayCount] = useState<number | null>(null);
  const [replayAnimating, setReplayAnimating] = useState<boolean>(false);
  const rafRef = useRef<number | null>(null);
  const opSeqRef = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const decisionInFlightRef = useRef<boolean>(false);

  const beginOperation = (): { readonly opId: number; readonly signal: AbortSignal } => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    opSeqRef.current += 1;
    decisionInFlightRef.current = false;
    return { opId: opSeqRef.current, signal: controller.signal };
  };

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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

  const openedFromHistoryRef = useRef(openedFromHistory);
  openedFromHistoryRef.current = openedFromHistory;

  const handleHistoryBackRef = useRef<() => void>(() => {});

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && openedFromHistoryRef.current) {
        e.preventDefault();
        handleHistoryBackRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (openedFromHistory) {
      historyBackRef.current?.focus();
    }
  }, [openedFromHistory, run?.id]);

  // On a phone the page reflows when a run starts and again when the dossier lands; without this the
  // browser's scroll anchoring leaves the merchant at the page bottom, away from the decision.
  const [pendingBoardScroll, setPendingBoardScroll] = useState(false);
  useEffect(() => {
    if (!pendingBoardScroll || run === null) return;
    if (typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 639px)").matches) {
      setPendingBoardScroll(false);
      return;
    }
    const board = document.querySelector('[data-testid="three-strategies"]');
    if (board !== null && typeof board.scrollIntoView === "function") board.scrollIntoView({ block: "start" });
    if (!busy) setPendingBoardScroll(false);
  }, [pendingBoardScroll, run, busy]);

  const startRun = async (overrideTask?: string): Promise<void> => {
    if (busy || decisionBusy || decisionInFlightRef.current) return;
    const taskToRun = (overrideTask ?? task).trim();
    if (taskToRun.length < 8) return;
    if (overrideTask !== undefined) {
      setTask(overrideTask);
    }
    const { opId, signal } = beginOperation();
    setBusy(true);
    setPendingBoardScroll(true);
    setDecisionBusy(false);
    setError(null);
    setOpenedFromHistory(false);
    setPriorRun(null);
    setReplayCount(null);
    setReplayAnimating(false);
    setSelectedCandidateId(null);
    setStreamEvents([]);
    setRun(null);

    try {
      const autoApprove = !requireApproval;
      const completedOrPaused = await streamAgentTask(
        { task: taskToRun, autoApprove },
        (incomingEvent) => {
          if (opSeqRef.current !== opId) return;
          setStreamEvents((prev) => [...prev, incomingEvent]);
        },
        (snapshot) => {
          if (opSeqRef.current !== opId) return;
          setRun(snapshot);
        },
        signal,
      );
      if (opSeqRef.current !== opId) return;
      setRun(completedOrPaused);
      setStreamEvents(completedOrPaused.events);
      const latestRuns = await fetchAgentRuns().catch(() => []);
      if (opSeqRef.current === opId) {
        setRuns(latestRuns);
      }
    } catch (caught) {
      if (opSeqRef.current !== opId) return;
      setRun(null);
      setStreamEvents([]);
      setSelectedCandidateId(null);
      setOpenedFromHistory(false);
      setPriorRun(null);
      setReplayCount(null);
      setReplayAnimating(false);
      setError(caught instanceof Error ? caught.message : "上架评审运行失败");
    } finally {
      if (opSeqRef.current === opId) {
        setBusy(false);
      }
    }
  };

  const openRunFromHistory = async (id: string): Promise<void> => {
    if (busy || decisionBusy || decisionInFlightRef.current) return;
    const { opId, signal } = beginOperation();
    setError(null);
    setReplayAnimating(false);
    setReplayCount(null);
    const runBeforeBrowse = openedFromHistory ? priorRun : run;
    try {
      const loaded = await fetchAgentRun(id, { signal });
      if (opSeqRef.current !== opId) return;
      setPriorRun(runBeforeBrowse);
      setRun(loaded);
      setStreamEvents(loaded.events);
      setSelectedCandidateId(
        isCandidateId(loaded.artifacts.chosenId) ? loaded.artifacts.chosenId : null,
      );
      setOpenedFromHistory(true);
      setError(null);
    } catch (caught) {
      if (opSeqRef.current !== opId || signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "读取历史评审卷宗失败");
    }
  };

  const handleHistoryBack = (): void => {
    setError(null);
    setOpenedFromHistory(false);
    setReplayAnimating(false);
    setReplayCount(null);
    if (priorRun !== null) {
      setRun(priorRun);
      setStreamEvents(priorRun.events);
      setSelectedCandidateId(
        isCandidateId(priorRun.artifacts.chosenId) ? priorRun.artifacts.chosenId : null,
      );
      setPriorRun(null);
    } else {
      setRun(null);
      setStreamEvents([]);
      setSelectedCandidateId(null);
      setPriorRun(null);
    }
  };
  handleHistoryBackRef.current = handleHistoryBack;

  const handleDecision = async (action: "approve" | "reject"): Promise<void> => {
    if (
      busy ||
      decisionBusy ||
      decisionInFlightRef.current ||
      run === null ||
      run.status !== "awaiting-approval"
    ) {
      return;
    }
    const targetRunId = run.id;
    const { opId } = beginOperation();
    decisionInFlightRef.current = true;
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
      const updated = await submitRunDecision(targetRunId, decisionInput);
      const latestRuns = await fetchAgentRuns().catch(() => null);
      if (latestRuns !== null) {
        setRuns(latestRuns);
      }
      if (opSeqRef.current !== opId) return;
      setRun(updated);
      setStreamEvents(updated.events);
    } catch (caught) {
      if (opSeqRef.current !== opId) return;
      setError(caught instanceof Error ? caught.message : "提交掌柜拍板决策失败");
    } finally {
      if (opSeqRef.current === opId) {
        decisionInFlightRef.current = false;
        setDecisionBusy(false);
      }
    }
  };

  const startSealedReplay = (): void => {
    if (busy || run === null || run.status === "running" || run.events.length === 0) return;
    setOpenedFromHistory(true);
    setReplayCount(1);
    setReplayAnimating(true);
  };

  const stopSealedReplay = (): void => {
    setReplayAnimating(false);
    setReplayCount(null);
  };

  const visibleEvents: readonly RunEvent[] = useMemo(() => {
    if (run === null) return busy ? streamEvents : [];
    if (replayCount !== null) {
      return run.events.slice(0, replayCount);
    }
    if (busy && streamEvents.length >= run.events.length) {
      return streamEvents;
    }
    return run.events;
  }, [busy, run, streamEvents, replayCount]);

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
  const taskFacts = useMemo(() => {
    return run === null ? null : parseTaskFacts(run.task.text);
  }, [run?.task.text]);
  const unit = run?.artifacts.unit ?? activeCandidate?.evaluation.unit ?? null;
  const followUps: readonly FollowUpItem[] = useMemo(() => {
    if (run === null || run.status === "running" || facts === null || unit === null) return [];
    const items: FollowUpItem[] = [];
    for (const question of facts.questions) {
      if (question.id === "ask-buy") items.push({ id: question.id, kind: "buy", ask: question.ask, demo: money(unit.buyCents) });
      else if (question.id === "ask-shipping") items.push({ id: question.id, kind: "shipping", ask: question.ask, demo: money(unit.shippingCents) });
      else if (question.id === "ask-orders") items.push({ id: question.id, kind: "orders", ask: question.ask, demo: String(run.artifacts.product?.marketOrders ?? "默认") + " 单/日" });
    }
    return items;
  }, [run, facts, unit]);
  const breakEvenCents = run?.artifacts.breakEvenCents ?? activeCandidate?.evaluation.breakEvenCents ?? 0;
  const risk = run?.artifacts.risk ?? null;
  const gateFailRows = risk?.rows.filter((row) => row.status === "fail") ?? [];
  const gateWarnRows = risk?.rows.filter((row) => row.status === "warn") ?? [];
  const currentStatus: RunStatus | "idle" = busy ? "running" : (run?.status ?? "idle");
  const statusMeta =
    currentStatus === "idle"
      ? null
      : (RUN_STATUS_META[currentStatus] ?? {
          label: currentStatus,
          tone: "ink" as PillTone,
          summary: "",
        });
  const llmMeta = llmBadgeMeta(run?.llm ?? null, llm);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-1.5 px-2 py-1 text-ink-900 sm:gap-4 sm:px-6 sm:py-4">
      <header className="flex flex-wrap items-center justify-between gap-1 rounded-2xl border border-paper-300 bg-paper-50 px-2.5 py-1 shadow-card sm:gap-3 sm:px-5 sm:py-3.5">
        <div className="flex items-center gap-2.5 sm:gap-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-seal-500/40 bg-seal-100/70 text-seal-600 sm:h-11 sm:w-11">
            <BookOpenCheck className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
              <h1 className="font-display text-[17px] font-semibold tracking-tight text-ink-900 sm:text-[20px]">
                商品上架评审会签台
              </h1>
              <span
                data-testid="status"
                data-status={currentStatus}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset sm:text-[11.5px]",
                  statusMeta === null || statusMeta.tone === "ink"
                    ? "bg-paper-150 text-ink-600 ring-ink-900/10"
                    : statusMeta.tone === "jade"
                      ? "bg-jade-100 text-jade-600 ring-jade-500/30"
                      : statusMeta.tone === "ochre"
                        ? "bg-ochre-100 text-ochre-500 ring-ochre-500/30"
                        : "bg-seal-100 text-seal-600 ring-seal-500/30",
                )}
              >
                {statusMeta === null ? "还没开始" : statusMeta.label}
              </span>
            </div>
            <p className="mt-0.5 hidden text-[12px] text-ink-500 sm:block">
              先算清成本，再比三套策略，改完由你拍板
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <span data-testid="llm-mode-badge">
            <Pill tone={llmMeta.tone}>{llmMeta.label}</Pill>
          </span>
          <button
            type="button"
            onClick={() => setSettingsOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-xl bg-paper-100 px-2.5 py-1 text-[11.5px] font-medium text-ink-700 ring-1 ring-inset ring-paper-300 transition-colors hover:bg-paper-150 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-[12px]"
          >
            <Settings2 className="h-3.5 w-3.5" />
            模型配置
          </button>
        </div>
      </header>

      {openedFromHistory && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ochre-500/35 bg-ochre-100/70 px-3.5 py-2 text-[12.5px] text-ink-800">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-ochre-600 shrink-0" />
            <span>正在看历史卷宗 · 返回工作台</span>
          </div>
          <button
            ref={historyBackRef}
            type="button"
            data-testid="history-back"
            onClick={handleHistoryBack}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                handleHistoryBack();
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-paper-50 shadow-sm transition hover:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-ochre-500 focus:ring-offset-1 active:scale-[0.98]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回工作台
          </button>
        </div>
      )}

      {settingsOpen ? (
        <ModelSettingsPanel onClose={() => setSettingsOpen(false)} onChanged={setLlm} />
      ) : null}

      <Panel className={run === null ? "order-0" : "order-2"}>
        <PanelHead
          title="要评哪件商品"
          desc={
            <span className="hidden sm:inline">
              贴链接、文案和进货成本就行。要是推广超了或可能亏本，会先改一改再给你看。
            </span>
          }
          right={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="gate-toggle"
                aria-pressed={requireApproval}
                data-auto-approve={String(!requireApproval)}
                onClick={() => setRequireApproval((prev) => !prev)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset transition-all sm:gap-2 sm:px-3 sm:py-1.5 sm:text-[12px]",
                  requireApproval
                    ? "bg-seal-100 text-seal-600 ring-seal-500/40"
                    : "bg-paper-100 text-ink-700 ring-paper-300 hover:bg-paper-150",
                )}
              >
                <Gavel className="h-3.5 w-3.5" />
                {requireApproval ? "需我拍板" : "自动通过"}
              </button>
            </div>
          }
        />

        <div className="flex flex-col gap-1 px-2.5 py-1 sm:gap-3 sm:px-5 sm:py-4">
          <textarea
            data-testid="task-box"
            aria-label="商品与经营信息"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            rows={2}
            className="min-h-[64px] w-full resize-y break-all rounded-xl bg-paper-100/90 px-2.5 py-1.5 text-[12px] leading-[1.45] text-ink-900 outline-none ring-1 ring-inset ring-paper-300 focus:bg-paper-50 focus:ring-2 focus:ring-seal-500/45 sm:min-h-[84px] sm:px-3.5 sm:py-2.5 sm:text-[13px] sm:leading-relaxed"
            placeholder="贴商品链接或分享文案，写上采购价、包材、快递、目标毛利和能周转的资金…"
          />

          <details open={run === null} className="min-w-0 space-y-3">
            <summary className={run === null ? "hidden" : "cursor-pointer rounded-lg border border-paper-300 bg-paper-100 px-3 py-2 text-xs font-medium text-ink-700"}>修改商品资料或继续补充</summary>
          <div className="rounded-xl border border-paper-300/80 bg-paper-100/50 p-3 text-[11px] text-ink-700">
            <h3 className="font-display text-sm font-semibold text-ink-800">没有链接？按项填写</h3>
            <div className="mt-2.5 flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label htmlFor="compose-name" className="block text-[11px] font-medium text-ink-500">商品名 <span className="text-seal-600">*</span>
                  </label>
                  <input
                    id="compose-name"
                    type="text"
                    data-testid="compose-name"
                    value={composeForm.name}
                    onChange={(e) => setComposeForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="如：纯棉短袖"
                    className="mt-0.5 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[11.5px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-seal-500"
                  />
                  {composeErrors.name && (
                    <span className="text-[10px] text-seal-600">{composeErrors.name}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="compose-competitor" className="block text-[11px] font-medium text-ink-500">同类售价（元）<span className="text-seal-600">*</span>
                  </label>
                  <input
                    id="compose-competitor"
                    type="text"
                    data-testid="compose-competitor"
                    value={composeForm.competitorYuan}
                    onChange={(e) =>
                      setComposeForm((prev) => ({ ...prev, competitorYuan: e.target.value }))
                    }
                    placeholder="如：39.9"
                    className="mt-0.5 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[11.5px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-seal-500"
                  />
                  {composeErrors.competitorYuan && (
                    <span className="text-[10px] text-seal-600">
                      {composeErrors.competitorYuan}
                    </span>
                  )}
                </div>
                <div>
                  <label htmlFor="compose-buy" className="block text-[11px] font-medium text-ink-500">采购价（元）<span className="text-seal-600">*</span>
                  </label>
                  <input
                    id="compose-buy"
                    type="text"
                    data-testid="compose-buy"
                    value={composeForm.buyYuan}
                    onChange={(e) => setComposeForm((prev) => ({ ...prev, buyYuan: e.target.value }))}
                    placeholder="如：16"
                    className="mt-0.5 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[11.5px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-seal-500"
                  />
                  {composeErrors.buyYuan && (
                    <span className="text-[10px] text-seal-600">{composeErrors.buyYuan}</span>
                  )}
                </div>
                <div>
                  <label htmlFor="compose-shipping" className="block text-[11px] font-medium text-ink-500">快递（元）<span className="text-seal-600">*</span>
                  </label>
                  <input
                    id="compose-shipping"
                    type="text"
                    data-testid="compose-shipping"
                    value={composeForm.shippingYuan}
                    onChange={(e) =>
                      setComposeForm((prev) => ({ ...prev, shippingYuan: e.target.value }))
                    }
                    placeholder="如：6.5"
                    className="mt-0.5 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[11.5px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-seal-500"
                  />
                  {composeErrors.shippingYuan && (
                    <span className="text-[10px] text-seal-600">
                      {composeErrors.shippingYuan}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                <div>
                  <label htmlFor="compose-packaging" className="block text-[10.5px] text-ink-400">包材（元，可选）</label>
                  <input
                    id="compose-packaging"
                    type="text"
                    data-testid="compose-packaging"
                    value={composeForm.packagingYuan}
                    onChange={(e) =>
                      setComposeForm((prev) => ({ ...prev, packagingYuan: e.target.value }))
                    }
                    placeholder="默认 1.5"
                    className="mt-0.5 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[11px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-seal-500"
                  />
                </div>
                <div>
                  <label htmlFor="compose-margin" className="block text-[10.5px] text-ink-400">目标毛利（%，可选）</label>
                  <input
                    id="compose-margin"
                    type="text"
                    data-testid="compose-margin"
                    value={composeForm.targetMarginPct}
                    onChange={(e) =>
                      setComposeForm((prev) => ({ ...prev, targetMarginPct: e.target.value }))
                    }
                    placeholder="默认 25"
                    className="mt-0.5 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[11px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-seal-500"
                  />
                </div>
                <div>
                  <label htmlFor="compose-orders" className="block text-[10.5px] text-ink-400">日单量（可选）</label>
                  <input
                    id="compose-orders"
                    type="text"
                    data-testid="compose-orders"
                    value={composeForm.dailyOrders}
                    onChange={(e) =>
                      setComposeForm((prev) => ({ ...prev, dailyOrders: e.target.value }))
                    }
                    placeholder="如：50"
                    className="mt-0.5 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[11px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-seal-500"
                  />
                </div>
                <div>
                  <label htmlFor="compose-cash" className="block text-[10.5px] text-ink-400">周转资金（元，可选）</label>
                  <input
                    id="compose-cash"
                    type="text"
                    data-testid="compose-cash"
                    value={composeForm.cashYuan}
                    onChange={(e) =>
                      setComposeForm((prev) => ({ ...prev, cashYuan: e.target.value }))
                    }
                    placeholder="默认 300"
                    className="mt-0.5 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[11px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-seal-500"
                  />
                </div>
                <div>
                  <label htmlFor="compose-ad" className="block text-[10.5px] text-ink-400">推广预算（元，可选）</label>
                  <input
                    id="compose-ad"
                    type="text"
                    data-testid="compose-ad"
                    value={composeForm.adBudgetYuan}
                    onChange={(e) =>
                      setComposeForm((prev) => ({ ...prev, adBudgetYuan: e.target.value }))
                    }
                    placeholder="默认 30"
                    className="mt-0.5 w-full rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-[11px] text-ink-900 focus:outline-none focus:ring-1 focus:ring-seal-500"
                  />
                </div>
              </div>

              {Object.entries(composeErrors).filter(([key]) => !["name", "competitorYuan", "buyYuan", "shippingYuan"].includes(key)).map(([key, message]) => <p key={key} role="alert" className="text-xs text-seal-600">{message}</p>)}
              <div className="flex items-center justify-end pt-1">
                <button
                  type="button"
                  data-testid="compose-submit"
                  onClick={handleComposeSubmit}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-paper-50 shadow-sm transition hover:bg-ink-800 active:scale-[0.98]"
                >
                  填入描述
                </button>
              </div>
            </div>
          </div>
          <MerchantIntake task={task} busy={busy || decisionBusy} onTaskChange={setTask} onStart={startRun} />
          </details>
          <p className="text-[11px] text-ink-500">下方也可直接试算；未填经营数据将使用报告内列明的演示假设。</p>

          <div className="flex flex-wrap items-center justify-between gap-1 sm:gap-2.5">
            <div className="grid w-full grid-cols-2 gap-1 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-1.5">
              {SCENARIO_PRESETS.map((preset, index) => (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`scenario-${String(index + 1)}`}
                  onClick={() => setTask(preset.text)}
                  className={cn(
                    "inline-flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden rounded-lg px-2 py-1 text-left text-[11px] ring-1 ring-inset transition-colors sm:flex-wrap sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-[11.5px]",
                    task === preset.text
                      ? "bg-ink-900 text-paper-50 ring-ink-900"
                      : "bg-paper-100 text-ink-700 ring-paper-300 hover:bg-paper-150",
                  )}
                >
                  <span className="shrink-0 font-medium whitespace-nowrap">{preset.label}</span>
                  <span
                    className={cn(
                      "truncate rounded px-1 py-0.5 text-[9.5px] leading-tight sm:px-1.5 sm:text-[10px]",
                      task === preset.text ? "bg-paper-50/15 text-paper-100" : "bg-paper-200 text-ink-600",
                    )}
                  >
                    {preset.badge}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:gap-2.5">
              <ActionButton
                data-testid="run-button"
                size="sm"
                className="h-7 w-full text-[12px] sm:h-10 sm:w-auto sm:px-4 sm:text-[13.5px]"
                onClick={() => {
                  void startRun();
                }}
                disabled={busy || decisionBusy || task.trim().length < 8}
              >
                <Play className="h-3.5 w-3.5" />
                {busy ? "会签核算中…" : "开始上架评审"}
              </ActionButton>
            </div>
          </div>

          {error === null ? null : (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-seal-500/30 bg-seal-100/80 px-3 py-2 text-[12px] text-seal-600 sm:px-3.5 sm:py-2.5 sm:text-[12.5px]"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </Panel>

      <div className="order-1 grid gap-2.5 sm:gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-2.5 sm:gap-4">
          <Panel data-testid="three-strategies">
            <PanelHead
              title={
                run?.status === "completed"
                  ? `已按「${strategyName(run.artifacts.chosenId)}」拍板`
                  : run?.status === "rejected"
                    ? "已驳回"
                    : run === null
                      ? "三套策略，由你拍板"
                      : "三套策略"
              }
              desc={
                <span className="hidden sm:inline">
                  点一张卡片看现金流和成本；等你拍板时，选中的就是通过方案。
                </span>
              }
              right={
                activeCandidate === undefined ? null : (
                  <span className="hidden sm:inline-flex">
                    <Pill tone="seal">
                      当前检视：{activeCandidate.label}（{money(activeCandidate.priceCents)}）
                    </Pill>
                  </span>
                )
              }
            />

            <div className="flex flex-col gap-2 p-2 sm:gap-3 sm:p-4">
              {activeCandidate === undefined ? null : <section data-testid="decision-overview" aria-label="决策摘要" className="rounded-xl bg-ink-900 px-3 py-2.5 text-paper-50 sm:px-5 sm:py-4">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-xs text-paper-300 sm:mb-2"><span className="min-w-0 max-w-full truncate">{run?.artifacts.product?.name ?? "商品评审"} / {activeCandidate.id === run?.artifacts.chosenId ? "推荐" : "当前检视"} {activeCandidate.label}</span><span className="hidden sm:inline">30 天情景试算</span></div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4 sm:gap-y-3">
                  {[{ label: "建议售价", value: money(activeCandidate.priceCents) }, { label: "毛利率", value: pct(activeCandidate.evaluation.daily.margin) }, { label: "较差情况利润 p10", value: moneyInt(activeCandidate.sim.p10Cents) }, { label: "保本红线", value: money(breakEvenCents) }].map((metric) => <div key={metric.label}><dt className="text-[10.5px] text-paper-300">{metric.label}</dt><dd data-testid={metric.label === "保本红线" ? "break-even-price" : undefined} className="mt-0.5 font-display text-lg font-semibold tabular sm:mt-1 sm:text-2xl">{metric.value}</dd></div>)}
                </dl>
              </section>}
              {run?.llm.mode === "fallback" ? <div data-testid="model-fallback-notice" className="rounded-lg border border-ochre-500/30 bg-ochre-100/60 px-3 py-2 text-xs leading-relaxed text-ink-700"><strong>模型未完成，已保留本地核算。</strong> {run.llm.note}<span className="block text-ink-600">下方建议包含规则结果；未完成的模型意见不会当作已通过会签。</span></div> : null}
              <div
                className={cn(
                  "flex flex-col gap-1 rounded-2xl px-2 py-1.5 sm:gap-2 sm:px-4 sm:py-3.5",
                  run === null
                    ? "border border-paper-300 bg-paper-100/70"
                    : "border-2 border-seal-500/35 bg-seal-100/30",
                )}
              >
                <div className="flex flex-col gap-1.5 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                      <Gavel className="h-3.5 w-3.5 text-seal-600 sm:h-4 sm:w-4" />
                      <span className="font-display text-[14px] font-semibold text-ink-900 sm:text-[15px]">
                        {run === null
                          ? "请你拍板"
                          : currentStatus === "running"
                            ? "会签进行中"
                            : run.status === "awaiting-approval"
                              ? "请你拍板"
                              : run.status === "completed"
                                ? "已拍板"
                                : run.status === "rejected"
                                  ? "已驳回"
                                  : "请你拍板"}
                      </span>
                      {run === null ? (
                        <Pill tone="plain">请先运行评审</Pill>
                      ) : currentStatus === "running" ? (
                        <Pill tone="ochre">会签进行中 · 暂不可拍板</Pill>
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
                      {run !== null && run.loops.length > 0 ? (
                        <Pill tone="ochre">已改 {String(run.loops.length)} / 2 轮</Pill>
                      ) : null}
                      {breakEvenCents > 0 ? (
                        <Pill tone="ink" className="hidden sm:inline-flex">
                          保本红线 {money(breakEvenCents)}
                        </Pill>
                      ) : null}
                    </div>
                    <p className={cn("mt-0.5 text-[11.5px] leading-snug text-ink-600 sm:mt-1 sm:text-[12px] sm:leading-relaxed", run?.status === "awaiting-approval" && currentStatus !== "running" && "hidden sm:block")}>
                      {run === null
                        ? "评审结束后，在这里选稳价、跟价或冲量，然后通过或驳回。"
                        : currentStatus === "running"
                          ? "结果按实际执行进度更新，全部评审完成后解锁拍板。"
                          : run.status === "awaiting-approval"
                            ? `现在选的是「${strategyName(activeCandidateId)}」，数字见上方。通过后会按这个方案记下。`
                            : run.status === "rejected"
                              ? "这次方案已被驳回，不能再改决定。"
                              : `已按「${strategyName(run.artifacts.chosenId)}」记下。`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <ActionButton
                      data-testid="approve"
                      variant="jade"
                      size="sm"
                      className="h-7 px-2.5 text-[12px] sm:h-10 sm:px-4 sm:text-[13.5px]"
                      disabled={busy || run?.status !== "awaiting-approval" || decisionBusy}
                      onClick={() => {
                        void handleDecision("approve");
                      }}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      {decisionBusy
                        ? "提交中…"
                        : currentStatus === "running"
                          ? "暂不可拍板（待评审完成）"
                          : run === null
                            ? "暂不可拍板（未开始）"
                            : run.status === "completed"
                              ? "已拍板封存"
                              : run.status === "rejected"
                                ? "已驳回封存"
                                : (
                                <>
                                  拍板通过
                                  {activeCandidate ? <span className="hidden sm:inline">（{activeCandidate.label}）</span> : null}
                                </>
                              )}
                    </ActionButton>

                    <ActionButton
                      data-testid="reject"
                      variant="ghost"
                      size="sm"
                      className="h-7 border border-seal-500/40 px-2.5 text-[12px] text-seal-600 hover:bg-seal-100/50 disabled:border-paper-300 disabled:bg-paper-200 disabled:text-ink-400 disabled:ring-0 sm:h-10 sm:px-4 sm:text-[13.5px]"
                      disabled={busy || run?.status !== "awaiting-approval" || decisionBusy}
                      onClick={() => {
                        void handleDecision("reject");
                      }}
                    >
                      <XCircle className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      驳回上架方案
                    </ActionButton>
                  </div>
                </div>

                {[...gateFailRows, ...gateWarnRows].length === 0 ? null : <ul data-testid="decision-priorities" className="space-y-1 border-l-2 border-seal-500 pl-2 text-[11px] leading-snug text-ink-700">{[...gateFailRows, ...gateWarnRows].slice(0, 3).map((row, index) => <li key={row.id} className={index === 0 ? undefined : "hidden sm:list-item"}><span className="font-semibold text-seal-600">{row.title}</span>：{row.detail.slice(0, 42)}{row.detail.length > 42 ? "…" : ""}</li>)}</ul>}
                {gateFailRows.length > 0 || gateWarnRows.length > 0 ? (
                  <details
                    data-testid="gate-unresolved-risks"
                    className="flex flex-col gap-0.5 rounded-xl border border-seal-500/30 bg-paper-50/90 px-2 py-1 text-[10.5px] leading-snug sm:gap-1 sm:px-2.5 sm:py-1.5 sm:text-[11.5px]"
                  >
                    <summary className="cursor-pointer py-1 font-medium text-ink-800">需修正 {gateFailRows.length} 项，待确认 {gateWarnRows.length} 项 <span className="text-ink-500">· 展开全部依据</span></summary>
                    {gateFailRows.map((row) => (
                      <div
                        key={`gate-fail-${row.id ?? row.title}`}
                        className="flex flex-wrap items-center gap-1 text-ink-800 sm:gap-1.5"
                      >
                        <Pill tone="seal">需修正</Pill>
                        <span className="font-semibold text-seal-600">{row.title}：</span>
                        <span className="text-ink-700">{row.detail}</span>
                      </div>
                    ))}
                    {gateWarnRows.map((row) => (
                      <div
                        key={`gate-warn-${row.id ?? row.title}`}
                        className="flex flex-wrap items-center gap-1 text-ink-700 sm:gap-1.5"
                      >
                        <Pill tone="ochre">待确认</Pill>
                        <span className="font-semibold text-ink-900">{row.title}：</span>
                        <span className="text-ink-600">{row.detail}</span>
                      </div>
                    ))}
                  </details>
                ) : null}

                <div className="hidden sm:block"><CredentialLine events={visibleEvents} nodeId="approval" run={run} /></div>
              </div>

              <FollowUpAnswers
                items={followUps}
                values={answerValues}
                disabled={busy || decisionBusy}
                onChange={(id, value) => { setAnswerValues((prev) => ({ ...prev, [id]: value })); }}
                onSubmit={(item) => {
                  if (run === null) return;
                  const cl = clauseForAnswer(item.kind, answerValues[item.id] ?? "");
                  if (!cl.ok) {
                    setError(`追问回答无效：${cl.error}`);
                    return;
                  }
                  const nextTask = appendClause(run.task.text, cl.clause);
                  setTask(nextTask);
                  void startRun(nextTask);
                }}
              />

              {candidates.length > 0 ? (
                (() => {
                  const isSealed = !busy && (run?.status === "completed" || run?.status === "rejected");
                  if (isSealed) {
                    const chosenCand = candidates.find((c) => c.id === run?.artifacts.chosenId) ?? candidates[0]!;
                    const otherCands = candidates.filter((c) => c.id !== chosenCand.id);
                    return (
                      <div className="flex flex-col gap-2.5">
                        <div key={chosenCand.id} data-testid={`strategy-${chosenCand.id}`}>
                          <CandidateCard
                            candidate={chosenCand}
                            recommended={true}
                            selected={true}
                            disabled={decisionBusy}
                            onSelect={() => setSelectedCandidateId(chosenCand.id)}
                          />
                        </div>
                        {otherCands.length > 0 && (
                          <details
                            data-testid="other-strategies"
                            className="group rounded-xl border border-paper-300/80 bg-paper-100/50 p-2.5 text-[12px] text-ink-700"
                          >
                            <summary className="cursor-pointer select-none font-medium text-ink-700 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-seal-500 rounded">
                              另外两套策略
                            </summary>
                            <div className="mt-2.5 grid gap-2 md:grid-cols-2 md:gap-3.5">
                              {otherCands.map((candidate) => (
                                <div key={candidate.id} data-testid={`strategy-${candidate.id}`}>
                                  <CandidateCard
                                    candidate={candidate}
                                    recommended={false}
                                    selected={candidate.id === activeCandidateId}
                                    disabled={decisionBusy}
                                    onSelect={() => setSelectedCandidateId(candidate.id)}
                                  />
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  }
                  const displayCandidates = (() => {
                    const chosenId = run?.artifacts.chosenId;
                    if (!chosenId) return candidates;
                    const chosen = candidates.find((c) => c.id === chosenId);
                    if (!chosen) return candidates;
                    return [chosen, ...candidates.filter((c) => c.id !== chosenId)];
                  })();
                  return (
                    <div className="grid gap-2 md:grid-cols-3 md:gap-3.5">
                      {displayCandidates.map((candidate) => (
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
                  );
                })()
              ) : (
                <div className="rounded-xl border border-dashed border-paper-300 bg-paper-100/40 px-4 py-6 text-center text-[13px] text-ink-500 sm:py-8">
                  点上面「开始上架评审」后，这里会给出稳价、跟价、冲量三套方案。
                </div>
              )}

              <details data-testid="cost-details" className="rounded-xl border border-paper-300 bg-paper-100/40 p-3"><summary className="cursor-pointer text-xs font-medium text-ink-700">成本、现金流与完整风控</summary><div className="mt-3 space-y-4">
              {activeCandidate === undefined ? null : (
                <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="min-w-0 rounded-2xl border border-paper-300 bg-paper-100/40 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-display text-[14.5px] font-semibold text-ink-900">
                          单件成本与净利拆解
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

                  <div className="min-w-0 rounded-2xl border border-paper-300 bg-paper-100/40 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-display text-[14.5px] font-semibold text-ink-900">
                          30 天现金流
                        </div>
                        <div className="text-[11.5px] text-ink-500">
                          一般情况 {moneyInt(activeCandidate.sim.p50Cents)} · 较差情况 {moneyInt(activeCandidate.sim.p10Cents)} · 最低现金 {moneyInt(activeCandidate.sim.minCashCents)}
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
                <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="min-w-0 rounded-2xl border border-paper-300 bg-paper-50 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-1">
                      <span className="font-display text-[14.5px] font-semibold text-ink-900">
                        这套策略的风控
                      </span>
                      <span className="text-[11.5px] text-ink-500 break-words">{activeCandidate.verdict}</span>
                    </div>
                    <ChecksList rows={activeCandidate.checks} />
                  </div>

                  <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-paper-300 bg-paper-50 p-4">
                    <div>
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
                        <span className="font-display text-[14.5px] font-semibold text-ink-900">
                          决议和报告
                        </span>
                        <Pill tone={statusMeta?.tone ?? "ink"}>
                          {statusMeta?.label ?? run.status}
                        </Pill>
                      </div>

                      {run.status === "rejected" ? (
                        <div className="rounded-xl border border-seal-500/40 bg-seal-100/50 p-3.5 text-[12.5px] leading-relaxed text-seal-600">
                          <div className="font-semibold">掌柜已驳回</div>
                          <p className="mt-1">这件不上架，也不会生成通过报告。</p>
                        </div>
                      ) : currentStatus === "running" ? (
                        <p className="text-[12.5px] leading-relaxed text-ink-500">
                          会签还在进行中，等你拍板通过后才会生成并封存报告。
                        </p>
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
                          还在等你拍板。通过之后，这里会写下最终结论。
                        </p>
                      )}
                    </div>

                    {!busy && (run.status === "completed" || run.status === "rejected") ? (
                      <SealStamp
                        hash={run.fingerprint}
                        at={run.createdAt}
                        label={
                          run.status === "rejected"
                            ? "掌柜已驳回 · 已封存"
                            : `掌柜已拍板 · ${strategyName(run.artifacts.chosenId)}`
                        }
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
              </div></details>
            </div>
          </Panel>
          <DeliberationBoard report={run?.artifacts.deliberation} running={busy} />
          {run?.artifacts.collaboration ? <CollaborationEvidence collaboration={run.artifacts.collaboration} calls={run.calls}><CredentialLine events={visibleEvents} nodeId="challenge" run={run} /></CollaborationEvidence> : null}

          <Panel data-testid="live-ledger">
            <PanelHead
              title={
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-display text-[17px] font-semibold text-ink-900">
                    这次评审
                  </span>
                </div>
              }
              desc={
                statusMeta === null ? "各环节的结论会记在下面" : statusMeta.summary
              }
              right={
                <div className="flex flex-wrap items-center gap-2">
                  {currentStatus === "running" ? (
                    <Pill tone="ochre">实时会签中 · 尚未封存</Pill>
                  ) : null}
                  {!busy && run !== null && openedFromHistory ? (
                    <Pill tone="ink">已封存历史卷宗</Pill>
                  ) : null}
                  {!busy && run !== null && run.status !== "running" ? (
                    replayCount === null ? (
                      <button
                        type="button"
                        data-testid="replay-sealed-button"
                        onClick={startSealedReplay}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-paper-100 px-2.5 py-1 text-[11.5px] font-medium text-ink-700 ring-1 ring-inset ring-paper-300 hover:bg-paper-150"
                      >
                        <History className="h-3.5 w-3.5" />
                        回放已封存记录
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 rounded-lg bg-ochre-100 px-2.5 py-1 text-[11.5px] text-ochre-500 ring-1 ring-inset ring-ochre-500/30">
                        <span data-testid="sealed-replay-status" className="font-medium">
                          已封存回放（非实时工作）：{replayCount} / {run.events.length}
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

            <details data-testid="review-audit" open={run === null || busy} className="p-3 sm:p-4"><summary className="cursor-pointer text-xs font-semibold text-ink-700">查看商品证据、核算台账与修正记录</summary>
            <div className="mt-3 flex flex-col gap-3">
              <div className="grid gap-3.5 lg:grid-cols-2">
                <div className="rounded-xl border border-paper-300 bg-paper-100/50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[14.5px] font-semibold text-ink-900">
                      一、商品证据与待确认项
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
                    <p className="mt-2 text-[12.5px] text-ink-500">还没开始，点上面开始评审。</p>
                  ) : (
                    <div className="mt-2.5 flex flex-col gap-2.5 text-[12.5px]">
                      <div className="rounded-lg bg-paper-50 px-3 py-2 text-ink-800 ring-1 ring-inset ring-paper-200">
                        <span className="font-medium">摘要：</span>
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
                          <div className="text-[11.5px] font-semibold text-ochre-600">
                            还有这些问题要确认：
                          </div>
                          <ul className="mt-1.5 space-y-2 text-[11.5px] text-ink-700">
                            {facts.questions.map((question) => (
                              <li
                                key={question.id}
                                className="rounded-lg border border-paper-200/80 bg-paper-50 p-2"
                              >
                                <span className="font-medium text-ink-900">{question.ask}</span>
                                <span className="block text-[11px] text-ink-500 sm:ml-1 sm:inline">
                                  （{question.why}）
                                </span>
                                {followUps.some((item) => item.id === question.id) ? (
                                  <span className="block text-[11px] text-ochre-500">已在拍板区上方提供填写框。</span>
                                ) : null}
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
                      二、成本与保本价
                    </span>
                    <Pill tone={breakEvenCents > 0 ? "seal" : "ink"}>
                      {breakEvenCents > 0 ? `保本红线 ${money(breakEvenCents)}` : "待核算"}
                    </Pill>
                  </div>

                  {unit === null || breakEvenCents <= 0 ? (
                    <p className="mt-2 text-[12.5px] text-ink-500">还没算出成本。</p>
                  ) : (
                    <div className="mt-2.5 flex flex-col gap-2.5">
                      <div className="grid grid-cols-2 gap-2.5 rounded-xl border border-paper-300/80 bg-paper-50 p-3">
                        <div>
                          <div className="text-[11px] text-ink-500">核定单件成本</div>
                          <div className="tabular mt-0.5 font-display text-[24px] font-semibold leading-tight text-ink-900">
                            {money(unit.totalCents)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-400">含退货和平台费用</div>
                        </div>
                        <div className="border-l border-paper-200 pl-3">
                          <div className="text-[11px] text-seal-600">保本价（不赚不亏）</div>
                          <div
                            data-testid="ledger-break-even-price"
                            className="tabular mt-0.5 font-display text-[24px] font-semibold leading-tight text-seal-600"
                          >
                            {money(breakEvenCents)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-500">
                            目标毛利 {pct(run?.artifacts.product?.targetMargin ?? 0.25, 0)}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 text-[11.5px] tabular sm:grid-cols-3">
                        <div className="rounded-lg bg-paper-50 px-2.5 py-1.5 ring-1 ring-inset ring-paper-200">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-ink-500">采购：</span>
                            {taskFacts?.buyCents === null ? (
                              <span className="rounded bg-ochre-100 px-1 py-0.5 text-[9.5px] font-normal text-ochre-600 ring-1 ring-inset ring-ochre-500/20">
                                演示值
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 font-medium text-ink-900">{money(unit.buyCents)}</div>
                        </div>
                        <div className="rounded-lg bg-paper-50 px-2.5 py-1.5 ring-1 ring-inset ring-paper-200">
                          <span className="text-ink-500">包材：</span>
                          <span className="font-medium text-ink-900">{money(unit.packagingCents)}</span>
                        </div>
                        <div className="rounded-lg bg-paper-50 px-2.5 py-1.5 ring-1 ring-inset ring-paper-200">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-ink-500">快递：</span>
                            {taskFacts?.shippingCents === null ? (
                              <span className="rounded bg-ochre-100 px-1 py-0.5 text-[9.5px] font-normal text-ochre-600 ring-1 ring-inset ring-ochre-500/20">
                                演示值
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 font-medium text-ink-900">{money(unit.shippingCents)}</div>
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
                      三、三套报价
                    </span>
                    <Pill tone="jade">
                      {run?.artifacts.chosenId
                        ? `推荐：${strategyName(run.artifacts.chosenId)}`
                        : "待模拟"}
                    </Pill>
                  </div>

                  {run === null || run.artifacts.prices.length === 0 ? (
                    <p className="mt-2 text-[12.5px] text-ink-500">还没给出报价。</p>
                  ) : (
                    <div className="mt-2.5 flex flex-col gap-2">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
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
                      四、风控复核
                    </span>
                    {risk === null ? (
                      <Pill tone="ink">待复核</Pill>
                    ) : (
                      <Pill tone={VERIFICATION_META[risk.level].tone}>
                        {VERIFICATION_META[risk.level].label}
                      </Pill>
                    )}
                  </div>

                  {risk === null ? (
                    <p className="mt-2 text-[12.5px] text-ink-500">还没复核。</p>
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
                                {ownerAgent.name}
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


            </div>
            </details>
          </Panel>

          {run === null || run.artifacts.copy === null ? null : (
            <Panel data-testid="listing-copy">
              <details className="p-3 sm:p-4"><summary className="cursor-pointer text-xs font-semibold text-ink-700">上架文案 · 展开复制标题与卖点</summary>
              <PanelHead
                title="上架文案"
                desc="带「需你确认」的卖点，上架前再对一下实物。"
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
                    候选标题
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
                    {currentStatus === "running"
                      ? "当前先展示本地规则初稿；文案节点完成后更新最终标题与卖点。"
                      : "带需确认标记的内容，请核对实物后使用。"}
                  </p>
                </div>

                <div className="flex flex-col gap-2.5">
                  <div className="text-[12.5px] font-semibold text-ink-800">
                    五条卖点
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
              </details>
            </Panel>
          )}
        </div>

        <aside className="flex flex-col gap-4 xl:sticky xl:top-4 xl:max-h-[calc(100vh-32px)] xl:overflow-auto">
          <Panel>
            <PanelHead
              title="最近几次"
              desc={
                decisionBusy
                  ? "拍板已送出，请稍候完成后再看历史记录"
                  : busy
                    ? "会签进行中，完成后可查看历史"
                    : runs.length === 0
                      ? "还没有记录"
                      : "点开可以再看"
              }
              right={<FileSpreadsheet className="h-4 w-4 text-seal-500" />}
            />
            <div className="flex max-h-[240px] flex-col gap-1.5 overflow-auto px-3 py-2.5">
              {runs.length === 0 ? (
                <p className="px-2 py-3 text-[12px] text-ink-400">还没有记录</p>
              ) : (
                runs.map((item) => {
                  const itemStatus = RUN_STATUS_META[item.status] ?? {
                    label: item.status,
                    tone: "ink" as PillTone,
                    summary: "",
                  };
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`history-run-${item.id}`}
                      disabled={busy || decisionBusy}
                      onClick={() => {
                        void openRunFromHistory(item.id);
                      }}
                      className={cn(
                        "rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        run?.id === item.id
                          ? "border-seal-500/50 bg-paper-100"
                          : "border-transparent bg-paper-100/50 hover:border-paper-300 hover:bg-paper-100",
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <Pill tone={itemStatus.tone}>{itemStatus.label}</Pill>
                        <span className="tabular text-[11px] font-semibold text-ink-800">
                          {item.priceCents > 0
                            ? `¥${String(Math.floor(item.priceCents / 100))}.${String(item.priceCents % 100).padStart(2, "0")}`
                            : "—"}{" "}
                          · 毛利 {String(Math.round(item.margin * 100))}%
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

          <Panel data-testid="event-stream-panel">
            <PanelHead
              title="评审过程"
              desc={
                visibleEvents.length === 0
                  ? "开始后会按完成顺序出现在这里"
                  : replayCount !== null
                    ? `已封存回放（非实时工作） · ${String(visibleEvents.length)} / ${String(run?.events.length ?? visibleEvents.length)} 步`
                    : `已记下 ${String(visibleEvents.length)} 步`
              }
              right={<Scale className="h-4 w-4 text-ink-500" />}
            />
            <div className="max-h-[340px] overflow-auto px-3.5 py-3">
              {visibleEvents.length === 0 ? (
                <p className="py-4 text-center text-[12px] text-ink-400">还没有过程记录</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {visibleEvents.map((event) => {
                    const agentName =
                      event.agentId === null
                        ? null
                        : (run?.agents.find((a) => a.id === event.agentId)?.name ??
                          catalog?.agents.find((a) => a.id === event.agentId)?.name ??
                          prettyRole(event.agentId));
                    const { title: displayTitle, rawToolId } = prettyEventTitle(event, catalog);
                    return (
                      <li
                        key={event.seq}
                        data-testid={`event-item-${String(event.seq)}`}
                        className="rounded-xl border border-paper-200 bg-paper-100/60 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="text-[12px] font-semibold text-ink-900">
                            {displayTitle}
                          </span>
                          {agentName === null ? null : <Pill tone="ink">{agentName}</Pill>}
                        </div>
                        <details className="mt-1">
                          <summary className="cursor-pointer select-none text-[11px] text-ink-400 hover:text-ink-600">
                            详情
                          </summary>
                          {event.detail.trim().length === 0 ? null : (
                            <p className="mt-1 text-[11px] leading-relaxed text-ink-600">
                              {event.detail}
                            </p>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-ink-400">
                            <span>#{String(event.seq).padStart(2, "0")}</span>
                            <span>{event.type}</span>
                            {rawToolId === null ? null : <span>{rawToolId}</span>}
                            <span>
                              {shortHash(event.prevHash, 8)} → {shortHash(event.hash, 8)}
                            </span>
                          </div>
                          <div
                            data-testid={`event-hash-full-${String(event.seq)}`}
                            className="mt-1 rounded bg-paper-50/90 px-2 py-1 font-mono text-[9.5px] leading-snug text-ink-500 ring-1 ring-inset ring-paper-200/80"
                          >
                            <div className="break-all">
                              <span className="text-ink-400">prev: </span>
                              <span className="select-all">{event.prevHash}</span>
                            </div>
                            <div className="break-all">
                              <span className="text-ink-400">hash: </span>
                              <span className="select-all text-ink-700">{event.hash}</span>
                            </div>
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </Panel>

          <Panel data-testid="collaborators-panel">
            <PanelHead
              title="谁在协作"
              desc={`${String((run?.agents ?? catalog?.agents ?? []).length)} 个角色 · 点开看职责与工具`}
              right={<Bot className="h-4 w-4 text-ink-500" />}
            />
            <div className="flex flex-col gap-1.5 px-3.5 py-3">
              {(run?.agents ?? catalog?.agents ?? []).map((agent) => {
                const calls = run?.calls[agent.id] ?? 0;
                const fails = run?.failures[agent.id] ?? 0;
                return (
                  <details
                    key={agent.id}
                    data-testid={`role-card-${agent.id}`}
                    className="group rounded-xl border border-paper-200/90 bg-paper-100/50 px-3 py-2"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 select-none">
                      <span className="text-[12px] font-semibold text-ink-900">{agent.name}</span>
                      <div className="flex items-center gap-1">
                        {calls > 0 ? <Pill tone="jade">做过 {calls} 次</Pill> : <Pill tone="plain">待命</Pill>}
                        {fails > 0 ? <Pill tone="seal">未过 {fails} 次</Pill> : null}
                        <span className="ml-1 text-[10.5px] text-ink-400 group-open:text-ink-600">
                          职责
                        </span>
                      </div>
                    </summary>
                    <div className="mt-2 border-t border-paper-200/80 pt-1.5 text-[11px] leading-relaxed text-ink-600">
                      <p>{agent.role}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {agent.tools.map((tool) => (
                          <span
                            key={tool}
                            className="inline-flex items-center gap-1 rounded bg-paper-200/75 px-1.5 py-0.5 text-[10px] text-ink-700"
                          >
                            <span>{prettyToolName(tool, catalog)}</span>
                            <code className="font-mono text-[9.5px] text-ink-400">{tool}</code>
                          </span>
                        ))}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </Panel>
        </aside>
      </div>

      <footer className="order-3 flex flex-wrap items-center justify-between gap-2 border-t border-paper-300/80 px-2 pt-3 text-[11px] leading-relaxed text-ink-500">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Layers3 className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          <span>
            核算与风控使用本地规则；模型可辅助提问和写文案，失败会标明规则兜底。台面默认停在「需我拍板」。
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10.5px] text-ink-400">
          {run === null ? null : (
            <details data-testid="run-proof" className="text-right">
              <summary className="cursor-pointer select-none text-ink-500 hover:text-ink-800">
                卷宗 {run.id} · {currentStatus === "running" ? "实时指纹（未封存）" : "指纹"}{" "}
                {shortHash(run.fingerprint, 12)} · 查看凭证
              </summary>
              <div className="mt-1 rounded-lg border border-paper-300 bg-paper-50 px-2.5 py-1.5 text-left font-mono text-[10px] text-ink-600">
                <div>
                  {currentStatus === "running" ? "当前阶段指纹（未封存）：" : "完整运行指纹："}
                  <span data-testid="run-fingerprint-full" className="select-all break-all text-ink-900">
                    {run.fingerprint}
                  </span>
                </div>
                <div className="mt-1 text-ink-400">
                  接口兼容说明：直调 API 未传 autoApprove 时默认 true 保持兼容。
                </div>
              </div>
            </details>
          )}
        </div>
      </footer>
    </div>
  );
}
