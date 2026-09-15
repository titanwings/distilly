#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const packageMetadata = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);

const payloadEntries = [
  "SKILL.md",
  "prompts",
  "references",
  "tools",
  "requirements.txt",
  "INSTALL.md",
  "INSTALL_EN.md",
  "LICENSE",
  "CITATION.cff",
];

const hosts = {
  "claude-code": () => join(homedir(), ".claude", "skills", "distilly"),
  openclaw: () =>
    join(homedir(), ".openclaw", "workspace", "skills", "distilly"),
  hermes: () =>
    join(homedir(), ".hermes", "skills", "openclaw-imports", "distilly"),
  codex: () => join(homedir(), ".agents", "skills", "distilly"),
  "deepseek-harness": () =>
    join(process.env.DSH_HOME || join(homedir(), ".dsh"), "skills", "distilly"),
  pi: () => join(homedir(), ".pi", "agent", "skills", "distilly"),
  "grok-build": () => join(homedir(), ".grok", "skills", "distilly"),
  opencode: () =>
    join(homedir(), ".config", "opencode", "skills", "distilly"),
};

const aliases = {
  claude: "claude-code",
  deepseek: "deepseek-harness",
  grok: "grok-build",
};

function printHelp() {
  console.log(`Distilly ${packageMetadata.version}

Install the Distilly creator Skill into a supported agent host.

Usage:
  distilly install <host> [--force]
  distilly install --path <path-ending-in-distilly> [--force]

Hosts:
  claude-code, openclaw, hermes, codex, deepseek-harness,
  pi, grok-build, opencode

Options:
  --force    Preserve an existing install as a timestamped backup, then install
  --path     Install to a custom path whose final directory is named distilly
  --version  Print the package version
  --help     Show this help
`);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function validatePayload() {
  const missing = payloadEntries.filter(
    (entry) => !existsSync(join(packageRoot, entry)),
  );
  if (missing.length > 0) {
    fail(`package payload is missing: ${missing.join(", ")}`);
  }

  const skill = readFileSync(join(packageRoot, "SKILL.md"), "utf8");
  if (!skill.includes(`version: "${packageMetadata.version}"`)) {
    fail("package.json version does not match SKILL.md");
  }
}

function expandHome(inputPath) {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/")) return join(homedir(), inputPath.slice(2));
  return inputPath;
}

function validateTarget(inputPath) {
  const target = resolve(expandHome(inputPath));
  const parsed = parse(target);
  if (target === parsed.root || target === resolve(homedir())) {
    fail("refusing to install into a filesystem root or home directory");
  }
  if (basename(target) !== "distilly") {
    fail("the install path must end with a directory named distilly");
  }
  return target;
}

function parseInstallArgs(args) {
  let host;
  let customPath;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
    } else if (arg === "--path") {
      customPath = args[index + 1];
      if (!customPath) fail("--path requires a value");
      index += 1;
    } else if (arg.startsWith("--")) {
      fail(`unknown option: ${arg}`);
    } else if (!host) {
      host = aliases[arg] || arg;
    } else {
      fail(`unexpected argument: ${arg}`);
    }
  }

  if (customPath) return { target: validateTarget(customPath), force };
  if (!host) fail("choose a host or pass --path");
  if (!hosts[host]) fail(`unsupported host: ${host}`);
  return { target: validateTarget(hosts[host]()), force };
}

function timestamp() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function install(target, force) {
  validatePayload();

  if (existsSync(target) && !force) {
    fail(`${target} already exists; rerun with --force to preserve and replace it`);
  }

  const parent = dirname(target);
  const staging = join(parent, `.distilly-install-${process.pid}`);
  let backup;

  mkdirSync(parent, { recursive: true });
  if (existsSync(staging)) {
    fail(`temporary install path already exists: ${staging}`);
  }

  try {
    mkdirSync(staging);
    for (const entry of payloadEntries) {
      cpSync(join(packageRoot, entry), join(staging, entry), {
        recursive: true,
        preserveTimestamps: true,
      });
    }

    if (!existsSync(join(staging, "SKILL.md"))) {
      throw new Error("staged install does not contain SKILL.md");
    }

    if (existsSync(target)) {
      backup = `${target}.backup-${timestamp()}`;
      renameSync(target, backup);
    }
    renameSync(staging, target);
  } catch (error) {
    if (existsSync(staging)) {
      rmSync(staging, { recursive: true, force: true });
    }
    if (backup && !existsSync(target) && existsSync(backup)) {
      renameSync(backup, target);
    }
    throw error;
  }

  console.log(`Distilly ${packageMetadata.version} installed at ${target}`);
  if (backup) console.log(`Previous install preserved at ${backup}`);
}

const args = process.argv.slice(2);
if (args.includes("--check-package")) {
  validatePayload();
  console.log("Distilly package payload is valid.");
} else if (args.includes("--version")) {
  console.log(packageMetadata.version);
} else if (args.length === 0 || args.includes("--help") || args[0] === "help") {
  printHelp();
} else if (args[0] === "install") {
  const { target, force } = parseInstallArgs(args.slice(1));
  install(target, force);
} else {
  fail(`unknown command: ${args[0]}`);
}

