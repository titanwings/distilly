import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DistillyError,
  briefMaterialRefSchema,
  facetPathSchema,
  hostNameSchema,
  requestIdSchema,
  type ActorContext,
  type ClientSessionContext,
  type CommitInput,
  type EventId,
  type IngestInput,
  type IsoDateTime,
  type JobId,
  type LeaseId,
  type LeaseOwnerId,
  type RequestId,
  type SpaceId,
  type SubjectId,
} from "@distilly/protocol";
import { afterEach, describe, expect, it } from "vitest";

import type { Clock } from "../defaults/system-clock.js";
import type { InternalEngineComposition } from "../ingest/composition.js";
import { createInternalEngineComposition } from "../ingest/composition.js";
import type { IdGenerator } from "../ports/id-generator.js";

const AT = "2026-08-31T15:00:00.000Z" as IsoDateTime;
const SDK_ACTOR: ActorContext = { kind: "sdk", id: "correction-seed" };
const USER_ACTOR: ActorContext = { kind: "user", id: "panel-user" };
const HOST_ACTOR: ActorContext = {
  kind: "host",
  id: "codex-session",
  host: hostNameSchema.parse("codex"),
};
const FIRST_REF = briefMaterialRefSchema.parse("m001");
const IDENTITY = facetPathSchema.parse("identity.name");
const VOICE = facetPathSchema.parse("voice.example");
const DECISION_STYLE = facetPathSchema.parse("psyche.decision_style");
const ASSUMPTION_A = facetPathSchema.parse("texture.assumption_a");
const ASSUMPTION_B = facetPathSchema.parse("texture.assumption_b");

class FakeClock implements Clock {
  current = AT;

  now(): IsoDateTime {
    return this.current;
  }
}

class SequenceIds implements IdGenerator {
  private subject = 1;
  private space = 1;
  private job = 1;
  private lease = 1;
  private owner = 1;
  private event = 1;

  subjectId(): SubjectId {
    return `subject_${(this.subject++).toString(16).padStart(32, "0")}` as SubjectId;
  }

  spaceId(): SpaceId {
    return `space_${(this.space++).toString(16).padStart(32, "0")}` as SpaceId;
  }

  jobId(): JobId {
    return `job_${(this.job++).toString(16).padStart(32, "0")}` as JobId;
  }

  leaseId(): LeaseId {
    return `lease_${(this.lease++).toString(16).padStart(32, "0")}` as LeaseId;
  }

  leaseOwnerId(): LeaseOwnerId {
    return `lease_owner_${(this.owner++).toString(16).padStart(32, "0")}` as LeaseOwnerId;
  }

  eventId(): EventId {
    return `event_${(this.event++).toString(16).padStart(32, "0")}` as EventId;
  }
}

const roots: string[] = [];
const compositions: InternalEngineComposition[] = [];

const request = (digit: number): RequestId =>
  requestIdSchema.parse(`req_${digit.toString(16).padStart(32, "0")}`);

const session = (owner = 1): ClientSessionContext => ({
  actor: SDK_ACTOR,
  leaseOwner: `lease_owner_${owner.toString(16).padStart(32, "0")}` as LeaseOwnerId,
  capacity: {
    maximumInputTokens: 4_194_304,
    maximumToolResultBytes: 4_194_304,
    source: "sdk_explicit",
  },
});

const firstInput = (): IngestInput => ({
  subject: {
    kind: "create",
    input: {
      displayName: "Mira Chen",
      aliases: ["Mira"],
      identityHints: [{ kind: "url", value: "https://example.test/mira" }],
    },
  },
  materials: [
    {
      clientRef: "mira-profile",
      kind: "web",
      content: "Mira designs reliable local-first systems and speaks precisely.",
      source: {
        uri: "https://example.test/mira",
        medium: "article",
        access: "public",
        role: "first_party_expression",
        capturedAt: AT,
      },
      derivation: { kind: "native_text" },
    },
  ],
  enqueue: "now",
});

