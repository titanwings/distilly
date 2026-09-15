#!/usr/bin/env node
/**
 * Blind-test runner for `docs/v2/ACCEPTANCE.md` §"效果层".
 *
 *   node scripts/blind-test.mjs prepare  --a <A.srt> --person <slug> --out <dir> [--baseline]
 *   node scripts/blind-test.mjs finalize --out <dir> --view <view.json> [--strict]
 *   node scripts/blind-test.mjs control  --a <A.srt> --out <dir>
 *   node scripts/blind-test.mjs score    --scores <scores.json> [--out report.md]
 *
 * The protocol is an A/B holdout: the distiller only ever sees the A half, the
 * judge only ever sees the rendered page (never the corpus), and the checker —
 * who *has* read B — scores ten traits per arm for hit / partial / miss /
 * undecidable / fabricated. This script does the mechanical half:
 *
 *   prepare   deterministic: harvest A → derive → write the authoring input,
 *             the canonical view skeleton, the judge prompt and a blank sheet.
 *             `--baseline` also fills the sections mechanically so a full run is
 *             reproducible in CI without a model in the loop.
 *   finalize  validate + render an authored view.json into `profile.html`.
 *   control   the same question for a run *without* the evidence layer.
 *   score     turn the filled sheet into the three metrics and a verdict.
 *
 * The judge and the checker are models or people. This script never pretends to
 * be either, and it never writes prose of its own into the page: the baseline is
 * labelled `mechanical-baseline` in the receipt, and sections it cannot support
 * are reported as gaps rather than padded with invented content.
 */

import { isEntryPoint } from "../src/cli/entry.mjs";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const BIN = join(root, "bin", "distilly.mjs");
const DERIVED_KINDS = ["voice", "stats", "relations", "shifts", "boundaries", "conflicts", "timeline"];

/** The seven authored segments, in the fixed page order from `docs/v2/RENDER.md` §3.1. */
const SECTIONS = [
  { id: "portrait", kind: "claims", title: "一句话画像", from: [] },
  { id: "communication", kind: "claims", title: "沟通风格", from: ["voice"] },
  { id: "values", kind: "claims", title: "决策与价值观", from: ["shifts"] },
  { id: "workstyle", kind: "claims", title: "工作方式", from: ["stats"] },
  { id: "relationship", kind: "claims", title: "关系与称呼", from: ["relations"] },
  { id: "boundaries", kind: "warnings", title: "边界与雷区", from: ["boundaries", "conflicts"] },
  { id: "timeline", kind: "timeline", title: "时间线演变", from: ["timeline"], timeline: true },
];

/** Ledger kind → the evidence badge `docs/v2/RENDER.md` §3.3 suggests. */
const EVIDENCE_KIND = { message: "message", chat: "message", email: "email", doc: "doc", document: "doc", note: "note" };

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const round = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, ""));

function distilly(args, cwd, { tolerate = false } = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
  const stdout = result.stdout ?? "";
  if (result.status !== 0 && !tolerate) {
    throw new Error(`distilly ${args.join(" ")} failed (${result.status}): ${(result.stderr || stdout).slice(0, 600)}`);
  }
  let receipt = null;
  const start = stdout.indexOf("{");
  if (start !== -1) {
    try {
      receipt = JSON.parse(stdout.slice(start));
    } catch {
      receipt = null;
    }
  }
  return { status: result.status, stdout, stderr: result.stderr ?? "", receipt };
}

/* ------------------------------------------------------------------ derivation */

/** Everything `prepare` reads back out of the work directory. */
function loadDerivation(personDir) {
  const ledger = JSON.parse(readFileSync(join(personDir, "knowledge", "index.json"), "utf8"));
  const derivedDir = join(personDir, "evidence", "derived");
  const claims = {};
  for (const kind of DERIVED_KINDS) {
    const path = join(derivedDir, `${kind}.json`);
    let document = { claims: [], notes: [] };
    try {
      document = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      /* a kind that produced nothing is simply absent */
    }
    claims[kind] = document;
  }

  // anchor → where it came from, so the appendix can name a real source.
  const anchors = new Map();
  for (const entry of ledger) {
    for (const anchor of entry.anchors ?? []) {
      anchors.set(anchor, {
        id: entry.id,
        source: entry.kind ?? "note",
        kind: EVIDENCE_KIND[entry.kind] ?? "note",
        path: `knowledge/${entry.locations?.text ?? "index.json"}`,
        at: entry.fetched_at ?? null,
      });
    }
  }
  return { ledger, claims, anchors };
}

