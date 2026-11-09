import { KeyRound, ShieldCheck } from "lucide-react";

import { Badge } from "./ui/badge.js";
import type { ModeInfo } from "../lib/contract.js";

export function ModeBanner({ mode }: { readonly mode: ModeInfo | null }): React.JSX.Element {
  const noKey = mode === null || !mode.keyPresent;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl px-4 py-2 text-[12px] ring-1 ring-inset ${
        noKey ? "bg-warn-400/[0.06] ring-warn-400/20" : "bg-flow-400/[0.06] ring-flow-400/20"
      }`}
      data-testid="mode-banner"
    >
      <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-warn-400">
        {noKey ? <KeyRound className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        演示模式
      </span>
      <span className="text-mist-300">
        {mode?.detail ?? "没有配置模型密钥。数字来自规则市场与 Mock LLM 的确定性运行。"}
      </span>
      <span className="ml-auto flex items-center gap-1.5 text-[11px] text-mist-500">
        <span className="hidden sm:inline">{mode?.badge ?? "无密钥模式 · Mock LLM 确定性运行"}</span>
        <Badge tone="muted">llmMode = {mode?.llmMode ?? "mock"}</Badge>
      </span>
    </div>
  );
}
