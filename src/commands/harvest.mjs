/**
 * `distilly harvest` — zero-credential intake: files in, `knowledge/` out.
 *
 * This is the glue ds/02 could not finish before its session ended: it walks the
 * given paths, picks a parser by extension, and records every document through
 * the shared ledger (raw bytes + anchored text + append-only index).
 *
 * Honest by construction: an unsupported or unreadable file is reported in
 * `warnings` and in the receipt, never skipped silently, and a re-import of
 * identical bytes appends nothing (the ledger dedupes by sha256).
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import { register } from "./index.mjs";
import { KnowledgeStore, sha256Hex } from "../knowledge/store.mjs";
import { loadLedger, recordDocument, saveLedger, ledgerStats } from "../knowledge/ledger.mjs";
import { IDENTITY_FILE, applyIdentity, loadIdentity } from "../knowledge/identity.mjs";
import { SourceFile, buildDocument, recordsFromCharSpans } from "../parse/common.mjs";
import { parseSubtitle } from "../parse/subtitle.mjs";
import { parseChat } from "../parse/chat.mjs";
import { detectFeishuFormat, parseFeishu } from "../parse/feishu.mjs";

const SUBTITLE_EXTENSIONS = new Set([".srt", ".vtt"]);
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".text"]);
const CHAT_EXTENSIONS = new Set([".json"]);

const help = {
  zh: [
    "用法 / Usage:",
    "  distilly harvest <dir|file...> --person <slug> [--base-dir <dir>] [--source <label>] [--json]",
    "",
    "选项 / Options:",
    "  --person <slug>   写入哪个 Skill（默认目录 skills/colleague/<slug>）",
    "  --base-dir <dir>  指定 skills 根目录（默认当前目录）",
    "  --source <label>  覆盖账本里的来源标签（默认取输入文件所在目录名）",
    "  --json            输出 JSON 回执",
    "",
    "零凭据：只读本地文件。不支持的格式逐条进 warnings，不静默跳过；",
    "同样的字节重复导入不会重复记账（按 sha256 去重）。",
  ].join("\n"),
  en: [
    "Distilly harvest — zero-credential intake: local files into knowledge/.",
    "",
    "Unsupported or unreadable inputs are reported in warnings, never skipped",
    "silently, and identical bytes are recorded once (the ledger dedupes by sha256).",
  ].join("\n"),
};

function parseHarvestArgs(argv) {
  const options = { person: null, baseDir: process.cwd(), source: null, json: false, fetchedAt: null, identity: null };
  const paths = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (["--person", "--base-dir", "--source", "--fetched-at", "--identity"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) return { error: `${arg} requires a value` };
      const key = { "--person": "person", "--base-dir": "baseDir", "--source": "source", "--fetched-at": "fetchedAt", "--identity": "identity" }[arg];
      options[key] = value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else paths.push(arg);
  }
  if (paths.length === 0) return { error: "harvest needs at least one <dir|file>" };
  return { options, paths };
}

function walk(target, out = []) {
  const stats = statSync(target);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      walk(join(target, entry.name), out);
    }
    return out;
  }
  if (stats.isFile()) out.push(target);
  return out;
}

/** One document per input file, or a warning explaining why not. */
function documentFor(path, sourceLabel, identity = null) {
  const raw = readFileSync(path);
  const file = new SourceFile({ path, raw });
  const extension = extname(path).toLowerCase();
  const source = sourceLabel ?? basename(resolve(path, ".."));
  const common = { source, files: [file], identity };

  if (SUBTITLE_EXTENSIONS.has(extension)) {
    return { document: parseSubtitle(file, { ...common, method: "local-file" }) };
  }
  if (CHAT_EXTENSIONS.has(extension)) {
    // A Feishu page export is JSON too; ask the Feishu detector before parseChat,
    // which refuses anything it does not recognise by name.
    // `detectFeishuFormat` answers "not Feishu" with `{format: null, reasons}` —
    // a non-null *object*. Testing the object for null sent every JSON export to
    // the Feishu parser, which then refused it by name: a Slack
    // `messages.json` failed with "not a Feishu export" instead of being read as
    // Slack. The verdict is `format`, not the wrapper.
    let feishu = null;
    try {
      feishu = detectFeishuFormat(file);
    } catch {
      feishu = null;
    }
    if (feishu?.format) {
      return { document: parseFeishu(file, { ...common, method: "user-export" }) };
    }
    // A Slack export keeps its display names in a sibling `users.json`; without it
    // the normalised text keeps raw ids and the derivation counts them as people.
    const sibling = join(dirname(path), "users.json");
    // `readSlackUsers` takes the raw text (it does its own JSON.parse and reports
    // malformed input as a warning rather than throwing).
    const users = existsSync(sibling) ? readFileSync(sibling, "utf8") : undefined;
    return { document: parseChat(file, { ...common, method: "user-export", ...(users === undefined ? {} : { users }) }) };
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    const text = raw.toString("utf8");
    const spans = [];
    const pattern = /[^\n]+/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      spans.push({ text: match[0], charStart: match.index, charEnd: match.index + match[0].length, kind: "paragraph" });
    }
    const records = recordsFromCharSpans(file, spans);
    return {
      document: buildDocument({
        parser: "text",
        format: extension.slice(1),
        kind: "doc",
        method: "local-file",
        ...common,
        records,
      }),
    };
  }
  return { warning: `unsupported file type ${extension || "(none)"}: ${relative(process.cwd(), path)}` };
}