function describeValue(value) {
  if (typeof value === "number") return round(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(describeValue).join("、");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, inner]) => {
        if (inner === null || inner === undefined) return null;
        if (Array.isArray(inner) || typeof inner === "object") return null;
        return `${key} ${describeValue(inner)}`;
      })
      .filter(Boolean)
      .join("；");
  }
  return String(value);
}

/** `label.zh：value`, clipped to the 280-character item budget. */
function claimText(claim) {
  const label = claim.label?.zh ?? claim.label?.en ?? claim.id;
  const body = describeValue(claim.value);
  const text = body ? `${label}：${body}` : label;
  return text.length > 260 ? `${text.slice(0, 257)}…` : text;
}

const DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?/;

function itemFromClaim(claim, anchors) {
  const cited = (claim.evidence ?? []).filter((anchor) => anchors.has(anchor));
  if (cited.length === 0) return null;
  const item = { text: claimText(claim), anchors: cited, confidence: claim.confidence ?? "medium" };
  return item;
}

/**
 * Fill the seven segments from the derived claims.
 *
 * The mapping is deliberately literal — one derived kind per segment — and the
 * one-line portrait is assembled from the statistics rather than written, so the
 * baseline cannot smuggle in a conclusion the evidence does not carry. Anything
 * the derivation could not support (a dated timeline over a corpus without
 * timestamps, say) is reported as a gap, never invented.
 */
export function baselineSections({ claims, anchors }) {
  const sections = [];
  const gaps = [];
  const byId = new Map();

  const all = DERIVED_KINDS.flatMap((kind) => (claims[kind]?.claims ?? []).map((claim) => ({ ...claim, kind })));
  for (const claim of all) {
    for (const anchor of claim.evidence ?? []) if (anchors.has(anchor)) (byId.get(anchor) ?? byId.set(anchor, []).get(anchor)).push(claim.id);
  }

  for (const section of SECTIONS) {
    if (section.id === "portrait") {
      const stats = Object.fromEntries((claims.stats?.claims ?? []).map((claim) => [claim.id, claim]));
      const parts = [];
      const cited = new Set();
      const messages = stats["stats.message_count"];
      const participants = stats["stats.participants"];
      if (messages) {
        parts.push(`可引用消息 ${describeValue(messages.value)} 条`);
        for (const anchor of messages.evidence ?? []) cited.add(anchor);
      }
      if (participants) {
        parts.push(`参与者 ${describeValue(participants.value)}`);
        for (const anchor of participants.evidence ?? []) cited.add(anchor);
      }
      const usable = [...cited].filter((anchor) => anchors.has(anchor));
      if (parts.length === 0 || usable.length === 0) {
        gaps.push({ section: section.id, reason: "no derived statistics to anchor a one-line portrait" });
        sections.push(gapSection(section, "派生统计不足以支撑一句话画像"));
        continue;
      }
      sections.push({
        id: section.id,
        kind: section.kind,
        title: section.title,
        items: [{ text: `${parts.join("，")}。`, anchors: usable, confidence: "high" }],
      });
      continue;
    }

    const items = [];
    for (const kind of section.from) {
      for (const claim of claims[kind]?.claims ?? []) {
        const item = itemFromClaim(claim, anchors);
        if (!item) continue;
        if (section.timeline) {
          const at = [claim.value?.from, claim.value?.at, claim.value?.date].find((value) => typeof value === "string" && DATE.test(value));
          if (!at) continue;
          item.at = at;
        }
        items.push(item);
      }
    }
    if (items.length === 0) {
      const reason = section.timeline
        ? "no derived phase carries a date; a timeline is not invented to fill the segment"
        : `the derivation produced no claims for ${section.from.join("/")}`;
      gaps.push({ section: section.id, reason });
      sections.push(gapSection(section, reason));
      continue;
    }
    sections.push({ id: section.id, kind: section.kind, title: section.title, items });
  }

  const cited = new Set(sections.flatMap((section) => section.items.flatMap((item) => item.anchors)));
  const evidence = [...cited].sort().map((anchor) => {
    const source = anchors.get(anchor);
    return {
      anchor,
      source: source.source,
      kind: source.kind,
      path: source.path,
      id: source.id,
      note: `由 ${source.path} 经 retrospect 派生`,
    };
  });
  return { sections, gaps, evidence, cited: cited.size };
}

