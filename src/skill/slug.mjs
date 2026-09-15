/**
 * Pinyin-backed slug resolution.
 *
 * `pypinyin` was the only optional Python dependency of the writer. The Node
 * core ships a derived table instead: `assets/pinyin.json` (built from the
 * Unicode Unihan database by `scripts/generate-pinyin.mjs`).
 *
 * Discipline (CONTRACT §3): when the table is missing, or when a Han character
 * is not covered, the slug is **not** guessed — the caller gets
 * `SlugResolutionError` telling the user to pass `--slug` explicitly. The old
 * Python fallback silently produced `person-<hash>`; that is exactly the
 * "silent junk" this port refuses to emit.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PINYIN_ASSET_URL = new URL("../../assets/pinyin.json", import.meta.url);

/** Raised when a slug cannot be derived without guessing. */
export class SlugResolutionError extends Error {
  constructor(message, { character = null } = {}) {
    super(message);
    this.name = "SlugResolutionError";
    this.code = "slug-unresolved";
    this.character = character;
    this.remedy =
      "pass --slug <kebab-case> explicitly (中文名请显式传 --slug；例如 --name \"周奇墨\" --slug zhou-qimo)";
  }
}

const HAN_RANGES = [
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0x20000, 0x2fa1f],
];

export function isHanCharacter(character) {
  const code = character.codePointAt(0);
  return HAN_RANGES.some(([start, end]) => code >= start && code <= end);
}

/** True when the text contains at least one Han character. */
export function containsHan(text) {
  return [...text].some(isHanCharacter);
}

let cachedTable;
let cachedTableLoaded = false;

/** Load `assets/pinyin.json` once; `null` when the asset is absent. */
export function loadPinyinTable({ path = fileURLToPath(PINYIN_ASSET_URL) } = {}) {
  if (cachedTableLoaded) return cachedTable;
  cachedTableLoaded = true;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    cachedTable = parsed?.characters ?? null;
  } catch {
    cachedTable = null;
  }
  return cachedTable;
}

/** Reset the memoized table (tests, and `--pinyin <file>` overrides). */
export function resetPinyinTable() {
  cachedTable = undefined;
  cachedTableLoaded = false;
}

/**
 * Convert one Unihan reading to the shape `pypinyin.lazy_pinyin` emits:
 * tone marks stripped, `ü` written as `v` (吕 → `lv`, not `lu`).
 */
export function readingToSyllable(reading) {
  return (
    reading
      .normalize("NFD")
      // The diaeresis becomes a v (lü → lv), because the slug alphabet has no ü.
      .replace(/u\u0308/g, "v")
      .replace(/\u0308/g, "v")
      // Every other combining mark is a tone mark: meaningful in pinyin, noise in a
      // slug. Without this "lǚ" arrives as "lu" + U+030C and the slug is "luv̌".
      .replace(/[\u0300-\u036f]/g, "")
  );
}

/**
 * Syllables for a display name, Han characters resolved through the table.
 * A missing table is only an error when the name actually contains Han text.
 * @returns {string[]}
 */
export function pinyinSyllables(name, { table = loadPinyinTable() } = {}) {
  const text = String(name);
  const syllables = [];
  // Non-Han text is collected in **runs**: a Latin name is one token, not one
  // syllable per letter. Pushing each character separately turned "Zadie Smith"
  // into "z-a-d-i-e-s-m-i-t-h".
  let run = "";
  const flushRun = () => {
    if (run !== "") {
      syllables.push(run);
      run = "";
    }
  };
  for (const character of text) {
    if (!isHanCharacter(character)) {
      run += character;
      continue;
    }
    flushRun();
    if (!table) {
      throw new SlugResolutionError(
        `cannot derive a slug from "${text}": the pinyin table assets/pinyin.json is missing`,
        { character },
      );
    }
    const reading = table[character];
    if (!reading) {
      throw new SlugResolutionError(
        `cannot derive a slug from "${text}": no pinyin reading for "${character}" in assets/pinyin.json`,
        { character },
      );
    }
    syllables.push(readingToSyllable(reading));
  }
  flushRun();
  return syllables;
}

/** Injectable for tests: `setSlugifyTable(table)` replaces the memoized asset. */
export function setSlugifyTable(table) {
  cachedTable = table;
  cachedTableLoaded = true;
}
