/**
 * `distilly doctor` — inventory health check (minimal, honest version).
 *
 * Checks what is actually on disk:
 *   1. every host in the shared matrix: is Distilly installed there, at which
 *      version, and does the directory look like a Distilly install;
 *   2. generated Skills under `skills/<family>/<slug>` (version, corrections);
 *   3. ledger coverage whenever `knowledge/index.json` exists;
 *   4. capabilities this build cannot run yet are listed in `unavailable`
 *      (CONTRACT §3: nothing is silently skipped).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { register, PLANNED } from "./index.mjs";
import { createReceipt, describeFile, displayPath } from "../cli/receipt.mjs";
import { parseArgs } from "../cli/args.mjs";
import { listAgents } from "../hosts/agents.mjs";
import { inspectInstall, repoInstallDir } from "../install/hosts.mjs";
import { resolveSkillsRoot } from "../cli/paths.mjs";
import { parseAnchor } from "../knowledge/anchors.mjs";
import { CHARACTER_PRESETS } from "../skill/presets.mjs";
import { listSkills } from "../skill/writer.mjs";

function doctorHelp(binary = "distilly") {
  const zh = [
    "用法：",
    `  ${binary} doctor [--base-dir <dir>] [--json]`,
    "",
    "检查项（最小版）：",
    "  1. 宿主矩阵里每个宿主是否已安装 Distilly（路径、SKILL.md 版本）；",
    "  2. 生成的 Skill 清单（skills/<family>/<slug>，含版本与 corrections）；",
    "  3. 账本覆盖率：有 knowledge/index.json 时统计条目与字节数；",
    "  4. 未实现能力（parse/view/collect 等）写进回执的 unavailable，不静默跳过。",
  ].join("\n");
  const en = [
    "Usage:",
    `  ${binary} doctor [--base-dir <dir>] [--json]`,
    "",
    "Checks (minimal):",
    "  1. whether Distilly is installed for each host in the shared matrix (path, SKILL.md version);",
    "  2. the generated Skill inventory (skills/<family>/<slug> with version and corrections);",
    "  3. ledger coverage: entry and byte counts whenever knowledge/index.json exists;",
    "  4. capabilities this build cannot run yet (parse/view/collect …) are reported in the receipt's unavailable list, never skipped silently.",
  ].join("\n");
  return { zh, en };
}

const OPTIONS = {
  "base-dir": { type: "string", value: "dir" },
};

/**
 * Every anchor string an `evidence/derived/*.json` file cites.
 *
 * The derived layer is prose-plus-claims: a claim carries `evidence: ["k0001"]`,
 * a boundary carries anchors too. Walking the JSON for `k00NN`-shaped strings
 * finds them all without coupling to one schema, which is what "doctor checks
 * what is on disk" means here.
 */
function citedAnchors(skillDir) {
  const derivedDir = join(skillDir, "evidence", "derived");
  if (!existsSync(derivedDir)) return [];
  const found = new Set();
  const walk = (value) => {
    if (typeof value === "string") {
      if (parseAnchor(value)) found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };
  for (const name of readdirSync(derivedDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      walk(JSON.parse(readFileSync(join(derivedDir, name), "utf8")));
    } catch {
      // A malformed derived file is reported by `view check`, not here.
    }
  }
  return [...found];
}

/** Every anchor a skill's ledger knows about, so a citation can be checked. */
function resolvedAnchors(skillDir) {
  const ledgerPath = join(skillDir, "knowledge", "index.json");
  if (!existsSync(ledgerPath)) return new Set();
  let entries = [];
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
    entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
  } catch {
    return new Set();
  }
  const known = new Set();
  for (const entry of entries) {
    for (const anchor of entry?.anchors ?? []) {
      const id = typeof anchor === "string" ? anchor : anchor?.anchor ?? anchor?.id;
      if (id) known.add(id);
    }
    for (const detail of entry?.anchor_detail ?? []) {
      const id = detail?.anchor ?? detail?.id;
      if (id) known.add(id);
    }
  }
  return known;
}

function readLedger(skillDir) {
  const ledgerPath = join(skillDir, "knowledge", "index.json");
  if (!existsSync(ledgerPath)) {
    return { path: ledgerPath, entries: 0, bytes: 0, anchors: 0, present: false };
  }
  const text = readFileSync(ledgerPath, "utf8");
  let entries = [];
  try {
    const parsed = JSON.parse(text);
    entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
  } catch {
    entries = [];
  }
  const anchors = entries.reduce((total, entry) => {
    const list = entry?.anchors;
    return total + (Array.isArray(list) ? list.length : 0);
  }, 0);
  return {
    path: ledgerPath,
    entries: entries.length,
    bytes: statSync(ledgerPath).size,
    anchors,
    present: true,
  };
}

