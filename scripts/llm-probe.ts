import { parseRunId } from "../src/engine/ids.js";
import { createMockLlm } from "../src/engine/llm/mock.js";
import { resolveMode } from "../src/engine/llm/mode.js";

function requestedMode(argv: readonly string[]): string | undefined {
  const index = argv.indexOf("--mode");
  if (index === -1) return undefined;
  return argv[index + 1];
}

const requested = requestedMode(process.argv);
const mode = resolveMode({ hasApiKey: false });
if (requested !== "mock" || mode !== "mock") {
  console.error("llm-probe refuses a live call");
  process.exit(1);
}

console.log(`llm mode: ${mode}`);
const llm = createMockLlm();
const completion = await llm.complete({
  runId: parseRunId("probe"),
  round: 1,
  nodeId: "probe",
  attempt: 0,
  prompt: "ping",
  maxTokens: 16,
});
console.log(completion.text);
