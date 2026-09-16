/**
 * `doctor`'s evidence coverage and the two spellings of `--base-dir`.
 *
 * Doctor used to print a hardcoded `0 cited`, and to resolve `--base-dir` as
 * `<base>/<family>` — one level short of the layout every other command writes,
 * so it reported "no generated skills found" for any base directory. Both are
 * pinned here: the count comes from `evidence/derived/*.json`, a dangling
 * citation is named, and all three spellings of `--base-dir` land on the same
 * skill without counting it three times.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseReceipt, runCli } from "./helpers/cli.mjs";
import { resolveSkillsRoot } from "../src/cli/paths.mjs";

/** base/skills/colleague/<slug> with a ledger and a derived claim. */
function fixture({ dangling = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), "dst-doctor-"));
  const skillDir = join(base, "skills", "colleague", "demo");
  mkdirSync(join(skillDir, "knowledge", "text"), { recursive: true });
  mkdirSync(join(skillDir, "evidence", "derived"), { recursive: true });
  writeFileSync(
    join(skillDir, "meta.json"),
    `${JSON.stringify({ slug: "demo", character: "colleague", display_name: "Demo", version: "v1" }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(skillDir, "knowledge", "index.json"),
    `${JSON.stringify([{ id: "k0001", kind: "subtitle", bytes: 10, sha256: "a".repeat(64), anchors: ["k0001", "k0002"] }], null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(skillDir, "evidence", "derived", "voice.json"),
    `${JSON.stringify({ kind: "voice", claims: [{ id: "voice.x", confidence: "high", evidence: dangling ? ["k0001", "k9999"] : ["k0001"], label: { zh: "x" }, value: 1 }] }, null, 2)}\n`,
    "utf8",
  );
  return { base, skillDir };
}

test("doctor counts the anchors the derivation cites, and names dangling ones", () => {
  const clean = fixture();
  const dangling = fixture({ dangling: true });
  try {
    const ok = parseReceipt(runCli(["doctor", "--base-dir", clean.base, "--json"]).stdout);
    assert.equal(ok.skills, 1, "the skill must be found through --base-dir");
    assert.deepEqual(
      ok.anchors,
      { total: 2, cited: 1, dangling: 0 },
      "cited comes from the citations on disk, not a constant; dangling is the verdict input",
    );
    assert.deepEqual(ok.warnings, []);

    const bad = parseReceipt(runCli(["doctor", "--base-dir", dangling.base, "--json"]).stdout);
    assert.equal(bad.anchors.cited, 1);
    assert.match(bad.warnings.join("\n"), /1 anchor\(s\) cited by evidence\/derived.*cannot be resolved/);
  } finally {
    rmSync(clean.base, { recursive: true, force: true });
    rmSync(dangling.base, { recursive: true, force: true });
  }
});

test("all three --base-dir spellings reach the same skill exactly once", () => {
  const { base } = fixture();
  try {
    const canonical = parseReceipt(runCli(["doctor", "--base-dir", base, "--json"]).stdout);
    assert.equal(canonical.skills, 1);

    // The storage root itself (what `skill create --base-dir` writes).
    const storage = parseReceipt(runCli(["doctor", "--base-dir", join(base, "skills", "colleague"), "--json"]).stdout);
    assert.equal(storage.skills, 1, "a storage root must be inspected once, not once per family");
    assert.deepEqual(storage.anchors, canonical.anchors);

    // A bare directory: legacy reading, with a warning that says how to be explicit.
    const bare = parseReceipt(runCli(["doctor", "--base-dir", join(base, "skills"), "--json"]).stdout);
    assert.equal(bare.skills, 0);
    assert.match(bare.warnings.join("\n"), /contains no skills\/ directory/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("resolveSkillsRoot is deterministic about which spelling it took", () => {
  const { base } = fixture();
  try {
    const canonical = resolveSkillsRoot({ baseDir: base, family: "colleague" });
    assert.equal(canonical.mode, "skills-root");
    assert.equal(canonical.root, join(base, "skills", "colleague"));

    const storage = resolveSkillsRoot({ baseDir: join(base, "skills", "colleague"), family: "colleague" });
    assert.equal(storage.mode, "storage-root");
    assert.equal(storage.bare, false);

    const bare = resolveSkillsRoot({ baseDir: join(base, "skills"), family: "colleague" });
    assert.equal(bare.bare, true);
    assert.match(bare.warning, /canonical spelling/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("doctor fails — non-zero exit — when a citation cannot be followed back", () => {
  // A dangling citation is the product's core promise broken ("every conclusion can
  // be traced back"), yet doctor reported it as a warning beside `ok: true`, so the
  // exit code was 0 and nothing downstream could act on it. The gate is dangling = 0;
  // coverage stays a number because a Skill need not cite every cue in the corpus.
  const clean = fixture();
  const dangling = fixture({ dangling: true });
  try {
    const okRun = runCli(["doctor", "--base-dir", clean.base, "--json"]);
    assert.equal(okRun.status, 0);
    const okReceipt = parseReceipt(okRun.stdout);
    assert.equal(okReceipt.ok, true);
    assert.equal(okReceipt.verdict, "PASS");
    assert.equal(okReceipt.anchors.dangling, 0);

    const badRun = runCli(["doctor", "--base-dir", dangling.base, "--json"]);
    assert.equal(badRun.status, 1, "a dangling citation must fail the command");
    const badReceipt = parseReceipt(badRun.stdout);
    assert.equal(badReceipt.ok, false);
    assert.equal(badReceipt.verdict, "FAIL");
    assert.equal(badReceipt.anchors.dangling, 1);
  } finally {
    rmSync(clean.base, { recursive: true, force: true });
    rmSync(dangling.base, { recursive: true, force: true });
  }
});

test("doctor counts what the generated Skill cites, not only the derived layer", () => {
  // The deliverable is SKILL.md/work.md/persona.md; the derived JSON is intermediate.
  // Counting only `evidence/derived/` described the middle of the pipeline while the
  // artifact at the end of it went unexamined.
  const { base, skillDir } = fixture();
  try {
    writeFileSync(join(skillDir, "SKILL.md"), "# demo\n\n## PART A: Work\n- 负责缓存 [k0002]\n", "utf8");
    const receipt = parseReceipt(runCli(["doctor", "--base-dir", base, "--json"]).stdout);
    assert.equal(receipt.anchors.cited, 2, "k0001 from the derived claim, k0002 from SKILL.md");
    assert.equal(receipt.anchors.dangling, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

/** base/skills/colleague/demo with a ledger of N anchors and a per-speaker voice claim. */
function shapeFixture({ anchors, speakers }) {
  const base = mkdtempSync(join(tmpdir(), "dst-shape-"));
  const skillDir = join(base, "skills", "colleague", "demo");
  mkdirSync(join(skillDir, "knowledge"), { recursive: true });
  mkdirSync(join(skillDir, "evidence", "derived"), { recursive: true });
  const ids = Array.from({ length: anchors }, (_, index) => `k${String(index + 1).padStart(4, "0")}`);
  writeFileSync(
    join(skillDir, "knowledge", "index.json"),
    `${JSON.stringify([{ id: "k0001", kind: "subtitle", bytes: 1, sha256: "a".repeat(64), anchors: ids }], null, 2)}\n`,
    "utf8",
  );
  const by_speaker = {};
  for (const [name, samples] of Object.entries(speakers)) by_speaker[name] = { samples };
  writeFileSync(
    join(skillDir, "evidence", "derived", "voice.json"),
    `${JSON.stringify({ kind: "voice", claims: [{ id: "voice.sentence_length", value: { by_speaker } }] }, null, 2)}\n`,
    "utf8",
  );
  return base;
}

test("the corpus shape check passes on a corpus that can carry a person", () => {
  // 40 citable units, three speakers, three quarters of the units attributable and a
  // clear lead — a meeting in which one person is actually the subject.
  const base = shapeFixture({ anchors: 40, speakers: { 张三: 15, 李四: 10, 主持人: 5 } });
  try {
    const run = runCli(["doctor", "--base-dir", base, "--require-shape", "--json"]);
    assert.equal(run.status, 0, run.stderr);
    const receipt = parseReceipt(run.stdout);
    assert.equal(receipt.shape.length, 1);
    assert.equal(receipt.shape[0].verdict, "PASS");
    assert.equal(receipt.shape[0].units, 40);
    assert.equal(receipt.shape[0].attributed_units, 30);
    assert.deepEqual(receipt.shape[0].reasons, []);
    assert.equal(receipt.verdict, "PASS");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the corpus shape check catches a multi-speaker corpus nobody can be cut out of", () => {
  // The real failure this exists for: a 47-minute floor proceeding, 2744 anchors, 18
  // speakers, 3% of units attributable. It ran the whole five-step mainline and
  // produced a portrait of a room, because nothing asked "is this the right material"
  // before Distill. Without `--require-shape` the verdict is reported only; with it,
  // the command fails.
  const base = shapeFixture({ anchors: 100, speakers: { A: 2, B: 1, C: 1 } });
  try {
    const reported = runCli(["doctor", "--base-dir", base, "--json"]);
    assert.equal(reported.status, 0, "reporting a bad shape is not itself a failure");
    const soft = parseReceipt(reported.stdout);
    assert.equal(soft.shape[0].verdict, "FAIL");
    assert.equal(soft.ok, true);
    assert.match(soft.shape[0].reasons.join("\n"), /只有 4% 的单元能归到某个说话人/);
    assert.match(soft.shape[0].reasons.join("\n"), /不要从会议流水里切人/);

    const gated = runCli(["doctor", "--base-dir", base, "--require-shape", "--json"]);
    assert.equal(gated.status, 1, "--require-shape turns the verdict into a gate");
    const hard = parseReceipt(gated.stdout);
    assert.equal(hard.ok, false);
    assert.equal(hard.verdict, "FAIL");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("too little material fails the shape check before quality is even discussed", () => {
  const base = shapeFixture({ anchors: 5, speakers: {} });
  try {
    const receipt = parseReceipt(runCli(["doctor", "--base-dir", base, "--json"]).stdout);
    assert.equal(receipt.shape[0].verdict, "FAIL");
    assert.match(receipt.shape[0].reasons.join("\n"), /可引用单元只有 5 个，低于 20/);
    assert.match(receipt.shape[0].notes.join("\n"), /没有说话人标注/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
