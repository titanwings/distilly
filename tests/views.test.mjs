/**
 * distilly view tests — schema diagnostics and deterministic rendering.
 * Zero dependencies: node --test tests/views.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ANCHOR_PATTERN,
  REQUIRED_SECTIONS,
  checkView,
  expectedSlug,
  significantText,
  verbatimRun,
} from "../src/views/schema.mjs";
import { canonicalJson, loadViewDocument, renderView, sha256, ViewError } from "../src/views/render.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(repoRoot, "bin", "distilly.mjs");

const QUOTES = {
  k0012: "这个方案我们先小范围试两周，跑通了再谈全量推广，别一上来就压全部资源。",
  k0014: "周报请只写结论与风险，过程细节放到附件里，我没时间读流水账。",
  k0021: "答应别人的时间点我会写在日历上，改期一定要提前说，不要当天才讲。",
  k0033: "数据口径要先对齐，否则后面所有的讨论都是白费力气，我宁愿多花半天确认定义。",
  "k0040:t2": "跨部门的事情，我一般直接找能拍板的人，抄送只是礼貌，不是决策方式。",
  k0044: "开会别超过四十分钟，议题提前发，没准备的人不用来。",
  k0051: "别在群里公开质疑同事的方案，有意见私下说，公开场合先给面子。",
  k0063: "我更看重长期信任，一次两次的快赢不重要，别把关系一次性用完。",
};

function evidenceEntry(anchor, source, kind, extra = {}) {
  return { anchor, source, kind, path: `knowledge/text/${source}.md`, quote: QUOTES[anchor], ...extra };
}

/** A document that satisfies every rule of docs/v2/CONTRACT.md. */
function validView() {
  return {
    meta: {
      slug: "zhang-san",
      title: "张三 · 沟通与协作画像",
      lang: "zh-CN",
      generated_at: "2026-09-13T00:00:00Z",
    },
    sections: [
      {
        id: "portrait",
        kind: "claims",
        title: "一句话画像",
        items: [
          { text: "做事偏实验驱动：先用小规模试点验证，再决定是否扩大投入。", anchors: ["k0012"], confidence: "high", emphasis: true },
        ],
      },
      {
        id: "communication",
        kind: "claims",
        title: "沟通风格",
        summary: "结论优先，过程材料另附。",
        items: [
          { text: "汇报时偏好结论先行，过程材料单独附上。", anchors: ["k0014"], confidence: "high" },
          { text: "会议要求议题前置，并控制单次时长。", anchors: ["k0044"], confidence: "medium" },
        ],
      },
      {
        id: "values",
        kind: "claims",
        title: "决策与价值观",
        items: [
          { text: "讨论前先对齐数据口径与定义。", anchors: ["k0033"], confidence: "high" },
          { text: "看重长期关系，不做一次性消耗。", anchors: ["k0063"], confidence: "medium" },
        ],
      },
      {
        id: "workstyle",
        kind: "claims",
        title: "工作方式",
        items: [
          { text: "跨团队协作倾向直接对接能拍板的人。", anchors: ["k0040:t2"], confidence: "high" },
          { text: "把承诺的时间点写进日历，改期提前说明。", anchors: ["k0021"], confidence: "medium" },
        ],
      },
      {
        id: "relationship",
        kind: "claims",
        title: "关系与称呼",
        items: [{ text: "公开场合维护同事面子，异议私下提出。", anchors: ["k0051"], confidence: "high" }],
      },
      {
        id: "boundaries",
        kind: "warnings",
        title: "边界与雷区",
        items: [
          { text: "已明确拍板后不要反复确认同一件事。", anchors: ["k0040:t2"], confidence: "medium", severity: "medium" },
          { text: "避免在公开群聊里直接否定他的方案。", anchors: ["k0051"], confidence: "high", severity: "high" },
        ],
      },
      {
        id: "timeline",
        kind: "timeline",
        title: "时间线演变",
        items: [
          { at: "2023-08", text: "开始负责跨部门协作，明确公开场合的沟通边界。", anchors: ["k0051"], confidence: "medium" },
          { at: "2024-02", text: "把数据口径对齐作为讨论的前置条件。", anchors: ["k0033"], confidence: "high" },
        ],
      },
    ],
    evidence: Object.keys(QUOTES).map((anchor) =>
      evidenceEntry(anchor, anchor.startsWith("k0040") ? "doc" : "feishu", anchor.startsWith("k0040") ? "doc" : "message", {
        note: `支撑引用了 ${anchor} 的结论`,
        at: "2024-03-02",
        id: `ledger-${anchor}`,
      }),
    ),
  };
}

