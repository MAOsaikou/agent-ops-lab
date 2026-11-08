import { expect, test } from "vitest";

import { parseWorkflowDocument } from "../src/engine/workflow/schema.js";

test("a loop without maxIterations fails to parse", () => {
  expect(() =>
    parseWorkflowDocument({
      workflows: [
        {
          id: "main",
          nodes: [{ kind: "loop", id: "again", body: "body", until: "done" }],
        },
      ],
    }),
  ).toThrow(/maxIterations/);
});

test("a loop with maxIterations parses", () => {
  const document = parseWorkflowDocument({
    workflows: [
      {
        id: "main",
        nodes: [
          { kind: "commit", id: "body" },
          { kind: "loop", id: "again", body: "body", until: "done", maxIterations: 2 },
        ],
      },
    ],
  });
  const workflow = document.workflows[0];
  if (workflow === undefined) throw new Error("missing workflow");
  expect(workflow.nodes[1]).toMatchObject({ kind: "loop", maxIterations: 2 });
});

test("two levels of subflow parse", () => {
  const document = parseWorkflowDocument({
    workflows: [
      {
        id: "leaf",
        nodes: [{ kind: "commit", id: "leaf-seal" }],
      },
      {
        id: "mid",
        nodes: [{ kind: "subflow", id: "mid-sub", workflow: "leaf" }],
      },
      {
        id: "root",
        nodes: [
          { kind: "subflow", id: "root-sub", workflow: "mid" },
          { kind: "commit", id: "root-seal", dependsOn: ["root-sub"] },
        ],
      },
    ],
  });
  expect(document.workflows).toHaveLength(3);
});
