import { createHash } from "node:crypto";

import type { RoundIndex, Seed } from "./brand.js";
import type { Sku } from "./types.js";

export type Stream = "settle" | "forecast" | "events";

export type Rng = {
  uniform(stream: Stream, round: RoundIndex, sku: Sku, k: number): number;
};

function drawKey(drawn: Seed, stream: Stream, round: RoundIndex, sku: Sku, k: number): string {
  return `${drawn}:${stream}:${round}:${sku}:${k}`;
}

export function hashDraw(
  drawn: Seed,
  stream: Stream,
  round: RoundIndex,
  sku: Sku,
  k: number,
): Uint8Array {
  return createHash("sha256").update(drawKey(drawn, stream, round, sku, k), "utf8").digest();
}

// Top 53 bits of the digest, shifted by half an ulp into (0, 1).
function uniformFromDigest(digest: Uint8Array): number {
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const hi = view.getUint32(0, false);
  const lo = view.getUint32(4, false);
  const top21 = Math.floor(hi / 2048);
  const magnitude = top21 * 2 ** 32 + lo;
  return (magnitude + 0.5) / 2 ** 53;
}

export function uniformAt(
  drawn: Seed,
  stream: Stream,
  round: RoundIndex,
  sku: Sku,
  k: number,
): number {
  return uniformFromDigest(hashDraw(drawn, stream, round, sku, k));
}

// Box-Muller: u1 and u2 are in (0, 1). z0 is a standard normal.
// Lognormal noise has mean 1: exp(sigma * z0 - sigma^2 / 2).
export function lognormalMeanOne(u1: number, u2: number, sigma: number): number {
  const radius = Math.sqrt(-2 * Math.log(u1));
  const theta = 2 * Math.PI * u2;
  const z0 = radius * Math.cos(theta);
  return Math.exp(sigma * z0 - (sigma * sigma) / 2);
}

export function deriveRng(drawn: Seed): Rng {
  return {
    uniform(stream, round, sku, k) {
      return uniformAt(drawn, stream, round, sku, k);
    },
  };
}
