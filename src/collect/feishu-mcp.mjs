/**
 * feishu-mcp.mjs — the MCP route to Feishu (ported from `tools/feishu_mcp_client.py`).
 *
 * The Python client shelled out to `npx -y feishu-mcp --stdio` once per call,
 * passing the app credential through the environment, and printed the tool's text
 * result. The port keeps that contract and changes three things the pipeline
 * needs:
 *
 *  - the transport is **injected** (`transport.call(tool, args)`), so the whole
 *    route is testable without npx, a tenant or a network;
 *  - the credential only ever travels in the child process environment, never in
 *    argv, and a receipt can only ever name the config file (`feishu_config.json`);
 *  - the tool result is turned into a **document** (raw bytes + text + anchors),
 *    so an MCP-collected chat or doc lands in the evidence spine exactly like a
 *    file harvest does.
 *
 * Read-only by construction: the tool allowlist is closed, and an unknown tool is
 * refused before anything is spawned.
 */

import { spawn } from "node:child_process";
import { join, resolve } from "node:path";

import { KnowledgeStore, sha256Hex } from "../knowledge/store.mjs";
import { loadLedger, recordDocument, saveLedger } from "../knowledge/ledger.mjs";
import { SourceFile, buildDocument, recordsFromCharSpans } from "../parse/common.mjs";
import { parseFeishu } from "../parse/feishu.mjs";
import { CONFIG_FILE, loadCredential, redact } from "./feishu.mjs";

export const CHANNEL = "feishu";
export const MODE = "mcp";
export const MCP_COMMAND = ["npx", "-y", "feishu-mcp", "--stdio"];

/** The only tools this client may call. Adding one is a deliberate act. */
export const ALLOWED_TOOLS = Object.freeze([
  "get_wiki_node",
  "get_doc_content",
  "get_spreadsheet_content",
  "get_chat_messages",
  "list_wiki_nodes",
]);

/** URL → (token, kind), the same patterns the Python client used. */
const URL_PATTERNS = [
  [/\/wiki\/([A-Za-z0-9]+)/, "wiki"],
  [/\/docx\/([A-Za-z0-9]+)/, "docx"],
  [/\/docs\/([A-Za-z0-9]+)/, "doc"],
  [/\/sheets\/([A-Za-z0-9]+)/, "sheet"],
  [/\/base\/([A-Za-z0-9]+)/, "base"],
];

export function extractDocToken(url) {
  for (const [pattern, kind] of URL_PATTERNS) {
    const match = pattern.exec(String(url));
    if (match) return { token: match[1], kind };
  }
  throw new Error(`cannot read a document token out of the URL: ${url}`);
}

/** Which tool a URL maps to, and with which arguments. */
export function toolForUrl(url) {
  const { token, kind } = extractDocToken(url);
  if (kind === "wiki") return { tool: "get_wiki_node", arguments: { token }, kind };
  if (kind === "docx" || kind === "doc") return { tool: "get_doc_content", arguments: { doc_token: token }, kind };
  if (kind === "sheet") return { tool: "get_spreadsheet_content", arguments: { spreadsheet_token: token }, kind };
  throw new Error(`no MCP tool reads a ${kind} document`);
}

/**
 * The default transport: one `npx -y feishu-mcp --stdio` process per call, JSON-RPC
 * over stdin, credentials in the environment only.
 */
export function spawnMcpTransport({ command = MCP_COMMAND, timeoutMs = 30_000, spawnImpl = spawn } = {}) {
  return {
    async call(tool, args, { config, env = process.env } = {}) {
      if (!ALLOWED_TOOLS.includes(tool)) throw new Error(`tool ${tool} is not on the allowlist`);
      const payload = JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { name: tool, arguments: args }, id: 1 });
      const childEnv = {
        ...env,
        FEISHU_APP_ID: config.app_id ?? "",
        FEISHU_APP_SECRET: config.app_secret ?? "",
        ...(config.mode === "user" && config.user_token ? { FEISHU_USER_ACCESS_TOKEN: config.user_token } : {}),
      };
      return await new Promise((settle, fail) => {
        const child = spawnImpl(command[0], command.slice(1), { env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill?.();
          fail(new Error(`feishu-mcp did not answer within ${timeoutMs}ms`));
        }, timeoutMs);
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", (error) => {
          clearTimeout(timer);
          fail(new Error(error.code === "ENOENT" ? "npx was not found; install Node.js, or npm install -g feishu-mcp" : error.message));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            fail(new Error(`feishu-mcp exited ${code}: ${stderr.slice(0, 200) || "no stderr"}`));
            return;
          }
          try {
            settle(JSON.parse(stdout.slice(stdout.indexOf("{"))));
          } catch (error) {
            fail(new Error(`feishu-mcp returned a non-JSON answer: ${error.message}`));
          }
        });
        child.stdin.end(payload);
      });
    },
  };
}

