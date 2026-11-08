import { toJSONSchema, type ZodType } from "zod";
import type { ToolName } from "../ids.js";

export type ToolEffect = "read" | "sandbox" | "commit";

export type ToolTransport = { kind: "inproc" } | { kind: "mcp"; server: string };

export type ToolSpec<I, O> = {
  readonly name: ToolName;
  readonly effect: ToolEffect;
  readonly input: ZodType<I>;
  readonly output: ZodType<O>;
  readonly transport: ToolTransport;
};

export type ToolRegistry = {
  register<I, O>(spec: ToolSpec<I, O>, handler: (input: I) => O | Promise<O>): void;
  call(name: ToolName, input: unknown): Promise<unknown>;
  effectOf(name: ToolName): ToolEffect | undefined;
};

type StoredTool = {
  effect: ToolEffect;
  run: (input: unknown) => Promise<unknown>;
};

export function jsonSchema<I, O>(spec: ToolSpec<I, O>) {
  return toJSONSchema(spec.input);
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<ToolName, StoredTool>();

  return {
    register(spec, handler) {
      if (tools.has(spec.name)) {
        throw new Error(`tool already registered: ${spec.name}`);
      }
      tools.set(spec.name, {
        effect: spec.effect,
        run: async (input: unknown) => {
          const parsed = spec.input.parse(input);
          const output = await handler(parsed);
          return spec.output.parse(output);
        },
      });
    },

    async call(name, input) {
      const tool = tools.get(name);
      if (tool === undefined) {
        throw new Error(`tool is not registered: ${name}`);
      }
      return tool.run(input);
    },

    effectOf(name) {
      return tools.get(name)?.effect;
    },
  };
}
