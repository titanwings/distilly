/**
 * `collect feishu --mode mcp` — the MCP route to Feishu.
 *
 * Ported from `tools/feishu_mcp_client.py`, which shelled out to
 * `npx -y feishu-mcp --stdio`. Nothing here spawns anything: the transport is a
 * fake, which is exactly what makes the route testable without a tenant. What is
 * asserted is the contract — the tool allowlist, the URL→tool mapping, how a tool
 * result is unwrapped, and that a fetched chat becomes knowledge text with
 * anchors the derivation can cite.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_TOOLS,
  asMessages,
  collectViaMcp,
  extractDocToken,
  parseMcpArgs,
  readToolResult,
  runCollectCli,
  toolForUrl,
} from "../src/collect/feishu-mcp.mjs";

const HERE = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(HERE, "bin", "distilly.mjs");
const SECRET = "FAKE-feishu-mcp-secret-77b1";

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), "dst-mcp-"));
  const home = join(root, "distilly");
  mkdirSync(home, { recursive: true });
  return { root, home, work: join(root, "work"), config: { app_id: "cli_x", app_secret: SECRET } };
}

/** An MCP transport that answers from a script and records every call. */
function fakeTransport(answer) {
  const calls = [];
  return {
    calls,
    async call(tool, args, context) {
      calls.push({ tool, args, envSeen: context?.env });
      return typeof answer === "function" ? answer(tool, args) : answer;
    },
  };
}

function textMessages(count) {
  const items = [];
  for (let index = 0; index < count; index += 1) {
    items.push({
      message_id: `om_${index}`,
      msg_type: "text",
      create_time: String(1_700_000_000_000 + index * 90_000),
      sender: { id: index % 2 === 0 ? "ou_alice" : "ou_bob", sender_type: "user" },
      body: { content: JSON.stringify({ text: `第 ${index} 条：先看数据，再看日志。` }) },
    });
  }
  return items;
}

test("the tool allowlist is closed and the URL mapping matches the Python client", () => {
  assert.deepEqual([...ALLOWED_TOOLS].sort(), [
    "get_chat_messages",
    "get_doc_content",
    "get_spreadsheet_content",
    "get_wiki_node",
    "list_wiki_nodes",
  ]);
  assert.deepEqual(toolForUrl("https://acme.feishu.cn/wiki/WikCnAbc"), { tool: "get_wiki_node", arguments: { token: "WikCnAbc" }, kind: "wiki" });
  assert.deepEqual(toolForUrl("https://acme.feishu.cn/docx/DocXyz1"), { tool: "get_doc_content", arguments: { doc_token: "DocXyz1" }, kind: "docx" });
  assert.deepEqual(toolForUrl("https://acme.feishu.cn/sheets/Sht42"), { tool: "get_spreadsheet_content", arguments: { spreadsheet_token: "Sht42" }, kind: "sheet" });
  assert.deepEqual(extractDocToken("https://acme.feishu.cn/docs/Old1"), { token: "Old1", kind: "doc" });
  assert.throws(() => toolForUrl("https://acme.feishu.cn/base/Bas1"), /no MCP tool reads a base document/);
  assert.throws(() => extractDocToken("https://example.com/not-feishu"), /cannot read a document token/);
});

test("a tool result is unwrapped the way MCP wraps it", () => {
  assert.deepEqual(readToolResult({ result: [{ type: "text", text: "hello" }] }), { text: "hello" });
  assert.deepEqual(readToolResult({ result: "plain" }), { text: "plain" });
  assert.deepEqual(readToolResult({ result: [{ type: "text", text: "a" }, { type: "image", data: "…" }] }), { text: "a" });
  assert.deepEqual(readToolResult({ result: { items: [] } }), { value: { items: [] } });
  assert.match(readToolResult({ error: "scope missing" }).error, /scope missing/);
  assert.deepEqual(asMessages({ text: JSON.stringify([{ message_id: "om_1" }]) }), [{ message_id: "om_1" }]);
  assert.deepEqual(asMessages({ text: JSON.stringify({ items: [{ message_id: "om_2" }] }) }), [{ message_id: "om_2" }]);
  assert.equal(asMessages({ text: "not json at all" }), null);
});

