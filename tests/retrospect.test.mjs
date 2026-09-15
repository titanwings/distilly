/**
 * `retrospect` — deterministic derivation.
 *
 * The fixture under `src/derive/fixtures/synthetic-group` is a hand-written
 * ledger whose features are known in advance (see its README), so every
 * assertion here is a claim about behaviour rather than a snapshot of output.
 *
 * Covered:
 *   1. the fixture itself is intact (ledger digests == text bytes)
 *   2. seven files, every claim citing an anchor that the ledger declares
 *   3. two runs in a fresh directory are byte-identical
 *   4. the features the fixture was built to contain are actually found
 *   5. two messages produce empty claim lists plus a reason, never a guess
 *   6. the module contains no network or model call
 *   7. the CLI entry point honours the receipt and exit-code contract
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DERIVED_KINDS, run, stableStringify } from "../src/derive/retrospect.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const FIXTURE = join(repoRoot, "src", "derive", "fixtures", "synthetic-group");
const CLI = join(repoRoot, "bin", "distilly.mjs");
const SLUG = "synthetic-group";
const CONTRACT_ANCHOR = /k\d{4}(?::t\d+)?/g;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

/** A throwaway working directory holding `skills/colleague/<slug>/`. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "distilly-retrospect-"));
  const person = join(root, "skills", "colleague", SLUG);
  cpSync(FIXTURE, person, { recursive: true });
  return { root, person };
}

/** Run the command in-process, capturing both streams instead of printing. */
function runCaptured(args, cwd) {
  const captured = { out: "", err: "" };
  const result = run(args, {
    cwd,
    stdout: { write: (chunk) => (captured.out += chunk) },
    stderr: { write: (chunk) => (captured.err += chunk) },
  });
  return { ...result, ...captured };
}

function derivedDir(person) {
  return join(person, "evidence", "derived");
}

function readDerived(person) {
  const documents = {};
  for (const name of readdirSync(derivedDir(person)).sort()) {
    if (!name.endsWith(".json")) continue;
    documents[name.replace(/\.json$/, "")] = JSON.parse(
      readFileSync(join(derivedDir(person), name), "utf8"),
    );
  }
  return documents;
}

function hashDerived(person) {
  const hashes = {};
  for (const name of readdirSync(derivedDir(person)).sort()) {
    hashes[name] = sha256(readFileSync(join(derivedDir(person), name)));
  }
  return hashes;
}

function ledgerAnchors(person) {
  const ledger = JSON.parse(readFileSync(join(person, "knowledge", "index.json"), "utf8"));
  return {
    ledger,
    declared: new Set(ledger.flatMap((entry) => entry.anchors ?? [])),
  };
}

/** Every anchor physically present in the normalised text. */
function textAnchors(person) {
  const textRoot = join(person, "knowledge", "text");
  const found = new Set();
  for (const name of readdirSync(textRoot).sort()) {
    const body = readFileSync(join(textRoot, name), "utf8");
    for (const match of body.matchAll(CONTRACT_ANCHOR)) found.add(match[0]);
  }
  return found;
}

test("the fixture ledger digests match the fixture text bytes", () => {
  const { ledger, declared } = ledgerAnchors(FIXTURE);
  assert.equal(ledger.length, 3);
  const textRoot = join(FIXTURE, "knowledge", "text");
  // Pairing is by digest, not by name: a ledger entry's `origin` names the raw
  // payload, which is not the same file as the normalised text.
  for (const name of readdirSync(textRoot).sort()) {
    const bytes = readFileSync(join(textRoot, name));
    const digest = sha256(bytes);
    const entry = ledger.find((candidate) => candidate.sha256 === digest);
    assert.ok(entry, `${name} has no ledger entry with a matching sha256`);
    assert.equal(entry.bytes, bytes.length, `${entry.id} byte count`);
  }
  assert.equal(declared.size, 71, "the fixture declares 71 anchors");
  for (const anchor of declared) {
    assert.match(anchor, /^k\d{4}(?::t\d+)?$/);
  }
});

