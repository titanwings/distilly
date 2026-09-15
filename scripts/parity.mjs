#!/usr/bin/env node
/**
 * Byte-parity harness: pinned Python implementation vs. the Node core.
 *
 * The Python original is exported from git (it is deleted on this branch), so
 * the comparison always runs against the frozen reference rather than a
 * leftover working copy:
 *
 *   node scripts/parity.mjs [--rev <git-rev>] [--python <exe>] [--keep]
 *                           [--report <file>]
 *
 * Default revision: `git merge-base HEAD dot-skill-test` (the pre-port tree).
 * Everything is compared byte for byte:
 *   A. library level — create/update/list/version operations writing the six
 *      artifacts plus meta.json into identical sandboxes;
 *   B. CLI level — `python3 tools/*.py` vs `node bin/distilly.mjs …` stdout,
 *      stderr and exit codes for the same command lines;
 *   C. pure helpers — slugify / normalize_command_slug / patch merging.
 *
 * The clock is frozen through `DISTILLY_PARITY_NOW` so timestamps cannot mask a
 * real difference; the Python driver patches `now_iso` to the same value, and
 * archived-version mtimes are pinned before they are listed.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const FROZEN_NOW = "2024-01-02T03:04:05.678901+00:00";
const FROZEN_MTIME = Math.floor(Date.parse("2024-01-02T03:04:05Z") / 1000);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

const keep = has("keep");
const pythonExe = arg("python", process.env.PARITY_PYTHON ?? "python3");
const reportPath = arg("report", null);

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr ?? result.stdout}`);
  }
  return result.stdout.trim();
}

const rev = arg("rev", null) ?? process.env.PARITY_PY_REV ?? git(["merge-base", "HEAD", "dot-skill-test"]);

const results = [];
let failures = 0;

function record(section, name, ok, detail = "") {
  results.push({ section, name, ok, detail });
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "DIFF"}  ${section} :: ${name}${detail ? ` — ${detail}` : ""}`);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function walk(root, base = root, into = new Map()) {
  for (const entry of readdirSync(root).sort()) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) walk(full, base, into);
    else into.set(relative(base, full), sha256(readFileSync(full)));
  }
  return into;
}

function compareTrees(label, leftRoot, rightRoot) {
  const left = existsSync(leftRoot) ? walk(leftRoot) : new Map();
  const right = existsSync(rightRoot) ? walk(rightRoot) : new Map();
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();
  const differences = [];
  for (const name of names) {
    const a = left.get(name);
    const b = right.get(name);
    if (a === b) continue;
    differences.push(`${name} [${a ? a.slice(0, 10) : "missing"} vs ${b ? b.slice(0, 10) : "missing"}]`);
  }
  record(
    label,
    `${names.length} files byte-identical`,
    differences.length === 0,
    differences.slice(0, 5).join("; ") + (differences.length > 5 ? ` (+${differences.length - 5} more)` : ""),
  );
  return { total: names.length, differences };
}

function pinMtimes(root, epochSeconds = FROZEN_MTIME) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      utimesSync(full, epochSeconds, epochSeconds);
      pinMtimes(full, epochSeconds);
    }
  }
}

const sandbox = mkdtempSync(join(tmpdir(), "dst-parity-"));
const pyRoot = join(sandbox, "python");
const nodeRoot = join(sandbox, "node");
mkdirSync(pyRoot, { recursive: true });
mkdirSync(nodeRoot, { recursive: true });

const archive = join(sandbox, "pinned-tools.tar");
const archiveResult = spawnSync("git", ["archive", "--format=tar", "-o", archive, rev, "tools"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (archiveResult.status !== 0) throw new Error(`cannot export tools/ at ${rev}: ${archiveResult.stderr}`);
const untar = spawnSync("tar", ["-xf", archive, "-C", pyRoot], { encoding: "utf8" });
if (untar.status !== 0) throw new Error(`cannot extract ${archive}: ${untar.stderr}`);

console.log(`parity: pinned rev ${rev}`);
console.log(`parity: python ${pythonExe}`);
console.log(`parity: sandbox ${sandbox}\n`);

/* ------------------------------------------------------------------ *
 * Shared scenario script. Both drivers implement exactly these steps  *
 * and write the same files; nothing is sorted output-only.            *
 * ------------------------------------------------------------------ */

