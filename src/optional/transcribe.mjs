/**
 * transcribe.mjs — the optional transcription backend.
 *
 * Two backends, no silent downgrade:
 *
 *   openai-http  an OpenAI-compatible `POST {base}/audio/transcriptions`
 *                (multipart, `whisper-1` by default) using an env credential.
 *   host         the host (a computer-use / model host) transcribes the file and
 *                hands the transcript over with `--capture <file>`.
 *
 * If neither is available the command fails loudly with `unavailable` and a
 * remediation list. It never returns an empty transcript, never pretends the
 * audio was transcribed and never falls back to a local model behind the user's
 * back — this is exactly what the legacy helper did wrong:
 * `tools/research/transcribe_audio.py:145` returns `""` when `OPENAI_API_KEY` is
 * missing and `:152` returns `""` when the `openai` package is not installed, so
 * callers silently received "no transcript" and carried on.
 *
 * Successful artifacts carry `provenance {method, producer, confidence}` on the
 * receipt, in `knowledge/text/<name>.md` front matter and in the ledger entry.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const COMMAND = "transcribe";
export const CONFIG_FILE = "transcribe_config.json";
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "whisper-1";
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;
/** OpenAI's documented upload ceiling; the legacy helper warned at the same size. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ENV_KEYS = {
  apiKey: ["DISTILLY_TRANSCRIBE_API_KEY", "OPENAI_API_KEY"],
  baseUrl: ["DISTILLY_TRANSCRIBE_BASE_URL", "OPENAI_BASE_URL"],
  model: ["DISTILLY_TRANSCRIBE_MODEL", "OPENAI_TRANSCRIBE_MODEL"],
};

const REMEDIATION_SETUP = [
  `export DISTILLY_TRANSCRIBE_API_KEY=… (or OPENAI_API_KEY) for the OpenAI-compatible backend`,
  `  optional: DISTILLY_TRANSCRIBE_BASE_URL (default ${DEFAULT_BASE_URL}), DISTILLY_TRANSCRIBE_MODEL (default ${DEFAULT_MODEL})`,
  `  or store the same keys in ~/.distilly/${CONFIG_FILE} (chmod 600)`,
  "or let the host transcribe and register the result: distilly transcribe <file> --capture <transcript.txt>",
];

export class TranscribeFailure extends Error {
  constructor(reason, message, { remediation = [], exitCode = 1 } = {}) {
    super(message);
    this.name = "TranscribeFailure";
    this.reason = reason;
    this.remediation = remediation;
    this.exitCode = exitCode;
  }
}

export function redact(text, secrets = []) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < 4) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

export function scrub(value, secrets = []) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "string" ? redact(item, secrets) : item)),
  );
}

export function distillyHome(env = process.env) {
  const override = env?.DISTILLY_HOME;
  return override ? resolve(String(override)) : join(homedir(), ".distilly");
}

/** Read the HTTP credential from env first, then `~/.distilly/transcribe_config.json`. */
export function loadCredential({ env = process.env, readFile = readFileSync } = {}) {
  const pick = (names) => {
    for (const name of names) {
      const value = env?.[name];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
    }
    return null;
  };

  const envKey = pick(ENV_KEYS.apiKey);
  if (envKey) {
    return {
      ok: true,
      source: "env",
      configFile: CONFIG_FILE,
      path: null,
      values: {
        api_key: envKey,
        base_url: pick(ENV_KEYS.baseUrl) ?? DEFAULT_BASE_URL,
        model: pick(ENV_KEYS.model) ?? DEFAULT_MODEL,
      },
    };
  }

  const path = join(distillyHome(env), CONFIG_FILE);
  if (!existsSync(path)) return { ok: false, source: null, configFile: CONFIG_FILE, path, values: null };

  let parsed;
  try {
    parsed = JSON.parse(readFile(path, "utf8"));
  } catch (error) {
    throw new TranscribeFailure(
      "bad-credential-file",
      `${CONFIG_FILE} is not valid JSON (${redact(error.message)})`,
      { remediation: REMEDIATION_SETUP },
    );
  }
  const apiKey = parsed.api_key ?? parsed.apiKey ?? parsed.key ?? null;
  if (!apiKey) {
    return { ok: false, source: "config", configFile: CONFIG_FILE, path, values: null };
  }
  return {
    ok: true,
    source: "config",
    configFile: CONFIG_FILE,
    path,
    values: {
      api_key: apiKey,
      base_url: parsed.base_url ?? parsed.baseUrl ?? DEFAULT_BASE_URL,
      model: parsed.model ?? DEFAULT_MODEL,
    },
  };
}