test("a refusen tool never reaches the transport", async () => {
  const box = sandbox();
  const transport = fakeTransport({ result: "should not happen" });
  const result = await collectViaMcp({
    transport,
    config: box.config,
    tool: "send_message",
    arguments: {},
    target: "oc_x",
    root: box.work,
    person: "demo",
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(transport.calls.length, 0, "a non-allowlisted tool must not be called");
  assert.match(result.receipt.unavailable[0].reason, /unknown MCP tool send_message/);
});

test("an MCP chat becomes knowledge text with anchors, and never leaks the secret", async () => {
  const box = sandbox();
  const transport = fakeTransport({ result: [{ type: "text", text: JSON.stringify({ items: textMessages(12) }) }] });
  const result = await collectViaMcp({
    transport,
    config: box.config,
    tool: "get_chat_messages",
    arguments: { chat_id: "oc_demo", page_size: 50 },
    target: "oc_demo",
    root: box.work,
    person: "demo",
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.mode, "mcp");
  assert.equal(result.receipt.tool, "get_chat_messages");
  assert.equal(result.receipt.messages, 12);
  assert.ok(result.receipt.anchors.total >= 12);
  assert.equal(result.receipt.credential_file, "feishu_config.json");
  assert.equal(JSON.stringify(result.receipt).includes(SECRET), false, "the receipt must never carry the secret");

  const textDir = join(box.work, "skills", "colleague", "demo", "knowledge", "text");
  const [name] = readdirSync(textDir);
  const body = readFileSync(join(textDir, name), "utf8");
  assert.match(body, /^\[k0001\] 2023-11-14T22:13:20\.000Z ou_alice：第 0 条/m);

  const ledger = JSON.parse(readFileSync(join(box.work, "skills", "colleague", "demo", "knowledge", "index.json"), "utf8"));
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].method, "mcp-get_chat_messages");
  assert.equal(ledger[0].credentialed, true);
  assert.equal(ledger[0].credential_file, "feishu_config.json");
  assert.ok(ledger[0].locations.text);

  // The derivation reads it: 12 messages is above its minimum sample.
  const retro = spawnSync("node", [BIN, "retrospect", "--person", "demo", "--json"], {
    encoding: "utf8",
    cwd: box.work,
    env: { ...process.env, DISTILLY_HOME: box.home },
  });
  assert.equal(retro.status, 0, retro.stderr);
  const receipt = JSON.parse(retro.stdout.slice(retro.stdout.indexOf("{")));
  assert.ok(receipt.anchors.cited > 0, JSON.stringify(receipt.anchors));
});

test("a MCP error is reported, never turned into an empty document", async () => {
  const box = sandbox();
  const transport = fakeTransport({ error: "app scope im:message:readonly is missing" });
  const result = await collectViaMcp({
    transport,
    config: box.config,
    tool: "get_chat_messages",
    arguments: { chat_id: "oc_demo" },
    target: "oc_demo",
    root: box.work,
    person: "demo",
  });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.receipt.errors[0], /scope im:message:readonly/);
  assert.equal(existsSync(join(box.work, "skills", "colleague", "demo", "knowledge", "text")), false, "no file may be written");
});

test("a fetched document becomes paragraphs with anchors", async () => {
  const box = sandbox();
  const transport = fakeTransport({ result: [{ type: "text", text: "第一段：结论先行。\n第二段：为什么这样做。\n第三段：怎么回滚。" }] });
  const result = await collectViaMcp({
    transport,
    config: box.config,
    tool: "get_doc_content",
    arguments: { doc_token: "DocXyz1" },
    target: "https://acme.feishu.cn/docx/DocXyz1",
    root: box.work,
    person: "demo",
    now: "2026-09-13T00:00:00.000Z",
  });
  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  const textDir = join(box.work, "skills", "colleague", "demo", "knowledge", "text");
  const body = readFileSync(join(textDir, readdirSync(textDir)[0]), "utf8");
  assert.match(body, /^\[k0001\] 第一段：结论先行。$/m);
  assert.match(body, /^\[k0002\] 第二段：为什么这样做。$/m);
});

test("cli: --mode mcp routes to the MCP client and needs a target", async () => {
  assert.match(parseMcpArgs([]).error, /needs --url .* or --chat-id/);
  assert.match(parseMcpArgs(["--chat-id", "oc_x"]).error, /--person is required/);
  assert.match(parseMcpArgs(["--mode", "api"]).error, /--mode mcp only/);

  const box = sandbox();
  const transport = fakeTransport({ result: [{ type: "text", text: JSON.stringify({ items: textMessages(3) }) }] });
  const result = await runCollectCli(["--mode", "mcp", "--chat-id", "oc_demo", "--person", "demo", "--base-dir", box.work, "--json"], { transport });
  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(transport.calls.length, 1);
  assert.deepEqual(transport.calls[0].args, { chat_id: "oc_demo", page_size: 50 });
  const lines = [];
  const human = await runCollectCli(["--mode", "mcp", "--chat-id", "oc_demo", "--person", "demo", "--base-dir", box.work], {
    transport,
    stdout: (line) => lines.push(line),
    stderr: () => {},
  });
  assert.equal(human.ok, true);
  assert.match(lines.join("\n"), /collect feishu \(mcp\): 3 message\(s\) via get_chat_messages/);
});

test("cli: a missing credential fails loudly and names the config file only", async () => {
  const box = sandbox();
  const missingHome = join(box.root, "empty-home");
  mkdirSync(missingHome, { recursive: true });
  const previous = process.env.DISTILLY_HOME;
  process.env.DISTILLY_HOME = missingHome;
  try {
    const result = await runCollectCli(["--mode", "mcp", "--chat-id", "oc_demo", "--person", "demo", "--base-dir", box.work], {
      transport: fakeTransport({ result: "unused" }),
      stdout: () => {},
      stderr: () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.credential_file, "feishu_config.json");
    assert.equal(JSON.stringify(result.receipt).includes(SECRET), false);
    assert.equal(existsSync(join(box.work, "skills")), false, "nothing may be written without a credential");
  } finally {
    if (previous === undefined) delete process.env.DISTILLY_HOME;
    else process.env.DISTILLY_HOME = previous;
  }
});
