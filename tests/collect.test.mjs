/**
 * tests/collect.test.mjs — the credentialed channels, verified with a mock fetch.
 *
 * Nothing here touches the network: every request goes through an injected
 * `fetch`, either in-process or through `NODE_OPTIONS=--import=<preload>` for the
 * CLI paths. Assertions cover, in the contract's language:
 *
 *   · 分页   — three cursor pages, correct cursor chaining, verbatim raw bytes
 *   · 限流   — 429 + Retry-After backs off; past the retry cap the run keeps what
 *              it already wrote and exits non-zero with a warning
 *   · 续传   — the second run starts at the checkpoint cursor and does not
 *              re-fetch finished pages (asserted on the recorded request count)
 *   · 缺 key — loud failure, remediation steps, and **no file at all** under
 *              `knowledge/` (never fabricate data)
 *   · 密钥   — a fake credential never appears in stdout, stderr or the receipt,
 *              while the config *file name* does
 *   · 只读   — non-allowlisted mutations are refused before they are sent
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as feishu from "../src/collect/feishu.mjs";
import * as slack from "../src/collect/slack.mjs";
import * as dingtalk from "../src/collect/dingtalk.mjs";
import * as x from "../src/collect/x.mjs";
import * as transcribe from "../src/optional/transcribe.mjs";

const HERE = fileURLToPath(new URL("..", import.meta.url));
const BIN = join(HERE, "bin", "distilly.mjs");

// The real home may hold a legacy ~/.colleague-skill config; isolate every test.
const TEST_HOME = mkdtempSync(join(tmpdir(), "dst-collect-home-"));
process.env.HOME = TEST_HOME;

const SECRET = {
  feishu: "FAKE-feishu-app-secret-9c1d2e",
  slack: "xoxb-FAKE-slack-token-4d8e1c9a",
  dingtalk: "FAKE-dingtalk-app-secret-77ab31",
  x: "FAKE-x-bearer-token-51ef02",
  transcribe: "sk-FAKE-transcribe-key-3b7d19",
};

function sandbox(name = "case") {
  const root = mkdtempSync(join(tmpdir(), `dst-${name}-`));
  const fakeHome = join(root, "home");
  const distillyHome = join(root, "distilly");
  const work = join(root, "work");
  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(distillyHome, { recursive: true });
  mkdirSync(work, { recursive: true });
  return {
    root,
    fakeHome,
    distillyHome,
    work,
    env: { DISTILLY_HOME: distillyHome },
    config(channel, values) {
      writeFileSync(join(distillyHome, `${channel}_config.json`), JSON.stringify(values, null, 2));
      return this;
    },
    write(rel, body) {
      const path = join(work, rel);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, body);
      return path;
    },
    read(rel) {
      return readFileSync(join(work, rel), "utf8");
    },
    exists(rel) {
      return existsSync(join(work, rel));
    },
  };
}

/**
 * Every file written under `dir`, relative and sorted — for failure messages.
 *
 * A failing "the page was not written" assertion used to say only `false !== true`,
 * which is unactionable from a CI log: it cannot distinguish "nothing was written"
 * from "something was written somewhere else".
 */
function written(dir) {
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), rel);
      else out.push(rel);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out.length === 0 ? "(nothing)" : out.sort().join(", ");
}

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

function pageRecorder() {
  const calls = [];
  const sleep = [];
  const fetchMock = (handler) => async (url, init = {}) => {
    const record = {
      url: String(url),
      method: String(init.method ?? "GET").toUpperCase(),
      headers: init.headers ?? {},
      body: typeof init.body === "string" ? init.body : null,
    };
    calls.push(record);
    return handler(record, calls.length);
  };
  return { calls, sleep, fetchMock, sleeper: async (ms) => sleep.push(ms) };
}