const PY_DRIVER = String.raw`
import contextlib, io, json, os, sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))

FIXED = os.environ["DISTILLY_PARITY_NOW"]
import skill_schema, skill_writer, version_manager  # noqa: E402

skill_schema.now_iso = lambda: FIXED
skill_writer.now_iso = lambda: FIXED
version_manager.now_iso = lambda: FIXED

OUT = Path(sys.argv[1]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
REPORT = OUT.parent / "report"
REPORT.mkdir(parents=True, exist_ok=True)


def emit(name, value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
    (REPORT / name).write_text(text, encoding="utf-8")


def capture(fn, *args, **kwargs):
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer), contextlib.redirect_stderr(buffer):
        try:
            result = fn(*args, **kwargs)
        except Exception as error:
            print("EXC %s: %s" % (type(error).__name__, error))
            result = None
    return buffer.getvalue() + "\n<<return:%r>>" % (result,)


def new_base(name, character):
    base = OUT / name / "skills" / character
    base.mkdir(parents=True, exist_ok=True)
    return base


WORK_BODY = "## mental models\n- First-principles reasoning\n- Skeptical framing\n\n## limitations\n- Avoids operational detail\n\nSources:\nhttps://example.com/a\nhttps://example.com/b\n"
PERSONA_BODY = "## expression DNA\n- Sentence rhythm is clipped.\n- Uses metaphor when disagreeing.\n\n## honest boundaries\n- States what they do not know.\n"
ZH_WORK = "## \u5de5\u4f5c\u80fd\u529b\u4f7f\u7528\u8bf4\u660e\n\n\u5f53\u7528\u6237\u8981\u6c42\u4f60\u5b8c\u6210\u4ee5\u4e0b\u4efb\u52a1\u65f6\uff0c\u4e25\u683c\u6309\u7167\u4e0a\u8ff0\u89c4\u8303\u6267\u884c\u3002\n\n\u5982\u679c\u88ab\u95ee\u5230\u804c\u8d23\u8303\u56f4\u5916\u7684\u95ee\u9898\uff0c\u4ee5\u8be5\u540c\u4e8b\u7684\u65b9\u5f0f\u56de\u5e94\uff08\u53c2\u89c1 Persona \u90e8\u5206\uff09\u3002\n"
EN_WORK = "## Scope rule\n\nIf you are asked a question outside your recorded responsibilities, respond in this colleague's style (see the Persona section).\n\n## Persona naming note\n\nKeep this documentation sentence.\n"

# s1: colleague with rich metadata
base = new_base("s1", "colleague")
skill_writer.create_skill(base, "eulalie", {
    "character": "colleague",
    "display_name": "Eulalie",
    "classification": {"language": "en"},
    "profile": {"company": "ByteDance", "level": "L2-1", "role": "Backend Engineer", "mbti": "INTJ"},
    "tags": {"personality": ["direct", "data-driven"], "culture": ["byte-dance-style"]},
    "knowledge_sources": ["manual-notes"],
}, WORK_BODY, PERSONA_BODY)

# s2: relationship, Chinese chrome
base = new_base("s2", "relationship")
skill_writer.create_skill(base, "mireille", {
    "character": "relationship",
    "name": "Mireille",
    "classification": {"language": "zh-CN"},
    "profile": {"role": "Designer"},
}, ZH_WORK, PERSONA_BODY)

# s3: celebrity with tags list and research dirs
base = new_base("s3", "celebrity")
skill_writer.create_skill(base, "zadie-smith", {
    "character": "celebrity",
    "name": "Zadie Smith",
    "profile": {"identity": "Novelist", "known_for": "Essay and criticism"},
    "tags": ["literature", "essay", "public-intellectual"],
    "knowledge_sources": ["interview", "essay"],
}, EN_WORK, PERSONA_BODY)

# s4: celebrity, deep research profile, Chinese, string profile
base = new_base("s4", "celebrity")
skill_writer.create_skill(base, "xu-zhisheng", {
    "character": "celebrity",
    "research_profile": "budget-unfriendly",
    "name": "Xu Zhisheng",
    "classification": {"language": "zh-CN"},
    "profile": "\u4e2d\u56fd\u8131\u53e3\u79c0\u6f14\u5458\u3002",
}, ZH_WORK, PERSONA_BODY)

# s5: legacy dot-skill identifiers survive
base = new_base("s5", "colleague")
skill_writer.create_skill(base, "legacy", {
    "name": "Legacy",
    "preset": "dot.colleague.v1",
    "engine": {"name": "dot-skill"},
    "generation": {"engine": "dot-skill"},
    "artifacts": {
        "combined_name": "colleague_legacy",
        "work_name": "colleague_legacy_work",
        "persona_name": "colleague_legacy_persona",
    },
}, "Work body\n", "Persona body\n")

# s6: updates on s1
skill_dir = OUT / "s1" / "skills" / "colleague" / "eulalie"
emit("update-work-patch.txt", capture(skill_writer.update_skill, skill_dir, "## new evidence\n- Adds a later example.\n"))
emit("update-correction.txt", capture(skill_writer.update_skill, skill_dir, None, None, {"scene": "disagreement", "wrong": "flatten disagreement", "correct": "surface it directly"}))
emit("update-replace-sections.txt", capture(skill_writer.update_skill, skill_dir, "## mental models\n- Replaced wholesale\n", "## expression DNA\n- Rewritten section\n"))
emit("update-multi-corrections.txt", capture(skill_writer.update_skill, skill_dir, None, None, {"persona_corrections": [
    {"scene": "\u94fa\u9648\u5904\u5883\u65f6", "wrong": "\u4e00\u4e0a\u6765\u5c31\u4e0b\u5224\u65ad", "correct": "\u5148\u628a\u5904\u5883\u8bb2\u5f97\u5f88\u666e\u901a"},
    {"scene": "\u8868\u8fbe\u7acb\u573a\u65f6", "wrong": "\u5199\u6210\u660e\u663e\u81ea\u5632\u578b", "correct": "\u548c\u89c2\u4f17\u4e00\u8d77\u627f\u8ba4"},
]}))

# s7: listing
emit("list-s1.txt", skill_writer.list_skills(OUT / "s1" / "skills" / "colleague"))
emit("list-missing.txt", skill_writer.list_skills(OUT / "nope" / "skills"))

# s8: version flow
emit("version-backup.txt", capture(version_manager.backup_current_version, skill_dir))
emit("version-list-before.txt", version_manager.list_versions(skill_dir))
emit("version-rollback-ok.txt", capture(version_manager.rollback, skill_dir, "v1"))
emit("version-rollback-missing.txt", capture(version_manager.rollback, skill_dir, "v99"))
emit("version-rollback-traversal.txt", capture(version_manager.rollback, skill_dir, "../v1"))
emit("version-list-after.txt", version_manager.list_versions(skill_dir))
emit("version-cleanup.txt", capture(version_manager.cleanup_old_versions, skill_dir, 2))
emit("version-cleanup-again.txt", capture(version_manager.cleanup_old_versions, skill_dir, 10))

# s9: helpers and slug behaviour
for index, value in enumerate(["Zadie Smith", "\u00c9lodie", "A/B", "  --A--B--  ", "!!!", "\u5468\u5947\u58a8"]):
    emit("normalize-command-slug-%d.txt" % index, skill_schema.normalize_command_slug(value))
emit("merge-append.txt", skill_writer.merge_markdown_patch("intro\n", "no headings here\n"))
emit("merge-replace.txt", skill_writer.merge_markdown_patch("intro\n\n## A\n\nold\n\n## B\n\nkeep\n", "## A\n\nnew\n"))
emit("merge-unknown-section.txt", skill_writer.merge_markdown_patch("intro\n\n## A\n\nold\n", "## Z\n\nadded\n"))
emit("work-only-zh.txt", skill_writer.work_only_content(ZH_WORK, chinese=True))
emit("work-only-en.txt", skill_writer.work_only_content(EN_WORK, chinese=False))
emit("validate-segments.txt", [skill_schema.validate_path_segment(value) for value in ["Zadie Smith", "\u00c9lodie"]])
emit("validate-rejects.txt", [
    capture(skill_schema.validate_path_segment, value).strip()
    for value in ["C:", "foo:bar", "CON", "nul.txt", "trailing.", "trailing ", "", ".."]
])
`;

