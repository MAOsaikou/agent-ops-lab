import type { LiveLlm } from "../llm.js";

export class EvalLiveUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalLiveUnavailableError";
  }
}

export function parseExpArgs(argv: readonly string[]): { readonly live: boolean } {
  let live = false;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--") {
      i += 1;
      continue;
    }
    if (arg === "--live") {
      live = true;
      i += 1;
      continue;
    }
    throw new Error(`无法识别的参数: ${arg}（仅支持 --live）`);
  }
  return { live };
}

export function resolveEvalLive(store: { resolve(): LiveLlm | null }): LiveLlm {
  const live = store.resolve();
  if (live === null) {
    throw new EvalLiveUnavailableError(
      "真模型评测未配置：请先在面板中保存 llm-settings.json，或设置 AGENTOPS_LLM_ 前缀的环境变量（如 AGENTOPS_LLM_BASE_URL、AGENTOPS_LLM_MODEL、AGENTOPS_LLM_API_KEY）后再使用 --live。",
    );
  }
  return live;
}
