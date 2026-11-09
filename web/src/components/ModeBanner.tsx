import { KeyRound, ShieldCheck } from "lucide-react";

import { Badge } from "./ui/badge.js";
import type { ModeInfo } from "../lib/contract.js";

export function ModeBanner({ mode }: { readonly mode: ModeInfo | null }): React.JSX.Element {
  const noKey = mode === null || !mode.keyPresent;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border px-3 py-2 text-xs ${
        noKey ? "border-warn-400/40 bg-warn-400/10" : "border-flow-400/40 bg-flow-400/10"
      }`}
      data-testid="mode-banner"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold text-warn-400">
        {noKey ? <KeyRound className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
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
