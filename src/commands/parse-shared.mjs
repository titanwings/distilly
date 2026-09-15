/**
 * Shared plumbing for the `parse-*` commands (CONTRACT §1).
 *
 * Every parser command does the same five things: check the extensions it owns,
 * refuse anything else by name, parse into a document, record it in the ledger,
 * and emit one receipt. Only the accepted extensions and the parser differ, so
 * those are the two arguments; the receipt shape and the failure paths live here
 * once, which is what keeps `--json` identical across the family.
 */

import { readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { KnowledgeStore, sha256Hex } from "../knowledge/store.mjs";
import { ledgerStats, loadLedger, recordDocument, saveLedger } from "../knowledge/ledger.mjs";
import { SourceFile } from "../parse/common.mjs";

/** `--person/--base-dir/--source/--fetched-at/--users/--format/--json` plus positional paths. */
export function parseCommonArgs(argv) {
  const options = { person: null, baseDir: process.cwd(), source: null, json: false, fetchedAt: null, users: null, format: null };
  const paths = [];
  const takesValue = {
    "--person": "person",
    "--base-dir": "baseDir",
    "--source": "source",
    "--fetched-at": "fetchedAt",
    "--users": "users",
    // A channel log or a bare `.txt` has no self-describing shape; the caller
    // declares it (`--format feishu-text`) instead of the parser guessing.
    "--format": "format",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (takesValue[arg]) {
      const value = argv[index + 1];
      if (!value) return { error: `${arg} requires a value` };
      options[takesValue[arg]] = value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else paths.push(arg);
  }
  if (paths.length === 0) return { error: "at least one input file is required" };
  return { options, paths };
}

/** A usage or refusal receipt: same shape as a success, `ok: false`, exit 2. */
export function parseFailure(command, message, code) {
  return {
    receipt: {
      command,
      person: null,
      ok: false,
      inputs: [],
      outputs: [],
      anchors: { total: 0, cited: 0 },
      warnings: [],
      unavailable: [],
      error: { code, message, remedy: `distilly ${command} --help` },
    },
    exitCode: 2,
  };
}

/**
 * @param {{command: string, options: object, paths: string[], json: boolean,
 *          reporter: object, kind: string, defaultSource: string,
 *          accept: (path: string, extension: string) => true|string,
 *          parser: (file: object, context: object) => object}} input
 */
export function runParseCommand(input) {
  const { command, options, paths, json, reporter, accept, parser } = input;
  if (!options.person) return parseFailure(command, "--person is required", `${command}/usage`);

  const personDir = resolve(options.baseDir, "skills", "colleague", options.person);
  const store = new KnowledgeStore(personDir);
  const ledger = loadLedger(store);
  const inputs = [];
  const entries = [];
  const warnings = [];
  let accepted = 0;

  for (const target of paths) {
    const file = resolve(target);
    const shown = relative(process.cwd(), file);
    const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
    const verdict = accept(file, extension);
    if (verdict !== true) {
      warnings.push(typeof verdict === "string" ? verdict : `${shown}: unsupported file type`);
      continue;
    }
    let source;
    try {
      source = new SourceFile({ path: file, raw: readFileSync(file) });
    } catch (error) {
      warnings.push(`${shown}: cannot read (${error.message})`);
      continue;
    }
    inputs.push({ path: shown, sha256: sha256Hex(source.raw), bytes: source.raw.length });
    try {
      const document = parser(source, { file, options });
      const fetchedAt = options.fetchedAt ?? statSync(file).mtime.toISOString();
      const recorded = recordDocument(store, ledger, { ...document, fetched_at: fetchedAt }, { fetched_at: fetchedAt });
      accepted += 1;
      for (const warning of document.warnings ?? []) warnings.push(`${shown}: ${warning.message ?? warning}`);
      entries.push({ id: recorded.id, appended: recorded.appended, reason: recorded.reason ?? null });
    } catch (error) {
      warnings.push(`${shown}: ${error.message}`);
    }
  }

  saveLedger(store, ledger);
  const stats = ledgerStats(ledger);
  const outputs = [
    {
      path: relative(process.cwd(), store.ledgerPath),
      sha256: sha256Hex(readFileSync(store.ledgerPath)),
      bytes: statSync(store.ledgerPath).size,
    },
  ];
  const ok = accepted > 0;
  const receipt = {
    command,
    person: options.person,
    ok,
    inputs,
    outputs,
    anchors: { total: stats.anchors ?? 0, cited: 0 },
    entries,
    warnings,
    unavailable: [],
  };
  if (!json) {
    reporter.line(`${command}: ${accepted}/${paths.length} file(s) recorded, ${ledger.length} ledger entries`);
    for (const entry of entries) {
      reporter.line(`  ${entry.id}${entry.appended ? "" : " (identical bytes already recorded)"}`);
    }
    for (const warning of warnings) reporter.warn(`  warning: ${warning}`);
  }
  return { receipt, exitCode: ok ? 0 : 1 };
}
