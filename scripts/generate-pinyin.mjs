#!/usr/bin/env node
/**
 * Derive `assets/pinyin.json` from the Unicode Unihan database.
 *
 * `pypinyin` was the writer's only optional Python dependency. The Node core
 * ships a small, reviewable table instead, built from a single upstream source
 * with a documented selection rule:
 *
 *   characters = the 3500 most frequent Han characters according to the summed
 *   `kHanyuPinlu` corpus frequency in Unihan_Readings.txt; the reading is
 *   `kMandarin` (first reading) or, failing that, the highest-frequency
 *   `kHanyuPinlu` reading.
 *
 * Usage:
 *   node scripts/generate-pinyin.mjs                      # download Unihan.zip, extract, write the asset
 *   node scripts/generate-pinyin.mjs --source <file>      # use a local Unihan_Readings.txt
 *   node scripts/generate-pinyin.mjs --check              # fail when the committed asset is stale
 *   node scripts/generate-pinyin.mjs --limit 0            # keep every covered character
 *
 * The output is deterministic (code-point order, no wall-clock timestamps): the
 * `source_date` comes from the Unihan file header, so `--check` is a real drift
 * gate and can run in CI.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const DEFAULT_OUT = join(repoRoot, "assets", "pinyin.json");
const DEFAULT_LIMIT = 3500;
const UNIHAN_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip";
const UNICODE_LICENSE_URL = "https://www.unicode.org/license.txt";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const has = (name) => process.argv.includes(`--${name}`);

const outPath = resolve(arg("out", DEFAULT_OUT));
const limit = Number.parseInt(arg("limit", String(DEFAULT_LIMIT)), 10);
const checkOnly = has("check");
const sourceArg = arg("source", null);

/** Download Unihan.zip and extract Unihan_Readings.txt with the system unzip. */
function fetchReadings() {
  const dir = mkdtempSync(join(tmpdir(), "dst-unihan-"));
  const zipPath = join(dir, "Unihan.zip");
  console.log(`downloading ${UNIHAN_URL}`);
  const download = spawnSync("curl", ["-fsSL", "-o", zipPath, UNIHAN_URL], { encoding: "utf8" });
  if (download.status !== 0) {
    throw new Error(
      `cannot download Unihan.zip (${download.stderr?.trim() || "curl failed"}).\n` +
        "Download it manually and pass --source <path to Unihan_Readings.txt>.",
    );
  }
  const unzip = spawnSync("unzip", ["-o", "-q", zipPath, "Unihan_Readings.txt", "-d", dir], {
    encoding: "utf8",
  });
  if (unzip.status !== 0) {
    throw new Error(
      `cannot extract Unihan_Readings.txt (${unzip.stderr?.trim() || "unzip failed"}).\n` +
        "Extract it manually and pass --source <path to Unihan_Readings.txt>.",
    );
  }
  return { path: join(dir, "Unihan_Readings.txt"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Parse Unihan_Readings.txt into per-character frequency and reading data. */
export function parseUnihan(text) {
  const sourceDate = /^#\s*Date:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
  const unicodeVersion = /^#\s*Unicode Version\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;

  const frequencies = new Map();
  const readings = new Map();

  for (const line of text.split("\n")) {
    if (line.startsWith("#") || line.trim() === "") continue;
    const [codeField, field, value] = line.split("\t");
    if (!codeField?.startsWith("U+") || !value) continue;
    const character = String.fromCodePoint(Number.parseInt(codeField.slice(2), 16));

    if (field === "kHanyuPinlu") {
      let total = 0;
      const entries = [];
      for (const match of value.matchAll(/([A-Za-z\u00C0-\u024F\u0300-\u036F]+)\((\d+)\)/g)) {
        const count = Number.parseInt(match[2], 10);
        total += count;
        entries.push({ reading: match[1], count });
      }
      if (entries.length > 0) frequencies.set(character, { total, entries });
    } else if (field === "kMandarin") {
      const primary = value.trim().split(/\s+/)[0];
      if (primary) readings.set(character, primary);
    }
  }

  return { sourceDate, unicodeVersion, frequencies, readings };
}

/** Build the asset object: top-N by frequency, code-point ordered, with provenance. */
export function buildAsset({ sourceDate, unicodeVersion, frequencies, readings }, maxCharacters) {
  const ranked = [...frequencies.entries()]
    .map(([character, data]) => ({ character, total: data.total, entries: data.entries }))
    .sort((left, right) => {
      if (right.total !== left.total) return right.total - left.total;
      return left.character.codePointAt(0) - right.character.codePointAt(0);
    });

  // Characters that carry a reading but no corpus frequency. They are real, common
  // characters too — dropping them made the table cover 2404 of the 3500 it
  // promised, and every one of the missing went to the explicit-slug fallback.
  const unranked = [...readings.keys()]
    .filter((character) => !frequencies.has(character))
    .sort((left, right) => left.codePointAt(0) - right.codePointAt(0))
    .map((character) => ({ character, total: 0, entries: [{ reading: readings.get(character), count: 0 }] }));

  const ordered = [...ranked, ...unranked];
  const selected = maxCharacters > 0 ? ordered.slice(0, maxCharacters) : ordered;
  const characters = {};
  for (const entry of selected) {
    const best =
      readings.get(entry.character) ??
      [...entry.entries].sort((left, right) => right.count - left.count)[0].reading;
    characters[entry.character] = best;
  }

  return {
    _comment:
      "Derived pinyin table for slug generation. Generated file — run `node scripts/generate-pinyin.mjs` to refresh; `--check` fails on drift.",
    source: {
      database: "Unihan",
      url: UNIHAN_URL,
      file: "Unihan_Readings.txt",
      fields: ["kMandarin", "kHanyuPinlu"],
      unicode_version: unicodeVersion,
      source_date: sourceDate,
    },
    license: {
      name: "Unicode License v3",
      url: UNICODE_LICENSE_URL,
      notice:
        "Unihan data is Copyright © Unicode, Inc. and distributed under the Unicode License v3; see the URL above for the full text.",
    },
    generated_by: "scripts/generate-pinyin.mjs",
    selection: {
      rule: "top N Han characters by summed kHanyuPinlu frequency; reading = first kMandarin, else the most frequent kHanyuPinlu reading",
      limit: maxCharacters,
      // Every character this table could have described, not just the frequency-ranked
      // ones: "covered" is about the source, not about which slice we kept.
      covered_characters: new Set([...frequencies.keys(), ...readings.keys()]).size,
    },
    count: Object.keys(characters).length,
    characters,
  };
}

function main() {
  let source = sourceArg;
  let cleanup = () => {};
  if (!source) {
    const fetched = fetchReadings();
    source = fetched.path;
    cleanup = fetched.cleanup;
  } else if (!existsSync(source)) {
    throw new Error(`--source does not exist: ${source}`);
  }

  const text = readFileSync(source, "utf8");
  const parsed = parseUnihan(text);
  const asset = buildAsset(parsed, Number.isNaN(limit) ? DEFAULT_LIMIT : limit);
  const serialized = `${JSON.stringify(asset, null, 2)}\n`;
  cleanup();

  console.log(
    `unihan ${asset.source.unicode_version} (${asset.source.source_date}): ` +
      `${asset.selection.covered_characters} covered characters, ` +
      `${asset.count} written (limit ${asset.selection.limit})`,
  );

  if (checkOnly) {
    if (!existsSync(outPath)) throw new Error(`asset missing: ${outPath}`);
    const current = readFileSync(outPath, "utf8");
    if (current !== serialized) {
      console.error(`DRIFT: ${outPath} does not match a fresh Unihan derivation.`);
      console.error("Run `node scripts/generate-pinyin.mjs` and commit the result.");
      process.exitCode = 1;
      return;
    }
    console.log(`OK: ${outPath} matches the current Unihan derivation.`);
    return;
  }

  writeFileSync(outPath, serialized, "utf8");
  console.log(`wrote ${outPath} (${Buffer.byteLength(serialized)} bytes)`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
