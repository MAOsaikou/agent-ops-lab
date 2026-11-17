import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { serve } from "@hono/node-server";
import { chromium, type Page } from "@playwright/test";

import { memoryAgentRunStore } from "../src/server/agent-runs.js";
import { openLlmSettingsStore } from "../src/server/llm-settings.js";
import { openPlanStore } from "../src/server/plans.js";
import { createPricingApp } from "../src/server/pricing-app.js";

const ROOT = process.cwd();
const WHITEPAPER_MD = path.join(ROOT, "docs", "proposal-whitepaper.md");
const OUTPUT_PDF = path.join(ROOT, "docs", "AgentOps-Harness-初赛方案书.pdf");
const SHOT_DIR = path.join(ROOT, "artifacts", "whitepaper");

const CRAFTED_FLIP_TASK =
  "评估京东商品是否值得上架。商品名：便携保温杯，京东价 ¥58.9，日单量 50，采购价 16 元，包材 1.5 元，快递 6.5 元，目标毛利 56%，推广预算 10 元，可周转资金 2200 元。";

async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startIsolatedApiServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const tempPlanDir = mkdtempSync(path.join(tmpdir(), "agentops-whitepaper-"));
  const app = createPricingApp({
    store: openPlanStore(tempPlanDir),
    agentRuns: memoryAgentRunStore(),
    llmSettings: openLlmSettingsStore(null, {}),
  });

  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(addr.port)}`;

  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      rmSync(tempPlanDir, { recursive: true, force: true });
    },
  };
}

async function startFallbackViteIfNeeded(): Promise<{
  webUrl: string;
  close: () => Promise<void>;
}> {
  const existingUrl = "http://127.0.0.1:47322";
  if (await isUrlReachable(existingUrl)) {
    return {
      webUrl: existingUrl,
      close: async () => {},
    };
  }

  // Fallback: serve built web/dist or spawn vite preview/dev on random port
  const distDir = path.join(ROOT, "web", "dist");
  if (existsSync(path.join(distDir, "index.html"))) {
    const server: Server = createServer((req, res) => {
      const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const filePath = path.join(distDir, rel);
      const target = existsSync(filePath) ? filePath : path.join(distDir, "index.html");
      const ext = path.extname(target);
      const mime =
        ext === ".html"
          ? "text/html; charset=utf-8"
          : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : ext === ".css"
              ? "text/css; charset=utf-8"
              : ext === ".svg"
                ? "image/svg+xml"
                : "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(readFileSync(target));
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const addr = server.address() as AddressInfo;
    return {
      webUrl: `http://127.0.0.1:${String(addr.port)}`,
      close: async () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    };
  }

  const child = spawn(
    process.execPath,
    [path.resolve(ROOT, "web/node_modules/vite/bin/vite.js"), "--port", "47322"],
    {
      cwd: path.resolve(ROOT, "web"),
      stdio: "ignore",
      windowsHide: true,
    },
  );
  for (let i = 0; i < 60; i += 1) {
    if (await isUrlReachable(existingUrl)) {
      return {
        webUrl: existingUrl,
        close: async () => {
          child.kill();
        },
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error("Vite 服务启动超时，无法加载控制台页面");
}

async function captureScreenshots(): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const api = await startIsolatedApiServer();
  const web = await startFallbackViteIfNeeded();
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1120 },
      deviceScaleFactor: 2,
    });

    // Forward all API requests targeting 127.0.0.1:47321 to our isolated memory-backed Hono server
    await context.route("http://127.0.0.1:47321/**", async (route) => {
      const req = route.request();
      const targetUrl = req.url().replace("http://127.0.0.1:47321", api.baseUrl);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers())) {
        if (k.toLowerCase() === "host" || k.toLowerCase() === "content-length") continue;
        headers.set(k, v);
      }
      const postData = req.postDataBuffer();
      const upstream = await fetch(targetUrl, {
        method: req.method(),
        headers,
        ...(postData ? { body: new Uint8Array(postData) } : {}),
      });
      const outHeaders: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        if (k.toLowerCase() !== "transfer-encoding") {
          outHeaders[k] = v;
        }
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      await route.fulfill({
        status: upstream.status,
        headers: outHeaders,
        body: buf,
      });
    });

    const page: Page = await context.newPage();

    // 1. 01-review-intake.png: 单品多维会签台 — 大白话导览 + 无链接诚实追问预检
    await page.goto(web.webUrl, { waitUntil: "networkidle" });
    await page.getByTestId("task-box").fill("商品名：纯棉短袖，竞品价 39.9 元。");
    await page.getByTestId("prepare-intake").click();
    await page.getByTestId("preflight-answer-buy").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("preflight-answer-buy").fill("16");
    await page.getByTestId("preflight-answer-shipping").fill("0");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOT_DIR, "01-review-intake.png"),
      clip: { x: 0, y: 0, width: 1440, height: 960 },
    });

    // 2. 02-review-collaboration.png: 单品多维会签台 — 10角色会签台账 + 三方压力质询裁决(Decision Flip) + 掌柜拍板门
    await page.goto(web.webUrl, { waitUntil: "networkidle" });
    await page.getByTestId("task-box").fill(CRAFTED_FLIP_TASK);
    await page.getByTestId("run-button").click();
    await page.locator('[data-testid="status"][data-status="awaiting-approval"]').waitFor({
      timeout: 30_000,
    });
    await page.getByTestId("collaboration-section").waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(300);
    // Scroll down to capture gate + three strategies + expanded collaboration evidence together
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="gate-unresolved-risks"]');
      if (el) {
        const rect = el.getBoundingClientRect();
        window.scrollTo(0, Math.max(0, window.scrollY + rect.top - 120));
      }
    });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOT_DIR, "02-review-collaboration.png"),
      clip: { x: 0, y: 0, width: 1440, height: 1080 },
    });

    // 3. 03-simshop-supplycut.png: 8回合博弈沙盘 — 桥接上下文 + 热升级 + 第2回合断供 + 三轮议价与脱敏
    await page.getByTestId("bridge-to-simshop").click();
    await page.getByTestId("simshop-arena").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("simshop-scenario-supplycut").click();
    await page.getByTestId("simshop-profile-steady").click();
    await page.getByTestId("simshop-seed-input").fill("7");
    await page.getByTestId("simshop-start-button").click();
    await page.getByTestId("simshop-negotiation-panel").waitFor({ state: "visible", timeout: 30_000 });
    // Focus round 2 (supply cut active round) so version upgrades + round 2 + 3-round negotiation fit in one clear view
    await page.getByTestId("simshop-round-tab-1").click();
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="simshop-version-upgrades"]');
      if (el) {
        const rect = el.getBoundingClientRect();
        window.scrollTo(0, Math.max(0, window.scrollY + rect.top - 16));
      }
    });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOT_DIR, "03-simshop-supplycut.png"),
      clip: { x: 0, y: 0, width: 1440, height: 1080 },
    });
    await page.getByTestId("simshop-round-all").click();

    // 4. 04-simshop-pricewar-tamper.png: 8回合博弈沙盘 — pricewar 负边际归零拦截 + HTTP 409 防篡改铁证
    await page.getByTestId("simshop-scenario-pricewar").click();
    await page.getByTestId("simshop-start-button").click();
    await page.getByTestId("simshop-pricewar-panel").waitFor({ state: "visible", timeout: 30_000 });
    await page.getByTestId("simshop-tamper-round-0").click();
    await page.getByTestId("simshop-tamper-proof").waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="simshop-pricewar-panel"]');
      if (el) {
        const rect = el.getBoundingClientRect();
        window.scrollTo(0, Math.max(0, window.scrollY + rect.top - 20));
      }
    });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOT_DIR, "04-simshop-pricewar-tamper.png"),
      clip: { x: 0, y: 0, width: 1440, height: 960 },
    });

    // 5. 05-arena-part-a.png: 评测竞技场 Part A — 12案4拓扑梯度对比
    await page.getByTestId("nav-tab-arena").click();
    await page.getByTestId("topology-benchmark-view").waitFor({ state: "visible", timeout: 15_000 });
    await page.getByTestId("arena-run-eval-button").click();
    await page.getByTestId("arena-part-a").waitFor({ state: "visible", timeout: 45_000 });
    await page.getByTestId("arena-part-b").waitFor({ state: "visible", timeout: 45_000 });
    await page.mouse.move(10, 10);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="arena-part-a"]');
      if (el) {
        const rect = el.getBoundingClientRect();
        window.scrollTo(0, Math.max(0, window.scrollY + rect.top - 10));
      }
    });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(SHOT_DIR, "05-arena-part-a.png"),
      clip: { x: 0, y: 0, width: 1440, height: 960 },
    });

    // 6. 06-arena-part-b.png: 评测竞技场 Part B — 8回合3场景利润趋势对比曲线
    await page.mouse.move(10, 10);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="arena-part-b"]');
      if (el) {
        const rect = el.getBoundingClientRect();
        window.scrollTo(0, Math.max(0, window.scrollY + rect.top - 6));
      }
    });
    await page.waitForTimeout(450);
    await page.screenshot({
      path: path.join(SHOT_DIR, "06-arena-part-b.png"),
      clip: { x: 0, y: 0, width: 1440, height: 960 },
    });

    await context.close();
  } finally {
    await browser.close();
    await web.close();
    await api.close();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function formatMathExpression(tex: string): string {
  let out = escapeHtml(tex.trim());
  out = out.replace(/\\text\{([^}]*)\}/g, '<span class="math-text">$1</span>');
  out = out.replace(/\\operatorname\{([^}]*)\}/g, '<span class="math-op">$1</span>');
  out = out.replace(/\\max\b/g, "max").replace(/\\min\b/g, "min");
  out = out.replace(/\\%/g, "%");
  out = out.replace(/\\\{/g, "{").replace(/\\\}/g, "}");
  out = out.replace(/\\Big\(/g, "(").replace(/\\Big\)/g, ")");
  out = out.replace(/\\big\(/g, "(").replace(/\\big\)/g, ")");
  out = out.replace(/\\left\(/g, "(").replace(/\\right\)/g, ")");
  out = out.replace(/\\left\\lceil/g, "⌈").replace(/\\right\\rceil/g, "⌉");
  out = out.replace(/\\left\\lfloor/g, "⌊").replace(/\\right\\rfloor/g, "⌋");
  out = out.replace(/\\lceil/g, "⌈").replace(/\\rceil/g, "⌉");
  out = out.replace(/\\lfloor/g, "⌊").replace(/\\rfloor/g, "⌋");
  out = out.replace(/\\times/g, "×").replace(/\\cdot/g, "·");
  out = out.replace(/\\le/g, "≤").replace(/\\ge/g, "≥").replace(/\\neq/g, "≠");
  out = out.replace(/\\pm/g, "±").replace(/\\sigma/g, "σ");
  out = out.replace(/\\Delta/g, "Δ").replace(/\\sum/g, "∑");
  out = out.replace(/\\in/g, "∈").replace(/\\sim/g, "~");
  out = out.replace(/\\;/g, " ");
  // Handle simple \frac{a}{b} (supports 1 level of nested braces)
  out = out.replace(/\\frac\{((?:[^{}]|\{[^}]*\})*)\}\{((?:[^{}]|\{[^}]*\})*)\}/g, (_m, num: string, den: string) => {
    return `<span class="frac"><span class="frac-num">${num}</span><span class="frac-den">${den}</span></span>`;
  });
  // Handle superscript ^{...} or ^x and subscript _{...} or _x
  out = out.replace(/\^\{([^}]*)\}/g, "<sup>$1</sup>").replace(/\^([a-zA-Z0-9])/g, "<sup>$1</sup>");
  out = out.replace(/_\{([^}]*)\}/g, "<sub>$1</sub>").replace(/_([a-zA-Z0-9])/g, "<sub>$1</sub>");
  return out;
}

