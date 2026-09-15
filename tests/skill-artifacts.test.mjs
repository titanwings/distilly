/**
 * The deliverable gate must be able to fail.
 *
 * `scripts/skill-artifacts.mjs` is what the acceptance run uses to judge a generated
 * Skill. A checker that only ever passes is decoration, so every failure mode it
 * exists for is exercised here against a deliberately broken artifact set — the same
 * three shapes that shipped green before this gate existed:
 *
 *  - a `SKILL.md` whose PART B has no Layer 0, while the operating rules promise
 *    "Layer 0 rules always take priority";
 *  - a citation the ledger does not declare;
 *  - a missing artifact.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { REQUIRED_ARTIFACTS, citedAnchors, inspectSkillArtifacts } from "../scripts/skill-artifacts.mjs";

const LAYERS = [
  "## Layer 0：核心性格（最高优先级，任何情况下不得违背）",
  "- 当被追问数字时 → 先给结论再给依据 [k0002]",
  "## Layer 1：身份",
  "- 后端工程师 [k0001]",
  "## Layer 2：表达风格",
  "- 结论先行 [k0002]",
  "## Layer 3：决策与判断",
  "- 用代价排序 [k0003]",
  "## Layer 4：人际行为",
  "- 对平级给替代方案 [k0003]",
  "## Layer 5：边界与雷区",
  "- （原材料不足，不推断）",
];

function goodFiles(overrides = {}) {
  const files = Object.fromEntries(REQUIRED_ARTIFACTS.map((name) => [name, "{}"]));
  files["SKILL.md"] = [
    "---",
    "name: colleague-demo",
    "description: demo",
    "---",
    "",
    "# demo",
    "",
    "## PART A: Work",
    "- 负责缓存层 [k0001]",
    "",
    "## PART B: Persona",
    ...LAYERS,
    "",
    "## Operating Rules",
    "**Layer 0 rules in PART B always take priority and must never be violated.**",
  ].join("\n");
  files["work.md"] = "- 负责缓存层 [k0001]";
  files["persona.md"] = LAYERS.join("\n");
  return { ...files, ...overrides };
}

const LEDGER = new Set(["k0001", "k0002", "k0003"]);

test("a compliant artifact set passes every check", () => {
  const report = inspectSkillArtifacts(goodFiles(), LEDGER);
  assert.deepEqual(report.missingArtifacts, []);
  assert.deepEqual(report.missingSections, []);
  assert.deepEqual(report.missingLayers, []);
  assert.equal(report.layer0Rules, 1);
  assert.deepEqual(report.dangling, []);
  assert.deepEqual(report.cited.sort(), ["k0001", "k0002", "k0003"]);
});

test("a persona without Layer 0 is rejected", () => {
  // The shipped failure: operating rules promise Layer 0 priority, PART B has none.
  const body = goodFiles()["SKILL.md"].replace(/## Layer 0[\s\S]*?## Layer 1/, "## Layer 1");
  const report = inspectSkillArtifacts(goodFiles({ "SKILL.md": body }), LEDGER);
  assert.deepEqual(report.missingLayers, ["Layer 0"]);
  assert.equal(report.layer0Rules, 0);
});

test("a Layer 0 heading with no rules is rejected", () => {
  // A heading is not a rule: without the "in situation X → do Y" lines the layer is
  // empty, and an empty Layer 0 is what skipping the builder prompt produces.
  const body = goodFiles()["SKILL.md"].replace(
    "- 当被追问数字时 → 先给结论再给依据 [k0002]",
    "",
  );
  const report = inspectSkillArtifacts(goodFiles({ "SKILL.md": body }), LEDGER);
  assert.deepEqual(report.missingLayers, []);
  assert.equal(report.layer0Rules, 0);
});

test("an anchor the ledger does not declare is reported as dangling", () => {
  const body = `${goodFiles()["SKILL.md"]}\n- 引用不存在的锚点 [k0099]`;
  const report = inspectSkillArtifacts(goodFiles({ "SKILL.md": body }), LEDGER);
  assert.deepEqual(report.dangling, ["k0099"]);
  const inWork = inspectSkillArtifacts(goodFiles({ "work.md": "- 悬空 [k0404]" }), LEDGER);
  assert.deepEqual(inWork.dangling, ["k0404"]);
});

test("a missing artifact is named", () => {
  const files = goodFiles();
  delete files["manifest.json"];
  const report = inspectSkillArtifacts(files, LEDGER);
  assert.deepEqual(report.missingArtifacts, ["manifest.json"]);
});

test("citedAnchors reads both anchor forms and deduplicates", () => {
  const found = [...citedAnchors("a [k0001] b [k0002:t3] c [k0001] d")].sort();
  assert.deepEqual(found, ["k0001", "k0002:t3"]);
});
