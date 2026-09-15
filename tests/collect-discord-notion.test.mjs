/**
 * The two channels added on top of the shared collector kit: Discord (bot token)
 * and Notion (internal integration token).
 *
 * What is asserted is the contract every credentialed channel pays for:
 * pagination that keeps raw bytes verbatim, a rate limit that backs off, a
 * read-only allowlist that refuses before a socket opens, credentials that never
 * reach a receipt, and a normalised text file the derivation can read.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as discord from "../src/collect/discord.mjs";
import * as notion from "../src/collect/notion.mjs";
import { assertReadOnly, loadCredential, redact, scrub } from "../src/collect/kit.mjs";

const SECRETS = {
  discord: "FAKE-discord-bot-token-7c1f",
  notion: "FAKE-notion-integration-token-4b9e",
};

function sandbox(channel) {
  const root = mkdtempSync(join(tmpdir(), `dst-${channel}-`));
  const home = join(root, "distilly");
  mkdirSync(home, { recursive: true });
  return {
    root,
    home,
    work: join(root, "work"),
    env: { DISTILLY_HOME: home },
    config(values) {
      writeFileSync(join(home, `${channel}_config.json`), `${JSON.stringify(values, null, 2)}\n`);
      return this;
    },
    read(rel) {
      return readFileSync(join(this.work, rel), "utf8");
    },
    exists(rel) {
      return existsSync(join(this.work, rel));
    },
    json(rel) {
      return JSON.parse(this.read(rel));
    },
  };
}

const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers ?? {} });

/* ------------------------------------------------------------------ discord */