const NODE_DRIVER = String.raw`
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import * as skillSchema from "__REPO__/src/skill/schema.mjs";
import * as skillWriter from "__REPO__/src/skill/writer.mjs";
import * as versionManager from "__REPO__/src/skill/versions.mjs";

const OUT = resolve(process.argv[2]);
mkdirSync(OUT, { recursive: true });
const REPORT = join(OUT, "..", "report");
mkdirSync(REPORT, { recursive: true });

const emit = (name, value) => {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  writeFileSync(join(REPORT, name), text, "utf8");
};

const capture = (fn, ...args) => {
  const chunks = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let result;
  const sink = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  process.stdout.write = sink;
  process.stderr.write = sink;
  try {
    result = fn(...args);
  } catch (error) {
    chunks.push("EXC " + error.name + ": " + error.message + "\n");
    result = undefined;
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
  const printed = chunks.join("");
  return printed + "\n<<return:" + require_repr(result) + ">>";
};

function require_repr(value) {
  if (value === undefined) return "None";
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

const newBase = (name, character) => {
  const base = join(OUT, name, "skills", character);
  mkdirSync(base, { recursive: true });
  return base;
};

const WORK_BODY = "## mental models\n- First-principles reasoning\n- Skeptical framing\n\n## limitations\n- Avoids operational detail\n\nSources:\nhttps://example.com/a\nhttps://example.com/b\n";
const PERSONA_BODY = "## expression DNA\n- Sentence rhythm is clipped.\n- Uses metaphor when disagreeing.\n\n## honest boundaries\n- States what they do not know.\n";
const ZH_WORK = "## \u5de5\u4f5c\u80fd\u529b\u4f7f\u7528\u8bf4\u660e\n\n\u5f53\u7528\u6237\u8981\u6c42\u4f60\u5b8c\u6210\u4ee5\u4e0b\u4efb\u52a1\u65f6\uff0c\u4e25\u683c\u6309\u7167\u4e0a\u8ff0\u89c4\u8303\u6267\u884c\u3002\n\n\u5982\u679c\u88ab\u95ee\u5230\u804c\u8d23\u8303\u56f4\u5916\u7684\u95ee\u9898\uff0c\u4ee5\u8be5\u540c\u4e8b\u7684\u65b9\u5f0f\u56de\u5e94\uff08\u53c2\u89c1 Persona \u90e8\u5206\uff09\u3002\n";
const EN_WORK = "## Scope rule\n\nIf you are asked a question outside your recorded responsibilities, respond in this colleague's style (see the Persona section).\n\n## Persona naming note\n\nKeep this documentation sentence.\n";

// s1
let base = newBase("s1", "colleague");
skillWriter.createSkill(base, "eulalie", {
  character: "colleague",
  display_name: "Eulalie",
  classification: { language: "en" },
  profile: { company: "ByteDance", level: "L2-1", role: "Backend Engineer", mbti: "INTJ" },
  tags: { personality: ["direct", "data-driven"], culture: ["byte-dance-style"] },
  knowledge_sources: ["manual-notes"],
}, WORK_BODY, PERSONA_BODY);

// s2
base = newBase("s2", "relationship");
skillWriter.createSkill(base, "mireille", {
  character: "relationship",
  name: "Mireille",
  classification: { language: "zh-CN" },
  profile: { role: "Designer" },
}, ZH_WORK, PERSONA_BODY);

// s3
base = newBase("s3", "celebrity");
skillWriter.createSkill(base, "zadie-smith", {
  character: "celebrity",
  name: "Zadie Smith",
  profile: { identity: "Novelist", known_for: "Essay and criticism" },
  tags: ["literature", "essay", "public-intellectual"],
  knowledge_sources: ["interview", "essay"],
}, EN_WORK, PERSONA_BODY);

// s4
base = newBase("s4", "celebrity");
skillWriter.createSkill(base, "xu-zhisheng", {
  character: "celebrity",
  research_profile: "budget-unfriendly",
  name: "Xu Zhisheng",
  classification: { language: "zh-CN" },
  profile: "\u4e2d\u56fd\u8131\u53e3\u79c0\u6f14\u5458\u3002",
}, ZH_WORK, PERSONA_BODY);

// s5
base = newBase("s5", "colleague");
skillWriter.createSkill(base, "legacy", {
  name: "Legacy",
  preset: "dot.colleague.v1",
  engine: { name: "dot-skill" },
  generation: { engine: "dot-skill" },
  artifacts: {
    combined_name: "colleague_legacy",
    work_name: "colleague_legacy_work",
    persona_name: "colleague_legacy_persona",
  },
}, "Work body\n", "Persona body\n");

// s6
const skillDir = join(OUT, "s1", "skills", "colleague", "eulalie");
emit("update-work-patch.txt", capture(skillWriter.updateSkill, skillDir, "## new evidence\n- Adds a later example.\n"));
emit("update-correction.txt", capture(skillWriter.updateSkill, skillDir, null, null, { scene: "disagreement", wrong: "flatten disagreement", correct: "surface it directly" }));
emit("update-replace-sections.txt", capture(skillWriter.updateSkill, skillDir, "## mental models\n- Replaced wholesale\n", "## expression DNA\n- Rewritten section\n"));
emit("update-multi-corrections.txt", capture(skillWriter.updateSkill, skillDir, null, null, { persona_corrections: [
  { scene: "\u94fa\u9648\u5904\u5883\u65f6", wrong: "\u4e00\u4e0a\u6765\u5c31\u4e0b\u5224\u65ad", correct: "\u5148\u628a\u5904\u5883\u8bb2\u5f97\u5f88\u666e\u901a" },
  { scene: "\u8868\u8fbe\u7acb\u573a\u65f6", wrong: "\u5199\u6210\u660e\u663e\u81ea\u5632\u578b", correct: "\u548c\u89c2\u4f17\u4e00\u8d77\u627f\u8ba4" },
] }));

// s7
emit("list-s1.txt", skillWriter.listSkills(join(OUT, "s1", "skills", "colleague")));
emit("list-missing.txt", skillWriter.listSkills(join(OUT, "nope", "skills")));

// s8
emit("version-backup.txt", capture(versionManager.backupCurrentVersion, skillDir));
emit("version-list-before.txt", versionManager.listVersions(skillDir));
emit("version-rollback-ok.txt", capture(versionManager.rollback, skillDir, "v1"));
emit("version-rollback-missing.txt", capture(versionManager.rollback, skillDir, "v99"));
emit("version-rollback-traversal.txt", capture(versionManager.rollback, skillDir, "../v1"));
emit("version-list-after.txt", versionManager.listVersions(skillDir));
emit("version-cleanup.txt", capture(versionManager.cleanupOldVersions, skillDir, 2));
emit("version-cleanup-again.txt", capture(versionManager.cleanupOldVersions, skillDir, 10));

// s9
["Zadie Smith", "\u00c9lodie", "A/B", "  --A--B--  ", "!!!", "\u5468\u5947\u58a8"].forEach((value, index) => {
  emit("normalize-command-slug-" + index + ".txt", skillSchema.normalizeCommandSlug(value));
});
emit("merge-append.txt", skillWriter.mergeMarkdownPatch("intro\n", "no headings here\n"));
emit("merge-replace.txt", skillWriter.mergeMarkdownPatch("intro\n\n## A\n\nold\n\n## B\n\nkeep\n", "## A\n\nnew\n"));
emit("merge-unknown-section.txt", skillWriter.mergeMarkdownPatch("intro\n\n## A\n\nold\n", "## Z\n\nadded\n"));
emit("work-only-zh.txt", skillWriter.workOnlyContent(ZH_WORK, { chinese: true }));
emit("work-only-en.txt", skillWriter.workOnlyContent(EN_WORK, { chinese: false }));
emit("validate-segments.txt", ["Zadie Smith", "\u00c9lodie"].map((value) => skillSchema.validatePathSegment(value)));
emit("validate-rejects.txt", ["C:", "foo:bar", "CON", "nul.txt", "trailing.", "trailing ", "", ".."].map((value) =>
  capture(skillSchema.validatePathSegment, value).trim(),
));
`;

