/**
 * `distilly parse-archive` — OOXML (docx·xlsx) into `knowledge/` (CONTRACT §1).
 *
 * Same receipt and ledger discipline as `harvest`; the only difference is that it
 * only accepts email files and refuses anything else by name.
 */

import { readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { register } from "./index.mjs";
import { KnowledgeStore, sha256Hex } from "../knowledge/store.mjs";
import { ledgerStats, loadLedger, recordDocument, saveLedger } from "../knowledge/ledger.mjs";
import { SourceFile } from "../parse/common.mjs";
import { parseArchive } from "../parse/archive.mjs";

const help = {
  zh: [
    "用法 / Usage:",
    "  distilly parse-archive <archive.zip|dir...> --person <slug> [--base-dir <dir>] [--source <label>] [--json]",
    "",
    "读取归档：X 官方归档（tweets / direct-messages / like 三类 .js）、Google Takeout（.mbox）、",
    "Discord/Telegram/Instagram 导出（.json）、LinkedIn（.csv）、字幕与 OOXML 成员。",
    "不认识的成员逐条进 warnings；解压好的目录同样可以（此时 raw 里存的是成员清单）。",
  ].join("\n"),
  en: [
    "Distilly parse-archive — read an X export, a Takeout dump, a Discord/Telegram export",
    "or an unpacked directory into knowledge/.",
    "",
    "Members it recognises are routed to the chat/email/subtitle/OOXML readers; anything",
    "unrecognised is listed in warnings by name. For a directory the raw payload kept under",
    "knowledge/raw is the member manifest rather than a container file.",
  ].join("\n"),
};

function parseArgs(argv) {
  const options = { person: null, baseDir: process.cwd(), source: null, json: false, fetchedAt: null };
  const paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (["--person", "--base-dir", "--source", "--fetched-at"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) return { error: `${arg} requires a value` };
      options[{ "--person": "person", "--base-dir": "baseDir", "--source": "source", "--fetched-at": "fetchedAt" }[arg]] = value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else paths.push(arg);
  }
  if (paths.length === 0) return { error: "parse-archive needs at least one archive (.zip) or directory" };
  return { options, paths };
}

register("parse-archive", {
  summary: "读取 docx/xlsx / read OOXML documents into knowledge/",
  usage: "distilly parse-archive <file...> --person <slug> [--base-dir <dir>] [--source <label>] [--json]",
  ...help,
  run({ argv, json, reporter }) {
    const parsed = parseArgs(argv);
    const fail = (message, code) => ({
      receipt: {
        command: "parse-archive",
        person: null,
        ok: false,
        inputs: [],
        outputs: [],
        anchors: { total: 0, cited: 0 },
        warnings: [],
        unavailable: [],
        error: { code, message, remedy: "distilly parse-archive --help" },
      },
      exitCode: 2,
    });
    if (parsed.error) return fail(parsed.error, "parse-archive/usage");
    const { options, paths } = parsed;
    if (!options.person) return fail("--person is required", "parse-archive/usage");

    const personDir = resolve(options.baseDir, "skills", "colleague", options.person);
    const store = new KnowledgeStore(personDir);
    const ledger = loadLedger(store);
    const inputs = [];
    const entries = [];
    const warnings = [];
    let accepted = 0;

    for (const target of paths) {
      const file = resolve(target);
      const extension = file.toLowerCase();
      let isDirectory = false;
      try {
        isDirectory = statSync(file).isDirectory();
      } catch (error) {
        warnings.push(`${relative(process.cwd(), file)}: cannot read (${error.message})`);
        continue;
      }
      if (!isDirectory && !extension.endsWith(".zip")) {
        warnings.push(`${relative(process.cwd(), file)}: not an archive (.zip) or directory`);
        continue;
      }
      let source;
      try {
        source = isDirectory ? null : new SourceFile({ path: file, raw: readFileSync(file) });
      } catch (error) {
        warnings.push(`${relative(process.cwd(), file)}: cannot read (${error.message})`);
        continue;
      }
      inputs.push({
        path: relative(process.cwd(), file),
        sha256: source ? sha256Hex(source.raw) : sha256Hex(Buffer.from(file)),
        bytes: source ? source.raw.length : 0,
        kind: isDirectory ? "directory" : "zip",
      });
      try {
        // An archive is never one document: an X export holds tweets *and* DMs,
        // a Takeout holds mail *and* chats. Each sub-source is recorded as its
        // own ledger entry, so a later re-run can tell which one changed.
        const label = options.source ?? "archive";
        const parsed = parseArchive(isDirectory ? file : source.raw, { source: label });
        const fetchedAt = options.fetchedAt ?? statSync(file).mtime.toISOString();
        for (const document of parsed.documents ?? []) {
          const recorded = recordDocument(
            store,
            ledger,
            { ...document, source: label, fetched_at: fetchedAt },
            { fetched_at: fetchedAt },
          );
          accepted += 1;
          entries.push({ id: recorded.id, appended: recorded.appended, reason: recorded.reason ?? null });
        }
        for (const warning of parsed.warnings ?? []) {
          warnings.push(`${relative(process.cwd(), file)}: ${warning.message ?? warning}`);
        }
      } catch (error) {
        warnings.push(`${relative(process.cwd(), file)}: ${error.message}`);
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
      command: "parse-archive",
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
      reporter.line(`parse-archive: ${accepted}/${paths.length} file(s) recorded, ${ledger.length} ledger entries`);
      for (const entry of entries) reporter.line(`  ${entry.id}${entry.appended ? "" : " (identical bytes already recorded)"}`);
      for (const warning of warnings) reporter.warn(`  warning: ${warning}`);
    }
    return { receipt, exitCode: ok ? 0 : 1 };
  },
});
