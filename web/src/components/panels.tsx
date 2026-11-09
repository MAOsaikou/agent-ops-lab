import { AlertTriangle, Check, CircleDot, Lock, ShieldAlert, Store, X } from "lucide-react";

import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { SCENARIO_TEXT, STOP_TEXT, SUPPLIER_TEXT } from "../lib/nodes.js";
import type { RunMeta, ScenarioCatalog } from "../lib/contract.js";
import { percent, yuan, yuanCompact } from "../lib/utils.js";
import type { UiState } from "../state/reducer.js";

const ROSTER: readonly { readonly id: string; readonly name: string; readonly duty: string }[] = [
  { id: "buyer", name: "采购 Agent", duty: "下单与供应商选择" },
  { id: "pricer", name: "定价 Agent", duty: "价格与促销" },
  { id: "marketer", name: "营销 Agent", duty: "投放与保价" },
  { id: "critic", name: "Critic", duty: "质询与反对意见" },
  { id: "reflect", name: "复盘 Agent", duty: "经验写回知识库" },
];

export function AgentCards({ state }: { readonly state: UiState }): React.JSX.Element {
  const byAgent = new Map<string, { version?: string; score?: number; status: string }>();
  for (const node of Object.values(state.nodes)) {
    if (node.agent === undefined) {
      continue;
    }
    const [agentId, version] = node.agent.split("@");
    if (agentId === undefined) {
      continue;
    }
    byAgent.set(agentId, {
      ...(version === undefined ? {} : { version }),
      ...(node.score === undefined ? {} : { score: node.score }),
      status: node.status,
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent 席位</CardTitle>
        <CardDescription>调度事件里的版本号与评分来自 NodeScheduled 载荷</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {ROSTER.map((agent) => {
          const live = byAgent.get(agent.id);
          const active = live !== undefined;
          return (
            <div
              key={agent.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 px-2.5 py-1.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-mist-100">
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-lock-400" : "bg-ink-600"}`} />
                  {agent.name}
                </div>
                <div className="truncate text-[10px] text-mist-500">{agent.duty}</div>
              </div>
              <div className="text-right">
                {live?.version === undefined ? (
                  <Badge tone="muted">未激活</Badge>
                ) : (
                  <Badge tone="flow">v{live.version}</Badge>
                )}
                {live?.score === undefined ? null : (
                  <div className="mt-0.5 text-[10px] tabular-nums text-mist-500">评分 {live.score.toFixed(2)}</div>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function VerifyPanel({ state, round }: { readonly state: UiState; readonly round: number | null }): React.JSX.Element {
  const rows = state.loops.filter((loop) => (round === null ? true : loop.round === round));
  const shown = rows.slice(-6);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>分层验证与修正循环</CardTitle>
        <CardDescription>事件来源 LoopIterated（U5 只持久化这一层，未通过检查项 ID 不进事件流）</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-600/70 px-3 py-6 text-center text-xs text-mist-500">
            还没有验证事件。开始回放后，这里会出现每一轮修正的判定、p50 与停止原因。
          </div>
        ) : (
          shown.map((loop) => (
            <div
              key={`${String(loop.round)}-${String(loop.iteration)}-${loop.decisionHash}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-ink-700/60 bg-ink-900/50 px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2 text-[11px]">
                <Badge tone={loop.verdict === "pass" ? "lock" : loop.verdict === "revise" ? "warn" : "risk"}>
                  {loop.verdict === "pass" ? "通过" : loop.verdict === "revise" ? "退回修正" : "拒绝"}
                </Badge>
                <span className="text-mist-300">
                  第 {loop.round + 1} 回合 · 迭代 {loop.iteration}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[10px] tabular-nums text-mist-500">
                <span>p50 {yuanCompact(loop.p50)}</span>
                <span>调用 {loop.callsUsed}</span>
                <span className={loop.stopReason === null ? "text-mist-500" : "text-warn-400"}>
                  {loop.stopReason === null ? "继续" : (STOP_TEXT[loop.stopReason] ?? loop.stopReason)}
                </span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function SandboxPanel({
  state,
  meta,
  round,
}: {
  readonly state: UiState;
  readonly meta: RunMeta | null;
  readonly round: number | null;
}): React.JSX.Element {
  const loops = state.loops.filter((loop) => (round === null ? true : loop.round === round));
  const last = loops.at(-1);
  const settled = state.rounds.find((row) => row.round === round);
  return (
    <Card>
      <CardHeader>
        <CardTitle>沙盘区间</CardTitle>
        <CardDescription>沙盘 p50 来自验证管线写入的 LoopIterated</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-xs">
        <div className="flex items-baseline justify-between">
          <span className="text-mist-500">沙盘 p50 利润</span>
          <span className="text-sm font-semibold tabular-nums text-mist-100">
            {last === undefined ? "—" : yuan(last.p50)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-mist-500">缺货风险 / 库存</span>
          <span className="tabular-nums text-mist-300">
            {settled?.outcome === undefined
              ? "—"
              : `${String(settled.outcome.missed)} 件缺货 · 茶 ${String(settled.outcome.inventory.tea)} / 零食 ${String(
                  settled.outcome.inventory.snack,
                )}`}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-mist-500">本局调用量</span>
          <span className="tabular-nums text-mist-300">
            {meta === null ? "—" : `${String(meta.calls)} 次 · ${meta.callRoles.length} 个角色`}
          </span>
        </div>
        <div className="rounded-lg border border-dashed border-ink-600/70 px-2.5 py-1.5 text-[10px] leading-relaxed text-mist-500">
          p10 / p90 只在验证管线内部参与判定，U5 未把区间写进事件流；界面不猜这两个数字。
        </div>
      </CardContent>
    </Card>
  );
}

export function CrisisCard({
  catalog,
  round,
}: {
  readonly catalog: ScenarioCatalog | undefined;
  readonly round: number | null;
}): React.JSX.Element {
  const index = round ?? 0;
  const primary = catalog?.primaryCapacity[index];
  const backup = catalog?.backupCapacity[index];
  const tea = catalog?.competitorPrice.tea[index];
  const prevTea = index > 0 ? catalog?.competitorPrice.tea[index - 1] : undefined;
  const supplyCut = primary === 0 || backup === 0;
  const priceDrop = tea !== undefined && prevTea !== undefined && tea < prevTea;
  const label = supplyCut
    ? `${primary === 0 ? SUPPLIER_TEXT["primary"] : SUPPLIER_TEXT["backup"]}断供`
    : priceDrop
      ? "竞品降价"
      : "本回合无危机";
  const detail = supplyCut
    ? `第 ${index + 1} 回合公告产能为 0，调度器插入供应协商子工作流`
    : priceDrop
      ? `竞品茶饮价 ${String(prevTea)} → ${String(tea)} 分，触发价格战仲裁`
      : "公开新闻里没有危机信号，条件节点走维持预算分支";
  return (
    <Card>
      <CardHeader>
        <CardTitle>危机卡</CardTitle>
        <CardDescription>危机日程由场景与种子确定，写入事件日志后可重放</CardDescription>
      </CardHeader>
      <CardContent className="flex items-start gap-2">
        <AlertTriangle className={`mt-0.5 h-4 w-4 ${supplyCut || priceDrop ? "text-warn-400" : "text-mist-500"}`} />
        <div>
          <div className="text-xs font-semibold text-mist-100">
            {label}
            <span className="ml-2 text-[10px] font-normal text-mist-500">
              第 {index + 1} 回合 · {catalog === undefined ? "未选择场景" : SCENARIO_TEXT[catalog.name]}
            </span>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-mist-500">{detail}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export function GateBar({ state, round }: { readonly state: UiState; readonly round: number | null }): React.JSX.Element {
  const settled = state.rounds.find((row) => row.round === round);
  return (
    <Card>
      <CardHeader>
        <CardTitle>店长审批</CardTitle>
        <CardDescription>U5 回合工作流未声明 humanGate 节点，运行时审批固定为自动批准</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[11px]">
          <Badge tone={settled?.committed === true ? "lock" : "muted"}>
            {settled?.committed === true ? "已自动批准并锁定" : "等待提交"}
          </Badge>
          {settled?.source === undefined ? null : (
            <span className="text-mist-500">
              决策来源：{settled.source === "fallback" ? "安全兜底" : "验证通过"}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="lock" disabled title="U5 工作流没有人工审批节点，审批自动通过">
            <Check className="h-3.5 w-3.5" />
            批准
          </Button>
          <Button size="sm" variant="outline" disabled title="U5 工作流没有人工审批节点，退回入口不可用">
            <X className="h-3.5 w-3.5" />
            退回
          </Button>
          <Button size="sm" variant="danger" disabled title="U5 工作流没有人工审批节点，否决入口不可用">
            <ShieldAlert className="h-3.5 w-3.5" />
            否决
          </Button>
        </div>
        <div className="text-[10px] leading-relaxed text-mist-500">
          审批按钮置灰是如实反映能力边界：要让退回把回合打回修正并让循环计数加一，需要 U6 之后给回合工作流加人工节点，本单元不动市场与工作流语义。
        </div>
      </CardContent>
    </Card>
  );
}

export function EventLog({ state }: { readonly state: UiState }): React.JSX.Element {
  const rows = [...state.log].slice(-40).reverse();
  const tone: Record<string, string> = {
    muted: "text-mist-500",
    flow: "text-flow-400",
    lock: "text-lock-400",
    warn: "text-warn-400",
    risk: "text-risk-400",
  };
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>事件流</CardTitle>
        <CardDescription>按 seq 顺序折叠，重复事件忽略、乱序事件缓冲后补齐</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[232px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-600/70 px-3 py-6 text-center text-xs text-mist-500">
            还没有事件。开始回放后事件会按 seq 追加在这里。
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((entry) => (
              <li key={`${String(entry.seq)}-${entry.text}`} className="flex items-start gap-2 text-[11px]">
                <span className="w-9 shrink-0 text-right font-mono text-[10px] text-mist-500">{entry.seq}</span>
                <CircleDot className={`mt-0.5 h-3 w-3 shrink-0 ${tone[entry.tone] ?? "text-mist-500"}`} />
                <span className="text-mist-300">{entry.text}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function LedgerSummary({ state, expected }: { readonly state: UiState; readonly expected: number }): React.JSX.Element {
  const locked = state.rounds.filter((row) => row.locked).length;
  const profit = state.rounds.reduce((sum, row) => sum + (row.outcome?.profit ?? 0), 0);
  const cash = state.rounds.at(-1)?.outcome?.cash;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-lock-400" />
          账本锁定
        </CardTitle>
        <CardDescription>已结算回合立即上锁，界面与接口都不提供重做</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-ink-700/60 bg-ink-900/50 px-2.5 py-1.5">
          <div className="text-[10px] text-mist-500">已锁定回合</div>
          <div className="tabular-nums text-lock-400" data-testid="locked-count">
            {locked}/{expected}
          </div>
        </div>
        <div className="rounded-lg border border-ink-700/60 bg-ink-900/50 px-2.5 py-1.5">
          <div className="text-[10px] text-mist-500">累计利润</div>
          <div className={`tabular-nums ${profit >= 0 ? "text-lock-400" : "text-risk-400"}`}>
            {state.rounds.length === 0 ? "—" : yuan(profit)}
          </div>
        </div>
        <div className="col-span-2 rounded-lg border border-ink-700/60 bg-ink-900/50 px-2.5 py-1.5">
          <div className="text-[10px] text-mist-500">现金</div>
          <div className="tabular-nums text-mist-100">{cash === undefined ? "—" : yuan(cash)}</div>
        </div>
        <div className="col-span-2 flex items-center gap-1.5 text-[10px] text-mist-500">
          <Store className="h-3 w-3" />
          重做入口：无（界面没有按钮，接口返回 409）
        </div>
        <div className="col-span-2 text-[10px] text-mist-500">
          已锁定比例 {expected === 0 ? "0%" : percent(locked / expected)}
        </div>
      </CardContent>
    </Card>
  );
}
