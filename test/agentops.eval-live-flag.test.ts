import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import type { LlmCompletion } from "../src/engine/llm/client.js";
import type { LiveLlm } from "../src/templates/agentops/llm.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Unit 1 的实现文件 src/templates/agentops/eval/live-flag.ts 本轮尚未创建。
// 用动态 import 让每个用例独立失败（先红），实现落地后同一批断言转绿。
type LiveFlagModule = typeof import("../src/templates/agentops/eval/live-flag.js");

async function loadLiveFlag(): Promise<LiveFlagModule> {
  return import("../src/templates/agentops/eval/live-flag.js");
}

function fakeLiveLlm(): LiveLlm {
  return {
    model: "mock-live-flag-model",
    baseUrl: "http://mock.invalid",
    client: {
      complete: async (): Promise<LlmCompletion> => ({
        text: "{}",
        usage: { promptTokens: 0, completionTokens: 0 },
      }),
    },
  };
}

describe("Unit 1: eval live flag (--live entry for scripts/exp.ts)", () => {
  test("parseExpArgs: no argv defaults to offline", async () => {
    const { parseExpArgs } = await loadLiveFlag();
    expect(parseExpArgs([])).toEqual({ live: false });
  });

  test("parseExpArgs: --live opts in", async () => {
    const { parseExpArgs } = await loadLiveFlag();
    expect(parseExpArgs(["--live"])).toEqual({ live: true });
  });

  test("parseExpArgs: --live after a -- separator still opts in", async () => {
    const { parseExpArgs } = await loadLiveFlag();
    expect(parseExpArgs(["--", "--live"])).toEqual({ live: true });
  });

  test("parseExpArgs: misspelled --livee must throw instead of silently running offline", async () => {
    const { parseExpArgs } = await loadLiveFlag();
    expect(() => parseExpArgs(["--livee"])).toThrow();
  });

  test("parseExpArgs: any other unrecognized argument must throw", async () => {
    const { parseExpArgs } = await loadLiveFlag();
    expect(() => parseExpArgs(["bogus"])).toThrow();
    expect(() => parseExpArgs(["--live", "--bogus"])).toThrow();
  });

  test("resolveEvalLive: throws EvalLiveUnavailableError naming both config channels when the store resolves null", async () => {
    const { EvalLiveUnavailableError, resolveEvalLive } = await loadLiveFlag();

    let caught: unknown;
    try {
      resolveEvalLive({ resolve: () => null });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught).toBeInstanceOf(EvalLiveUnavailableError);
    const error = caught as InstanceType<typeof EvalLiveUnavailableError>;
    expect(error.name).toBe("EvalLiveUnavailableError");
    // message 为中文，说明未配置状态与两条配置途径（面板保存的 llm-settings.json 与 AGENTOPS_LLM_ 环境变量前缀）。
    expect(/[一-鿿]/.test(error.message)).toBe(true);
    expect(error.message).toMatch(/未配置/);
    expect(error.message).toContain("llm-settings.json");
    expect(error.message).toContain("AGENTOPS_LLM_");
  });

  test("resolveEvalLive: returns the exact LiveLlm reference the store resolved", async () => {
    const { resolveEvalLive } = await loadLiveFlag();
    const live = fakeLiveLlm();
    expect(resolveEvalLive({ resolve: () => live })).toBe(live);
  });

  test("scripts/exp.ts wires --live and resolves the model through openLlmSettingsStore", () => {
    const source = readFileSync(join(REPO_ROOT, "scripts", "exp.ts"), "utf8");
    expect(source).toContain("--live");
    expect(source).toContain("openLlmSettingsStore");
  });

  test("package.json keeps the exp script as `tsx scripts/exp.ts`", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["exp"]).toBe("tsx scripts/exp.ts");
  });
});
