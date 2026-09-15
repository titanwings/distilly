/**
 * discord.mjs — the Discord channel, read through the REST API with a bot token.
 *
 * Legacies: `tools/discord_collector.py` fetched messages for a channel and wrote
 * them to a text file. This keeps the read path and changes the shape of the
 * output: raw pages verbatim in `knowledge/raw/discord/`, the same pages turned
 * into anchored text by the existing Discord export parser (`parse/chat.mjs`), and
 * one ledger entry per page — so a collected channel is immediately derivable.
 *
 * Read-only by construction: the allowlist is GET-only, and a Discord bot token
 * cannot delete or post through any code path here.
 */

import { join, resolve } from "node:path";

import { KnowledgeStore } from "../knowledge/store.mjs";
import { loadLedger, recordDocument, saveLedger } from "../knowledge/ledger.mjs";
import { SourceFile } from "../parse/common.mjs";
import { parseChat } from "../parse/chat.mjs";
import {
  CollectFailure,
  DEFAULT_MAX_PAGES,
  DEFAULT_MAX_RETRIES,
  assertReadOnly,
  clearCheckpoint,
  loadCredential,
  readCheckpoint,
  redact,
  requestJson,
  scrub,
  writeCheckpoint,
  writeRaw,
  knowledgeRoot,
} from "./kit.mjs";

export const CHANNEL = "discord";
export const CONFIG_FILE = "discord_config.json";
export const ENV_KEYS = ["DISTILLY_DISCORD_BOT_TOKEN", "DISCORD_BOT_TOKEN"];
export const DEFAULT_BASE_URL = "https://discord.com/api/v10";
export const DEFAULT_PAGE_SIZE = 100;

/**
 * Every call this module may make. Discord's read API is GET-only, so the list is
 * GET-only too — a mutating verb is refused before a socket is opened.
 */
export const ALLOWED_CALLS = [
  { method: "GET", path: "/api/v10/users/@me" },
  { method: "GET", path: "/api/v10/guilds/" },
  { method: "GET", path: "/api/v10/channels/" },
];

const REMEDIATION = [
  "create a bot at https://discord.com/developers/applications, give it the “Read Message History” permission",
  `write ~/.distilly/${CONFIG_FILE} as {"bot_token": "…"}`,
];

/** Discord's rate limits answer 429 with a JSON `retry_after` in **seconds**. */
export const parseDiscordRetryAfter = (json) => {
  const value = json?.retry_after;
  return typeof value === "number" ? value * 1000 : null;
};

/**
 * @param {{fetch?: Function, env?: object, root?: string, person: string, family?: string,
 *          channelId: string, limit?: number, maxPages?: number, maxRetries?: number,
 *          since?: string, resume?: boolean, sleep?: Function, now?: string, baseUrl?: string}} options
 */
