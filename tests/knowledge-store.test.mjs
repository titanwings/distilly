/**
 * `knowledge/store.mjs` — raw bytes are stored verbatim, writes are atomic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  KnowledgeStore,
  atomicWriteBytes,
  putRawOnce,
  sha256Hex,
  slugifyFileName,
  slugifySource,
  stableStringify,
} from "../src/knowledge/store.mjs";

const tempRoot = () => mkdtempSync(join(tmpdir(), "distilly-store-"));

test("raw bytes round-trip exactly, including invalid UTF-8 and NUL", () => {
  const store = new KnowledgeStore(tempRoot());
  const payload = Buffer.from([0x00, 0xff, 0xfe, 0x41, 0x0a, 0x0d, 0x80, 0x7f, 0x1b]);
  const written = store.writeRaw("chatgpt", "weird.bin", payload);
  assert.equal(written.bytes, payload.length);
  assert.equal(written.sha256, sha256Hex(payload));
  assert.ok(readFileSync(written.path).equals(payload));
  assert.ok(Buffer.from(store.readRaw("chatgpt", "weird.bin")).equals(payload));
});

test("raw writes preserve an empty file as an empty file", () => {
  const store = new KnowledgeStore(tempRoot());
  const written = store.writeRaw("empty", "nothing.txt", Buffer.alloc(0));
  assert.equal(written.bytes, 0);
  assert.equal(readFileSync(written.path).length, 0);
  assert.equal(statSync(written.path).isFile(), true);
});

test("the same bytes written twice produce the same digest and one file", () => {
  const store = new KnowledgeStore(tempRoot());
  const bytes = Buffer.from("stable\n", "utf8");
  const first = putRawOnce(store, "slack", "export.json", bytes);
  const second = putRawOnce(store, "slack", "export.json", bytes);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.unchanged, true);
  assert.deepEqual(store.listRaw("slack"), [{ name: "export.json", bytes: bytes.length }]);
});

test("atomicWriteBytes leaves no staging files behind", () => {
  const root = tempRoot();
  const target = join(root, "nested", "index.json");
  atomicWriteBytes(target, Buffer.from("{}\n", "utf8"));
  assert.equal(readFileSync(target, "utf8"), "{}\n");
  assert.deepEqual(readdirSync(join(root, "nested")), ["index.json"]);
});

test("atomicWriteBytes replaces existing content in one step", () => {
  const root = tempRoot();
  const target = join(root, "index.json");
  writeFileSync(target, "old-and-longer-content");
  atomicWriteBytes(target, Buffer.from("new", "utf8"));
  assert.equal(readFileSync(target, "utf8"), "new");
});

test("source and file names are slugified but never escape their bucket", () => {
  assert.equal(slugifySource("ChatGPT Export 2024"), "chatgpt-export-2024");
  assert.equal(slugifySource("X/Twitter"), "x-twitter");
  assert.equal(slugifyFileName("../../etc/passwd"), "passwd");
  assert.equal(slugifyFileName(".."), "payload");
  assert.equal(slugifyFileName(""), "payload");
  assert.equal(slugifyFileName("Messages/ro\nw.csv"), "ro-w.csv");
  assert.throws(() => slugifySource(""), TypeError);
});

test("rawPath rejects traversal out of the bucket", () => {
  const store = new KnowledgeStore(tempRoot());
  assert.throws(() => store.rawPath("slack", "../../escape.json"), TypeError);
  assert.throws(() => store.rawPath("slack", ""), TypeError);
  const nested = store.rawPath("slack", "messages/2024/01.json");
  assert.ok(nested.includes(join("raw", "slack", "messages", "2024", "01.json")));
});

test("stableStringify sorts keys so equal values hash equally", () => {
  const a = stableStringify({ b: 1, a: [3, { z: 1, y: 2 }] });
  const b = stableStringify({ a: [3, { y: 2, z: 1 }], b: 1 });
  assert.equal(a, b);
  assert.throws(() => {
    const cyclic = {};
    cyclic.self = cyclic;
    stableStringify(cyclic);
  }, TypeError);
});

test("concurrent atomic writes to one path never interleave", async () => {
  const root = tempRoot();
  const target = join(root, "race.json");
  const payloads = Array.from({ length: 24 }, (_, index) => Buffer.from(`${index}`.repeat(500), "utf8"));
  await Promise.all(payloads.map((bytes) => Promise.resolve().then(() => atomicWriteBytes(target, bytes))));
  const finalBytes = readFileSync(target);
  assert.ok(payloads.some((bytes) => bytes.equals(finalBytes)), "the file must hold exactly one writer's payload");
  assert.deepEqual(readdirSync(root), ["race.json"]);
});
