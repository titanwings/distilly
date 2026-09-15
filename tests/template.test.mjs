/**
 * distilly template tests — the committed template must be the build of its fragments.
 * Zero dependencies: node --test tests/template.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FRAGMENTS, TEMPLATE_PATH, buildTemplate, sha256 } from "../scripts/generate-template.mjs";
import { VIEW_DATA_MARKER, renderView } from "../src/views/render.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const GENERATOR = join(repoRoot, "scripts", "generate-template.mjs");
const CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src unsafe-inline; script-src 'unsafe-inline'\">";

function readCommitted() {
  return readFileSync(TEMPLATE_PATH, "utf8");
}

/** Copy the build inputs into a scratch tree so drift can be simulated safely. */
function scratchTree() {
  const root = mkdtempSync(join(tmpdir(), "dst-template-"));
  for (const entry of ["scripts", "assets", "viewer"]) {
    cpSync(join(repoRoot, entry), join(root, entry), { recursive: true });
  }
  return root;
}

function runGenerator(root, args = []) {
  return spawnSync(process.execPath, [join(root, "scripts", "generate-template.mjs"), ...args], { encoding: "utf8" });
}

test("assets/distilly-template.html is byte-identical to a fresh build", () => {
  const { output, fragments } = buildTemplate();
  assert.equal(readCommitted(), output);
  assert.equal(sha256(output), sha256(readCommitted()));
  assert.deepEqual(
    fragments.map((entry) => entry.path),
    ["viewer/sections.js", "viewer/theme.js", "viewer/export.js", "viewer/focus.js"],
  );
  assert.ok(fragments.every((entry) => entry.bytes > 500 && /^[0-9a-f]{64}$/.test(entry.sha256)));
});

test("generate-template --check exits 0 on a clean tree and reports the digest", () => {
  const run = spawnSync(process.execPath, [GENERATOR, "--check", "--json"], { encoding: "utf8", cwd: repoRoot });
  assert.equal(run.status, 0, run.stderr);
  const receipt = JSON.parse(run.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.template.path, "assets/distilly-template.html");
  assert.equal(receipt.template.sha256, sha256(readCommitted()));
  assert.equal(receipt.template.bytes, Buffer.byteLength(readCommitted(), "utf8"));
  assert.equal(receipt.fragments.length, 4);
  assert.deepEqual(receipt.supported_fixes, []);
});

test("generate-template --check fails non-zero when a fragment changed but the template did not", () => {
  const root = scratchTree();

  const clean = runGenerator(root, ["--check"]);
  assert.equal(clean.status, 0, clean.stderr);

  const fragment = join(root, "viewer", "sections.js");
  writeFileSync(fragment, `${readFileSync(fragment, "utf8")}\n/* drift probe */\n`, "utf8");

  const drifted = runGenerator(root, ["--check"]);
  assert.equal(drifted.status, 1, "a stale template must fail the check");
  assert.match(drifted.stderr, /template drift/);
  assert.match(drifted.stderr, /generate-template\.mjs/);

  const json = runGenerator(root, ["--check", "--json"]);
  assert.equal(json.status, 1);
  const receipt = JSON.parse(json.stdout);
  assert.equal(receipt.ok, false);
  assert.notEqual(receipt.template.sha256, receipt.template.committed_sha256);
  assert.ok(receipt.supported_fixes.some((fix) => fix.includes("node scripts/generate-template.mjs")));

  const rebuild = runGenerator(root);
  assert.equal(rebuild.status, 0, rebuild.stderr);
  assert.equal(runGenerator(root, ["--check"]).status, 0);
  assert.ok(readFileSync(join(root, "assets", "distilly-template.html"), "utf8").includes("drift probe"));
});

test("generate-template fails loudly when a marker is missing or duplicated", () => {
  const missing = scratchTree();
  const sourcePath = join(missing, "assets", "template.source.html");
  writeFileSync(sourcePath, readFileSync(sourcePath, "utf8").replace("<!-- @@DISTILLY:VIEWER_FOCUS@@ -->\n", ""), "utf8");
  const missingRun = runGenerator(missing);
  assert.equal(missingRun.status, 1);
  assert.match(missingRun.stderr, /VIEWER_FOCUS.*exactly once/);

  const duplicated = scratchTree();
  const duplicatedPath = join(duplicated, "assets", "template.source.html");
  writeFileSync(duplicatedPath, readFileSync(duplicatedPath, "utf8") + "<!-- @@DISTILLY:VIEWER_THEME@@ -->\n", "utf8");
  const duplicatedRun = runGenerator(duplicated);
  assert.equal(duplicatedRun.status, 1);
  assert.match(duplicatedRun.stderr, /VIEWER_THEME.*exactly once/);
});

