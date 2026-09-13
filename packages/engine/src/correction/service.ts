import type { DatabaseSync } from "node:sqlite";

import {
  actorContextSchema,
  DistillyError,
  engineMethodSchemas,
  eventRecordSchema,
  mutationContextSchema,
} from "@distilly/protocol";
import type {
  ActorContext,
  CommitResult,
  ContentDigest,
  CorrectInput,
  EngineEvent,
  EventRecord,
  IsoDateTime,
  MutationContext,
  PendingJob,
  Profile,
  ReviewReason,
  SubjectId,
  VersionClaimsSnapshot,
  VersionMaterialManifest,
  VersionRecord,
} from "@distilly/protocol";

import type { Clock } from "../defaults/system-clock.js";
import { canonicalJson } from "../facts/canonical-json.js";
import { sealFact, verifyFactChecksum } from "../facts/checksum.js";
import { hashMaterialSet } from "../facts/digests.js";
import { deriveSourceGroups } from "../ingest/source-groups.js";
import { invalidInput, reviewConflict, storageCorrupt } from "../internal-errors.js";
import {
  applyCorrectionReplacement,
  finalizeClaims,
  type ResolvedCorrectionReplacement,
} from "../profile/apply-patch.js";
import {
  buildMaterialEvidenceIndex,
  strengthenCorrectionClaims,
  summarizeQuality,
} from "../profile/quality.js";
import { PROFILE_RENDERER_VERSION, renderProfile, renderPrompt } from "../profile/render.js";
import { evaluateCorrectionReviewReasons } from "../profile/review-gate.js";
import { deriveVersionId } from "../profile/version-id.js";
import type { EventBus } from "../ports/event-bus.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type {
  BlobPutResult,
  ContentAddressedBlobStore,
} from "../storage/content-addressed-blob-store.js";
import {
  computeMutationInputChecksum,
  insertCompletedOperationInTransaction,
  insertEventInTransaction,
  replayCompletedMutation,
} from "../storage/mutation-ledger.js";
import {
  canonicalMaterialIdentityJson,
  materialManifestFromSqlite,
  readSqliteMaterialsInTransaction,
  type SqliteMaterialDescriptor,
} from "../storage/sqlite-material-reader.js";
import type { SqliteEngineStore } from "../storage/sqlite-engine-store.js";
import { readSqliteReviewAuthorityInTransaction } from "../review/sqlite-authority.js";
import {
  insertSqliteVersionInTransaction,
  readSqliteVersionInTransaction,
  type SqliteStoredVersion,
} from "../version/sqlite-authority.js";
import { summarizeVersion } from "../version/summary.js";
import {
  digestAcceptedCorrection,
  deriveCorrectionSourceIdentity,
  normalizeCorrectionDraft,
  prepareCorrectionMaterial,
  correctionProvenanceForActor,
  type AcceptedCorrection,
  type PreparedCorrectionMaterial,
} from "./normalize.js";

/** Fault-injection seams for the SQLite correction transaction and crash tests. */
export interface CorrectionServiceHooks {
  /** Runs after correction bytes are ready under the shared mutation lease. */
  readonly afterBlobPut?: (contentDigest: ContentDigest) => void | Promise<void>;
  /** Runs after blob publication and before opening the SQLite write transaction. */
  readonly beforeCorrectionTransaction?: (
    requestId: MutationContext["requestId"],
  ) => void | Promise<void>;
  /** Runs synchronously after every SQL write and immediately before COMMIT. */
  readonly beforeTransactionCommit?: (requestId: MutationContext["requestId"]) => void;
  /** Runs after COMMIT and blob-lease release, before event publication. */
  readonly afterTransactionCommit?: (
    requestId: MutationContext["requestId"],
  ) => void | Promise<void>;
}

/** Concrete dependencies for the package-private SQLite correction mutation. */
export interface CorrectionServiceDependencies {
  readonly store: SqliteEngineStore;
  readonly blobs: ContentAddressedBlobStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly eventBus: EventBus;
  readonly hooks?: CorrectionServiceHooks;
}

