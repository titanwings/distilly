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
  // Check the commands CI actually runs, not whether a comment mentions a tool:
  // the unit-test step must be `npm test` (a bare `node --test` also collects
  // `scripts/blind-test.mjs` and fails), and the other gates must be invoked.
  const steps = [...ci.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1].trim());
  const runsTest = steps.includes("npm test");
  const wired = ["acceptance.mjs", "prompt-lint.mjs", "audit-objective.mjs", "check_release.mjs"].every((needle) =>
    steps.some((step) => step.includes(needle)),
  );
  record(
    "发布所依赖的门禁都在，且 CI 会跑",
    missing.length === 0 && runsTest && wired,
    `missing: ${missing.length === 0 ? "none" : missing.join(", ")}; CI steps: ${steps.length}; ` +
      `unit tests via \`npm test\`: ${runsTest}; acceptance/prompt-lint/audit/release wired: ${wired}`,
  );
}

/* 7 — the packed artifact actually runs -------------------------------------- */
{
  // The gate that was missing when a broken package nearly shipped: every other
  // check reads the working tree, but `npm publish` ships what `files` selects.
  // So pack it, unpack it somewhere isolated, and run the binary.
  const scratch = mkdtempSync(join(tmpdir(), "distilly-release-"));
  try {
    const tarball = execFileSync("npm", ["pack", "--cache", join(scratch, "npm-cache"), "--pack-destination", scratch], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split("\n")
      .pop()
      .trim();
    const unpacked = join(scratch, "unpacked");
    mkdirSync(unpacked, { recursive: true });
    execFileSync("tar", ["-xzf", join(scratch, tarball), "-C", unpacked], { stdio: "pipe" });

    const packed = join(unpacked, "package");
    const runtime = ["src/cli/args.mjs", "src/commands/index.mjs", "assets/distilly-template.html", "SKILL.md"];
    const absent = runtime.filter((relative) => !existsSync(join(packed, relative)));
    const printed = execFileSync(process.execPath, [join(packed, "bin", "distilly.mjs"), "--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const size = statSync(join(scratch, tarball)).size;
    record(
      "打包产物能跑（npm pack → 解包 → 运行 bin，运行时文件齐全）",
      absent.length === 0 && printed === pkg.version,
      `${tarball} (${size} B): --version ${printed === pkg.version ? printed : `"${printed}" ≠ ${pkg.version}`}; ` +
        `missing in tarball: ${absent.length === 0 ? "none" : absent.join(", ")}`,
    );
  } catch (error) {
    // `execFileSync` reports only "Command failed"; the reason is on the child's
    // stderr, which for `npm pack` is the prepack gate's own diagnosis.
    const detail = String(error.stderr ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !/^npm (error|notice)/.test(line) && !/^>/.test(line))
      .slice(0, 2)
      .join(" ");
    record(
      "打包产物能跑（npm pack → 解包 → 运行 bin，运行时文件齐全）",
      false,
      `pack/unpack/run failed: ${detail || error.message.split("\n")[0]}`,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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

