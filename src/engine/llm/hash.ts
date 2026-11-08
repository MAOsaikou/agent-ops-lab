import { createHash } from "node:crypto";
import { isPromptHash, type PromptHash } from "../ids.js";

export function promptHash(text: string): PromptHash {
  const hex = createHash("sha256").update(text).digest("hex");
  if (!isPromptHash(hex)) {
    throw new Error("sha256 digest failed the prompt hash guard");
  }
  return hex;
}
