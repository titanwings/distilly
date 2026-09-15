/**
 * `distilly legacy <tool> [args...]` — migration adapter (CONTRACT §1).
 *
 * The pre-v2 command lines
 *
 *   python3 tools/skill_writer.py --action create --slug x --name X …
 *   python3 tools/version_manager.py --action rollback --slug x --version v1
 *   python3 tools/install_generated_skill.py --skill-dir … --host codex
 *   python3 tools/install_openclaw_skill.py --force
 *
 * are translated onto `skill create|update|list|version`, `install` and the
 * merged installer, with a deprecation warning on stderr and the same exit code
 * as the target command. It disappears again in PR③ together with the last
 * Python entry point; `SKILL.md` is updated by ds/04-prompts.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { register, lookup } from "./index.mjs";
import { CliError, createReceipt, describeFile, displayPath } from "../cli/receipt.mjs";
import { ArgError, parseArgs } from "../cli/args.mjs";
import { expandTargetPath, installGeneratedSkill, installGeneratedSkillForClaude } from "../install/hosts.mjs";

const WRITER_ACTIONS = { create: "skill create", update: "skill update", list: "skill list" };
const VERSION_ACTIONS = ["list", "backup", "rollback", "cleanup"];

function deprecation(tool, target, reporter) {
  reporter.warn(
    `[deprecated] python3 tools/${tool} → ${target}（旧入口在 PR③ 移除 / legacy entry point is removed in PR③）`,
  );
}

function runRegistered(name, argv, context, reporter) {
  const command = lookup(name);
  if (!command) {
    throw new CliError(`legacy adapter target is not registered: ${name}`, { code: "not-implemented" });
  }
  return command.run({ ...context, argv, reporter });
}

function splitAction(argv, tool, allowed) {
  const flagIndexes = argv
    .map((value, index) => (value === "--action" ? index : value.startsWith("--action=") ? index : -1))
    .filter((index) => index !== -1);
  if (flagIndexes.length === 0) {
    throw new CliError(`legacy ${tool} needs --action <${allowed.join("|")}>`, { code: "usage" });
  }
  const index = flagIndexes[0];
  const raw = argv[index];
  const action = raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : argv[index + 1];
  if (!allowed.includes(action)) {
    throw new CliError(`legacy ${tool}: unsupported --action ${action}`, {
      code: "usage",
      remedy: `supported: ${allowed.join(", ")}`,
    });
  }
  const rest = raw.includes("=")
    ? [...argv.slice(0, index), ...argv.slice(index + 1)]
    : [...argv.slice(0, index), ...argv.slice(index + 2)];
  return { action, rest };
}

function legacyWriter({ argv, json, reporter, ctx }) {
  const { action, rest } = splitAction(argv, "skill_writer.py", Object.keys(WRITER_ACTIONS));
  const target = WRITER_ACTIONS[action];
  deprecation("skill_writer.py", `distilly ${target}`, reporter);
  return runRegistered(target, rest, { json, reporter, ctx }, reporter);
}

function legacyVersionManager({ argv, json, reporter, ctx }) {
  const { action, rest } = splitAction(argv, "version_manager.py", VERSION_ACTIONS);
  deprecation("version_manager.py", `distilly skill version ${action}`, reporter);
  return runRegistered("skill version", [action, ...rest], { json, reporter, ctx }, reporter);
}

const GENERATED_INSTALL_OPTIONS = {
  "skill-dir": { type: "string", value: "dir" },
  host: { type: "string", value: "host" },
  "skills-dir": { type: "string", value: "dir" },
  "claude-skills-dir": { type: "string", value: "dir" },
  "claude-commands-dir": { type: "string", value: "dir" },
  "openclaw-skills-dir": { type: "string", value: "dir" },
  "codex-skills-dir": { type: "string", value: "dir" },
  "install-command-shim": { type: "boolean" },
  force: { type: "boolean" },
  "dry-run": { type: "boolean" },
};

function legacyGeneratedInstaller(tool, host) {
  return ({ argv, reporter }) => {
    const { flags } = parseArgs(argv, GENERATED_INSTALL_OPTIONS);
    if (!flags["skill-dir"]) {
      throw new CliError(`legacy ${tool} needs --skill-dir`, { code: "usage" });
    }
    const target = `distilly skill create --install-${host}-skill`;
    deprecation(tool, target, reporter);

    const claude = host === "claude-code";
    const skillsDir = claude
      ? flags["claude-skills-dir"] ?? join(homedir(), ".claude", "skills")
      : flags["skills-dir"] ??
        flags[`${host}-skills-dir`] ??
        join(homedir(), host === "openclaw" ? ".openclaw/workspace/skills" : ".agents/skills");

    const result = claude
      ? installGeneratedSkillForClaude({
          skillDir: flags["skill-dir"],
          skillsDir,
          commandsDir: flags["claude-commands-dir"] ?? join(homedir(), ".claude", "commands"),
          force: flags.force,
          dryRun: flags["dry-run"],
          installCommandShim: flags["install-command-shim"],
        })
      : installGeneratedSkill({
          skillDir: flags["skill-dir"],
          skillsDir,
          force: flags.force,
          dryRun: flags["dry-run"],
          host,
        });

    reporter.line(result.command_name);
    reporter.line(displayPath(result.skill_dir));
    if (result.command_shim_installed && result.command_path) {
      reporter.line(displayPath(result.command_path));
    }

    const skillFile = describeFile(join(result.skill_dir, "SKILL.md"));
    return {
      receipt: createReceipt(`install ${host}`, {
        outputs: skillFile ? [skillFile] : [],
        warnings: [`deprecated entry point: tools/${tool}`],
      }),
    };
  };
}

const REPO_INSTALL_OPTIONS = {
  source: { type: "string", value: "dir" },
  dest: { type: "string", value: "dir" },
  force: { type: "boolean" },
  "dry-run": { type: "boolean" },
};

function legacyRepoInstaller(tool, host) {
  return ({ argv, json, reporter, ctx }) => {
    const { flags } = parseArgs(argv, REPO_INSTALL_OPTIONS);
    deprecation(tool, `distilly install ${host}`, reporter);
    const args = [];
    if (flags.dest) args.push("--path", expandTargetPath(flags.dest));
    else args.push(host);
    if (flags.force) args.push("--force");
    if (flags["dry-run"]) args.push("--dry-run");
    if (flags.source) {
      throw new CliError(`legacy ${tool} --source is no longer configurable`, {
        code: "unsupported-option",
        remedy: "the CLI always installs the running checkout; run it from the source directory instead.",
      });
    }
    return runRegistered("install", args, { json, reporter, ctx }, reporter);
  };
}

const LEGACY_TOOLS = {
  "skill_writer.py": legacyWriter,
  "version_manager.py": legacyVersionManager,
  "install_generated_skill.py": legacyGeneratedInstaller("install_generated_skill.py", "codex"),
  "install_claude_generated_skill.py": legacyGeneratedInstaller(
    "install_claude_generated_skill.py",
    "claude-code",
  ),
  "install_openclaw_generated_skill.py": legacyGeneratedInstaller(
    "install_openclaw_generated_skill.py",
    "openclaw",
  ),
  "install_codex_generated_skill.py": legacyGeneratedInstaller(
    "install_codex_generated_skill.py",
    "codex",
  ),
  "install_openclaw_skill.py": legacyRepoInstaller("install_openclaw_skill.py", "openclaw"),
  "install_codex_skill.py": legacyRepoInstaller("install_codex_skill.py", "codex"),
  "install_hermes_skill.py": legacyRepoInstaller("install_hermes_skill.py", "hermes"),
};

function legacyHelp(binary = "distilly") {
  const tools = Object.keys(LEGACY_TOOLS).sort();
  const zh = [
    "用法（迁移期）：",
    `  ${binary} legacy <tool> [--action ...] [options]`,
    "",
    "支持的旧入口（转发到新子命令，并向 stderr 打印弃用警告）：",
    ...tools.map((tool) => `  tools/${tool}`),
    "",
    "示例：",
    `  ${binary} legacy skill_writer.py --action create --slug eulalie --name Eulalie`,
    `  ${binary} legacy version_manager.py --action rollback --slug eulalie --version v1`,
  ].join("\n");
  const en = [
    "Usage (migration window):",
    `  ${binary} legacy <tool> [--action ...] [options]`,
    "",
    "Supported legacy entry points (forwarded, with a deprecation warning on stderr):",
    ...tools.map((tool) => `  tools/${tool}`),
    "",
    "Examples:",
    `  ${binary} legacy skill_writer.py --action create --slug eulalie --name Eulalie`,
    `  ${binary} legacy version_manager.py --action rollback --slug eulalie --version v1`,
  ].join("\n");
  return { zh, en };
}

register("legacy", {
  summary: "旧 python3 tools/*.py 入口转发 / Forward legacy python3 tools/*.py calls",
  usage: "distilly legacy <tool.py> [--action ...] [options]",
  hidden: true,
  ...legacyHelp(),
  run(context) {
    const [tool, ...rest] = context.argv;
    if (!tool) {
      throw new CliError("legacy needs the tool name", {
        code: "usage",
        remedy: `supported: ${Object.keys(LEGACY_TOOLS).sort().join(", ")}`,
      });
    }
    const normalized = tool.replace(/^\.?\/?(tools\/)?/, "");
    const handler = LEGACY_TOOLS[normalized];
    if (!handler) {
      throw new CliError(`no legacy adapter for ${tool}`, {
        code: "unknown-tool",
        remedy:
          "collectors and research tools stay in Python until ds/07; use the new CLI for skill/install/uninstall/doctor.",
      });
    }
    if (!existsSync(join(context.ctx.packageRoot, "tools", normalized))) {
      // The Python file is gone on this branch — forwarding is the whole point.
    }
    return handler({ ...context, argv: rest });
  },
});

export { ArgError, LEGACY_TOOLS };
