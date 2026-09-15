/**
 * Command registry — the single registration point for the Distilly CLI.
 *
 * `bin/distilly.mjs` only parses global flags and dispatches; every subcommand
 * lives in its own module under `src/commands/` and registers itself here:
 *
 * ```js
 * import { register } from "./index.mjs";
 * register("skill create", {
 *   summary: "创建一个 Skill / Create a Skill",
 *   usage: "distilly skill create [options]",
 *   options: {...},                        // src/cli/args.mjs spec, for automatic usage
 *   run: async ({ flags, positionals, json, reporter, ctx }) => ({ receipt, lines }),
 * });
 * ```
 *
 * A definition returns `{receipt, lines, exitCode?}`; throwing `CliError` is the
 * supported way to fail loudly with a remedy. See `docs/v2/NODE-CORE.md`.
 *
 * Names may contain one space (`view check`, `skill create`); dispatch prefers
 * the two-token name. Commands promised by `docs/v2/CONTRACT.md` §1 but not yet
 * implemented are listed in `PLANNED` together with the branch that owns them,
 * so an unfinished build reports "not implemented" instead of "unknown command".
 */

import { CliError } from "../cli/receipt.mjs";

/**
 * Lazily created so the command modules can be imported at the bottom of this
 * file: they call `register()` while this module body is still being evaluated,
 * so the map must not depend on a top-level `const` having run yet.
 */
var REGISTRY;
function registry() {
  if (!REGISTRY) REGISTRY = new Map();
  return REGISTRY;
}

/** Commands frozen in CONTRACT §1 whose implementation ships in another branch. */
export const PLANNED = {
  // Contract §1 is fully implemented on this branch (CONTRACT §1 command surface,
  // 8 collection channels, note, view, skill migrate). The map stays because
  // `missingCommandError` and `doctor` read it to explain what is *not* here; it
  // being empty is the signal that nothing is outstanding.
};

/**
 * Register one subcommand. Duplicate names are a programming error and throw.
 * @param {string} name
 * @param {{summary: string, usage: string, options?: object, run: Function, hidden?: boolean}} definition
 */
export function register(name, definition) {
  const map = registry();
  if (map.has(name)) throw new Error(`command already registered: ${name}`);
  if (typeof definition?.run !== "function") {
    throw new Error(`command ${name} needs a run() function`);
  }
  map.set(name, { name, hidden: false, options: {}, ...definition });
  return definition;
}

export function lookup(name) {
  return registry().get(name) ?? null;
}

