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
    assert.deepEqual(ok.anchors, { total: 2, cited: 1 }, "cited comes from evidence/derived, not a constant");
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