const firstPatch = (): CommitInput["patch"] => ({
  operations: [
    {
      op: "add",
      claim: {
        facet: IDENTITY,
        text: "Mira designs reliable local-first systems.",
        evidence: [
          {
            kind: "brief_material",
            materialRef: FIRST_REF,
            quote: "Mira designs reliable local-first systems",
          },
        ],
      },
    },
    {
      op: "add",
      claim: {
        facet: VOICE,
        text: "Mira speaks precisely.",
        evidence: [
          {
            kind: "brief_material",
            materialRef: FIRST_REF,
            quote: "speaks precisely",
          },
        ],
      },
    },
  ],
});

const commitInput = (
  briefing: Awaited<ReturnType<InternalEngineComposition["leases"]["brief"]>>,
): CommitInput => ({
  jobId: briefing.job.id,
  generation: briefing.job.generation,
  leaseId: briefing.lease.id,
  briefContractDigest: briefing.contract.digest,
  materialSetHash: briefing.job.materialSetHash,
  ...(briefing.job.baseVersionId === undefined
    ? {}
    : { baseVersionId: briefing.job.baseVersionId }),
  patch: firstPatch(),
});

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "distilly-sqlite-correction-"));
  roots.push(root);
  return root;
};

const open = async (
  root: string,
  overrides: Omit<Parameters<typeof createInternalEngineComposition>[0], "root"> = {},
): Promise<InternalEngineComposition> => {
  const composition = await createInternalEngineComposition({
    root,
    ids: new SequenceIds(),
    clock: new FakeClock(),
    ...overrides,
  });
  compositions.push(composition);
  return composition;
};

const seedCurrent = async (composition: InternalEngineComposition) => {
  const ingested = await composition.ingest.ingest(firstInput(), SDK_ACTOR, {
    requestId: request(1),
  });
  const briefing = await composition.leases.brief({ jobId: ingested.job!.id }, session(), {
    requestId: request(2),
  });
  const committed = await composition.commits.commit(commitInput(briefing), session(), {
    requestId: request(3),
  });
  if (committed.kind !== "current") throw new Error("Expected a current seed version.");
  return { ingested, committed };
};

const count = (root: string, table: string): number => {
  const database = new DatabaseSync(join(root, "store.sqlite3"), { readOnly: true });
  try {
    return Number(
      (database.prepare(`SELECT count(*) AS value FROM ${table}`).get() as { value: number }).value,
    );
  } finally {
    database.close();
  }
};

const row = (
  root: string,
  sql: string,
  ...values: readonly (string | number)[]
): Readonly<Record<string, unknown>> | undefined => {
  const database = new DatabaseSync(join(root, "store.sqlite3"), { readOnly: true });
  try {
    return database.prepare(sql).get(...values);
  } finally {
    database.close();
  }
};

const eventRecords = (root: string, requestId: RequestId) => {
  const database = new DatabaseSync(join(root, "store.sqlite3"), { readOnly: true });
  try {
    return database
      .prepare("SELECT event_json FROM events WHERE request_id = ? ORDER BY sequence")
      .all(requestId)
      .map((item) => JSON.parse(String(item.event_json)) as Readonly<Record<string, unknown>>);
  } finally {
    database.close();
  }
};

const expectCode = async (promise: Promise<unknown>, code: string): Promise<DistillyError> => {
  try {
    await promise;
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toBeInstanceOf(DistillyError);
    expect(error).toMatchObject({ code });
    return error as DistillyError;
  }
};

