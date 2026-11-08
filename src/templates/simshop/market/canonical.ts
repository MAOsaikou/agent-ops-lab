export type Canonical =
  | null
  | boolean
  | number
  | string
  | readonly Canonical[]
  | { readonly [key: string]: Canonical };

function isRecord(value: Canonical): value is { readonly [key: string]: Canonical } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canonicalJson(value: Canonical): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("non-finite number in canonical json");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (!isRecord(value)) {
    throw new Error("unsupported canonical value");
  }
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = value[key];
    if (child === undefined) {
      throw new Error(`missing canonical value for ${key}`);
    }
    parts.push(`${JSON.stringify(key)}:${canonicalJson(child)}`);
  }
  return `{${parts.join(",")}}`;
}
