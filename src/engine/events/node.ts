import { canonicalJson, type Json } from "../json.js";
import type { RunId } from "../ids.js";
import type { EventStore, StoredEvent } from "./store.js";

export const NODE_SCHEDULED = "NodeScheduled";
export const NODE_STARTED = "NodeStarted";
export const NODE_FINISHED = "NodeFinished";
export const NODE_DEAD_LETTER = "NodeDeadLetter";

export const NODE_EVENT_TYPES = [
  NODE_SCHEDULED,
  NODE_STARTED,
  NODE_FINISHED,
  NODE_DEAD_LETTER,
] as const;

export type NodeEventType = (typeof NODE_EVENT_TYPES)[number];

export function isNodeEventType(value: string): value is NodeEventType {
  for (const type of NODE_EVENT_TYPES) {
    if (type === value) return true;
  }
  return false;
}

export type NodeEventBody = {
  readonly nodeId: string;
  readonly reason: string;
  readonly agentId?: string;
  readonly version?: string;
  readonly promptHash?: string;
  readonly agent?: string;
  readonly score?: number;
};

export function nodeEventJson(input: NodeEventBody): string {
  const payload: { [key: string]: Json } = {
    nodeId: input.nodeId,
    reason: input.reason,
  };
  if (input.agentId !== undefined) payload["agentId"] = input.agentId;
  if (input.version !== undefined) payload["version"] = input.version;
  if (input.promptHash !== undefined) payload["promptHash"] = input.promptHash;
  if (input.agent !== undefined) payload["agent"] = input.agent;
  if (input.score !== undefined) payload["score"] = input.score;
  return canonicalJson(payload);
}

export function appendNodeEvent(
  events: EventStore,
  input: {
    readonly runId: RunId;
    readonly type: NodeEventType;
    readonly body: NodeEventBody;
    readonly idempotencyKey: string;
  },
): StoredEvent {
  return events.append({
    runId: input.runId,
    type: input.type,
    payloadJson: nodeEventJson(input.body),
    causationId: null,
    idempotencyKey: input.idempotencyKey,
  });
}
