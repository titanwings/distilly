#!/usr/bin/env node
/**
 * Distilly entry point.
 *
 * Contract: `docs/v2/CONTRACT.md` §1 — this is the only user-facing entry. It
 * parses global flags, resolves a subcommand through the registry in
 * `src/commands/index.mjs`, prints a bilingual help screen, and always answers
 * with the receipt shape from §3 when `--json` is set.
 *
 * Adding a command: create `src/commands/<name>.mjs`, call `register(...)` from
 * it, and import that module below. See `docs/v2/NODE-CORE.md`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ArgError, wantsHelp } from "../src/cli/args.mjs";
import { isEntryPoint } from "../src/cli/entry.mjs";
import { CliError, createReceipt, createReporter } from "../src/cli/receipt.mjs";
// Importing the registry also registers every built-in command module.
import {
  lookup,
  missingCommandError,
  renderCommandHelp,
  renderHelp,
  resolveCommand,
} from "../src/commands/index.mjs";

export const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const packageMetadata = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const version = packageMetadata.version;
const binary = "distilly";

/**
 * Every path the published package must contain. `src/` and `assets/` are not
 * optional: this file imports `../src/cli/args.mjs` at startup and the viewer
 * template is read from `assets/`. Kept in sync with `package.json`'s `files`
 * by `validatePayload`, which refuses to pack when they disagree.
 */
export const payloadEntries = [
  "SKILL.md",
  "prompts",
  "references",
  "bin",
  "src",
  "assets",
  "scripts",
  "package.json",
  "INSTALL.md",
  "INSTALL_EN.md",
  "LICENSE",
  "CITATION.cff",
];

/** npm always includes these whatever `files` says, so they need no pattern. */
const ALWAYS_PACKED = new Set(["package.json", "README.md", "LICENSE", "LICENCE"]);

/**
 * Does at least one `files` pattern put `entry` into the tarball?
 *
 * npm's `files` accepts bare names (`SKILL.md`), directories (`src/`) and globs
 * (`prompts/**`); a directory pattern covers everything below it. Only the
 * shapes this manifest actually uses are supported — an unrecognised pattern is
 * reported as "does not cover", never silently treated as a match.
 */
function packs(entry, patterns) {
  if (ALWAYS_PACKED.has(entry)) return true;
  return patterns.some((raw) => {
    const pattern = String(raw).replace(/\/+$/, "");
    if (pattern === entry) return true;
    if (entry.startsWith(`${pattern}/`)) return true;
    if (!pattern.includes("*")) return false;
    const source = pattern
      .split("**")
      .map((part) =>
        part
          .split("*")
          .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
          .join("[^/]*"),
      )
      .join(".*");
    return new RegExp(`^${source}$`).test(entry);
  });
}

/**
 * Prepack guard: the published payload must be complete and version-consistent.
 *
 * This runs from `prepack`, so it must judge the tarball npm is about to build,
 * not the working tree. Checking only `root` is what let a broken package ship:
 * `files` still listed the Python-era `tools/` and `requirements.txt` and had
 * dropped `src/` and `assets/`, `--check-package` printed "payload is valid"
 * because the repo tree had everything, and the extracted tarball could not even
 * start. So the manifest is checked too.
 */
export function validatePayload(root = packageRoot) {
  const missing = payloadEntries.filter((entry) => !existsSync(join(root, entry)));
  if (missing.length > 0) {
    throw new CliError(`package payload is missing: ${missing.join(", ")}`, {
      code: "payload-incomplete",
      remedy: "restore the missing paths or update payloadEntries in bin/distilly.mjs.",
    });
  }

  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const patterns = Array.isArray(manifest.files) ? manifest.files : [];
  if (patterns.length === 0) {
    throw new CliError("package.json declares no `files`, so the tarball would be unpredictable", {
      code: "payload-manifest",
      remedy: "add a `files` array listing bin/, src/, assets/, scripts/ and the documents.",
    });
  }

  const absent = patterns
    .map((raw) => String(raw).replace(/\/+$/, ""))
    .filter((pattern) => !existsSync(join(root, pattern)));
  if (absent.length > 0) {
    throw new CliError(`package.json \`files\` names paths that do not exist: ${absent.join(", ")}`, {
      code: "payload-manifest",
      remedy: "remove the stale entries (or restore the paths) so the manifest describes this tree.",
    });
  }

  const omitted = payloadEntries.filter((entry) => !packs(entry, patterns));
  if (omitted.length > 0) {
    throw new CliError(`package.json \`files\` would omit required paths: ${omitted.join(", ")}`, {
      code: "payload-incomplete",
      remedy: `add ${omitted.map((entry) => `"${entry}/"`).join(", ")} to \`files\`; the package cannot run without them.`,
    });
  }

  const skill = readFileSync(join(root, "SKILL.md"), "utf8");
  if (!skill.includes(`version: "${version}"`)) {
    throw new CliError("package.json version does not match SKILL.md", {
      code: "version-mismatch",
      remedy: `set SKILL.md frontmatter version to "${version}" (or bump package.json).`,
    });
  }
}

function failureReceipt(command, error) {
  return createReceipt(command, {
    ok: false,
    error: {
      code: error.code ?? "error",
      message: error.message,
      ...(error.remedy ? { remedy: error.remedy } : {}),
    },
    warnings: [error.message],
  });
}

async function main(argv) {
  // `--json` is global (CONTRACT §1): every subcommand answers with a receipt.
  const json = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");
  const reporter = createReporter(json);

  if (args.includes("--check-package")) {
    validatePayload();
    // A validation diagnostic, not command output: `prepack` shares stdout with
    // `npm pack --json`, which must stay parseable.
    process.stderr.write("Distilly package payload is valid.\n");
    return 0;
  }

  // Global flags only count before a command name: `skill version rollback
  // --version v1` must reach the version manager, not print the CLI version.
  if (args[0] === "--version") {
    reporter.line(version);
    return 0;
  }

  const { name, rest } = resolveCommand(args);
  const command = lookup(name);

  if (args.length === 0 || args[0] === "help" || (wantsHelp(args) && !command)) {
    process.stdout.write(renderHelp({ version, binary }));
    return 0;
  }

  if (command === null) {
    throw missingCommandError(name);
  }

  if (wantsHelp(args)) {
    process.stdout.write(`${renderCommandHelp(command, { binary })}\n`);
    return 0;
  }

  const result = (await command.run({
    argv: rest,
    json,
    reporter,
    ctx: { packageRoot, version, binary },
  })) ?? {};

  const receipt = result.receipt ?? createReceipt(command.name);
  reporter.finish(receipt);
  if (result.exitCode !== undefined) return result.exitCode;
  return receipt.ok === false ? 1 : 0;
}

// Dispatch only when this file is the process entry point. Importing it (tests do,
// to reach `validatePayload` and `payloadEntries`) must not run a command with the
// importer's argv. `isEntryPoint` resolves symlinks, so this still fires when the
// CLI is reached through an npm `bin` shim or any other symlinked path.
if (isEntryPoint(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    const json = process.argv.includes("--json");
    const command = process.argv.slice(2).find((arg) => !arg.startsWith("-")) ?? null;
    const reporter = createReporter(json);
    const failure =
      error instanceof CliError || error instanceof ArgError
        ? error
        : new CliError(error?.message ?? String(error), { code: "unexpected" });

    reporter.warn(`Error: ${failure.message}`);
    if (failure.remedy) reporter.warn(`Remedy: ${failure.remedy}`);
    reporter.finish(failureReceipt(command, failure));
    process.exitCode = failure.exitCode ?? 1;
  }
}
