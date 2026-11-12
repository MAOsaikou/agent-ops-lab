import { describe, expect, test } from "vitest";

import {
  BENCHMARK_ARCHETYPES,
  BENCHMARK_CASES,
  BENCHMARK_DATASET_HASH,
  validateBenchmarkDataset,
  type BenchmarkCase,
} from "../src/templates/agentops/eval/dataset.js";

describe("Task 1: Frozen Evaluation Dataset & Objective Benchmark Contracts", () => {
  test("dataset contains exactly 12 cases across 6 distinct archetypes (2 cases per archetype)", () => {
    expect(BENCHMARK_CASES).toHaveLength(12);
    expect(BENCHMARK_ARCHETYPES).toHaveLength(6);
    expect(BENCHMARK_ARCHETYPES).toEqual([
      "standard",
      "missing_facts",
      "conflict_evidence",
      "cash_constraint",
      "failure_recovery",
      "should_reject",
    ]);

    for (const archetype of BENCHMARK_ARCHETYPES) {
      const matching = BENCHMARK_CASES.filter((c) => c.archetype === archetype);
      expect(matching).toHaveLength(2);
    }
  });

  test("BENCHMARK_DATASET_HASH is a valid 64-character lowercase hex literal", () => {
    expect(typeof BENCHMARK_DATASET_HASH).toBe("string");
    expect(BENCHMARK_DATASET_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  test("validateBenchmarkDataset returns true for frozen cases against literal hash", () => {
    const result = validateBenchmarkDataset(BENCHMARK_CASES);
    expect(result.valid).toBe(true);
    expect(result.hash).toBe(BENCHMARK_DATASET_HASH);
  });

  test("validateBenchmarkDataset fails when any case field is tampered with", () => {
    const tamperedTitle: BenchmarkCase[] = [
      {
        ...BENCHMARK_CASES[0]!,
        title: "篡改标题测试",
      },
      ...BENCHMARK_CASES.slice(1),
    ];
    const res1 = validateBenchmarkDataset(tamperedTitle);
    expect(res1.valid).toBe(false);
    expect(res1.hash).not.toBe(BENCHMARK_DATASET_HASH);

    const tamperedText: BenchmarkCase[] = [
      {
        ...BENCHMARK_CASES[0]!,
        taskText: BENCHMARK_CASES[0]!.taskText + " 篡改追加参数",
      },
      ...BENCHMARK_CASES.slice(1),
    ];
    const res2 = validateBenchmarkDataset(tamperedText);
    expect(res2.valid).toBe(false);

    const tamperedOutcome: BenchmarkCase[] = [
      {
        ...BENCHMARK_CASES[0]!,
        expectations: {
          ...BENCHMARK_CASES[0]!.expectations,
          expectedOutcome: "reject",
        },
      },
      ...BENCHMARK_CASES.slice(1),
    ];
    const res3 = validateBenchmarkDataset(tamperedOutcome);
    expect(res3.valid).toBe(false);
  });

  test("every case is explicitly marked constructed and has complete objective expectations", () => {
    const validOutcomes = new Set(["approve", "reject", "clarify"]);
    const validCandidates = new Set(["profit", "match", "volume"]);

    for (const item of BENCHMARK_CASES) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.taskText.length).toBeGreaterThan(15);
      expect(item.constructed).toBe(true);
      expect(validOutcomes.has(item.expectations.expectedOutcome)).toBe(true);
      expect(Array.isArray(item.expectations.knownRiskIds)).toBe(true);

      if (item.expectations.targetCandidateId !== undefined) {
        expect(validCandidates.has(item.expectations.targetCandidateId)).toBe(true);
      }
      if (item.expectations.mustClarifyFields !== undefined) {
        expect(Array.isArray(item.expectations.mustClarifyFields)).toBe(true);
        expect(item.expectations.mustClarifyFields.length).toBeGreaterThan(0);
      }
      if (item.expectations.forbiddenClaims !== undefined) {
        expect(Array.isArray(item.expectations.forbiddenClaims)).toBe(true);
        expect(item.expectations.forbiddenClaims.length).toBeGreaterThan(0);
      }
    }
  });
});
