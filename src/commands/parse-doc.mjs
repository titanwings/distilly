/**
 * `distilly parse-doc` — OOXML (docx·xlsx) into `knowledge/` (CONTRACT §1).
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
import { parseOffice } from "../parse/office.mjs";

const help = {
  zh: [
    "用法 / Usage:",
    "  distilly parse-doc <file.docx|file.xlsx...> --person <slug> [--base-dir <dir>] [--source <label>] [--json]",
    "",
    "读取 OOXML：docx 按段落、xlsx 按行（`列=值`，共享字符串表会解析）。",
    "样式/批注/图表等不含可提取文本的部分只登记进 warnings，不静默丢弃；每段/每行是一个锚点单元。",
  ].join("\n"),
  en: [
    "Distilly parse-doc — read .docx / .xlsx into knowledge/.",
    "",
    "Word paragraphs and spreadsheet rows (`column=value`, shared strings resolved) are",
    "extracted with zero dependencies; parts that carry no text are reported in warnings,",
    "never dropped silently, and every paragraph or row becomes an anchored unit.",
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
  if (paths.length === 0) return { error: "parse-doc needs at least one .docx or .xlsx file" };
  return { options, paths };
}

register("parse-doc", {
  summary: "读取 docx/xlsx / read OOXML documents into knowledge/",
  usage: "distilly parse-doc <file...> --person <slug> [--base-dir <dir>] [--source <label>] [--json]",
  ...help,
  run({ argv, json, reporter }) {
    const parsed = parseArgs(argv);
    const fail = (message, code) => ({
      receipt: {
        command: "parse-doc",
        person: null,
        ok: false,
        inputs: [],
        outputs: [],
        anchors: { total: 0, cited: 0 },
        warnings: [],
        unavailable: [],
        error: { code, message, remedy: "distilly parse-doc --help" },
      },
      exitCode: 2,
    });
    if (parsed.error) return fail(parsed.error, "parse-doc/usage");
    const { options, paths } = parsed;
    if (!options.person) return fail("--person is required", "parse-doc/usage");

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
      if (!extension.endsWith(".docx") && !extension.endsWith(".xlsx")) {
        warnings.push(`${relative(process.cwd(), file)}: not an OOXML document (.docx/.xlsx)`);
        continue;
      }
      let source;
      try {
        source = new SourceFile({ path: file, raw: readFileSync(file) });
      } catch (error) {
        warnings.push(`${relative(process.cwd(), file)}: cannot read (${error.message})`);
        continue;
      }
      inputs.push({ path: relative(process.cwd(), file), sha256: sha256Hex(source.raw), bytes: source.raw.length });
      try {
        const document = parseOffice(source, { source: options.source ?? "documents" });
        const fetchedAt = options.fetchedAt ?? statSync(file).mtime.toISOString();
        const recorded = recordDocument(store, ledger, { ...document, fetched_at: fetchedAt }, { fetched_at: fetchedAt });
        accepted += 1;
        for (const warning of document.warnings ?? []) {
          warnings.push(`${relative(process.cwd(), file)}: ${warning.message ?? warning}`);
        }
        entries.push({ id: recorded.id, appended: recorded.appended, reason: recorded.reason ?? null });
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
      command: "parse-doc",
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
      reporter.line(`parse-doc: ${accepted}/${paths.length} file(s) recorded, ${ledger.length} ledger entries`);
      for (const entry of entries) reporter.line(`  ${entry.id}${entry.appended ? "" : " (identical bytes already recorded)"}`);
      for (const warning of warnings) reporter.warn(`  warning: ${warning}`);
    }
    return { receipt, exitCode: ok ? 0 : 1 };
  },
});