interface CorrectionTransactionOutcome {
  readonly result: CommitResult;
  readonly events: readonly EngineEvent[];
  readonly committed: boolean;
}

interface BlobAuthoritySnapshot {
  readonly existed: boolean;
  readonly byteLength?: number;
}

const parseBoundary = <T>(parse: () => T, fieldPath: string): T => {
  try {
    return parse();
  } catch (error) {
    if (error instanceof DistillyError) throw error;
    throw invalidInput("The profiles.correct boundary input is invalid.", fieldPath);
  }
};

const integer = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw storageCorrupt(`SQLite ${label} is invalid.`);
  }
  return value;
};

const nonEmptyReasons = (
  reasons: readonly ReviewReason[],
): readonly [ReviewReason, ...ReviewReason[]] | undefined => {
  const [first, ...rest] = reasons;
  return first === undefined ? undefined : [first, ...rest];
};

const makeProfile = (stored: {
  readonly version: Pick<VersionRecord, "id" | "subjectId" | "subjectDisplayName" | "quality">;
  readonly claims: VersionClaimsSnapshot;
}): Profile => {
  const rendering = renderProfile({
    subjectId: stored.version.subjectId,
    displayName: stored.version.subjectDisplayName,
    versionId: stored.version.id,
    claims: stored.claims.claims,
    quality: stored.version.quality,
  });
  return {
    subjectId: stored.version.subjectId,
    displayName: stored.version.subjectDisplayName,
    versionId: stored.version.id,
    claims: stored.claims.claims,
    core: rendering.core,
    domains: rendering.domains,
    rendered: rendering.markdown,
    quality: stored.version.quality,
  };
};

const verifyCorrectionEvents = (
  database: DatabaseSync,
  stored: SqliteStoredVersion,
  actor: ActorContext,
  requestId: MutationContext["requestId"],
): void => {
  const rows = database
    .prepare(
      `SELECT event_id, request_id, subject_id, actor_json, event_json, occurred_at
       FROM events WHERE request_id = ? ORDER BY sequence`,
    )
    .all(requestId) as readonly Readonly<Record<string, unknown>>[];
  const records = rows.map((row): EventRecord => {
    if (typeof row.event_json !== "string") {
      throw storageCorrupt("SQLite correction replay event JSON is invalid.");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(row.event_json);
    } catch (error) {
      throw storageCorrupt("SQLite correction replay event is not valid JSON.", error);
    }
    let record: EventRecord;
    try {
      record = eventRecordSchema.parse(raw) as EventRecord;
      verifyFactChecksum(record);
    } catch (error) {
      throw storageCorrupt("SQLite correction replay event is invalid.", error);
    }
    if (canonicalJson(record) !== row.event_json) {
      throw storageCorrupt("SQLite correction replay event is not canonically encoded.");
    }
    if (
      row.event_id !== record.eventId ||
      row.request_id !== record.requestId ||
      row.subject_id !== record.event.subjectId ||
      row.actor_json !== canonicalJson(record.actor) ||
      row.occurred_at !== record.event.at
    ) {
      throw storageCorrupt("SQLite correction replay event columns disagree with their record.");
    }
    return record;
  });
  const expected: {
    readonly event: EngineEvent;
    readonly relatedVersionId?: VersionRecord["id"];
  }[] = [
    {
      event: {
        kind: "material.ingested",
        subjectId: stored.version.subjectId,
        at: stored.version.createdAt,
      },
    },
  ];
  if (stored.version.derivedFromCandidateVersionId !== undefined) {
    expected.push({
      event: {
        kind: "version.rejected",
        subjectId: stored.version.subjectId,
        versionId: stored.version.derivedFromCandidateVersionId,
        at: stored.version.createdAt,
      },
      relatedVersionId: stored.version.id,
    });
  }
  expected.push(
    {
      event: {
        kind:
          stored.version.createdDisposition === "current" ? "version.current" : "version.suspended",
        subjectId: stored.version.subjectId,
        versionId: stored.version.id,
        at: stored.version.createdAt,
      },
    },
    {
      event: {
        kind: "job.changed",
        subjectId: stored.version.subjectId,
        at: stored.version.createdAt,
      },
    },
  );
  if (
    records.length !== expected.length ||
    records.some((record, index) => {
      const wanted = expected[index];
      return (
        wanted === undefined ||
        record.requestId !== requestId ||
        canonicalJson(record.actor) !== canonicalJson(actor) ||
        canonicalJson(record.event) !== canonicalJson(wanted.event) ||
        record.reason !== undefined ||
        record.relatedVersionId !== wanted.relatedVersionId
      );
    })
  ) {
    throw storageCorrupt("SQLite correction replay events disagree with fixed event authority.");
  }
};

