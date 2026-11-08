export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

function isUnknownArray(input: unknown): input is readonly unknown[] {
  return Array.isArray(input);
}

function isJsonArray(value: Json): value is readonly Json[] {
  return Array.isArray(value);
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

export function parseJson(input: unknown): Json {
  if (input === null) {
    return null;
  }
  switch (typeof input) {
    case "string":
    case "boolean":
      return input;
    case "number":
      if (!Number.isFinite(input)) {
        throw new Error("non-finite number in canonical json");
      }
      return input;
    case "object":
      return parseCollection(input);
    default:
      throw new Error("unsupported json value");
  }
}

function parseCollection(input: object): Json {
  if (isUnknownArray(input)) {
    const items: Json[] = [];
    for (const item of input) {
      items.push(parseJson(item));
    }
    return items;
  }
  if (!isPlainRecord(input)) {
    throw new Error("unsupported json value");
  }
  const record: { [key: string]: Json } = {};
  for (const key of Object.keys(input)) {
    const child = input[key];
    if (child === undefined) {
      throw new Error(`undefined json field ${key}`);
    }
    record[key] = parseJson(child);
  }
  return record;
}

function writeJson(value: Json): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error("non-finite number in canonical json");
      }
      return JSON.stringify(value);
    case "object":
      return writeCollection(value);
    default: {
      const _exhaustive: never = value;
      return _exhaustive;
    }
  }
}

function writeCollection(value: Exclude<Json, null | boolean | number | string>): string {
  if (isJsonArray(value)) {
    return `[${value.map((item) => writeJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = value[key];
    if (child === undefined) {
      throw new Error(`missing canonical value for ${key}`);
    }
    parts.push(`${JSON.stringify(key)}:${writeJson(child)}`);
  }
  return `{${parts.join(",")}}`;
}

export function canonicalJson(input: unknown): string {
  return writeJson(parseJson(input));
}

export function jsonValue(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    throw new Error("json text is invalid");
  }
}

export function assertCanonicalJson(text: string): string {
  const again = canonicalJson(jsonValue(text));
  if (again !== text) {
    throw new Error("json text is not canonical");
  }
  return text;
}
