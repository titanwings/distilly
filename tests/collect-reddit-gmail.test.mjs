/**
 * The last two contract channels: Reddit (OAuth client credential) and Gmail
 * (OAuth refresh token).
 *
 * Reddit's token exchange is the only mutation it may make; Gmail's is the same,
 * and its message bytes are handed to the existing email parser rather than
 * re-implemented. Both are exercised with a scripted `fetch` — nothing here
 * touches the network.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as reddit from "../src/collect/reddit.mjs";
import * as gmail from "../src/collect/gmail.mjs";
import { assertReadOnly } from "../src/collect/kit.mjs";

const SECRETS = {
  reddit: { client_id: "FAKE-reddit-id", client_secret: "FAKE-reddit-secret-91ad" },
  gmail: { client_id: "FAKE-google-id", client_secret: "FAKE-google-secret-3f7c", refresh_token: "FAKE-refresh-token-8b2d" },
};

function sandbox(channel, values) {
  const root = mkdtempSync(join(tmpdir(), `dst-${channel}-`));
  const home = join(root, "distilly");
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, `${channel}_config.json`), `${JSON.stringify(values, null, 2)}\n`);
  return {
    root,
    home,
    work: join(root, "work"),
    env: { DISTILLY_HOME: home },
    read(rel) {
      return readFileSync(join(this.work, rel), "utf8");
    },
    json(rel) {
      return JSON.parse(this.read(rel));
    },
    exists(rel) {
      return existsSync(join(this.work, rel));
    },
  };
}

const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers ?? {} });

/* ------------------------------------------------------------------ reddit */

function redditListing(count, { after = null, start = 1_700_000_000 } = {}) {
  return {
    kind: "Listing",
    data: {
      after,
      children: Array.from({ length: count }, (_, index) => ({
        kind: "t1",
        data: {
          id: `c${index}`,
          author: index % 2 === 0 ? "lin_gong" : "xiao_ming",
          body: `第 ${index} 条评论：先看数据，再看日志。`,
          created_utc: start + index * 60,
          score: index,
          permalink: `/r/demo/comments/x/c${index}/`,
        },
      })),
    },
  };
}

test("reddit: client credential, two listing pages, anchored comments", async () => {
  const box = sandbox("reddit", SECRETS.reddit);
  const calls = [];
  let page = 0;
  const pages = [redditListing(2, { after: "t1_after" }), redditListing(1, { start: 1_700_000_500 })];
  const fetchMock = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers });
    if (String(url).includes("/access_token")) return jsonResponse({ access_token: "FAKE-access-token", token_type: "bearer", expires_in: 3600 });
    return jsonResponse(pages[Math.min(page++, pages.length - 1)]);
  };

  const result = await reddit.collect({
    fetch: fetchMock,
    env: box.env,
    root: box.work,
    person: "demo",
    target: "demo",
    limit: 2,
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.pages, 2);
  assert.equal(result.receipt.comments, 3);
  assert.ok(result.receipt.anchors.total >= 3);
  assert.equal(result.receipt.credential_file, "reddit_config.json");
  assert.equal(JSON.stringify(result.receipt).includes(SECRETS.reddit.client_secret), false, "the secret never reaches the receipt");

  // The token exchange is a Basic-auth POST; the listing is a Bearer GET.
  const tokenCall = calls.find((call) => call.url.includes("/access_token"));
  assert.equal(tokenCall.method, "POST");
  assert.match(tokenCall.headers.authorization, /^Basic /);
  assert.equal(Buffer.from(tokenCall.headers.authorization.slice(6), "base64").toString("utf8"), `${SECRETS.reddit.client_id}:${SECRETS.reddit.client_secret}`);
  const listingCalls = calls.filter((call) => call.url.includes("/r/demo/comments"));
  assert.equal(listingCalls.length, 2);
  assert.equal(listingCalls[0].url.includes("after="), false, "the first page carries no cursor");
  assert.equal(listingCalls[1].url.includes("after=t1_after"), true, "the cursor chains");
  assert.equal(listingCalls[0].headers.authorization, "Bearer FAKE-access-token");

  const textDir = join(box.work, "skills", "colleague", "demo", "knowledge", "text");
  const body = readdirSync(textDir)
    .sort()
    .map((name) => readFileSync(join(textDir, name), "utf8"))
    .join("\n");
  assert.match(body, /^\[k0001\] 2023-11-14T22:13:20\.000Z lin_gong：第 0 条评论/m, body.slice(0, 200));
  assert.equal(box.read("skills/colleague/demo/knowledge/raw/reddit/subreddit-demo-p001.json").includes("t1_after"), true);
});