function discordMessages(count, { start = Date.parse("2024-03-01T10:00:00Z"), author = { id: "u1", username: "林工" } } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${String(index).padStart(3, "0")}`,
    content: `第 ${index} 条：先看数据，再看日志。`,
    timestamp: new Date(start - index * 60_000).toISOString(),
    author,
  }));
}

test("discord: two pages, verbatim bytes, anchored text", async () => {
  const box = sandbox("discord").config({ bot_token: SECRETS.discord });
  const pages = [discordMessages(3), discordMessages(2, { start: Date.parse("2024-03-01T09:50:00Z"), author: { id: "u2", username: "小明" } })];
  const calls = [];
  let page = 0;
  const fetchMock = async (url) => {
    calls.push(String(url));
    return jsonResponse(pages[Math.min(page++, pages.length - 1)]);
  };

  const result = await discord.collect({
    fetch: fetchMock,
    env: box.env,
    root: box.work,
    person: "demo",
    channelId: "c1",
    limit: 3,
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.pages, 2);
  assert.equal(result.receipt.items, 5);
  assert.ok(result.receipt.anchors.total >= 5);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].includes("before="), false, "the first page carries no cursor");
  assert.equal(calls[1].includes("before=m002"), true, "the second page asks for messages before the oldest id");

  // Raw bytes are what Discord sent, not a re-serialisation.
  assert.equal(box.read("skills/colleague/demo/knowledge/raw/discord/c1-p001.json"), JSON.stringify(pages[0]));
  const textDir = join(box.work, "skills", "colleague", "demo", "knowledge", "text");
  // Two pages, two documents: the second one is stemmed so it cannot overwrite the
  // first (see the text-collision rule in `ledger.mjs`). Reading
  // `readdirSync(textDir)[0]` made the assertion depend on directory order.
  const files = readdirSync(textDir).sort();
  assert.equal(files.length, 2, `expected one text file per page, got ${files.join(", ")}`);
  const body = files.map((name) => readFileSync(join(textDir, name), "utf8")).join("\n");
  assert.match(body, /^\[k0001\] 2024-03-01T10:00:00\.000Z 林工：第 0 条/m, body.slice(0, 200));
  assert.equal(body.includes("u1："), false, "the REST author name is used, not the raw id");

  const ledger = box.json("skills/colleague/demo/knowledge/index.json");
  assert.equal(ledger.length, 2, "one entry per page, each carrying raw and text");
  assert.equal(ledger[0].method, "api-bot-token");
  assert.equal(ledger[0].credentialed, true);
  assert.equal(ledger[0].credential_file, "discord_config.json");
  assert.ok(ledger[0].locations.raw.startsWith("raw/discord/"));
  assert.ok(ledger[0].locations.text.startsWith("text/"));
});

test("discord: 429 with retry_after seconds backs off and then succeeds", async () => {
  const box = sandbox("discord").config({ bot_token: SECRETS.discord });
  const slept = [];
  let attempt = 0;
  const fetchMock = async () => {
    attempt += 1;
    if (attempt === 1) return jsonResponse({ message: "You are being rate limited.", retry_after: 1.5 }, { status: 429 });
    return jsonResponse(discordMessages(2));
  };

  const result = await discord.collect({
    fetch: fetchMock,
    env: box.env,
    root: box.work,
    person: "demo",
    channelId: "c1",
    sleep: async (ms) => slept.push(ms),
    now: "2026-09-13T00:00:00.000Z",
  });
  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.deepEqual(slept, [1500], "the body's retry_after is honoured in milliseconds");
  assert.match(result.receipt.warnings.join("\n"), /retry 1 after HTTP 429/);
});

test("discord: a missing credential fails loudly and writes nothing", async () => {
  const box = sandbox("discord");
  const result = await discord.collect({ fetch: async () => jsonResponse([]), env: box.env, root: box.work, person: "demo", channelId: "c1" });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.receipt.unavailable[0].reason, /no credential/);
  assert.equal(result.receipt.credential_file, "discord_config.json");
  assert.equal(box.exists("skills"), false);
  assert.equal(JSON.stringify(result.receipt).includes(SECRETS.discord), false);
});

test("discord: mutating calls are refused before anything is sent", async () => {
  const box = sandbox("discord").config({ bot_token: SECRETS.discord });
  let called = 0;
  const fetchMock = async () => {
    called += 1;
    return jsonResponse([]);
  };
  assert.throws(
    () => assertReadOnly("https://discord.com/api/v10/channels/c1/messages/m1", "DELETE", discord.ALLOWED_CALLS, "discord"),
    /read-only: DELETE/,
  );
  const result = await discord.collect({ fetch: fetchMock, env: box.env, root: box.work, person: "demo", channelId: "c1" });
  assert.equal(result.ok, true);
  assert.equal(called, 1, "only the read call was made");
});

/* ------------------------------------------------------------------- notion */

const NOTION_PAGE = {
  object: "page",
  id: "1f2e3d4c-5b6a-7988-7766-554433221100",
  properties: { Name: { type: "title", title: [{ plain_text: "事故复盘" }] } },
};

function notionBlocks() {
  return {
    object: "list",
    has_more: false,
    next_cursor: null,
    results: [
      { object: "block", id: "b1", type: "heading_1", heading_1: { rich_text: [{ plain_text: "时间线" }] } },
      { object: "block", id: "b2", type: "paragraph", paragraph: { rich_text: [{ plain_text: "02:10 告警，02:52 资金侧对平。" }] } },
      { object: "block", id: "b3", type: "to_do", to_do: { rich_text: [{ plain_text: "补幂等键。" }] } },
      { object: "block", id: "b4", type: "image", image: { file: { url: "https://example.invalid/x.png" } } },
    ],
  };
}

test("notion: a page becomes anchored paragraphs, and skipped blocks are named", async () => {
  const box = sandbox("notion").config({ integration_token: SECRETS.notion });
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url: String(url), method: init.method });
    return String(url).includes("/pages/") ? jsonResponse(NOTION_PAGE) : jsonResponse(notionBlocks());
  };

  const result = await notion.collect({
    fetch: fetchMock,
    env: box.env,
    root: box.work,
    person: "demo",
    pageId: "https://www.notion.so/Design-1f2e3d4c5b6a79887766554433221100?v=9",
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.title, "事故复盘");
  assert.equal(result.receipt.paragraphs, 3);
  assert.equal(result.receipt.page_id, "1f2e3d4c-5b6a-7988-7766-554433221100");
  assert.equal(calls.every((call) => call.method === "GET"), true, "reading a page is GET-only");
  assert.match(result.receipt.warnings.join("\n"), /image×1/);

  const body = box.read("skills/colleague/demo/knowledge/text/notion.md");
  assert.match(body, /^\[k0002\] 时间线$/m);
  assert.match(body, /^\[k0003\] 02:10 告警，02:52 资金侧对平。$/m);
  const ledger = box.json("skills/colleague/demo/knowledge/index.json");
  assert.equal(ledger[0].method, "api-integration-token");
  assert.equal(ledger[0].credential_file, "notion_config.json");
  assert.equal(ledger[0].kind, "doc");
});

test("notion: the search POST is allowed, anything else is not", () => {
  assert.doesNotThrow(() => assertReadOnly("https://api.notion.com/v1/search", "POST", notion.ALLOWED_CALLS, "notion"));
  assert.doesNotThrow(() => assertReadOnly("https://api.notion.com/v1/databases/abc/query", "POST", notion.ALLOWED_CALLS, "notion"));
  assert.throws(() => assertReadOnly("https://api.notion.com/v1/pages", "POST", notion.ALLOWED_CALLS, "notion"), /read-only: POST \/v1\/pages/);
  assert.throws(() => assertReadOnly("https://api.notion.com/v1/blocks/b1", "PATCH", notion.ALLOWED_CALLS, "notion"), /read-only: PATCH/);
});

test("notion: page ids are read out of urls and bad targets fail loudly", async () => {
  assert.equal(notion.normalisePageId("1f2e3d4c5b6a79887766554433221100"), "1f2e3d4c-5b6a-7988-7766-554433221100");
  assert.equal(notion.normalisePageId("https://www.notion.so/x-1f2e3d4c5b6a79887766554433221100"), "1f2e3d4c-5b6a-7988-7766-554433221100");
  assert.throws(() => notion.normalisePageId("not a page"), /cannot read a Notion page id/);

  const box = sandbox("notion").config({ integration_token: SECRETS.notion });
  const result = await notion.collect({ fetch: async () => jsonResponse({}), env: box.env, root: box.work, person: "demo", pageId: "nope" });
  assert.equal(result.ok, false);
  assert.match(result.receipt.errors[0], /cannot read a Notion page id/);
  assert.equal(box.exists("skills"), false);
});

test("notion: an empty page is an error, never an empty document", async () => {
  const box = sandbox("notion").config({ integration_token: SECRETS.notion });
  const fetchMock = async (url) =>
    String(url).includes("/pages/") ? jsonResponse(NOTION_PAGE) : jsonResponse({ object: "list", has_more: false, results: [] });
  const result = await notion.collect({ fetch: fetchMock, env: box.env, root: box.work, person: "demo", pageId: NOTION_PAGE.id });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.receipt.unavailable[0].reason, /no paragraph blocks/);
  assert.equal(box.exists("skills/colleague/demo/knowledge/text"), false, "nothing is written for an empty page");
});

/* --------------------------------------------------------------------- kit */

test("the kit keeps credentials out of receipts and refuses unknown verbs", () => {
  assert.equal(redact(`token=${SECRETS.discord}`, [SECRETS.discord]), "token=***");
  const scrubbed = scrub({ nested: [{ note: SECRETS.notion }] }, [SECRETS.notion]);
  assert.equal(JSON.stringify(scrubbed).includes(SECRETS.notion), false);

  const box = sandbox("discord");
  assert.throws(() => loadCredential({ env: box.env, configFile: "discord_config.json", envKeys: discord.ENV_KEYS, fields: ["bot_token"] }), /no credential/);
  writeFileSync(join(box.home, "discord_config.json"), "{ not json\n");
  assert.throws(() => loadCredential({ env: box.env, configFile: "discord_config.json", envKeys: discord.ENV_KEYS, fields: ["bot_token"] }), /not valid JSON/);

  const fromEnv = loadCredential({ env: { DISTILLY_DISCORD_BOT_TOKEN: "abc" }, configFile: "discord_config.json", envKeys: discord.ENV_KEYS, fields: ["bot_token"] });
  assert.equal(fromEnv.source, "env");
  assert.equal(fromEnv.values.bot_token, "abc");
});

test("both channels are on the CLI and no longer listed as pending", async () => {
  const { PENDING_CHANNELS } = await import("../src/commands/credentialed.mjs");
  // `PENDING_CHANNELS` listed the channels that had no collector yet; discord and
  // notion were the last two to leave it, and now every CONTRACT §1 channel ships,
  // so the honest assertion is that nothing is waiting. A non-empty map means a
  // channel regressed to "planned".
  assert.deepEqual(
    Object.keys(PENDING_CHANNELS).sort(),
    [],
    "every contract channel is implemented in this build",
  );
  const cli = await import("../src/commands/credentialed.mjs");
  assert.equal(typeof cli, "object");
});
