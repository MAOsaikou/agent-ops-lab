import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { z } from "zod";

export type Command = readonly [string, ...string[]];

export type MarketPrices = {
  tea: number;
  snack: number;
};

export type DataUnavailable = {
  kind: "data-unavailable";
  tool: "market.read_prices";
};

const pricesSchema = z.object({
  tea: z.number().int(),
  snack: z.number().int(),
});

const okSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  result: pricesSchema,
});

const errSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string(), z.null()]),
  error: z.object({
    code: z.number(),
    message: z.string(),
  }),
});

class TransportDown extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportDown";
  }
}

class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

type Pending = {
  resolve: (value: MarketPrices) => void;
  reject: (error: Error) => void;
};

function chunkText(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  return "";
}

export type McpClient = {
  call(method: "market.read_prices"): Promise<MarketPrices | DataUnavailable>;
  killChild(): Promise<void>;
  close(): Promise<void>;
};

export function createMcpClient(options: { command: () => Command }): McpClient {
  let child: ChildProcess | undefined;
  let lines: Interface | undefined;
  let nextId = 0;
  let closed = false;
  let stderr = "";
  const pending = new Map<number, Pending>();

  function failPending(error: Error): void {
    const waiters = [...pending.values()];
    pending.clear();
    for (const waiter of waiters) waiter.reject(error);
  }

  function onLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      failPending(new TransportDown("invalid json"));
      return;
    }
    const ok = okSchema.safeParse(raw);
    if (ok.success) {
      const waiter = pending.get(ok.data.id);
      if (waiter === undefined) return;
      pending.delete(ok.data.id);
      waiter.resolve(ok.data.result);
      return;
    }
    const err = errSchema.safeParse(raw);
    if (err.success && typeof err.data.id === "number") {
      const waiter = pending.get(err.data.id);
      if (waiter === undefined) return;
      pending.delete(err.data.id);
      waiter.reject(new ProtocolError(err.data.error.message));
      return;
    }
    failPending(new TransportDown("unreadable rpc response"));
  }

  function spawnChild(): void {
    if (closed) throw new TransportDown("client closed");
    lines?.close();
    lines = undefined;
    const command = options.command();
    const [bin, ...args] = command;
    const spawned = spawn(bin, [...args], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = spawned.stdout;
    const stdin = spawned.stdin;
    const errStream = spawned.stderr;
    if (stdout === null || stdin === null || errStream === null) {
      spawned.kill("SIGKILL");
      throw new TransportDown("stdio pipes missing");
    }
    child = spawned;
    errStream.on("data", (chunk: unknown) => {
      stderr = (stderr + chunkText(chunk)).slice(-4000);
    });
    errStream.on("error", () => {
      stderr = `${stderr}\nstderr error`.slice(-4000);
    });
    stdout.on("error", () => {
      failPending(new TransportDown("stdout error"));
    });
    stdin.on("error", () => {
      failPending(new TransportDown("stdin error"));
    });
    spawned.on("error", (error: Error) => {
      failPending(new TransportDown(error.message));
    });
    spawned.on("exit", () => {
      if (child !== spawned) return;
      child = undefined;
      failPending(new TransportDown(`server exited ${stderr}`.trim()));
    });
    lines = createInterface({ input: stdout, crlfDelay: Infinity });
    lines.on("line", onLine);
    lines.on("error", () => {
      failPending(new TransportDown("readline error"));
    });
  }

  function childIsLive(current: ChildProcess | undefined): current is ChildProcess {
    return current !== undefined && current.exitCode === null && current.signalCode === null;
  }

  function ensureChild(): void {
    if (childIsLive(child)) return;
    child = undefined;
    spawnChild();
  }

  function stopChild(): void {
    const current = child;
    child = undefined;
    if (!childIsLive(current)) return;
    current.kill("SIGKILL");
  }

  function roundTrip(): Promise<MarketPrices> {
    const current = child;
    const stdin = current?.stdin ?? null;
    if (!childIsLive(current) || stdin === null) {
      return Promise.reject(new TransportDown("server not running"));
    }
    nextId += 1;
    const id = nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiter = pending.get(id);
        if (waiter === undefined) return;
        pending.delete(id);
        waiter.reject(new TransportDown("rpc timeout"));
      }, 15000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      const payload = `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "market.read_prices",
        params: {},
      })}\n`;
      stdin.write(payload, (error) => {
        if (error === null || error === undefined) return;
        const waiter = pending.get(id);
        if (waiter === undefined) return;
        pending.delete(id);
        waiter.reject(new TransportDown(error.message));
      });
    });
  }

  async function attempt(allowReconnect: boolean): Promise<MarketPrices> {
    try {
      ensureChild();
      return await roundTrip();
    } catch (error) {
      if (!(error instanceof TransportDown) || !allowReconnect) throw error;
      stopChild();
      ensureChild();
      return await roundTrip();
    }
  }

  return {
    async call(method) {
      switch (method) {
        case "market.read_prices":
          break;
        default: {
          const _exhaustive: never = method;
          return _exhaustive;
        }
      }
      try {
        return await attempt(true);
      } catch (error) {
        if (error instanceof TransportDown) {
          return { kind: "data-unavailable", tool: "market.read_prices" };
        }
        throw error;
      }
    },

    killChild() {
      const current = child;
      if (current === undefined) return Promise.resolve();
      return new Promise((resolve) => {
        if (current.exitCode !== null || current.signalCode !== null) {
          resolve();
          return;
        }
        current.once("exit", () => resolve());
        current.kill("SIGKILL");
      });
    },

    async close() {
      closed = true;
      const current = child;
      child = undefined;
      failPending(new TransportDown("client closed"));
      lines?.close();
      lines = undefined;
      if (current === undefined) return;
      if (current.exitCode !== null || current.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        current.once("exit", () => resolve());
        current.kill("SIGKILL");
      });
    },
  };
}