/** A preload module that replaces globalThis.fetch with a scripted mock. */
const PRELOAD = `
import { readFileSync, writeFileSync } from "node:fs";
const spec = JSON.parse(readFileSync(process.env.DST_MOCK_SPEC, "utf8"));
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  const method = String(init?.method ?? "GET").toUpperCase();
  const headers = init?.headers ?? {};
  calls.push({ url: target, method, authorization: String(headers.authorization ?? "") });
  writeFileSync(spec.log, JSON.stringify(calls, null, 2));
  for (const route of spec.routes) {
    if (!target.includes(route.match)) continue;
    if (route.method && route.method !== method) continue;
    const list = route.responses ?? [{ status: 200, body: {} }];
    const index = Math.min(route.hits ?? 0, list.length - 1);
    route.hits = (route.hits ?? 0) + 1;
    const entry = list[index];
    const text = entry.text !== undefined ? entry.text : JSON.stringify(entry.body ?? {});
    return new Response(text, { status: entry.status ?? 200, headers: entry.headers ?? {} });
  }
  return new Response(JSON.stringify({ error: "no mock route", url: target }), { status: 404 });
};
`;

function runCli(args, { box, spec, env = {}, cwd } = {}) {
  const dir = spec ? mkdtempSync(join(tmpdir(), "dst-mock-")) : null;
  const spawnEnv = {
    ...process.env,
    HOME: box.fakeHome,
    DISTILLY_HOME: box.distillyHome,
    ...env,
  };
  if (spec) {
    const specPath = join(dir, "spec.json");
    const preloadPath = join(dir, "preload.mjs");
    writeFileSync(specPath, JSON.stringify({ log: join(dir, "calls.json"), ...spec }));
    writeFileSync(preloadPath, PRELOAD);
    spawnEnv.DST_MOCK_SPEC = specPath;
    spawnEnv.NODE_OPTIONS = `--import=${preloadPath}`;
  }
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: cwd ?? box.work,
    env: spawnEnv,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    specDir: dir,
  };
}

function receiptOf(stdout) {
  const start = stdout.indexOf("{");
  assert.notEqual(start, -1, `no JSON receipt in stdout: ${stdout}`);
  return JSON.parse(stdout.slice(start));
}

// ─── 分页 / pagination ───────────────────────────────────────────────────────