export function listCommands({ includeHidden = false } = {}) {
  return [...registry().values()]
    .filter((command) => includeHidden || !command.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Split argv into a command name and its remaining arguments.
 * Two-token names win over one-token names (`view check` before `view`).
 */
export function resolveCommand(tokens) {
  if (tokens.length >= 2) {
    const twoToken = `${tokens[0]} ${tokens[1]}`;
    if (registry().has(twoToken)) return { name: twoToken, rest: tokens.slice(2) };
  }
  if (tokens.length >= 1 && registry().has(tokens[0])) {
    return { name: tokens[0], rest: tokens.slice(1) };
  }
  return { name: tokens[0] ?? null, rest: tokens.slice(1) };
}

/** `null` when the command is registered, otherwise a loud, actionable error. */
export function missingCommandError(name) {
  const branch = PLANNED[name] ?? PLANNED[`${name} ${""}`.trim()];
  if (branch) {
    return new CliError(`command not implemented in this build: ${name}`, {
      code: "not-implemented",
      remedy: `${name} is delivered by branch ${branch} (see docs/v2/STATUS.md); this branch (ds/01-node-core) ships skill/install/uninstall/doctor only.`,
    });
  }
  return new CliError(`unknown command: ${name}`, {
    code: "unknown-command",
    remedy: "run `distilly --help` for the command list.",
  });
}

/** Terminal columns for one string (CJK counts as two), used for help tables. */export function displayWidth(text) {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/** Pad to `width` terminal columns so bilingual help tables line up. */
export function padDisplay(text, width) {
  const padding = Math.max(1, width - displayWidth(text));
  return `${text}${" ".repeat(padding)}`;
}

const CATALOG_ZH = [
  ["skill create|update|list|version", "创建 / 更新 / 列出 / 归档 Skill（本分支）"],
  ["install <host>", "把 Distilly 装进某个宿主的 skills 目录（本分支）"],
  ["uninstall [<host>|--path]", "卸载已安装的 Distilly（本分支）"],
  ["doctor", "宿主与 Skill 库存体检（本分支，最小版）"],
];

const CATALOG_EN = [
  ["skill create|update|list|version", "create / update / list / archive Skills (this branch)"],
  ["install <host>", "install Distilly into a host skills directory (this branch)"],
  ["uninstall [<host>|--path]", "remove an installed Distilly (this branch)"],
  ["doctor", "host and skill inventory health check (this branch, minimal)"],
];

/** Bilingual help for the whole CLI (CONTRACT §6: 中文 → `---` → English). */
export function renderHelp({ version, binary = "distilly" } = {}) {
  const implemented = listCommands();
  const plannedNames = Object.keys(PLANNED).sort();

  const zh = [
    `Distilly ${version}`,
    "",
    "用法：",
    `  ${binary} <命令> [选项]`,
    `  ${binary} --help | --version`,
    "",
    "已实现：",
    ...implemented.map((command) => `  ${command.usage.padEnd(46)}${command.summary.split(" / ")[0]}`),
    "",
    "契约中已冻结、由其他分支交付：",
    `  ${plannedNames.join(", ")}`,
    "",
    "全局选项：",
    "  --json     以 JSON 回执输出（stdout 只有回执；人读信息走 stderr）",
    "  --help     显示帮助",
    "  --version  打印版本",
    "",
    "示例：",
    `  ${binary} skill create --character colleague --name "Zadie Smith" --work work.md --persona persona.md`,
    `  ${binary} skill list --character colleague`,
    `  ${binary} install claude-code --json`,
  ].join("\n");

  const en = [
    `Distilly ${version}`,
    "",
    "Usage:",
    `  ${binary} <command> [options]`,
    `  ${binary} --help | --version`,
    "",
    "Implemented:",
    ...implemented.map((command) => `  ${command.usage.padEnd(46)}${command.summary.split(" / ")[1] ?? command.summary}`),
    "",
    "Frozen by the contract, delivered by other branches:",
    `  ${plannedNames.join(", ")}`,
    "",
    "Global options:",
    "  --json     emit a JSON receipt (stdout holds only the receipt; prose goes to stderr)",
    "  --help     show this help",
    "  --version  print the package version",
    "",
    "Examples:",
    `  ${binary} skill create --character colleague --name "Zadie Smith" --work work.md --persona persona.md`,
    `  ${binary} skill list --character colleague`,
    `  ${binary} install claude-code --json`,
  ].join("\n");

  const catalogZh = ["命令总览：", ...CATALOG_ZH.map(([usage, text]) => `  ${usage.padEnd(46)}${text}`)].join("\n");
  const catalogEn = [
    "Command catalog:",
    ...CATALOG_EN.map(([usage, text]) => `  ${usage.padEnd(46)}${text}`),
  ].join("\n");

  return `${zh}\n\n${catalogZh}\n\n---\n\n## English\n\n${en}\n\n${catalogEn}\n`;
}

/** Usage string for one command, built from its registered options. */
export function renderCommandHelp(command, { binary = "distilly" } = {}) {
  return `${command.usage.replace(/^distilly/, binary)}\n\n${command.help ?? ""}`.trimEnd();
}

/* ------------------------------------------------------------------ */
/* built-in commands                                                   */
/* ------------------------------------------------------------------ */
/* Imported for their side effect: each module calls `register()`. They live at
   the bottom because they import `register` from this file — the lazy REGISTRY
   above is what makes that cycle safe. */
import "./credentialed.mjs";
import "./doctor.mjs";
import "./harvest.mjs";
import "./install.mjs";
import "./legacy.mjs";
import "./migrate.mjs";
import "./note.mjs";
import "./parse-chat.mjs";
import "./parse-email.mjs";
import "./parse-subtitle.mjs";
import "./retrospect.mjs";
import "./skill.mjs";
import "./view.mjs";
