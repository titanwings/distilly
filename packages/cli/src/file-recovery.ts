import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

import {
  DistillyError,
  distillPatchSchema,
  distillyMcpTools,
  jobIdSchema,
  requestIdSchema,
  type CommitInput,
  type HostDistillBriefing,
  type JobId,
} from "@distilly/protocol";
import { openPreviewLocalRuntime } from "@distilly/runtime/preview";

import type { PreviewCliIo } from "./main.js";

const FILE_CAPACITY = {
  maximumInputTokens: 4_194_304,
  maximumToolResultBytes: 4_194_304,
  source: "sdk_explicit" as const,
};
const RESPONSE_MAXIMUM_BYTES = 262_144;
const request = () => requestIdSchema.parse(`req_${randomBytes(16).toString("hex")}`);
const privateWrite = (path: string, content: string) =>
  writeFile(path, content, { flag: "wx", mode: 0o600 });

/** One bounded, explicitly selected local recovery session. */
export interface FileRecoveryOptions {
  readonly root: string;
  readonly jobId: JobId;
  readonly outputDirectory: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/**
 * Parses the recovery command without opening storage or touching output paths.
 *
 * @param args - Arguments after recover.
 * @returns Validated local recovery arguments.
 */
export const parseRecoveryArguments = (
  args: readonly string[],
): Omit<FileRecoveryOptions, "root" | "signal"> => {
  if (
    (args.length !== 3 && args.length !== 5) ||
    args[1] !== "--output" ||
    !args[2] ||
    (args.length === 5 && args[3] !== "--timeout-seconds")
  ) {
    throw new Error(
      "Expected recover <job-id> --output <new-directory> [--timeout-seconds 1..1500].",
    );
  }
  const seconds = args.length === 5 ? Number(args[4]) : 1200;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 1500) {
    throw new Error("Recovery timeout must be an integer from 1 to 1500 seconds.");
  }
  return {
    jobId: jobIdSchema.parse(args[0]),
    outputDirectory: resolve(args[2]),
    timeoutMs: seconds * 1000,
  };
};

const readResponse = async (path: string): Promise<unknown> => {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error("Cannot open response.json as an ordinary local file.");
  });
  if (file === undefined) return undefined;
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > RESPONSE_MAXIMUM_BYTES) {
      throw new Error("response.json must be an ordinary file of at most 262144 bytes.");
    }
    const bytes = Buffer.alloc(RESPONSE_MAXIMUM_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    const after = await file.stat();
    if (
      length > RESPONSE_MAXIMUM_BYTES ||
      length !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.size !== before.size
    ) {
      throw new Error("response.json changed while reading or exceeds the size limit.");
    }
    try {
      // A null JSON value must be rejected, not mistaken for a missing file.
      return JSON.parse(bytes.subarray(0, length).toString("utf8")) as unknown;
    } catch {
      throw new Error(
        "Invalid response.json. Write a complete temporary file, then rename it to response.json.",
      );
    }
  } finally {
    await file.close();
  }
};

const responsePatch = (value: unknown, digest: string): CommitInput["patch"] => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a response object with briefingSha256 and patch.");
  }
  const response = value as Record<string, unknown>;
  if (
    Object.keys(response).length !== 2 ||
    !Object.hasOwn(response, "patch") ||
    response.briefingSha256 !== digest
  ) {
    throw new Error(
      "Response does not match this briefing. Use its exact briefingSha256 and patch only.",
    );
  }
  const parsed = distillPatchSchema.safeParse(response.patch);
  if (!parsed.success)
    throw new Error(
      "Invalid patch: follow the briefing contract and the 65536-byte canonical patch limit.",
    );
  return parsed.data as CommitInput["patch"];
};

/**
 * Exports one complete briefing and commits only an explicitly supplied matching response.
 *
 * @param options - Private artifact path, job, deadline, and optional cancellation.
 * @param io - Content-free progress and error output.
 * @returns Completion after commit, lease cleanup, and runtime closure.
 */
