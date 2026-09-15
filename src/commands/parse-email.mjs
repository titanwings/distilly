/**
 * `distilly parse-email` — EML/MBOX into `knowledge/` (CONTRACT §1).
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
import { parseEmail } from "../parse/email.mjs";

const help = {
  zh: [
    "用法 / Usage:",
    "  distilly parse-email <file.eml|file.mbox...> --person <slug> [--base-dir <dir>] [--source <label>] [--json]",
    "",
    "读取邮件导出：RFC 2047 头部、每段 charset、优先 text/plain 回退 HTML、mbox 的 `>From` 转义。",
    "附件只登记名字/类型/大小并进 warnings（不解析内容、不静默丢弃）；每封邮件是一个锚点单元。",
  ].join("\n"),
  en: [
    "Distilly parse-email — read .eml / .mbox into knowledge/.",
    "",
    "Handles RFC 2047 headers, per-part charsets, text/plain with an HTML fallback and mbox",
    "`>From` escaping. Attachments are named in warnings, never decoded and never dropped",
    "silently; each message becomes one anchored unit.",
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
  if (paths.length === 0) return { error: "parse-email needs at least one .eml or .mbox file" };
  return { options, paths };
}

register("parse-email", {
  summary: "读取 EML/MBOX / read .eml and .mbox into knowledge/",
  usage: "distilly parse-email <file...> --person <slug> [--base-dir <dir>] [--source <label>] [--json]",
  ...help,
  run({ argv, json, reporter }) {
    const parsed = parseArgs(argv);
    const fail = (message, code) => ({
      receipt: {
        command: "parse-email",
        person: null,
        ok: false,
        inputs: [],
        outputs: [],
        anchors: { total: 0, cited: 0 },
        warnings: [],
        unavailable: [],
        error: { code, message, remedy: "distilly parse-email --help" },
      },
      exitCode: 2,
    });
    if (parsed.error) return fail(parsed.error, "parse-email/usage");
    const { options, paths } = parsed;
    if (!options.person) return fail("--person is required", "parse-email/usage");

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
      if (!extension.endsWith(".eml") && !extension.endsWith(".mbox") && !extension.endsWith(".mbx")) {
        warnings.push(`${relative(process.cwd(), file)}: not an .eml/.mbox file`);
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
        const document = parseEmail(source, { source: options.source ?? "email" });
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
      command: "parse-email",
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
      reporter.line(`parse-email: ${accepted}/${paths.length} file(s) recorded, ${ledger.length} ledger entries`);
      for (const entry of entries) reporter.line(`  ${entry.id}${entry.appended ? "" : " (identical bytes already recorded)"}`);
      for (const warning of warnings) reporter.warn(`  warning: ${warning}`);
    }
    return { receipt, exitCode: ok ? 0 : 1 };
  },
});
