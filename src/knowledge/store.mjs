/**
 * store.mjs — the byte vault under `knowledge/`.
 *
 * Layout (see docs/v2/CONTRACT.md §2):
 *
 *   knowledge/raw/<source>/<...>     raw bytes, append only, never rewritten
 *   knowledge/text/<source>.md       normalised text carrying `[k00NN]` anchors
 *   knowledge/index.json             the ledger (owned by ledger.mjs)
 *
 * Two rules this module enforces mechanically:
 *
 *  - **Raw bytes are stored verbatim.** `writeRaw` accepts a Uint8Array and
 *    writes exactly those bytes; nothing is re-encoded, normalised or trimmed on
 *    the way to disk. `readRaw` is asserted to return the identical bytes.
 *  - **Writes are atomic.** Every file is staged in the destination directory,
 *    fsync'd, then `rename(2)`d into place, so a crash leaves either the old file
 *    or the new one — never a half written `index.json`.
 *
 * The store is a pure filesystem object: no clock, no randomness, no globals.
 * Callers that need determinism pass `fetched_at` explicitly.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

export const LEDGER_FILE = "index.json";
export const RAW_DIR = "raw";
export const TEXT_DIR = "text";

/** Directory/file names that may never be used as a `<source>` bucket. */
const FORBIDDEN_SOURCE_SEGMENTS = new Set([".", "..", "", "/"]);

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(text) {
  return sha256Hex(Buffer.from(text, "utf8"));
}

function toUint8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8");
  throw new TypeError("expected a Uint8Array, ArrayBuffer, number[] or string");
}

/**
 * Normalise a source name into a safe single path segment.
 * `"ChatGPT Export 2024"` → `"chatgpt-export-2024"`.
 */
export function slugifySource(source) {
  const slug = String(source ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  if (!slug || FORBIDDEN_SOURCE_SEGMENTS.has(slug)) {
    throw new TypeError(`cannot derive a directory name from source ${JSON.stringify(source)}`);
  }
  return slug.slice(0, 96);
}

/**
 * Reduce a file name to something that cannot escape the bucket: path
 * separators collapse to `-`, `..` is neutralised, control characters go.
 */
export function slugifyFileName(name) {
  const base = basename(String(name ?? ""));
  const slug = base
    .normalize("NFKD")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f/\\]/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[-.]+/, "")
    .replace(/[-.\s]+$/, "");
  return slug || "payload";
}

