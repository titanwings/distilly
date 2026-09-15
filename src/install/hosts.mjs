/**
 * Host installation actions — the merged port of the eight
 * `tools/install_*.py` scripts:
 *
 *   install_generated_skill_common.py      → installGeneratedSkill()
 *   install_generated_skill.py             → defaultSkillsDir() / HOST_DEFAULT_PARTS
 *   install_claude_generated_skill.py      → shouldInstallCommandShim() + commandsDir
 *   install_openclaw_generated_skill.py    → openclaw wrapper
 *   install_codex_generated_skill.py       → codex wrapper
 *   install_openclaw_skill.py              → installRepoSkill()
 *   install_codex_skill.py                 → installRepoSkill()
 *   install_hermes_skill.py                → installRepoSkill()
 *
 * Directories are never guessed: every target derives from the shared matrix in
 * `src/hosts/agents.mjs` (`getAgent(id).globalPath`), except the Hermes
 * *generated-skill* root, which INSTALL.md documents as
 * `~/.hermes/skills/distilly-generated` and which is therefore an explicit,
 * sourced override.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";

import { getAgent, listAgents } from "../hosts/agents.mjs";
import { enrichExistingSkillMeta, jsonDumps, nowIso, resolveRealPath } from "../skill/schema.mjs";

/** `install <alias>` shortcuts kept from the pre-v2 CLI. */
export const HOST_ALIASES = {
  claude: "claude-code",
  deepseek: "deepseek-harness",
  grok: "grok-build",
};

/**
 * Documented exception to "every target comes from the host matrix":
 * INSTALL.md's generated-skill table puts Hermes person skills under
 * `~/.hermes/skills/distilly-generated`, while the repo-level clone target is
 * `~/.hermes/skills/openclaw-imports/distilly`.
 */
const GENERATED_ROOT_OVERRIDES = {
  hermes: "~/.hermes/skills/distilly-generated",
};

const REPO_IGNORE = [".git", "__pycache__", ".DS_Store"];

/** Host ids supported by the installer — exactly the shared matrix. */
export function supportedHosts() {
  return listAgents();
}

/** Map a CLI host argument (alias or id) onto a matrix id. */
export function resolveHostId(host) {
  const id = HOST_ALIASES[host] ?? host;
  return getAgent(id).id;
}

/** Expand `~` and `$DSH_HOME` in a matrix path template. */
export function expandTargetPath(template, { home = homedir(), env = process.env } = {}) {
  let value = String(template);
  if (value.startsWith("$DSH_HOME")) {
    value = join(env.DSH_HOME || join(home, ".dsh"), value.slice("$DSH_HOME".length).replace(/^\//, ""));
  }
  if (value === "~") return home;
  if (value.startsWith("~/")) value = join(home, value.slice(2));
  return value;
}

/** Repo-level install target: `getAgent(id).globalPath`. */
export function repoInstallDir(host, options = {}) {
  return expandTargetPath(getAgent(resolveHostId(host)).globalPath, options);
}

/** Documented project-local target, or null when the host defines none. */
export function repoProjectDir(host, options = {}) {
  const projectPath = getAgent(resolveHostId(host)).projectPath;
  return projectPath ? expandTargetPath(projectPath, options) : null;
}

/**
 * Root that holds generated person skills (`<character>-<slug>/SKILL.md`).
 * Derived from the matrix so the two lists can never drift.
 */
export function generatedSkillsRoot(host, options = {}) {
  const id = resolveHostId(host);
  const override = GENERATED_ROOT_OVERRIDES[id];
  if (override) return expandTargetPath(override, options);
  return dirname(repoInstallDir(id, options));
}

/** Python-compatible name for the generated-skill root (install_generated_skill.py). */
export const defaultSkillsDir = generatedSkillsRoot;

/** Refuse filesystem roots, the home directory and paths not named `distilly`. */
export function validateInstallTarget(inputPath, { home = homedir(), requireName = true } = {}) {
  const target = resolve(inputPath);
  const parsed = parse(target);
  if (target === parsed.root || target === resolve(home)) {
    throw new Error("refusing to install into a filesystem root or home directory");
  }
  if (requireName && basename(target) !== "distilly") {
    throw new Error("the install path must end with a directory named distilly");
  }
  return target;
}

function pathsOverlap(source, destination) {
  const sourceRoot = resolveRealPath(source);
  const destinationRoot = resolveRealPath(destination);
  if (sourceRoot === destinationRoot) return "same";
  const nested =
    destinationRoot.startsWith(`${sourceRoot}/`) || sourceRoot.startsWith(`${destinationRoot}/`);
  return nested ? "nested" : false;
}

function shouldIgnore(name) {
  return REPO_IGNORE.includes(name) || name.endsWith(".pyc");
}

/** Timestamped backup path used before replacing an existing install. */
export function backupPathFor(target) {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  return `${target}.backup-${stamp}`;
}

/**
 * Copy the Distilly repo into a host skill directory
 * (`install_openclaw_skill.py` / `install_codex_skill.py` / `install_hermes_skill.py`).
 */
export function installRepoSkill({
  source,
  destination,
  force = false,
  dryRun = false,
  backup = false,
}) {
  if (!existsSync(join(source, "SKILL.md"))) {
    throw new Error(`source does not look like a skill repo: ${source}`);
  }

  const overlap = pathsOverlap(source, destination);
  if (overlap === "same") return destination;
  if (overlap === "nested") throw new Error("source and destination must not overlap");

  if (dryRun) return destination;

  let backupPath = null;
  if (existsSync(destination)) {
    if (!force) throw new Error(`destination already exists: ${destination}`);
    if (backup) {
      backupPath = backupPathFor(destination);
      renameSync(destination, backupPath);
    } else {
      rmSync(destination, { recursive: true, force: true });
    }
  }

  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    filter: (sourcePath) => !shouldIgnore(basename(sourcePath)),
  });
  return { destination, backupPath };
}