/* ---------------------------- phase A ---------------------------- */

const pyDriverPath = join(pyRoot, "tools", "parity_driver.py");
writeFileSync(pyDriverPath, PY_DRIVER, "utf8");

const nodeDriverPath = join(nodeRoot, "parity_driver.mjs");
writeFileSync(nodeDriverPath, NODE_DRIVER.replaceAll("__REPO__", repoRoot), "utf8");

const env = { ...process.env, DISTILLY_PARITY_NOW: FROZEN_NOW, PYTHONDONTWRITEBYTECODE: "1" };

const pythonRun = spawnSync(pythonExe, [pyDriverPath, join(pyRoot, "out")], {
  cwd: pyRoot,
  encoding: "utf8",
  env,
});
if (pythonRun.status !== 0) {
  console.error(pythonRun.stdout);
  console.error(pythonRun.stderr);
  throw new Error(`python driver failed with status ${pythonRun.status}`);
}

const nodeRun = spawnSync(process.execPath, [nodeDriverPath, join(nodeRoot, "out")], {
  cwd: nodeRoot,
  encoding: "utf8",
  env,
});
if (nodeRun.status !== 0) {
  console.error(nodeRun.stdout);
  console.error(nodeRun.stderr);
  throw new Error(`node driver failed with status ${nodeRun.status}`);
}

