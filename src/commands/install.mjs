/**
 * `distilly install <host>` / `distilly uninstall [<host>|--path <dir>]`.
 *
 * Host directories come from the shared matrix in `src/hosts/agents.mjs`; the
 * copy / verify / remove actions live in `src/install/hosts.mjs` (the merged
 * port of the eight `tools/install_*.py` scripts).
 *
 * `--force` replaces an existing install after renaming it to a timestamped
 * backup (the pre-v2 CLI's safety behaviour); `--no-backup` deletes instead.
 */

import { join } from "node:path";

import { register } from "./index.mjs";
import { CliError, createReceipt, describeFile, displayPath, directoryBytes } from "../cli/receipt.mjs";
import { parseArgs } from "../cli/args.mjs";
import { listAgents } from "../hosts/agents.mjs";
import {
  HOST_ALIASES,
  inspectInstall,
  installRepoSkill,
  repoInstallDir,
  repoProjectDir,
  resolveHostId,
  supportedHosts,
  uninstallRepoSkill,
  validateInstallTarget,
} from "../install/hosts.mjs";

function installHelp(binary = "distilly") {
  const zh = [
    "用法：",
    `  ${binary} install <host> [--force] [--dry-run] [--no-backup] [--project]`,
    `  ${binary} install --path <以 distilly 结尾的目录> [--force]`,
    "",
    `宿主 <host>（目录取自 src/hosts/agents.mjs，不猜路径）：`,
    `  ${supportedHosts().join(", ")}`,
    `别名：${Object.entries(HOST_ALIASES).map(([alias, id]) => `${alias} → ${id}`).join("，")}`,
    "",
    "选项：",
    "  --force      覆盖已存在的安装（默认先把旧副本改名成带时间戳的备份）",
    "  --no-backup  --force 时直接删除旧副本，不保留备份",
    "  --dry-run    只解析目标路径，不写盘",
    "  --project    装到项目级目录（仅当宿主有文档记载的项目目录）",
    "  --path       自定义安装目录（最后一级必须叫 distilly）",
    "",
    `卸载：${binary} uninstall <host>|--path <dir> [--force] [--dry-run] [--backup]`,
  ].join("\n");
  const en = [
    "Usage:",
    `  ${binary} install <host> [--force] [--dry-run] [--no-backup] [--project]`,
    `  ${binary} install --path <dir-ending-in-distilly> [--force]`,
    "",
    "Hosts (paths come from src/hosts/agents.mjs, nothing is guessed):",
    `  ${supportedHosts().join(", ")}`,
    `Aliases: ${Object.entries(HOST_ALIASES).map(([alias, id]) => `${alias} → ${id}`).join(", ")}`,
    "",
    "Options:",
    "  --force      replace an existing install (the old copy is renamed to a timestamped backup first)",
    "  --no-backup  with --force, delete the old copy instead of keeping a backup",
    "  --dry-run    resolve the target path without writing",
    "  --project    install into the project-local directory (only when the host documents one)",
    "  --path       custom install directory whose final segment is distilly",
    "",
    `Uninstall: ${binary} uninstall <host>|--path <dir> [--force] [--dry-run] [--backup]`,
  ].join("\n");
  return { zh, en };
}

const INSTALL_OPTIONS = {
  path: { type: "string", value: "dir" },
  force: { type: "boolean" },
  "no-backup": { type: "boolean" },
  "dry-run": { type: "boolean" },
  project: { type: "boolean" },
};

const UNINSTALL_OPTIONS = {
  path: { type: "string", value: "dir" },
  force: { type: "boolean" },
  "dry-run": { type: "boolean" },
  backup: { type: "boolean" },
  project: { type: "boolean" },
};

/** Resolve the install target from `--path` or a host id. */
export function resolveTarget(flags, { scope = "global" } = {}) {
  if (flags.path) {
    try {
      return { target: validateInstallTarget(flags.path), host: null, scope };
    } catch (error) {
      throw new CliError(error.message, {
        code: "unsafe-target",
        remedy: "choose a directory whose final segment is `distilly`.",
      });
    }
  }
  if (!flags.host) {
    throw new CliError("choose a host or pass --path", {
      code: "usage",
      remedy: `hosts: ${supportedHosts().join(", ")}`,
    });
  }
  let host;
  try {
    host = resolveHostId(flags.host);
  } catch (error) {
    throw new CliError(error.message, {
      code: "unknown-host",
      remedy: `hosts: ${supportedHosts().join(", ")}`,
    });
  }
  const useProject = Boolean(flags.project);
  const target = useProject ? repoProjectDir(host) : repoInstallDir(host);
  if (target === null) {
    throw new CliError(`${host} has no documented project-local directory`, {
      code: "no-project-path",
      remedy: `install globally instead: distilly install ${host}`,
    });
  }
  return { target, host, scope: useProject ? "project" : "global" };
}

