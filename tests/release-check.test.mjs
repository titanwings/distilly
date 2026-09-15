/**
 * The release check must pass, and must be able to fail.
 *
 * `scripts/check_release.mjs` covers what the other gates do not: the version every
 * surface prints, the schema marker, the installer's carried directories, generated
 * artefacts, and the gates/CI/docs a release claims.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(HERE, "scripts", "check_release.mjs");

function run(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, "--json", ...args], { cwd: HERE, encoding: "utf8" });
  return { status: result.status, report: JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) };
}

test("every release-time check passes", () => {
  const { status, report } = run();
  assert.equal(status, 0, JSON.stringify(report.rows.filter((row) => !row.ok), null, 2));
  assert.equal(report.ok, true);
  assert.ok(report.rows.length >= 7);
  for (const row of report.rows) assert.ok(row.evidence.length > 0, `${row.name} must say what it read`);
});

test("a mismatched release tag fails the run", () => {
  const { status, report } = run("--tag", "v9.9.9");
  assert.equal(status, 1, "a tag that disagrees with package.json must fail");
  const tagRow = report.rows.find((row) => row.name.includes("tag"));
  assert.equal(tagRow.ok, false);
  assert.match(tagRow.evidence, /v9\.9\.9/);
});
