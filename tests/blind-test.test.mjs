/**
 * Blind-test tooling: `scripts/split-corpus.mjs` (A/B holdout) and
 * `scripts/blind-test.mjs` (prepare / control / score).
 *
 * These tests pin the properties the protocol in `docs/v2/ACCEPTANCE.md` relies
 * on: the holdout really partitions the corpus, the split is reproducible, the
 * three metrics are computed by the script rather than by hand, and `prepare`
 * emits a page the judge can read without ever seeing the raw corpus.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";

const root = resolve(import.meta.dirname, "..");
const FIXTURE = join(root, "tests", "fixtures", "public-corpus", "synthetic-interview", "transcript.srt");
const workdirs = [];

function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  workdirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true });
});

import { rmSync } from "node:fs";

function run(script, args, options = {}) {
  const result = spawnSync(process.execPath, [join(root, "scripts", script), ...args], {
    encoding: "utf8",
    ...options,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function split(input, outDir, extra = []) {
  const result = run("split-corpus.mjs", ["--in", input, "--out", outDir, ...extra]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(readFileSync(join(outDir, "split.json"), "utf8"));
}

function sheet(verdicts) {
  return verdicts.map((verdict, index) => ({
    n: index + 1,
    trait: `trait ${index + 1}`,
    prediction: `prediction ${index + 1}`,
    verdict,
    support: "",
  }));
}

describe("split-corpus", () => {
  it("partitions the corpus: every cue lands in exactly one half", () => {
    const out = scratch("split");
    const receipt = split(FIXTURE, out);
    assert.equal(receipt.split_by, "timecode");
    assert.ok(receipt.a.cues > 0 && receipt.b.cues > 0, "both halves must be non-empty");
    assert.equal(receipt.a.cues + receipt.b.cues, 38, "no cue may be dropped or duplicated");
    assert.ok(receipt.cut.timecode, "a time-based split records the cut timecode");

    // The halves must not overlap: A ends before B starts.
    const aTimes = [...readFileSync(join(out, "A.srt"), "utf8").matchAll(/-->\s*(\S+)/g)].map((m) => m[1]);
    const bTimes = [...readFileSync(join(out, "B.srt"), "utf8").matchAll(/-->\s*(\S+)/g)].map((m) => m[1]);
    assert.equal(aTimes.length, receipt.a.cues);
    assert.equal(bTimes.length, receipt.b.cues);
    assert.ok(aTimes.at(-1) <= bTimes[0], `A ends ${aTimes.at(-1)} but B starts ${bTimes[0]}`);
  });

  it("is deterministic: same input, same bytes, same receipt", () => {
    const first = scratch("split-a");
    const second = scratch("split-b");
    const one = split(FIXTURE, first);
    const two = split(FIXTURE, second);
    assert.deepEqual(one, two);
    assert.equal(readFileSync(join(first, "A.srt"), "utf8"), readFileSync(join(second, "A.srt"), "utf8"));
    assert.equal(readFileSync(join(first, "split.json"), "utf8"), readFileSync(join(second, "split.json"), "utf8"));
  });

  it("refuses a corpus that cannot be split instead of emitting an empty half", () => {
    const dir = scratch("split-tiny");
    const tiny = join(dir, "tiny.srt");
    writeFileSync(tiny, "1\n00:00:01,000 --> 00:00:02,000\n只有一句话\n", "utf8");
    const result = run("split-corpus.mjs", ["--in", tiny, "--out", join(dir, "out")]);
    assert.notEqual(result.status, 0, "a single-cue corpus must fail loudly");
    assert.match(result.stderr, /split|切|too (small|short)/i);
  });
});

describe("blind-test score", () => {
  function score(scores) {
    const dir = scratch("score");
    const path = join(dir, "scores.json");
    writeFileSync(path, `${JSON.stringify(scores, null, 2)}\n`, "utf8");
    const report = join(dir, "report.md");
    const result = run("blind-test.mjs", ["score", "--scores", path, "--out", report]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return { text: readFileSync(report, "utf8"), stdout: result.stdout };
  }

  it("computes hit rate, undecidable ratio and fabrication count from the sheet", () => {
    const { text } = score({
      evidence: sheet(["hit", "hit", "hit", "hit", "hit", "hit", "partial", "hit", "undecidable", "hit"]),
      control: sheet(["hit", "miss", "hit", "miss", "undecidable", "hit", "undecidable", "miss", "partial", "fabricated"]),
    });
    // evidence: 8 hits + 0.5 partial = 8.5 over 9 decidable = 0.944, 1/10 undecidable, 0 fabricated
    assert.match(text, /\| 命中率（hit \+ 0\.5×partial） \| 0\.944 \| 0\.438 \|/);
    assert.match(text, /\| 无法判定比例 \| 0\.1 \| 0\.2 \|/);
    assert.match(text, /\| \*\*编造数\*\* \| 0 \| 1 \|/);
    assert.match(text, /evidence → PASS/);
    assert.match(text, /control → FAIL/);
    assert.match(text, /FALSIFIED/, "one fabricated claim must fail the arm outright");
    assert.match(text, /证据层命中率 0\.944 vs 裸 prompt 0\.438（差 \+0\.506）/);
  });

  it("accepts an arm that sits exactly on both thresholds", () => {
    // 7 hits / 3 undecidable = 0.7 hit rate and 0.3 undecidable → fails.
    const { text: failing } = score({
      evidence: sheet(["hit", "hit", "hit", "hit", "hit", "hit", "hit", "undecidable", "undecidable", "undecidable"]),
    });
    assert.match(failing, /evidence → FAIL/);
    assert.match(failing, /undecidable 0\.3 > 0\.2/);

    // 8 hits / 2 undecidable = 0.8 hit rate and exactly 0.2 undecidable → passes.
    const { text: passing } = score({
      evidence: sheet(["hit", "hit", "hit", "hit", "hit", "hit", "hit", "hit", "undecidable", "undecidable"]),
    });
    assert.match(passing, /evidence → PASS/);
    assert.doesNotMatch(passing, /evidence: /);
  });

  it("counts an unfilled sheet as undecidable rather than as a pass", () => {
    const { text } = score({ evidence: sheet(Array.from({ length: 10 }, () => null)) });
    assert.match(text, /\| 可判定 \| 0 \|/);
    assert.match(text, /\| 无法判定比例 \| 1 \|/);
    assert.match(text, /evidence → FAIL/);
  });
});

describe("blind-test prepare", () => {
  it("renders a judge-readable page with anchors and no corpus quotes", () => {
    const dir = scratch("blind");
    const a = join(dir, "A.srt");
    const out = join(dir, "run");
    mkdirSync(out, { recursive: true });
    split(FIXTURE, dir);
    writeFileSync(a, readFileSync(join(dir, "A.srt"), "utf8"), "utf8");

    const result = run("blind-test.mjs", ["prepare", "--a", a, "--person", "synthetic-interview", "--out", out]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const receipt = JSON.parse(readFileSync(join(out, "receipt.json"), "utf8"));
    assert.equal(receipt.external_links, "none", "the judge's page must be self-contained");
    assert.equal(receipt.html.bytes, readFileSync(join(out, "profile.html")).length);
    assert.ok(receipt.anchors > 0, "the page must cite resolvable anchors");

    // Private mode: conclusions and anchor ids only, never the original words.
    const html = readFileSync(join(out, "profile.html"), "utf8");
    const quotes = readFileSync(a, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length >= 12 && !line.includes("-->") && !/^\d+$/.test(line));
    const leaked = quotes.filter((quote) => html.includes(quote));
    assert.deepEqual(leaked, [], `private-mode page leaked ${leaked.length} corpus line(s)`);
    assert.match(html, /ANCHOR|anchor/i, "the page must expose anchor references");

    const prompt = readFileSync(join(out, "judge-prompt.md"), "utf8");
    assert.match(prompt, /10 条/, "the judge is asked for ten checkable traits");
    assert.match(prompt, /无法判断/, "the judge is told to abstain instead of guessing");
    const template = JSON.parse(readFileSync(join(out, "scores.template.json"), "utf8"));
    assert.equal(template.evidence.length, 10);
    assert.equal(template.control.length, 10);
  });

  it("writes a bare-prompt control that withholds the evidence layer", () => {
    const dir = scratch("control");
    const out = join(dir, "run");
    mkdirSync(out, { recursive: true });
    const result = run("blind-test.mjs", ["control", "--a", FIXTURE, "--out", out]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const prompt = readFileSync(join(out, "control-prompt.md"), "utf8");
    assert.match(prompt, /不要.*运行任何命令/, "the control must forbid running the pipeline");
    assert.ok(prompt.includes("先自我介绍一下"), "the control gets the raw corpus");
    const sheet = JSON.parse(readFileSync(join(out, "scores.template.json"), "utf8"));
    assert.equal(sheet.control.length, 10);
    assert.equal(sheet.evidence.length, 10, "both arms share one sheet so they cannot diverge");
  });
});