export function parseRetryAfter(headerValue, nowMs = Date.now()) {
  if (headerValue === null || headerValue === undefined || headerValue === "") return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(String(headerValue));
  if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  return null;
}

export function backoffDelay(attempt, retryAfterMs = null, options = {}) {
  const { baseMs = 500, maxMs = DEFAULT_MAX_BACKOFF_MS } = options;
  if (Number.isFinite(retryAfterMs) && retryAfterMs !== null) return Math.min(retryAfterMs, maxMs);
  return Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);
}

export function defaultSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function slug(text, fallback = "transcript") {
  const slugged = String(text ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "")
    .slice(0, 64);
  return slugged || fallback;
}

export function knowledgeRoot({ root = process.cwd(), person, family = "colleague" } = {}) {
  return person ? join(resolve(root), "skills", slug(family), slug(person), "knowledge") : join(resolve(root), "knowledge");
}

/**
 * Deterministic multipart body: the boundary is derived from the payload hash,
 * so the same input always produces the same request bytes (and a mock can
 * assert them without parsing a stream).
 */
export function buildMultipart({ boundaryKey, fields = {}, file }) {
  const boundary = `----distilly-${boundaryKey}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"));
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
      "utf8",
    ),
  );
  chunks.push(Buffer.from(file.bytes));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  const body = Buffer.concat(chunks);
  return { boundary, body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** Timestamped, provider-independent transcript body. */
export function formatTranscript(payload) {
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  const lines = [];
  for (const segment of segments) {
    const text = String(segment?.text ?? "").trim();
    if (!text) continue;
    const start = Number(segment?.start ?? 0);
    const m = Math.floor(start / 60);
    const s = Math.floor(start % 60);
    lines.push(`[${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}] ${text}`);
  }
  if (lines.length === 0) {
    const text = String(payload?.text ?? "").trim();
    if (text) lines.push(text);
  }
  return lines.join("\n");
}

export function writeArtifacts(knowledgeDir, name, { rawBytes, transcript, provenance, source, fetchedAt }) {
  const rawDir = join(knowledgeDir, "raw", COMMAND);
  mkdirSync(rawDir, { recursive: true });
  const rawPath = join(rawDir, `${slug(name)}.json`);
  writeAtomic(rawPath, Buffer.from(rawBytes));

  const textDir = join(knowledgeDir, "text");
  mkdirSync(textDir, { recursive: true });
  const textPath = join(textDir, `${slug(name)}.md`);
  const frontMatter = [
    "---",
    "provenance:",
    `  method: ${provenance.method}`,
    `  producer: ${provenance.producer}`,
    `  confidence: ${provenance.confidence}`,
    `source: ${source}`,
    `fetched_at: ${fetchedAt}`,
    "anchors: pending   # distilly parse-subtitle / harvest assign [k00NN] anchors",
    "---",
    "",
  ].join("\n");
  const textBody = `${frontMatter}${transcript}\n`;
  writeAtomic(textPath, Buffer.from(textBody, "utf8"));

  return {
    raw: { path: rawPath, bytes: statSync(rawPath).size, sha256: sha256Hex(readFileSync(rawPath)) },
    text: { path: textPath, bytes: Buffer.byteLength(textBody), sha256: sha256Hex(Buffer.from(textBody, "utf8")) },
  };
}

function writeAtomic(path, buffer) {
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(staging, buffer);
    renameSync(staging, path);
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { force: true });
    throw error;
  }
}

export function appendLedger(knowledgeDir, entries) {
  if (entries.length === 0) return { path: join(knowledgeDir, "index.json"), added: 0, total: 0 };
  const path = join(knowledgeDir, "index.json");
  let existing = [];
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      existing = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      throw new TranscribeFailure("bad-ledger", `knowledge/index.json is not valid JSON: ${redact(error.message)}`, {
        remediation: ["repair or remove knowledge/index.json, then rerun transcribe"],
      });
    }
  }
  const byId = new Map(existing.filter((e) => e && typeof e === "object").map((e) => [e.id, e]));
  let added = 0;
  for (const entry of entries) {
    if (!byId.has(entry.id)) added += 1;
    byId.set(entry.id, entry);
  }
  const merged = [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  writeAtomic(path, Buffer.from(`${JSON.stringify(merged, null, 2)}\n`, "utf8"));
  return { path, added, total: merged.length };
}

/**
 * @param {object} options
 * @param {string} options.input        audio/video path (required unless `--capture`)
 * @param {string} [options.capture]    host-provided transcript file
 * @param {Function} [options.fetch]    injected fetch
 * @param {object} [options.env]
 * @param {string} [options.root]
 * @param {string} [options.person]
 * @param {number} [options.maxRetries]
 * @param {Function} [options.sleep]
 * @param {string} [options.now]
 */
export async function transcribe(options = {}) {
  const {
    input,
    capture,
    fetch: fetchImpl = globalThis.fetch,
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    maxRetries = DEFAULT_MAX_RETRIES,
    sleep = defaultSleep,
    now = new Date().toISOString(),
    language,
    producer,
    readFile = readFileSync,
    onProgress = () => {},
  } = options;

  const knowledgeDir = knowledgeRoot({ root, person, family });
  const warnings = [];
  const outputs = [];
  let secrets = [];

  const base = {
    command: COMMAND,
    ok: false,
    inputs: [],
    outputs,
    warnings,
    unavailable: [],
    credential_file: CONFIG_FILE,
  };
  const fail = (failure) => ({
    ok: false,
    exitCode: failure.exitCode ?? 1,
    receipt: scrub(
      {
        ...base,
        ok: false,
        input: input ?? null,
        errors: [redact(failure.message, secrets)],
        unavailable: [
          {
            channel: COMMAND,
            reason: redact(`${failure.reason}: ${failure.message}`, secrets),
            remediation: failure.remediation ?? [],
          },
        ],
      },
      secrets,
    ),
  });

  try {
    if (!input && !capture) {
      throw new TranscribeFailure("missing-input", "transcribe needs an input file", {
        remediation: [
          "pass an audio/video path: distilly transcribe interview.m4a --person lin-gong",
          "or register a host transcript: distilly transcribe interview.m4a --capture transcript.txt",
        ],
      });
    }

    // ── host backend: an explicit capture file, no network at all ────────────
    if (capture) {
      if (!existsSync(capture)) {
        throw new TranscribeFailure("capture-missing", `--capture ${capture} does not exist`, {
          remediation: ["let the host write the transcript first, then rerun with the same --capture path"],
        });
      }
      const transcript = String(readFile(capture, "utf8"));
      if (transcript.trim() === "") {
        throw new TranscribeFailure("capture-empty", `--capture ${capture} is empty; refusing to fabricate a transcript`, {
          remediation: ["re-run the host transcription and pass the non-empty result"],
        });
      }
      const provenance = {
        method: "host-transcribe",
        producer: producer ?? "host:model",
        confidence: "host-reported",
      };
      const name = basename(input ?? capture).replace(/\.[^.]+$/, "");
      const artifacts = writeArtifacts(knowledgeDir, name, {
        rawBytes: Buffer.from(JSON.stringify({ method: provenance.method, producer: provenance.producer, capture: basename(capture) }), "utf8"),
        transcript,
        provenance,
        source: input ? basename(input) : basename(capture),
        fetchedAt: now,
      });
      const ledger = appendLedger(knowledgeDir, [
        {
          id: `${COMMAND}:${slug(name)}:text`,
          kind: "text",
          origin: `text/${slug(name)}.md`,
          source: COMMAND,
          fetched_at: now,
          bytes: artifacts.text.bytes,
          sha256: artifacts.text.sha256,
          credentialed: false,
          method: provenance.method,
          provenance,
          warnings: ["anchors pending: parse-subtitle / harvest assign [k00NN]"],
        },
      ]);
      return {
        ok: true,
        exitCode: 0,
        receipt: scrub(
          {
            ...base,
            ok: true,
            input: input ?? null,
            outputs: [
              { path: artifacts.raw.path, sha256: artifacts.raw.sha256, bytes: artifacts.raw.bytes, kind: "raw" },
              { path: artifacts.text.path, sha256: artifacts.text.sha256, bytes: artifacts.text.bytes, kind: "text" },
            ],
            ledger: { path: ledger.path, added: ledger.added, total: ledger.total },
            provenance,
            backend: "host",
            unavailable: [],
          },
          secrets,
        ),
      };
    }

    // ── http backend ─────────────────────────────────────────────────────────
    const credential = loadCredential({ env, readFile });
    if (!credential.ok) {
      throw new TranscribeFailure(
        "no-backend",
        credential.path
          ? `no API key in ${CONFIG_FILE} and no host capture given`
          : `no API key in the environment and no host capture given`,
        { remediation: REMEDIATION_SETUP },
      );
    }
    secrets = [credential.values.api_key];

    if (!existsSync(input)) {
      throw new TranscribeFailure("input-missing", `input file not found: ${input}`, {
        remediation: ["check the path; nothing was written"],
      });
    }
    const bytes = readFile(input);
    if (bytes.length === 0) {
      throw new TranscribeFailure("input-empty", `input file is empty: ${input}`, {
        remediation: ["nothing to transcribe; nothing was written"],
      });
    }
    if (bytes.length > MAX_UPLOAD_BYTES) {
      throw new TranscribeFailure(
        "input-too-large",
        `input is ${(bytes.length / 1024 / 1024).toFixed(1)}MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB upload limit`,
        {
          remediation: [
            "split the audio (ffmpeg -f segment) and transcribe the parts",
            "or use the host backend: --capture <transcript.txt>",
          ],
        },
      );
    }

    const model = options.model ?? credential.values.model;
    const url = `${String(credential.values.base_url).replace(/\/+$/, "")}/audio/transcriptions`;
    const { body, contentType } = buildMultipart({
      boundaryKey: sha256Hex(bytes).slice(0, 16),
      fields: { model, response_format: "verbose_json", ...(language ? { language } : {}) },
      file: { field: "file", filename: basename(input), bytes, contentType: "application/octet-stream" },
    });

    onProgress(`transcribing ${basename(input)} with ${model}`);
    let attempts = 0;
    for (;;) {
      attempts += 1;
      let response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${credential.values.api_key}`, "content-type": contentType },
          body,
        });
      } catch (error) {
        if (attempts > maxRetries) {
          throw new TranscribeFailure("network-error", `request failed: ${redact(error?.message ?? String(error), secrets)}`, {
            remediation: ["check the network/proxy and retry", ...REMEDIATION_SETUP],
          });
        }
        await sleep(backoffDelay(attempts));
        continue;
      }

      const status = Number(response?.status ?? 0);
      const retryAfterMs = parseRetryAfter(response?.headers?.get?.("retry-after") ?? null);
      if (status === 429 || status >= 500) {
        if (attempts > maxRetries) {
          throw new TranscribeFailure(
            status === 429 ? "rate-limited" : "server-error",
            `HTTP ${status} after ${maxRetries} retries; nothing was written`,
            { remediation: ["retry later", ...REMEDIATION_SETUP] },
          );
        }
        warnings.push(`retry ${attempts} after HTTP ${status} (waited ${backoffDelay(attempts, retryAfterMs)}ms)`);
        await sleep(backoffDelay(attempts, retryAfterMs));
        continue;
      }

      const text = await response.text();
      if (status === 401 || status === 403) {
        throw new TranscribeFailure("unauthorized", `HTTP ${status}: the transcription API rejected the key`, {
          remediation: [
            "regenerate the API key and update the env var / " + CONFIG_FILE,
            "check that the key may call the audio transcriptions endpoint",
          ],
        });
      }
      if (status === 413) {
        throw new TranscribeFailure("payload-too-large", "HTTP 413: the provider rejected the upload size", {
          remediation: ["split the audio into smaller parts", "or use the host backend with --capture"],
        });
      }
      if (status >= 400) {
        throw new TranscribeFailure("http-error", `HTTP ${status}: ${redact(text.slice(0, 200), secrets)}`, {
          remediation: ["check --model / --language and the provider status page", ...REMEDIATION_SETUP],
        });
      }

      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new TranscribeFailure("invalid-json", "the provider returned a non-JSON body; nothing was written", {
          remediation: ["retry later; if it persists the endpoint may not be OpenAI-compatible"],
        });
      }

      const transcript = formatTranscript(payload);
      if (transcript.trim() === "") {
        throw new TranscribeFailure(
          "empty-transcript",
          "the provider returned no text; refusing to write an empty transcript",
          { remediation: ["check the audio has speech, or pass --language explicitly"] },
        );
      }

      const name = basename(input).replace(/\.[^.]+$/, "");
      const provenance = {
        method: "openai-http",
        producer: `${new URL(url).host} (${model})`,
        confidence: "provider-reported",
      };
      const artifacts = writeArtifacts(knowledgeDir, name, {
        rawBytes: Buffer.from(text, "utf8"),
        transcript,
        provenance,
        source: basename(input),
        fetchedAt: now,
      });
      const ledger = appendLedger(knowledgeDir, [
        {
          id: `${COMMAND}:${slug(name)}:text`,
          kind: "text",
          origin: `text/${slug(name)}.md`,
          source: COMMAND,
          fetched_at: now,
          bytes: artifacts.text.bytes,
          sha256: artifacts.text.sha256,
          credentialed: true,
          credential_source: credential.source,
          credential_file: CONFIG_FILE,
          method: provenance.method,
          provenance,
          language: payload?.language ?? language ?? null,
          warnings: ["anchors pending: parse-subtitle / harvest assign [k00NN]"],
        },
      ]);

      return {
        ok: true,
        exitCode: 0,
        receipt: scrub(
          {
            ...base,
            ok: true,
            input,
            outputs: [
              { path: artifacts.raw.path, sha256: artifacts.raw.sha256, bytes: artifacts.raw.bytes, kind: "raw" },
              { path: artifacts.text.path, sha256: artifacts.text.sha256, bytes: artifacts.text.bytes, kind: "text" },
            ],
            ledger: { path: ledger.path, added: ledger.added, total: ledger.total },
            provenance,
            backend: "openai-http",
            attempts,
            unavailable: [],
          },
          secrets,
        ),
      };
    }
  } catch (error) {
    if (!(error instanceof TranscribeFailure)) {
      throw new TranscribeFailure("unexpected", redact(error?.message ?? String(error), secrets), {
        remediation: ["rerun with --json and report the receipt"],
      });
    }
    return fail(error);
  }
}