export async function collect(options = {}) {
  const {
    fetch: fetchImpl = globalThis.fetch,
    env = process.env,
    root = process.cwd(),
    person,
    family = "colleague",
    channelId,
    limit = DEFAULT_PAGE_SIZE,
    maxPages = DEFAULT_MAX_PAGES,
    maxRetries = DEFAULT_MAX_RETRIES,
    since,
    resume = true,
    sleep,
    now = new Date().toISOString(),
    baseUrl = env?.DISTILLY_DISCORD_BASE_URL || DEFAULT_BASE_URL,
  } = options;

  const outputs = [];
  const warnings = [];
  const retries = [];
  const base = {
    command: "collect",
    channel: CHANNEL,
    mode: "api",
    ok: false,
    inputs: [],
    outputs,
    warnings,
    unavailable: [],
    credential_file: CONFIG_FILE,
    retries,
  };
  let secrets = [];
  const fail = (failure) => ({
    ok: false,
    exitCode: failure.exitCode ?? 1,
    receipt: scrub(
      {
        ...base,
        ok: false,
        person: person ?? null,
        channel_id: channelId ?? null,
        errors: [redact(failure.message, secrets)],
        unavailable: [{ channel: CHANNEL, reason: redact(`${failure.reason}: ${failure.message}`, secrets), remediation: failure.remediation ?? [] }],
      },
      secrets,
    ),
  });

  try {
    if (!person) throw new CollectFailure("missing-person", "collect discord needs --person <slug>", { remediation: ["pass --person"] });
    if (!channelId) {
      throw new CollectFailure("missing-target", "collect discord needs --channel-id <id>", {
        remediation: ["enable Developer Mode in Discord and copy the channel id"],
      });
    }

    const credential = loadCredential({ env, configFile: CONFIG_FILE, envKeys: ENV_KEYS, fields: ["bot_token"] });
    secrets = [credential.values.bot_token];
    base.credential_source = credential.source;

    const knowledgeDir = knowledgeRoot({ root, person, family });
    const store = new KnowledgeStore(join(resolve(root), "skills", family, person));
    const ledger = loadLedger(store);
    const checkpoint = resume ? readCheckpoint({ env, root, channel: CHANNEL, target: channelId }) : null;
    let cursor = since ?? checkpoint?.cursor ?? null;
    if (checkpoint?.cursor && since === undefined) warnings.push(`resuming from checkpoint (${checkpoint.pages ?? 0} page(s) done)`);

    const pageSize = Math.min(Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE), 100);
    const headers = { authorization: `Bot ${credential.values.bot_token}`, accept: "application/json" };
    let pages = 0;
    let items = 0;
    let requests = 0;
    const textEntries = [];
    let anchors = 0;

    for (;;) {
      if (pages >= maxPages) {
        warnings.push(`stopped after --max-pages ${maxPages}; rerun to continue from the cursor`);
        break;
      }
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (cursor) params.set("before", cursor);
      const url = `${baseUrl}/channels/${encodeURIComponent(channelId)}/messages?${params.toString()}`;
      const response = await requestJson({
        fetchImpl,
        url,
        method: "GET",
        headers,
        maxRetries,
        ...(sleep ? { sleep } : {}),
        secrets,
        allowlist: ALLOWED_CALLS,
        channel: CHANNEL,
        onRetry: (info) => {
          retries.push(info);
          warnings.push(`retry ${info.attempt} after ${info.reason} (waited ${info.delayMs}ms)`);
        },
      });
      requests += 1;
      const page = Array.isArray(response.json) ? response.json : [];
      pages += 1;
      items += page.length;

      const name = `${channelId}-p${String(pages).padStart(3, "0")}`;
      const stored = writeRaw(knowledgeDir, CHANNEL, name, response.text);
      outputs.push({ path: stored.relativePath, sha256: stored.sha256, bytes: stored.bytes, kind: "raw" });

      // The Discord export parser already knows this message shape, so the same
      // page that was stored raw is what the derivation reads as anchored text.
      try {
        const file = new SourceFile({ path: `${name}.json`, name: `${name}.json`, raw: new Uint8Array(Buffer.from(response.text, "utf8")) });
        const document = parseChat(file, {
          source: CHANNEL,
          method: "api-bot-token",
          credentialed: true,
          credential_source: credential.source,
          credential_file: CONFIG_FILE,
          format: "discord-messages",
        });
        for (const warning of document.warnings ?? []) warnings.push(`${name}: ${warning.message ?? warning}`);
        const recorded = recordDocument(store, ledger, { ...document, fetched_at: now }, { fetched_at: now });
        if (recorded.written.text) {
          outputs.push({
            path: recorded.written.text.relativePath,
            sha256: recorded.written.text.sha256,
            bytes: recorded.written.text.bytes,
            kind: "text",
          });
          textEntries.push(recorded.entry?.id ?? null);
          anchors += recorded.entry?.anchor_count ?? 0;
        }
      } catch (error) {
        warnings.push(`${name}: ${redact(error.message, secrets)}; the raw page is stored, the text is not`);
      }

      if (page.length === 0) break;
      cursor = page[page.length - 1].id ?? null;
      if (!cursor) break;
      if (page.length < pageSize) break;
      if (resume) writeCheckpoint({ env, root, channel: CHANNEL, target: channelId }, { channel: CHANNEL, target: channelId, cursor, pages, items, updated_at: now });
    }

    saveLedger(store, ledger);
    if (resume) clearCheckpoint({ env, root, channel: CHANNEL, target: channelId });

    const receipt = {
      ...base,
      ok: true,
      person,
      channel_id: channelId,
      pages,
      items,
      requests,
      cursor,
      text_entries: textEntries.filter(Boolean),
      anchors: { total: anchors, cited: 0 },
      ledger: { path: store.ledgerPath, total: ledger.length },
      unavailable: [],
    };
    return { ok: true, exitCode: 0, receipt: scrub(receipt, secrets) };
  } catch (error) {
    if (!(error instanceof CollectFailure)) {
      throw new CollectFailure("unexpected", redact(error?.message ?? String(error), secrets), {
        remediation: ["rerun with --json and report the receipt"],
      });
    }
    return fail(error);
  }
}

