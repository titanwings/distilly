#!/usr/bin/env node
/**
 * Split a corpus by time into the A (distillation) and B (held-out) halves that
 * `docs/v2/ACCEPTANCE.md` requires, and write a receipt so the split cannot be
 * quietly re-rolled after seeing the results.
 *
 *   node scripts/split-corpus.mjs --in <corpus.srt|.vtt|.txt> --out <dir> [--ratio 0.7]
 *
 * Subtitles are split on the cue timeline (B starts where A stops). Anything else
 * is split by paragraph count, and the receipt records `by: "paragraphs"` so the
 * weaker guarantee is visible.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";

import { SourceFile } from "../src/parse/common.mjs";
import { detectSubtitleFormat, formatTimecode, splitCues } from "../src/parse/subtitle.mjs";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const input = arg("in");
const outDir = arg("out");
const ratio = Number(arg("ratio", "0.7"));
if (!input || !outDir) {
  console.error("usage: node scripts/split-corpus.mjs --in <corpus> --out <dir> [--ratio 0.7]");
  process.exit(2);
}
if (!(ratio > 0.1 && ratio < 0.95)) {
  console.error(`ratio must be between 0.1 and 0.95 (got ${ratio})`);
  process.exit(2);
}

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const extension = extname(input).toLowerCase();
const raw = readFileSync(input);
const source = new SourceFile({ path: basename(input), raw });

mkdirSync(outDir, { recursive: true });

let by;
let aText;
let bText;
let aMeta;
let bMeta;
let cut = null;

if (extension === ".srt" || extension === ".vtt") {
  const { format } = detectSubtitleFormat(source);
  const { cues } = splitCues(source, format);
  if (cues.length < 4) throw new Error(`need at least four cues to split ${input}`);
  const total = cues[cues.length - 1].end;
  const cutAt = total * ratio;
  let boundary = cues.findIndex((cue) => cue.start >= cutAt);
  if (boundary < 2) boundary = 2;
  if (boundary > cues.length - 2) boundary = cues.length - 2;

  const render = (list) =>
    list
      .map((cue, index) => {
        const body = cue.speaker ? `${cue.speaker}：${cue.text}` : cue.text;
        return `${index + 1}\n${formatTimecode(cue.start)} --> ${formatTimecode(cue.end)}\n${body}\n`;
      })
      .join("\n");

  const a = cues.slice(0, boundary);
  const b = cues.slice(boundary);
  aText = render(a);
  bText = render(b);
  by = "time";
  cut = {
    index: boundary,
    timecode: formatTimecode(cues[boundary].start),
    a_end_timecode: formatTimecode(a[a.length - 1].end),
  };
  aMeta = { cues: a.length, start: formatTimecode(a[0].start), end: formatTimecode(a[a.length - 1].end) };
  bMeta = { cues: b.length, start: formatTimecode(b[0].start), end: formatTimecode(b[b.length - 1].end) };
} else {
  const paragraphs = source.text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length < 4) throw new Error(`need at least four paragraphs to split ${input}`);
  const boundary = Math.min(Math.max(Math.round(paragraphs.length * ratio), 1), paragraphs.length - 1);
  aText = `${paragraphs.slice(0, boundary).join("\n\n")}\n`;
  bText = `${paragraphs.slice(boundary).join("\n\n")}\n`;
  by = "paragraphs";
  cut = { index: boundary, timecode: null, a_end_timecode: null };
  aMeta = { paragraphs: boundary };
  bMeta = { paragraphs: paragraphs.length - boundary };
}

const aPath = join(outDir, `A${extension || ".txt"}`);
const bPath = join(outDir, `B${extension || ".txt"}`);
writeFileSync(aPath, aText, "utf8");
writeFileSync(bPath, bText, "utf8");

const receipt = {
  source: input,
  split_by: by,
  ratio,
  cut,
  a: { file: basename(aPath), sha256: sha256(aText), bytes: Buffer.byteLength(aText), ...aMeta },
  b: { file: basename(bPath), sha256: sha256(bText), bytes: Buffer.byteLength(bText), ...bMeta },
};
writeFileSync(join(outDir, "split.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

console.log(`split (${by}, ratio ${ratio}) → ${aPath} / ${bPath}`);
console.log(`  A: ${JSON.stringify(aMeta)}`);
console.log(`  B: ${JSON.stringify(bMeta)}`);
console.log("  keep B away from the distiller and the judge; only the checker reads it.");
