import { BENCHMARK_DATASET_HASH } from "../src/templates/agentops/eval/dataset.js";
import {
  ALL_TOPOLOGIES,
  formatEvalMarkdown,
  formatEvalTsv,
  runEvaluationSuite,
} from "../src/templates/agentops/eval/harness.js";
import { parseExpArgs, resolveEvalLive } from "../src/templates/agentops/eval/live-flag.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";

async function main(): Promise<void> {
  const { live: wantLive } = parseExpArgs(process.argv.slice(2));

  if (!wantLive) {
    process.stdout.write("模式：离线规则/mock 路径，未调用真模型（如需真模型对照请加 --live）。\n");
    const result = await runEvaluationSuite({ topologies: ALL_TOPOLOGIES });
    process.stdout.write(`${formatEvalMarkdown(result)}\n`);
    process.stdout.write(`${formatEvalTsv(result)}\n`);
    process.stdout.write(`datasetHash=${BENCHMARK_DATASET_HASH}\n`);
    return;
  }

  const live = resolveEvalLive(
    openLlmSettingsStore(`${process.cwd()}/.data/llm-settings.json`, process.env),
  );
  process.stdout.write(
    `模式：真模型对照（model=${live.model}，baseUrl=${live.baseUrl}）；密钥不会打印。\n`,
  );
  const result = await runEvaluationSuite({ topologies: ALL_TOPOLOGIES, live });
  process.stdout.write(`${formatEvalMarkdown(result)}\n`);
  process.stdout.write(`${formatEvalTsv(result)}\n`);
  process.stdout.write(`datasetHash=${BENCHMARK_DATASET_HASH}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