pinMtimes(join(pyRoot, "out"));
pinMtimes(join(nodeRoot, "out"));

compareTrees("A library", join(pyRoot, "out"), join(nodeRoot, "out"));

/* ---------------------------- phase B ---------------------------- */

const CLI_STEPS = [
  {
    name: "create",
    python: ["tools/skill_writer.py", "--action", "create", "--character", "colleague", "--slug", "eulalie", "--name", "Eulalie", "--meta", "meta.json", "--work", "work.md", "--persona", "persona.md", "--base-dir", "skills/colleague"],
    node: ["skill", "create", "--character", "colleague", "--slug", "eulalie", "--name", "Eulalie", "--meta", "meta.json", "--work", "work.md", "--persona", "persona.md", "--base-dir", "skills/colleague"],
  },
  {
    name: "create-pinyin-name",
    python: ["tools/skill_writer.py", "--action", "create", "--character", "colleague", "--name", "Zadie Smith", "--base-dir", "skills/colleague"],
    node: ["skill", "create", "--character", "colleague", "--name", "Zadie Smith", "--base-dir", "skills/colleague"],
  },
  {
    name: "list",
    python: ["tools/skill_writer.py", "--action", "list", "--character", "colleague", "--base-dir", "skills/colleague"],
    node: ["skill", "list", "--character", "colleague", "--base-dir", "skills/colleague"],
  },
  {
    name: "update",
    python: ["tools/skill_writer.py", "--action", "update", "--character", "colleague", "--slug", "eulalie", "--base-dir", "skills/colleague", "--work-patch", "patch.md", "--correction-json", "correction.json"],
    node: ["skill", "update", "--character", "colleague", "--slug", "eulalie", "--base-dir", "skills/colleague", "--work-patch", "patch.md", "--correction-json", "correction.json"],
  },
  { name: "version-list", python: ["tools/version_manager.py", "--action", "list", "--slug", "eulalie", "--base-dir", "skills/colleague"], node: ["skill", "version", "list", "--slug", "eulalie", "--base-dir", "skills/colleague"] },
  { name: "version-backup", python: ["tools/version_manager.py", "--action", "backup", "--slug", "eulalie", "--base-dir", "skills/colleague"], node: ["skill", "version", "backup", "--slug", "eulalie", "--base-dir", "skills/colleague"] },
  { name: "version-rollback", python: ["tools/version_manager.py", "--action", "rollback", "--slug", "eulalie", "--version", "v1", "--base-dir", "skills/colleague"], node: ["skill", "version", "rollback", "--slug", "eulalie", "--version", "v1", "--base-dir", "skills/colleague"] },
  { name: "version-cleanup", python: ["tools/version_manager.py", "--action", "cleanup", "--slug", "eulalie", "--base-dir", "skills/colleague"], node: ["skill", "version", "cleanup", "--slug", "eulalie", "--base-dir", "skills/colleague"] },
];

