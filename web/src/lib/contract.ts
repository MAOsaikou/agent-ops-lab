export type ScenarioName = "spring" | "supplycut" | "pricewar";
export type RunProfile = "steady" | "stressed";

export type ScenarioCatalog = {
  readonly name: ScenarioName;
  readonly rounds: number;
  readonly primaryCapacity: readonly number[];
  readonly backupCapacity: readonly number[];
  readonly competitorPrice: { readonly tea: readonly number[]; readonly snack: readonly number[] };
  readonly initial: {
    readonly cash: number;
    readonly reputation: number;
    readonly inventory: { readonly tea: number; readonly snack: number };
  };
};

export type ModeInfo = {
  readonly llmMode: "mock";
  readonly keyPresent: boolean;
  readonly badge: string;
  readonly detail: string;
  readonly scenarios: readonly ScenarioCatalog[];
};

export type RunSummaryRow = {
  readonly round: number;
  readonly calls: number;
  readonly stopReason: string | null;
  readonly usedFallback: boolean;
  readonly supply: boolean;
};

export type RunMeta = {
  readonly runId: string;
  readonly scenario: ScenarioName;
  readonly seed: number;
  readonly profile: RunProfile;
  readonly rounds: number;
  readonly plannedRounds: number;
  readonly llmMode: "mock";
  readonly finalHash: string;
  readonly ledgerHash: string;
  readonly calls: number;
  readonly callRoles: readonly string[];
  readonly minInventory: number;
  readonly priceWars: number;
  readonly quotes: number;
  readonly replayVerified: boolean;
  readonly orchestrationNote: string;
  readonly createdAt: string;
  readonly eventSource: string;
  readonly summary: readonly RunSummaryRow[];
};

export type LedgerRoundRow = {
  readonly round: number;
  readonly locked: boolean;
  readonly source: string;
  readonly hash: string;
  readonly prevHash: string;
  readonly decisionHash: string;
  readonly outcome: {
    readonly profit: number;
    readonly cash: number;
    readonly revenue: number;
    readonly adSpend: number;
    readonly missed: number;
    readonly sales: number;
    readonly reputation: number;
    readonly inventory: { readonly tea: number; readonly snack: number };
    readonly skus: {
      readonly tea: { readonly price: number; readonly sales: number; readonly qty?: number };
      readonly snack: { readonly price: number; readonly sales: number; readonly qty?: number };
    };
  };
};

export type LedgerResponse = {
  readonly runId: string;
  readonly finalHash: string;
  readonly matchesRunHash: boolean;
  readonly rounds: readonly LedgerRoundRow[];
};