export const HELP = `distilly transcribe — 可选的转写后端 / optional transcription backend

用法 (zh):
  distilly transcribe <audio|video> [--person <slug>] [--root <dir>] [--language zh]
                                    [--model whisper-1] [--max-retries 3] [--json]
  distilly transcribe <audio|video> --capture <transcript.txt> [--producer <宿主标识>] [--json]

后端：OpenAI 兼容 HTTP（DISTILLY_TRANSCRIBE_API_KEY 或 OPENAI_API_KEY，
      DISTILLY_TRANSCRIBE_BASE_URL 覆盖网关，DISTILLY_TRANSCRIBE_MODEL 选择模型），
      或宿主能力（--capture 显式交回转写文本）。
      两者都没有 → 明确 unavailable + 非零退出，**绝不静默降级、绝不写空产物**。
产物：knowledge/raw/transcribe/<name>.json（原样响应）+ knowledge/text/<name>.md（带 provenance 前言）
      + knowledge/index.json 登记；回执与产物都带 provenance {method, producer, confidence}。
      段落锚点 [k00NN] 由 parse-subtitle / harvest 后续补齐（产物里标注 anchors: pending）。

---
## English
  distilly transcribe <audio|video> [--person <slug>] [--language zh] [--json]
  distilly transcribe <audio|video> --capture <transcript.txt> [--json]

Backends: an OpenAI-compatible HTTP endpoint (env key) or an explicit host capture.
With neither, the command fails loudly with \`unavailable\` — it never silently falls
back and never writes an empty transcript. Artifacts carry provenance
{method, producer, confidence}; anchors are assigned later by parse-subtitle / harvest.
`;