test("reddit: deleted bodies are skipped, never anchored as speech", async () => {
  const box = sandbox("reddit", SECRETS.reddit);
  const listing = redditListing(1);
  listing.data.children.push(
    { kind: "t1", data: { id: "c9", author: "[deleted]", body: "[deleted]", created_utc: 1_700_000_999 } },
    { kind: "t1", data: { id: "c10", author: "someone", body: "[removed]", created_utc: 1_700_000_999 } },
    { kind: "more", data: { count: 3 } },
  );
  let call = 0;
  const fetchMock = async (url) => {
    call += 1;
    return String(url).includes("/access_token") ? jsonResponse({ access_token: "t" }) : jsonResponse(listing);
  };
  const result = await reddit.collect({ fetch: fetchMock, env: box.env, root: box.work, person: "demo", target: "demo", now: "2026-09-13T00:00:00.000Z" });
  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.comments, 1, "only the real comment is anchored");
  assert.match(result.receipt.warnings.join("\n"), /2 placeholder/);
  assert.match(result.receipt.warnings.join("\n"), /1 more/);
  assert.equal(call >= 2, true);
});

test("reddit: a bad credential and a refused verb both fail loudly", async () => {
  const box = sandbox("reddit", SECRETS.reddit);
  const rejected = await reddit.collect({ fetch: async () => jsonResponse({ error: "invalid_client" }, { status: 401 }), env: box.env, root: box.work, person: "demo", target: "demo" });
  assert.equal(rejected.ok, false);
  assert.match(rejected.receipt.unavailable[0].reason, /check the credential and its scopes|auth-failed/);
  assert.equal(box.exists("skills/colleague/demo/knowledge/text"), false);

  assert.throws(() => assertReadOnly("https://oauth.reddit.com/api/submit", "POST", reddit.ALLOWED_CALLS, "reddit"), /read-only: POST \/api\/submit/);
  assert.throws(() => assertReadOnly("https://oauth.reddit.com/api/vote", "POST", reddit.ALLOWED_CALLS, "reddit"), /read-only/);
  assert.doesNotThrow(() => assertReadOnly("https://www.reddit.com/api/v1/access_token", "POST", reddit.ALLOWED_CALLS, "reddit"));
});

/* ------------------------------------------------------------------- gmail */

