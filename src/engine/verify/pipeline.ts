export const FORECAST_EVIDENCE = "forecast";
export const SCHEMA_CHECK = "schema";

export type CheckResult = {
  readonly id: string;
  readonly pass: boolean;
  readonly detail: string;
};

export type HardCheck<Decision, State> = (decision: Decision, state: State) => CheckResult;

export type ProfitBand = {
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
};

export type Forecast = {
  readonly profitCents: ProfitBand;
  readonly stockoutRisk: number;
  readonly samples: number;
};

export type SandboxForecast<Decision, State> = (decision: Decision, state: State) => Forecast;

export type SchemaResult<Decision> =
  | { readonly ok: true; readonly decision: Decision }
  | { readonly ok: false; readonly detail: string };

export type CriticObjection = {
  readonly claim: string;
  readonly evidence: string;
};

export type CriticInput<Decision, State> = {
  readonly decision: Decision;
  readonly state: State;
  readonly checks: readonly CheckResult[];
  readonly forecast: Forecast;
};

export type CriticReport = {
  readonly objections: readonly CriticObjection[];
  readonly confidence: number;
};

export type Verdict = "pass" | "revise" | "reject";

export type VerifyReport<Decision> = {
  readonly verdict: Verdict;
  readonly decision: Decision | null;
  readonly checks: readonly CheckResult[];
  readonly forecast: Forecast | null;
  readonly objections: readonly CriticObjection[];
  readonly dropped: readonly CriticObjection[];
  readonly confidence: number | null;
};

function failedIds(checks: readonly CheckResult[]): Set<string> {
  const ids = new Set<string>();
  for (const check of checks) {
    if (!check.pass) ids.add(check.id);
  }
  return ids;
}

function cited(
  objection: CriticObjection,
  failed: ReadonlySet<string>,
): boolean {
  if (objection.evidence === FORECAST_EVIDENCE) return true;
  return failed.has(objection.evidence);
}

export function verifyDecision<Decision, State>(input: {
  readonly raw: unknown;
  readonly state: State;
  readonly schema: (raw: unknown) => SchemaResult<Decision>;
  readonly checks: readonly HardCheck<Decision, State>[];
  readonly forecast: SandboxForecast<Decision, State>;
  readonly critic: (input: CriticInput<Decision, State>) => CriticReport;
}): VerifyReport<Decision> {
  const parsed = input.schema(input.raw);
  if (!parsed.ok) {
    return {
      verdict: "reject",
      decision: null,
      checks: [{ id: SCHEMA_CHECK, pass: false, detail: parsed.detail }],
      forecast: null,
      objections: [],
      dropped: [],
      confidence: null,
    };
  }
  const checks: CheckResult[] = [
    { id: SCHEMA_CHECK, pass: true, detail: "decision matches the schema" },
  ];
  for (const check of input.checks) {
    checks.push(check(parsed.decision, input.state));
  }
  const forecast = input.forecast(parsed.decision, input.state);
  const critique = input.critic({
    decision: parsed.decision,
    state: input.state,
    checks,
    forecast,
  });
  const failed = failedIds(checks);
  const objections: CriticObjection[] = [];
  const dropped: CriticObjection[] = [];
  for (const objection of critique.objections) {
    if (cited(objection, failed)) objections.push(objection);
    else dropped.push(objection);
  }
  const hardPass = checks.every((check) => check.id === SCHEMA_CHECK || check.pass);
  const verdict: Verdict = hardPass && objections.length === 0 ? "pass" : "revise";
  return {
    verdict,
    decision: parsed.decision,
    checks,
    forecast,
    objections,
    dropped,
    confidence: critique.confidence,
  };
}
