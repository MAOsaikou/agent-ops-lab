export type LlmMode = "mock" | "cassette" | "live";

export function resolveMode(input: { hasApiKey: boolean; cassettePath?: string }): LlmMode {
  if (input.cassettePath !== undefined && input.cassettePath.length > 0) return "cassette";
  if (!input.hasApiKey) return "mock";
  return "live";
}