/**
 * Remove an installed Distilly copy.
 * `--force` skips the "looks like a Distilly install" check; `--backup` keeps a
 * timestamped copy instead of deleting.
 */
export function uninstallRepoSkill({
  destination,
  force = false,
  dryRun = false,
  backup = false,
  home = homedir(),
} = {}) {
  const target = validateInstallTarget(destination, { home });
  if (!existsSync(target)) {
    throw new Error(`nothing installed at ${target}`);
  }

  const skillFile = join(target, "SKILL.md");
  if (!force) {
    if (!existsSync(skillFile)) {
      throw new Error(`${target} does not contain SKILL.md; rerun with --force to remove it anyway`);
    }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(skillFile, "utf8"));
    if (!frontmatter || !/^name:\s*distilly\s*$/m.test(frontmatter[1])) {
      throw new Error(`${target} is not a Distilly install; rerun with --force to remove it anyway`);
    }
  }

  if (dryRun) return { destination: target, backupPath: null, removed: false };

  if (backup) {
    const backupPath = backupPathFor(target);
    renameSync(target, backupPath);
    return { destination: target, backupPath, removed: true };
  }

  rmSync(target, { recursive: true, force: true });
  return { destination: target, backupPath: null, removed: true };
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Load and normalize generated skill metadata from a skill directory. */
export function loadGeneratedMeta(skillDir) {
  const metaPath = join(skillDir, "meta.json");
  if (!existsSync(metaPath)) {
    throw new Error(`generated skill is missing meta.json: ${skillDir}`);
  }
  return enrichExistingSkillMeta(JSON.parse(readFileSync(metaPath, "utf8")), skillDir);
}

/** Rewrite the frontmatter name field to the installed command name. */
export function rewriteFrontmatterName(markdown, newName) {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return markdown;

  const body = markdown.slice(match[0].length);
  const lines = match[1].split(/\r?\n/);
  const rewritten = [];
  let replaced = false;

  for (const line of lines) {
    if (line.startsWith("name:")) {
      rewritten.push(`name: ${newName}`);
      replaced = true;
    } else {
      rewritten.push(line);
    }
  }
  if (!replaced) rewritten.unshift(`name: ${newName}`);

  return `---\n${rewritten.join("\n")}\n---\n\n${body.replace(/^\n+/, "")}`;
}

/** Load a generated artifact and rewrite it for host installation. */
export function renderInstalledMarkdown(skillDir, artifactName, commandName) {
  const artifactPath = join(skillDir, artifactName);
  if (!existsSync(artifactPath)) {
    throw new Error(`generated artifact not found: ${artifactPath}`);
  }
  return rewriteFrontmatterName(readFileSync(artifactPath, "utf8"), commandName);
}

/** Persist installation metadata for later debugging and upgrades. */
export function writeInstallMetadata(installDir, payload) {
  writeFileSync(join(installDir, ".distilly-install.json"), jsonDumps(payload), "utf8");
}

/** Windows installs also get a slash-command shim (install_claude_generated_skill.py). */
export function shouldInstallCommandShim(systemName = process.platform) {
  const current = String(systemName).toLowerCase();
  return current.startsWith("win");
}