function renderInlineMarkdown(raw: string): string {
  const codeTokens: string[] = [];
  let text = raw.replace(/`([^`]+)`/g, (_m, code: string) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return `@@CODE_${String(idx)}@@`;
  });

  const mathTokens: string[] = [];
  text = text.replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => {
    const idx = mathTokens.length;
    mathTokens.push(`<span class="math-inline">${formatMathExpression(tex)}</span>`);
    return `@@MATH_${String(idx)}@@`;
  });

  text = escapeHtml(text);
  // Restore line breaks inside table cells written as <br>
  text = text.replace(/&lt;br\s*\/?&gt;/gi, "<br/>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
    return `<a href="${href}">${label}</a>`;
  });

  text = text.replace(/@@MATH_(\d+)@@/g, (_m, idx: string) => mathTokens[Number(idx)] ?? "");
  text = text.replace(/@@CODE_(\d+)@@/g, (_m, idx: string) => codeTokens[Number(idx)] ?? "");
  return text;
}

function renderDiagramSvg(code: string, index: number): string {
  if (index === 0 || code.includes("交互与可视化层")) {
    return `
    <div class="diagram-box">
      <svg viewBox="0 0 920 430" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="'Microsoft YaHei', 'PingFang SC', sans-serif">
        <defs>
          <marker id="arrow0" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#5e5446"/>
          </marker>
        </defs>
        <!-- Layer 1 -->
        <rect x="16" y="12" width="888" height="82" rx="10" fill="#fdfbf5" stroke="#c4442b" stroke-width="1.5"/>
        <text x="32" y="34" font-size="12" font-weight="700" fill="#c4442b">第 1 层：交互与可视化层 (web/src/components/)</text>
        <rect x="32" y="44" width="210" height="38" rx="6" fill="#f7f2e7" stroke="#d5cbb8"/>
        <text x="137" y="61" font-size="11" font-weight="700" text-anchor="middle" fill="#201c16">单品多维会签台</text>
        <text x="137" y="75" font-size="9.5" text-anchor="middle" fill="#6b6052">AgentOpsConsole / Intake / Evidence</text>
        <rect x="256" y="44" width="205" height="38" rx="6" fill="#f7f2e7" stroke="#d5cbb8"/>
        <text x="358" y="61" font-size="11" font-weight="700" text-anchor="middle" fill="#201c16">8回合市场博弈沙盘</text>
        <text x="358" y="75" font-size="9.5" text-anchor="middle" fill="#6b6052">SimShopArena (supplycut / pricewar)</text>
        <rect x="475" y="44" width="215" height="38" rx="6" fill="#f7f2e7" stroke="#d5cbb8"/>
        <text x="582" y="61" font-size="11" font-weight="700" text-anchor="middle" fill="#201c16">4拓扑公平评测竞技场</text>
        <text x="582" y="75" font-size="9.5" text-anchor="middle" fill="#6b6052">TopologyBenchmarkView (Part A/B)</text>
        <rect x="704" y="44" width="184" height="38" rx="6" fill="#f7f2e7" stroke="#d5cbb8"/>
        <text x="796" y="61" font-size="11" font-weight="700" text-anchor="middle" fill="#201c16">大白话导览与术语卡</text>
        <text x="796" y="75" font-size="9.5" text-anchor="middle" fill="#6b6052">PlainGuideBanner / plain-glossary</text>

        <!-- Arrow 1->2 -->
        <line x1="460" y1="94" x2="460" y2="116" stroke="#5e5446" stroke-width="1.5" marker-end="url(#arrow0)"/>
        <text x="472" y="109" font-size="9.5" fill="#6b6052">HTTP JSON / EventSource SSE 流</text>

        <!-- Layer 2 -->
        <rect x="16" y="118" width="888" height="70" rx="10" fill="#f7f2e7" stroke="#b07a2e" stroke-width="1.5"/>
        <text x="32" y="138" font-size="12" font-weight="700" fill="#b07a2e">第 2 层：服务与流式网关层 (src/server/)</text>
        <rect x="32" y="146" width="275" height="32" rx="6" fill="#fdfbf5" stroke="#d5cbb8"/>
        <text x="169" y="166" font-size="10.5" text-anchor="middle" fill="#201c16">pricing-app.ts / sse.ts (REST &amp; 帧时间戳流)</text>
        <rect x="322" y="146" width="280" height="32" rx="6" fill="#fdfbf5" stroke="#d5cbb8"/>
        <text x="462" y="166" font-size="10.5" text-anchor="middle" fill="#201c16">simshop-routes.ts / app.ts (博弈与竞技场 API)</text>
        <rect x="617" y="146" width="271" height="32" rx="6" fill="#fdfbf5" stroke="#d5cbb8"/>
        <text x="752" y="166" font-size="10.5" text-anchor="middle" fill="#201c16">agent-runs.ts / ledger-chain.ts / llm-settings</text>

        <!-- Arrow 2->3 -->
        <line x1="310" y1="188" x2="310" y2="210" stroke="#5e5446" stroke-width="1.5" marker-end="url(#arrow0)"/>
        <line x1="610" y1="188" x2="610" y2="210" stroke="#5e5446" stroke-width="1.5" marker-end="url(#arrow0)"/>

        <!-- Layer 3 -->
        <rect x="16" y="212" width="888" height="84" rx="10" fill="#fdfbf5" stroke="#2e6b52" stroke-width="1.5"/>
        <text x="32" y="234" font-size="12" font-weight="700" fill="#2e6b52">第 3 层：领域编排模板层 (src/templates/)</text>
        <rect x="32" y="244" width="235" height="40" rx="6" fill="#eef5f1" stroke="#9ec4b3"/>
        <text x="149" y="261" font-size="11" font-weight="700" text-anchor="middle" fill="#201c16">单品会签编排 (agentops/)</text>
        <text x="149" y="276" font-size="9.5" text-anchor="middle" fill="#4f5b56">catalog / runner / collaboration / deliberation</text>
        <rect x="280" y="244" width="225" height="40" rx="6" fill="#eef5f1" stroke="#9ec4b3"/>
        <text x="392" y="261" font-size="11" font-weight="700" text-anchor="middle" fill="#201c16">动态市场博弈 (simshop/)</text>
        <text x="392" y="276" font-size="9.5" text-anchor="middle" fill="#4f5b56">round / supply-negotiation / market / sandbox</text>
        <rect x="518" y="244" width="200" height="40" rx="6" fill="#eef5f1" stroke="#9ec4b3"/>
        <text x="618" y="261" font-size="11" font-weight="700" text-anchor="middle" fill="#201c16">定价与解析域 (pricing / intake)</text>
        <text x="618" y="276" font-size="9.5" text-anchor="middle" fill="#4f5b56">economics / simulate / candidates</text>
        <rect x="731" y="244" width="157" height="40" rx="6" fill="#f7f2e7" stroke="#d5cbb8"/>
        <text x="809" y="261" font-size="11" font-weight="700" text-anchor="middle" fill="#201c16">第二验证模板</text>
        <text x="809" y="276" font-size="9.5" text-anchor="middle" fill="#6b6052">meeting/ (跨行业验证)</text>

        <!-- Boundary Bar -->
        <line x1="16" y1="308" x2="904" y2="308" stroke="#c4442b" stroke-width="1.5" stroke-dasharray="6 4"/>
        <rect x="305" y="298" width="310" height="20" rx="4" fill="#c4442b"/>
        <text x="460" y="312" font-size="10" font-weight="700" text-anchor="middle" fill="#ffffff">强制物理隔离墙：src/engine/** 零导入 src/templates/**</text>

        <!-- Layer 4 -->
        <rect x="16" y="324" width="888" height="94" rx="10" fill="#201c16"/>
        <text x="32" y="346" font-size="12" font-weight="700" fill="#fdfbf5">第 4 层：自研事件溯源编排内核层 (src/engine/)</text>
        <rect x="32" y="358" width="165" height="46" rx="6" fill="#322c24" stroke="#5e5446"/>
        <text x="114" y="376" font-size="10.5" font-weight="700" text-anchor="middle" fill="#fdfbf5">声明式工作流引擎</text>
        <text x="114" y="393" font-size="9" text-anchor="middle" fill="#d5cbb8">9 种原语 / DAG 静态校验</text>

        <rect x="207" y="358" width="165" height="46" rx="6" fill="#322c24" stroke="#5e5446"/>
        <text x="289" y="376" font-size="10.5" font-weight="700" text-anchor="middle" fill="#fdfbf5">注册表与 MCP 协议</text>
        <text x="289" y="393" font-size="9" text-anchor="middle" fill="#d5cbb8">read/sandbox/commit 分级</text>

        <rect x="382" y="358" width="165" height="46" rx="6" fill="#322c24" stroke="#5e5446"/>
        <text x="464" y="376" font-size="10.5" font-weight="700" text-anchor="middle" fill="#fdfbf5">动态调度与预算仲裁</text>
        <text x="464" y="393" font-size="9" text-anchor="middle" fill="#d5cbb8">SemVer发现 / allocateBudget</text>

        <rect x="557" y="358" width="165" height="46" rx="6" fill="#322c24" stroke="#5e5446"/>
        <text x="639" y="376" font-size="10.5" font-weight="700" text-anchor="middle" fill="#fdfbf5">验证管线与 Self-Loop</text>
        <text x="639" y="393" font-size="9" text-anchor="middle" fill="#d5cbb8">5 重终止判据 / 兜底</text>

        <rect x="732" y="358" width="156" height="46" rx="6" fill="#322c24" stroke="#5e5446"/>
        <text x="810" y="376" font-size="10.5" font-weight="700" text-anchor="middle" fill="#fdfbf5">SQLite WAL 事件账本</text>
        <text x="810" y="393" font-size="9" text-anchor="middle" fill="#d5cbb8">幂等提交 / 崩溃恢复 / KB</text>
      </svg>
      <div class="diagram-caption">图 2-1 AgentOps Harness 四层解耦架构与内核边界物理隔离示意图</div>
    </div>`;
  }

  if (code.includes("COLLAB_WORKFLOW") || code.includes("预检门")) {
    return `
    <div class="diagram-box">
      <svg viewBox="0 0 920 385" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="'Microsoft YaHei', 'PingFang SC', sans-serif">
        <defs>
          <marker id="arrow1" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#201c16"/>
          </marker>
          <marker id="arrow1r" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#c4442b"/>
          </marker>
        </defs>
        <!-- Row 1: Intake -> Preflight -> Plan -> Research -> Account -> Market -->
        <rect x="16" y="24" width="120" height="48" rx="8" fill="#f7f2e7" stroke="#201c16"/>
        <text x="76" y="45" font-size="11" font-weight="700" text-anchor="middle" fill="#201c16">商户输入</text>
        <text x="76" y="61" font-size="9.5" text-anchor="middle" fill="#6b6052">链接 / 文案 / 填单</text>
        <line x1="136" y1="48" x2="162" y2="48" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>

        <polygon points="222,18 282,48 222,78 162,48" fill="#fdfbf5" stroke="#b07a2e" stroke-width="1.6"/>
        <text x="222" y="46" font-size="10.5" font-weight="700" text-anchor="middle" fill="#b07a2e">预检门</text>
        <text x="222" y="59" font-size="9" text-anchor="middle" fill="#6b6052">事实齐备?</text>

        <!-- Missing branch -->
        <line x1="222" y1="78" x2="222" y2="110" stroke="#c4442b" stroke-width="1.4" marker-end="url(#arrow1r)"/>
        <rect x="150" y="112" width="144" height="42" rx="6" fill="#fdf2ef" stroke="#c4442b"/>
        <text x="222" y="130" font-size="10" font-weight="700" text-anchor="middle" fill="#c4442b">主动追问 (needs-info)</text>
        <text x="222" y="145" font-size="8.8" text-anchor="middle" fill="#6b6052">禁止猜进货价跑完全程</text>

        <line x1="282" y1="48" x2="314" y2="48" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>
        <text x="298" y="41" font-size="9" text-anchor="middle" fill="#2e6b52">齐备</text>

        <rect x="316" y="24" width="132" height="48" rx="8" fill="#fdfbf5" stroke="#201c16"/>
        <text x="382" y="44" font-size="10.5" font-weight="700" text-anchor="middle" fill="#201c16">1~2. 规划与研究</text>
        <text x="382" y="60" font-size="9" text-anchor="middle" fill="#6b6052">planner + researcher</text>
        <line x1="448" y1="48" x2="474" y2="48" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>

        <rect x="476" y="24" width="132" height="48" rx="8" fill="#fdfbf5" stroke="#201c16"/>
        <text x="542" y="44" font-size="10.5" font-weight="700" text-anchor="middle" fill="#201c16">3. 成本会计</text>
        <text x="542" y="60" font-size="9" text-anchor="middle" fill="#6b6052">单件成本 + 保本红线</text>
        <line x1="608" y1="48" x2="634" y2="48" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>

        <rect x="636" y="24" width="260" height="48" rx="8" fill="#eef5f1" stroke="#2e6b52" stroke-width="1.5"/>
        <text x="766" y="44" font-size="10.5" font-weight="700" text-anchor="middle" fill="#2e6b52">4. 市场分析师 (market)</text>
        <text x="766" y="60" font-size="9" text-anchor="middle" fill="#201c16">消费保本价 → 三套报价 + 30天×200次推演</text>

        <!-- Down to Row 2: Three Specialists Parallel -->
        <line x1="766" y1="72" x2="766" y2="104" stroke="#201c16" stroke-width="1.4"/>
        <line x1="420" y1="104" x2="840" y2="104" stroke="#201c16" stroke-width="1.4"/>
        <line x1="420" y1="104" x2="420" y2="122" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>
        <line x1="630" y1="104" x2="630" y2="122" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>
        <line x1="840" y1="104" x2="840" y2="122" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>

        <rect x="330" y="124" width="180" height="46" rx="7" fill="#fdfbf5" stroke="#2e6b52"/>
        <text x="420" y="143" font-size="10.5" font-weight="700" text-anchor="middle" fill="#201c16">5a. 采购负责人</text>
        <text x="420" y="159" font-size="9" text-anchor="middle" fill="#6b6052">压力假设: 采购+10% 需求-30%</text>

        <rect x="540" y="124" width="180" height="46" rx="7" fill="#fdfbf5" stroke="#2e6b52"/>
        <text x="630" y="143" font-size="10.5" font-weight="700" text-anchor="middle" fill="#201c16">5b. 定价参谋</text>
        <text x="630" y="159" font-size="9" text-anchor="middle" fill="#6b6052">基准毛利线与保本垫复核</text>

        <rect x="750" y="124" width="150" height="46" rx="7" fill="#fdfbf5" stroke="#2e6b52"/>
        <text x="825" y="143" font-size="10.5" font-weight="700" text-anchor="middle" fill="#201c16">5c. 推广运营</text>
        <text x="825" y="159" font-size="9" text-anchor="middle" fill="#6b6052">压力假设: 推广预算×1.5</text>

        <!-- Converge to Challenge Response & Chair & Risk -->
        <line x1="420" y1="170" x2="420" y2="192" stroke="#201c16" stroke-width="1.4"/>
        <line x1="630" y1="170" x2="630" y2="192" stroke="#201c16" stroke-width="1.4"/>
        <line x1="825" y1="170" x2="825" y2="192" stroke="#201c16" stroke-width="1.4"/>
        <line x1="420" y1="192" x2="825" y2="192" stroke="#201c16" stroke-width="1.4"/>
        <line x1="630" y1="192" x2="630" y2="210" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>

        <rect x="520" y="212" width="220" height="46" rx="7" fill="#f7f2e7" stroke="#201c16"/>
        <text x="630" y="231" font-size="10.5" font-weight="700" text-anchor="middle" fill="#201c16">6~7. 质询回应 &amp; 主席裁决</text>
        <text x="630" y="247" font-size="9" text-anchor="middle" fill="#6b6052">失败数最少 + p10最优改判 (Decision Flip)</text>

        <line x1="520" y1="235" x2="480" y2="235" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>
        <rect x="308" y="212" width="170" height="46" rx="7" fill="#fdfbf5" stroke="#c4442b" stroke-width="1.5"/>
        <text x="393" y="231" font-size="10.5" font-weight="700" text-anchor="middle" fill="#c4442b">8. 独立风控审计</text>
        <text x="393" y="247" font-size="9" text-anchor="middle" fill="#6b6052">8 项硬检查 &amp; 证据边界</text>

        <line x1="308" y1="235" x2="264" y2="235" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>
        <polygon points="196,205 262,235 196,265 130,235" fill="#fdfbf5" stroke="#c4442b" stroke-width="1.5"/>
        <text x="196" y="233" font-size="10" font-weight="700" text-anchor="middle" fill="#c4442b">9. risk-gate</text>
        <text x="196" y="247" font-size="9" text-anchor="middle" fill="#6b6052">验证通过?</text>

        <!-- Self-Loop feedback -->
        <path d="M 196 205 L 196 182 L 735 182 L 735 74" fill="none" stroke="#c4442b" stroke-width="1.4" stroke-dasharray="5 3" marker-end="url(#arrow1r)"/>
        <rect x="20" y="176" width="166" height="36" rx="5" fill="#fdf2ef" stroke="#c4442b"/>
        <text x="103" y="191" font-size="9.5" font-weight="700" text-anchor="middle" fill="#c4442b">10. 定向修正 Self-Loop (≤2轮)</text>
        <text x="103" y="205" font-size="8.5" text-anchor="middle" fill="#6b6052">压广告 / 调活动折 / 换稳健方案</text>

        <!-- Row 3: Copy -> HumanGate -> Report -> Final Check -> Seal -->
        <line x1="196" y1="265" x2="196" y2="306" stroke="#2e6b52" stroke-width="1.5" marker-end="url(#arrow1)"/>
        <text x="208" y="290" font-size="9" fill="#2e6b52">通过 / 达上限 / 硬驳回</text>

        <rect x="24" y="308" width="190" height="50" rx="8" fill="#fdfbf5" stroke="#201c16"/>
        <text x="119" y="329" font-size="10.5" font-weight="700" text-anchor="middle" fill="#201c16">11. 上架文案师</text>
        <text x="119" y="346" font-size="9" text-anchor="middle" fill="#6b6052">限长 &amp; 极限词过滤 / 模型回退</text>
        <line x1="214" y1="333" x2="246" y2="333" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>

        <rect x="248" y="308" width="210" height="50" rx="8" fill="#fdf2ef" stroke="#c4442b" stroke-width="1.8"/>
        <text x="353" y="329" font-size="11" font-weight="700" text-anchor="middle" fill="#c4442b">12. 掌柜人工拍板门 (humanGate)</text>
        <text x="353" y="346" font-size="9" text-anchor="middle" fill="#201c16">awaiting-approval 选定方案或驳回</text>
        <line x1="458" y1="333" x2="490" y2="333" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>

        <rect x="492" y="308" width="185" height="50" rx="8" fill="#fdfbf5" stroke="#201c16"/>
        <text x="584" y="329" font-size="10.5" font-weight="700" text-anchor="middle" fill="#201c16">13~14. 报告与终检</text>
        <text x="584" y="346" font-size="9" text-anchor="middle" fill="#6b6052">final-check 一致性验证</text>
        <line x1="677" y1="333" x2="709" y2="333" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow1)"/>

        <rect x="711" y="308" width="185" height="50" rx="8" fill="#201c16"/>
        <text x="803" y="329" font-size="11" font-weight="700" text-anchor="middle" fill="#fdfbf5">15. SHA-256 电子封存</text>
        <text x="803" y="346" font-size="9" text-anchor="middle" fill="#d5cbb8">不可篡改全链路事件指纹</text>
      </svg>
      <div class="diagram-caption">图 3-1 单品多方会签质询工作流（COLLAB_WORKFLOW）17 节点编排与定向修正闭环</div>
    </div>`;
  }

  // SimShop 8-round pipeline diagram
  return `
    <div class="diagram-box">
      <svg viewBox="0 0 920 220" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="'Microsoft YaHei', 'PingFang SC', sans-serif">
        <defs>
          <marker id="arrow2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#201c16"/>
          </marker>
        </defs>
        <rect x="14" y="20" width="110" height="56" rx="8" fill="#f7f2e7" stroke="#201c16"/>
        <text x="69" y="42" font-size="10.5" font-weight="700" text-anchor="middle" fill="#201c16">1. planRound</text>
        <text x="69" y="59" font-size="9" text-anchor="middle" fill="#6b6052">读取观测信号</text>
        <line x1="124" y1="48" x2="144" y2="48" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow2)"/>

        <rect x="146" y="20" width="132" height="56" rx="8" fill="#eef5f1" stroke="#2e6b52"/>
        <text x="212" y="42" font-size="10.5" font-weight="700" text-anchor="middle" fill="#2e6b52">2. 并行提案</text>
        <text x="212" y="59" font-size="9" text-anchor="middle" fill="#201c16">buyer ∥ pricer ∥ marketer</text>
        <line x1="278" y1="48" x2="298" y2="48" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow2)"/>

        <rect x="300" y="20" width="144" height="56" rx="8" fill="#fdfbf5" stroke="#b07a2e"/>
        <text x="372" y="42" font-size="10.5" font-weight="700" text-anchor="middle" fill="#b07a2e">3. 价格战仲裁</text>
        <text x="372" y="59" font-size="9" text-anchor="middle" fill="#6b6052">marginalBids 负边际归零</text>
        <line x1="444" y1="48" x2="464" y2="48" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow2)"/>

        <rect x="466" y="20" width="152" height="56" rx="8" fill="#fdf2ef" stroke="#c4442b"/>
        <text x="542" y="42" font-size="10.5" font-weight="700" text-anchor="middle" fill="#c4442b">4. 断供嵌套议价</text>
        <text x="542" y="59" font-size="9" text-anchor="middle" fill="#6b6052">≤3轮谈判 + screenTalk脱敏</text>
        <line x1="618" y1="48" x2="638" y2="48" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow2)"/>

        <rect x="640" y="20" width="136" height="56" rx="8" fill="#fdfbf5" stroke="#c4442b"/>
        <text x="708" y="42" font-size="10.5" font-weight="700" text-anchor="middle" fill="#c4442b">5. Critic 修正环</text>
        <text x="708" y="59" font-size="9" text-anchor="middle" fill="#6b6052">5重判据 / 兜底安全网</text>
        <line x1="776" y1="48" x2="796" y2="48" stroke="#201c16" stroke-width="1.4" marker-end="url(#arrow2)"/>

        <rect x="798" y="20" width="108" height="56" rx="8" fill="#201c16"/>
        <text x="852" y="42" font-size="10.5" font-weight="700" text-anchor="middle" fill="#fdfbf5">6~7. 封存复盘</text>
        <text x="852" y="59" font-size="9" text-anchor="middle" fill="#d5cbb8">不可逆哈希链</text>

        <!-- Cross-round evolution loop -->
        <path d="M 852 76 L 852 135 L 212 135 L 212 78" fill="none" stroke="#2e6b52" stroke-width="1.6" stroke-dasharray="6 3" marker-end="url(#arrow2)"/>
        <rect x="330" y="116" width="400" height="36" rx="6" fill="#eef5f1" stroke="#2e6b52"/>
        <text x="530" y="132" font-size="10.5" font-weight="700" text-anchor="middle" fill="#2e6b52">跨回合自进化闭环：reflectRound → 写入 runId 隔离 KB Overlay</text>
        <text x="530" y="146" font-size="9.5" text-anchor="middle" fill="#201c16">运行时动态注册 pricer@1.0.0 → pricer@1.0.1（SemVer 调度自动生效）</text>

        <!-- Irreversible boundary note -->
        <rect x="14" y="170" width="892" height="34" rx="6" fill="#f7f2e7" stroke="#d5cbb8"/>
        <text x="460" y="191" font-size="10" font-weight="700" text-anchor="middle" fill="#201c16">不可逆提交防线：commitDecision(runId|round|commit) 唯一槽位锁定，篡改历史回合立即返回 HTTP 409 (round-locked)</text>
      </svg>
      <div class="diagram-caption">图 3-2 SimShop 8 回合动态市场博弈 7 步管线、嵌套子工作流与跨回合热升级闭环</div>
    </div>`;
}

function markdownToHtml(md: string): { bodyHtml: string; tocHtml: string } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const tocItems: { level: number; text: string; id: string }[] = [];
  let i = 0;
  let diagramIndex = 0;
  let inTocSection = false;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Skip the static Markdown TOC block because we render an interactive styled print TOC
    if (/^##\s+目录\s*$/.test(line)) {
      inTocSection = true;
      i += 1;
      continue;
    }
    if (inTocSection) {
      if (/^##\s+/.test(line)) {
        inTocSection = false;
      } else {
        i += 1;
        continue;
      }
    }

    // Fenced code blocks or mermaid diagrams
    const fenceMatch = line.match(/^```([a-zA-Z0-9_-]*)\s*$/);
    if (fenceMatch) {
      const lang = (fenceMatch[1] ?? "").toLowerCase();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        buf.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // skip closing ```
      const content = buf.join("\n");
      if (lang === "mermaid") {
        out.push(renderDiagramSvg(content, diagramIndex));
        diagramIndex += 1;
      } else {
        out.push(
          `<pre class="code-block"><div class="code-lang">${escapeHtml(lang || "code")}</div><code>${escapeHtml(content)}</code></pre>`,
        );
      }
      continue;
    }

    // Display math block $$...$$
    if (line.trim().startsWith("$$")) {
      const mathLines: string[] = [];
      const singleLine = line.trim().slice(2);
      if (singleLine.endsWith("$$") && singleLine.length > 2) {
        mathLines.push(singleLine.slice(0, -2));
        i += 1;
      } else {
        if (singleLine.length > 0) mathLines.push(singleLine);
        i += 1;
        while (i < lines.length) {
          const cur = (lines[i] ?? "").trim();
          if (cur.endsWith("$$")) {
            const rem = cur.slice(0, -2);
            if (rem.length > 0) mathLines.push(rem);
            i += 1;
            break;
          }
          mathLines.push(cur);
          i += 1;
        }
      }
      out.push(`<div class="math-block">${formatMathExpression(mathLines.join(" "))}</div>`);
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1]!.length;
      const text = hMatch[2]!.trim();
      const id = slugifyHeading(text);
      if (level === 1) {
        // Skip first H1 because cover page displays the document title
        i += 1;
        continue;
      }
      if (level === 2 || level === 3) {
        tocItems.push({ level, text, id });
      }
      const cls = level === 2 ? ' class="chapter-title"' : "";
      out.push(`<h${String(level)} id="${id}"${cls}>${renderInlineMarkdown(text)}</h${String(level)}>`);
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      out.push('<hr class="section-rule" />');
      i += 1;
      continue;
    }

    // Images ![alt](src)
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      const alt = imgMatch[1] ?? "";
      const rawSrc = imgMatch[2] ?? "";
      const resolvedPath = path.resolve(path.dirname(WHITEPAPER_MD), rawSrc);
      if (existsSync(resolvedPath)) {
        const b64 = readFileSync(resolvedPath).toString("base64");
        out.push(
          `<figure class="screenshot-fig"><img src="data:image/png;base64,${b64}" alt="${escapeHtml(alt)}" /><figcaption>${escapeHtml(alt)}</figcaption></figure>`,
        );
      } else {
        out.push(`<p class="missing-img">[截图文件未找到: ${escapeHtml(rawSrc)}]</p>`);
      }
      i += 1;
      continue;
    }

    // Tables
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\|[\s:|-]+\|/.test((lines[i + 1] ?? "").trim())) {
      const parseRow = (rowLine: string): string[] =>
        rowLine
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());

      const headers = parseRow(line);
      const alignments = parseRow(lines[i + 1] ?? "").map((cell) => {
        if (cell.startsWith(":") && cell.endsWith(":")) return "center";
        if (cell.endsWith(":")) return "right";
        return "left";
      });
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        bodyRows.push(parseRow(lines[i] ?? ""));
        i += 1;
      }

      const thead = `<thead><tr>${headers
        .map((h, idx) => `<th style="text-align:${alignments[idx] ?? "left"}">${renderInlineMarkdown(h)}</th>`)
        .join("")}</tr></thead>`;
      const tbody = `<tbody>${bodyRows
        .map(
          (row) =>
            `<tr>${headers
              .map((_, idx) => `<td style="text-align:${alignments[idx] ?? "left"}">${renderInlineMarkdown(row[idx] ?? "")}</td>`)
              .join("")}</tr>`,
        )
        .join("")}</tbody>`;
      out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // Blockquotes
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith(">")) {
        quoteLines.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${quoteLines.map((q) => renderInlineMarkdown(q)).join("<br/>")}</blockquote>`);
      continue;
    }

    // Lists (unordered or ordered)
    if (/^(\s*[-*+]|\s*\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const tag = ordered ? "ol" : "ul";
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        const m = cur.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!m) break;
        const indent = m[1]!.length;
        const itemText = m[3]!;
        if (indent >= 2 && items.length > 0) {
          items[items.length - 1] += `<div class="sub-li">• ${renderInlineMarkdown(itemText)}</div>`;
        } else {
          items.push(renderInlineMarkdown(itemText));
        }
        i += 1;
      }
      out.push(`<${tag}>${items.map((it) => `<li>${it}</li>`).join("")}</${tag}>`);
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Normal paragraph
    const paraLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !/^(#{1,4}\s|```|\$\$|>|\||---+|!\[|(\s*[-*+]|\s*\d+\.)\s+)/.test(lines[i] ?? "")
    ) {
      paraLines.push(lines[i] ?? "");
      i += 1;
    }
    out.push(`<p>${renderInlineMarkdown(paraLines.join(" "))}</p>`);
  }

  const tocHtml = `
    <section class="toc-page">
      <div class="toc-header">目录</div>
      <ul class="toc-list">
        ${tocItems
          .map(
            (item) =>
              `<li class="toc-l${String(item.level)}"><a href="#${item.id}">${renderInlineMarkdown(item.text)}</a></li>`,
          )
          .join("\n")}
      </ul>
    </section>`;

  return { bodyHtml: out.join("\n"), tocHtml };
}

function buildHtmlDocument(mdContent: string): string {
  const { bodyHtml, tocHtml } = markdownToHtml(mdContent);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>AgentOps Harness：可信多智能体编排与验证平台技术方案书</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 16mm 18mm 16mm;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      color: #201c16;
      background: #ffffff;
      font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "SimSun", sans-serif;
      font-size: 10.2pt;
      line-height: 1.65;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* Cover Page */
    .cover-page {
      height: 252mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 18mm 14mm;
      background: #fdfbf5;
      border: 2px solid #201c16;
      border-radius: 6px;
      page-break-after: always;
    }
    .cover-badge {
      display: inline-block;
      background: #c4442b;
      color: #ffffff;
      font-size: 10pt;
      font-weight: 700;
      padding: 5px 14px;
      border-radius: 4px;
      letter-spacing: 0.6px;
    }
    .cover-title {
      margin-top: 22mm;
      font-family: "Georgia", "SimSun", "Microsoft YaHei", serif;
      font-size: 26pt;
      font-weight: 800;
      line-height: 1.3;
      color: #201c16;
    }
    .cover-subtitle {
      margin-top: 8mm;
      font-size: 12.5pt;
      line-height: 1.6;
      color: #4f463b;
      border-left: 4px solid #2e6b52;
      padding-left: 12px;
    }
    .cover-kpis {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-top: 18mm;
    }
    .kpi-card {
      background: #f7f2e7;
      border: 1px solid #d5cbb8;
      border-radius: 6px;
      padding: 10px 14px;
    }
    .kpi-label { font-size: 8.8pt; color: #6b6052; }
    .kpi-val { font-size: 14pt; font-weight: 800; color: #201c16; margin-top: 3px; }
    .kpi-sub { font-size: 8.5pt; color: #2e6b52; margin-top: 2px; }
    .cover-meta {
      border-top: 1.5px solid #d5cbb8;
      padding-top: 10px;
      font-size: 9.5pt;
      color: #4f463b;
      display: flex;
      justify-content: space-between;
    }

    /* TOC Page */
    .toc-page {
      page-break-after: always;
      padding: 2mm 2mm;
    }
    .toc-header {
      font-size: 16pt;
      font-weight: 800;
      color: #201c16;
      border-bottom: 2px solid #c4442b;
      padding-bottom: 5px;
      margin-bottom: 10px;
    }
    .toc-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .toc-list li { margin: 2.5px 0; line-height: 1.38; }
    .toc-list a {
      text-decoration: none;
      color: #201c16;
    }
    .toc-l2 {
      font-weight: 700;
      font-size: 10.2pt;
      margin-top: 7px !important;
      color: #201c16;
    }
    .toc-l3 {
      padding-left: 16px;
      font-size: 9.1pt;
      color: #4f463b;
    }

    /* Content Typography */
    h2.chapter-title {
      font-size: 15pt;
      font-weight: 800;
      color: #201c16;
      border-bottom: 2px solid #201c16;
      padding-bottom: 4px;
      margin-top: 18px;
      margin-bottom: 10px;
      page-break-after: avoid;
    }
    h2.chapter-title:not(:first-of-type) {
      page-break-before: always;
      margin-top: 0;
    }
    h3 {
      font-size: 11.8pt;
      font-weight: 700;
      color: #2e6b52;
      margin-top: 13px;
      margin-bottom: 6px;
      page-break-after: avoid;
    }
    h4 {
      font-size: 10.4pt;
      font-weight: 700;
      color: #c4442b;
      margin-top: 10px;
      margin-bottom: 5px;
      page-break-after: avoid;
    }
    p { margin: 5px 0 7.5px; text-align: justify; line-height: 1.58; }
    ul, ol { margin: 5px 0 8px; padding-left: 20px; line-height: 1.56; }
    li { margin: 2.5px 0; }
    .sub-li { margin-left: 12px; margin-top: 2.5px; font-size: 9.3pt; color: #3f382f; }

    code {
      font-family: "Consolas", "Cascadia Mono", monospace;
      font-variant-ligatures: none;
      font-feature-settings: "liga" 0, "calt" 0;
      font-size: 8.6pt;
      background: #f4efe4;
      color: #a3321d;
      padding: 1px 4px;
      border-radius: 3px;
    }
    .code-block {
      background: #fdfbf5;
      border: 1px solid #d5cbb8;
      border-left: 4px solid #2e6b52;
      border-radius: 6px;
      padding: 9px 12px;
      margin: 10px 0 12px;
      overflow-x: auto;
      page-break-inside: avoid;
      position: relative;
    }
    .code-block code {
      font-family: "Consolas", "Cascadia Mono", monospace;
      font-variant-ligatures: none;
      font-feature-settings: "liga" 0, "calt" 0;
      background: transparent;
      color: #201c16;
      padding: 0;
      font-size: 8.2pt;
      line-height: 1.48;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .code-lang {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      color: #6b6052;
      margin-bottom: 4px;
    }

    blockquote {
      margin: 10px 0;
      padding: 8px 12px;
      background: #f7f2e7;
      border-left: 4px solid #b07a2e;
      border-radius: 0 6px 6px 0;
      font-size: 9.4pt;
      color: #3f382f;
      page-break-inside: avoid;
    }

    .table-wrap { margin: 10px 0 14px; page-break-inside: avoid; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.8pt;
      line-height: 1.45;
    }
    th {
      background: #201c16;
      color: #fdfbf5;
      font-weight: 700;
      padding: 6px 8px;
      border: 1px solid #201c16;
    }
    td {
      padding: 5.5px 8px;
      border: 1px solid #d5cbb8;
      vertical-align: top;
    }
    tr:nth-child(even) td { background: #fdfbf5; }
    tr { page-break-inside: avoid; }

    /* Math formatting */
    .math-block {
      margin: 10px 0;
      padding: 8px 12px;
      background: #fdfbf5;
      border: 1px solid #e5dccb;
      border-radius: 6px;
      text-align: center;
      font-family: "Cambria Math", "Georgia", serif;
      font-size: 10.5pt;
      page-break-inside: avoid;
    }
    .math-inline {
      font-family: "Cambria Math", "Georgia", serif;
      font-size: 10pt;
      padding: 0 2px;
    }
    .frac {
      display: inline-flex;
      flex-direction: column;
      vertical-align: middle;
      text-align: center;
      font-size: 0.9em;
      margin: 0 3px;
    }
    .frac-num {
      border-bottom: 1px solid #201c16;
      padding: 0 4px 1px;
    }
    .frac-den {
      padding: 1px 4px 0;
    }

    /* Diagrams and Screenshots */
    .diagram-box {
      margin: 12px 0 16px;
      padding: 10px;
      background: #ffffff;
      border: 1px solid #d5cbb8;
      border-radius: 8px;
      page-break-inside: avoid;
      text-align: center;
    }
    .diagram-caption {
      margin-top: 6px;
      font-size: 8.8pt;
      font-weight: 700;
      color: #4f463b;
    }
    .screenshot-fig {
      margin: 12px 0 16px;
      padding: 8px;
      background: #fdfbf5;
      border: 1px solid #d5cbb8;
      border-radius: 8px;
      page-break-inside: avoid;
      text-align: center;
    }
    .screenshot-fig img {
      width: 100%;
      max-height: 112mm;
      object-fit: contain;
      border: 1px solid #e2d8c5;
      border-radius: 4px;
    }
    .screenshot-fig figcaption {
      margin-top: 6px;
      font-size: 8.8pt;
      font-weight: 700;
      color: #201c16;
    }
    hr.section-rule {
      border: none;
      border-top: 1px solid #d5cbb8;
      margin: 12px 0;
    }
  </style>
</head>
<body>
  <section class="cover-page">
    <div>
      <span class="cover-badge">第五届「未来杯」AI 挑战赛 · 赛题一「Agent 编排创新应用」初赛方案书</span>
      <h1 class="cover-title">AgentOps Harness：<br/>可信多智能体编排与验证平台</h1>
      <div class="cover-subtitle">
        自研事件溯源编排内核 · 动态能力调度 · 闭环对抗质询 · 防篡改 SHA-256 账本<br/>
        演示载体：单品多维会签台 × SimShop 8 回合市场博弈 × 4 拓扑公平评测竞技场
      </div>
      <div class="cover-kpis">
        <div class="kpi-card">
          <div class="kpi-label">Part A 冻结 12 案单品评审通过率</div>
          <div class="kpi-val">12 / 12 (100.0%)</div>
          <div class="kpi-sub">对比 rule/single-agent 58.3% 与无审多Agent 83.3%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Part B SimShop 8 回合 3 场景总利润</div>
          <div class="kpi-val">+¥1,793.00</div>
          <div class="kpi-sub">断供 3 轮议价 4/16 成交 · 价格战负边际归零拦截</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">全链路自动化验证矩阵</div>
          <div class="kpi-val">68 文件 / 434 单元全通</div>
          <div class="kpi-sub">6 个 E2E Spec 共 41 项场景 · 320px 零溢出</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">自研事件溯源内核实测吞吐</div>
          <div class="kpi-val">32,555 events/s</div>
          <div class="kpi-sub">8 回合重放中位 0.531 ms · 调度延迟 p95 0.0023 ms</div>
        </div>
      </div>
    </div>
    <div class="cover-meta">
      <span>项目工程：<code>agent-ops-lab</code>（Node.js 22 + TypeScript + Hono + SQLite + React）</span>
      <span>文档版本：初赛正式版 · 2026-11-17</span>
    </div>
  </section>

  ${tocHtml}
  ${bodyHtml}
</body>
</html>`;
}

async function renderPdf(html: string): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), "agentops-pdf-"));
  const tempHtmlPath = path.join(tempDir, "whitepaper-render.html");
  writeFileSync(tempHtmlPath, html, "utf8");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${tempHtmlPath.replace(/\\/g, "/")}`, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: OUTPUT_PDF,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      margin: {
        top: "18mm",
        bottom: "18mm",
        left: "16mm",
        right: "16mm",
      },
      headerTemplate:
        '<div style="width:100%;font-size:8px;color:#6b6052;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif;"><span>AgentOps Harness · 可信多智能体编排与验证平台技术方案书</span><span>第五届「未来杯」赛题一初赛白皮书</span></div>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#6b6052;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif;"><span>数据来源：agent-ops-lab 实测运行与冻结基准评测</span><span>第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</span></div>',
    });
  } finally {
    await browser.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  process.stdout.write("[1/3] 正在启动隔离服务并采集 6 张最新高清系统截图...\n");
  await captureScreenshots();

  process.stdout.write("[2/3] 正在读取方案书 Markdown 并排版生成离线矢量图与 PDF 视图...\n");
  const md = readFileSync(WHITEPAPER_MD, "utf8");
  const html = buildHtmlDocument(md);

  process.stdout.write("[3/3] 正在调用 Chromium 渲染导出 A4 PDF 文档...\n");
  await renderPdf(html);
  process.stdout.write(`构建完成！PDF 已生成：${OUTPUT_PDF}\n`);
}

main().catch((err: unknown) => {
  console.error("生成方案书 PDF 失败:", err);
  process.exit(1);
});
