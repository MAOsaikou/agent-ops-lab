import { z } from "zod";

export type AgentId = string & { readonly __brand: "AgentId" };
export type ToolName = string & { readonly __brand: "ToolName" };
export type RunId = string & { readonly __brand: "RunId" };
export type SkillTag = string & { readonly __brand: "SkillTag" };
export type PromptHash = string & { readonly __brand: "PromptHash" };
export type UnitInterval = number & { readonly __brand: "UnitInterval" };
export type NodeId = string & { readonly __brand: "NodeId" };
export type WorkflowId = string & { readonly __brand: "WorkflowId" };
export type PredicateId = string & { readonly __brand: "PredicateId" };
export type VerifierId = string & { readonly __brand: "VerifierId" };
export type TaskTemplateId = string & { readonly __brand: "TaskTemplateId" };

export type SemVer = `${number}.${number}.${number}`;

const AGENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}(\.[a-z][a-z0-9_-]{0,63})*$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SKILL_TAG_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const PROMPT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const NODE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const WORKFLOW_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const PREDICATE_ID_PATTERN = TOOL_NAME_PATTERN;
const VERIFIER_ID_PATTERN = TOOL_NAME_PATTERN;
const TASK_TEMPLATE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export function isAgentId(input: string): input is AgentId {
  return AGENT_ID_PATTERN.test(input);
}

export function isToolName(input: string): input is ToolName {
  return TOOL_NAME_PATTERN.test(input);
}

export function isRunId(input: string): input is RunId {
  return RUN_ID_PATTERN.test(input);
}

export function isSkillTag(input: string): input is SkillTag {
  return SKILL_TAG_PATTERN.test(input);
}

export function isPromptHash(input: string): input is PromptHash {
  return PROMPT_HASH_PATTERN.test(input);
}

export function isSemVer(input: string): input is SemVer {
  return SEMVER_PATTERN.test(input);
}

export function isUnitInterval(input: number): input is UnitInterval {
  return Number.isFinite(input) && input >= 0 && input <= 1;
}

export function isNodeId(input: string): input is NodeId {
  return NODE_ID_PATTERN.test(input);
}

export function isWorkflowId(input: string): input is WorkflowId {
  return WORKFLOW_ID_PATTERN.test(input);
}

export function isPredicateId(input: string): input is PredicateId {
  return PREDICATE_ID_PATTERN.test(input);
}

export function isVerifierId(input: string): input is VerifierId {
  return VERIFIER_ID_PATTERN.test(input);
}

export function isTaskTemplateId(input: string): input is TaskTemplateId {
  return TASK_TEMPLATE_PATTERN.test(input);
}

const agentIdSchema = z.string().refine(isAgentId);
const toolNameSchema = z.string().refine(isToolName);
const runIdSchema = z.string().refine(isRunId);
const skillTagSchema = z.string().refine(isSkillTag);
const promptHashSchema = z.string().refine(isPromptHash);
const semVerSchema = z.string().regex(SEMVER_PATTERN).refine(isSemVer);
const unitIntervalSchema = z.number().refine(isUnitInterval);
const nodeIdSchema = z.string().refine(isNodeId);
const workflowIdSchema = z.string().refine(isWorkflowId);
const predicateIdSchema = z.string().refine(isPredicateId);
const verifierIdSchema = z.string().refine(isVerifierId);
const taskTemplateIdSchema = z.string().refine(isTaskTemplateId);

export function parseAgentId(input: unknown): AgentId {
  return agentIdSchema.parse(input);
}

export function parseToolName(input: unknown): ToolName {
  return toolNameSchema.parse(input);
}

export function parseRunId(input: unknown): RunId {
  return runIdSchema.parse(input);
}

export function parseSkillTag(input: unknown): SkillTag {
  return skillTagSchema.parse(input);
}

export function parsePromptHash(input: unknown): PromptHash {
  return promptHashSchema.parse(input);
}

export function parseSemVer(input: unknown): SemVer {
  return semVerSchema.parse(input);
}

export function parseUnitInterval(input: unknown): UnitInterval {
  return unitIntervalSchema.parse(input);
}

export function parseNodeId(input: unknown): NodeId {
  return nodeIdSchema.parse(input);
}

export function parseWorkflowId(input: unknown): WorkflowId {
  return workflowIdSchema.parse(input);
}

export function parsePredicateId(input: unknown): PredicateId {
  return predicateIdSchema.parse(input);
}

export function parseVerifierId(input: unknown): VerifierId {
  return verifierIdSchema.parse(input);
}

export function parseTaskTemplateId(input: unknown): TaskTemplateId {
  return taskTemplateIdSchema.parse(input);
}
