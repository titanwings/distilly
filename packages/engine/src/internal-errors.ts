import { DistillyError } from "@distilly/protocol";
import type { AmbiguousSubjectCandidates, JsonObject, SubjectSummary } from "@distilly/protocol";

/**
 * Builds a stable invalid-input error for an engine boundary.
 *
 * @param message - Safe explanation for the caller.
 * @param fieldPath - Optional input field that failed validation.
 * @returns A non-retryable invalid-input error.
 */
export const invalidInput = (message: string, fieldPath?: string): DistillyError =>
  new DistillyError({
    code: "invalid_input",
    message,
    retryable: false,
    ...(fieldPath === undefined ? {} : { fieldPath }),
  });

/**
 * Builds a stable missing-fact error.
 *
 * @param message - Safe explanation for the caller.
 * @returns A non-retryable missing-fact error.
 */
export const factNotFound = (message: string): DistillyError =>
  new DistillyError({ code: "not_found", message, retryable: false });

/**
 * Builds a stable corruption error without leaking local file contents.
 *
 * @param message - Safe explanation for the caller.
 * @param cause - Optional underlying failure retained as the error cause.
 * @returns A non-retryable storage-corruption error.
 */
export const storageCorrupt = (message: string, cause?: unknown): DistillyError =>
  new DistillyError(
    { code: "storage_corrupt", message, retryable: false },
    cause === undefined ? undefined : { cause },
  );

/**
 * Builds a stable unsupported-schema error.
 *
 * @param message - Safe explanation for the caller.
 * @param cause - Optional underlying failure retained as the error cause.
 * @returns A non-retryable unsupported-schema error with remediation.
 */
export const schemaUnsupported = (message: string, cause?: unknown): DistillyError =>
  new DistillyError(
    {
      code: "schema_unsupported",
      message,
      retryable: false,
      remediation: "Upgrade Distilly before reading or writing this fact format.",
    },
    cause === undefined ? undefined : { cause },
  );

/**
 * Builds a retryable lock-contention error.
 *
 * @param message - Safe explanation for the caller.
 * @returns A retryable busy error.
 */
export const lockBusy = (message: string): DistillyError =>
  new DistillyError({ code: "busy", message, retryable: true });

/**
 * Builds a stable conflict for a reused mutation request id.
 *
 * @param message - Safe explanation for the caller.
 * @returns A non-retryable idempotency conflict.
 */
export const idempotencyConflict = (message: string): DistillyError =>
  new DistillyError({
    code: "idempotency_conflict",
    message,
    retryable: false,
    remediation: "Generate a new requestId for a different mutation.",
  });

/**
 * Returns the stable direct-SDK error for an absent current pending job.
 *
 * @param message - Safe explanation for the caller.
 * @returns A non-retryable nothing-pending error.
 */
export const nothingPending = (message = "No matching pending job is available."): DistillyError =>
  new DistillyError({ code: "nothing_pending", message, retryable: false });

/**
 * Returns the retryable error used when another active lease owns the job.
 *
 * @param message - Safe explanation for the caller.
 * @returns A retryable lease-conflict error.
 */
export const leaseConflict = (
  message = "The pending job already has an active lease.",
): DistillyError =>
  new DistillyError({
    code: "lease_conflict",
    message,
    retryable: true,
    remediation: "Wait for expiry or release the active lease before briefing again.",
  });

/**
 * Returns the stable error for a lease that is no longer active.
 *
 * @param message - Safe explanation for the caller.
 * @returns A non-retryable lease-expired error.
 */
export const leaseExpired = (message = "The distillation lease has expired."): DistillyError =>
  new DistillyError({
    code: "lease_expired",
    message,
    retryable: false,
    remediation: "Acquire a new briefing lease for the current job.",
  });

/**
 * Returns the stable error for a job replaced by a newer subject generation.
 *
 * @param message - Safe explanation for the caller.
 * @returns A non-retryable stale-job error.
 */
export const staleJob = (message = "The distillation job is no longer current."): DistillyError =>
  new DistillyError({
    code: "stale_job",
    message,
    retryable: false,
    remediation: "List pending work and brief the current generation.",
  });