const verifyCorrectionReplay = (
  database: DatabaseSync,
  result: CommitResult,
  correction: AcceptedCorrection,
  actor: ActorContext,
  requestId: MutationContext["requestId"],
): CommitResult => {
  const summary = result.kind === "current" ? result.version : result.candidate;
  const stored = readSqliteVersionInTransaction(database, summary.subjectId, summary.id);
  if (
    stored === undefined ||
    stored.version.creation.kind !== "correction" ||
    stored.version.createdDisposition !== result.kind
  ) {
    throw storageCorrupt("SQLite correction replay is missing its immutable version authority.");
  }
  if (canonicalJson(summarizeVersion(stored.version, result.kind)) !== canonicalJson(summary)) {
    throw storageCorrupt("SQLite correction replay disagrees with its immutable version summary.");
  }
  if (stored.acceptedPatchDigest !== digestAcceptedCorrection(correction)) {
    throw storageCorrupt("SQLite correction replay accepted digest is inconsistent.");
  }
  const correctionMaterialId = stored.version.creation.correctionMaterialId;
  if (!stored.manifest.items.some((entry) => entry.materialId === correctionMaterialId)) {
    throw storageCorrupt("SQLite correction replay version omits its correction material.");
  }
  const correctionMaterial = readSqliteMaterialsInTransaction(
    database,
    stored.version.subjectId,
  ).find(({ record }) => record.id === correctionMaterialId)?.record;
  const expectedMaterial = prepareCorrectionMaterial(
    correction,
    stored.version.subjectId,
    requestId,
    actor,
    stored.version.createdAt,
  ).record;
  if (
    correctionMaterial === undefined ||
    correctionMaterial.kind !== "correction" ||
    correctionMaterial.sourceIdentity !== deriveCorrectionSourceIdentity(requestId) ||
    canonicalJson(correctionMaterial.correctionProvenance) !==
      canonicalJson(correctionProvenanceForActor(actor)) ||
    canonicalJson(correctionMaterial) !== canonicalJson(expectedMaterial)
  ) {
    throw storageCorrupt("SQLite correction replay material authority is inconsistent.");
  }
  verifyCorrectionEvents(database, stored, actor, requestId);
  if (result.kind === "current") {
    if (canonicalJson(makeProfile(stored)) !== canonicalJson(result.profile)) {
      throw storageCorrupt("SQLite correction replay profile disagrees with version authority.");
    }
  } else if (
    canonicalJson(stored.version.reviewReasons) !== canonicalJson(result.reasons) ||
    stored.version.parentId !== result.currentVersionId ||
    result.review.subjectId !== stored.version.subjectId ||
    result.review.candidateVersionId !== stored.version.id
  ) {
    throw storageCorrupt("SQLite suspended correction replay disagrees with review authority.");
  }
  return result;
};

