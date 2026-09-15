/**
 * The objective audit must pass, and must keep being able to fail.
 *
 * `scripts/audit-objective.mjs` maps each demand of the v2 objective to a
 * mechanical check. Running it here means a regression in scope (a contract
 * command that stops resolving, a screenshot that gets committed, a PR document
 * that goes missing) breaks `node --test`, not just a manual review.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(HERE, "scripts", "audit-objective.mjs");

function audit(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, "--skip-acceptance", "--json", ...args], {
    cwd: HERE,
    encoding: "utf8",
  });
  return { status: result.status, report: JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) };
}

test("every demand of the objective is satisfied by an artefact", () => {
  const { status, report } = audit();
  assert.equal(status, 0, JSON.stringify(report.failed, null, 2));
  assert.equal(report.failed.length, 0);
  assert.ok(report.rows.length >= 14, `audit rows: ${report.rows.length}`);
  for (const row of report.rows) {
    assert.equal(typeof row.demand, "string");
    assert.ok(row.evidence.length > 0, `${row.demand} must say what it read`);
  }
});

test("documented gaps are reported as gaps, not silently dropped", () => {
  const { report } = audit();
  const gaps = report.gaps.join("\n");
  // `discord`/`reddit`/`notion`/`gmail` used to be a gap here; they ship in this
  // build now, and the audit asserts that positively instead. What must stay
  // visible is whatever is still outstanding, and that set is exactly the rows
  // marked `gap: true`.
  // The push row is satisfied now (the branch is pushed and the per-feature PRs
  // exist), so it is no longer a gap. In `--skip-acceptance` mode the gap that
  // must stay visible is the skipped end-to-end run itself: an audit that hides
  // what it did not check is the failure mode this row exists for.
  assert.match(gaps, /端到端验收/, "a skipped acceptance run must stay visible in the audit");
  assert.deepEqual(
    report.gaps,
    report.rows.filter((row) => row.gap).map((row) => row.demand),
    "every gap row must appear in `gaps`",
  );
  // A gap row never counts as a failure: the audit's job is to be explicit.
  assert.equal(report.ok, true);
});
