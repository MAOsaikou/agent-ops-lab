import { expect, test } from "vitest";
import { parseRunId } from "../src/engine/ids.js";
import { createKnowledgeBase } from "../src/engine/kb/index.js";

test("a new run overlay is empty of the other run's notes", () => {
  const kb = createKnowledgeBase([
    { id: "tea-manual", text: "tea wholesale contract terms" },
    { id: "snack-manual", text: "snack display layout" },
  ]);
  const runA = parseRunId("run-a");
  const runB = parseRunId("run-b");
  expect(() => kb.put(runA, { id: "too-soon", text: "note" })).toThrow(/overlay/);
  kb.beginRun(runA);
  kb.beginRun(runB);
  kb.put(runA, { id: "note-a", text: "supplier north delayed the tea crates" });
  kb.put(runB, { id: "note-b", text: "harbor lane rebate arrived overnight" });

  expect(kb.search(runB, "supplier north delayed crates")).toEqual([]);
  expect(kb.search(runA, "harbor lane rebate")).toEqual([]);
  expect(kb.search(runA, "supplier north delayed crates").map((hit) => hit.id)).toEqual(["note-a"]);
  expect(kb.search(runB, "harbor lane rebate").map((hit) => hit.id)).toEqual(["note-b"]);
  expect(kb.search(runB, "tea wholesale").map((hit) => hit.id)).toEqual(["tea-manual"]);
  expect(kb.search(runA, "tea wholesale").map((hit) => hit.id)).toContain("tea-manual");
  expect(kb.search(runA, "tea wholesale").map((hit) => hit.id)).not.toContain("note-b");

  kb.beginRun(runA);
  expect(kb.search(runA, "supplier north delayed crates").map((hit) => hit.id)).toEqual(["note-a"]);
});
