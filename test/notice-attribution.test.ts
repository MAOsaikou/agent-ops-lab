import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Locks a third-party attribution notice that lists every production transitive
 * dependency from the 2026-11-14 inventory. This is not a legal-compliance certificate.
 */
const PRODUCTION_PACKAGES = [
  { name: "@hono/node-server", version: "2.1.6" },
  { name: "@reduxjs/toolkit", version: "2.14.0" },
  { name: "@standard-schema/spec", version: "1.1.0" },
  { name: "@standard-schema/utils", version: "0.3.0" },
  { name: "@types/d3-array", version: "3.2.2" },
  { name: "@types/d3-color", version: "3.1.3" },
  { name: "@types/d3-drag", version: "3.0.7" },
  { name: "@types/d3-ease", version: "3.0.2" },
  { name: "@types/d3-interpolate", version: "3.0.4" },
  { name: "@types/d3-path", version: "3.1.1" },
  { name: "@types/d3-scale", version: "4.0.9" },
  { name: "@types/d3-selection", version: "3.0.12" },
  { name: "@types/d3-shape", version: "3.2.0" },
  { name: "@types/d3-time", version: "3.0.4" },
  { name: "@types/d3-timer", version: "3.0.2" },
  { name: "@types/d3-transition", version: "3.0.9" },
  { name: "@types/d3-zoom", version: "3.0.9" },
  { name: "@types/use-sync-external-store", version: "0.0.6" },
  { name: "@xyflow/react", version: "12.12.1" },
  { name: "@xyflow/system", version: "0.0.84" },
  { name: "class-variance-authority", version: "0.7.1" },
  { name: "classcat", version: "5.0.5" },
  { name: "clsx", version: "2.1.1" },
  { name: "d3-array", version: "3.2.5" },
  { name: "d3-color", version: "3.1.1" },
  { name: "d3-dispatch", version: "3.0.2" },
  { name: "d3-drag", version: "3.0.1" },
  { name: "d3-ease", version: "3.0.2" },
  { name: "d3-format", version: "3.1.3" },
  { name: "d3-interpolate", version: "3.0.2" },
  { name: "d3-path", version: "3.1.1" },
  { name: "d3-scale", version: "4.0.3" },
  { name: "d3-selection", version: "3.0.1" },
  { name: "d3-shape", version: "3.2.1" },
  { name: "d3-time", version: "3.1.1" },
  { name: "d3-time-format", version: "4.1.1" },
  { name: "d3-timer", version: "3.0.2" },
  { name: "d3-transition", version: "3.0.2" },
  { name: "d3-zoom", version: "3.0.1" },
  { name: "decimal.js-light", version: "2.5.1" },
  { name: "es-toolkit", version: "1.53.2" },
  { name: "eventemitter3", version: "5.0.4" },
  { name: "hono", version: "4.13.17" },
  { name: "immer", version: "11.2.9" },
  { name: "internmap", version: "2.0.3" },
  { name: "lucide-react", version: "1.70.0" },
  { name: "react", version: "19.3.1" },
  { name: "react-dom", version: "19.3.1" },
  { name: "react-is", version: "19.3.1" },
  { name: "react-redux", version: "9.3.1" },
  { name: "recharts", version: "3.10.1" },
  { name: "redux", version: "5.0.1" },
  { name: "redux-thunk", version: "3.1.0" },
  { name: "reselect", version: "5.2.0" },
  { name: "scheduler", version: "0.28.0" },
  { name: "tailwind-merge", version: "3.7.0" },
  { name: "tiny-invariant", version: "1.3.3" },
  { name: "use-sync-external-store", version: "1.7.0" },
  { name: "victory-vendor", version: "37.4.1" },
  { name: "zod", version: "4.6.7" },
  { name: "zustand", version: "4.5.7" },
] as const;

const NOTICE_CANDIDATES = ["NOTICE.md", "NOTICE"] as const;

function readNotice(): { file: string; text: string } {
  for (const file of NOTICE_CANDIDATES) {
    const full = path.join(process.cwd(), file);
    if (existsSync(full)) {
      return { file, text: readFileSync(full, "utf8") };
    }
  }
  throw new Error("missing NOTICE.md or NOTICE at the repository root");
}

describe("第三方依赖声明（NOTICE）", () => {
  test("根目录存在 NOTICE，且不以项目 MIT LICENSE 冒充第三方合规已完成", () => {
    const { text } = readNotice();
    expect(text.length).toBeGreaterThan(500);
    expect(text).toMatch(/不是法律意见|非正式法律意见|not a legal opinion/i);
    expect(text).toMatch(/不是全部合规|不能把根目录 MIT|不把.*MIT.*当成.*合规/);
    expect(text).toMatch(/未知|范围外/);
    expect(text).toMatch(/模型|DeepSeek|服务条款/);
  });

  test("生产依赖声明覆盖库存中全部 61 个传递包，而不只是顶层 hono/react", () => {
    const { text } = readNotice();
    expect(PRODUCTION_PACKAGES).toHaveLength(61);
    const missing = PRODUCTION_PACKAGES.filter((pkg) => !text.includes(pkg.name));
    expect(missing).toEqual([]);
    expect(text).toContain("victory-vendor");
    expect(text).toMatch(/MIT AND ISC AND BSD-3-Clause/);
    expect(text).toContain("class-variance-authority");
    expect(text).toContain("Apache-2.0");
  });

  test("开发/构建依赖中的 MPL-2.0 与缺许可证文件被标明为已知限制，而不是被省略或宣称已分发核验", () => {
    const { text } = readNotice();
    expect(text).toMatch(/lightningcss/);
    expect(text).toMatch(/MPL-2\.0|MPL-2.0/);
    expect(text).toMatch(/argparse/);
    expect(text).toMatch(/Python-2\.0|Python-2.0/);
    expect(text).toMatch(/未.*构建产物|没有拆开生产构建|not verified.*production build|未核验.*前端包/);
  });

  test("根 package.json 声明 license 为 MIT，与根 LICENSE 一致，但不因此主张第三方清单已闭合", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      license?: string;
    };
    expect(pkg.license).toBe("MIT");
  });
});
