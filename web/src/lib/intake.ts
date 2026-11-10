import type { IntakePatch, IntakeResult } from "../../../src/templates/intake/types.js";
import type { Draft } from "./draft.js";

type MutableDraft = { -readonly [Key in keyof Draft]?: Draft[Key] };

export function patchToDraft(patch: IntakePatch): Partial<Draft> {
  const next: MutableDraft = {};
  if (patch.platform !== undefined) {
    next.platform = patch.platform;
  }
  if (patch.name !== undefined) {
    next.name = patch.name;
  }
  if (patch.category !== undefined) {
    next.category = patch.category;
  }
  if (patch.keywords !== undefined) {
    next.keywords = patch.keywords;
  }
  if (patch.competitorCents !== undefined) {
    next.competitor = (patch.competitorCents / 100).toFixed(2);
  }
  if (patch.marketOrders !== undefined) {
    next.marketOrders = String(patch.marketOrders);
  }
  if (patch.services !== undefined) {
    next.services = patch.services;
  }
  const filled = Object.keys(next).length;
  if (filled === 0) {
    return {};
  }
  return next;
}

export function patchFieldCount(patch: IntakePatch): number {
  return Object.values(patch).filter((value) => value !== undefined).length;
}

export type { IntakePatch, IntakeResult };