test("seven files are written and every claim cites a resolvable anchor", () => {
  const { root, person } = workspace();
  try {
    const { exitCode, receipt } = runCaptured(["--person", SLUG, "--json"], root);
    assert.equal(exitCode, 0);
    assert.equal(receipt.ok, true);

    const names = readdirSync(derivedDir(person)).sort();
    assert.deepEqual(
      names,
      DERIVED_KINDS.map((kind) => `${kind}.json`).sort(),
    );

    const { declared } = ledgerAnchors(person);
    const inText = textAnchors(person);
    const documents = readDerived(person);
    const generatedFrom = documents.stats.generated_from.map((input) => input.path);
    assert.deepEqual(generatedFrom, [
      "knowledge/index.json",
      "knowledge/text/dm-lin-chen.md",
      "knowledge/text/group-chat.md",
      "knowledge/text/incident-postmortem.md",
    ]);

    for (const kind of DERIVED_KINDS) {
      const document = documents[kind];
      assert.equal(document.kind, kind);
      assert.ok(
        document.claims.length > 0,
        `${kind} produced no claim on a 71-message fixture`,
      );
      assert.deepEqual(
        document.generated_from.map((input) => input.path).sort(),
        generatedFrom.slice().sort(),
        `${kind}.generated_from must list every input`,
      );
      for (const input of document.generated_from) {
        assert.match(input.sha256, /^[0-9a-f]{64}$/);
      }

      for (const claim of document.claims) {
        assert.match(claim.id, new RegExp(`^${kind}\\.`), `${claim.id} is namespaced by file`);
        assert.equal(typeof claim.label.zh, "string");
        assert.equal(typeof claim.label.en, "string");
        assert.ok(["high", "medium", "low"].includes(claim.confidence));
        assert.ok(
          Array.isArray(claim.evidence) && claim.evidence.length >= 1,
          `${claim.id} has no evidence`,
        );
        for (const anchor of claim.evidence) {
          assert.ok(declared.has(anchor), `${claim.id} cites undeclared anchor ${anchor}`);
          assert.ok(inText.has(anchor), `${claim.id} cites anchor ${anchor} absent from text`);
        }
        assert.equal(new Set(claim.evidence).size, claim.evidence.length, "no duplicate anchors");
      }
    }

    // The mechanical assertion from docs/v2/ACCEPTANCE.md §5, run the way the
    // acceptance script runs it: by scanning the bytes on disk.
    let dangling = 0;
    for (const name of names) {
      const body = readFileSync(join(derivedDir(person), name), "utf8");
      for (const match of body.matchAll(/"?(k\d{4}(?::t\d+)?)"?/g)) {
        if (!declared.has(match[1])) dangling += 1;
      }
    }
    assert.equal(dangling, 0, "no anchor in the derived files may be dangling");

    assert.ok(receipt.outputs.length === DERIVED_KINDS.length);
    for (const output of receipt.outputs) {
      assert.match(output.sha256, /^[0-9a-f]{64}$/);
      assert.ok(output.bytes > 0);
    }
    assert.deepEqual(receipt.anchors, { total: 71, cited: receipt.anchors.cited });
    assert.ok(receipt.anchors.cited > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two runs over the same ledger are byte-identical", () => {
  const first = workspace();
  const second = workspace();
  try {
    assert.equal(runCaptured(["--person", SLUG, "--json"], first.root).exitCode, 0);
    const before = hashDerived(first.person);
    assert.equal(runCaptured(["--person", SLUG, "--json"], first.root).exitCode, 0);
    const after = hashDerived(first.person);
    assert.deepEqual(after, before, "a second run in the same directory changed the bytes");

    assert.equal(runCaptured(["--person", SLUG, "--json"], second.root).exitCode, 0);
    const elsewhere = hashDerived(second.person);
    assert.deepEqual(elsewhere, before, "the same ledger in another directory hashed differently");

    // The gate `scripts/acceptance.mjs` applies: two separate processes, whose
    // pids, clocks and environments all differ. In-process runs cannot see
    // process-level nondeterminism, so this one is spawned for real.
    rmSync(derivedDir(second.person), { recursive: true, force: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const spawned = spawnSync(
        process.execPath,
        [CLI, "retrospect", "--person", SLUG, "--json"],
        { cwd: second.root, encoding: "utf8" },
      );
      assert.equal(spawned.status, 0, spawned.stderr);
    }
    assert.deepEqual(hashDerived(second.person), before, "a fresh process produced different bytes");

    // Nothing time, locale or environment dependent may leak into the output.
    const stats = readFileSync(join(first.person, "evidence", "derived", "stats.json"), "utf8");
    assert.equal(stats, `${stableStringify(JSON.parse(stats))}\n`);
  } finally {
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});

test("the features the fixture was built around are actually found", () => {
  const { root, person } = workspace();
  try {
    runCaptured(["--person", SLUG, "--json"], root);
    const documents = readDerived(person);

    // >= 3 speakers and >= 60 messages, per the fixture's purpose.
    const participants = documents.stats.claims.find((claim) => claim.id === "stats.participants");
    assert.ok(participants.value.length >= 3, "expected at least three speakers");
    const count = documents.stats.claims.find((claim) => claim.id === "stats.message_count");
    assert.ok(count.value >= 60, "expected at least sixty messages");
    assert.ok(
      documents.stats.claims.some((claim) => claim.id === "stats.time_span_days"),
    );

    // One tone/length jump around the incident and one on the way back.
    const shifts = documents.shifts.claims;
    assert.ok(shifts.length >= 1, "no shift candidate found");
    assert.ok(
      shifts.some((claim) => claim.value.metric === "mean_chars"),
      "the fixture's length jump was not detected",
    );

    // The two deflections written into the fixture.
    const boundaries = documents.boundaries.claims;
    assert.ok(boundaries.length >= 2, "no avoidance candidate found");
    const quoted = boundaries
      .filter((claim) => claim.value.rules.some((rule) => rule.startsWith("R1")))
      .map((claim) => claim.evidence.join(","));
    assert.ok(
      quoted.some((evidence) => evidence.includes("k0001:t18")),
      "the offer deflection at k0001:t18/t19 was not found",
    );
    assert.ok(
      quoted.some((evidence) => evidence.includes("k0001:t31")),
      "the second deflection at k0001:t31/t32 was not found",
    );

    // One contradiction inside a single speaker and one across two speakers,
    // on two different stance dimensions.
    const conflicts = documents.conflicts.claims;
    assert.ok(
      conflicts.some((claim) => claim.value.same_speaker === true),
      "the intra-speaker contradiction was not found",
    );
    assert.ok(
      conflicts.some((claim) => claim.value.same_speaker === false),
      "the cross-speaker contradiction was not found",
    );
    assert.deepEqual(
      [...new Set(conflicts.map((claim) => claim.value.dimension))].sort(),
      ["certainty", "sentiment"],
    );

    // Address change: 林工 -> 林哥 inside the DM.
    const shift = documents.relations.claims.find(
      (claim) => claim.id === "relations.address_shift.1",
    );
    assert.ok(shift, "the address-term change was not found");
    assert.equal(shift.value.from, "林工");
    assert.equal(shift.value.to, "林哥");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two messages yield empty claim lists and a stated reason", () => {
  const root = mkdtempSync(join(tmpdir(), "distilly-retrospect-tiny-"));
  const person = join(root, "skills", "colleague", "tiny");
  try {
    mkdirSync(join(person, "knowledge", "text"), { recursive: true });
    const body = Buffer.from(
      "[k0001:t1] 2024-03-04T09:02:00Z 甲：你好。\n[k0001:t2] 2024-03-04T09:03:00Z 乙：好。\n",
      "utf8",
    );
    writeFileSync(join(person, "knowledge", "text", "chat.md"), body);
    writeFileSync(
      join(person, "knowledge", "index.json"),
      `${JSON.stringify(
        [
          {
            id: "k-src-1",
            kind: "messages",
            origin: "chat.json",
            fetched_at: "2024-03-05T00:00:00Z",
            bytes: body.length,
            sha256: sha256(body),
            credentialed: false,
            method: "parse-chat",
            warnings: [],
            anchors: ["k0001:t1", "k0001:t2"],
          },
        ],
        null,
        2,
      )}\n`,
    );

    const { exitCode, receipt } = runCaptured(["--person", "tiny", "--json"], root);
    assert.equal(exitCode, 0, "a thin corpus is not an error");
    assert.equal(receipt.ok, true);

    const documents = readDerived(person);
    assert.deepEqual(Object.keys(documents).sort(), DERIVED_KINDS.slice().sort());
    for (const kind of DERIVED_KINDS) {
      assert.deepEqual(documents[kind].claims, [], `${kind} invented a claim from two messages`);
      assert.ok(documents[kind].notes.length >= 1, `${kind} skipped silently`);
      const note = documents[kind].notes.join(" ");
      assert.match(note, /样本不足|Insufficient sample/);
      assert.match(note, /2 条|2 citable/);
      assert.match(note, /8/, "the note must name the threshold that was missed");
    }
    assert.equal(receipt.anchors.cited, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the derivation calls no network and no model", () => {
  const forbidden = [
    [/fetch\s*\(/, "fetch()"],
    [/XMLHttpRequest/, "XMLHttpRequest"],
    [/node:https?\b/, "node:http(s) import"],
    [/\bhttps?:\/\//i, "a URL literal"],
    [/openai|anthropic|deepseek|gemini|ollama/i, "a model provider name"],
    [/child_process|execSync|spawnSync/, "process spawning"],
    [/Math\.random/, "Math.random"],
    [/Date\.now/, "Date.now"],
    [/new Date\(\s*\)/, "new Date() with no argument"],
    [/\brequire\s*\(/, "CommonJS require"],
  ];
  const modules = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".mjs")) modules.push(path);
    }
  };
  walk(join(repoRoot, "src", "derive"));
  assert.ok(modules.length >= 1, "no derivation module found to scan");

  for (const path of modules) {
    const source = readFileSync(path, "utf8");
    for (const [pattern, label] of forbidden) {
      assert.ok(
        !pattern.test(source),
        `${relative(repoRoot, path)} must not contain ${label}`,
      );
    }
    // The only imports allowed are Node's own pure modules.
    for (const match of source.matchAll(/^\s*import[^;\n]*from\s+"([^"]+)"/gm)) {
      assert.ok(
        match[1].startsWith("node:"),
        `${relative(repoRoot, path)} imports ${match[1]}`,
      );
    }
  }
});

test("the CLI entry point returns a contract-shaped receipt", () => {
  const { root, person } = workspace();
  try {
    const result = spawnSync(process.execPath, [CLI, "retrospect", "--person", SLUG, "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    assert.equal(receipt.command, "retrospect");
    assert.equal(receipt.person, SLUG);
    assert.equal(receipt.ok, true);
    assert.ok(Array.isArray(receipt.inputs) && receipt.inputs.length === 4);
    assert.ok(Array.isArray(receipt.outputs) && receipt.outputs.length === DERIVED_KINDS.length);
    assert.ok(Array.isArray(receipt.warnings));
    assert.ok(Array.isArray(receipt.unavailable));
    for (const item of [...receipt.inputs, ...receipt.outputs]) {
      assert.match(item.sha256, /^[0-9a-f]{64}$/);
      assert.equal(typeof item.bytes, "number");
      assert.equal(typeof item.path, "string");
    }

    const help = spawnSync(process.execPath, [CLI, "retrospect", "--help"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /用法 \/ Usage/);
    assert.match(help.stdout, /Options:/);

    const missing = spawnSync(process.execPath, [CLI, "retrospect", "--person", "nobody", "--json"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(missing.status, 2, "a missing ledger must not exit 0");
    const failure = JSON.parse(missing.stdout.slice(missing.stdout.indexOf("{")));
    assert.equal(failure.ok, false);
    assert.equal(failure.error.code, "retrospect/missing-input");
    assert.equal(typeof failure.error.remedy, "string");
    assert.deepEqual(readdirSync(derivedDir(person)).length, DERIVED_KINDS.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
