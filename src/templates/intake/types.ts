import type { PlatformId, ServiceTag } from "../pricing/platform.js";

export const INTAKE_FIELD_IDS = [
  "platform",
  "name",
  "category",
  "keywords",
  "competitorCents",
  "marketOrders",
  "services",
] as const;

export type IntakeFieldId = (typeof INTAKE_FIELD_IDS)[number];

export type Confidence = "high" | "medium" | "low";

export type EvidenceKind = "link" | "text" | "rule";

export type Evidence = {
  readonly kind: EvidenceKind;
  readonly quote: string;
};

export type IntakeField = {
  readonly id: IntakeFieldId;
  readonly label: string;
  readonly display: string;
  readonly confidence: Confidence;
  readonly needsConfirm: boolean;
  readonly evidence: readonly Evidence[];
};

export type LinkKind = "item" | "short" | "shop" | "page";

export type LinkHit = {
  readonly raw: string;
  readonly url: string;
  readonly host: string;
  readonly platform: PlatformId | null;
  readonly platformLabel: string;
  readonly inPreset: boolean;
  readonly kind: LinkKind;
  readonly itemId: string | null;
  readonly idLabel: string;
  readonly slug: string | null;
  readonly notes: readonly string[];
};

export type ToolCall = {
  readonly index: number;
  readonly tool: string;
  readonly args: string;
  readonly observation: string;
};

export type CheckOutcome = "pass" | "warn";

export type IntakeCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: CheckOutcome;
  readonly detail: string;
};

export type IntakePatch = {
  readonly platform?: PlatformId;
  readonly name?: string;
  readonly category?: string;
  readonly keywords?: string;
  readonly competitorCents?: number;
  readonly marketOrders?: number;
  readonly services?: readonly ServiceTag[];
};

export type QuestionOption = {
  readonly label: string;
  readonly patch: IntakePatch;
};

export type IntakeQuestion = {
  readonly id: string;
  readonly ask: string;
  readonly why: string;
  readonly options: readonly QuestionOption[];
};

export type IntakeStats = {
  readonly chars: number;
  readonly lines: number;
  readonly links: number;
  readonly digits: number;
};

export type IntakeResult = {
  readonly version: 1;
  readonly fingerprint: string;
  readonly headline: string;
  readonly stats: IntakeStats;
  readonly plan: readonly string[];
  readonly links: readonly LinkHit[];
  readonly fields: readonly IntakeField[];
  readonly questions: readonly IntakeQuestion[];
  readonly checks: readonly IntakeCheck[];
  readonly trace: readonly ToolCall[];
  readonly patch: IntakePatch;
  readonly notes: readonly string[];
  readonly salesHint: number | null;
};