register("harvest", {
  summary: "零凭据采集：本地文件 → knowledge/ / zero-credential intake",
  usage: "distilly harvest <dir|file...> --person <slug> [--base-dir <dir>] [--source <label>] [--identity <map.json>] [--json]",
  ...help,
  run({ argv, json, reporter }) {
    const parsed = parseHarvestArgs(argv);
    if (parsed.error) {
      return {
        receipt: { command: "harvest", person: null, ok: false, inputs: [], outputs: [], anchors: { total: 0, cited: 0 }, warnings: [], unavailable: [], error: { code: "harvest/usage", message: parsed.error, remedy: "distilly harvest --help" } },
        exitCode: 2,
      };
    }
    const { options, paths } = parsed;
    if (!options.person) {
      return {
        receipt: { command: "harvest", person: null, ok: false, inputs: [], outputs: [], anchors: { total: 0, cited: 0 }, warnings: [], unavailable: [], error: { code: "harvest/usage", message: "--person is required", remedy: "distilly harvest --help" } },
        exitCode: 2,
      };
    }

    const personDir = join(resolve(options.baseDir), "skills", "colleague", options.person);
    const store = new KnowledgeStore(personDir);
    const ledger = loadLedger(store);
    // The map travels with the Skill: `harvest --identity <file>` installs a copy as
    // `identity.json` so later imports (and the derivation) see the same mapping.
    let identityPath = null;
    if (options.identity) {
      const source = resolve(options.identity);
      if (!existsSync(source)) {
        return {
          receipt: { command: "harvest", person: options.person, ok: false, inputs: [], outputs: [], anchors: { total: 0, cited: 0 }, warnings: [], unavailable: [], error: { code: "harvest/identity", message: `--identity file not found: ${options.identity}`, remedy: "pass a JSON map with a \"people\" array" } },
          exitCode: 2,
        };
      }
      mkdirSync(personDir, { recursive: true });
      copyFileSync(source, join(personDir, IDENTITY_FILE));
      identityPath = join(personDir, IDENTITY_FILE);
    }
    let identity = { path: null, map: new Map(), people: [], warnings: [] };
    try {
      identity = loadIdentity(personDir, identityPath ? { path: identityPath } : {});
    } catch (error) {
      return {
        receipt: { command: "harvest", person: options.person, ok: false, inputs: [], outputs: [], anchors: { total: 0, cited: 0 }, warnings: [], unavailable: [], error: { code: "harvest/identity", message: error.message, remedy: "fix identity.json; a handle may only belong to one person" } },
        exitCode: 2,
      };
    }
    for (const warning of identity.warnings ?? []) warnings.push(warning);

    const warnings = [];
    const inputs = [];
    const entries = [];
    const files = [];

    for (const target of paths) {
      let found;
      try {
        found = walk(resolve(target));
      } catch (error) {
        warnings.push(`cannot read ${target}: ${error.message}`);
        continue;
      }
      if (found.length === 0) warnings.push(`no files under ${relative(process.cwd(), resolve(target))}`);
      files.push(...found);
    }

    for (const file of files) {
      const raw = readFileSync(file);
      inputs.push({ path: relative(process.cwd(), file), sha256: sha256Hex(raw), bytes: raw.length });
      let built;
      try {
        built = documentFor(file, options.source, identity);
      } catch (error) {
        warnings.push(`${relative(process.cwd(), file)}: ${error.message}`);
        continue;
      }
      if (built.warning) {
        warnings.push(built.warning);
        continue;
      }
      const fetchedAt = options.fetchedAt ?? statSync(file).mtime.toISOString();
      const recorded = recordDocument(store, ledger, { ...built.document, fetched_at: fetchedAt }, { fetched_at: fetchedAt });
      for (const warning of built.document.warnings ?? []) warnings.push(`${relative(process.cwd(), file)}: ${warning.message ?? warning}`);
      entries.push({ id: recorded.id, source: built.document.source, appended: recorded.appended, reason: recorded.reason ?? null });
    }

    saveLedger(store, ledger);
    const stats = ledgerStats(ledger);
    const outputs = [
      { path: relative(process.cwd(), store.ledgerPath), sha256: sha256Hex(readFileSync(store.ledgerPath)), bytes: statSync(store.ledgerPath).size },
    ];

    const receipt = {
      command: "harvest",
      person: options.person,
      ok: warnings.filter((warning) => warning.startsWith("unsupported")).length === 0,
      inputs,
      outputs,
      anchors: { total: stats.anchors ?? stats.anchorCount ?? 0, cited: 0 },
      entries,
      warnings,
      unavailable: [],
    };
    if (!json) {
      reporter.line(`harvest: ${entries.filter((entry) => entry.appended).length}/${files.length} recorded, ${ledger.length} ledger entries`);
      for (const entry of entries) reporter.line(`  ${entry.id} ${entry.source}${entry.appended ? "" : " (identical bytes already recorded)"}`);
      for (const warning of warnings) reporter.warn(`  warning: ${warning}`);
    }
    return { receipt, exitCode: receipt.ok ? 0 : 1 };
  },
});