export /**
 * A segment the derivation could not fill.
 *
 * The page order is fixed and every authored segment must be present, so a gap is
 * rendered *as a gap* — a segment that says so in words and cites nothing —
 * rather than dropped. Dropping it would shift every later segment out of its
 * contract position, and the reader would never learn that something is thin.
 */
function gapSection(section, reason) {
  return {
    id: section.id,
    kind: section.kind,
    title: section.title,
    items: [{ text: `本节证据不足：${reason}。`, confidence: "low", anchors: [] }],
    // Every declared gap carries the marker, not only the timeline: `view check`
    // downgrades "a segment is thin" to a warning *because* the section says it has
    // no evidence. A gap section without the marker is an error by definition — so
    // a page honestly reporting its own gaps could not be rendered at all.
    gap: true,
  };
}

export function buildView({ slug, sections, evidence }) {
  return {
    meta: { slug, title: "沟通与协作画像（派生证据版）", lang: "zh-CN", theme: "auto" },
    sections,
    evidence,
  };
}

/* ------------------------------------------------------------------ commands */

function writeJudgePrompt(out) {
  writeFileSync(
    join(out, "judge-prompt.md"),
    `# 裁判任务（盲测）

你只看到一份**私有模式**的人物画像页面：profile.html。你没有看过原始语料，也不要去猜它是谁。

请回答：

1. 用 **10 条**句子写出这个人的特征。每条必须是**可验证的**（能被"看原文的人"判定对/错），不要写"他很专业"这类无法判定的空话。
2. 每条特征后面再写**一句预测**：他在一个没出现过的新场景里会怎么做（例如"临时被要求周末上线会怎么回应"）。

规则：
- 只依据页面里的结论与锚点编号；页面默认不含原话。
- 不确定就写"无法判断"，不要编。编造会被单独统计，是最严重的失败。

把答案写回：每行 \`特征 | 预测\`，共 10 行。
`,
    "utf8",
  );
}

function defaultScores() {
  const blank = () => Array.from({ length: 10 }, (_, index) => ({ n: index + 1, trait: "", prediction: "", verdict: null, support: "" }));
  return { evidence: blank(), control: blank() };
}