/**
 * Returns the stable conflict for a subject that already has a review target.
 *
 * @param message - Safe explanation for the caller.
 * @returns A non-retryable review-conflict error.
 */
export const reviewConflict = (
  message = "The subject already has a suspended version awaiting review.",
): DistillyError =>
  new DistillyError({
    code: "review_conflict",
    message,
    retryable: false,
    remediation: "Promote, reject, or correct the suspended version before continuing.",
  });

/**
 * Builds a stable error for a patch reference that is not supported by verified evidence.
 *
 * @param message - Safe explanation that does not include material content or local paths.
 * @param fieldPath - Optional patch field that failed evidence resolution.
 * @returns A non-retryable evidence-validation error.
 */
export const evidenceInvalid = (message: string, fieldPath?: string): DistillyError =>
  new DistillyError({
    code: "evidence_invalid",
    message,
    retryable: false,
    ...(fieldPath === undefined ? {} : { fieldPath }),
    remediation: "Use only evidence references and exact quotes from the current briefing.",
  });

/**
 * Builds the typed single-candidate duplicate response used by create ingest.
 *
 * @param subject - Existing subject selected by the deterministic duplicate rule.
 * @param message - Safe explanation for the caller.
 * @returns A non-retryable typed already-exists error.
 */
export const subjectAlreadyExists = (
  subject: SubjectSummary,
  message = "A matching subject already exists.",
): DistillyError =>
  new DistillyError({
    code: "already_exists",
    message,
    retryable: false,
    remediation: "Use the existing subject or add a locator that proves a different identity.",
    subjectResolution: { kind: "found", subject },
  });

/**
 * Builds the typed multi-candidate response used by subject resolution.
 *
 * @param candidates - Stable list containing at least two possible subjects.
 * @param message - Safe explanation for the caller.
 * @returns A non-retryable typed ambiguous-subject error.
 */
export const ambiguousSubject = (
  candidates: AmbiguousSubjectCandidates,
  message = "More than one subject matches this identity.",
): DistillyError =>
  new DistillyError({
    code: "ambiguous_subject",
    message,
    retryable: false,
    remediation: "Choose an existing subject or add a unique identity locator.",
    subjectResolution: { kind: "ambiguous", candidates },
  });

/**
 * Builds a stable unavailable-projection error.
 *
 * @param message - Safe explanation for the caller.
 * @param cause - Optional underlying failure retained for local diagnostics.
 * @returns A retryable index-unavailable error.
 */
export const indexUnavailable = (message: string, cause?: unknown): DistillyError =>
  new DistillyError(
    {
      code: "index_unavailable",
      message,
      retryable: true,
      remediation: "Rebuild the local projection before reading it.",
    },
    cause === undefined ? undefined : { cause },
  );

/**
 * Builds the stable error used when a client has no trusted briefing capacity.
 *
 * @returns A non-retryable host-capability error.
 */
export const briefingCapacityUnavailable = (): DistillyError =>
  new DistillyError({
    code: "host_unsupported",
    message: "This client session has no verified briefing capacity.",
    retryable: false,
    remediation: "Reconnect through a binding with a tested capacity or supply SDK capacity.",
  });

/**
 * Builds a content-free briefing capacity failure.
 *
 * @param details - Safe aggregate measurements and trusted limits.
 * @returns A non-retryable complete-briefing size error.
 */
export const briefingTooLarge = (details: JsonObject): DistillyError =>
  new DistillyError({
    code: "briefing_too_large",
    message: "The complete distillation briefing exceeds a verified session limit.",
    retryable: false,
    remediation:
      "Use a larger-capacity host, or run distilly recover <job-id> --output <new-directory> for local file recovery within the engine limits. See INSTALL.md; Distilly will not truncate the briefing.",
    details,
  });

/**
 * Builds a content-free profile-prompt capacity failure.
 *
 * @param details - Safe aggregate measurements and the trusted session limit.
 * @returns A non-retryable complete-prompt size error.
 */
export const contextTooLarge = (details: JsonObject): DistillyError =>
  new DistillyError({
    code: "context_too_large",
    message: "The complete profile prompt exceeds a verified session limit.",
    retryable: false,
    remediation:
      "Use a larger-capacity host or choose a smaller profile version; Distilly will not truncate it.",
    details,
  });
