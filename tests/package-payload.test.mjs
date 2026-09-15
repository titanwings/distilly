/**
 * The published package has to be runnable, and the manifest is what decides that.
 *
 * `npm publish` ships exactly `package.json`'s `files` (plus a few npm always
 * includes), so a manifest that drifts from the tree produces a tarball that
 * installs and then dies on `import "../src/cli/args.mjs"`. That is not
 * hypothetical: the v2 port removed `tools/` and `requirements.txt` and added
 * `src/` and `assets/`, but `files` kept listing the first two and never gained
 * the second two. Every gate stayed green — `--check-package` validated the
 * *working tree*, which had everything — while the extracted tarball could not
 * even print `--version`.
 *
 * These tests drive `validatePayload` against throwaway roots, so each failure
 * mode is named precisely and costs no `npm pack`. `scripts/check_release.mjs`
 * runs the real pack-and-run.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { payloadEntries, validatePayload } from "../bin/distilly.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/**
 * A root that really has every `payloadEntries` path (symlinked, so the check
 * sees them) but the candidate `files` list under test.
 *
 * `package.json` itself is written as a real file and never symlinked: writing
 * through a symlink to the repository's manifest would edit the repository — the
 * first version of this helper did exactly that and blanked the real `files`.
 */
function rootWith(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "payload-"));
  for (const entry of payloadEntries) {
    if (entry === "package.json") continue;
    symlinkSync(path.join(root, entry), path.join(dir, entry));
  }
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ ...manifest, files }, null, 2));
  return dir;
}

const withManifest = (files, body) => {
  const dir = rootWith(files);
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test("the manifest ships every path the runtime imports", () => {
  for (const required of ["bin/", "src/", "assets/", "scripts/", "SKILL.md", "prompts/"]) {
    assert.ok(manifest.files.includes(required), `package.json \`files\` must list ${required}`);
  }
});

test("the shipped manifest passes its own gate", () => {
  withManifest(manifest.files, (dir) => assert.doesNotThrow(() => validatePayload(dir)));
});

test("a manifest that drops src/ is rejected, not packed", () => {
  const files = manifest.files.filter((entry) => entry !== "src/");
  withManifest(files, (dir) => {
    assert.throws(
      () => validatePayload(dir),
      (error) => /would omit required paths: src/.test(error.message) && /add "src\/"/.test(error.remedy),
      "omitting src/ must fail the prepack gate with the fix in the remedy",
    );
  });
});

test("a manifest that drops assets/ is rejected, not packed", () => {
  const files = manifest.files.filter((entry) => entry !== "assets/");
  withManifest(files, (dir) => {
    assert.throws(() => validatePayload(dir), /would omit required paths: assets/);
  });
});

test("a directory pattern covers everything below it", () => {
  // `src/` must be understood as "all of src", not as the literal name `src`.
  assert.ok(manifest.files.includes("src/"));
  withManifest(["src/"], (dir) => {
    assert.throws(() => validatePayload(dir), /would omit required paths: (?!src)/, "src/ alone must satisfy the src entry");
  });
});

test("stale Python-era manifest entries are rejected", () => {
  // `tools/` no longer exists, so listing it makes the manifest a lie about what
  // the package contains — this is the other half of the shipped bug.
  withManifest([...manifest.files, "tools/"], (dir) => {
    assert.throws(() => validatePayload(dir), /names paths that do not exist: tools/);
  });
});

test("a manifest with no `files` at all is rejected", () => {
  withManifest([], (dir) => {
    assert.throws(() => validatePayload(dir), /declares no `files`/);
  });
});

test("these fixtures never write through to the repository manifest", () => {
  // Regression guard for the helper itself: symlinking package.json and then
  // writing the candidate manifest overwrote the real one (files became []).
  const manifestPath = path.join(root, "package.json");
  const before = readFileSync(manifestPath, "utf8");
  withManifest([], (dir) => assert.throws(() => validatePayload(dir)));
  withManifest(manifest.files.filter((entry) => entry !== "src/"), (dir) => assert.throws(() => validatePayload(dir)));
  assert.equal(readFileSync(manifestPath, "utf8"), before, "the repository manifest must be untouched");
});

test("`npm test` and CI run the same command, and it names the tests directory", () => {
  // A bare `node --test` also collects `scripts/blind-test.mjs` (`**/*-test.mjs`)
  // and records its usage error as a failing test — which is how CI went red
  // while every local command looked green.
  const ci = readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /^\s*run: npm test\s*$/m, "CI must invoke `npm test`");
  assert.equal(manifest.scripts.test, 'node --test "tests/*.test.mjs"');
  assert.equal(
    /\bnode --test\s*$/.test(manifest.scripts.test),
    false,
    "`npm test` must not be a bare `node --test`: it would collect scripts/ as tests",
  );
});

test("`engines` matches what CI actually tests", () => {
  const ci = readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  const matrix = /node-version:\s*\[([^\]]+)\]/.exec(ci)?.[1] ?? "";
  const versions = matrix.split(",").map((entry) => entry.trim().replace(/"/g, ""));
  const minimum = Number(manifest.engines.node.replace(/[^\d]/g, ""));
  assert.ok(versions.length > 0, "CI must declare a node-version matrix");
  for (const version of versions) {
    assert.ok(
      Number(version) >= minimum,
      `CI tests Node ${version} but the package claims to need >= ${minimum}`,
    );
  }
  assert.ok(
    versions.includes(String(minimum)),
    `the oldest supported Node (${minimum}) is not in the CI matrix, so the floor is untested`,
  );
});