function writeSheet(out) {
  const path = join(out, "scores.template.json");
  let sheet = defaultScores();
  try {
    sheet = { ...sheet, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    /* first run */
  }
  writeFileSync(path, `${JSON.stringify(sheet, null, 2)}\n`, "utf8");
}

function prepare() {
  const a = arg("a");
  const person = arg("person");
  const out = arg("out");
  if (!a || !person || !out) {
    console.error("usage: node scripts/blind-test.mjs prepare --a <A.srt> --person <slug> --out <dir> [--skeleton-only]");
    process.exit(2);
  }
  const work = join(out, "work");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(join(work, "corpus"), { recursive: true });
  cpSync(a, join(work, "corpus", basename(a)));
  distilly(["harvest", join(work, "corpus"), "--person", person, "--base-dir", work, "--json"], work);
  const retro = distilly(["retrospect", "--person", person, "--json"], work);

  const personDir = join(work, "skills", "colleague", person);
  const derivation = loadDerivation(personDir);
  mkdirSync(out, { recursive: true });

  // What the author (a model, in the real workflow) reads: claims + the anchor
  // table, never the corpus itself.
  const lines = ["# 蒸馏输入（仅 A 半段，私有模式）", "", `person: ${person}`, ""];
  for (const kind of DERIVED_KINDS) {
    const document = derivation.claims[kind];
    lines.push(`## ${kind}`, "");
    for (const note of document.notes ?? []) lines.push(`- 注：${note}`);
    for (const claim of document.claims ?? []) {
      lines.push(`- [${claim.confidence ?? "medium"}] ${claimText(claim)} — 锚点 ${(claim.evidence ?? []).join(" ")}`);
    }
    if ((document.claims ?? []).length === 0 && (document.notes ?? []).length === 0) lines.push("- （无）");
    lines.push("");
  }
  lines.push("## 锚点表", "");
  for (const [anchor, source] of [...derivation.anchors].sort()) {
    lines.push(`- ${anchor} ← ${source.path}（${source.source}${source.at ? ` · ${source.at}` : ""}）`);
  }
  writeFileSync(join(out, "deriver-input.md"), `${lines.join("\n")}\n`, "utf8");

  const skeleton = buildView({ slug: person, sections: SECTIONS.map(({ id, kind, title }) => ({ id, kind, title, items: [] })), evidence: [] });
  writeFileSync(join(out, "view.skeleton.json"), `${JSON.stringify(skeleton, null, 2)}\n`, "utf8");

  const receipt = {
    arm: "evidence",
    corpus: { file: basename(a), sha256: sha256(readFileSync(a, "utf8")) },
    derivation: {
      anchors_total: derivation.anchors.size,
      anchors_cited: retro.receipt?.anchors?.cited ?? 0,
      claims: Object.fromEntries(DERIVED_KINDS.map((kind) => [kind, (derivation.claims[kind]?.claims ?? []).length])),
      warnings: retro.receipt?.warnings ?? [],
    },
    view_source: "skeleton",
    next_steps: [
      "author the seven segments from deriver-input.md into view.skeleton.json (or rerun prepare with --baseline)",
      `node scripts/blind-test.mjs finalize --out ${out} --view ${out}/view.authored.json`,
      "hand profile.html + judge-prompt.md to a model that has not seen the corpus",
      `node scripts/blind-test.mjs control --a ${a} --out ${out}`,
      "score both arms with `node scripts/blind-test.mjs score --scores " + out + "/scores.json`",
    ],
  };

  // The page is rendered by default: a judge handed `judge-prompt.md` with no
  // `profile.html` has nothing to read, which is how this arm could "pass" while
  // producing no artefact at all. `--skeleton-only` keeps the old behaviour (write
  // the skeleton and stop, for a model that will author the view itself); the
  // historical `--baseline` flag still means the same thing it always did.
  if (flag("baseline") || !flag("skeleton-only")) {
    const built = baselineSections(derivation);
    const view = buildView({ slug: person, sections: built.sections, evidence: built.evidence });
    const viewPath = join(out, "view.baseline.json");
    writeFileSync(viewPath, `${JSON.stringify(view, null, 2)}\n`, "utf8");
    const checked = finalizeView({ out, viewPath, slug: person, personDir, receipt, source: "mechanical-baseline" });
    Object.assign(receipt, checked);
    receipt.view_source = "mechanical-baseline";
    receipt.sections_filled = built.sections.map((section) => `${section.id}(${section.items.length})`);
    receipt.gaps = built.gaps;
    receipt.caveat =
      "the baseline fills each segment from one derived kind and writes no prose of its own; " +
      "an authored page replaces it, and any section listed in `gaps` was left out rather than invented";
  }

  writeFileSync(join(out, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  writeJudgePrompt(out);
  writeSheet(out);
  console.log(`prepared ${out} (view_source: ${receipt.view_source}, gaps: ${(receipt.gaps ?? []).length})`);
  if (receipt.html) console.log(`  page → ${out}/profile.html (${receipt.html.bytes} bytes, external links: ${receipt.external_links})`);
  else console.log(`  skeleton → ${out}/view.skeleton.json · authoring input → ${out}/deriver-input.md`);
}

/** Validate + render one view document, then copy the page next to the receipt. */
/**
 * Distinct anchors cited by a rendered page.
 *
 * The page embeds its view data as JSON and the viewer turns each citation into
 * markup at runtime, so the file itself contains `"anchor": "k00NN"` rather than
 * `[k00NN]`. Counting the bracket form (as this first did) reported 0 for a page
 * full of citations.
 */
function countRenderedAnchors(html) {
  const embedded = /"sections"\s*:\s*\[/.test(html) ? html : "";
  const cited = new Set();
  for (const match of embedded.matchAll(/"anchors"\s*:\s*\[([^\]]*)\]/g)) {
    for (const anchor of match[1].matchAll(/"(k\d{4}(?::t\d+)?)"/g)) cited.add(anchor[1]);
  }
  if (cited.size === 0) {
    for (const match of html.matchAll(/"anchor"\s*:\s*"(k\d{4}(?::t\d+)?)"/g)) cited.add(match[1]);
  }
  return cited.size;
}

function finalizeView({ out, viewPath, slug, personDir, receipt, source }) {
  const checked = distilly(["view", "check", "--file", viewPath, "--json"], personDir, { tolerate: true });
  const rendered = distilly(["view", "render", "--file", viewPath, "--out", join(out, "profile.html"), "--json"], personDir, {
    tolerate: true,
  });
  const diagnostics = [];
  for (const entry of checked.receipt?.diagnostics ?? []) diagnostics.push(`${entry.code}: ${entry.message}`);
  const html = readFileSync(join(out, "profile.html"), "utf8");
  writeFileSync(join(out, "view-diagnostics.json"), `${JSON.stringify(checked.receipt ?? {}, null, 2)}\n`, "utf8");
  return {
    view_source: source,
    view: { file: basename(viewPath), sha256: sha256(readFileSync(viewPath, "utf8")) },
    check: { ok: checked.receipt?.ok ?? false, exit: checked.status, diagnostics },
    render: { ok: rendered.receipt?.ok ?? false, exit: rendered.status },
    html: { file: "profile.html", sha256: sha256(html), bytes: Buffer.byteLength(html) },
    external_links: /(?:src|href)\s*=\s*["']https?:/i.test(html) ? "present" : "none",
    // How many distinct anchors the page cites, read back out of the rendered HTML
    // rather than from the view spec: the judge's page is the artefact under test,
    // and a citation that did not survive rendering must not be counted. The
    // citations live in the embedded view-data JSON (the viewer renders them into
    // `data-anchor-ref` attributes at runtime), so the count comes from there.
    anchors: countRenderedAnchors(html),
  };
}

function finalize() {
  const out = arg("out");
  const view = arg("view");
  if (!out || !view) {
    console.error("usage: node scripts/blind-test.mjs finalize --out <dir> --view <view.json> [--strict]");
    process.exit(2);
  }
  const receiptPath = join(out, "receipt.json");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const person = receipt.view?.slug ?? JSON.parse(readFileSync(view, "utf8")).meta?.slug;
  const personDir = join(out, "work", "skills", "colleague", person);
  const result = finalizeView({ out, viewPath: resolve(view), slug: person, personDir, receipt, source: "authored" });
  Object.assign(receipt, result, { view_source: "authored", next_steps: receipt.next_steps });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(`finalized ${out}/profile.html (${result.html.bytes} bytes, check ok: ${result.check.ok}, external links: ${result.external_links})`);
  for (const line of result.check.diagnostics.slice(0, 8)) console.log(`  ${line}`);
  if (flag("strict") && !result.check.ok) process.exit(1);
}

const CONTROL_PROMPT = (source) => `# 对照任务（裸 prompt，无证据层）

下面是同一段语料的**原文**（${source}）。请**不要**运行任何命令、不要生成知识库或派生文件，只凭这段文字直接写出这个人的画像。

要求与实验组完全一致：8 个部分（一句话画像 / 沟通风格 / 决策与价值观 / 工作方式 / 关系与称呼 / 边界与雷区 / 时间线演变 / 证据附录），以及 **10 条可验证特征 + 每条一句预测**。

这一段用于对照：如果"没有证据层"也能得到同样的命中率与编造率，那证据层就是多余的。

---

`;

function control() {
  const a = arg("a");
  const out = arg("out");
  if (!a || !out) {
    console.error("usage: node scripts/blind-test.mjs control --a <A.srt> --out <dir>");
    process.exit(2);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "control-prompt.md"), CONTROL_PROMPT(basename(a)) + readFileSync(a, "utf8"), "utf8");
  writeSheet(out);
  console.log(`control prompt → ${out}/control-prompt.md (paste the model's answer into control-profile.md)`);
}

/* ------------------------------------------------------------------ scoring */

const VERDICTS = { hit: 1, partial: 0.5, miss: 0, undecidable: null, "": null, null: null };

export function armMetrics(rows) {
  let score = 0;
  let decidable = 0;
  let undecidable = 0;
  let fabrication = 0;
  for (const row of rows ?? []) {
    const verdict = row?.verdict ?? "";
    if (verdict === "fabricated") {
      fabrication += 1;
      decidable += 1;
      continue;
    }
    const value = VERDICTS[verdict];
    if (value === null || value === undefined) {
      undecidable += 1;
      continue;
    }
    score += value;
    decidable += 1;
  }
  const total = (rows ?? []).length;
  return {
    rows: total,
    decidable,
    undecidable,
    fabrication,
    hit_rate: decidable === 0 ? 0 : Number((score / decidable).toFixed(3)),
    undecidable_ratio: total === 0 ? 1 : Number((undecidable / total).toFixed(3)),
  };
}

export function verdictFor(metrics) {
  const reasons = [];
  if (metrics.fabrication > 0) reasons.push(`${metrics.fabrication} fabricated claim(s) — FALSIFIED`);
  if (metrics.hit_rate < 0.7) reasons.push(`hit rate ${metrics.hit_rate} < 0.7`);
  if (metrics.undecidable_ratio > 0.2) reasons.push(`undecidable ${metrics.undecidable_ratio} > 0.2`);
  return { pass: reasons.length === 0, reasons };
}

function score() {
  const scoresPath = arg("scores");
  if (!scoresPath) {
    console.error("usage: node scripts/blind-test.mjs score --scores <scores.json> [--out report.md]");
    process.exit(2);
  }
  const scores = JSON.parse(readFileSync(scoresPath, "utf8"));
  const arms = ["evidence", "control"].filter((arm) => Array.isArray(scores[arm]));
  if (arms.length === 0) throw new Error("scores.json needs an `evidence` and/or `control` array");

  const metrics = {};
  for (const arm of arms) metrics[arm] = armMetrics(scores[arm]);
  const lines = ["| 指标 | " + arms.join(" | ") + " |", "| --- | " + arms.map(() => "---").join(" | ") + " |"];
  const rows = [
    ["条目数", (m) => m.rows],
    ["可判定", (m) => m.decidable],
    ["无法判定", (m) => m.undecidable],
    ["命中率（hit + 0.5×partial）", (m) => m.hit_rate],
    ["无法判定比例", (m) => m.undecidable_ratio],
    ["**编造数**", (m) => m.fabrication],
  ];
  for (const [label, pick] of rows) lines.push(`| ${label} | ${arms.map((arm) => pick(metrics[arm])).join(" | ")} |`);

  const verdicts = Object.fromEntries(arms.map((arm) => [arm, verdictFor(metrics[arm])]));
  lines.push("", `判定：${arms.map((arm) => `${arm} → ${verdicts[arm].pass ? "PASS" : "FAIL"}`).join("；")}`);
  for (const arm of arms) for (const reason of verdicts[arm].reasons) lines.push(`- ${arm}: ${reason}`);
  if (arms.length === 2) {
    const delta = Number((metrics.evidence.hit_rate - metrics.control.hit_rate).toFixed(3));
    lines.push(
      "",
      `反向对照：证据层命中率 ${metrics.evidence.hit_rate} vs 裸 prompt ${metrics.control.hit_rate}（差 ${delta >= 0 ? "+" : ""}${delta}），` +
        `编造数 ${metrics.evidence.fabrication} vs ${metrics.control.fabrication}。`,
    );
  }

  const report = lines.join("\n") + "\n";
  const out = arg("out");
  if (out) {
    writeFileSync(out, report, "utf8");
    console.log(`report → ${out}`);
  }
  console.log(report);
}

const [, , command] = process.argv;
// Collected by `node --test` because the filename matches its `*-test.mjs` pattern:
// it is a CLI, not a suite, so declare nothing and leave quietly.
const collectedByRunner = Boolean(process.env.NODE_TEST_CONTEXT) && command === undefined;
if (collectedByRunner) {
  // deliberately empty
} else if (!isEntryPoint(import.meta.url)) {
  // imported for its helpers (`acceptance.mjs` does this): nothing to run
} else if (command === "prepare") prepare();
else if (command === "finalize") finalize();
else if (command === "control") control();
else if (command === "score") score();
else {
  console.error("usage: node scripts/blind-test.mjs <prepare|finalize|control|score> …");
  process.exit(2);
}
