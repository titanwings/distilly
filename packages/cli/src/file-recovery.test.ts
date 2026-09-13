import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { isoDateTimeSchema, requestIdSchema, type HostDistillBriefing } from "@distilly/protocol";
import { openPreviewLocalRuntime } from "@distilly/runtime/preview";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseRecoveryArguments,
  recoverFromFiles,
  type FileRecoveryOptions,
} from "./file-recovery.js";

import { runPreviewCli } from "./main.js";

const roots: string[] = [];
const request = () => requestIdSchema.parse(`req_${randomBytes(16).toString("hex")}`);
const capacity = {
  maximumInputTokens: 4_194_304,
  maximumToolResultBytes: 4_194_304,
  source: "sdk_explicit" as const,
};
const content =
  "Mira builds reliable systems.\n" + "Full source evidence must remain available.\n".repeat(2000);

const seed = async () => {
  const directory = await mkdtemp(join(tmpdir(), "distilly-file-recovery-"));
  roots.push(directory);
  const root = join(directory, ".distilly");
  const runtime = await openPreviewLocalRuntime({ root });
  try {
    const client = await runtime.connectTrusted({
      actor: { kind: "sdk", id: "seed" },
      capacity: { ...capacity, maximumToolResultBytes: 65_536 },
    });
    const result = await client.call(
      "materials.ingest",
      {
        subject: { kind: "create", input: { displayName: "Mira", identityHints: [] } },
        materials: [
          {
            clientRef: "full-source",
            kind: "document",
            content,
            source: {
              medium: "document",
              access: "private",
              capturedAt: isoDateTimeSchema.parse("2026-09-01T00:00:00.000Z"),
            },
            derivation: { kind: "native_text" },
            sensitivity: "private",
          },
        ],
        enqueue: "now",
      },
      { requestId: request() },
    );
    if (result.kind !== "ingested" || result.job === undefined) throw new Error("Missing job");
    await expect(
      client.call("distill.brief", { jobId: result.job.id }, { requestId: request() }),
    ).rejects.toMatchObject({ code: "briefing_too_large" });
    return {
      root,
      jobId: result.job.id,
      outputDirectory: join(directory, "recovery"),
      timeoutMs: 5000,
    };
  } finally {
    await runtime.close();
  }
};

const assertPending = async (root: string) => {
  const runtime = await openPreviewLocalRuntime({ root });
  try {
    const client = await runtime.connectTrusted({ actor: { kind: "sdk", id: "verify" }, capacity });
    const jobs = await client.call("distill.pending", {});
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (job === undefined) throw new Error("Missing job");
    const brief = await client.call("distill.brief", { jobId: job.id }, { requestId: request() });
    expect(brief.materials[0]?.content).toBe(content);
    await client.call(
      "distill.release",
      { jobId: job.id, leaseId: brief.lease.id },
      { requestId: request() },
    );
  } finally {
    await runtime.close();
  }
};

const responseFor = async (directory: string) => {
  const bytes = await readFile(join(directory, "briefing.json"));
  const briefing = JSON.parse(bytes.toString()) as HostDistillBriefing;
  expect(bytes.length).toBeGreaterThan(65_536);
  expect(briefing.materials[0]?.content).toBe(content);
  return {
    briefingSha256: createHash("sha256").update(bytes).digest("hex"),
    patch: {
      operations: [
        {
          op: "add",
          claim: {
            facet: "identity",
            text: "Mira builds reliable systems.",
            evidence: [
              {
                kind: "brief_material",
                materialRef: briefing.materials[0]?.ref,
                quote: "Mira builds reliable systems.",
              },
            ],
          },
        },
      ],
    },
  };
};

