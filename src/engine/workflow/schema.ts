import { z } from "zod";

import {
  isAgentId,
  isNodeId,
  isPredicateId,
  isTaskTemplateId,
  isToolName,
  isVerifierId,
  isWorkflowId,
  type NodeId,
  type WorkflowId,
} from "../ids.js";

const nodeIdSchema = z.string().refine(isNodeId);
const workflowIdSchema = z.string().refine(isWorkflowId);
const predicateIdSchema = z.string().refine(isPredicateId);
const verifierIdSchema = z.string().refine(isVerifierId);
const taskTemplateIdSchema = z.string().refine(isTaskTemplateId);
const agentIdSchema = z.string().refine(isAgentId);
const toolNameSchema = z.string().refine(isToolName);

const dependsOnSchema = z.array(nodeIdSchema).default([]);

export const joinSchema = z.union([
  z.literal("all"),
  z.literal("any"),
  z.strictObject({ quorum: z.int().positive() }),
]);

export const workflowNodeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("agent"),
    id: nodeIdSchema,
    agent: agentIdSchema,
    task: taskTemplateIdSchema,
    dependsOn: dependsOnSchema,
  }),
  z.strictObject({
    kind: z.literal("tool"),
    id: nodeIdSchema,
    tool: toolNameSchema,
    dependsOn: dependsOnSchema,
  }),
  z.strictObject({
    kind: z.literal("parallel"),
    id: nodeIdSchema,
    branches: z.array(nodeIdSchema).min(1),
    join: joinSchema,
    dependsOn: dependsOnSchema,
  }),
  z.strictObject({
    kind: z.literal("condition"),
    id: nodeIdSchema,
    predicate: predicateIdSchema,
    then: nodeIdSchema,
    else: nodeIdSchema,
    dependsOn: dependsOnSchema,
  }),
  z.strictObject({
    kind: z.literal("loop"),
    id: nodeIdSchema,
    body: nodeIdSchema,
    until: predicateIdSchema,
    maxIterations: z.int().positive(),
    dependsOn: dependsOnSchema,
  }),
  z.strictObject({
    kind: z.literal("subflow"),
    id: nodeIdSchema,
    workflow: workflowIdSchema,
    dependsOn: dependsOnSchema,
  }),
  z.strictObject({
    kind: z.literal("verify"),
    id: nodeIdSchema,
    pipeline: z.array(verifierIdSchema).min(1),
    dependsOn: dependsOnSchema,
  }),
  z.strictObject({
    kind: z.literal("humanGate"),
    id: nodeIdSchema,
    timeoutMs: z.int().nonnegative(),
    onTimeout: z.union([z.literal("approve"), z.literal("fallback")]),
    dependsOn: dependsOnSchema,
  }),
  z.strictObject({
    kind: z.literal("commit"),
    id: nodeIdSchema,
    dependsOn: dependsOnSchema,
  }),
]);

export const workflowSchema = z.strictObject({
  id: workflowIdSchema,
  nodes: z.array(workflowNodeSchema).min(1),
});

export const workflowDocumentSchema = z.strictObject({
  workflows: z.array(workflowSchema).min(1),
});

export type Join = z.infer<typeof joinSchema>;
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;

export function controlChildIds(node: WorkflowNode): readonly NodeId[] {
  switch (node.kind) {
    case "parallel":
      return node.branches;
    case "condition":
      return [node.then, node.else];
    case "loop":
      return [node.body];
    case "agent":
    case "tool":
    case "subflow":
    case "verify":
    case "humanGate":
    case "commit":
      return [];
    default: {
      const _exhaustive: never = node;
      throw new Error(`unknown node ${String(_exhaustive)}`);
    }
  }
}

function claim(owned: Set<NodeId>, id: NodeId, owner: NodeId): void {
  if (owned.has(id)) {
    throw new Error(`node ${id} is owned by more than one control node`);
  }
  owned.add(id);
  if (id === owner) {
    throw new Error(`node ${id} cannot contain itself`);
  }
}

function controlTargets(node: WorkflowNode, owned: Set<NodeId>): void {
  for (const child of controlChildIds(node)) claim(owned, child, node.id);
}

function assertJoin(node: WorkflowNode): void {
  if (node.kind !== "parallel" || node.join === "all" || node.join === "any") {
    return;
  }
  if (node.join.quorum > node.branches.length) {
    throw new Error(`quorum ${String(node.join.quorum)} exceeds branches of ${node.id}`);
  }
}