test("feishu: three cursor pages, verbatim bytes, ledger entries", async () => {
  const box = sandbox("feishu-pages").config("feishu", { app_id: "cli_x", app_secret: SECRET.feishu });
  const pages = [
    { code: 0, data: { items: [{ message_id: "om_1" }], has_more: true, page_token: "tok-1" } },
    { code: 0, data: { items: [{ message_id: "om_2" }], has_more: true, page_token: "tok-2" } },
    { code: 0, data: { items: [{ message_id: "om_3" }], has_more: false, page_token: null } },
  ];
  const rec = pageRecorder();
  let page = 0;
  const fetchMock = rec.fetchMock((call) => {
    if (call.url.includes("tenant_access_token")) {
      return json({ code: 0, tenant_access_token: "tenant-token", expire: 7200 });
    }
    return json(pages[page++]);
  });

  const result = await feishu.collect({
    fetch: fetchMock,
    env: box.env,
    root: box.work,
    chatId: "oc_demo",
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.exitCode, 0);
  const receipt = result.receipt;
  for (const key of ["command", "ok", "inputs", "outputs", "warnings", "unavailable"]) {
    assert.ok(key in receipt, `receipt is missing ${key}`);
  }
  assert.equal(receipt.pages, 3);
  assert.equal(receipt.items, 3);
  assert.ok(receipt.outputs.every((o) => typeof o.sha256 === "string" && typeof o.bytes === "number"));

  const messageCalls = rec.calls.filter((c) => c.url.includes("/im/v1/messages"));
  assert.equal(messageCalls.length, 3);
  assert.ok(!messageCalls[0].url.includes("page_token"), "first page must not send a cursor");
  assert.ok(messageCalls[1].url.includes("page_token=tok-1"), "second page must send cursor tok-1");
  assert.ok(messageCalls[2].url.includes("page_token=tok-2"), "third page must send cursor tok-2");
  assert.equal(messageCalls[0].headers.authorization, "Bearer tenant-token");

  // raw bytes are stored verbatim, not re-serialised
  assert.equal(box.read("knowledge/raw/feishu/oc_demo-p001.json"), JSON.stringify(pages[0]));
  assert.equal(box.read("knowledge/raw/feishu/oc_demo-p003.json"), JSON.stringify(pages[2]));
  const ledger = JSON.parse(box.read("knowledge/index.json"));
  assert.equal(ledger.length, 3);
  assert.ok(ledger.every((entry) => entry.credentialed === true && entry.sha256 && entry.bytes > 0));
  assert.ok(ledger.every((entry) => entry.credential_file === "feishu_config.json"));
});

test("slack: three cursor pages via response_metadata.next_cursor", async () => {
  const box = sandbox("slack-pages").config("slack", { bot_token: SECRET.slack });
  const pages = [
    { ok: true, messages: [{ ts: "3" }], response_metadata: { next_cursor: "cur-1" } },
    { ok: true, messages: [{ ts: "2" }], response_metadata: { next_cursor: "cur-2" } },
    { ok: true, messages: [{ ts: "1" }], response_metadata: { next_cursor: "" } },
  ];
  const rec = pageRecorder();
  let page = 0;
  const result = await slack.collect({
    fetch: rec.fetchMock(() => json(pages[page++])),
    env: box.env,
    root: box.work,
    channel: "C0123",
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.pages, 3);
  assert.equal(result.receipt.items, 3);
  assert.equal(rec.calls.length, 3);
  assert.ok(!rec.calls[0].url.includes("cursor="));
  assert.ok(rec.calls[1].url.includes("cursor=cur-1"));
  assert.ok(rec.calls[2].url.includes("cursor=cur-2"));
  assert.equal(rec.calls[0].headers.authorization, `Bearer ${SECRET.slack}`);
  assert.equal(JSON.parse(box.read("knowledge/index.json")).length, 3);
});

test("x: pagination_token pages, and the second run is incremental via since_id", async () => {
  const box = sandbox("x-pages").config("x", { bearer_token: SECRET.x });
  const pages = [
    { data: [{ id: "105" }, { id: "104" }], meta: { result_count: 2, newest_id: "105", next_token: "nx-1" } },
    { data: [{ id: "103" }], meta: { result_count: 1, newest_id: "103", next_token: "nx-2" } },
    { data: [{ id: "102" }], meta: { result_count: 1, newest_id: "102" } },
  ];
  const rec = pageRecorder();
  let page = 0;
  const first = await x.collect({
    fetch: rec.fetchMock(() => json(pages[page++])),
    env: box.env,
    root: box.work,
    userId: "42",
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(first.ok, true, JSON.stringify(first.receipt));
  assert.equal(first.receipt.pages, 3);
  assert.ok(!rec.calls[0].url.includes("pagination_token"));
  assert.ok(rec.calls[1].url.includes("pagination_token=nx-1"));
  assert.ok(rec.calls[2].url.includes("pagination_token=nx-2"));
  assert.equal(first.receipt.newest_id, "102");

  const rec2 = pageRecorder();
  const second = await x.collect({
    fetch: rec2.fetchMock(() => json({ meta: { result_count: 0 } })),
    env: box.env,
    root: box.work,
    userId: "42",
    now: "2026-09-13T01:00:00.000Z",
  });
  assert.equal(second.ok, true, JSON.stringify(second.receipt));
  assert.equal(second.receipt.since_id, "102", "newest_id of the previous run becomes since_id");
  assert.equal(rec2.calls.length, 1, "an incremental run must not re-fetch pages");
  assert.ok(rec2.calls[0].url.includes("since_id=102"));
  assert.equal(second.receipt.outputs.length, 1);
});

// ─── 限流 / rate limiting ────────────────────────────────────────────────────

test("feishu: 429 + Retry-After backs off and then succeeds", async () => {
  const box = sandbox("feishu-429").config("feishu", { app_id: "cli_x", app_secret: SECRET.feishu });
  const rec = pageRecorder();
  let hit = 0;
  const fetchMock = rec.fetchMock((call) => {
    if (call.url.includes("tenant_access_token")) {
      return json({ code: 0, tenant_access_token: "t", expire: 7200 });
    }
    hit += 1;
    if (hit === 1) return json({}, { status: 429, headers: { "retry-after": "2" } });
    return json({ code: 0, data: { items: [{ message_id: "om_1" }], has_more: false } });
  });

  const result = await feishu.collect({
    fetch: fetchMock,
    env: box.env,
    root: box.work,
    chatId: "oc_demo",
    sleep: rec.sleeper,
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.deepEqual(rec.sleep, [2000], "Retry-After: 2 must sleep exactly 2000ms");
  assert.equal(result.receipt.retries.length, 1);
  assert.equal(result.receipt.retries[0].status, 429);
  assert.match(result.receipt.warnings.join("\n"), /retry 1 after HTTP 429/);
});

test("feishu: past the retry cap the run fails loudly and keeps the pages already on disk", async () => {
  const box = sandbox("feishu-429-cap").config("feishu", { app_id: "cli_x", app_secret: SECRET.feishu });
  const rec = pageRecorder();
  let hit = 0;
  const fetchMock = rec.fetchMock((call) => {
    if (call.url.includes("tenant_access_token")) {
      return json({ code: 0, tenant_access_token: "t", expire: 7200 });
    }
    hit += 1;
    if (hit === 1) return json({ code: 0, data: { items: [{ message_id: "om_1" }], has_more: true, page_token: "tok-1" } });
    return json({}, { status: 429, headers: { "retry-after": "1" } });
  });

  const result = await feishu.collect({
    fetch: fetchMock,
    env: box.env,
    root: box.work,
    chatId: "oc_demo",
    maxRetries: 2,
    sleep: rec.sleeper,
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.partial, true);
  assert.equal(result.receipt.outputs.length, 1, "page 1 stays on disk");
  assert.equal(box.exists("knowledge/raw/feishu/oc_demo-p001.json"), true);
  assert.equal(box.exists("knowledge/raw/feishu/oc_demo-p002.json"), false, "no page is fabricated");
  assert.match(result.receipt.errors.join("\n"), /rate limited/i);
  assert.match(result.receipt.warnings.join("\n"), /retry 2 after HTTP 429/);
  assert.match(result.receipt.unavailable[0].reason, /rate-limited/);
  assert.ok(result.receipt.unavailable[0].remediation.length > 0);
});

// ─── 续传 / resume ───────────────────────────────────────────────────────────

test("feishu: the second run resumes from the checkpoint cursor without re-fetching finished pages", async () => {
  const box = sandbox("feishu-resume").config("feishu", { app_id: "cli_x", app_secret: SECRET.feishu });
  const rec = pageRecorder();
  let hit = 0;
  const first = await feishu.collect({
    fetch: rec.fetchMock((call) => {
      if (call.url.includes("tenant_access_token")) return json({ code: 0, tenant_access_token: "t", expire: 7200 });
      hit += 1;
      if (hit === 1) return json({ code: 0, data: { items: [{ message_id: "om_1" }], has_more: true, page_token: "tok-1" } });
      if (hit === 2) return json({ code: 0, data: { items: [{ message_id: "om_2" }], has_more: true, page_token: "tok-2" } });
      return json({}, { status: 429, headers: { "retry-after": "1" } });
    }),
    env: box.env,
    root: box.work,
    chatId: "oc_demo",
    maxRetries: 1,
    sleep: rec.sleeper,
  });
  assert.equal(first.ok, false);
  assert.equal(first.receipt.outputs.length, 2);
  const stateFiles = readdirSync(join(box.distillyHome, "state"));
  assert.equal(stateFiles.length, 1, "an interrupted run leaves exactly one checkpoint");

  const rec2 = pageRecorder();
  const second = await feishu.collect({
    fetch: rec2.fetchMock((call) => {
      if (call.url.includes("tenant_access_token")) return json({ code: 0, tenant_access_token: "t", expire: 7200 });
      return json({ code: 0, data: { items: [{ message_id: "om_3" }], has_more: false } });
    }),
    env: box.env,
    root: box.work,
    chatId: "oc_demo",
    sleep: rec2.sleeper,
  });

  assert.equal(second.ok, true, JSON.stringify(second.receipt));
  const messageCalls = rec2.calls.filter((c) => c.url.includes("/im/v1/messages"));
  assert.equal(messageCalls.length, 1, "only the interrupted page is re-fetched");
  assert.ok(messageCalls[0].url.includes("page_token=tok-2"), "the run continues from the checkpoint cursor");
  assert.equal(second.receipt.resumed_from, "tok-2");
  assert.equal(second.receipt.pages, 3, "page numbering continues (1,2 done, 3 now)");
  assert.equal(box.exists("knowledge/raw/feishu/oc_demo-p003.json"), true);
  assert.equal(readdirSync(join(box.distillyHome, "state")).length, 0, "a finished run clears its checkpoint");
  assert.equal(JSON.parse(box.read("knowledge/index.json")).length, 3);
});

// ─── 缺 key / no credential ──────────────────────────────────────────────────

test("every channel fails loudly without a credential and writes nothing at all", async () => {
  const cases = [
    { name: "feishu", module: feishu, options: { chatId: "oc_demo" }, file: "feishu_config.json" },
    { name: "slack", module: slack, options: { channel: "C0123" }, file: "slack_config.json" },
    { name: "dingtalk", module: dingtalk, options: { name: "张三" }, file: "dingtalk_config.json" },
    { name: "x", module: x, options: { userId: "42" }, file: "x_config.json" },
  ];

  for (const item of cases) {
    const box = sandbox(`${item.name}-nokey`);
    const result = await item.module.collect({
      fetch: async () => {
        throw new Error("no request may be made without a credential");
      },
      env: box.env,
      root: box.work,
      ...item.options,
    });

    assert.equal(result.ok, false, `${item.name} must fail without a credential`);
    assert.notEqual(result.exitCode, 0);
    assert.equal(box.exists("knowledge"), false, `${item.name} must not create knowledge/`);
    const unavailable = result.receipt.unavailable[0];
    assert.equal(unavailable.channel, item.name);
    assert.match(unavailable.reason, new RegExp(item.file.replace(".", "\\.")));
    assert.ok(unavailable.remediation.length >= 2, `${item.name} must say how to fix it`);
    assert.match(unavailable.remediation.join("\n"), /\.distilly/);
    assert.equal(result.receipt.outputs.length, 0);
  }
});

test("an API-level error is never turned into fake data", async () => {
  const box = sandbox("feishu-apierr").config("feishu", { app_id: "cli_x", app_secret: SECRET.feishu });
  const result = await feishu.collect({
    fetch: async (url) =>
      String(url).includes("tenant_access_token")
        ? json({ code: 0, tenant_access_token: "t", expire: 7200 })
        : json({ code: 99991663, msg: "permission denied" }),
    env: box.env,
    root: box.work,
    chatId: "oc_demo",
  });

  assert.equal(result.ok, false);
  assert.equal(box.exists("knowledge"), false);
  assert.match(result.receipt.unavailable[0].reason, /api-error/);
  assert.match(result.receipt.unavailable[0].remediation.join("\n"), /im:message:readonly/);
});

test("dingtalk: api mode reads the directory card only, and states the message-history gap", async () => {
  const box = sandbox("dingtalk-api").config("dingtalk", { app_key: "ding_abc", app_secret: SECRET.dingtalk });
  const rec = pageRecorder();
  const result = await dingtalk.collect({
    fetch: rec.fetchMock((call) => {
      if (call.url.includes("oauth2/accessToken")) return json({ accessToken: "dt-token", expireIn: 7200 });
      if (call.url.includes("users/search")) return json({ list: [{ userId: "u-1", name: "张三" }] });
      return json({ result: { userId: "u-1", name: "张三", deptNameList: ["研发"] } });
    }),
    env: box.env,
    root: box.work,
    name: "张三",
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.resource, "directory-card");
  assert.equal(rec.calls[0].method, "POST");
  assert.ok(rec.calls[0].url.endsWith("/v1.0/oauth2/accessToken"));
  assert.ok(rec.calls[1].url.endsWith("/v1.0/contact/users/search"));
  assert.equal(rec.calls[1].headers["x-acs-dingtalk-access-token"], "dt-token");
  assert.equal(result.receipt.outputs.length, 2, "search page + profile card");
  assert.match(result.receipt.warnings.join("\n"), /no documented read API for message history/);
  const ledger = JSON.parse(box.read("knowledge/index.json"));
  assert.equal(ledger.length, 2);
});

test("scrub(): a receipt can never carry a credential value, only the file name", () => {
  const fake = { note: `token=${SECRET.slack} in a nested list`, nested: [{ deep: SECRET.slack }] };
  const scrubbed = slack.scrub(fake, [SECRET.slack]);
  assert.ok(!JSON.stringify(scrubbed).includes(SECRET.slack));
  assert.match(scrubbed.note, /\[redacted\]/);
  assert.match(slack.redact(`bad ${SECRET.slack}`, [SECRET.slack]), /\[redacted\]/);
});

// ─── 只读 / no write operations ──────────────────────────────────────────────

test("collectors refuse every non-allowlisted mutation", () => {
  for (const [name, module] of Object.entries({ feishu, slack, dingtalk, x })) {
    assert.equal(module.assertReadOnly("https://example.test/read", "GET"), true, name);
    assert.throws(
      () => module.assertReadOnly("https://api.x.com/2/users/42/likes", "POST"),
      /refusing POST/,
      `${name} must refuse POST /likes`,
    );
    assert.throws(() => module.assertReadOnly("https://slack.com/api/chat.postMessage", "POST"), /refusing POST/);
    assert.throws(() => module.assertReadOnly("https://api.x.com/2/users/42/following", "PUT"), /refusing PUT/);
    assert.throws(() => module.assertReadOnly("https://api.x.com/2/tweets/1", "DELETE"), /refusing DELETE/);
  }
  assert.equal(slack.ALLOWED_MUTATIONS.length, 0, "slack is GET-only");
  assert.equal(x.ALLOWED_MUTATIONS.length, 0, "x is GET-only");
  assert.equal(feishu.assertReadOnly("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", "POST"), true);
  assert.equal(dingtalk.assertReadOnly("https://api.dingtalk.com/v1.0/oauth2/accessToken", "POST"), true);
  assert.equal(dingtalk.assertReadOnly("https://api.dingtalk.com/v1.0/contact/users/search", "POST"), true);
});

test("the four collectors share one retry/redaction behaviour (no drift)", () => {
  const modules = { feishu, slack, dingtalk, x };
  const attempts = [1, 2, 3, 4, 5];
  const retryAfters = [null, 0, 1500, 90_000];
  for (const [name, module] of Object.entries(modules)) {
    for (const attempt of attempts) {
      for (const retryAfter of retryAfters) {
        assert.equal(
          module.backoffDelay(attempt, retryAfter),
          feishu.backoffDelay(attempt, retryAfter),
          `${name}.backoffDelay drifted`,
        );
      }
    }
    assert.equal(module.parseRetryAfter("7"), 7000, `${name}.parseRetryAfter drifted`);
    assert.equal(module.parseRetryAfter(null), null);
    assert.equal(module.redact("a SECRET b", ["SECRET"]), "a [redacted] b");
  }
  assert.equal(feishu.backoffDelay(1, null), 500);
  assert.equal(feishu.backoffDelay(3, null), 2000);
  assert.equal(feishu.backoffDelay(2, 5000), 5000, "Retry-After wins over exponential backoff");
  assert.equal(feishu.backoffDelay(2, 999_999), 60_000, "backoff is capped");
});

// ─── 密钥纪律 through the real CLI ───────────────────────────────────────────

test("CLI success path: a fake key never reaches stdout, stderr or the receipt", () => {
  const box = sandbox("cli-secret-ok").config("slack", { bot_token: SECRET.slack });
  const run = runCli(["collect", "slack", "--channel", "C0123", "--json"], {
    box,
    spec: {
      routes: [
        {
          match: "conversations.history",
          responses: [{ status: 200, body: { ok: true, messages: [{ ts: "1", text: "hi" }], response_metadata: { next_cursor: "" } } }],
        },
      ],
    },
  });

  assert.equal(run.status, 0, run.stderr);
  assert.ok(!run.stdout.includes(SECRET.slack), "stdout leaked the credential");
  assert.ok(!run.stderr.includes(SECRET.slack), "stderr leaked the credential");
  const receipt = receiptOf(run.stdout);
  // The messages name what was seen: a bare `false !== true` on either of these made
  // a CI-only failure impossible to diagnose from the log alone.
  assert.equal(receipt.ok, true, `receipt was not ok: ${JSON.stringify(receipt)}`);
  assert.equal(receipt.credential_file, "slack_config.json");
  assert.ok(!JSON.stringify(receipt).includes(SECRET.slack));
  assert.equal(
    box.exists("knowledge/raw/slack/c0123-p001.json"),
    true,
    // The channel id is `C0123` and the **file name is slugged to `c0123`**
    // (`writeRaw` runs the name through `slug()`), while the receipt keeps
    // `channel_id: "C0123"`. This assertion used to read `C0123-p001.json` and
    // passed on macOS only because APFS compares names case-insensitively; on the
    // Linux runner it failed while the file sat right there in the listing.
    `the page was not written; receipt=${JSON.stringify(receipt)} stderr=${run.stderr} tree=${written(box.work)}`,
  );
});

test("CLI failure path: a rejected key leaks nothing and names where to reconfigure", () => {
  const box = sandbox("cli-secret-bad").config("slack", { bot_token: SECRET.slack });
  const run = runCli(["collect", "slack", "--channel", "C0123", "--json"], {
    box,
    spec: {
      routes: [
        { match: "conversations.history", responses: [{ status: 401, body: { ok: false, error: "invalid_auth" } }] },
      ],
    },
  });

  assert.notEqual(run.status, 0);
  assert.ok(!run.stdout.includes(SECRET.slack), "stdout leaked the credential");
  assert.ok(!run.stderr.includes(SECRET.slack), "stderr leaked the credential");
  const receipt = receiptOf(run.stdout);
  assert.equal(receipt.ok, false);
  assert.ok(!JSON.stringify(receipt).includes(SECRET.slack));
  assert.match(run.stderr, /slack_config\.json/, "the failure must name the config file");
  assert.match(run.stderr, /fix:/, "the failure must print remediation steps");
  assert.match(run.stderr + JSON.stringify(receipt), /api\.slack\.com\/apps/);
  assert.equal(box.exists("knowledge"), false, "a failed run writes nothing");
});

test("CLI missing-key path: exit 1, config file named, remediation listed, no files", () => {
  const box = sandbox("cli-nokey");
  const run = runCli(["collect", "feishu", "--chat-id", "oc_demo", "--json"], { box });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /feishu_config\.json/);
  assert.match(run.stderr, /fix:/);
  const receipt = receiptOf(run.stdout);
  assert.equal(receipt.unavailable[0].channel, "feishu");
  assert.equal(box.exists("knowledge"), false);
});

test("CLI: a fake credential passed through the environment is never echoed", () => {
  const box = sandbox("cli-secret-env");
  const run = runCli(["collect", "x", "--user-id", "42", "--max-retries", "0", "--json"], {
    box,
    env: { DISTILLY_X_BEARER_TOKEN: SECRET.x },
    spec: { routes: [{ match: "/tweets", responses: [{ status: 500, body: { title: "server error" } }] }] },
  });
  assert.notEqual(run.status, 0);
  assert.ok(!run.stdout.includes(SECRET.x));
  assert.ok(!run.stderr.includes(SECRET.x));
  assert.ok(!JSON.stringify(receiptOf(run.stdout)).includes(SECRET.x));
});

// ─── transcribe ──────────────────────────────────────────────────────────────

test("transcribe: no backend is an explicit unavailable, never an empty transcript", async () => {
  const box = sandbox("transcribe-nobackend");
  box.write("audio/interview.m4a", "fake audio bytes");
  const result = await transcribe.transcribe({
    input: join(box.work, "audio/interview.m4a"),
    env: box.env,
    root: box.work,
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.match(result.receipt.unavailable[0].reason, /no-backend/);
  assert.match(result.receipt.unavailable[0].remediation.join("\n"), /DISTILLY_TRANSCRIBE_API_KEY/);
  assert.match(result.receipt.unavailable[0].remediation.join("\n"), /--capture/);
  assert.equal(box.exists("knowledge"), false);
});

test("transcribe: the host backend registers provenance and writes no empty text", async () => {
  const box = sandbox("transcribe-host");
  box.write("audio/interview.m4a", "fake audio bytes");
  box.write("audio/transcript.txt", "00:00 hello\n00:05 world");

  const result = await transcribe.transcribe({
    input: join(box.work, "audio/interview.m4a"),
    capture: join(box.work, "audio/transcript.txt"),
    env: box.env,
    root: box.work,
    now: "2026-09-13T00:00:00.000Z",
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.deepEqual(result.receipt.provenance, {
    method: "host-transcribe",
    producer: "host:model",
    confidence: "host-reported",
  });
  const text = box.read("knowledge/text/interview.md");
  assert.match(text, /method: host-transcribe/);
  assert.match(text, /00:00 hello/);
  const ledger = JSON.parse(box.read("knowledge/index.json"));
  assert.equal(ledger[0].provenance.confidence, "host-reported");
  assert.equal(ledger[0].kind, "transcript", "the ledger kind must be one of src/knowledge/ledger.mjs ENTRY_KINDS");

  const empty = await transcribe.transcribe({
    input: join(box.work, "audio/interview.m4a"),
    capture: box.write("audio/empty.txt", "   \n"),
    env: box.env,
    root: box.work,
  });
  assert.equal(empty.ok, false);
  assert.match(empty.receipt.unavailable[0].reason, /capture-empty/);
});

test("transcribe: the OpenAI-compatible backend keeps the key out of the receipt", async () => {
  const box = sandbox("transcribe-http");
  box.write("audio/interview.m4a", "fake audio bytes");
  const rec = pageRecorder();
  const result = await transcribe.transcribe({
    input: join(box.work, "audio/interview.m4a"),
    env: { ...box.env, DISTILLY_TRANSCRIBE_API_KEY: SECRET.transcribe },
    root: box.work,
    now: "2026-09-13T01:00:00.000Z",
    fetch: rec.fetchMock((call) =>
      json({ text: "hello", language: "en", segments: [{ start: 0, text: "hello" }, { start: 61, text: "world" }] }),
    ),
  });

  assert.equal(result.ok, true, JSON.stringify(result.receipt));
  assert.equal(result.receipt.backend, "openai-http");
  assert.equal(result.receipt.provenance.method, "openai-http");
  assert.match(result.receipt.provenance.producer, /whisper-1/);
  assert.equal(rec.calls[0].headers.authorization, `Bearer ${SECRET.transcribe}`);
  assert.ok(!JSON.stringify(result.receipt).includes(SECRET.transcribe));
  assert.match(box.read("knowledge/text/interview.md"), /\[00:01:01\] world/);

  const first = transcribe.buildMultipart({
    boundaryKey: "abc",
    fields: { model: "whisper-1" },
    file: { field: "file", filename: "a.m4a", bytes: Buffer.from("xyz"), contentType: "audio/mp4" },
  });
  const second = transcribe.buildMultipart({
    boundaryKey: "abc",
    fields: { model: "whisper-1" },
    file: { field: "file", filename: "a.m4a", bytes: Buffer.from("xyz"), contentType: "audio/mp4" },
  });
  assert.equal(first.body.toString("binary"), second.body.toString("binary"), "the multipart body must be deterministic");
  assert.ok(first.body.includes(Buffer.from("xyz")));
});

test("transcribe: an empty provider response fails instead of writing an empty artifact", async () => {
  const box = sandbox("transcribe-empty");
  box.write("audio/interview.m4a", "fake audio bytes");
  const result = await transcribe.transcribe({
    input: join(box.work, "audio/interview.m4a"),
    env: { ...box.env, DISTILLY_TRANSCRIBE_API_KEY: SECRET.transcribe },
    root: box.work,
    fetch: async () => json({ text: "", segments: [] }),
  });
  assert.equal(result.ok, false);
  assert.match(result.receipt.unavailable[0].reason, /empty-transcript/);
  assert.equal(box.exists("knowledge"), false);
});