/**
 * MCP tool results wrap their payload: `{result: [{type:"text", text:"…"}]}` or a
 * plain string, and an error comes back as `{error: …}`. Both shapes are read the
 * same way the Python client read them.
 */
export function readToolResult(result) {
  if (result && typeof result === "object" && "error" in result && result.error) {
    return { error: typeof result.error === "string" ? result.error : JSON.stringify(result.error) };
  }
  const payload = result && typeof result === "object" && "result" in result ? result.result : result;
  if (typeof payload === "string") return { text: payload };
  if (Array.isArray(payload)) {
    const parts = payload
      .map((item) => (item && typeof item === "object" && item.type === "text" ? item.text : null))
      .filter((text) => typeof text === "string");
    if (parts.length > 0) return { text: parts.join("\n") };
    return { value: payload };
  }
  if (payload && typeof payload === "object") return { value: payload };
  return { text: String(payload ?? "") };
}

/** Message arrays arrive as text (a JSON string) or already parsed. */
export function asMessages({ text, value }) {
  if (Array.isArray(value)) return value;
  if (typeof text === "string") {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
    } catch {
      return null;
    }
  }
  return null;
}

/** A document whose paragraphs are the lines of a fetched text (docs, sheets, wiki). */
function documentFromText({ text, name, source, method, kind, credentialed, credentialSource, origin }) {
  const file = new SourceFile({ path: name, name, raw: new Uint8Array(Buffer.from(text, "utf8")) });
  const spans = [];
  const pattern = /[^\n]+/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    spans.push({ text: match[0], charStart: match.index, charEnd: match.index + match[0].length, kind: "paragraph" });
  }
  return buildDocument({
    parser: "feishu-mcp",
    format: kind,
    kind: "doc",
    method,
    credentialed,
    credential_source: credentialSource,
    credential_file: CONFIG_FILE,
    source,
    origin: origin ?? name,
    files: [file],
    records: recordsFromCharSpans(file, spans),
  });
}

/**
 * Run one MCP read and record it.
 *
 * @param {{transport: object, config: object, tool: string, arguments: object, target: string,
 *          root: string, person: string, family?: string, source?: string, now?: string,
 *          env?: object, label?: string}} input
 */
/** Parse `collect feishu --mode mcp` arguments; returns `{options}` or `{error}`. */
export function parseMcpArgs(argv) {
  const options = { person: null, baseDir: process.cwd(), url: null, chatId: null, target: null, limit: 500, json: false, label: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--mode") {
      const value = argv[index + 1];
      if (value !== "mcp") return { error: `feishu-mcp handles --mode mcp only (got ${value ?? "nothing"})` };
      index += 1;
    } else if (["--person", "--base-dir", "--url", "--chat-id", "--target", "--limit", "--label"].includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined) return { error: `${arg} requires a value` };
      const key = { "--person": "person", "--base-dir": "baseDir", "--url": "url", "--chat-id": "chatId", "--target": "target", "--limit": "limit", "--label": "label" }[arg];
      options[key] = key === "limit" ? Number(value) : value;
      index += 1;
    } else if (arg.startsWith("--")) return { error: `unknown option: ${arg}` };
    else if (!options.chatId) options.chatId = arg;
    else return { error: `unexpected argument: ${arg}` };
  }
  if (!options.url && !options.chatId) return { error: "collect feishu --mode mcp needs --url <doc|wiki|sheet> or --chat-id <oc_…>" };
  if (!options.person) return { error: "--person is required" };
  return { options };
}