function seedCliSandbox(root) {
  mkdirSync(join(root, "skills", "colleague"), { recursive: true });
  writeFileSync(join(root, "meta.json"), JSON.stringify({ character: "colleague", display_name: "Eulalie", classification: { language: "en" }, profile: { role: "Backend Engineer" } }, null, 2), "utf8");
  writeFileSync(join(root, "work.md"), "Work body\n", "utf8");
  writeFileSync(join(root, "persona.md"), "Persona body\n", "utf8");
  writeFileSync(join(root, "patch.md"), "## Update\n\nPatched section.\n", "utf8");
  writeFileSync(join(root, "correction.json"), JSON.stringify({ scene: "review", wrong: "hedge", correct: "state the risk plainly" }), "utf8");
}

const cliPy = join(sandbox, "cli-python");
const cliNode = join(sandbox, "cli-node");
for (const root of [cliPy, cliNode]) {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  seedCliSandbox(root);
}

const cliEnv = { ...env, DISTILLY_AUTO_INSTALL_CLAUDE: "0", DOT_SKILL_AUTO_INSTALL_CLAUDE: "0" };
const cliTranscript = { python: [], node: [] };

for (const step of CLI_STEPS) {
  // Archive mtimes are minute-precision in the listing; pin them before listing.
  if (step.name === "version-list" || step.name === "version-cleanup") {
    pinMtimes(join(cliPy, "skills", "colleague", "eulalie", "versions"));
    pinMtimes(join(cliNode, "skills", "colleague", "eulalie", "versions"));
  }
  const py = spawnSync(pythonExe, step.python, { cwd: cliPy, encoding: "utf8", env: cliEnv });
  const js = spawnSync(process.execPath, [join(repoRoot, "bin", "distilly.mjs"), ...step.node], {
    cwd: cliNode,
    encoding: "utf8",
    env: cliEnv,
  });
  const pyOut = `status=${py.status}\n--- stdout ---\n${py.stdout}--- stderr ---\n${py.stderr}`;
  const jsOut = `status=${js.status}\n--- stdout ---\n${js.stdout}--- stderr ---\n${js.stderr}`;
  cliTranscript.python.push(`### ${step.name}\n${pyOut}`);
  cliTranscript.node.push(`### ${step.name}\n${jsOut}`);
  record(
    "B cli",
    step.name,
    pyOut === jsOut,
    pyOut === jsOut ? "" : `exit ${py.status}/${js.status}; first diff at ${firstDifference(pyOut, jsOut)}`,
  );
}