export const recoverFromFiles = async (
  options: FileRecoveryOptions,
  io: PreviewCliIo,
): Promise<void> => {
  if (
    !Number.isInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 1_500_000
  ) {
    throw new Error("Recovery timeout must be positive and no longer than 25 minutes.");
  }
  const runtime = await openPreviewLocalRuntime({ root: options.root });
  let briefing: HostDistillBriefing | undefined;
  let committed = false;
  let client: Awaited<ReturnType<typeof runtime.connectTrusted>> | undefined;
  try {
    options.signal?.throwIfAborted();
    client = await runtime.connectTrusted({
      actor: { kind: "sdk", id: `file-recovery-${randomBytes(16).toString("hex")}` },
      capacity: FILE_CAPACITY,
    });
    briefing = await client.call(
      "distill.brief",
      { jobId: options.jobId },
      { requestId: request() },
    );
    const deadline = Date.now() + options.timeoutMs;
    const serialized = `${JSON.stringify(briefing)}\n`;
    const digest = createHash("sha256").update(serialized).digest("hex");
    await mkdir(options.outputDirectory, { mode: 0o700 });
    await privateWrite(join(options.outputDirectory, "briefing.json"), serialized);
    const commitTool = distillyMcpTools.find((tool) => tool.name === "distilly_commit");
    if (commitTool === undefined) throw new Error("Missing commit tool schema.");
    await privateWrite(
      join(options.outputDirectory, "commit-tool-schema.json"),
      `${JSON.stringify(commitTool.inputSchema)}\n`,
    );
    await privateWrite(
      join(options.outputDirectory, "README.txt"),
      `Read the complete briefing.json, including its contract and all materials, before preparing a patch.\nSHA-256 of the exact briefing.json bytes: ${digest}\nWrite a temporary JSON file with exactly these two fields:\n{"briefingSha256":"${digest}","patch":<your DistillPatch object>}\nThen rename it to response.json in this directory. Do not edit briefing.json.\nThe patch must follow the patch property in commit-tool-schema.json and cite exact evidence from this briefing.\nDo not submit an empty patch unless you have reviewed all material and deliberately found no claims to add or change.\nThis command waits up to ${String(options.timeoutMs / 1000)} seconds and keeps the same lease.\nThe file transport supports a complete briefing up to 4 MiB and 999 material refs; this does not establish a model's context capacity.\nCancellation or an invalid response attempts to release the lease. Force-killing the process leaves it to expire.\n`,
    );
    io.stdout.write(
      `Recovery briefing: ${join(options.outputDirectory, "briefing.json")}\nRead README.txt and submit response.json within ${String(options.timeoutMs / 1000)} seconds.\n`,
    );
    let response: unknown;
    while (response === undefined) {
      options.signal?.throwIfAborted();
      if (Date.now() >= deadline)
        throw new Error("Recovery timed out before submission; no commit was attempted.");
      response = await readResponse(join(options.outputDirectory, "response.json"));
      if (response === undefined)
        await setTimeout(Math.min(250, deadline - Date.now()), undefined, {
          signal: options.signal,
        });
    }
    const patch = responsePatch(response, digest);
    const input: CommitInput = {
      jobId: briefing.job.id,
      generation: briefing.job.generation,
      leaseId: briefing.lease.id,
      briefContractDigest: briefing.contract.digest,
      materialSetHash: briefing.job.materialSetHash,
      ...(briefing.job.baseVersionId === undefined
        ? {}
        : { baseVersionId: briefing.job.baseVersionId }),
      patch,
    };
    const requestId = request();
    await privateWrite(
      join(options.outputDirectory, "submission.json"),
      `${JSON.stringify({ requestId, input })}\n`,
    );
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline)
      throw new Error("Recovery timed out before submission; no commit was attempted.");
    const result = await client
      .call("distill.commit", input, { requestId })
      .catch((error: unknown) => {
        if (error instanceof DistillyError && error.code !== "internal_error") throw error;
        throw new Error(
          `Commit outcome is unknown for ${requestId}. Keep submission.json and inspect the subject's current version and pending work before retrying.`,
          { cause: error },
        );
      });
    committed = true;
    const versionId = result.kind === "current" ? result.version.id : result.candidate.id;
    io.stdout.write(
      `Recovery committed ${result.kind} version ${versionId} (request ${requestId}).\n`,
    );
    try {
      await privateWrite(
        join(options.outputDirectory, "result.json"),
        `${JSON.stringify({ requestId, result })}\n`,
      );
    } catch {
      throw new Error(
        `Commit succeeded: ${result.kind} version ${versionId}, request ${requestId}. Could not write result.json; do not resubmit this patch.`,
      );
    }
  } finally {
    try {
      if (briefing !== undefined && client !== undefined && !committed) {
        await client
          .call(
            "distill.release",
            { jobId: briefing.job.id, leaseId: briefing.lease.id },
            { requestId: request() },
          )
          .catch((error: unknown) => {
            if (
              error instanceof DistillyError &&
              ["stale_job", "lease_expired", "lease_conflict", "not_found"].includes(error.code)
            )
              return;
            io.stderr.write(
              "Could not confirm lease release; wait for lease expiry before retrying.\n",
            );
          });
      }
    } finally {
      await runtime.close();
    }
  }
};