/* ------------------------------------------------------------------ CLI */

export function parseDiscordArgs(argv) {
  const options = { person: null, baseDir: process.cwd(), channelId: null, limit: DEFAULT_PAGE_SIZE, maxPages: DEFAULT_MAX_PAGES, json: false, since: null };
  const takesValue = { "--person": "person", "--base-dir": "baseDir", "--channel-id": "channelId", "--limit": "limit", "--max-pages": "maxPages", "--since": "since" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (takesValue[arg]) {
      const value = argv[index + 1];
      if (value === undefined) return { error: `${arg} requires a value` };
      options[takesValue[arg]] = /limit|maxPages/.test(takesValue[arg]) ? Number(value) : value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else if (!options.channelId) options.channelId = arg;
    else return { error: `unexpected argument: ${arg}` };
  }
  if (!options.person) return { error: "--person is required" };
  if (!options.channelId) return { error: "collect discord needs --channel-id <id>" };
  return { options };
}

export async function runCollectCli(argv, io = {}) {
  const out = typeof io.stdout === "function" ? io.stdout : (line) => process.stdout.write(`${line}\n`);
  const err = typeof io.stderr === "function" ? io.stderr : (line) => process.stderr.write(`${line}\n`);
  const parsed = parseDiscordArgs(argv);
  if (parsed.error) {
    return {
      ok: false,
      exitCode: 2,
      receipt: {
        command: "collect",
        channel: CHANNEL,
        mode: "api",
        ok: false,
        person: null,
        warnings: [],
        outputs: [],
        anchors: { total: 0, cited: 0 },
        unavailable: [{ channel: CHANNEL, reason: parsed.error, remediation: ["distilly collect discord --help"] }],
        error: { code: "collect/usage", message: parsed.error, remedy: "distilly collect discord --help" },
      },
    };
  }
  const { options } = parsed;
  const result = await collect({
    root: options.baseDir,
    person: options.person,
    channelId: options.channelId,
    limit: options.limit,
    maxPages: options.maxPages,
    since: options.since,
    ...(io.fetch ? { fetch: io.fetch } : {}),
  });
  if (!options.json) {
    if (result.ok) {
      out(`collect discord: ${result.receipt.items} message(s) in ${result.receipt.pages} page(s), ${result.receipt.anchors.total} anchor(s)`);
      for (const output of result.receipt.outputs) out(`  ${output.kind}: ${output.path}`);
    }
    for (const warning of result.receipt.warnings ?? []) err(`  warning: ${warning}`);
    for (const failure of result.receipt.unavailable ?? []) {
      err(`  unavailable: ${failure.reason}`);
      for (const step of failure.remediation ?? []) err(`    ${step}`);
    }
  }
  return result;
}

export { REMEDIATION as DISCORD_REMEDIATION };