export async function collectViaMcp(input) {
  const {
    transport,
    config,
    tool,
    arguments: toolArgs,
    target,
    root,
    person,
    family = "colleague",
    source = CHANNEL,
    now = new Date().toISOString(),
    env = process.env,
  } = input;

  if (!ALLOWED_TOOLS.includes(tool)) {
    return { ok: false, exitCode: 2, receipt: { command: "collect", channel: CHANNEL, mode: MODE, ok: false, warnings: [], errors: [`tool ${tool} is not on the allowlist`], unavailable: [{ channel: CHANNEL, reason: `unknown MCP tool ${tool}`, remediation: [`allowed: ${ALLOWED_TOOLS.join(", ")}`] }] } };
  }

  const warnings = [];
  const secrets = [config.app_secret, config.user_token].filter(Boolean);
  let result;
  try {
    result = await transport.call(tool, toolArgs, { config, env });
  } catch (error) {
    return {
      ok: false,
      exitCode: 1,
      receipt: {
        command: "collect",
        channel: CHANNEL,
        mode: MODE,
        ok: false,
        person: person ?? null,
        target: target ?? null,
        credential_file: CONFIG_FILE,
        warnings,
        errors: [redact(error.message, secrets)],
        unavailable: [
          {
            channel: CHANNEL,
            reason: redact(`MCP call failed: ${error.message}`, secrets),
            remediation: ["npm install -g feishu-mcp", "check the app scopes: docs:doc:readonly, wiki:wiki:readonly, im:message:readonly"],
          },
        ],
      },
    };
  }

  const read = readToolResult(result);
  if (read.error) {
    return {
      ok: false,
      exitCode: 1,
      receipt: {
        command: "collect",
        channel: CHANNEL,
        mode: MODE,
        ok: false,
        person: person ?? null,
        target: target ?? null,
        credential_file: CONFIG_FILE,
        warnings,
        errors: [redact(read.error, secrets)],
        unavailable: [{ channel: CHANNEL, reason: redact(`MCP returned an error: ${read.error}`, secrets), remediation: ["check the token scopes and the target id"] }],
      },
    };
  }

  const messages = asMessages(read);
  const label = input.label ?? `${tool}-${String(target ?? "result").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40)}`;
  const rawText = typeof read.text === "string" ? read.text : JSON.stringify(read.value ?? messages ?? "", null, 2);

  const store = new KnowledgeStore(join(resolve(root), "skills", family, person));
  const ledger = loadLedger(store);

  let document;
  if (messages) {
    const file = new SourceFile({ path: `${label}.json`, name: `${label}.json`, raw: new Uint8Array(Buffer.from(JSON.stringify(messages), "utf8")) });
    document = parseFeishu(file, {
      source,
      method: `mcp-${tool}`,
      credentialed: true,
      credential_source: input.credentialSource ?? "feishu_config.json",
      credential_file: CONFIG_FILE,
    });
    warnings.push(...(document.warnings ?? []).map((warning) => warning.message ?? warning));
  } else {
    document = documentFromText({
      text: rawText,
      name: `${label}.txt`,
      source,
      method: `mcp-${tool}`,
      kind: tool === "get_wiki_node" ? "wiki" : tool === "get_spreadsheet_content" ? "sheet" : "docx",
      credentialed: true,
      credentialSource: input.credentialSource ?? "feishu_config.json",
      origin: target ?? label,
    });
  }

  const recorded = recordDocument(store, ledger, { ...document, fetched_at: now }, { fetched_at: now });
  saveLedger(store, ledger);
  const raw = recorded.written.files[0];
  const text = recorded.written.text;
  const outputs = [
    ...(raw ? [{ path: raw.relativePath, sha256: raw.sha256, bytes: raw.bytes, kind: "raw" }] : []),
    ...(text ? [{ path: text.relativePath, sha256: text.sha256, bytes: text.bytes, kind: "text" }] : []),
  ];

  const receipt = {
    command: "collect",
    channel: CHANNEL,
    mode: MODE,
    ok: true,
    person,
    target: target ?? null,
    tool,
    credential_file: CONFIG_FILE,
    messages: messages ? messages.length : 0,
    anchors: { total: recorded.entry?.anchor_count ?? 0, cited: 0 },
    outputs,
    warnings,
    unavailable: [],
  };
  return { ok: true, exitCode: 0, receipt: secrets.reduce((value, secret) => redact(JSON.stringify(value), [secret]) && value, receipt) };
}

