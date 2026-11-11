import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { openAgentRunStore } from "../src/server/agent-runs.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "agent-runs-"));
  dirs.push(dir);
  return dir;
}

function goodRun(id: string, createdAt: string): Record<string, unknown> {
  return {
    id,
    createdAt,
    status: "completed",
    task: { text: "好卷宗", autoApprove: true },
    artifacts: { prices: [{ id: "profit", priceCents: 3990, margin: 0.2 }], chosenId: "profit" },
    loops: [],
    verifications: [],
  };
}

describe("agent run store tolerates bad files on disk", () => {
  test("malformed JSON on disk is skipped on start and load() reports it as unreadable", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "good1.json"), JSON.stringify(goodRun("good1", "2026-01-02T00:00:00.000Z")));
    writeFileSync(path.join(dir, "broken1.json"), '{"id": "broken1", "status": ');
    const store = openAgentRunStore(dir);
    expect(store.list().map((row) => row.id)).toEqual(["good1"]);
    expect(store.load("broken1")).toBeUndefined();
    expect(store.inspect("broken1")).toEqual({ kind: "corrupt", reason: expect.stringContaining("JSON") });
    expect(store.inspect("missing9")).toEqual({ kind: "missing" });
    expect(store.inspect("good1").kind).toBe("ok");
  });

  test("a parsable file without artifacts/status does not make list() throw or hide good runs", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "good1.json"), JSON.stringify(goodRun("good1", "2026-01-02T00:00:00.000Z")));
    writeFileSync(path.join(dir, "hollow1.json"), JSON.stringify({ id: "hollow1", createdAt: "2026-01-03T00:00:00.000Z" }));
    writeFileSync(
      path.join(dir, "oddstatus1.json"),
      JSON.stringify({ ...goodRun("oddstatus1", "2026-01-04T00:00:00.000Z"), status: "paused" }),
    );
    const store = openAgentRunStore(dir);
    expect(() => store.list()).not.toThrow();
    expect(store.list().map((row) => row.id)).toEqual(["good1"]);
    expect(store.inspect("hollow1").kind).toBe("corrupt");
    expect(store.inspect("oddstatus1").kind).toBe("corrupt");
  });

  test("a legacy-shaped run (older schema, missing optional blocks) stays listed and loadable", () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "legacy1.json"), JSON.stringify(goodRun("legacy1", "2026-01-02T00:00:00.000Z")));
    const store = openAgentRunStore(dir);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ id: "legacy1", status: "completed", priceCents: 3990, loops: 0, failures: 0 });
    expect(store.load("legacy1")?.id).toBe("legacy1");
  });

  test("ids that are not path-safe are never read from disk", () => {
    const store = openAgentRunStore(tempDir());
    expect(store.inspect("../etc/passwd")).toEqual({ kind: "missing" });
    expect(store.load("../etc/passwd")).toBeUndefined();
  });
});
