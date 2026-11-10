import {
  Calculator,
  Gavel,
  Lock,
  PenLine,
  ShieldCheck,
  Tags,
  type LucideIcon,
} from "lucide-react";

import type { AgentKey, TraceStep } from "../../../src/templates/pricing/model.js";
import { cn } from "../lib/cn.js";
import { Pill } from "./Primitives.js";

type AgentMeta = {
  readonly name: string;
  readonly role: string;
  readonly icon: LucideIcon;
};

export const AGENT_META: Record<AgentKey, AgentMeta> = {
  accountant: { name: "成本会计", role: "把每一分钱拆开算", icon: Calculator },
  pricer: { name: "定价参谋", role: "出三套价", icon: Tags },
  risk: { name: "风控审核", role: "推演 30 天 + 逐项检查", icon: ShieldCheck },
  copywriter: { name: "文案手", role: "写标题和卖点", icon: PenLine },
  owner: { name: "掌柜", role: "拍板", icon: Gavel },
  ledger: { name: "账本", role: "锁定方案", icon: Lock },
};

const CARD_AGENTS: readonly AgentKey[] = ["accountant", "pricer", "risk", "copywriter"];

function statusOf(agent: AgentKey, steps: readonly TraceStep[], played: number): "waiting" | "working" | "done" {
  const own = steps.filter((step) => step.agent === agent);
  if (own.length === 0) {
    return "done";
  }
  const shown = own.filter((step) => step.index <= played);
  if (shown.length === 0) {
    return "waiting";
  }
  return shown.length === own.length ? "done" : "working";
}

export function AgentCards({
  steps,
  played,
}: {
  readonly steps: readonly TraceStep[];
  readonly played: number;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {CARD_AGENTS.map((agent) => {
        const meta = AGENT_META[agent];
        const status = statusOf(agent, steps, played);
        const current = steps.filter((step) => step.agent === agent && step.index <= played).at(-1);
        const Icon = meta.icon;
        return (
          <div
            key={agent}
            className={cn(
              "rounded-xl border p-3 transition-all duration-300",
              status === "waiting"
                ? "border-paper-200 bg-paper-100/60"
                : status === "working"
                  ? "border-seal-500/40 bg-seal-100/40 shadow-[0_10px_26px_-22px_rgba(196,68,43,0.9)]"
                  : "border-jade-500/30 bg-jade-100/40",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  status === "waiting"
                    ? "bg-paper-200 text-ink-400"
                    : status === "working"
                      ? "bg-seal-500 text-paper-50"
                      : "bg-jade-500 text-paper-50",
                )}
              >
                <Icon className="h-[15px] w-[15px]" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[12.5px] font-semibold text-ink-900">{meta.name}</div>
                <div className="truncate text-[10.5px] text-ink-400">{meta.role}</div>
              </div>
              {status === "working" ? (
                <span className="dot-pulse ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-seal-500" />
              ) : null}
            </div>
            <div
              className={cn(
                "mt-2 line-clamp-2 min-h-[28px] text-[11px] leading-snug",
                status === "waiting" ? "text-ink-300" : "text-ink-600",
              )}
            >
              {current === undefined
                ? status === "waiting"
                  ? "排队中"
                  : "已交活"
                : current.title}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TraceList({
  steps,
  played,
}: {
  readonly steps: readonly TraceStep[];
  readonly played: number;
}): React.JSX.Element {
  return (
    <ol className="flex flex-col">
      {steps.map((step) => {
        const visible = step.index <= played;
        const meta = AGENT_META[step.agent];
        return (
          <li
            key={step.index}
            className={cn(
              "relative flex gap-3 border-l-2 pl-4 pb-3.5 transition-all duration-500",
              visible ? "border-seal-500/30 opacity-100" : "border-paper-200 opacity-30",
            )}
          >
            <span
              className={cn(
                "absolute -left-[7px] top-1 h-3 w-3 rounded-full ring-2 ring-paper-50",
                visible ? "bg-seal-500" : "bg-paper-300",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-semibold text-ink-900">{meta.name}</span>
                <span className="text-[12px] text-ink-600">{step.title}</span>
                {visible ? <Pill tone="plain">{step.hash.slice(0, 6)}</Pill> : null}
              </div>
              <div className={cn("mt-0.5 text-[11.5px] leading-relaxed", visible ? "text-ink-500" : "text-ink-300")}>
                {visible ? step.detail : "…"}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}