import { createHash } from "node:crypto";

import { isHash, type Hash } from "./types.js";

export function sha256Bytes(bytes: Uint8Array): Hash {
  const hex = createHash("sha256").update(bytes).digest("hex");
  if (!isHash(hex)) {
    throw new Error("sha256 did not return 64 hex characters");
  }
  return hex;
}

export function sha256Hex(text: string): Hash {
  return sha256Bytes(new TextEncoder().encode(text));
}

const GENESIS = sha256Hex("genesis");

export function genesisHash(): Hash {
  return GENESIS;
}

function field(value: string): string {
  return `${String(value.length)}:${value}`;
}

export function roundRecordHash(input: {
  readonly prevHash: Hash;
  readonly round: number;
  readonly observationHash: Hash;
  readonly decisionHash: Hash;
  readonly outcomeJson: string;
  readonly beliefHash: Hash;
  readonly overlayHash: Hash;
}): Hash {
  return sha256Hex(
    [
      field("v1"),
      field(input.prevHash),
      field(String(input.round)),
      field(input.observationHash),
      field(input.decisionHash),
      field(input.outcomeJson),
      field(input.beliefHash),
      field(input.overlayHash),
    ].join(""),
  );
}