function fsyncFile(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Write `bytes` to `path` atomically.
 *
 * The staging file lives in the *same* directory as the destination so the
 * final `rename` is a same-filesystem operation (atomic on POSIX). The staging
 * name is random so two concurrent writers cannot collide.
 *
 * @param {string} path
 * @param {Uint8Array} bytes
 * @param {{durable?: boolean}} [options] `durable` also fsyncs the file (default true)
 * @returns {{path: string, bytes: number, sha256: string}}
 */
export function atomicWriteBytes(path, bytes, options = {}) {
  const buffer = Buffer.from(toUint8(bytes));
  const { durable = true } = options;
  const directory = dirname(path);

  mkdirSync(directory, { recursive: true });
  if (existsSync(path) && statSync(path).isDirectory()) {
    throw new Error(`refusing to overwrite the directory ${path} with a file`);
  }

  const staging = join(directory, `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    if (durable) {
      const fd = openSync(staging, "wx", 0o644);
      try {
        writeSync(fd, buffer);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } else {
      writeFileSync(staging, buffer, { flag: "wx" });
    }
    renameSync(staging, path);
  } catch (error) {
    if (existsSync(staging)) {
      try {
        rmSync(staging, { force: true });
      } catch {
        // Best effort: the staging file is inert, and the caller sees `error`.
      }
    }
    throw error;
  }

  return { path, bytes: buffer.length, sha256: sha256Hex(buffer) };
}

/** Write UTF-8 text atomically (no BOM, LF endings, exactly as given). */
export function atomicWriteText(path, text, options = {}) {
  return atomicWriteBytes(path, Buffer.from(String(text), "utf8"), options);
}

/** Atomic replace with `fsync`, mirroring what a durable append costs. */
export function atomicWriteJson(path, value, options = {}) {
  const { indent = 2, sortKeys = true } = options;
  return atomicWriteText(path, `${stableStringify(value, indent, sortKeys)}\n`, options);
}

/**
 * Deterministic `JSON.stringify`: object keys are ordered, so the same logical
 * value always hashes to the same bytes (the contract's "run twice, same
 * sha256" gate depends on this).
 */
export function stableStringify(value, indent = 2, sortKeys = true) {
  const stack = new WeakSet();
  const normalise = (input) => {
    if (input === null || typeof input !== "object") return input;
    if (stack.has(input)) throw new TypeError("cannot serialise a cyclic structure");
    stack.add(input);
    let output;
    if (Array.isArray(input)) {
      output = input.map((item) => normalise(item));
    } else if (input instanceof Map) {
      output = {};
      for (const key of [...input.keys()].map(String).sort()) {
        output[key] = normalise(input.get(key));
      }
    } else {
      const keys = Object.keys(input);
      if (sortKeys) keys.sort();
      output = {};
      for (const key of keys) {
        if (input[key] === undefined) continue;
        output[key] = normalise(input[key]);
      }
    }
    stack.delete(input);
    return output;
  };
  return JSON.stringify(normalise(value), null, indent);
}

export class KnowledgeStore {
  /**
   * @param {string} root directory that *contains* `knowledge/`
   * @param {{fetched_at?: string, dryRun?: boolean}} [options]
   */
  constructor(root, options = {}) {
    if (!root) throw new TypeError("KnowledgeStore requires a root directory");
    this.root = resolve(root);
    this.knowledgeRoot = join(this.root, "knowledge");
    this.dryRun = Boolean(options.dryRun);
    this.fetched_at = options.fetched_at ?? null;
  }

  get rawRoot() {
    return join(this.knowledgeRoot, RAW_DIR);
  }

  get textRoot() {
    return join(this.knowledgeRoot, TEXT_DIR);
  }

  get ledgerPath() {
    return join(this.knowledgeRoot, LEDGER_FILE);
  }

  ensure() {
    if (this.dryRun) return this;
    mkdirSync(this.rawRoot, { recursive: true });
    mkdirSync(this.textRoot, { recursive: true });
    return this;
  }

  /**
   * Absolute path of the deployed location for `<source>/<name>`.
   * `name` may contain sub-directories (archive members, mail folders, …);
   * escapes are rejected rather than sanitised, because a silent rewrite of the
   * path would break the anchor→raw mapping.
   */
  rawPath(source, name) {
    const bucket = slugifySource(source);
    const relative = String(name ?? "").split(/[\\/]+/).filter(Boolean);
    if (relative.length === 0) throw new TypeError("rawPath requires a file name");
    const target = resolve(this.rawRoot, bucket, ...relative);
    const prefix = resolve(this.rawRoot, bucket) + sep;
    if (!target.startsWith(prefix)) {
      throw new TypeError(`refusing a raw path that escapes its bucket: ${name}`);
    }
    return target;
  }

  /**
   * `knowledge/text/<source>.md`, or `<source>--<stem>.md` when several distinct
   * inputs share one source bucket (three X archives all named `tweets.js`), so
   * no two entries can ever overwrite each other's text.
   */
  textPath(source, stem) {
    const slug = slugifySource(source);
    if (!stem) return join(this.textRoot, `${slug}.md`);
    const suffix = slugifySource(stem);
    return join(this.textRoot, suffix === slug ? `${slug}.md` : `${slug}--${suffix}.md`);
  }

  hasRaw(source, name) {
    return existsSync(this.rawPath(source, name));
  }

  /** Read raw bytes back. Always returns a fresh Uint8Array. */
  readRaw(source, name) {
    return new Uint8Array(readFileSync(this.rawPath(source, name)));
  }

  /**
   * Store raw bytes verbatim.
   * @returns {{path: string, relativePath: string, bytes: number, sha256: string,
   *            created: boolean}}
   */
  writeRaw(source, name, bytes) {
    const target = this.rawPath(source, name);
    const buffer = Buffer.from(toUint8(bytes));
    const sha256 = sha256Hex(buffer);
    const existed = existsSync(target);
    if (!this.dryRun) {
      atomicWriteBytes(target, buffer);
      // Read the bytes back so a mis-encoded write can never go unnoticed.
      const readBack = readFileSync(target);
      if (!readBack.equals(buffer)) {
        throw new Error(`raw bytes changed on disk: ${target}`);
      }
    }
    return {
      path: target,
      relativePath: `${RAW_DIR}/${slugifySource(source)}/${String(name).split(/[\\/]+/).filter(Boolean).join("/")}`,
      bytes: buffer.length,
      sha256,
      created: !existed,
    };
  }
  /** Store normalised text carrying anchors. */
  writeText(source, text, stem) {
    const target = this.textPath(source, stem);
    const buffer = Buffer.from(String(text), "utf8");
    if (!this.dryRun) atomicWriteBytes(target, buffer);
    const relative = target.slice(this.knowledgeRoot.length + 1).split(sep).join("/");
    return {
      path: target,
      relativePath: relative,
      bytes: buffer.length,
      sha256: sha256Hex(buffer),
    };
  }

  /**
   * List everything under a bucket, relative to it, sorted for determinism.
   * @returns {Array<{name: string, bytes: number}>}
   */
  listRaw(source) {
    const bucket = join(this.rawRoot, slugifySource(source));
    if (!existsSync(bucket)) return [];
    const results = [];
    const walk = (directory, prefix) => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const absolute = join(directory, entry.name);
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(absolute, relative);
        } else if (entry.isFile()) {
          results.push({ name: relative, bytes: statSync(absolute).size });
        }
      }
    };
    walk(bucket, "");
    return results;
  }

  /** Byte length of the raw file, or null when it is absent. */
  rawSize(source, name) {
    const target = this.rawPath(source, name);
    return existsSync(target) ? statSync(target).size : null;
  }

  /** Remove a whole bucket. Only used by tests and `--force` style rebuilds. */
  purgeSource(source) {
    const bucket = join(this.rawRoot, slugifySource(source));
    if (existsSync(bucket)) rmSync(bucket, { recursive: true, force: true });
    const text = this.textPath(source);
    if (existsSync(text)) rmSync(text, { force: true });
  }
}

/**
 * Copy `bytes` into the store only when their sha256 differs from what is
 * already there; reports whether the bytes were newly written.
 */
export function putRawOnce(store, source, name, bytes) {
  const buffer = Buffer.from(toUint8(bytes));
  const sha256 = sha256Hex(buffer);
  const target = store.rawPath(source, name);
  if (existsSync(target) && sha256Hex(readFileSync(target)) === sha256) {
    return { ...store.writeRaw(source, name, buffer), created: false, unchanged: true };
  }
  const result = store.writeRaw(source, name, buffer);
  return { ...result, unchanged: false };
}

/** Append bytes to a file (used only by tests and log-style payloads). */
export function appendBytesSync(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeSync(fd, Buffer.from(toUint8(bytes)));
  } finally {
    closeSync(fd);
  }
  return path;
}

export { existsSync, mkdirSync, readFileSync, readdirSync, statSync };
