/**
 * `collect feishu --mode browser` — the host-capture route.
 *
 * `tools/feishu_browser.py` drove Playwright against the user's Chrome profile.
 * v2 keeps computer use in the host: this module owns the consent gate, the plan,
 * the verbatim sink and the normalisation, and it must never open a browser
 * itself. The tests below pin exactly that split.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { grant } from "../src/consent.mjs";
import {
  BROWSER_SCOPE,
  browserPlan,
  collectBrowser,
  detectPageType,
  parseBrowserArgs,
  runCollectCli,
} from "../src/collect/feishu-browser.mjs";

const HERE = fileURLToPath(new URL("..", import.meta.url));

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "dst-feishu-browser-"));
  const home = join(root, "distilly");
  mkdirSync(home, { recursive: true });
  const env = { DISTILLY_HOME: home };
  const granted = grant(BROWSER_SCOPE, { env, note: "test" });
  return { root, home, env, token: granted.record.token, work: join(root, "work") };
}

function textDir(box) {
  return join(box.work, "skills", "colleague", "demo", "knowledge", "text");
}

test("detectPageType mirrors the Python tool's URL table", () => {
  assert.equal(detectPageType("https://acme.feishu.cn/wiki/Wik1"), "wiki");
  assert.equal(detectPageType("https://acme.feishu.cn/docx/Doc1"), "doc");
  assert.equal(detectPageType("https://acme.feishu.cn/docs/Old1"), "doc");
  assert.equal(detectPageType("https://acme.feishu.cn/sheets/Sht1"), "sheet");
  assert.equal(detectPageType("https://acme.feishu.cn/base/Bas1"), "base");
  assert.equal(detectPageType("https://acme.feishu.cn/messages/oc_1"), "chat");
  assert.equal(detectPageType("https://example.com/"), null);
});

test("computer use needs a consent token: exit 2, no files, scope named", () => {
  const box = sandbox();
  const result = collectBrowser({ env: box.env, root: box.work, person: "demo", url: "https://acme.feishu.cn/docx/Doc1" });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.receipt.status, "waiting-for-user-consent");
  assert.equal(result.receipt.consent_scope, BROWSER_SCOPE);
  assert.match(result.receipt.unavailable[0].remediation.join("\n"), /distilly collect feishu --mode browser --consent/);
  assert.equal(existsSync(join(box.work, "skills")), false, "nothing may be written before consent");
});

test("without a capture the receipt is a plan for the host, not a fake capture", () => {
  const box = sandbox();
  const result = collectBrowser({
    env: box.env,
    root: box.work,
    person: "demo",
    consentToken: box.token,
    url: "https://acme.feishu.cn/messages/oc_demo",
  });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.status, "awaiting-host-capture");
  assert.equal(result.receipt.page_type, "chat");
  assert.equal(result.receipt.provenance.confidence, "host-reported");
  assert.ok(result.receipt.outputs.length === 0);
  assert.equal(existsSync(join(box.work, "skills")), false);
  const plan = result.receipt.plan;
  assert.ok(plan.steps.some((step) => /never opens one/.test(step)));
  assert.ok(plan.steps.some((step) => /distilly collect feishu --mode browser --consent/.test(step)));
  assert.ok(plan.forbidden.some((step) => /never drives a browser/.test(step)));
});

test("a host capture becomes knowledge text with anchors, provenance and consent", () => {
  const box = sandbox();
  const capture = join(box.root, "capture.txt");
  writeFileSync(capture, "先看数据，再看日志，最后才看代码。\n钱对不上，先别改代码，先把账翻出来。\n", "utf8");
  const result = collectBrowser({
    env: box.env,
    root: box.work,
    person: "demo",
    consentToken: box.token,
    capturePath: capture,
    url: "https://acme.feishu.cn/docx/Doc1",
    now: "2026-09-13T00:00:00.000Z",
  });
  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.status, "captured");
  assert.ok(result.receipt.anchors.total >= 2);
  assert.ok(result.receipt.outputs.some((output) => output.kind === "text"));

  const [name] = readdirSync(textDir(box));
  const body = readFileSync(join(textDir(box), name), "utf8");
  assert.match(body, /^\[k0001\] 先看数据，再看日志，最后才看代码。$/m);

  const ledger = JSON.parse(readFileSync(join(box.work, "skills", "colleague", "demo", "knowledge", "index.json"), "utf8"));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].method, "browser-host");
  assert.equal(ledger[0].credentialed, false);
  assert.equal(ledger[0].provenance.producer, "host:computer-use");
  assert.equal(ledger[0].provenance.confidence, "host-reported");
  assert.equal(ledger[0].url, "https://acme.feishu.cn/docx/Doc1");
  assert.equal(ledger[0].consent.scope, BROWSER_SCOPE);
  assert.ok(ledger[0].locations.text && ledger[0].locations.raw);
});

test("an HTML capture is stripped to text, and the raw bytes stay verbatim", () => {
  const box = sandbox();
  const capture = join(box.root, "capture.html");
  const html = "<html><body><h1>复盘</h1><p>根因是幂等键缺失。</p><script>alert(1)</script></body></html>";
  writeFileSync(capture, html, "utf8");
  const result = collectBrowser({
    env: box.env,
    root: box.work,
    person: "demo",
    consentToken: box.token,
    capturePath: capture,
    url: "https://acme.feishu.cn/docx/Doc2",
    now: "2026-09-13T00:00:00.000Z",
  });
  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  const [name] = readdirSync(textDir(box));
  const body = readFileSync(join(textDir(box), name), "utf8");
  assert.equal(body.includes("<h1>"), false, "tags must not reach the knowledge text");
  assert.equal(body.includes("alert(1)"), false, "script content must not reach the knowledge text");
  assert.match(body, /复盘/);
  assert.match(body, /根因是幂等键缺失/);

  const rawDir = join(box.work, "skills", "colleague", "demo", "knowledge", "raw", "feishu");
  const [rawName] = readdirSync(rawDir);
  assert.equal(readFileSync(join(rawDir, rawName), "utf8"), html, "the capture itself is stored verbatim");
});

test("this module cannot drive a browser: no playwright, no page, no input", () => {
  const source = readFileSync(join(HERE, "src", "collect", "feishu-browser.mjs"), "utf8");
  assert.equal(/from\s+["']playwright/.test(source), false);
  assert.equal(/require\(["']playwright/.test(source), false);
  assert.equal(/\bpuppeteer\b/.test(source), false);
  assert.equal(/page\.(click|type|fill|goto|keyboard|mouse)\b/.test(source), false);
  // The plan is data, not code: it must tell the host what to do.
  assert.match(browserPlan({ url: "https://acme.feishu.cn/docx/Doc1", pageType: "doc" }).steps[0], /Host \(computer use\)/);
});

test("cli: unknown options and a missing target are usage errors, not crashes", () => {
  assert.match(parseBrowserArgs(["--person", "demo", "--nope"]).error, /unknown option: --nope/);
  assert.match(parseBrowserArgs(["--person", "demo"]).error, /needs --url/);
  assert.match(parseBrowserArgs(["--url", "https://acme.feishu.cn/docx/D1"]).error, /--person is required/);
  assert.match(parseBrowserArgs(["--mode", "mcp"]).error, /--mode browser only/);
});