const runWithResponse = async (options: FileRecoveryOptions, respond: () => Promise<void>) => {
  let ready!: () => void;
  const exported = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const output: string[] = [];
  const running = recoverFromFiles(options, {
    stdout: {
      write: (value) => {
        output.push(value);
        ready();
      },
    },
    stderr: { write: (value) => output.push(value) },
  });
  // Attach a rejection handler immediately while the response is prepared.
  const outcome = running.then(
    () => ({ error: undefined }),
    (error: unknown) => ({ error }),
  );
  await exported;
  await respond();
  return { ...(await outcome), output };
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("file briefing recovery", () => {
  it("recovers a rejected 85 KiB source with exact evidence through the same lease", async () => {
    const options = await seed();
    const result = await runWithResponse(options, async () => {
      const response = await responseFor(options.outputDirectory);
      const temporary = join(options.outputDirectory, "response.tmp");
      await writeFile(temporary, JSON.stringify(response));
      await rename(temporary, join(options.outputDirectory, "response.json"));
    });
    expect(result.error).toBeUndefined();
    expect(result.output.join("")).toContain("Recovery committed current version");
    expect(result.output.join("")).not.toContain(content);
    const receipt = JSON.parse(
      await readFile(join(options.outputDirectory, "result.json"), "utf8"),
    ) as { result: { kind: string } };
    expect(receipt.result.kind).toBe("current");
    expect((await stat(options.outputDirectory)).mode & 0o777).toBe(0o700);
    for (const name of [
      "briefing.json",
      "README.txt",
      "commit-tool-schema.json",
      "submission.json",
      "result.json",
    ]) {
      expect((await stat(join(options.outputDirectory, name))).mode & 0o777).toBe(0o600);
    }
    const runtime = await openPreviewLocalRuntime({ root: options.root });
    try {
      const client = await runtime.connectTrusted({
        actor: { kind: "sdk", id: "verify" },
        capacity,
      });
      expect(await client.call("distill.pending", {})).toEqual([]);
    } finally {
      await runtime.close();
    }
  });

  it.each([
    "wrong binding",
    "invalid quote",
    "partial JSON",
    "oversized",
    "symlink",
    "directory",
    "null",
    "extra identity",
  ])("rejects %s without consuming pending research", async (mode) => {
    const options = await seed();
    const result = await runWithResponse(options, async () => {
      const response = await responseFor(options.outputDirectory);
      const path = join(options.outputDirectory, "response.json");
      if (mode === "symlink") {
        await symlink(join(options.outputDirectory, "briefing.json"), path);
        return;
      }
      if (mode === "directory") {
        await mkdir(path);
        return;
      }
      if (mode === "wrong binding") response.briefingSha256 = "0".repeat(64);
      if (mode === "invalid quote")
        response.patch.operations[0]!.claim.evidence[0]!.quote = "This quote is not present.";
      const serialized =
        mode === "partial JSON"
          ? "{"
          : mode === "oversized"
            ? " ".repeat(262_145)
            : mode === "null"
              ? "null"
              : JSON.stringify(
                  mode === "extra identity" ? { ...response, generation: 999 } : response,
                );
      await writeFile(path, serialized);
    });
    expect(result.error).toBeInstanceOf(Error);
    await assertPending(options.root);
  });

  it("times out with no automatic empty commit and releases the lease", async () => {
    const options = await seed();
    await expect(
      recoverFromFiles(
        { ...options, timeoutMs: 20 },
        { stdout: { write: () => {} }, stderr: { write: () => {} } },
      ),
    ).rejects.toThrow("timed out");
    await expect(stat(join(options.outputDirectory, "submission.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await assertPending(options.root);
  });

  it("releases the lease on cancellation", async () => {
    const options = await seed();
    const controller = new AbortController();
    const result = await runWithResponse({ ...options, signal: controller.signal }, () => {
      controller.abort();
      return Promise.resolve();
    });
    expect(result.error).toBeInstanceOf(Error);
    await assertPending(options.root);
  });

  it("does not overwrite an existing output directory", async () => {
    const options = await seed();
    await mkdir(options.outputDirectory);
    await writeFile(join(options.outputDirectory, "briefing.json"), "keep me");
    await expect(
      recoverFromFiles(options, { stdout: { write: () => {} }, stderr: { write: () => {} } }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(options.outputDirectory, "briefing.json"), "utf8")).toBe("keep me");
    await assertPending(options.root);
  });

  it("reports a durable commit even when the result receipt cannot be written", async () => {
    const options = await seed();
    const result = await runWithResponse(options, async () => {
      await writeFile(join(options.outputDirectory, "result.json"), "keep me");
      await writeFile(
        join(options.outputDirectory, "response.json"),
        JSON.stringify(await responseFor(options.outputDirectory)),
      );
    });
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toContain("Commit succeeded:");
    expect(await readFile(join(options.outputDirectory, "result.json"), "utf8")).toBe("keep me");
  });

  it.each([
    { args: [] },
    { args: ["bad", "--output", "/tmp/new"] },
    { args: ["job_" + "a".repeat(32), "--output", "/tmp/new", "--timeout-seconds", "1800"] },
  ])("rejects invalid arguments before opening storage: $args", ({ args }) => {
    expect(() => parseRecoveryArguments(args)).toThrow();
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "routes the real CLI command and cleans up %s listeners",
    async (signal) => {
      const options = await seed();
      const beforeInt = process.listenerCount("SIGINT");
      const beforeTerm = process.listenerCount("SIGTERM");
      await expect(
        runPreviewCli(
          ["recover", options.jobId, "--output", options.outputDirectory],
          {
            lifecycle: {
              homeDirectory: dirname(options.root),
              nodePath: process.execPath,
              entryPath: "/unused",
              pluginSourcesPath: "/unused",
              pathValue: "",
            },
            panelAssetsPath: "/unused",
          },
          {
            stdout: {
              write: () => {
                process.emit(signal);
              },
            },
            stderr: { write: () => {} },
          },
        ),
      ).rejects.toThrow("cancelled");
      expect(process.listenerCount("SIGINT")).toBe(beforeInt);
      expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
      await assertPending(options.root);
    },
  );

  it("does not take over or release another session's active lease", async () => {
    const options = await seed();
    const runtime = await openPreviewLocalRuntime({ root: options.root });
    try {
      const client = await runtime.connectTrusted({
        actor: { kind: "sdk", id: "other-owner" },
        capacity,
      });
      const brief = await client.call(
        "distill.brief",
        { jobId: options.jobId },
        { requestId: request() },
      );
      await runtime.close();
      await expect(
        recoverFromFiles(options, { stdout: { write: () => {} }, stderr: { write: () => {} } }),
      ).rejects.toMatchObject({ code: "lease_conflict" });
      await expect(stat(options.outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
      const reopened = await openPreviewLocalRuntime({ root: options.root });
      try {
        const observer = await reopened.connectTrusted({
          actor: { kind: "sdk", id: "observer" },
          capacity,
        });
        await expect(
          observer.call("distill.brief", { jobId: options.jobId }, { requestId: request() }),
        ).rejects.toMatchObject({ code: "lease_conflict" });
        expect(brief.lease.owner).toBeDefined();
      } finally {
        await reopened.close();
      }
    } finally {
      await runtime.close();
    }
  });
});