export function parseFlags(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      flags._.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === "json" || name === "help") {
      flags[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    flags[name] = value;
    index += 1;
  }
  return flags;
}

export async function runTranscribeCli(argv, io = {}) {
  const out = io.stdout ?? ((line) => process.stdout.write(`${line}\n`));
  const err = io.stderr ?? ((line) => process.stderr.write(`${line}\n`));

  let flags;
  try {
    flags = parseFlags(argv);
  } catch (error) {
    err(`Error: ${error.message}`);
    return 1;
  }
  if (flags.help || flags._.length === 0) {
    out(HELP);
    return flags.help ? 0 : 1;
  }

  const result = await transcribe({
    input: flags._[0],
    capture: flags.capture,
    fetch: io.fetch ?? globalThis.fetch,
    env: io.env ?? process.env,
    root: flags.root ?? process.cwd(),
    person: flags.person,
    family: flags.family,
    language: flags.language,
    model: flags.model,
    producer: flags.producer,
    maxRetries: flags["max-retries"] ? Number(flags["max-retries"]) : undefined,
    sleep: io.sleep,
    now: io.now,
  });

  if (flags.json) out(JSON.stringify(result.receipt, null, 2));
  if (result.ok) {
    out(`transcribed via ${result.receipt.backend} → ${result.receipt.outputs.map((o) => o.path).join(", ")}`);
    out(`provenance: ${result.receipt.provenance.method} / ${result.receipt.provenance.producer} / ${result.receipt.provenance.confidence}`);
  } else {
    err(`Error: ${result.receipt.errors?.[0] ?? "transcribe failed"}`);
    for (const entry of result.receipt.unavailable) {
      err(`unavailable: ${entry.channel} — ${entry.reason}`);
      for (const step of entry.remediation ?? []) err(`  fix: ${step}`);
    }
  }
  for (const warning of result.receipt.warnings ?? []) err(`warning: ${warning}`);
  return result.exitCode;
}