const readBlobAuthoritySnapshot = (
  database: DatabaseSync,
  digest: ContentDigest,
): BlobAuthoritySnapshot => {
  const row = database
    .prepare(
      `SELECT blobs.byte_length,
              EXISTS(SELECT 1 FROM materials WHERE blob_digest = ?) AS material_present
       FROM blobs
       WHERE blobs.digest = ?`,
    )
    .get(digest, digest) as Readonly<Record<string, unknown>> | undefined;
  if (row === undefined) {
    const dependent = database
      .prepare("SELECT 1 FROM materials WHERE blob_digest = ? LIMIT 1")
      .get(digest);
    if (dependent !== undefined) {
      throw storageCorrupt("A correction material references a missing blob authority row.");
    }
    return { existed: false };
  }
  const materialPresent = integer(row.material_present, "blob material-reference marker");
  if (materialPresent !== 0 && materialPresent !== 1) {
    throw storageCorrupt("SQLite blob material-reference marker is invalid.");
  }
  return { existed: true, byteLength: integer(row.byte_length, "blob byte length") };
};

const ensureBlobAuthorityInTransaction = (
  database: DatabaseSync,
  prepared: PreparedCorrectionMaterial,
  published: BlobPutResult,
  before: BlobAuthoritySnapshot,
): void => {
  let row = database
    .prepare("SELECT byte_length FROM blobs WHERE digest = ?")
    .get(prepared.record.contentDigest) as Readonly<Record<string, unknown>> | undefined;
  if (row === undefined) {
    const dependent = database
      .prepare("SELECT 1 FROM materials WHERE blob_digest = ? LIMIT 1")
      .get(prepared.record.contentDigest);
    if (before.existed || dependent !== undefined) {
      throw storageCorrupt("A referenced correction blob authority row disappeared before commit.");
    }
    database
      .prepare("INSERT INTO blobs(digest, byte_length) VALUES (?, ?)")
      .run(prepared.record.contentDigest, published.byteLength);
    row = database
      .prepare("SELECT byte_length FROM blobs WHERE digest = ?")
      .get(prepared.record.contentDigest);
  }
  if (
    row === undefined ||
    integer(row.byte_length, "correction blob byte length") !== published.byteLength
  ) {
    throw storageCorrupt("A correction blob authority row conflicts with immutable bytes.");
  }
};

const selectedContentBaseline = (
  input: AcceptedCorrection,
  current: SqliteStoredVersion | undefined,
  suspended: SqliteStoredVersion | undefined,
): SqliteStoredVersion | undefined => {
  if (suspended !== undefined) {
    if (input.baseCandidateVersionId !== suspended.version.id) {
      throw reviewConflict(
        "A correction must explicitly target the active suspended candidate version.",
      );
    }
    return suspended;
  }
  if (input.baseCandidateVersionId !== undefined) {
    throw reviewConflict("The requested correction candidate is not the active review target.");
  }
  return current;
};

const assertCurrentMaterialAuthority = (
  generation: number,
  materialSetHash: ReturnType<typeof hashMaterialSet> | undefined,
  materials: readonly SqliteMaterialDescriptor[],
): void => {
  const manifest = materialManifestFromSqlite(materials);
  if (
    (generation === 0 && (manifest.length !== 0 || materialSetHash !== undefined)) ||
    (generation > 0 &&
      (manifest.length === 0 ||
        materialSetHash === undefined ||
        hashMaterialSet(manifest) !== materialSetHash))
  ) {
    throw storageCorrupt("SQLite correction subject state disagrees with material membership.");
  }
};

const assertPendingAuthority = (
  pending: ReturnType<typeof readSqliteReviewAuthorityInTransaction>["pending"],
  current: SqliteStoredVersion | undefined,
  materialCount: number,
): void => {
  if (pending === undefined) return;
  const baselineCount = current?.manifest.items.length ?? 0;
  if (
    pending.totalMaterialCount !== materialCount ||
    pending.addedMaterialCount !== materialCount - baselineCount
  ) {
    throw storageCorrupt("SQLite correction pending job disagrees with its current baseline.");
  }
};

