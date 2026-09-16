/**
 * Port of the code-surface checks in `tests/test_skill_entrypoint_docs.py`
 * (`test_code_uses_new_names_with_explicit_legacy_fallbacks`) plus the registry
 * consistency rule from `docs/v2/ACCEPTANCE.md` phase 0.
 *
 * The Python original read `tools/skill_writer.py`, `tools/skill_schema.py`,
 * `tools/install_codex_skill.py` and `tools/install_generated_skill_common.py`;
 * those modules now live in `src/`. The documentation assertions of that suite
 * (README / INSTALL / SKILL.md copy) stay in Python for ds/04-prompts and
 * ds/05-agents, which own those files.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PLANNED, listCommands } from "../src/commands/index.mjs";
import { getAgent } from "../src/hosts/agents.mjs";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(projectRoot, relative), "utf8");

test("the writer keeps both the new and the legacy auto-install switch", () => {
  const commands = read("src/commands/skill.mjs");
  assert.match(commands, /DISTILLY_AUTO_INSTALL_CLAUDE/);
  assert.match(commands, /DOT_SKILL_AUTO_INSTALL_CLAUDE/);
});

test("the schema still names the engine distilly in both places", () => {
  const schema = read("src/skill/schema.mjs");
  assert.match(schema, /pySetDefault\(engine, "name", "distilly"\)/);
  assert.match(schema, /pySetDefault\(generation, "engine", "distilly"\)/);
});

test("Codex keeps its documented discovery directory", () => {
  assert.equal(getAgent("codex").globalPath, "~/.agents/skills/distilly");
  assert.match(read("src/install/hosts.mjs"), /\.distilly-install\.json/);
});

test("the collectors keep reading the private config paths, not the repo", () => {
  // v2 retired `tools/*.py`, so the pre-port version of this test read files that
  // no longer exist. The discipline it protected is unchanged and now lives in
  // `src/collect/kit.mjs`, so it is asserted there instead of being dropped.
  const kit = read(join("src", "collect", "kit.mjs"));
  assert.match(kit, /join\(homedir\(\), "\.distilly"\)/, "primary credentials live under ~/.distilly");
  assert.match(kit, /"\.colleague-skill"/, "the pre-rename location stays readable");

  // Every credentialed channel names its config file; none may read a key from
  // the working tree.
  for (const name of ["feishu", "dingtalk", "slack", "x", "discord", "gmail", "notion", "reddit"]) {
    const source = read(join("src", "collect", `${name}.mjs`));
    assert.match(source, /export const CONFIG_FILE = "[a-z]+_config\.json";/, name);
  }

  // The consent token file is a credential: it is written 0600.
  assert.match(read(join("src", "consent.mjs")), /chmodSync\(staging, 0o600\)/);
});

test("every command the prompts may reference is registered or explicitly planned", () => {
  const known = new Set([...listCommands(), ...Object.keys(PLANNED)]);
  const sources = ["SKILL.md"];
  const { readdirSync, statSync } = require_fs();
  const walk = (dir) => {
    for (const entry of readdirSync(join(projectRoot, dir))) {
      const relative = join(dir, entry);
      if (statSync(join(projectRoot, relative)).isDirectory()) walk(relative);
      else if (entry.endsWith(".md")) sources.push(relative);
    }
  };
  walk("prompts");

  const referenced = new Set();
  for (const source of sources) {
    for (const match of read(join(source)).matchAll(/`?distilly ([a-z][a-z-]*)/g)) {
      referenced.add(match[1]);
    }
  }
  const missing = [...referenced].filter((command) => !known.has(command)).sort();
  assert.deepEqual(missing, [], `unregistered commands referenced by prompts: ${missing.join(", ")}`);
});

function require_fs() {
  return { readdirSync: fsReaddirSync, statSync: fsStatSync };
}

import { readdirSync as fsReaddirSync, statSync as fsStatSync } from "node:fs";