/** Messages from `get_chat_messages` when the tool returns raw API items. */
export function normaliseMcpMessages(items) {
  return (items ?? []).map((item) => ({
    message_id: item.message_id ?? item.id ?? null,
    msg_type: item.msg_type ?? (item.content ? "text" : "unknown"),
    create_time: item.create_time ?? item.timestamp ?? null,
    sender: item.sender ?? { id: item.sender_id ?? null },
    body: item.body ?? { content: item.content ?? "" },
  }));
}

/**
 * `distilly collect feishu --mode mcp …`
 *
 * Mirrors the other channels' CLI entry: parse, load the credential (naming the
 * config file, never its contents), route one allowed tool call through the MCP
 * client, and print either the receipt or a human line. `io.transport` lets the
 * tests drive the client without spawning `npx`.
 */
export async function runCollectCli(argv, io = {}) {
  const out = typeof io.stdout === "function" ? io.stdout : (line) => process.stdout.write(`${line}\n`);
  const err = typeof io.stderr === "function" ? io.stderr : (line) => process.stderr.write(`${line}\n`);
  const parsed = parseMcpArgs(argv);
  if (parsed.error) {
    const receipt = {
      command: "collect",
      channel: CHANNEL,
      mode: MODE,
      ok: false,
      credential_file: CONFIG_FILE,
      warnings: [],
      outputs: [],
      anchors: { total: 0, cited: 0 },
      errors: [parsed.error],
      unavailable: [{ channel: CHANNEL, reason: parsed.error, remediation: ["distilly collect feishu --help"] }],
    };
    if (!parsed.options?.json) err(`collect feishu (mcp): ${parsed.error}`);
    else out(JSON.stringify(receipt, null, 2));
    return { ok: false, exitCode: 2, receipt };
  }

  const { options } = parsed;
  // `loadCredential` *throws* a `CollectFailure` when there is no credential at all
  // (rather than returning empty values), so the CLI has to catch it to produce the
  // contract-shaped failure with `credential_file` named and no secret in it.
  let credential = null;
  let credentialError = null;
  try {
    credential = loadCredential({ configFile: CONFIG_FILE, envKeys: ["FEISHU_APP_ID", "FEISHU_APP_SECRET"], fields: ["app_id", "app_secret"], env: io.env ?? process.env });
  } catch (error) {
    credentialError = error;
  }
  if (credentialError || !credential.values?.app_id || !credential.values?.app_secret) {
    const reason = credentialError ? credentialError.message : `no usable credential: ${CONFIG_FILE} is missing or incomplete`;
    const receipt = {
      command: "collect",
      channel: CHANNEL,
      mode: MODE,
      ok: false,
      credential_file: CONFIG_FILE,
      warnings: [],
      outputs: [],
      anchors: { total: 0, cited: 0 },
      errors: [reason],
      unavailable: [
        {
          channel: CHANNEL,
          reason,
          remediation: credentialError?.remediation ?? [`create ~/.distilly/${CONFIG_FILE} with app_id and app_secret`, "or export FEISHU_APP_ID / FEISHU_APP_SECRET"],
        },
      ],
    };
    if (options.json) out(JSON.stringify(receipt, null, 2));
    else {
      err(`collect feishu (mcp): ${reason}`);
      for (const step of receipt.unavailable[0].remediation) err(`  fix: ${step}`);
    }
    return { ok: false, exitCode: 1, receipt };
  }

  // A chat id and a document URL route to different tools: `toolForUrl` parses a
  // *document* URL and has nothing to say about `oc_…`, so asking it about a chat
  // id threw before any call was made.
  const routed = options.chatId
    ? { tool: "get_chat_messages", arguments: { chat_id: options.chatId, page_size: 50 }, kind: "chat" }
    : toolForUrl(options.url);
  const tool = routed.tool;
  const target = options.target ?? options.chatId ?? extractDocToken(options.url).token;
  const result = await collectViaMcp({
    transport: io.transport,
    config: credential.values,
    tool,
    arguments: routed.arguments,
    target,
    root: options.baseDir,
    person: options.person,
    env: io.env ?? process.env,
  });

  if (options.json) out(JSON.stringify(result.receipt, null, 2));
  else if (result.ok) out(`collect feishu (mcp): ${result.receipt.messages} message(s) via ${result.receipt.tool}`);
  else {
    for (const failure of result.receipt.errors ?? []) err(`collect feishu (mcp): ${failure}`);
    for (const item of result.receipt.unavailable ?? []) for (const step of item.remediation ?? []) err(`  fix: ${step}`);
  }
  return result;
}