afterEach(async () => {
  for (const composition of compositions.splice(0)) composition.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SQLite CorrectionService", () => {
  it("atomically creates and replays a direct current correction with a zero-delta brief", async () => {
    const root = await temporaryRoot();
    const composition = await open(root);
    const { ingested, committed } = await seedCurrent(composition);
    const correctionRequest = request(4);
    const input = {
      subjectId: ingested.subject.id,
      correction: {
        text: "Mira makes decisions with explicit evidence. 🧭",
        facet: DECISION_STYLE,
      },
    };
    const result = await composition.corrections.correct(input, USER_ACTOR, {
      requestId: correctionRequest,
    });
    if (result.kind !== "current") throw new Error("Expected a direct current correction.");
    expect(result).toMatchObject({
      version: {
        parentId: committed.version.id,
        generation: 2,
        status: "current",
        creation: { kind: "correction" },
      },
      profile: { displayName: "Mira Chen" },
    });
    const replacement = result.profile.claims.find(
      ({ facet }) => facet === "psyche.decision_style",
    );
    expect(replacement).toMatchObject({
      text: input.correction.text,
      status: "active",
      strength: "user_asserted",
      observedIn: [],
      evidence: [
        {
          quote: input.correction.text,
          locator: { start: 0, end: Array.from(input.correction.text).length },
        },
      ],
    });
    expect(row(root, "SELECT * FROM pending_jobs")).toMatchObject({
      generation: 2,
      base_version_id: result.version.id,
      added_material_count: 0,
      total_material_count: 2,
    });
    expect(count(root, "job_leases")).toBe(0);
    expect(
      JSON.parse(
        String(
          row(root, "SELECT record_json AS value FROM materials WHERE kind = 'correction'")?.value,
        ),
      ),
    ).toMatchObject({
      kind: "correction",
      sourceIdentity: `correction-request-v1\0${correctionRequest}`,
      sensitivity: "private",
      correctionProvenance: { kind: "direct_user" },
    });
    const beforeReplay = {
      jobs: count(root, "pending_jobs"),
      materials: count(root, "materials"),
      versions: count(root, "versions"),
      operations: count(root, "operations"),
      events: count(root, "events"),
    };
    await expect(
      composition.corrections.correct(input, USER_ACTOR, { requestId: correctionRequest }),
    ).resolves.toEqual(result);
    expect({
      jobs: count(root, "pending_jobs"),
      materials: count(root, "materials"),
      versions: count(root, "versions"),
      operations: count(root, "operations"),
      events: count(root, "events"),
    }).toEqual(beforeReplay);
    expect(
      eventRecords(root, correctionRequest).map(
        (record) => (record.event as Readonly<Record<string, unknown>>).kind,
      ),
    ).toEqual(["material.ingested", "version.current", "job.changed"]);

    const briefing = await composition.leases.brief(
      { jobId: String(row(root, "SELECT job_id AS value FROM pending_jobs")?.value) as JobId },
      session(2),
      { requestId: request(5) },
    );
    expect(briefing).toMatchObject({
      job: { addedMaterialCount: 0, baseVersionId: result.version.id },
      baseline: { versionId: result.version.id },
      materials: [],
    });
  });

  it.each([
    [false, "direct"],
    [true, "direct"],
    [false, "promote"],
    [true, "promote"],
    [true, "replace-candidate"],
  ] as const)(
    "preserves unprocessed material through correction (current=%s, route=%s), replay and reopen",
    async (hasCurrent, route) => {
      const root = await temporaryRoot();
      const ids = new SequenceIds();
      const clock = new FakeClock();
      const composition = await open(root, { ids, clock });
      const subject = hasCurrent
        ? (await seedCurrent(composition)).ingested.subject
        : await composition.subjects.create({ displayName: "Mira Chen" }, SDK_ACTOR, {
            requestId: request(1),
          });
      const pendingText = "Mira records tradeoffs before choosing a design.";
      const ingested = await composition.ingest.ingest(
        {
          subject: { kind: "existing", subjectId: subject.id },
          materials: [
            {
              ...firstInput().materials[0]!,
              clientRef: "unprocessed",
              content: pendingText,
              source: {
                ...firstInput().materials[0]!.source,
                uri: "https://example.test/mira/unprocessed",
              },
            },
          ],
          enqueue: "now",
        },
        SDK_ACTOR,
        { requestId: request(10) },
      );
      const obsoleteBrief = await composition.leases.brief({ jobId: ingested.job!.id }, session(), {
        requestId: request(11),
      });
      const input = {
        subjectId: subject.id,
        correction: { text: "Mira marks assumptions explicitly.", facet: ASSUMPTION_A },
      };
      const actor = route === "direct" ? USER_ACTOR : HOST_ACTOR;
      const corrected = await composition.corrections.correct(input, actor, {
        requestId: request(12),
      });
      if (route !== "direct") {
        if (corrected.kind !== "suspended") throw new Error("Expected a relayed candidate.");
        if (route === "promote") {
          await composition.review.promote(
            { subjectId: subject.id, candidateVersionId: corrected.candidate.id },
            USER_ACTOR,
            { requestId: request(13) },
          );
        } else {
          await composition.corrections.correct(
            {
              subjectId: subject.id,
              correction: {
                text: "Mira asks reviewers to challenge assumptions.",
                facet: ASSUMPTION_B,
                baseCandidateVersionId: corrected.candidate.id,
              },
            },
            USER_ACTOR,
            { requestId: request(13) },
          );
        }
      }
      expect(row(root, "SELECT added_material_count FROM pending_jobs")).toEqual({
        added_material_count: 1,
      });
      expect(count(root, "job_leases")).toBe(0);
      await expectCode(
        composition.commits.commit(commitInput(obsoleteBrief), session(), {
          requestId: request(14),
        }),
        "stale_job",
      );
      composition.close();
      const reopened = await open(root, { ids, clock });
      const pendingBeforeReplay = row(root, "SELECT * FROM pending_jobs");
      await expect(
        reopened.corrections.correct(input, actor, { requestId: request(12) }),
      ).resolves.toEqual(corrected);
      expect(row(root, "SELECT * FROM pending_jobs")).toEqual(pendingBeforeReplay);
      const briefing = await reopened.leases.brief(
        { jobId: pendingBeforeReplay!.job_id as JobId },
        session(2),
        { requestId: request(15) },
      );
      expect(briefing.materials).toHaveLength(1);
      expect(briefing.materials[0]).toMatchObject({ content: pendingText, ref: FIRST_REF });
      const committed = await reopened.commits.commit(
        {
          ...commitInput(briefing),
          patch: {
            operations: [
              {
                op: "add",
                claim: {
                  facet: DECISION_STYLE,
                  text: pendingText,
                  evidence: [
                    { kind: "brief_material", materialRef: FIRST_REF, quote: pendingText },
                  ],
                },
              },
            ],
          },
        },
        session(2),
        { requestId: request(16) },
      );
      if (committed.kind !== "current") throw new Error("Expected a resumed current profile.");
      expect(committed.profile.claims.map(({ text }) => text)).toEqual(
        expect.arrayContaining([pendingText, input.correction.text]),
      );
      expect(count(root, "pending_jobs")).toBe(0);
    },
  );

  it("keeps ordinary duplicate ingest from fabricating a zero-delta pending job", async () => {
    const root = await temporaryRoot();
    const composition = await open(root);
    const { ingested } = await seedCurrent(composition);
    const original = firstInput().materials[0]!;
    const duplicate = await composition.ingest.ingest(
      {
        subject: { kind: "existing", subjectId: ingested.subject.id },
        materials: [{ ...original, clientRef: "same-source-new-client-ref" }],
        enqueue: "now",
      },
      SDK_ACTOR,
      { requestId: request(4) },
    );
    expect(duplicate).toMatchObject({ kind: "unchanged", generation: 1 });
    expect(duplicate.job).toBeUndefined();
    expect(count(root, "pending_jobs")).toBe(0);
  });

  it("suspends relayed and conflicting corrections with exact provenance and reason order", async () => {
    const root = await temporaryRoot();
    const composition = await open(root);
    const { ingested, committed } = await seedCurrent(composition);
    const identityClaim = committed.profile.claims.find(({ facet }) => facet === IDENTITY)!;
    const correctionRequest = request(4);
    const result = await composition.corrections.correct(
      {
        subjectId: ingested.subject.id,
        correction: {
          text: "Mira's role is evidence reviewer.",
          facet: IDENTITY,
          supersedes: [identityClaim.id],
        },
      },
      HOST_ACTOR,
      { requestId: correctionRequest },
    );
    if (result.kind !== "suspended") throw new Error("Expected a suspended correction.");
    expect(result.reasons).toEqual([
      { code: "identity_changed", claimIds: [identityClaim.id] },
      { code: "correction_conflict", claimIds: [identityClaim.id] },
      { code: "relayed_correction", actorKind: "host" },
    ]);
    const claims = new DatabaseSync(join(root, "store.sqlite3"), { readOnly: true });
    try {
      const storedClaims = claims
        .prepare(
          "SELECT claim_id, status, strength, superseded_by_claim_id FROM version_claims WHERE version_id = ? ORDER BY claim_id",
        )
        .all(result.candidate.id);
      expect(storedClaims.find((claim) => claim.claim_id === identityClaim.id)).toMatchObject({
        status: "superseded",
      });
      expect(storedClaims.find((claim) => claim.strength === "user_asserted")).toMatchObject({
        status: "active",
      });
    } finally {
      claims.close();
    }
    expect(
      JSON.parse(
        String(
          row(root, "SELECT record_json AS value FROM materials WHERE kind = 'correction'")?.value,
        ),
      ),
    ).toMatchObject({
      correctionProvenance: {
        kind: "relayed",
        actorKind: "host",
        actorId: HOST_ACTOR.id,
      },
    });
    expect(row(root, "SELECT * FROM pending_jobs")).toMatchObject({
      base_version_id: committed.version.id,
      added_material_count: 1,
      total_material_count: 2,
    });
  });

  it("requires exact candidate targeting and records candidate replacement lineage", async () => {
    const root = await temporaryRoot();
    const composition = await open(root);
    const { ingested, committed } = await seedCurrent(composition);
    const relayed = await composition.corrections.correct(
      {
        subjectId: ingested.subject.id,
        correction: { text: "Mira asks for explicit source boundaries." },
      },
      HOST_ACTOR,
      { requestId: request(4) },
    );
    if (relayed.kind !== "suspended") throw new Error("Expected relayed candidate.");
    const rowsBefore = {
      materials: count(root, "materials"),
      versions: count(root, "versions"),
      operations: count(root, "operations"),
    };
    await expectCode(
      composition.corrections.correct(
        {
          subjectId: ingested.subject.id,
          correction: { text: "Mira also states uncertainty explicitly." },
        },
        USER_ACTOR,
        { requestId: request(5) },
      ),
      "review_conflict",
    );
    expect({
      materials: count(root, "materials"),
      versions: count(root, "versions"),
      operations: count(root, "operations"),
    }).toEqual(rowsBefore);

    const replacementRequest = request(6);
    const replacement = await composition.corrections.correct(
      {
        subjectId: ingested.subject.id,
        correction: {
          text: "Mira also states uncertainty explicitly.",
          baseCandidateVersionId: relayed.candidate.id,
        },
      },
      USER_ACTOR,
      { requestId: replacementRequest },
    );
    if (replacement.kind !== "current") throw new Error("Expected clean candidate replacement.");
    expect(replacement.version).toMatchObject({
      parentId: committed.version.id,
      derivedFromCandidateVersionId: relayed.candidate.id,
      generation: 3,
    });
    expect(
      row(
        root,
        "SELECT status AS value FROM version_statuses WHERE version_id = ?",
        relayed.candidate.id,
      )?.value,
    ).toBe("rejected");
    const events = eventRecords(root, replacementRequest);
    expect(
      events.map((record) => (record.event as Readonly<Record<string, unknown>>).kind),
    ).toEqual(["material.ingested", "version.rejected", "version.current", "job.changed"]);
    expect(events[1]).toMatchObject({
      relatedVersionId: replacement.version.id,
      event: { versionId: relayed.candidate.id },
    });
    expect(events[1]).not.toHaveProperty("reason");
    await expect(
      composition.corrections.correct(
        {
          subjectId: ingested.subject.id,
          correction: {
            text: "Mira also states uncertainty explicitly.",
            baseCandidateVersionId: relayed.candidate.id,
          },
        },
        USER_ACTOR,
        { requestId: replacementRequest },
      ),
    ).resolves.toEqual(replacement);
  });

  it("binds RequestId replay to exact params and actor", async () => {
    const root = await temporaryRoot();
    const composition = await open(root);
    const { ingested } = await seedCurrent(composition);
    const correctionRequest = request(4);
    const input = {
      subjectId: ingested.subject.id,
      correction: { text: "Mira checks claims against sources." },
    };
    await composition.corrections.correct(input, USER_ACTOR, { requestId: correctionRequest });
    await expectCode(
      composition.corrections.correct(
        { ...input, correction: { text: "Different correction." } },
        USER_ACTOR,
        { requestId: correctionRequest },
      ),
      "idempotency_conflict",
    );
    await expectCode(
      composition.corrections.correct(
        input,
        { kind: "user", id: "another-user" },
        {
          requestId: correctionRequest,
        },
      ),
      "idempotency_conflict",
    );
    expect(count(root, "versions")).toBe(2);
  });

  it("rolls back every SQLite effect before COMMIT and succeeds from the orphan blob on retry", async () => {
    const root = await temporaryRoot();
    const ids = new SequenceIds();
    const clock = new FakeClock();
    const composition = await open(root, {
      ids,
      clock,
      correctionHooks: {
        beforeTransactionCommit: () => {
          throw new Error("fault before correction commit");
        },
      },
    });
    const { ingested } = await seedCurrent(composition);
    const input = {
      subjectId: ingested.subject.id,
      correction: { text: "Mira marks assumptions explicitly." },
    };
    await expect(
      composition.corrections.correct(input, USER_ACTOR, { requestId: request(4) }),
    ).rejects.toThrow("fault before correction commit");
    expect(count(root, "materials")).toBe(1);
    expect(count(root, "versions")).toBe(1);
    expect(count(root, "pending_jobs")).toBe(0);
    expect(count(root, "operations")).toBe(3);
    expect(row(root, "SELECT generation AS value FROM subject_states")?.value).toBe(1);
    composition.close();

    const reopened = await open(root, { ids, clock });
    await expect(
      reopened.corrections.correct(input, USER_ACTOR, { requestId: request(4) }),
    ).resolves.toMatchObject({ kind: "current" });
    expect(count(root, "materials")).toBe(2);
    expect(count(root, "versions")).toBe(2);
    expect(count(root, "pending_jobs")).toBe(1);
  });

  it("serializes independent corrections against the transaction-time current baseline", async () => {
    const root = await temporaryRoot();
    const composition = await open(root);
    const { ingested } = await seedCurrent(composition);
    const results = await Promise.all([
      composition.corrections.correct(
        {
          subjectId: ingested.subject.id,
          correction: { text: "Mira records assumption A.", facet: ASSUMPTION_A },
        },
        USER_ACTOR,
        { requestId: request(4) },
      ),
      composition.corrections.correct(
        {
          subjectId: ingested.subject.id,
          correction: { text: "Mira records assumption B.", facet: ASSUMPTION_B },
        },
        USER_ACTOR,
        { requestId: request(5) },
      ),
    ]);
    expect(
      results.map((result) => (result.kind === "current" ? result.version.generation : -1)).sort(),
    ).toEqual([2, 3]);
    expect(count(root, "versions")).toBe(3);
    expect(row(root, "SELECT generation AS value FROM subject_states")?.value).toBe(3);
    expect(row(root, "SELECT added_material_count AS value FROM pending_jobs")?.value).toBe(0);
  });
});