test("generate-template refuses a fragment that would break out of the page", () => {
  const root = scratchTree();
  const fragment = join(root, "viewer", "theme.js");
  writeFileSync(fragment, `${readFileSync(fragment, "utf8")}\n// </script><script>alert(1)</script>\n`, "utf8");
  const run = runGenerator(root);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /<\/script/);
});

test("the template is a single offline file with the frozen CSP", () => {
  const html = readCommitted();
  assert.ok(html.includes(`content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"`));
  assert.ok(!html.includes("http://") && !html.includes("https://"), "no absolute URL may appear in the template");
  assert.equal(/<script[^>]+src=/i.test(html), false);
  assert.equal(/<link[^>]+href=/i.test(html), false);
  assert.equal(/<img[^>]+src=/i.test(html), false);
  assert.equal((html.match(/<html\b/g) || []).length, 1);
  assert.equal((html.match(/<style>/g) || []).length, 1);
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes("<svg"), "the page uses one inline SVG mark, no image request");
});

test("the committed template carries the four fragments and exactly one view-data marker", () => {
  const html = readCommitted();
  assert.equal(html.split(VIEW_DATA_MARKER).length - 1, 1);
  assert.equal(html.replace(VIEW_DATA_MARKER, "").includes("@@DISTILLY:"), false, "no other marker may survive");
  for (const relative of Object.values(FRAGMENTS)) {
    const body = readFileSync(join(repoRoot, relative), "utf8");
    assert.ok(html.includes(body.trimEnd()), `${relative} is not embedded verbatim`);
  }
  assert.ok(html.includes('<script id="distilly-view-data" type="application/json">'));
  assert.ok(html.includes("data-section"), "the template ships the section root the fragments fill");
});

test("committed build is stable: two builds of the same fragments are byte-identical", () => {
  assert.equal(buildTemplate().output, buildTemplate().output);
});

test("two renders of the same view.json are byte-identical", () => {
  const root = mkdtempSync(join(tmpdir(), "dst-render-"));
  const dir = join(root, "views");
  const { mkdirSync } = require("node:fs");
  mkdirSync(dir, { recursive: true });
  const viewPath = join(dir, "lin-si.view.json");
  writeFileSync(
    viewPath,
    `${JSON.stringify(
      {
        meta: { slug: "lin-si", title: "林四 · 协作画像", generated_at: "2026-09-13T00:00:00Z" },
        sections: [
          { id: "portrait", kind: "claims", title: "一句话画像", items: [{ text: "偏好书面异步沟通。", anchors: ["k0001"], confidence: "high" }] },
          { id: "communication", kind: "claims", title: "沟通风格", items: [{ text: "异步优先，会议只做决策。", anchors: ["k0002"], confidence: "medium" }] },
          { id: "values", kind: "claims", title: "决策与价值观", items: [{ text: "把可回滚性放在第一位。", anchors: ["k0003"], confidence: "medium" }] },
          { id: "workstyle", kind: "claims", title: "工作方式", items: [{ text: "早上集中处理深度工作。", anchors: ["k0001"], confidence: "low" }] },
          { id: "relationship", kind: "claims", title: "关系与称呼", items: [{ text: "用全名称呼，不使用昵称。", anchors: ["k0002"], confidence: "low" }] },
          { id: "boundaries", kind: "warnings", title: "边界与雷区", items: [{ text: "不要在深夜发工作消息。", anchors: ["k0003"], confidence: "high", severity: "high" }] },
          { id: "timeline", kind: "timeline", title: "时间线演变", items: [{ at: "2025-01", text: "开始远程办公。", anchors: ["k0001"], confidence: "medium" }] },
        ],
        evidence: [
          { anchor: "k0001", source: "slack", kind: "message", path: "knowledge/text/slack.md", note: "沟通偏好" },
          { anchor: "k0002", source: "slack", kind: "message", path: "knowledge/text/slack.md", note: "称呼方式" },
          { anchor: "k0003", source: "email", kind: "email", path: "knowledge/text/email.md", note: "边界" },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const first = renderView({ viewPath });
  const second = renderView({ viewPath });
  assert.equal(first.html, second.html);
  assert.equal(first.receipt.outputs[0].sha256, second.receipt.outputs[0].sha256);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.equal(readFileSync(first.receiptPath, "utf8"), readFileSync(second.receiptPath, "utf8"));
  assert.ok(CSP.length > 0);
});
