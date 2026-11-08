import { createInterface } from "node:readline";
import { z } from "zod";
import { readMarketPrices } from "./prices.js";

const requestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string(),
  params: z.unknown().optional(),
});

type RpcResponse =
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      result: { tea: number; snack: number };
    }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: { code: number; message: string };
    };

function send(message: RpcResponse): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });

lines.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
    return;
  }
  const id = parsed.data.id ?? null;
  if (parsed.data.method !== "market.read_prices") {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
    return;
  }
  send({ jsonrpc: "2.0", id, result: readMarketPrices() });
});

lines.on("close", () => {
  process.exit(0);
});
