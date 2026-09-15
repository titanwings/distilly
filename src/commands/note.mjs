/**
 * `distilly note` — register what the model itself read (CONTRACT §1).
 *
 * Some material never becomes a file the pipeline can parse: the host read a page,
 * a PDF, a screenshot or a chat window and understood it. `note --from <file|->`
 * is the honest door for that: the text the model produced is stored **verbatim**
 * as the raw payload, anchored into `knowledge/text/`, and marked
 * `method: "model-read"` so nothing downstream can mistake it for a first-hand
 * capture.
 *
 * The command deliberately does not pretend the note is evidence of the original
 * material: the receipt and the ledger entry both say the text is model-mediated,
 * and a warning states it in the same words every time. What it does guarantee is
 * the spine's usual contract — the bytes are stored as given, every paragraph gets
 * an anchor that resolves back to them, and reading the same note twice changes
 * nothing.
 */

import { readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

import { register } from "./index.mjs";
import { KnowledgeStore, sha256Hex } from "../knowledge/store.mjs";
import { ledgerStats, loadLedger, recordDocument, saveLedger } from "../knowledge/ledger.mjs";
import { SourceFile, buildDocument, recordsFromCharSpans } from "../parse/common.mjs";

const PROVENANCE_NOTE =
  "this text was written by a model that read the source material; it is model-mediated, not a first-hand capture";

const help = {
  zh: [
    "用法 / Usage:",
    "  distilly note --from <file|-> --person <slug> [--base-dir <dir>] [--source <label>] [--kind <note|doc>] [--json]",
    "",
    "把 LLM 自己读到的内容登记进账本：正文按原样入库（raw 逐字 + text 带锚点），",
    "条目 method 记为 `model-read`，回执与条目都注明这是模型转述、不是一手采集。",
    "`--from -` 从 stdin 读；空输入会被拒绝（不产生空条目）。",
  ].join("\n"),
  en: [
    "Distilly note — register what the model itself read into the ledger.",
    "",
    "The text you hand over is stored verbatim (raw bytes plus anchored text) and the",
    "entry is marked `method: \"model-read\"`, so nothing downstream mistakes a model's",
    "summary for a first-hand capture. `--from -` reads stdin; empty input is refused",
    "rather than recorded as an empty document.",
  ].join("\n"),
};

export function parseNoteArgs(argv) {
  const options = { from: null, person: null, baseDir: process.cwd(), source: null, kind: "note", json: false, fetchedAt: null };
  const keys = { "--from": "from", "--person": "person", "--base-dir": "baseDir", "--source": "source", "--kind": "kind", "--fetched-at": "fetchedAt" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (keys[arg]) {
      const value = argv[index + 1];
      if (value === undefined) return { error: `${arg} requires a value` };
      options[keys[arg]] = value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else if (!options.from) options.from = arg;
    else return { error: `unexpected argument: ${arg}` };
  }
  if (!options.from) return { error: "--from <file|-> is required" };
  if (!options.person) return { error: "--person is required" };
  if (!["note", "doc"].includes(options.kind)) return { error: "--kind must be note or doc" };
  return { options };
}

/**
 * Turn text into a note document: one paragraph per non-empty line, anchors
 * pointing at the bytes exactly as they were handed over.
 */
export function noteDocument({ text, name, source = "note", method = "model-read", kind = "note", origin }) {
  const file = new SourceFile({ path: name, name, raw: new Uint8Array(Buffer.from(text, "utf8")) });
  const spans = [];
  const pattern = /[^\n]+/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    spans.push({ text: match[0], charStart: match.index, charEnd: match.index + match[0].length, kind: "paragraph" });
  }
  return buildDocument({
    parser: "note",
    format: "text",
    kind,
    method,
    source,
    origin: origin ?? name,
    files: [file],
    records: recordsFromCharSpans(file, spans),
    warnings: [PROVENANCE_NOTE],
    meta: { model_read: true, provenance: PROVENANCE_NOTE },
  });
}

register("note", {
  summary: "登记 LLM 自己读到的内容 / register model-read material",
  usage: "distilly note --from <file|-> --person <slug> [--base-dir <dir>] [--source <label>] [--kind <note|doc>] [--json]",
  ...help,
  run({ argv, json, reporter }) {
    const fail = (message, code) => ({
      receipt: {
        command: "note",
        person: null,
        ok: false,
        inputs: [],
        outputs: [],
        anchors: { total: 0, cited: 0 },
        warnings: [],
        unavailable: [],
        error: { code, message, remedy: "distilly note --help" },
      },
      exitCode: 2,
    });
    const parsed = parseNoteArgs(argv);
    if (parsed.error) return fail(parsed.error, "note/usage");
    const { options } = parsed;

    let text;
    let name;
    if (options.from === "-") {
      try {
        text = readFileSync(0, "utf8");
      } catch (error) {
        return fail(`cannot read stdin: ${error.message}`, "note/stdin");
      }
      name = options.source ? `${options.source}.md` : "stdin.md";
    } else {
      const path = resolve(options.from);
      try {
        text = readFileSync(path, "utf8");
        statSync(path);
      } catch (error) {
        return fail(`cannot read ${options.from}: ${error.message}`, "note/input");
      }
      name = path.split("/").pop() ?? "note.md";
    }

    if (text.trim() === "") {
      return {
        receipt: {
          command: "note",
          person: options.person,
          ok: false,
          inputs: [],
          outputs: [],
          anchors: { total: 0, cited: 0 },
          warnings: [PROVENANCE_NOTE],
          unavailable: [],
          error: {
            code: "note/empty",
            message: `--from ${options.from} holds no text; an empty note is not recorded`,
            remedy: "write the material you read into the file (or pipe it to --from -), then rerun",
          },
        },
        exitCode: 1,
      };
    }

    const personDir = resolve(options.baseDir, "skills", "colleague", options.person);
    const store = new KnowledgeStore(personDir);
    const ledger = loadLedger(store);
    const fetchedAt = options.fetchedAt ?? statSync(options.from === "-" ? process.cwd() : resolve(options.from)).mtime.toISOString();
    const document = noteDocument({ text, name, source: options.source ?? "note", kind: options.kind, origin: options.from === "-" ? name : resolve(options.from) });

    let recorded;
    try {
      recorded = recordDocument(store, ledger, { ...document, fetched_at: fetchedAt }, { fetched_at: fetchedAt });
    } catch (error) {
      return { receipt: { command: "note", person: options.person, ok: false, inputs: [], outputs: [], anchors: { total: 0, cited: 0 }, warnings: [PROVENANCE_NOTE], unavailable: [], error: { code: "note/write", message: error.message, remedy: "check the base directory is writable" } }, exitCode: 1 };
    }
    saveLedger(store, ledger);
    const stats = ledgerStats(ledger);
    const raw = recorded.written.files[0];
    const textFile = recorded.written.text;
    const receipt = {
      command: "note",
      person: options.person,
      ok: true,
      model_read: true,
      provenance: PROVENANCE_NOTE,
      entry: recorded.entry?.id ?? null,
      appended: recorded.appended,
      inputs: raw ? [{ path: raw.relativePath, sha256: raw.sha256, bytes: raw.bytes }] : [],
      outputs: [
        ...(raw ? [{ path: raw.relativePath, sha256: raw.sha256, bytes: raw.bytes, kind: "raw" }] : []),
        ...(textFile ? [{ path: textFile.relativePath, sha256: textFile.sha256, bytes: textFile.bytes, kind: "text" }] : []),
      ],
      anchors: { total: stats.anchors ?? 0, cited: 0 },
      warnings: [...(document.warnings ?? []).map((warning) => warning.message ?? warning)],
      unavailable: [],
    };
    if (!json) {
      reporter.line(`note: ${recorded.entry?.id ?? "?"} recorded from ${options.from} (model-read, ${recorded.entry?.anchor_count ?? 0} anchor(s))`);
      if (textFile) reporter.line(`  text: ${relative(process.cwd(), resolve(personDir, "knowledge", textFile.relativePath))}`);
      reporter.warn(`  ${PROVENANCE_NOTE}`);
    }
    return { receipt, exitCode: 0 };
  },
});

export { PROVENANCE_NOTE, sha256Hex };
