import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function lint(filePath: string, code: string) {
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintText(code, { filePath });
  const result = results[0];
  if (result === undefined) {
    throw new Error(`ESLint returned no result for ${filePath}`);
  }
  return result;
}

function restrictedImportCount(result: Awaited<ReturnType<typeof lint>>): number {
  return result.messages.filter((message) => message.ruleId === "no-restricted-imports").length;
}

test("an engine file cannot import a scenario template", async () => {
  const result = await lint(
    path.join(repoRoot, "src/engine/probe.ts"),
    'import { x } from "../templates/simshop/index.js";\nexport const loaded = x;\n',
  );
  expect(restrictedImportCount(result)).toBeGreaterThan(0);
});

test("a nested engine file cannot import a scenario template", async () => {
  const result = await lint(
    path.join(repoRoot, "src/engine/sub/probe.ts"),
    'import { x } from "../../templates/meeting/index.js";\nexport const loaded = x;\n',
  );
  expect(restrictedImportCount(result)).toBeGreaterThan(0);
});

test("a template file may import another template", async () => {
  const result = await lint(
    path.join(repoRoot, "src/templates/meeting/probe.ts"),
    'import { x } from "../../templates/meeting/index.js";\nexport const loaded = x;\n',
  );
  expect(restrictedImportCount(result)).toBe(0);
  expect(result.errorCount).toBe(0);
});

test("a clean engine file has no lint errors", async () => {
  const result = await lint(
    path.join(repoRoot, "src/engine/clean.ts"),
    'export const engineProbe = "clean" satisfies "clean";\n',
  );
  expect(result.errorCount).toBe(0);
});
