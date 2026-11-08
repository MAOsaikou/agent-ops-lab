import type { RoundIndex } from "./brand.js";

export function readAt<T>(values: readonly T[], round: RoundIndex, label: string): T {
  const value = values[round];
  if (value === undefined) {
    throw new Error(`${label} missing at round ${String(round)}`);
  }
  return value;
}