function rawEmail({ subject = "对账差异", from = "lin@example.com", body = "37 笔差异，根因是幂等键缺失。" } = {}) {
  const mime = [
    `From: ${from}`,
    "To: me@example.com",
    `Subject: ${subject}`,
    "Date: Wed, 13 Mar 2024 10:00:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "",
    body,
    "",
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

test("gmail: refresh token, raw MIME delegated to the email parser", async () => {
  const box = sandbox("gmail", SECRETS.gmail);
  const calls = [];
  const fetchMock = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body });
    if (String(url).includes("/token")) return jsonResponse({ access_token: "FAKE-google-access", expires_in: 3600 });
    if (String(url).includes("/messages?") || String(url).endsWith("/messages")) {
      return jsonResponse({ messages: [{ id: "m1" }, { id: "m2" }] });
    }
    return jsonResponse({ id: url.includes("m1") ? "m1" : "m2", raw: rawEmail({ subject: url.includes("m1") ? "对账差异" : "复盘草稿" }) });
  };

  const result = await gmail.collect({
    fetch: fetchMock,
    env: box.env,
    root: box.work,
    person: "demo",
    query: "from:lin@example.com",
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.messages, 2);
  assert.equal(result.receipt.credential_file, "gmail_config.json");
  assert.equal(JSON.stringify(result.receipt).includes(SECRETS.gmail.refresh_token), false);
  assert.equal(JSON.stringify(result.receipt).includes(SECRETS.gmail.client_secret), false);

  const tokenCall = calls.find((call) => call.url.includes("/token"));
  assert.equal(tokenCall.method, "POST");
  assert.match(tokenCall.body, /grant_type=refresh_token/);
  assert.equal(tokenCall.body.includes(SECRETS.gmail.refresh_token), true, "the refresh token is sent to the token endpoint");

  // The text came from the existing email parser: subject line, sender, body.
  const textDir = join(box.work, "skills", "colleague", "demo", "knowledge", "text");
  const body = readdirSync(textDir)
    .sort()
    .map((name) => readFileSync(join(textDir, name), "utf8"))
    .join("\n");
  assert.match(body, /\[k\d+\]/);
  assert.match(body, /对账差异/);
  assert.match(body, /lin@example\.com/);
  assert.match(body, /37 笔差异/);

  const ledger = box.json("skills/colleague/demo/knowledge/index.json");
  assert.equal(ledger.every((entry) => entry.method === "api-oauth-refresh"), true);
  assert.equal(ledger.every((entry) => entry.credentialed === true), true);
  assert.equal(ledger.every((entry) => entry.credential_file === "gmail_config.json"), true);
});

test("gmail: an expired access token is refreshed once and the run continues", async () => {
  const box = sandbox("gmail", SECRETS.gmail);
  let tokens = 0;
  let firstListDone = false;
  const fetchMock = async (url) => {
    if (String(url).includes("/token")) {
      tokens += 1;
      return jsonResponse({ access_token: `token-${tokens}` });
    }
    if (String(url).endsWith("/messages") || String(url).includes("/messages?")) {
      firstListDone = true;
      return jsonResponse({ messages: [{ id: "m1" }] });
    }
    if (!firstListDone) return jsonResponse({}, { status: 401 });
    if (String(url).includes("m1") && tokens === 1) return jsonResponse({ error: { message: "Invalid Credentials" } }, { status: 401 });
    return jsonResponse({ id: "m1", raw: rawEmail() });
  };

  const result = await gmail.collect({ fetch: fetchMock, env: box.env, root: box.work, person: "demo", now: "2026-09-13T00:00:00.000Z" });
  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(tokens, 2, "the refresh token is exchanged again after the 401");
  assert.match(result.receipt.warnings.join("\n"), /expired mid-run/);
  assert.equal(result.receipt.messages, 1);
});

test("gmail: nothing is written when the credential is rejected outright", async () => {
  const box = sandbox("gmail", SECRETS.gmail);
  const result = await gmail.collect({ fetch: async () => jsonResponse({ error: "invalid_grant" }, { status: 400 }), env: box.env, root: box.work, person: "demo" });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.receipt.unavailable[0].reason, /HTTP 400/);
  assert.equal(box.exists("skills"), false);
  assert.throws(() => assertReadOnly("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", "POST", gmail.ALLOWED_CALLS, "gmail"), /read-only/);
  assert.doesNotThrow(() => assertReadOnly("https://oauth2.googleapis.com/token", "POST", gmail.ALLOWED_CALLS, "gmail"));
});

test("the contract's channel table is complete", async () => {
  const { PENDING_CHANNELS } = await import("../src/commands/credentialed.mjs");
  assert.deepEqual(Object.keys(PENDING_CHANNELS), [], "every channel the contract names is implemented");
});