function check(mutate, options = {}) {
  const view = validView();
  if (typeof mutate === "function") mutate(view);
  return checkView(view, { viewPath: "/tmp/skills/colleague/zhang-san/views/zhang-san.view.json", ...options });
}

function codes(report) {
  return report.diagnostics.map((entry) => entry.code);
}

function writeFixture(root, view, slug = "zhang-san") {
  const dir = join(root, "skills", "colleague", slug, "views");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.view.json`);
  writeFileSync(path, `${JSON.stringify(view, null, 2)}\n`, "utf8");
  return path;
}

function tempRoot() {
  return mkdtempSync(join(tmpdir(), "dst-view-"));
}

test("valid view.json passes with zero errors", () => {
  const report = check(null);
  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.equal(report.errors.length, 0);
  assert.deepEqual(report.summary.segments, 8);
  assert.equal(report.summary.sections, 7);
  assert.equal(report.summary.evidence, 8);
  assert.equal(report.summary.cited, 8);
  assert.equal(report.summary.uncited, 0);
  assert.equal(report.summary.quoteLeaks, 0);
});

test("valid view.json is a complete document even with no warnings", () => {
  const report = check(null);
  assert.ok(report.warnings.every((entry) => entry.severity === "warning"));
  assert.equal(report.summary.shareable, false);
});

test("expectedSlug only accepts <slug>.view.json", () => {
  assert.equal(expectedSlug("/a/b/zhang-san.view.json"), "zhang-san");
  assert.equal(expectedSlug("/a/b/notes.json"), null);
});

test("every diagnostic carries the self-repairing shape", () => {
  const report = check((view) => {
    view.sections[0].items[0].anchors = [];
    view.sections[1].kind = "story";
    view.sections[2].items[0].confidence = "certain";
  });
  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.length >= 3);
  for (const entry of report.diagnostics) {
    assert.deepEqual(Object.keys(entry).sort(), ["code", "evidence", "message", "severity", "subject", "supportedFixes"]);
    assert.equal(typeof entry.code, "string");
    assert.ok(["error", "warning"].includes(entry.severity));
    assert.equal(typeof entry.message, "string");
    assert.deepEqual(Object.keys(entry.subject).sort(), ["identity", "path"]);
    assert.equal(typeof entry.subject.path, "string");
    assert.ok("identity" in entry.subject);
    assert.equal(typeof entry.evidence, "object");
    assert.ok(Array.isArray(entry.supportedFixes));
    assert.ok(entry.supportedFixes.length > 0, `${entry.code} must tell the model how to fix itself`);
    assert.ok(entry.supportedFixes.every((fix) => typeof fix === "string" && fix.length > 0));
  }
});

test("missing segment is reported with its id", () => {
  const report = check((view) => {
    view.sections = view.sections.filter((section) => section.id !== "workstyle");
  });
  assert.equal(report.ok, false);
  const entry = report.errors.find((row) => row.code === "VIEW_SECTION_MISSING");
  assert.ok(entry);
  assert.equal(entry.subject.identity, "workstyle");
  assert.match(entry.subject.path, /workstyle/);
});

test("the evidence appendix cannot be authored or empty", () => {
  const authored = check((view) => {
    view.sections.push({ id: "evidence", kind: "evidence", title: "证据附录", items: [] });
  });
  assert.ok(codes(authored).includes("VIEW_SECTION_UNKNOWN") || codes(authored).includes("VIEW_SECTION_DERIVED"));

  const empty = check((view) => {
    view.evidence = [];
  });
  assert.ok(codes(empty).includes("VIEW_EVIDENCE_EMPTY"));
  assert.equal(empty.ok, false);
});

test("kind must be claims|timeline|warnings and match the fixed segment", () => {
  const report = check((view) => {
    view.sections[1].kind = "story";
  });
  const entry = report.errors.find((row) => row.code === "VIEW_KIND_INVALID");
  assert.ok(entry);
  assert.equal(entry.subject.identity, "communication");
  assert.deepEqual(entry.evidence.expected, "claims");
  assert.deepEqual(entry.evidence.allowed, ["claims", "timeline", "warnings"]);
});

test("claims need at least one anchor and a legal confidence", () => {
  const report = check((view) => {
    view.sections[0].items[0].anchors = [];
    view.sections[3].items[0].confidence = "very-high";
  });
  assert.ok(codes(report).includes("VIEW_ANCHOR_MISSING"));
  assert.ok(codes(report).includes("VIEW_CONFIDENCE_INVALID"));
  assert.equal(report.ok, false);
});

test("anchor format and unknown anchors are separated", () => {
  const report = check((view) => {
    view.sections[0].items.push({ text: "未登记的结论。", anchors: ["12"], confidence: "low" });
    view.sections[1].items.push({ text: "引用了不存在的锚点。", anchors: ["k9999"], confidence: "low" });
  });
  assert.ok(codes(report).includes("VIEW_ANCHOR_FORMAT"));
  assert.ok(codes(report).includes("VIEW_ANCHOR_UNKNOWN"));
  const unknown = report.errors.find((row) => row.code === "VIEW_ANCHOR_UNKNOWN");
  assert.equal(unknown.subject.identity, "k9999");
  assert.ok(unknown.supportedFixes.join(" ").includes("k9999"));
});

test("meta.slug must match the file name and the title must be specific", () => {
  const mismatch = check((view) => {
    view.meta.slug = "li-si";
  });
  assert.ok(codes(mismatch).includes("VIEW_SLUG_MISMATCH"));

  const generic = check((view) => {
    view.meta.title = "个人画像";
  });
  assert.ok(codes(generic).includes("VIEW_TITLE_GENERIC"));
  assert.equal(generic.ok, true, "a generic title is a warning, not an error");

  const missing = check((view) => {
    delete view.meta.title;
  });
  assert.ok(codes(missing).includes("VIEW_TITLE_MISSING"));
});

test("timeline entries need an at field", () => {
  const report = check((view) => {
    delete view.sections[6].items[0].at;
  });
  assert.ok(codes(report).includes("VIEW_TIMELINE_AT_MISSING"));
});

test("private mode rejects a verbatim source run of 12 characters or more", () => {
  const leaked = "方案我们先小范围试两周，跑通了再谈全量推广。";
  const report = check((view) => {
    view.sections[0].items[0].text = leaked;
  });
  const entry = report.errors.find((row) => row.code === "VIEW_QUOTE_LEAK");
  assert.ok(entry, `expected VIEW_QUOTE_LEAK, got ${codes(report).join(",")}`);
  assert.equal(entry.subject.path, "sections[0].items[0].text");
  assert.ok(entry.evidence.runLength >= 12);
  assert.equal(entry.evidence.anchor, "k0012");
  assert.equal(report.ok, false);
});

test("an 11 character overlap is not a leak", () => {
  const report = check((view) => {
    view.sections[0].items[0].text = "我们先小范围试两周验证一下。";
  });
  assert.ok(!codes(report).includes("VIEW_QUOTE_LEAK"));
});

test("--shareable allows quotes in the prose and is recorded in the summary", () => {
  const leaked = "方案我们先小范围试两周，跑通了再谈全量推广。";
  const report = check(
    (view) => {
      view.sections[0].items[0].text = leaked;
    },
    { shareable: true },
  );
  assert.equal(report.ok, true);
  assert.equal(report.summary.shareable, true);
  assert.equal(report.summary.quoteLeaks, 0);
});

test("verbatimRun ignores punctuation and spacing", () => {
  const quote = "数据口径要先对齐，否则后面所有的讨论都是白费力气。";
  const hit = verbatimRun("先把数据 口径 要先对齐，否则 后面所有的讨论都是白费力气", quote);
  assert.ok(hit);
  assert.ok(hit.length >= 12);
  assert.equal(verbatimRun("完全无关的一句话，只谈天气和午饭。", quote), null);
  assert.equal(significantText("a, b。c"), "abc");
});

test("uncited evidence is a warning, not an error", () => {
  const report = check((view) => {
    view.evidence.push(evidenceEntry("k0077", "slack", "message", { quote: "顺带一提，我不太用表情包回复工作消息。" }));
  });
  assert.equal(report.ok, true);
  const entry = report.warnings.find((row) => row.code === "VIEW_EVIDENCE_UNCITED");
  assert.ok(entry);
  assert.equal(entry.subject.identity, "k0077");
});

test("non-object documents fail loudly", () => {
  for (const value of [null, 42, "view", []]) {
    const report = checkView(value, { viewPath: "/tmp/x.view.json" });
    assert.equal(report.ok, false);
    assert.ok(codes(report).includes("VIEW_DOC_INVALID"));
  }
});

test("renderView writes a single-file page and a receipt, deterministically", () => {
  const rootA = tempRoot();
  const rootB = tempRoot();
  const viewPathA = writeFixture(rootA, validView());
  const viewPathB = writeFixture(rootB, validView());

  const first = renderView({ viewPath: viewPathA });
  const second = renderView({ viewPath: viewPathB });
  const third = renderView({ viewPath: viewPathA });

  assert.equal(first.receipt.outputs[0].sha256, second.receipt.outputs[0].sha256);
  assert.equal(first.receipt.outputs[0].sha256, third.receipt.outputs[0].sha256);
  assert.equal(first.html, third.html);
  assert.equal(sha256(readFileSync(first.receiptPath, "utf8")), first.receiptSha256);
  assert.equal(readFileSync(first.receiptPath, "utf8"), readFileSync(second.receiptPath, "utf8"));

  assert.equal(first.receipt.command, "view render");
  assert.equal(first.receipt.person, "zhang-san");
  assert.equal(first.receipt.shareable, false);
  assert.deepEqual(first.receipt.anchors, { total: 8, cited: 8 });
  assert.equal(first.receipt.segments.length, 8);
  assert.equal(first.receipt.segments.at(-1).id, "evidence");
  assert.deepEqual(first.receipt.inlined_sources, []);
  assert.equal(first.receipt.outputs[0].path, join("views", "zhang-san.html"));
  assert.match(first.receipt.template.sha256, /^[0-9a-f]{64}$/);
  assert.match(first.receipt.inputs[0].sha256, /^[0-9a-f]{64}$/);
});

test("rendered page is offline, CSP-frozen and free of external references", () => {
  const root = tempRoot();
  const viewPath = writeFixture(root, validView());
  const result = renderView({ viewPath });

  assert.equal(result.receipt.outputs[0].bytes, Buffer.byteLength(result.html, "utf8"));
  assert.ok(result.html.includes("<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'\">"));
  assert.ok(result.html.includes('<script id="distilly-view-data" type="application/json">'));
  assert.equal(result.html.includes("@@DISTILLY:"), false, "no template marker may survive a render");
  assert.equal(/https?:\/\//.test(result.html), false, "the page must not reference any URL");
  assert.equal(/<script[^>]+src=/i.test(result.html), false);
  assert.equal(/<link[^>]+href=/i.test(result.html), false);
  assert.equal(/@import|url\(http/i.test(result.html), false);
  assert.equal(result.html.includes("</script>"), true);
});

test("private render never inlines source wording; --shareable does and records it", () => {
  const root = tempRoot();
  const viewPath = writeFixture(root, validView());

  const privateRun = renderView({ viewPath });
  for (const quote of Object.values(QUOTES)) {
    assert.equal(privateRun.html.includes(quote.slice(0, 12)), false, "private output must not carry source wording");
    assert.equal(privateRun.html.includes(quote), false);
  }
  assert.deepEqual(privateRun.receipt.inlined_sources, []);

  const shareablePath = writeFixture(tempRoot(), validView());
  const shared = renderView({ viewPath: shareablePath, shareable: true });
  assert.ok(shared.html.includes(QUOTES.k0012), "shareable output must inline the quote");
  assert.equal(shared.receipt.shareable, true);
  assert.equal(shared.receipt.inlined_sources.length, 8);
  assert.deepEqual(shared.receipt.inlined_sources[0].anchor, "k0012");
  assert.match(shared.receipt.inlined_sources[0].quote_sha256, /^[0-9a-f]{64}$/);
  assert.ok(shared.receipt.inlined_sources[0].quote_bytes > 0);
  assert.notEqual(shared.receipt.outputs[0].sha256, privateRun.receipt.outputs[0].sha256);
});

test("renderView refuses an invalid document and writes nothing", () => {
  const root = tempRoot();
  const broken = validView();
  broken.sections[0].items[0].anchors = [];
  const viewPath = writeFixture(root, broken);
  const outPath = join(root, "skills", "colleague", "zhang-san", "views", "zhang-san.html");

  assert.throws(
    () => renderView({ viewPath }),
    (error) => {
      assert.ok(error instanceof ViewError);
      assert.ok(error.diagnostics.some((entry) => entry.code === "VIEW_ANCHOR_MISSING"));
      assert.ok(error.supportedFixes.length > 0);
      return true;
    },
  );
  assert.equal(existsSync(outPath), false);
  assert.equal(existsSync(join(root, "skills", "colleague", "zhang-san", "evidence", "renders", "receipt.json")), false);
});

test("loadViewDocument reports broken JSON with a fix", () => {
  const root = tempRoot();
  const dir = join(root, "views");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "broken.view.json");
  writeFileSync(path, "{ not json", "utf8");
  assert.throws(() => loadViewDocument(path), /not valid JSON/);
  assert.throws(() => loadViewDocument(join(dir, "missing.view.json")), /not found/);
});

test("canonicalJson sorts keys so receipts are byte-stable", () => {
  const value = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } };
  assert.equal(canonicalJson(value), canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
  assert.equal(canonicalJson(value), '{\n  "a": {\n    "c": [\n      3,\n      {\n        "e": 5,\n        "f": 4\n      }\n    ],\n    "d": 2\n  },\n  "b": 1\n}\n');
});

test("REQUIRED_SECTIONS names the eight page segments in order", () => {
  assert.deepEqual(
    REQUIRED_SECTIONS.map((entry) => entry.id),
    ["portrait", "communication", "values", "workstyle", "relationship", "boundaries", "timeline", "evidence"],
  );
  assert.deepEqual(KINDS_OF_AUTHORED(), ["claims", "claims", "claims", "claims", "claims", "warnings", "timeline"]);
});

function KINDS_OF_AUTHORED() {
  return REQUIRED_SECTIONS.filter((entry) => !entry.derived).map((entry) => entry.kind);
}

test("anchor pattern accepts ledger ids and rejects prose", () => {
  for (const value of ["k0012", "k0012:t3", "msg0001", "k0040:t2"]) assert.ok(ANCHOR_PATTERN.test(value), value);
  for (const value of ["12", "K0012", "[k0012]", "k12", "k0012:t"]) assert.equal(ANCHOR_PATTERN.test(value), false, value);
});

/* ---------------------------------------------------------------- CLI leaf */

function runCli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd: repoRoot });
}

test("cli: view check --json emits a contract receipt", () => {
  const root = tempRoot();
  writeFixture(root, validView());
  const run = runCli(["view", "check", "zhang-san", "--root", root, "--json"]);
  assert.equal(run.status, 0, run.stderr);
  const receipt = JSON.parse(run.stdout);
  assert.equal(receipt.command, "view check");
  assert.equal(receipt.ok, true);
  assert.equal(receipt.anchors.total, 8);
  assert.equal(receipt.anchors.cited, 8);
  assert.equal(receipt.diagnostics.length, 0);
  assert.equal(receipt.inputs.length, 1);
  assert.match(receipt.inputs[0].sha256, /^[0-9a-f]{64}$/);
});

test("cli: view check exits 1 and prints fixes for a broken document", () => {
  const root = tempRoot();
  const broken = validView();
  broken.sections = broken.sections.filter((section) => section.id !== "boundaries");
  broken.sections[0].items[0].confidence = "sure";
  writeFixture(root, broken);

  const human = runCli(["view", "check", "zhang-san", "--root", root]);
  assert.equal(human.status, 1);
  assert.match(human.stdout, /VIEW_SECTION_MISSING/);
  assert.match(human.stdout, /VIEW_CONFIDENCE_INVALID/);
  assert.match(human.stdout, /fix:/);

  const json = runCli(["view", "check", "zhang-san", "--root", root, "--json"]);
  assert.equal(json.status, 1);
  const receipt = JSON.parse(json.stdout);
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.length >= 2);
});

test("cli: view render writes the page twice with identical bytes", () => {
  const root = tempRoot();
  const viewPath = writeFixture(root, validView());
  const first = runCli(["view", "render", "zhang-san", "--root", root, "--json"]);
  assert.equal(first.status, 0, first.stderr);
  const htmlPath = join(root, "skills", "colleague", "zhang-san", "views", "zhang-san.html");
  const receiptPath = join(root, "skills", "colleague", "zhang-san", "evidence", "renders", "receipt.json");
  const firstHtml = readFileSync(htmlPath, "utf8");
  const firstReceipt = readFileSync(receiptPath, "utf8");

  const second = runCli(["view", "render", viewPath, "--json"]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(htmlPath, "utf8"), firstHtml);
  assert.equal(readFileSync(receiptPath, "utf8"), firstReceipt);

  const receipt = JSON.parse(second.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.outputs[0].sha256, sha256(firstHtml));
});

test("cli: view render refuses an invalid document with exit 1", () => {
  const root = tempRoot();
  const broken = validView();
  broken.evidence = [];
  writeFixture(root, broken);
  const run = runCli(["view", "render", "zhang-san", "--root", root]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /VIEW_EVIDENCE_EMPTY|failed view check/);
});

test("cli: view needs a slug or --file", () => {
  const run = runCli(["view", "check"]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /needs a <slug> or --file/);

  const help = runCli(["view", "--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /## English/);
});
