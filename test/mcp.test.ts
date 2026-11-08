import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createMcpClient, type Command } from "../src/engine/tools/mcp-client.js";
import { readMarketPrices } from "../src/templates/simshop/prices.js";

const serverPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/templates/simshop/mcp-server.ts",
);

function serverCommand(): Command {
  return [process.execPath, "--import", "tsx", serverPath];
}

test("mcp client result equals the in-process price read", async () => {
  const client = createMcpClient({ command: serverCommand });
  try {
    expect(await client.call("market.read_prices")).toEqual(readMarketPrices());
  } finally {
    await client.close();
  }
}, 20000);

test("after the child is killed the next call is data-unavailable and the process stays alive", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  let spawns = 0;
  const client = createMcpClient({
    command: () => {
      spawns += 1;
      if (spawns === 1) return serverCommand();
      return [process.execPath, "-e", "process.exit(1)"];
    },
  });
  try {
    expect(await client.call("market.read_prices")).toEqual(readMarketPrices());
    await client.killChild();
    expect(await client.call("market.read_prices")).toEqual({
      kind: "data-unavailable",
      tool: "market.read_prices",
    });
    expect(spawns).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await client.close();
  }
}, 20000);
