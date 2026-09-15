/**
 * The repository's ignore rules are a privacy boundary, not a convenience.
 *
 * `skills/<family>/<slug>/` holds a real person's distilled profile and
 * `.distilly/` holds API keys. Both are produced in the working tree, so the only
 * thing keeping them out of a commit is `.gitignore`. A merge once replaced that
 * file with a ten-line version that kept only the `knowledge/` rules, and the loss
 * was invisible: nothing was tracked that should not be, `git status` stayed clean,
 * and the objective audit only looked at what was *already* tracked.
 *
 * These assertions pin the boundary from both sides — what must be ignored, and
 * what must stay visible — so a future merge cannot quietly drop a rule again.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** `git check-ignore` answers by pattern alone, so the paths need not exist. */
const ignored = (candidate) =>
  spawnSync("git", ["check-ignore", "-q", "--", candidate], { cwd: root }).status === 0;

const inGitWorkTree = () =>
  spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf8" }).stdout?.trim() ===
  "true";

const skip = inGitWorkTree() ? false : "not a git work tree";

/**
 * Paths a person's data, a key, or a local artefact would land on. Every one of
 * these must be ignored, because every one of them is created by ordinary use.
 */
const MUST_BE_IGNORED = [
  // A real person's directory — the profile, the spine, the rendered pages.
  "skills/colleague/some_real_person/meta.json",
  "skills/colleague/some_real_person/persona.md",
  "skills/colleague/some_real_person/knowledge/raw/export.json",
  "skills/colleague/some_real_person/knowledge/text/export.md",
  "skills/colleague/some_real_person/evidence/derived/stats.json",
  "skills/colleague/some_real_person/evidence/renders/view-print.png",
  "skills/colleague/some_real_person/views/some_real_person.html",
  // A root-level export, for the same reason.
  "knowledge/raw/export.json",
  // Credentials: current path and the legacy one.
  ".distilly/config.json",
  ".distilly/consent.json",
  ".colleague-skill/config.json",
  // Local browser profile written by visual-check.
  "playwright-data/state.json",
  // Evidence stays out of the repository (CONTRACT §4).
  "dst-evidence/SCREENSHOTS.md",
  "dst-evidence/screenshots/pr-20/view-print.png",
  // OS noise.
  ".DS_Store",
  "Thumbs.db",
];

/**
 * Paths that must stay visible. These are the re-includes: get the ordering wrong
 * and a newly added module or fixture is silently dropped from `git add`.
 */
const MUST_STAY_VISIBLE = [
  "src/knowledge/store.mjs",
  "src/knowledge/anchors.mjs",
  "src/knowledge/ledger.mjs",
  "src/knowledge/identity.mjs",
  "src/knowledge/a_module_added_later.mjs",
  "src/derive/fixtures/synthetic-group/knowledge/index.json",
  "src/derive/fixtures/synthetic-group/knowledge/text/group-chat.md",
  // The bundled examples must remain tracked; the ignore rule only covers the rest.
  "skills/colleague/example_zhangsan/meta.json",
  "skills/colleague/example_zhangsan/persona.md",
  "skills/colleague/example_tianyi/meta.json",
  "skills/colleague/example_jiaxiu/meta.json",
];

test("user data, credentials and local evidence are all ignored", { skip }, () => {
  const leaked = MUST_BE_IGNORED.filter((candidate) => !ignored(candidate));
  assert.deepEqual(leaked, [], `these paths are not ignored and would be committed by \`git add -A\`: ${leaked.join(", ")}`);
});

test("source modules and bundled examples stay visible", { skip }, () => {
  const hidden = MUST_STAY_VISIBLE.filter(ignored);
  assert.deepEqual(
    hidden,
    [],
    `these paths are ignored, so a newly added file would be lost from \`git add\` without a word: ${hidden.join(", ")}`,
  );
});

test("the re-includes come after the rule they override", { skip }, () => {
  // Git applies `.gitignore` top to bottom and the last match wins, so an
  // unanchored `knowledge/` placed after a `!src/knowledge/**` re-excludes it.
  const { readFileSync } = require("node:fs");
  const lines = readFileSync(path.join(root, ".gitignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const lastKnowledge = lines.lastIndexOf("knowledge/");
  assert.notEqual(lastKnowledge, -1, "the `knowledge/` rule itself must exist");
  for (const reinclusion of ["!src/knowledge/", "!src/derive/fixtures/**/knowledge/"]) {
    assert.ok(
      lines.indexOf(reinclusion) > lastKnowledge,
      `${reinclusion} appears before the last \`knowledge/\` rule, so the later rule re-excludes it`,
    );
  }
});
