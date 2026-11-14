import { createMcpClient, type Command, type DataUnavailable, type MarketPrices } from "../../engine/tools/mcp-client.js";
import type { PlatformId } from "../pricing/platform.js";
import { dispatchToolCall, type KbSearchHit } from "./tools.js";

export type McpProtocolOptions = {
  readonly enabled: boolean;
  readonly serverName?: string | undefined;
  readonly command: Command;
  readonly method?: "market.read_prices" | undefined;
  readonly timeoutMs?: number | undefined;
};

export type ProtocolsConfig = {
  readonly mcp?: McpProtocolOptions | undefined;
};

export type RetrievalCitation = {
  readonly refId: string;
  readonly title: string;
  readonly detail: string;
  readonly source: "knowledge.search" | "custom";
};

export type RetrievalOptions = {
  readonly enabled: boolean;
  readonly query: string;
  readonly platform?: PlatformId | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retriever?: ((query: string, platform?: PlatformId) => Promise<readonly KbSearchHit[]>) | undefined;
};

export type ProtocolTrace = {
  readonly protocol: "mcp" | "retrieval";
  readonly type: "tool.called";
  readonly serverName?: string | undefined;
  readonly tool: string;
  readonly ok: boolean;
  readonly timedOut?: boolean | undefined;
  readonly result?: MarketPrices | DataUnavailable | readonly KbSearchHit[] | undefined;
  readonly error?: string | undefined;
  readonly elapsedMs: number;
};

export type ProtocolError = {
  readonly protocol: "mcp" | "retrieval";
  readonly source: string;
  readonly code: "timeout" | "unavailable" | "error";
  readonly message: string;
};

export type McpExecutionOutcome = {
  readonly trace: ProtocolTrace;
  readonly error?: ProtocolError | undefined;
};

export type RetrievalExecutionOutcome = {
  readonly citations: readonly RetrievalCitation[];
  readonly trace: ProtocolTrace;
  readonly error?: ProtocolError | undefined;
};

function isDataUnavailable(value: MarketPrices | DataUnavailable): value is DataUnavailable {
  return "kind" in value && value.kind === "data-unavailable";
}

export async function runMcpProtocolHook(config: McpProtocolOptions): Promise<McpExecutionOutcome> {
  const started = Date.now();
  const serverName = config.serverName ?? "mcp-server";
  const method = config.method ?? "market.read_prices";
  const timeoutMs = config.timeoutMs ?? 10_000;

  const client = createMcpClient({ command: () => config.command });
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const callPromise = client.call(method);
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`MCP call timed out after ${String(timeoutMs)}ms`));
      }, timeoutMs);
    });

    const value = await Promise.race([callPromise, timeoutPromise]);
    if (timer !== undefined) clearTimeout(timer);

    if (isDataUnavailable(value)) {
      const elapsedMs = Date.now() - started;
      const message = `MCP server "${serverName}" returned data-unavailable for ${method}`;
      return {
        trace: {
          protocol: "mcp",
          type: "tool.called",
          serverName,
          tool: method,
          ok: false,
          result: value,
          error: message,
          elapsedMs,
        },
        error: {
          protocol: "mcp",
          source: serverName,
          code: "unavailable",
          message,
        },
      };
    }

    return {
      trace: {
        protocol: "mcp",
        type: "tool.called",
        serverName,
        tool: method,
        ok: true,
        result: value,
        elapsedMs: Date.now() - started,
      },
    };
  } catch (err) {
    if (timer !== undefined) clearTimeout(timer);
    const elapsedMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = message.includes("timed out");
    return {
      trace: {
        protocol: "mcp",
        type: "tool.called",
        serverName,
        tool: method,
        ok: false,
        ...(timedOut ? { timedOut: true } : {}),
        error: message,
        elapsedMs,
      },
      error: {
        protocol: "mcp",
        source: serverName,
        code: timedOut ? "timeout" : "error",
        message,
      },
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runRetrievalHook(config: RetrievalOptions): Promise<RetrievalExecutionOutcome> {
  const started = Date.now();
  const timeoutMs = config.timeoutMs ?? 5_000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const fetchHits = async (): Promise<{
      readonly ok: boolean;
      readonly hits: readonly KbSearchHit[];
      readonly source: "knowledge.search" | "custom";
      readonly error?: string | undefined;
    }> => {
      if (config.retriever) {
        const hits = await config.retriever(config.query, config.platform);
        return { ok: true, hits, source: "custom" };
      }
      const res = await dispatchToolCall<readonly KbSearchHit[]>({
        tool: "knowledge.search",
        params: {
          query: config.query,
          ...(config.platform !== undefined ? { platform: config.platform } : {}),
        },
        callerRole: "link-researcher",
      });
      if (!res.ok) {
        return { ok: false, hits: [], source: "knowledge.search", error: res.error ?? "knowledge.search failed" };
      }
      return { ok: true, hits: res.data ?? [], source: "knowledge.search" };
    };

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Retrieval timed out after ${String(timeoutMs)}ms`));
      }, timeoutMs);
    });

    const outcome = await Promise.race([fetchHits(), timeoutPromise]);
    if (timer !== undefined) clearTimeout(timer);

    if (!outcome.ok) {
      const elapsedMs = Date.now() - started;
      const message = outcome.error ?? "Retrieval failed";
      return {
        citations: [],
        trace: {
          protocol: "retrieval",
          type: "tool.called",
          tool: "knowledge.search",
          ok: false,
          error: message,
          elapsedMs,
        },
        error: {
          protocol: "retrieval",
          source: "knowledge.search",
          code: "error",
          message,
        },
      };
    }

    const citations: RetrievalCitation[] = outcome.hits.map((hit) => ({
      refId: hit.id,
      title: hit.title,
      detail: hit.detail,
      source: outcome.source,
    }));

    return {
      citations,
      trace: {
        protocol: "retrieval",
        type: "tool.called",
        tool: "knowledge.search",
        ok: true,
        result: outcome.hits,
        elapsedMs: Date.now() - started,
      },
    };
  } catch (err) {
    if (timer !== undefined) clearTimeout(timer);
    const elapsedMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = message.includes("timed out");
    return {
      citations: [],
      trace: {
        protocol: "retrieval",
        type: "tool.called",
        tool: "knowledge.search",
        ok: false,
        ...(timedOut ? { timedOut: true } : {}),
        error: message,
        elapsedMs,
      },
      error: {
        protocol: "retrieval",
        source: config.retriever ? "custom-retriever" : "knowledge.search",
        code: timedOut ? "timeout" : "error",
        message,
      },
    };
  }
}
