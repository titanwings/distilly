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

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { register, PLANNED } from "./index.mjs";
import { createReceipt, describeFile, displayPath } from "../cli/receipt.mjs";
import { parseArgs } from "../cli/args.mjs";
import { listAgents } from "../hosts/agents.mjs";
import { inspectInstall, repoInstallDir } from "../install/hosts.mjs";
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
    for (const [family, preset] of Object.entries(CHARACTER_PRESETS)) {
      if (preset.character !== family) continue;
      const baseDir = familyBase ? join(familyBase, family) : (preset.storage_root ?? preset.legacy_storage_root);
      const skills = listSkills(baseDir);
      for (const skill of skills) {
        skillCount += 1;
        const skillDir = join(baseDir, skill.slug);
        const ledger = readLedger(skillDir);
        anchorTotal += ledger.anchors;
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

    reporter.line("");
    reporter.line(
      `Ledger coverage / 账本：${skillCount} skills, ${anchorTotal} anchors recorded, 0 cited ` +
        "(evidence/derived is delivered by ds/06-retrospect)",
    );

    const unavailable = Object.entries(PLANNED).map(([command, branch]) => ({
      channel: command,
      reason: `not implemented in this build; delivered by ${branch}`,
    }));
    reporter.line("");
    reporter.line(`Unavailable / 未实现：${unavailable.map((item) => item.channel).join(", ")}`);

    return {
      receipt: createReceipt("doctor", {
        inputs,
        outputs,
        anchors: { total: anchorTotal, cited: 0 },
        warnings,
        unavailable,
      }),
      extra: { hosts: hostRows, skills: skillCount },
    };
  },
});