const installCommand = {
  summary: "安装到宿主目录 / Install Distilly into a host skills directory",
  usage: "distilly install <host|--path <dir>> [--force] [--dry-run]",
  options: INSTALL_OPTIONS,
  ...installHelp(),
  run({ argv, reporter, ctx }) {
    const { flags, positionals } = parseArgs(argv, { ...INSTALL_OPTIONS, host: { type: "string" } });
    const host = positionals[0] ?? flags.host;
    if (positionals.length > 1) {
      throw new CliError(`unexpected argument: ${positionals[1]}`, { code: "usage" });
    }
    const { target, scope } = resolveTarget({ ...flags, host });
    const backup = !flags["no-backup"];

    const report = {};
    let destination = target;
    try {
      destination = installRepoSkill({
        source: ctx.packageRoot,
        destination: target,
        force: flags.force,
        dryRun: flags["dry-run"],
        backup,
        report,
      });
    } catch (error) {
      throw new CliError(error.message, {
        code: "install-failed",
        remedy: flags.force
          ? "check the target directory permissions."
          : `rerun with --force to replace ${target} (a backup is kept unless --no-backup is passed).`,
      });
    }

    if (flags["dry-run"]) {
      reporter.line(`Would install Distilly ${ctx.version} at ${displayPath(destination)}`);
    } else {
      reporter.line(`Distilly ${ctx.version} installed at ${displayPath(destination)}`);
      if (report.backupPath) {
        reporter.line(`Previous install preserved at ${displayPath(report.backupPath)}`);
      }
    }

    const skillFile = describeFile(join(destination, "SKILL.md"));
    return {
      receipt: {
        ...createReceipt("install", {
          outputs: skillFile ? [skillFile] : [],
          warnings: report.backupPath ? [`previous install preserved at ${displayPath(report.backupPath)}`] : [],
          unavailable: listAgents()
            .filter((id) => id !== resolveHostId(host ?? ""))
            .map((id) => ({ channel: id, reason: "not the selected host" })),
        }),
        host: host ?? null,
        scope,
        dry_run: Boolean(flags["dry-run"]),
      },
    };
  },
};

const uninstallCommand = {
  summary: "卸载 / Remove an installed Distilly from a host directory",
  usage: "distilly uninstall [<host>|--path <dir>] [--force] [--dry-run]",
  options: UNINSTALL_OPTIONS,
  ...installHelp(),
  run({ argv, reporter }) {
    const { flags, positionals } = parseArgs(argv, { ...UNINSTALL_OPTIONS, host: { type: "string" } });
    const host = positionals[0] ?? flags.host;
    const { target, scope } = resolveTarget({ ...flags, host });

    let result;
    try {
      result = uninstallRepoSkill({
        destination: target,
        force: flags.force,
        dryRun: flags["dry-run"],
        backup: flags.backup,
      });
    } catch (error) {
      throw new CliError(error.message, {
        code: "uninstall-failed",
        remedy: "pass --force only when you are sure this directory is a Distilly install.",
      });
    }

    if (flags["dry-run"]) {
      reporter.line(`Would remove ${displayPath(result.destination)}`);
    } else if (result.backupPath) {
      reporter.line(`Removed ${displayPath(result.destination)} (kept at ${displayPath(result.backupPath)})`);
    } else {
      reporter.line(`Removed ${displayPath(result.destination)}`);
    }

    const before = inspectInstall(result.destination);
    return {
      receipt: {
        ...createReceipt("uninstall", {
          outputs: result.removed ? [{ path: displayPath(result.destination), bytes: directoryBytes(result.destination) }] : [],
          warnings: result.backupPath ? [`kept a copy at ${displayPath(result.backupPath)}`] : [],
        }),
        host: host ?? null,
        scope,
        removed: result.removed,
        was_installed: before.installed,
      },
    };
  },
};

export function registerInstallCommands() {
  register("install", installCommand);
  register("uninstall", uninstallCommand);
}

registerInstallCommands();