record(
  "B cli",
  "installed tree byte-identical",
  JSON.stringify([...walk(join(cliPy, "skills")).keys()].sort()) ===
    JSON.stringify([...walk(join(cliNode, "skills")).keys()].sort()),
);
compareTrees("B cli", join(cliPy, "skills"), join(cliNode, "skills"));

function firstDifference(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) {
      return `char ${index}: ${JSON.stringify(left.slice(Math.max(0, index - 20), index + 20))} vs ${JSON.stringify(right.slice(Math.max(0, index - 20), index + 20))}`;
    }
  }
  return left.length === right.length ? "identical" : `length ${left.length} vs ${right.length}`;
}

/* ---------------------------- phase C ---------------------------- */

const slugNames = ["Zadie Smith", "\u00C9lodie", "A/B", "Zhou Qimo", "Mireille"];
const pySlug = spawnSync(
  pythonExe,
  [
    "-c",
    [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(join(pyRoot, "tools"))})`,
      "import skill_writer",
      "names = json.loads(sys.argv[1])",
      "out = {}",
      "for name in names:",
      "    try:",
      "        out[name] = skill_writer.slugify(name)",
      "    except Exception as error:",
      "        out[name] = 'EXC ' + type(error).__name__",
      "print(json.dumps(out, ensure_ascii=False, sort_keys=True))",
    ].join("\n"),
    JSON.stringify(slugNames),
  ],
  { cwd: pyRoot, encoding: "utf8", env },
);

let pypinyinAvailable = false;
const pypinyinProbe = spawnSync(pythonExe, ["-c", "import pypinyin"], { encoding: "utf8", env });
pypinyinAvailable = pypinyinProbe.status === 0;

if (pySlug.status === 0) {
  const pythonSlugs = JSON.parse(pySlug.stdout);
  const { slugify } = await import(join(repoRoot, "src/skill/writer.mjs"));
  const nodeSlugs = {};
  for (const name of slugNames) {
    try {
      nodeSlugs[name] = slugify(name);
    } catch (error) {
      nodeSlugs[name] = `EXC ${error.name}`;
    }
  }
  for (const name of slugNames) {
    record(
      "C slugify",
      `${name} → ${pythonSlugs[name]}`,
      pythonSlugs[name] === nodeSlugs[name] || !pypinyinAvailable,
      pythonSlugs[name] === nodeSlugs[name]
        ? ""
        : `node: ${nodeSlugs[name]}${pypinyinAvailable ? "" : " (python ran without pypinyin)"}`,
    );
  }
} else {
  record("C slugify", "python slugify probe", false, pySlug.stderr.trim().split("\n")[0]);
}

/* ---------------------------- report ---------------------------- */

const summary = {
  rev,
  python: pythonExe,
  pypinyinAvailable,
  frozenNow: FROZEN_NOW,
  checks: results.length,
  failures,
  results,
};

if (reportPath) {
  writeFileSync(
    reportPath,
    [
      `# parity report`,
      ``,
      `- pinned rev: \`${rev}\``,
      `- python: \`${pythonExe}\` (pypinyin available: ${pypinyinAvailable})`,
      `- frozen clock: \`${FROZEN_NOW}\``,
      `- checks: ${results.length}, failures: ${failures}`,
      ``,
      `| section | check | result | detail |`,
      `| --- | --- | --- | --- |`,
      ...results.map((r) => `| ${r.section} | ${r.name} | ${r.ok ? "OK" : "DIFF"} | ${r.detail.replaceAll("|", "\\|")} |`),
      ``,
      `Raw transcript (${keep ? sandbox : "sandbox removed"}):`,
      ``,
      "```text",
      ...results.map((r) => `${r.ok ? "PASS" : "DIFF"} ${r.section} :: ${r.name} ${r.detail}`),
      "```",
      "",
    ].join("\n"),
    "utf8",
  );
}

if (keep) console.log(`\nsandbox kept: ${sandbox}`);
else rmSync(sandbox, { recursive: true, force: true });

console.log(`\nparity: ${results.length - failures}/${results.length} checks passed`);
process.exitCode = failures === 0 ? 0 : 1;
