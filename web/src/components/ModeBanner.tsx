import { KeyRound, ShieldCheck } from "lucide-react";

import { Badge } from "./ui/badge.js";
import type { ModeInfo } from "../lib/contract.js";

export function ModeBanner({ mode }: { readonly mode: ModeInfo | null }): React.JSX.Element {
  const noKey = mode === null || !mode.keyPresent;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl px-4 py-2.5 text-[12.5px] ring-1 ring-inset ${
        noKey ? "bg-warn-400/[0.08] ring-warn-400/25" : "bg-flow-400/[0.08] ring-flow-400/25"
      }`}
      data-testid="mode-banner"
    >
      <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-warn-400">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-warn-400/12">
          {noKey ? <KeyRound className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
        </span>
        {mode?.badge ?? "无密钥模式 · Mock LLM 确定性运行"}
      </span>
      <span className="text-mist-300">
        {mode?.detail ?? "没有配置模型密钥。数字来自规则市场与 Mock LLM 的确定性运行。"}
      </span>
      <Badge tone="muted" className="ml-auto">
        llmMode = {mode?.llmMode ?? "mock"}
      </Badge>
    </div>
  );
}
