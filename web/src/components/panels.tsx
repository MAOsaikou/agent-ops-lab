import { AlertTriangle, Check, CircleDot, Lock, ShieldAlert, Store, X } from "lucide-react";

import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { SCENARIO_TEXT, STOP_TEXT, SUPPLIER_TEXT } from "../lib/nodes.js";
import type { RunMeta, ScenarioCatalog } from "../lib/contract.js";
import { percent, yuan, yuanCompact } from "../lib/utils.js";
import type { UiState } from "../state/reducer.js";

const ROSTER: readonly { readonly id: string; readonly name: string; readonly duty: string }[] = [
  { id: "buyer", name: "采购", duty: "负责进货和找供应商" },
  { id: "pricer", name: "定价", duty: "负责卖多少钱" },
  { id: "marketer", name: "营销", duty: "负责广告和促销" },
  { id: "critic", name: "复核员", duty: "检查这个主意会不会亏" },
  { id: "reflect", name: "店长复盘", duty: "记下今天的经验" },
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
        <CardTitle>店里的帮手</CardTitle>
        <CardDescription>采购、定价、营销各自做决定，复核员负责把关</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {ROSTER.map((agent) => {
          const live = byAgent.get(agent.id);
          const active = live !== undefined;
          return (
            <div
              key={agent.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-mist-100">
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-lock-400" : "bg-ink-600"}`} />
                  {agent.name}
                </div>
                <div className="truncate text-[11.5px] text-mist-400">{agent.duty}</div>
              </div>
              <div className="shrink-0 text-right">
                {live?.version === undefined ? (
                  <Badge tone="muted">还没轮到</Badge>
                ) : (
                  <Badge tone="flow">出手 {live.version}</Badge>
                )}
                {live?.score === undefined ? null : (
                  <div className="mt-1 text-[11px] tabular-nums text-mist-400">把握度 {live.score.toFixed(2)}</div>
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
        <CardTitle>拍板前的检查</CardTitle>
        <CardDescription>主意拿出去之前，复核员要过一遍：会不会缺货、会不会亏钱、要不要改一版</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        {shown.length === 0 ? (
          <div className="rounded-xl bg-white/[0.02] px-3 py-6 text-center text-[12.5px] text-mist-400">
            还没有检查结果。店里开始算账后，这里会告诉你这回合的主意能不能执行。
          </div>
        ) : (
          shown.map((loop) => (
            <div
              key={`${String(loop.round)}-${String(loop.iteration)}-${loop.decisionHash}`}
              className="flex items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2"
            >
              <div className="flex items-center gap-2 text-[12.5px]">
                <Badge tone={loop.verdict === "pass" ? "lock" : loop.verdict === "revise" ? "warn" : "risk"}>
                  {loop.verdict === "pass" ? "可以照做" : loop.verdict === "revise" ? "建议改改" : "这方案不行"}
                </Badge>
                <span className="text-mist-300">
                  第 {loop.round + 1} 回合 · 第 {loop.iteration} 版主意
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-[11.5px] tabular-nums text-mist-400">
                <span>预计利润 {yuanCompact(loop.p50)}</span>
                <span>出手 {loop.callsUsed}</span>
                <span className={loop.stopReason === null ? "text-mist-400" : "text-warn-400"}>
                  {loop.stopReason === null ? "继续算" : (STOP_TEXT[loop.stopReason] ?? loop.stopReason)}
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
        <CardTitle>先在小账本里算一遍</CardTitle>
        <CardDescription>拍板之前，店里会先估一下这回合大概能赚多少</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 text-[12.5px]">
        <div className="flex items-baseline justify-between">
          <span className="text-mist-400">预计利润（中位）</span>
          <span className="text-xl font-semibold tabular-nums tracking-tight text-mist-100">
            {last === undefined ? "—" : yuan(last.p50)}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-mist-400">实际缺货 / 剩货</span>
          <span className="tabular-nums text-mist-300">
            {settled?.outcome === undefined
              ? "—"
              : `${String(settled.outcome.missed)} 件没货卖 · 剩茶 ${String(settled.outcome.inventory.tea)} / 剩零食 ${String(
                  settled.outcome.inventory.snack,
                )}`}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-mist-400">这一局店里出手</span>
          <span className="tabular-nums text-mist-300">
            {meta === null ? "—" : `${String(meta.calls)} 次 · ${meta.callRoles.length} 个角色参与`}
          </span>
        </div>
        <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-[11.5px] leading-relaxed text-mist-400">
          预计利润只给一个中间值；上下浮动多少，这一版没有记录下来，所以不显示。
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
    ? `${primary === 0 ? SUPPLIER_TEXT["primary"] : SUPPLIER_TEXT["backup"]}没货了`
    : priceDrop
      ? "隔壁突然降价"
      : "今天风平浪静";
  const detail = supplyCut
    ? `第 ${index + 1} 回合${primary === 0 ? "老供应商" : "备选供应商"}交不出货，要不要马上找另一家谈进货价？`
    : priceDrop
      ? `隔壁茶饮从 ${String(prevTea)} 分降到 ${String(tea)} 分，店里要不要跟着降？`
      : "没有突发状况，今天把货备足、价格定准就好";
  const urgent = supplyCut || priceDrop;
  return (
    <Card>
      <CardHeader>
        <CardTitle>危机卡</CardTitle>
        <CardDescription>危机日程由场景与种子确定，可重放</CardDescription>
      </CardHeader>
      <CardContent className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
            urgent ? "bg-warn-400/12 text-warn-400" : "bg-white/[0.05] text-mist-400"
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-mist-100">
            {label}
            <span className="ml-2 text-[11.5px] font-normal text-mist-400">
              第 {index + 1} 回合 · {catalog === undefined ? "未选择场景" : SCENARIO_TEXT[catalog.name]}
            </span>
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-mist-400">{detail}</div>
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
        <CardTitle>店长拍板</CardTitle>
        <CardDescription>这一版还没有给店长留人工审批的环节，拍板由店里自己按规则完成</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <Badge tone={settled?.committed === true ? "lock" : "muted"}>
            {settled?.committed === true ? "已拍板并记进账本" : "还没拍板"}
          </Badge>
          {settled?.source === undefined ? null : (
            <span className="text-mist-400">
              这次是{settled.source === "fallback" ? "安全兜底方案" : "检查通过的方案"}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" variant="lock" disabled title="这一版没有人工审批环节，拍板自动完成">
            <Check className="h-3.5 w-3.5" />
            批准
          </Button>
          <Button size="sm" variant="outline" disabled title="这一版没有人工审批环节，退回用不了">
            <X className="h-3.5 w-3.5" />
            退回
          </Button>
          <Button size="sm" variant="danger" disabled title="这一版没有人工审批环节，否决用不了">
            <ShieldAlert className="h-3.5 w-3.5" />
            否决
          </Button>
        </div>
        <div className="text-[11.5px] leading-relaxed text-mist-400">
          这三个按钮是灰的，因为这一版还没给店长留人工审批这一步。要让「退回」真的把主意打回重算，得等后续版本加上人工环节。
        </div>
      </CardContent>
    </Card>
  );
}

function humanize(text: string): string {
  return text
    .replaceAll("主供应商", "老供应商")
    .replaceAll("供应商报价", "进货报价")
    .replaceAll("预算仲裁", "营销预算决定")
    .replaceAll("决策提交锁定", "店长拍板")
    .replaceAll("安全兜底决策", "稳妥方案")
    .replaceAll("验证通过决策", "检查通过的方案")
    .replaceAll("结算完成", "这回合结账")
    .replaceAll("广告边际", "广告预计")
    .replaceAll("降价边际", "降价预计")
    .replaceAll("分配 ", "决定花 ")
    .replaceAll("利润 ", "赚了 ")
    .replaceAll("现金", "手头现金")
    .replaceAll("复盘写入知识库 · 账本行闭合", "记下今天的经验 · 这一回合结束")
    .replaceAll(" · primary ", " · 老供应商 ")
    .replaceAll(" · backup ", " · 备选供应商 ")
    .replaceAll(" tea · ", " 茶饮 · ")
    .replaceAll(" snack · ", " 零食 · ")
    .replaceAll("修正循环第 ", "第 ")
    .replaceAll(" 次 · ", " 版主意 · ")
    .replace(/(-?\d+) 分/g, (_, value: string) => `¥${(Number(value) / 100).toFixed(2)}`)
    .replace(/p50 ¥/g, "预计利润 ¥")
    .replaceAll("赚了 -¥", "亏了 ¥")
    .replace(/@\d+\.\d+\.\d+/g, "")
    .replace(/ · [0-9a-f]{8,}$/, "");
}

export function EventLog({ state }: { readonly state: UiState }): React.JSX.Element {
  const rows = state.log
    .filter((entry) => entry.kind !== "node")
    .slice(-40)
    .reverse();
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
        <CardTitle>刚发生的事</CardTitle>
        <CardDescription>只记和生意有关的事：谈价、预算、拍板、结账、复盘，最新的在最上面</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[236px] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="rounded-xl bg-white/[0.02] px-3 py-6 text-center text-[12.5px] text-mist-400">
            店里还没开始忙。点上面的播放键，这里会一条条记下发生了什么。
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((entry) => (
              <li
                key={`${String(entry.seq)}-${entry.text}`}
                className="flex items-start gap-2 text-[12px] leading-relaxed"
                title={`第 ${String(entry.seq)} 条记录`}
              >
                <CircleDot className={`mt-1 h-3 w-3 shrink-0 ${tone[entry.tone] ?? "text-mist-500"}`} />
                <span className="text-mist-300">{humanize(entry.text)}</span>
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
          今天的经营账本
        </CardTitle>
        <CardDescription>每回合结算一次，赚亏、现金和库存都会留下来，已经结算的回合不能重来</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <div className="col-span-2 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="text-[11.5px] text-mist-400">已经结算</div>
          <div className="text-2xl font-semibold tabular-nums tracking-tight text-lock-400" data-testid="locked-count">
            {locked}/{expected}
          </div>
          <div className="text-[11px] text-mist-500">整天营业进度 {expected === 0 ? "0%" : percent(locked / expected)}</div>
        </div>
        <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="text-[11.5px] text-mist-400">一共赚了</div>
          <div className={`text-lg font-semibold tabular-nums tracking-tight ${profit >= 0 ? "text-lock-400" : "text-risk-400"}`}>
            {state.rounds.length === 0 ? "—" : yuan(profit)}
          </div>
        </div>
        <div className="rounded-xl bg-white/[0.03] px-3 py-2.5">
          <div className="text-[11.5px] text-mist-400">手上现金</div>
          <div className="text-lg font-semibold tabular-nums tracking-tight text-mist-100">
            {cash === undefined ? "—" : yuan(cash)}
          </div>
        </div>
        <div className="col-span-2 flex items-center gap-1.5 text-[11.5px] text-mist-400">
          <Store className="h-3 w-3" />
          已经结算的回合改不了：页面上没有重做按钮，账本也会拒绝重来（接口返回 409）。
        </div>
      </CardContent>
    </Card>
  );
}
