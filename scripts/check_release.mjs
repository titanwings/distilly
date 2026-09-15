#!/usr/bin/env node
/**
 * Release readiness for this package: the things a version bump must not forget.
 *
 * `acceptance.mjs` proves the pipeline works and `audit-objective.mjs` proves the
 * scope is closed; neither notices that the version printed by `--version` drifted
 * from `package.json`, that a migrated ledger lost its schema marker, or that a
 * `.py` file came back. Those are release-time questions, so they live here.
 *
 *   node scripts/check_release.mjs [--json] [--tag vX.Y.Z]
 *
 * Exit code 1 when any check fails. `--tag` additionally asserts that the release
 * tag names the same version the package declares.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { SCHEMA_VERSION } from "../src/skill/schema.mjs";
import { LEDGER_SCHEMA_VERSION } from "../src/knowledge/ledger.mjs";

const root = resolve(import.meta.dirname, "..");
const json = process.argv.includes("--json");
const tagIndex = process.argv.indexOf("--tag");
const tag = tagIndex === -1 ? null : process.argv[tagIndex + 1];

const rows = [];
const record = (name, ok, evidence) => rows.push({ name, ok: Boolean(ok), evidence });

const read = (relative) => readFileSync(join(root, relative), "utf8");
const pkg = JSON.parse(read("package.json"));

/* 1 — one version, everywhere it is printed ---------------------------------- */
{
  const binVersion = execFileSync(process.execPath, [join(root, "bin", "distilly.mjs"), "--version"], { encoding: "utf8" }).trim();
  const skill = existsSync(join(root, "SKILL.md")) ? read("SKILL.md") : "";
  const skillVersion = /^version:\s*"?([^"\n]+)"?/m.exec(skill)?.[1]?.trim() ?? null;
  const consistent = binVersion === pkg.version && (skillVersion === null || skillVersion === pkg.version);
  record(
    "版本一致（package.json / --version / SKILL.md）",
    consistent,
    `package.json ${pkg.version}, --version ${binVersion}, SKILL.md ${skillVersion ?? "(未声明)"}`,
  );
  if (tag !== null) {
    record("发布 tag 指向同一版本", tag === `v${pkg.version}` || tag === pkg.version, `--tag ${tag} vs ${pkg.version}`);
  }
}

/* 2 — schemas are the frozen ones, and a migration exists -------------------- */
{
  const migrate = existsSync(join(root, "src", "skill", "migrate.mjs"));
  const migrationTest = read(join("tests", "schema-migration.test.mjs"));
  record(
    `schema v${SCHEMA_VERSION} 与账本 v${LEDGER_SCHEMA_VERSION}，迁移脚本在`,
    SCHEMA_VERSION === "4" && migrate && /idempot/i.test(migrationTest),
    `SCHEMA_VERSION=${SCHEMA_VERSION}, LEDGER_SCHEMA_VERSION=${LEDGER_SCHEMA_VERSION}, src/skill/migrate.mjs=${migrate}, 幂等断言=${/idempot/i.test(migrationTest)}`,
  );
}

/* 3 — the installers still carry the evidence spine -------------------------- */
{
  const hosts = read(join("src", "install", "hosts.mjs"));
  const carried = ["knowledge/raw", "knowledge/text", "evidence", "views"].every((name) => hosts.includes(name));
  record(
    "安装器携带 evidence spine（knowledge/raw、knowledge/text、evidence、views）",
    carried,
    carried ? "CARRIED_DIRECTORIES 覆盖四项" : "CARRIED_DIRECTORIES 缺项",
  );
}

/* 4 — the package is zero-dependency and Python-free ------------------------- */
{
  const dependencies = Object.keys(pkg.dependencies ?? {});
  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n");
  const python = tracked.filter((path) => /\.py$/.test(path) || /(^|\/)requirements\.txt$/.test(path));
  record(
    "零运行时依赖且没有 Python 残留",
    dependencies.length === 0 && python.length === 0,
    `dependencies: ${dependencies.length === 0 ? "none" : dependencies.join(", ")}; tracked .py / requirements.txt: ${python.length}`,
  );
}

/* 5 — generated artefacts are in sync with their sources -------------------- */
{
  const template = execFileSync(process.execPath, [join(root, "scripts", "generate-template.mjs"), "--check"], { encoding: "utf8" }).trim();
  const pinyin = existsSync(join(root, "assets", "pinyin.json"));
  record(
    "生成物与源同步（模板 / 拼音表）",
    /up to date/.test(template) && pinyin,
    `${template.split("\n").pop()}; assets/pinyin.json: ${pinyin}`,
  );
}

/* 6 — the gates a release claims are runnable -------------------------------- */
{
  const gates = ["scripts/acceptance.mjs", "scripts/audit-objective.mjs", "scripts/prompt-lint.mjs", "scripts/visual-check.mjs", "scripts/split-corpus.mjs", "scripts/blind-test.mjs"];
  const missing = gates.filter((path) => !existsSync(join(root, path)));
  const ci = read(join(".github", "workflows", "ci.yml"));
  const wired = ["node --test", "acceptance.mjs", "prompt-lint.mjs", "audit-objective.mjs"].every((needle) => ci.includes(needle));
  record(
    "发布所依赖的门禁都在，且 CI 会跑",
    missing.length === 0 && wired,
    `missing: ${missing.length === 0 ? "none" : missing.join(", ")}; CI 覆盖 node --test / acceptance / prompt-lint / audit: ${wired}`,
  );
}

/* 7 — documentation a release points at ------------------------------------- */
{
  const docs = ["docs/v2/CONTRACT.md", "docs/v2/ACCEPTANCE.md", "docs/v2/STATUS.md", "docs/v2/MIGRATION.md", "docs/v2/IDENTITY.md", "README.md"];
  const missing = docs.filter((path) => !existsSync(join(root, path)));
  record("发布指向的文档都在", missing.length === 0, missing.length === 0 ? `${docs.length} 份文档就位` : `缺: ${missing.join(", ")}`);
}

const failed = rows.filter((row) => !row.ok);
if (json) {
  console.log(JSON.stringify({ ok: failed.length === 0, version: pkg.version, schema: SCHEMA_VERSION, rows }, null, 2));
} else {
  console.log("发布检查 / release check\n");
  for (const row of rows) console.log(`${row.ok ? "✅" : "❌"} ${row.name}\n     ${row.evidence}`);
  console.log(`\n${rows.length - failed.length}/${rows.length} 项通过${failed.length === 0 ? "" : `；未通过：${failed.map((row) => row.name).join("；")}`}`);
}
process.exit(failed.length === 0 ? 0 : 1);