function walkDependencies(node: WorkflowNode, nodes: ReadonlyMap<NodeId, WorkflowNode>, stack: NodeId[]): void {
  if (stack.includes(node.id)) {
    throw new Error(`dependency cycle at ${node.id}`);
  }
  for (const dep of node.dependsOn) {
    const next = nodes.get(dep);
    if (next === undefined) {
      throw new Error(`node ${node.id} depends on missing node ${dep}`);
    }
    walkDependencies(next, nodes, [...stack, node.id]);
  }
}

function walkSubflows(
  workflowId: WorkflowId,
  workflows: ReadonlyMap<WorkflowId, Workflow>,
  stack: WorkflowId[],
): void {
  if (stack.includes(workflowId)) {
    throw new Error(`subflow cycle at ${workflowId}`);
  }
  const workflow = workflows.get(workflowId);
  if (workflow === undefined) {
    throw new Error(`missing workflow ${workflowId}`);
  }
  for (const node of workflow.nodes) {
    if (node.kind !== "subflow") continue;
    if (!workflows.has(node.workflow)) {
      throw new Error(`subflow ${node.id} references missing workflow ${node.workflow}`);
    }
    walkSubflows(node.workflow, workflows, [...stack, workflowId]);
  }
}

function assertWorkflow(workflow: Workflow, nodes: Map<NodeId, WorkflowNode>): void {
  const owned = new Set<NodeId>();
  const local = new Set<NodeId>();
  for (const node of workflow.nodes) {
    if (local.has(node.id)) {
      throw new Error(`duplicate node ${node.id}`);
    }
    local.add(node.id);
    if (nodes.has(node.id)) {
      throw new Error(`duplicate node ${node.id}`);
    }
    assertJoin(node);
    controlTargets(node, owned);
  }
  for (const node of workflow.nodes) {
    nodes.set(node.id, node);
  }
  for (const id of owned) {
    const child = nodes.get(id);
    if (child === undefined || !local.has(id)) {
      throw new Error(`control node references missing node ${id}`);
    }
    if (child.dependsOn.length > 0) {
      throw new Error(`owned node ${id} cannot declare dependencies`);
    }
  }
  for (const node of workflow.nodes) {
    for (const dep of node.dependsOn) {
      if (!local.has(dep)) {
        throw new Error(`node ${node.id} depends on ${dep} outside its workflow`);
      }
    }
    walkDependencies(node, nodes, []);
  }
  assertReachable(workflow, owned, nodes);
}

function assertReachable(
  workflow: Workflow,
  owned: ReadonlySet<NodeId>,
  nodes: ReadonlyMap<NodeId, WorkflowNode>,
): void {
  const reachable = new Set<NodeId>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of workflow.nodes) {
      if (reachable.has(node.id) || owned.has(node.id)) continue;
      if (!node.dependsOn.every((dep) => reachable.has(dep))) continue;
      reachable.add(node.id);
      grew = true;
      for (const child of controlChildIds(node)) markOwned(child, nodes, reachable);
    }
  }
  for (const node of workflow.nodes) {
    if (!reachable.has(node.id)) {
      throw new Error(`node ${node.id} is not reachable`);
    }
  }
}

function markOwned(
  id: NodeId,
  nodes: ReadonlyMap<NodeId, WorkflowNode>,
  reachable: Set<NodeId>,
): void {
  if (reachable.has(id)) return;
  reachable.add(id);
  const node = nodes.get(id);
  if (node === undefined) return;
  for (const child of controlChildIds(node)) markOwned(child, nodes, reachable);
}

export function parseWorkflowDocument(input: unknown): WorkflowDocument {
  const document = workflowDocumentSchema.parse(input);
  const workflows = new Map<WorkflowId, Workflow>();
  const nodes = new Map<NodeId, WorkflowNode>();
  for (const workflow of document.workflows) {
    if (workflows.has(workflow.id)) {
      throw new Error(`duplicate workflow ${workflow.id}`);
    }
    workflows.set(workflow.id, workflow);
    assertWorkflow(workflow, nodes);
  }
  for (const workflow of document.workflows) {
    walkSubflows(workflow.id, workflows, []);
  }
  return document;
}
