/**
 * identity.mjs — one person, several channel handles.
 *
 * A person signs differently in every channel: `林工` in one export, `ou_lin` in
 * another, `U02` in a third. The derivation reads `knowledge/text/*.md`, so if the
 * handles are left alone it reports several participants and splits that person's
 * statistics across them — the multi-source blind test could only describe the
 * corpus "per channel" for exactly this reason.
 *
 * A Skill may therefore carry `identity.json` at its root:
 *
 *   {
 *     "people": [
 *       { "name": "林工", "handles": ["ou_lin", "U02", "林工"], "note": "Slack 显示名 / 飞书 open_id" }
 *     ]
 *   }
 *
 * Handles are matched case-sensitively after trimming; a handle claimed by two
 * people is an error, not a coin flip. Canonicalisation happens at record time
 * (`recordDocument`), so the normalised text — and therefore every anchor, every
 * derived statistic and every citation — names the person the same way.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const IDENTITY_FILE = "identity.json";

/**
 * Read and validate a map.
 *
 * @param {string} personDir Skill root (the directory holding `knowledge/`)
 * @returns {{path: string|null, sha256: string|null, map: Map<string,string>, people: object[], warnings: string[]}}
 */
export function loadIdentity(personDir, options = {}) {
  const path = options.path ?? join(personDir, IDENTITY_FILE);
  const empty = { path: null, sha256: null, map: new Map(), people: [], warnings: [] };
  if (!existsSync(path)) return empty;

  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new Error(`cannot read ${IDENTITY_FILE}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${IDENTITY_FILE} is not valid JSON: ${error.message}`);
  }
  const people = Array.isArray(parsed?.people) ? parsed.people : null;
  if (!people) throw new Error(`${IDENTITY_FILE} needs a "people" array`);

  const map = new Map();
  const warnings = [];
  for (const [index, person] of people.entries()) {
    const name = typeof person?.name === "string" ? person.name.trim() : "";
    if (name === "") throw new Error(`${IDENTITY_FILE}: people[${index}] needs a non-empty "name"`);
    const handles = Array.isArray(person.handles) ? person.handles : [];
    // The canonical name is always one of its own handles.
    for (const handle of [name, ...handles]) {
      if (typeof handle !== "string" || handle.trim() === "") continue;
      const key = handle.trim();
      const owner = map.get(key);
      if (owner !== undefined && owner !== name) {
        throw new Error(`${IDENTITY_FILE}: handle "${key}" is claimed by both "${owner}" and "${name}"`);
      }
      map.set(key, name);
    }
    if (handles.length === 0) warnings.push(`"${name}" lists no handles; only its own name is canonicalised`);
  }

  const sha256 = options.sha256 ?? null;
  return { path, sha256, map, people, warnings };
}

/** Canonical name for a speaker, or the speaker unchanged. */
export function canonicalSpeaker(speaker, identity) {
  if (speaker === null || speaker === undefined) return speaker;
  const key = String(speaker).trim();
  if (key === "") return speaker;
  return identity?.map?.get(key) ?? speaker;
}

/**
 * Rewrite the speakers of a parsed document in place (a copy is returned), before
 * the text is anchored — so a canonicalised turn is still one anchor, one prefix,
 * one row in the statistics.
 *
 * @returns {{document: object, changed: number, matched: string[]}}
 */
export function applyIdentity(document, identity) {
  if (!identity || identity.map.size === 0) return { document, changed: 0, matched: [] };
  const matched = new Set();
  // Distinct handles, not occurrences: a turn appears in both `segments` and
  // `entries`, so counting each rewrite reported the same person twice — and
  // `changed` is read as "how many turns this map rewrote".
  const changedHandles = new Set();
  const rewrite = (record) => {
    if (!record || typeof record !== "object") return record;
    const canonical = canonicalSpeaker(record.speaker, identity);
    if (canonical === record.speaker) return record;
    if (record.speaker !== null && record.speaker !== undefined) {
      const handle = String(record.speaker).trim();
      matched.add(handle);
      changedHandles.add(handle);
    }
    return { ...record, speaker: canonical };
  };
  return {
    document: {
      ...document,
      segments: (document.segments ?? []).map(rewrite),
      entries: (document.entries ?? []).map(rewrite),
    },
    changed: changedHandles.size,
    matched: [...matched].sort(),
  };
}