const insertCorrectionMaterialInTransaction = (
  database: DatabaseSync,
  prepared: PreparedCorrectionMaterial,
): void => {
  database
    .prepare(
      `INSERT INTO materials(
         subject_id, material_id, kind, content_digest, provenance_digest,
         source_identity, identity_json, record_json, blob_digest, stored_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      prepared.record.subjectId,
      prepared.record.id,
      prepared.record.kind,
      prepared.record.contentDigest,
      prepared.record.provenanceDigest,
      Buffer.from(prepared.record.sourceIdentity, "utf8"),
      canonicalMaterialIdentityJson(prepared.record),
      canonicalJson(prepared.record),
      prepared.record.contentDigest,
      prepared.record.storedAt,
    );
};

const addCorrectionMaterial = (
  existing: readonly SqliteMaterialDescriptor[],
  prepared: PreparedCorrectionMaterial,
  published: BlobPutResult,
): { readonly materials: readonly SqliteMaterialDescriptor[]; readonly inserted: boolean } => {
  const stored = existing.find(({ record }) => record.id === prepared.record.id);
  if (stored !== undefined) {
    if (
      stored.blobDigest !== prepared.record.contentDigest ||
      stored.blobByteLength !== published.byteLength ||
      canonicalMaterialIdentityJson(stored.record) !==
        canonicalMaterialIdentityJson(prepared.record)
    ) {
      throw storageCorrupt("A correction MaterialId resolves to conflicting stored semantics.");
    }
    return { materials: existing, inserted: false };
  }
  return {
    materials: [
      ...existing,
      {
        record: prepared.record,
        blobDigest: published.digest,
        blobByteLength: published.byteLength,
      },
    ].sort((left, right) =>
      left.record.id < right.record.id ? -1 : left.record.id > right.record.id ? 1 : 0,
    ),
    inserted: true,
  };
};

const updateVersionStatusesInTransaction = (
  database: DatabaseSync,
  current: SqliteStoredVersion | undefined,
  replacedCandidate: SqliteStoredVersion | undefined,
  disposition: "current" | "suspended",
): void => {
  if (replacedCandidate !== undefined) {
    const rejected = database
      .prepare(
        "UPDATE version_statuses SET status = 'rejected' WHERE version_id = ? AND subject_id = ? AND status = 'suspended'",
      )
      .run(replacedCandidate.version.id, replacedCandidate.version.subjectId);
    if (rejected.changes !== 1) {
      throw storageCorrupt("SQLite correction candidate status changed before replacement.");
    }
  }
  if (disposition === "current" && current !== undefined) {
    const historical = database
      .prepare(
        "UPDATE version_statuses SET status = 'historical' WHERE version_id = ? AND subject_id = ? AND status = 'current'",
      )
      .run(current.version.id, current.version.subjectId);
    if (historical.changes !== 1) {
      throw storageCorrupt("SQLite correction current status changed before replacement.");
    }
  }
};

/** SQLite/WAL coordinator for one deterministic user or relayed correction. */
export class CorrectionService {
  readonly #dependencies: CorrectionServiceDependencies;

  /**
   * Creates the SQLite correction coordinator.
   * @param dependencies - SQLite, blob, id, clock, event, and optional test-hook dependencies.
   */
  constructor(dependencies: CorrectionServiceDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Applies one correction as a single versioned SQLite mutation.
   * @param rawInput - Untrusted method input parsed at the service boundary.
   * @param rawActor - Trusted runtime actor parsed at the service boundary.
   * @param rawMutation - Request identity for replay and conflict detection.
   * @returns Stable current or suspended correction result.
   */
  async correct(
    rawInput: CorrectInput,
    rawActor: ActorContext,
    rawMutation: MutationContext,
  ): Promise<CommitResult> {
    const input = parseBoundary(
      () => engineMethodSchemas["profiles.correct"].params.parse(rawInput),
      "params",
    );
    const actor = parseBoundary(() => actorContextSchema.parse(rawActor) as ActorContext, "actor");
    const mutation = parseBoundary(
      () => mutationContextSchema.parse(rawMutation) as MutationContext,
      "requestId",
    );
    const correction = normalizeCorrectionDraft(input.correction);
    const normalizedInput = { subjectId: input.subjectId, correction } satisfies CorrectInput;
    const inputChecksum = computeMutationInputChecksum("profiles.correct", normalizedInput, actor);
    const earlyReplay = this.#dependencies.store.read((database) => {
      const replay = replayCompletedMutation(database, {
        requestId: mutation.requestId,
        method: "profiles.correct",
        inputChecksum,
        actor,
      });
      return replay === undefined
        ? undefined
        : verifyCorrectionReplay(database, replay, correction, actor, mutation.requestId);
    });
    if (earlyReplay !== undefined) return earlyReplay;

    const now = this.#dependencies.clock.now();
    const prepared = prepareCorrectionMaterial(
      correction,
      input.subjectId,
      mutation.requestId,
      actor,
      now,
    );
    const blobAccess = await this.#dependencies.blobs.acquireMutationAccess();
    let outcome: CorrectionTransactionOutcome;
    try {
      const blobBefore = this.#dependencies.store.read((database) =>
        readBlobAuthoritySnapshot(database, prepared.record.contentDigest),
      );
      let published: BlobPutResult;
      if (blobBefore.existed) {
        const verified = await blobAccess.verify(prepared.record.contentDigest, prepared.content);
        if (verified === undefined || verified.byteLength !== blobBefore.byteLength) {
          throw storageCorrupt("A referenced correction content blob is missing or inconsistent.");
        }
        published = verified;
      } else {
        published = await blobAccess.put(prepared.record.contentDigest, prepared.content);
        await this.#dependencies.hooks?.afterBlobPut?.(prepared.record.contentDigest);
      }
      await this.#dependencies.hooks?.beforeCorrectionTransaction?.(mutation.requestId);
      outcome = this.#dependencies.store.write((database) =>
        this.#commit(
          database,
          input.subjectId,
          correction,
          prepared,
          published,
          blobBefore,
          actor,
          mutation,
          inputChecksum,
          now,
        ),
      );
    } finally {
      await blobAccess.release();
    }
    if (outcome.committed) {
      await this.#dependencies.hooks?.afterTransactionCommit?.(mutation.requestId);
      for (const event of outcome.events) await this.#dependencies.eventBus.publish(event);
    }
    return outcome.result;
  }

  #commit(
    database: DatabaseSync,
    subjectId: SubjectId,
    correction: AcceptedCorrection,
    prepared: PreparedCorrectionMaterial,
    published: BlobPutResult,
    blobBefore: BlobAuthoritySnapshot,
    actor: ActorContext,
    mutation: MutationContext,
    inputChecksum: ReturnType<typeof computeMutationInputChecksum>,
    now: IsoDateTime,
  ): CorrectionTransactionOutcome {
    const replay = replayCompletedMutation(database, {
      requestId: mutation.requestId,
      method: "profiles.correct",
      inputChecksum,
      actor,
    });
    if (replay !== undefined) {
      return {
        result: verifyCorrectionReplay(database, replay, correction, actor, mutation.requestId),
        events: [],
        committed: false,
      };
    }

    const authority = readSqliteReviewAuthorityInTransaction(database, subjectId);
    const currentMaterials = readSqliteMaterialsInTransaction(database, subjectId);
    assertCurrentMaterialAuthority(
      authority.generation,
      authority.materialSetHash,
      currentMaterials,
    );
    assertPendingAuthority(authority.pending, authority.current, currentMaterials.length);
    const contentBaseline = selectedContentBaseline(
      correction,
      authority.current,
      authority.suspended,
    );
    ensureBlobAuthorityInTransaction(database, prepared, published, blobBefore);
    const target = addCorrectionMaterial(currentMaterials, prepared, published);
    if (target.inserted) insertCorrectionMaterialInTransaction(database, prepared);

    const currentManifestItems = materialManifestFromSqlite(target.materials);
    const materialSetHash = hashMaterialSet(currentManifestItems);
    // A correction consumes its content baseline and its own material, not research that
    // has only been ingested. Version membership also defines the next briefing's delta.
    const versionMaterialIds = new Set(
      contentBaseline?.manifest.items.map((entry) => entry.materialId),
    );
    versionMaterialIds.add(prepared.record.id);
    const versionMaterials = target.materials.filter(({ record }) =>
      versionMaterialIds.has(record.id),
    );
    if (versionMaterials.length !== versionMaterialIds.size) {
      throw storageCorrupt("SQLite correction baseline is not contained in current materials.");
    }
    const manifestItems = materialManifestFromSqlite(versionMaterials);
    const generation = authority.generation + 1;
    if (!Number.isSafeInteger(generation)) {
      throw storageCorrupt("SQLite correction generation exceeds the safe integer range.");
    }
    const grouping = deriveSourceGroups(
      versionMaterials.map(({ record }) => record),
      "source-groups-v1",
    );
    const evidenceIndex = buildMaterialEvidenceIndex(
      versionMaterials.map(({ record }) => record),
      grouping,
    );
    const replacement: ResolvedCorrectionReplacement = {
      facet: correction.facet,
      text: correction.text,
      evidence: [
        {
          materialId: prepared.record.id,
          quote: correction.text,
          locator: { start: 0, end: Array.from(correction.text).length },
        },
      ],
      observedIn: [],
      supersedes: correction.supersedes,
    };
    const provisional = applyCorrectionReplacement(
      subjectId,
      contentBaseline?.claims.claims ?? [],
      replacement,
    );
    const strengthened = strengthenCorrectionClaims(provisional, evidenceIndex);
    const quality = summarizeQuality(strengthened, evidenceIndex);
    const reasons = nonEmptyReasons(
      evaluateCorrectionReviewReasons({
        ...(authority.current === undefined
          ? {}
          : {
              before: {
                claims: authority.current.claims.claims,
                quality: authority.current.version.quality,
              },
            }),
        after: { claims: strengthened, quality },
        materials: evidenceIndex,
        supersedes: correction.supersedes,
        ...(actor.kind === "user" ? {} : { relayedActorKind: actor.kind }),
      }),
    );
    const disposition = reasons === undefined ? "current" : "suspended";
    const subjectRow = database
      .prepare("SELECT display_name FROM subjects WHERE id = ?")
      .get(subjectId) as Readonly<Record<string, unknown>> | undefined;
    if (typeof subjectRow?.display_name !== "string" || subjectRow.display_name.length === 0) {
      throw storageCorrupt("SQLite correction subject is missing its display name.");
    }
    const creation = {
      kind: "correction",
      correctionMaterialId: prepared.record.id,
    } as const;
    const identity = {
      subjectId,
      subjectDisplayName: subjectRow.display_name,
      generation,
      materialSetHash: hashMaterialSet(manifestItems),
      ...(authority.current === undefined ? {} : { parentId: authority.current.version.id }),
      ...(authority.suspended === undefined
        ? {}
        : { derivedFromCandidateVersionId: authority.suspended.version.id }),
      creation,
      actor,
      createdDisposition: disposition,
      rendererVersion: PROFILE_RENDERER_VERSION,
      ...(reasons === undefined ? {} : { reviewReasons: reasons }),
      quality,
    } as const;
    const versionId = deriveVersionId(identity, strengthened);
    const claims = finalizeClaims(strengthened, versionId);
    const claimSnapshot = sealFact<VersionClaimsSnapshot>({
      schemaVersion: 1,
      subjectId,
      versionId,
      claims,
    });
    const manifest = sealFact<VersionMaterialManifest>({
      schemaVersion: 1,
      items: manifestItems,
    });
    const version = sealFact<VersionRecord>({
      schemaVersion: 1,
      id: versionId,
      ...identity,
      materialCount: manifestItems.length,
      createdAt: now,
    });
    const profile = makeProfile({ version, claims: claimSnapshot });
    void renderPrompt(profile);

    updateVersionStatusesInTransaction(
      database,
      authority.current,
      authority.suspended,
      disposition,
    );
    insertSqliteVersionInTransaction(database, {
      version,
      manifest,
      claims: claimSnapshot,
      status: disposition,
      acceptedPatchDigest: digestAcceptedCorrection(correction),
    });
    const nextCurrentId = disposition === "current" ? version.id : authority.current?.version.id;
    const nextSuspendedId = disposition === "suspended" ? version.id : undefined;
    const stateUpdate = database
      .prepare(
        `UPDATE subject_states
         SET generation = ?, material_set_hash = ?,
             current_version_id = ?, suspended_version_id = ?
         WHERE subject_id = ? AND generation = ? AND material_set_hash IS ?
           AND current_version_id IS ? AND suspended_version_id IS ?`,
      )
      .run(
        generation,
        materialSetHash,
        nextCurrentId ?? null,
        nextSuspendedId ?? null,
        subjectId,
        authority.generation,
        authority.materialSetHash ?? null,
        authority.current?.version.id ?? null,
        authority.suspended?.version.id ?? null,
      );
    if (stateUpdate.changes !== 1) {
      throw storageCorrupt("SQLite correction state changed during its write transaction.");
    }

    database.prepare("DELETE FROM pending_jobs WHERE subject_id = ?").run(subjectId);
    const baselineCount =
      disposition === "current"
        ? manifestItems.length
        : (authority.current?.manifest.items.length ?? 0);
    const pending: PendingJob = {
      id: this.#dependencies.ids.jobId(),
      subjectId,
      generation,
      ...(nextCurrentId === undefined ? {} : { baseVersionId: nextCurrentId }),
      materialSetHash,
      addedMaterialCount: currentManifestItems.length - baselineCount,
      totalMaterialCount: currentManifestItems.length,
      state: "pending",
      queuedAt: now,
    };
    database
      .prepare(
        `INSERT INTO pending_jobs(
           subject_id, job_id, generation, base_version_id, material_set_hash,
           added_material_count, total_material_count, queued_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        subjectId,
        pending.id,
        pending.generation,
        pending.baseVersionId ?? null,
        pending.materialSetHash,
        pending.addedMaterialCount,
        pending.totalMaterialCount,
        pending.queuedAt,
      );

    const summary = summarizeVersion(version, disposition);
    const result: CommitResult =
      disposition === "current"
        ? { kind: "current", version: summary, profile }
        : {
            kind: "suspended",
            candidate: summary,
            ...(authority.current === undefined
              ? {}
              : { currentVersionId: authority.current.version.id }),
            reasons: reasons!,
            review: { subjectId, candidateVersionId: version.id },
          };
    insertCompletedOperationInTransaction(database, {
      requestId: mutation.requestId,
      method: "profiles.correct",
      subjectId,
      actor,
      inputChecksum,
      result,
      completedAt: now,
    });

    const eventRecords: {
      readonly event: EngineEvent;
      readonly relatedVersionId?: VersionRecord["id"];
    }[] = [{ event: { kind: "material.ingested", subjectId, at: now } }];
    if (authority.suspended !== undefined) {
      const event = {
        kind: "version.rejected",
        subjectId,
        versionId: authority.suspended.version.id,
        at: now,
      } as const;
      eventRecords.push({ event, relatedVersionId: version.id });
    }
    eventRecords.push(
      {
        event: {
          kind: disposition === "current" ? "version.current" : "version.suspended",
          subjectId,
          versionId: version.id,
          at: now,
        },
      },
      { event: { kind: "job.changed", subjectId, at: now } },
    );
    for (const record of eventRecords) {
      insertEventInTransaction(database, {
        eventId: this.#dependencies.ids.eventId(),
        event: record.event,
        actor,
        requestId: mutation.requestId,
        ...(record.relatedVersionId === undefined
          ? {}
          : { relatedVersionId: record.relatedVersionId }),
      });
    }
    this.#dependencies.hooks?.beforeTransactionCommit?.(mutation.requestId);
    return { result, events: eventRecords.map(({ event }) => event), committed: true };
  }
}