register("doctor", {
  summary: "体检宿主与 Skill 库存 / Health-check hosts and skill inventory",
  usage: "distilly doctor [--base-dir <dir>] [--json]",
  options: OPTIONS,
  ...doctorHelp(),
  run({ argv, reporter }) {
    const { flags } = parseArgs(argv, OPTIONS);
    const warnings = [];
    const inputs = [];
    const outputs = [];

    reporter.line("Hosts / 宿主:");
    const hostRows = [];
    for (const id of listAgents()) {
      const target = repoInstallDir(id);
      const state = inspectInstall(target);
      hostRows.push({ host: id, path: displayPath(target), installed: state.installed, version: state.version });
      reporter.line(
        `  ${state.installed ? "installed" : "missing  "}  ${id.padEnd(18)} ${displayPath(target)}${state.version ? `  (v${state.version})` : ""}`,
      );
      if (state.installed) {
        const described = describeFile(join(target, "SKILL.md"));
        if (described) inputs.push(described);
      }
    }

    reporter.line("");
    reporter.line("Skills / 人物 Skill:");
    const familyBase = flags["base-dir"];
    let skillCount = 0;
    let anchorTotal = 0;
    let citedTotal = 0;
    const dangling = [];
    for (const [family, preset] of Object.entries(CHARACTER_PRESETS)) {
      if (preset.character !== family) continue;
      // One resolver for all three `--base-dir` spellings: a bare directory must
      // not be read as if a `skills/` level were underneath it.
      // `--base-dir <...>/skills/colleague` names ONE family's storage root. The
      // other families must not read the same directory again — doing so counted
      // the same skill three times over ("inspected once, not once per family").
      if (familyBase && Object.hasOwn(CHARACTER_PRESETS, basename(familyBase)) && basename(familyBase) !== family) {
        continue;
      }
      const resolved = familyBase
        ? resolveSkillsRoot({ baseDir: familyBase, family })
        : { root: preset.storage_root ?? preset.legacy_storage_root, warning: null };
      if (resolved.warning && !warnings.includes(resolved.warning)) warnings.push(resolved.warning);
      const baseDir = resolved.root;
      const skills = listSkills(baseDir);
      for (const skill of skills) {
        skillCount += 1;
        const skillDir = join(baseDir, skill.slug);
        const ledger = readLedger(skillDir);
        anchorTotal += ledger.anchors;
        // `cited` counts the citations that actually resolve; a dangling one is
        // reported in `warnings`, never folded into the number — "we cite two
        // anchors" and "one of the two is broken" are different claims.
        const known = resolvedAnchors(skillDir);
        for (const anchor of citedAnchors(skillDir)) {
          if (known.has(anchor)) citedTotal += 1;
          else dangling.push(`${family}/${skill.slug}: ${anchor}`);
        }
        reporter.line(
          `  ${family}/${skill.slug}  ${skill.version}  corrections=${skill.corrections_count}  ` +
            `knowledge=${ledger.present ? `${ledger.entries} entries / ${ledger.bytes} bytes` : "none"}`,
        );
        if (ledger.present) {
          const described = describeFile(ledger.path);
          if (described) outputs.push(described);
        }
        const skillFile = describeFile(join(skillDir, "SKILL.md"));
        if (skillFile) outputs.push(skillFile);
      }
    }
    if (skillCount === 0) {
      reporter.line("  none found (run `distilly skill create` first)");
      warnings.push("no generated skills found");
    }

    if (dangling.length > 0) {
      warnings.push(
        `${dangling.length} anchor(s) cited by evidence/derived cannot be resolved against knowledge/index.json: ` +
          dangling.join(", "),
      );
    }

    reporter.line("");
    reporter.line(
      `Ledger coverage / 账本：${skillCount} skills, ${anchorTotal} anchors recorded, ${citedTotal} cited ` +
        `by evidence/derived${dangling.length > 0 ? `, ${dangling.length} dangling` : ""}`,
    );

    const unavailable = Object.entries(PLANNED).map(([command, branch]) => ({
      channel: command,
      reason: `not implemented in this build; delivered by ${branch}`,
    }));
    reporter.line("");
    reporter.line(`Unavailable / 未实现：${unavailable.map((item) => item.channel).join(", ")}`);

    // `createReceipt` keeps exactly the eight contract fields, so anything command
    // specific has to be attached to the object afterwards.
    const receipt = createReceipt("doctor", {
      inputs,
      outputs,
      anchors: { total: anchorTotal, cited: citedTotal },
      warnings,
      unavailable,
    });
    receipt.skills = skillCount;
    return { receipt, extra: { hosts: hostRows, skills: skillCount } };
  },
});