/**
 * Install a generated combined skill into a host skill directory
 * (`install_generated_skill_common.py`).
 */
/**
 * Directories a generated person Skill carries into a host install.
 *
 * The v2 layout puts the evidence *inside* the Skill so the host can read
 * `knowledge/text`, the ledger, the derived claims and the rendered page while
 * offline. Copying only `SKILL.md` (which is what this did) leaves every citation
 * dangling at the destination — the page opens but every anchor points at nothing.
 */
export const CARRIED_DIRECTORIES = ["knowledge/raw", "knowledge/text", "evidence", "views", "assets"];

export function installGeneratedSkill({
  skillDir,
  skillsDir,
  force = false,
  dryRun = false,
  host,
}) {
  const meta = loadGeneratedMeta(skillDir);
  const artifacts = meta.artifacts;
  const commandName = artifacts.combined_command;
  const installedMarkdown = renderInstalledMarkdown(
    skillDir,
    artifacts.combined_skill,
    commandName,
  );

  const installDir = join(skillsDir, commandName);
  const installFile = join(installDir, "SKILL.md");

  const overlap = pathsOverlap(skillDir, installDir);
  if (overlap) {
    throw new Error(
      `generated skill source and install destination must not overlap: ${skillDir} -> ${installDir}`,
    );
  }

  const installRecord = {
    host,
    command_name: commandName,
    character: meta.character,
    slug: meta.slug,
    version: meta.version,
    source_skill_dir: String(skillDir),
    source_artifact: artifacts.combined_skill,
    installed_at: nowIso(),
  };

  if (!dryRun) {
    if (existsSync(installDir)) {
      if (!force) throw new Error(`${host} skill already exists: ${installDir}`);
      rmSync(installDir, { recursive: true, force: true });
    }
    mkdirSync(installDir, { recursive: true });
    writeFileSync(installFile, installedMarkdown, "utf8");
    // Only directories that exist are copied, and the record lists what travelled,
    // so "the host has the evidence" is checkable rather than assumed.
    const carried = [];
    for (const relativePath of CARRIED_DIRECTORIES) {
      const source = join(skillDir, relativePath);
      if (!existsSync(source)) continue;
      cpSync(source, join(installDir, relativePath), { recursive: true });
      carried.push(relativePath);
    }
    const ledger = join(skillDir, "knowledge", "index.json");
    if (existsSync(ledger)) {
      mkdirSync(join(installDir, "knowledge"), { recursive: true });
      cpSync(ledger, join(installDir, "knowledge", "index.json"));
      carried.push("knowledge/index.json");
    }
    if (carried.length > 0) installRecord.carried = carried;
    writeInstallMetadata(installDir, installRecord);
  }

  return { host, command_name: commandName, skill_dir: installDir, skill_file: installFile };
}

/**
 * Claude Code variant: optional `~/.claude/commands/<command>.md` shim
 * (`install_claude_generated_skill.py`).
 */
export function installGeneratedSkillForClaude({
  skillDir,
  skillsDir,
  commandsDir = null,
  force = false,
  dryRun = false,
  installCommandShim = false,
}) {
  const result = installGeneratedSkill({ skillDir, skillsDir, force, dryRun, host: "claude-code" });
  const commandPath = commandsDir === null ? null : join(commandsDir, `${result.command_name}.md`);

  if (!dryRun && installCommandShim && commandPath !== null) {
    const meta = loadGeneratedMeta(skillDir);
    const installedMarkdown = renderInstalledMarkdown(
      skillDir,
      meta.artifacts.combined_skill,
      result.command_name,
    );
    mkdirSync(dirname(commandPath), { recursive: true });
    writeFileSync(commandPath, installedMarkdown, "utf8");
  }

  return {
    ...result,
    command_path: commandPath,
    command_shim_installed: Boolean(installCommandShim && commandPath !== null),
  };
}

/** Is a Distilly install present at this path? Used by `doctor`. */
export function inspectInstall(target) {
  const skillFile = join(target, "SKILL.md");
  if (!existsSync(target) || !existsSync(skillFile)) {
    return { installed: false, path: target, version: null, bytes: 0 };
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(skillFile, "utf8"));
  const version = frontmatter ? (/(?:^|\n)version:\s*"?([^"\n]+)"?/.exec(frontmatter[1])?.[1] ?? null) : null;
  return { installed: true, path: target, version, bytes: statSync(skillFile).size };
}
