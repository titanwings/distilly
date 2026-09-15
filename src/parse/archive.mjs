/**
 * archive.mjs — a zip or directory of exports → the ledger, member by member.
 *
 * An archive is never "one document". An X archive holds tweets plus DMs, a
 * Takeout holds mail plus chats plus a location history, a Discord export holds
 * one file per channel. Each of those is a different kind of evidence with a
 * different `kind`, so `parseArchive` returns a **list of documents**, one per
 * sub-source, and `parseArchiveFile` returns the single document a container
 * that is really just one file produces (a `.docx` inside a zip, an `.mbox`
 * inside a Takeout).
 *
 * Identification is structural. A container whose layout matches nothing known
 * raises `UnrecognizedFormatError` naming what was found: "unknown archive" is a
 * result, and inventing a reading for an unidentified dump would put unexplained
 * text into a person's knowledge base.
 *
 * Supported layouts:
 *
 *  - **X / Twitter** — `data/*.js` (`window.YTD.…` wrappers) and `data/*.json`:
 *    `tweets`, `note-tweet`, `like`, `direct-messages`, `account`,
 *    `follower`/`following`.
 *  - **Google Takeout** — `Takeout/**`: `.mbox` mail, Google Chat
 *    `*.json`, `*.csv`, and the subtitle/`.txt` attachments Takeout ships.
 *  - **Discord** — `messages/*.json` + `channels.json` + `users.json`
 *    (`account.json` marks the export owner).
 *  - **Telegram** — `result.json` (or `chats/*\/messages*.json`).
 *  - **Instagram / Facebook** — `messages/inbox/*\/message_*.json`,
 *    `content/posts_1.json`, `your_instagram_activity/**`.
 *  - **LinkedIn** — `Connections.csv`, `Messages.csv`, `Invitations.csv`.
 */

import { basename, extname } from "node:path";

import {
  DEFAULT_MAX_MEMBER_BYTES,
  InputError,
  SourceFile,
  UnrecognizedFormatError,
  buildDocument,
  findObjectArray,
  iterateObjects,
  parseJsonPayload,
  pick,
  readZipMembers,
  recordsFromCharSpans,
  unwrapJsonAssignment,
  walkJsonLeaves,
} from "./common.mjs";
import { parseChat } from "./chat.mjs";
import { parseEmail } from "./email.mjs";
import { parseSubtitle } from "./subtitle.mjs";
import { parseFeishu } from "./feishu.mjs";

/* ------------------------------------------------------------------ */
/* container sources                                                   */
/* ------------------------------------------------------------------ */

const ZIP_EXTENSIONS = new Set([".zip", ".docx", ".xlsx", ".epub", ".jar"]);

/**
 * A container member: a `SourceFile` plus where it came from.
 *
 * `archivePath` is the member's name inside the container; `path` is a
 * human-readable origin (`<archive>.zip!/data/tweets.js`) that ends up in the
 * ledger so a citation can be traced to the exact member.
 */
export class ArchiveMember extends SourceFile {
  constructor(input) {
    super(input);
    this.archivePath = input.archivePath ?? this.name;
    this.archive = input.archive ?? null;
    this.byteOffsetInArchive = input.byteOffsetInArchive ?? null;
    this.byteLengthInArchive = input.byteLengthInArchive ?? null;
    this.origin = input.origin ?? `${this.archive ?? "<memory>"}!/${this.archivePath}`;
  }

  descriptor(extra = {}) {
    return {
      ...super.descriptor(extra),
      // The origin recorded in the ledger names both the container and the member.
      path: this.origin,
      archivePath: this.archivePath,
      archive: this.archive,
    };
  }
}

/** True when a path looks like a zip container we should open. */
export function isZipPath(path) {
  return ZIP_EXTENSIONS.has(extname(String(path)).toLowerCase());
}

/**
 * Read the members of a zip payload into `ArchiveMember`s.
 * Members that cannot be read become warnings, never exceptions.
 *
 * @param {Uint8Array} bytes
 * @param {{archiveName?: string, maxMemberBytes?: number, filter?: Function}} [options]
 */
export function readArchiveMembers(bytes, options = {}) {
  const archiveName = options.archiveName ?? "<archive>";
  const maxMemberBytes = options.maxMemberBytes ?? DEFAULT_MAX_MEMBER_BYTES;
  const warnings = [];
  let directory;

  // `readZipMembers` already swallows per-member failures; call the pair
  // directly so a bad *container* still fails loudly.
  const result = readZipMembers(bytes, { maxMemberBytes, filter: options.filter });
  directory = result.directory;
  warnings.push(...result.warnings);

  const members = [];
  for (const [name, data] of result.members) {
    const entry = directory.entries.find((candidate) => candidate.name === name);
    members.push(
      new ArchiveMember({
        path: `${archiveName}!/${name}`,
        name: basename(name),
        archivePath: name,
        archive: archiveName,
        raw: data,
        byteOffsetInArchive: entry?.localOffset ?? null,
        byteLengthInArchive: entry?.compressedSize ?? null,
        origin: `${archiveName}!/${name}`,
      }),
    );
  }
  return { members, entries: directory.entries, warnings, directory };
}

/**
 * Build a directory archive from an already-loaded file list.
 *
 * The caller (`harvest`) owns walking the filesystem, because it also needs the
 * per-file skip report for files that are not part of an archive at all.
 *
 * @param {Array<{path: string, relativePath: string, bytes: Uint8Array}>} files
 * @param {{archiveName?: string}} [options]
 */
export function directoryArchive(files, options = {}) {
  const archiveName = options.archiveName ?? "<directory>";
  return files.map(
    (file) =>
      new ArchiveMember({
        path: file.relativePath,
        name: basename(file.relativePath),
        archivePath: file.relativePath,
        archive: archiveName,
        raw: file.bytes,
        origin: `${archiveName}/${file.relativePath}`,
      }),
  );
}

/* ------------------------------------------------------------------ */
/* parsing windowed `.js` payloads                                     */
/* ------------------------------------------------------------------ */

const YTD_PREFIX = /^window\.YTD\.([A-Za-z0-9_]+)\.part\d+\s*=/;

/**
 * Read one `window.YTD.<name>.partN = […]` member.
 *
 * The wrapper is stripped with the member's own text so that every byte offset
 * that comes back refers to the raw member, not to the JSON slice.
 *
 * @returns {{records: Array<object>, name: string|null, warnings: string[]}}
 */
export function readYtdMember(member, options = {}) {
  const warnings = [];
  const { json, wrapper } = unwrapJsonAssignment(member.text);
  const nameMatch = wrapper ? YTD_PREFIX.exec(`${wrapper} =`) : null;
  const dataset = options.dataset ?? nameMatch?.[1] ?? null;

  let value;
  try {
    value = JSON.parse(json.trim().replace(/;\s*$/, ""));
  } catch (error) {
    throw new UnrecognizedFormatError(
      `${member.path} is not readable as a window.YTD payload: ${error.message}`,
      { path: member.path },
    );
  }
  if (!Array.isArray(value)) {
    throw new UnrecognizedFormatError(`${member.path} does not hold an array after the window.YTD wrapper`, { path: member.path });
  }

  const { leaves } = walkJsonLeaves(member, options.leafOptions ?? {});
  // Leaves are in document order, so they line up with `value`'s elements.
  const records = [];
  const entryCount = value.length;

  // Group leaves by their top-level array index to recover each element's bytes.
  const byIndex = new Map();
  for (const leaf of leaves) {
    const [head, ...rest] = leaf.path.split(".");
    const index = Number(head);
    if (!Number.isInteger(index)) continue;
    if (!byIndex.has(index)) byIndex.set(index, []);
    byIndex.get(index).push({ ...leaf, path: rest.join(".") });
  }

  for (let index = 0; index < entryCount; index += 1) {
    const leavesForEntry = byIndex.get(index) ?? [];
    if (leavesForEntry.length === 0) {
      warnings.push(`${member.path}: element ${index} produced no readable scalar and was skipped`);
      continue;
    }
    const byteStart = Math.min(...leavesForEntry.map((leaf) => leaf.byteStart));
    const byteEnd = Math.max(...leavesForEntry.map((leaf) => leaf.byteEnd));
    records.push({
      index,
      value: value[index],
      leaves: leavesForEntry,
      byteStart,
      byteEnd,
    });
  }

  return { records, name: dataset, warnings, value, wrapper };
}

/* ------------------------------------------------------------------ */
/* archive type detection                                              */
/* ------------------------------------------------------------------ */

function normalisedName(name) {
  return name.replace(/\\/g, "/").replace(/^\.\//, "");
}

function countMatching(names, pattern) {
  return names.filter((name) => pattern.test(name)).length;
}

/**
 * Decide which archive this is, from its member list alone.
 *
 * @param {ArchiveMember[]} members
 * @returns {{type: string, reasons: string[], confidence: "structural"}}
 */
export function detectArchiveType(members) {
  const names = members.map((member) => normalisedName(member.archivePath));
  const reasons = [];
  const has = (pattern) => names.some((name) => pattern.test(name));

  // ---- X / Twitter ---------------------------------------------------
  if (has(/(^|\/)data\/tweets\.js$/i) || has(/(^|\/)data\/account\.js$/i) || has(/(^|\/)data\/direct-messages\.js$/i)) {
    reasons.push("data/*.js members with X/Twitter's window.YTD naming");
    return { type: "x-archive", reasons, confidence: "structural" };
  }
  if (has(/(^|\/)data\/tweets\.json$/i) && has(/(^|\/)data\/account\.json$/i)) {
    reasons.push("data/tweets.json + data/account.json (an X archive with JSON data files)");
    return { type: "x-archive", reasons, confidence: "structural" };
  }

  // ---- Discord -------------------------------------------------------
  if (countMatching(names, /(^|\/)messages\/(?:[^/]+\/)?messages\.json$/i) > 0 || (has(/(^|\/)messages\/[^/]+\.json$/i) && has(/(^|\/)channels\.json$/i))) {
    reasons.push("messages/*.json channel dumps plus channels.json (Discord export)");
    return { type: "discord-export", reasons, confidence: "structural" };
  }

  // ---- Telegram ------------------------------------------------------
  if (has(/(^|\/)result\.json$/i) || countMatching(names, /(^|\/)chats\/[^/]+\/messages\d*\.json$/i) > 0) {
    reasons.push("result.json or chats/*/messages*.json (Telegram export)");
    return { type: "telegram-export", reasons, confidence: "structural" };
  }

  // ---- Instagram / Facebook ------------------------------------------
  if (countMatching(names, /(^|\/)messages\/(inbox|message_requests)\//i) > 0 || has(/(^|\/)content\/posts_1\.json$/i)) {
    reasons.push("messages/inbox/*/message_*.json or content/posts_1.json (Instagram/Facebook export)");
    return { type: "instagram-export", reasons, confidence: "structural" };
  }
  if (has(/(^|\/)your_instagram_activity\//i) || has(/(^|\/)your_facebook_activity\//i)) {
    reasons.push("your_instagram_activity/ or your_facebook_activity/ (a Meta export)");
    return { type: "instagram-export", reasons, confidence: "structural" };
  }

  // ---- LinkedIn ------------------------------------------------------
  if (has(/(^|\/)Connections\.csv$/i) || has(/(^|\/)Messages\.csv$/i) || has(/(^|\/)Invitations\.csv$/i)) {
    reasons.push("Connections.csv / Messages.csv / Invitations.csv (a LinkedIn data export)");
    return { type: "linkedin-export", reasons, confidence: "structural" };
  }

  // ---- Google Takeout ------------------------------------------------
  if (has(/(^|\/)Takeout\//i) || has(/(^|\/)takeout-[^/]+\//i)) {
    reasons.push("members under Takeout/ (a Google Takeout archive)");
    return { type: "takeout", reasons, confidence: "structural" };
  }

  // ---- Am I inside a Takeout, or is this an unlabelled dump? ---------
  if (has(/\.mbox$/i) && (has(/\.html?$/i) || has(/\.csv$/i))) {
    reasons.push(".mbox plus .html/.csv members with no Takeout/ prefix");
    return { type: "takeout", reasons, confidence: "structural" };
  }

  throw new UnrecognizedFormatError(
    `unknown archive: ${members.length} member(s) match no known export layout. Looked for: X (data/*.js), Discord (messages/*.json + channels.json), Telegram (result.json), Instagram/Facebook (messages/inbox/, content/posts_1.json), LinkedIn (Connections.csv), Google Takeout (Takeout/). Saw: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""}`,
    { members: names.slice(0, 32) },
  );
}

/* ------------------------------------------------------------------ */
/* generic record helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Records from an array of objects, one per element, using the leaves the JSON
 * walker located. The element's byte range is the envelope of its own scalars.
 */
function objectRecords(member, value, options = {}) {
  const { leaves } = walkJsonLeaves(member, options.leafOptions ?? {});
  const byIndex = new Map();
  for (const leaf of leaves) {
    const [head, ...rest] = leaf.path.split(".");
    const index = Number(head);
    if (!Number.isInteger(index)) continue;
    if (!byIndex.has(index)) byIndex.set(index, []);
    byIndex.get(index).push({ ...leaf, path: rest.join(".") });
  }

  const records = [];
  const warnings = [];
  const list = Array.isArray(value) ? value : [];
  for (let index = 0; index < list.length; index += 1) {
    const located = byIndex.get(index) ?? [];
    const rendered = options.render(list[index], index, located);
    if (!rendered) continue;
    const text = typeof rendered === "string" ? rendered : rendered.text;
    if (!text || text.trim() === "") continue;
    const envelope = located.length > 0
      ? { byteStart: Math.min(...located.map((leaf) => leaf.byteStart)), byteEnd: Math.max(...located.map((leaf) => leaf.byteEnd)) }
      : { byteStart: null, byteEnd: null };
    records.push({
      kind: typeof rendered === "object" ? rendered.kind ?? "item" : "item",
      text,
      label: typeof rendered === "object" ? rendered.label ?? null : null,
      file: member.name,
      byteStart: envelope.byteStart,
      byteEnd: envelope.byteEnd,
      synthetic: false,
    });
  }
  return { records, warnings };
}

/** Render `{path = value}` lines for every scalar the walker found. */
function renderLeaves(leaves, options = {}) {
  const maxValue = options.maxValueLength ?? 2000;
  const parts = [];
  for (const leaf of leaves) {
    const value = leaf.value === null ? "" : String(leaf.value);
    if (value === "") continue;
    parts.push(`${leaf.path || "value"}: ${value.length > maxValue ? `${value.slice(0, maxValue)}…` : value}`);
  }
  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/* per-archive extractors                                              */
/* ------------------------------------------------------------------ */

function memberByName(members, pattern) {
  return members.find((member) => pattern.test(normalisedName(member.archivePath))) ?? null;
}

function membersByName(members, pattern) {
  return members.filter((member) => pattern.test(normalisedName(member.archivePath)));
}

/** X / Twitter archive. */
export function extractXArchive(members, options = {}) {
  const documents = [];
  const warnings = [];
  const account = memberByName(members, /(^|\/)data\/account\.js$|(^|\/)data\/account\.json$/i);
  let handle = null;
  if (account) {
    try {
      const parsed = parseJsonPayload(account);
      const first = Array.isArray(parsed.value) ? parsed.value[0] : parsed.value;
      handle = first?.account?.username ?? first?.username ?? null;
    } catch (error) {
      warnings.push(`${account.path}: the account member could not be read (${error.message}); the archive owner is unknown`);
    }
  }

  const datasets = [
    { pattern: /(^|\/)data\/tweets\.js$|(^|\/)data\/tweets\.json$/i, kind: "chat", label: "tweets", as: "tweets" },
    { pattern: /(^|\/)data\/note-tweet\.js$/i, kind: "chat", label: "long-form notes", as: "note-tweets" },
    { pattern: /(^|\/)data\/like\.js$/i, kind: "archive-record", label: "likes", as: "likes" },
    { pattern: /(^|\/)data\/direct-messages\.js$/i, kind: "chat-thread", label: "direct messages", as: "direct-messages" },
    { pattern: /(^|\/)data\/follower\.js$/i, kind: "archive-record", label: "followers", as: "followers" },
    { pattern: /(^|\/)data\/following\.js$/i, kind: "archive-record", label: "following", as: "following" },
  ];

  for (const dataset of datasets) {
    for (const member of membersByName(members, dataset.pattern)) {
      let parsed;
      try {
        parsed = readYtdMember(member, { dataset: dataset.as });
      } catch (error) {
        warnings.push(`${member.path}: ${error.message}`);
        continue;
      }
      warnings.push(...parsed.warnings);

      const isTweets = dataset.as === "tweets" || dataset.as === "note-tweets";
      const isDm = dataset.as === "direct-messages";

      const records = parsed.records
        .map((record) => {
          const entry = record.value ?? {};
          if (isTweets) {
            const tweet = entry.tweet ?? entry;
            const text = tweet.full_text ?? tweet.text ?? null;
            if (typeof text !== "string" || text.trim() === "") return null;
            return {
              kind: "item",
              text,
              label: `tweet ${tweet.id_str ?? tweet.id ?? record.index} @ ${tweet.created_at ?? "unknown time"}`,
              createdAt: tweet.created_at ?? null,
              byteStart: record.byteStart,
              byteEnd: record.byteEnd,
            };
          }
          if (isDm) {
            const message = entry.dmConversation?.messages ?? entry.messages ?? [entry];
            void message;
            return null;
          }
          return {
            kind: "item",
            text: renderLeaves(record.leaves),
            label: `${dataset.label} ${record.index}`,
            byteStart: record.byteStart,
            byteEnd: record.byteEnd,
          };
        })
        .filter(Boolean);

      if (isDm) {
        // Direct messages have their own nested shape; each conversation carries
        // a messages array, and each message a `messageCreate`.
        const dmRecords = [];
        for (const record of parsed.records) {
          const conversation = record.value?.dmConversation ?? {};
          const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
          const conversationId = conversation.conversationId ?? `conversation-${record.index}`;
          for (const wrapper of messages) {
            const message = wrapper?.messageCreate ?? wrapper;
            const text = typeof message?.text === "string" ? message.text : "";
            if (text.trim() === "") continue;
            const leaves = record.leaves.filter((leaf) => leaf.path.includes(String(messages.indexOf(wrapper))));
            dmRecords.push({
              kind: "turn",
              text,
              label: `${message?.senderId ?? "unknown"} @ ${message?.createdAt ?? "unknown time"} · ${conversationId}`,
              byteStart: leaves.length > 0 ? Math.min(...leaves.map((leaf) => leaf.byteStart)) : null,
              byteEnd: leaves.length > 0 ? Math.max(...leaves.map((leaf) => leaf.byteEnd)) : null,
            });
          }
        }
        if (dmRecords.length === 0) {
          warnings.push(`${member.path}: no direct message carried text`);
          continue;
        }
        documents.push(
          buildDocument({
            parser: "archive",
            format: "x-archive",
            kind: "chat-thread",
            method: "archive-member",
            source: "x-archive",
            origin: member.origin,
            files: [member],
            entries: dmRecords,
            content: dmRecords.map((record) => record.text).join("\n\n"),
            segments: segmentRanges(dmRecords),
            warnings,
            meta: { archiveType: "x-archive", dataset: "direct-messages", owner: handle, messages: dmRecords.length },
            accounting: { model: "raw-bytes" },
          }),
        );
        warnings.length = 0;
        continue;
      }

      if (records.length === 0) {
        warnings.push(`${member.path}: the ${dataset.label} dataset held no readable text`);
        continue;
      }
      documents.push(
        buildDocument({
          parser: "archive",
          format: "x-archive",
          kind: dataset.kind,
          method: "archive-member",
          source: "x-archive",
          origin: member.origin,
          files: [member],
          content: records.map((record) => record.text).join("\n\n"),
          segments: segmentRanges(records),
          entries: records.map((record) => ({
            kind: record.kind,
            text: record.text,
            label: record.label,
            byteStart: record.byteStart,
            byteEnd: record.byteEnd,
            file: member.name,
          })),
          warnings: [...warnings],
          meta: {
            archiveType: "x-archive",
            dataset: dataset.as,
            owner: handle,
            entries: records.length,
            firstTimestamp: records.find((record) => record.createdAt)?.createdAt ?? null,
            lastTimestamp: [...records].reverse().find((record) => record.createdAt)?.createdAt ?? null,
          },
          accounting: { model: "raw-bytes" },
        }),
      );
      warnings.length = 0;
    }
  }

  if (documents.length === 0) {
    throw new UnrecognizedFormatError(
      "this looks like an X archive (data/*.js) but no dataset in it carried text",
      { members: members.map((member) => member.archivePath) },
    );
  }
  return { documents, warnings, owner: handle };
}

/** Turn per-record text into the character segments `buildDocument` expects. */
function segmentRanges(records) {
  const segments = [];
  let cursor = 0;
  for (const record of records) {
    segments.push({ charStart: cursor, charEnd: cursor + record.text.length, byteStart: record.byteStart, byteEnd: record.byteEnd });
    cursor += record.text.length + 2; // "\n\n"
  }
  return segments;
}

/** Discord export. */
export function extractDiscordExport(members, options = {}) {
  const documents = [];
  const warnings = [];
  const channelsMember = memberByName(members, /(^|\/)channels\.json$/i);
  const usersMember = memberByName(members, /(^|\/)users\.json$/i);
  const messagesMembers = membersByName(members, /(^|\/)messages\/(?:[^/]+\/)?messages\.json$/i);

  const channelNames = new Map();
  if (channelsMember) {
    try {
      const parsed = JSON.parse(channelsMember.text.trim());
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.channels) ? parsed.channels : [];
      for (const channel of list) {
        if (channel?.id) channelNames.set(String(channel.id), channel.name ?? channel.id);
      }
    } catch (error) {
      warnings.push(`${channelsMember.path}: channels.json could not be parsed (${error.message}); channels keep their ids`);
    }
  } else {
    warnings.push("no channels.json member: Discord channels keep their numeric ids");
  }

  if (usersMember) {
    try {
      const parsed = JSON.parse(usersMember.text.trim());
      const list = Array.isArray(parsed) ? parsed : [];
      if (list.length > 0) warnings.push(`users.json lists ${list.length} account(s); message authors are taken from the messages themselves`);
    } catch (error) {
      warnings.push(`${usersMember.path}: users.json could not be parsed (${error.message})`);
    }
  }

  for (const member of messagesMembers) {
    const channelId = member.archivePath.replace(/\\/g, "/").split("/").slice(-2)[0];
    const channelName = channelNames.get(channelId) ?? channelId;
    try {
      const document = parseChat(member, { format: "discord-messages", channelName });
      documents.push({
        ...document,
        parser: "archive",
        method: "archive-member",
        source: "discord-export",
        origin: member.origin,
        meta: { ...document.meta, archiveType: "discord-export", channelId, channelName },
      });
    } catch (error) {
      warnings.push(`${member.path}: ${error.message}`);
    }
  }

  if (documents.length === 0) {
    throw new UnrecognizedFormatError(
      "this looks like a Discord export (messages/*/messages.json) but no channel dump could be read",
      { members: members.map((member) => member.archivePath) },
    );
  }
  return { documents, warnings };
}

/** Telegram export. */
export function extractTelegramExport(members) {
  const documents = [];
  const warnings = [];
  const results = membersByName(members, /(^|\/)result\.json$/i);
  const chunks = membersByName(members, /(^|\/)chats\/[^/]+\/messages\d*\.json$/i);

  for (const member of results) {
    try {
      const document = parseChat(member, { format: "telegram-export" });
      documents.push({
        ...document,
        parser: "archive",
        method: "archive-member",
        source: "telegram-export",
        origin: member.origin,
        meta: { ...document.meta, archiveType: "telegram-export" },
      });
    } catch (error) {
      warnings.push(`${member.path}: ${error.message}`);
    }
  }
  // `chats/*/messages*.json` chunks are the "export in parts" mode: they hold a
  // bare array, which the Telegram detector does not accept as a whole chat.
  for (const member of chunks) {
    warnings.push(`${member.path}: this Telegram export was split into chats/*/messages*.json chunks, which is not supported yet; the chat was skipped rather than joined out of order`);
  }

  if (documents.length === 0) {
    throw new UnrecognizedFormatError(
      "this looks like a Telegram export but result.json could not be read as a chat",
      { members: members.map((member) => member.archivePath) },
    );
  }
  return { documents, warnings };
}

/** Instagram / Facebook export. */
export function extractInstagramExport(members) {
  const documents = [];
  const warnings = [];
  const messageMembers = membersByName(members, /(^|\/)messages\/(inbox|message_requests|filtered_threads|archived_threads)\/[^/]+\/message_\d+\.json$/i);
  const otherMessages = membersByName(members, /(^|\/)messages\/[^/]+\/message_\d+\.json$/i).filter((member) => !messageMembers.includes(member));

  for (const member of [...messageMembers, ...otherMessages]) {
    try {
      const document = parseChat(member, { format: "instagram-messages" });
      documents.push({
        ...document,
        parser: "archive",
        method: "archive-member",
        source: "instagram-export",
        origin: member.origin,
        meta: { ...document.meta, archiveType: "instagram-export", thread: member.archivePath.split("/").slice(-2)[0] },
      });
    } catch (error) {
      warnings.push(`${member.path}: ${error.message}`);
    }
  }

  // Posts, comments and other activity JSON: recorded as archive records, not as
  // dialogue, because they are published statements, not conversation.
  const activityMembers = membersByName(
    members,
    /(^|\/)content\/(posts|comments|story_activities|reels)_.*\.json$|(^|\/)your_(instagram|facebook)_activity\/.*\.json$/i,
  );
  for (const member of activityMembers) {
    let parsed;
    try {
      parsed = parseJsonPayload(member);
    } catch (error) {
      warnings.push(`${member.path}: ${error.message}`);
      continue;
    }
    const array = Array.isArray(parsed.value) ? parsed.value : null;
    if (!array) {
      warnings.push(`${member.path}: the activity member holds an object rather than an array and was skipped`);
      continue;
    }
    const { records } = objectRecords(member, array, {
      render: (entry, index, leaves) => {
        const rendered = renderLeaves(leaves);
        return rendered === "" ? null : { text: rendered, label: `${basename(member.archivePath)} #${index}` };
      },
    });
    if (records.length === 0) {
      warnings.push(`${member.path}: the activity member held no readable text`);
      continue;
    }
    documents.push(
      buildDocument({
        parser: "archive",
        format: "instagram-export",
        kind: "archive-record",
        method: "archive-member",
        source: "instagram-export",
        origin: member.origin,
        files: [member],
        content: records.map((record) => record.text).join("\n\n"),
        segments: segmentRanges(records),
        entries: records.map((record) => ({ ...record, file: member.name })),
        warnings: [],
        meta: { archiveType: "instagram-export", dataset: basename(member.archivePath), entries: records.length },
      }),
    );
  }

  if (documents.length === 0) {
    throw new UnrecognizedFormatError(
      "this looks like an Instagram/Facebook export but no message thread or activity file could be read",
      { members: members.map((member) => member.archivePath) },
    );
  }
  return { documents, warnings };
}

/** LinkedIn CSV export. */
export function extractLinkedInExport(members) {
  const documents = [];
  const warnings = [];
  const known = [
    { pattern: /(^|\/)Connections\.csv$/i, dataset: "connections", kind: "archive-record" },
    { pattern: /(^|\/)Messages\.csv$/i, dataset: "messages", kind: "chat" },
    { pattern: /(^|\/)Invitations\.csv$/i, dataset: "invitations", kind: "archive-record" },
  ];

  for (const { pattern, dataset, kind } of known) {
    for (const member of membersByName(members, pattern)) {
      const { rows, header, preamble, warnings: csvWarnings } = parseCsv(member.text);
      warnings.push(...csvWarnings);
      if (header.length === 0) {
        warnings.push(`${member.path}: no header row was found and the file was skipped`);
        continue;
      }
      const records = rows
        .map((row) => {
          const parts = header
            .map((column, index) => {
              const value = row.cells[index] ?? "";
              return value === "" ? null : `${column}: ${value}`;
            })
            .filter(Boolean);
          if (parts.length === 0) return null;
          return {
            kind: "item",
            text: parts.join("\n"),
            label: `${dataset} row ${row.index + 1}`,
            byteStart: row.byteStart,
            byteEnd: row.byteEnd,
          };
        })
        .filter(Boolean);

      if (records.length === 0) {
        warnings.push(`${member.path}: every row was empty`);
        continue;
      }
      documents.push(
        buildDocument({
          parser: "archive",
          format: "linkedin-export",
          kind,
          method: "archive-member",
          source: "linkedin-export",
          origin: member.origin,
          files: [member],
          content: records.map((record) => record.text).join("\n\n"),
          segments: segmentRanges(records),
          entries: records.map((record) => ({ ...record, file: member.name })),
          warnings: [],
          meta: {
            archiveType: "linkedin-export",
            dataset,
            columns: header,
            preambleLines: preamble,
            rows: records.length,
          },
        }),
      );
    }
  }

  if (documents.length === 0) {
    throw new UnrecognizedFormatError(
      "this looks like a LinkedIn export (Connections.csv / Messages.csv) but no CSV could be read",
      { members: members.map((member) => member.archivePath) },
    );
  }
  return { documents, warnings };
}

/**
 * CSV reader for the LinkedIn exports.
 *
 * LinkedIn prefixes `Connections.csv` with "Notes:" lines before the real header,
 * so the header is the first row with more than one non-empty field. Quoted
 * fields, embedded commas, embedded newlines and doubled quotes are handled.
 *
 * @returns {{rows: Array<{index: number, cells: string[], byteStart: number,
 *            byteEnd: number}>, header: string[], preamble: number,
 *            warnings: string[]}}
 */
export function parseCsv(text, options = {}) {
  const warnings = [];
  const rows = [];
  let index = 0;
  let row = 0;
  let cells = [];
  let field = "";
  let inQuotes = false;
  let rowStart = 0;
  let sawQuote = false;

  const pushField = () => {
    cells.push(field);
    field = "";
    sawQuote = false;
  };
  const pushRow = (end) => {
    pushField();
    rows.push({ index: row, cells, byteStart: rowStart, byteEnd: end });
    row += 1;
    cells = [];
    rowStart = end + 1;
  };

  while (index < text.length) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
      sawQuote = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      pushRow(index);
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }
  if (field !== "" || cells.length > 0) pushRow(text.length);
  if (inQuotes) warnings.push("the CSV ended inside a quoted field; the field was closed at end of file");

  const headerIndex = rows.findIndex((candidate) => candidate.cells.filter((cell) => cell.trim() !== "").length > 1);
  if (headerIndex === -1) {
    return { rows: [], header: [], preamble: rows.length, warnings: [...warnings, "no row had more than one populated field, so no header could be identified"] };
  }
  const header = rows[headerIndex].cells.map((cell) => cell.trim()).filter((cell) => cell !== "");
  const dataRows = rows.slice(headerIndex + 1).filter((candidate) => candidate.cells.some((cell) => cell.trim() !== ""));
  if (headerIndex > 0) warnings.push(`${headerIndex} preamble line(s) before the header were skipped`);
  if (dataRows.length === 0) warnings.push("the CSV has a header but no data rows");

  return { rows: dataRows, header, preamble: headerIndex, warnings };
}

/** Google Takeout. */
export function extractTakeout(members, options = {}) {
  const documents = [];
  const warnings = [];
  const handled = new Set();

  const mboxMembers = membersByName(members, /\.mbox$/i);
  for (const member of mboxMembers) {
    try {
      const document = parseEmail(member, { format: "mbox" });
      documents.push({
        ...document,
        parser: "archive",
        method: "archive-member",
        source: "takeout",
        origin: member.origin,
        meta: { ...document.meta, archiveType: "takeout", dataset: "mail" },
      });
      handled.add(member.archivePath);
    } catch (error) {
      warnings.push(`${member.path}: ${error.message}`);
    }
  }

  const subtitleMembers = membersByName(members, /\.(srt|vtt)$/i);
  for (const member of subtitleMembers) {
    try {
      const document = parseSubtitle(member);
      documents.push({
        ...document,
        parser: "archive",
        method: "archive-member",
        source: "takeout",
        origin: member.origin,
        meta: { ...document.meta, archiveType: "takeout", dataset: "captions" },
      });
      handled.add(member.archivePath);
    } catch (error) {
      warnings.push(`${member.path}: ${error.message}`);
    }
  }

  // Google Chat takeout: `Takeout/Chat/Groups/<name>/group_info.json` plus
  // `messages.json`. The schema is not stable across exports, so the messages
  // are read as records rather than claimed as a known chat format.
  const chatMembers = membersByName(members, /(^|\/)Chat\/.*messages\.json$/i);
  for (const member of chatMembers) {
    let parsed;
    try {
      parsed = parseJsonPayload(member);
    } catch (error) {
      warnings.push(`${member.path}: ${error.message}`);
      continue;
    }
    const array = Array.isArray(parsed.value) ? parsed.value : Array.isArray(parsed.value?.messages) ? parsed.value.messages : null;
    if (!array) {
      warnings.push(`${member.path}: Google Chat message file has no messages array and was skipped`);
      continue;
    }
    const { records } = objectRecords(member, array, {
      render: (entry, index, leaves) => {
        const creator = entry?.creator?.name ?? entry?.sender_name ?? entry?.sender ?? "unknown";
        const created = entry?.created_date ?? entry?.create_time ?? entry?.timestamp ?? "unknown time";
        const text = entry?.text ?? entry?.message ?? renderLeaves(leaves.filter((leaf) => !/creator|created_date/.test(leaf.path)));
        if (typeof text !== "string" || text.trim() === "") return null;
        return { text, label: `${creator} @ ${created}` };
      },
    });
    if (records.length === 0) {
      warnings.push(`${member.path}: Google Chat messages carried no text`);
      continue;
    }
    documents.push(
      buildDocument({
        parser: "archive",
        // The Google Chat schema is not verified against a real export, so the
        // format is recorded as the generic takeout one rather than claimed.
        format: "takeout-chat",
        kind: "chat-thread",
        method: "archive-member",
        source: "takeout",
        origin: member.origin,
        files: [member],
        content: records.map((record) => record.text).join("\n\n"),
        segments: segmentRanges(records),
        entries: records.map((record) => ({ ...record, file: member.name })),
        warnings: ["Google Chat records are read generically; the export schema is not verified against a real archive (TODO)"],
        meta: { archiveType: "takeout", dataset: "chat", entries: records.length },
      }),
    );
    handled.add(member.archivePath);
  }

  // Remaining CSV/JSON/HTML members: recorded as archive records so nothing in
  // the export is silently ignored, with the member name in the label.
  const leftovers = members.filter((member) => {
    if (handled.has(member.archivePath)) return false;
    if (/(^|\/)metadata\.json$|(^|\/)archive_browser\.html$|(^|\/)README\.txt$/i.test(member.archivePath)) return false;
    return /\.(csv|json|txt)$/i.test(member.archivePath);
  });
  for (const member of leftovers) {
    if (/\.csv$/i.test(member.archivePath)) {
      const { rows, header, warnings: csvWarnings } = parseCsv(member.text);
      warnings.push(...csvWarnings);
      if (header.length === 0 || rows.length === 0) {
        warnings.push(`${member.path}: the CSV had no usable rows`);
        continue;
      }
      const records = rows.map((row) => ({
        kind: "item",
        text: header.map((column, index) => (row.cells[index] ? `${column}: ${row.cells[index]}` : null)).filter(Boolean).join("\n"),
        label: `${basename(member.archivePath)} row ${row.index + 1}`,
        byteStart: row.byteStart,
        byteEnd: row.byteEnd,
        file: member.name,
      }));
      documents.push(
        buildDocument({
          parser: "archive",
          format: "takeout",
          kind: "archive-record",
          method: "archive-member",
          source: "takeout",
          origin: member.origin,
          files: [member],
          content: records.map((record) => record.text).join("\n\n"),
          segments: segmentRanges(records),
          entries: records,
          warnings: [],
          meta: { archiveType: "takeout", dataset: basename(member.archivePath), columns: header, rows: records.length },
        }),
      );
      continue;
    }
    if (/\.json$/i.test(member.archivePath) && /(^|\/)Chat\//i.test(member.archivePath)) continue;

    let parsed;
    try {
      parsed = parseJsonPayload(member);
    } catch (error) {
      warnings.push(`${member.path}: ${error.message}`);
      continue;
    }
    const array = Array.isArray(parsed.value)
      ? parsed.value
      : Array.isArray(parsed.value?.items)
        ? parsed.value.items
        : Array.isArray(parsed.value?.locations)
          ? parsed.value.locations
          : null;
    if (!array) {
      warnings.push(`${member.path}: a Takeout JSON member with no array and no items[] was skipped`);
      continue;
    }
    const { records } = objectRecords(member, array, {
      render: (entry, index, leaves) => {
        const rendered = renderLeaves(leaves);
        return rendered === "" ? null : { text: rendered, label: `${basename(member.archivePath)} #${index}` };
      },
    });
    if (records.length === 0) {
      warnings.push(`${member.path}: a Takeout JSON member held no readable text`);
      continue;
    }
    documents.push(
      buildDocument({
        parser: "archive",
        format: "takeout",
        kind: "archive-record",
        method: "archive-member",
        source: "takeout",
        origin: member.origin,
        files: [member],
        content: records.map((record) => record.text).join("\n\n"),
        segments: segmentRanges(records),
        entries: records.map((record) => ({ ...record, file: member.name })),
        warnings: [],
        meta: { archiveType: "takeout", dataset: basename(member.archivePath), entries: records.length },
      }),
    );
  }

  if (documents.length === 0) {
    throw new UnrecognizedFormatError(
      "this looks like a Google Takeout archive but no readable member was found (looked for .mbox mail, .srt/.vtt captions, Chat/messages.json, CSV and JSON activity files)",
      { members: members.map((member) => member.archivePath).slice(0, 32) },
    );
  }
  return { documents, warnings };
}

/** Meta (Instagram/Facebook) archives that are not a DM dump. */
export function extractMetaActivity(members) {
  const documents = [];
  const warnings = [];
  const activity = membersByName(members, /your_(instagram|facebook)_activity\/.*\.json$/i);
  for (const member of activity) {
    let parsed;
    try {
      parsed = parseJsonPayload(member);
    } catch (error) {
      warnings.push(`${member.path}: ${error.message}`);
      continue;
    }
    const array = Array.isArray(parsed.value) ? parsed.value : null;
    if (!array) {
      warnings.push(`${member.path}: the activity file holds an object, not an array, and was skipped`);
      continue;
    }
    const { records } = objectRecords(member, array, {
      render: (entry, index, leaves) => {
        const rendered = renderLeaves(leaves);
        return rendered === "" ? null : { text: rendered, label: `${basename(member.archivePath)} #${index}` };
      },
    });
    if (records.length === 0) {
      warnings.push(`${member.path}: the activity file held no readable text`);
      continue;
    }
    documents.push(
      buildDocument({
        parser: "archive",
        format: "instagram-export",
        kind: "archive-record",
        method: "archive-member",
        source: "instagram-export",
        origin: member.origin,
        files: [member],
        content: records.map((record) => record.text).join("\n\n"),
        segments: segmentRanges(records),
        entries: records.map((record) => ({ ...record, file: member.name })),
        warnings: [],
        meta: { archiveType: "instagram-export", dataset: basename(member.archivePath), entries: records.length },
      }),
    );
  }
  return { documents, warnings };
}

/* ------------------------------------------------------------------ */
/* entry points                                                        */
/* ------------------------------------------------------------------ */

const EXTRACTORS = {
  "x-archive": extractXArchive,
  "discord-export": extractDiscordExport,
  "telegram-export": extractTelegramExport,
  "instagram-export": extractInstagramExport,
  "linkedin-export": extractLinkedInExport,
  takeout: extractTakeout,
};

/**
 * Parse an archive into a list of documents.
 *
 * @param {ArchiveMember[]} members
 * @param {{type?: string, maxDocuments?: number}} [options]
 * @returns {{type: string, reasons: string[], documents: Array<object>,
 *            warnings: string[], skipped: Array<{member: string, why: string}>}}
 */
export function parseArchive(members, options = {}) {
  if (!Array.isArray(members) || members.length === 0) {
    throw new InputError("an archive needs at least one member");
  }
  const detected = options.type
    ? { type: options.type, reasons: ["type supplied by the caller"], confidence: "asserted" }
    : detectArchiveType(members);

  const extractor = EXTRACTORS[detected.type];
  if (!extractor) {
    throw new UnrecognizedFormatError(`no extractor is implemented for archive type ${detected.type}`, { type: detected.type });
  }

  const result = extractor(members, options);
  const documents = result.documents.slice(0, options.maxDocuments ?? 1000);
  if (result.documents.length > documents.length) {
    result.warnings.push(`the archive produced ${result.documents.length} documents; only the first ${documents.length} were kept`);
  }

  // A member that no document used is either a support file or something we did
  // not understand. Either way it is named, because an archive that quietly
  // ignores half its members is not evidence.
  const used = new Set(documents.flatMap((document) => (document.files ?? []).map((file) => file.name)));
  const skipped = [];
  for (const member of members) {
    if (used.has(member.name)) continue;
    if (/(^|\/)(metadata\.json|archive_browser\.html|README\.txt|channels\.json|users\.json|account\.js|account\.json|group_info\.json)$/i.test(member.archivePath)) continue;
    if (/\/$/.test(member.archivePath)) continue;
    skipped.push({ member: member.archivePath, why: "no extractor in this archive type claimed this member" });
  }

  return {
    type: detected.type,
    reasons: detected.reasons,
    documents,
    warnings: result.warnings ?? [],
    skipped,
    owner: result.owner ?? null,
  };
}

/** Map a member's extension to the parser that should read it. */
export function memberParser(member) {
  const name = normalisedName(member.archivePath);
  const lower = name.toLowerCase();
  if (/\.(eml)$/.test(lower)) return "email";
  if (/\.mbox$/.test(lower)) return "email";
  if (/\.(srt|vtt)$/.test(lower)) return "subtitle";
  if (/\.(docx|xlsx)$/.test(lower)) return "office";
  if (/\.json$/.test(lower) || /\.js$/.test(lower)) return "chat";
  if (/\.csv$/.test(lower)) return "csv";
  if (/\.html?$/.test(lower)) return "html";
  if (/\.(txt|md)$/.test(lower)) return "feishu-text";
  return null;
}

/** X archive members this module parses itself, by lower-cased path. */
const X_MEMBERS = {
  "data/tweets.js": "tweets",
  "data/direct-messages.js": "dms",
  "data/like.js": "likes",
  "data/likes.js": "likes",
};

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Route an archive member to the parser that should handle it. */
export function classifyMember(name) {
  const lower = name.toLowerCase();
  if (X_MEMBERS[lower]) return { parser: "x", format: X_MEMBERS[lower] };
  if (/^data\/.*\.(js|json)$/.test(lower)) return { parser: "x", format: "other" };
  if (lower.endsWith(".mbox")) return { parser: "email", format: "mbox" };
  if (lower.endsWith(".eml")) return { parser: "email", format: "eml" };
  if (lower.endsWith(".srt") || lower.endsWith(".vtt")) return { parser: "subtitle", format: lower.split(".").pop() };
  if (lower.endsWith(".docx") || lower.endsWith(".xlsx")) return { parser: "office", format: lower.split(".").pop() };
  if (lower.endsWith(".csv")) return { parser: "csv", format: "csv" };
  if (lower.endsWith(".json") || lower.endsWith(".js")) return { parser: "chat", format: "json" };
  if (/\.(txt|md|html?)$/.test(lower)) return { parser: "text", format: lower.split(".").pop() };
  return { parser: "unsupported", format: null };
}

/** X archive member → records (the one format this module parses itself). */
export function parseXMember(name, buffer) {
  const kind = X_MEMBERS[name.toLowerCase()] ?? "other";
  const { json } = unwrapJsonAssignment(buffer.toString("utf8"));
  let value;
  try {
    value = JSON.parse(json.trim().replace(/;\s*$/, ""));
  } catch (error) {
    throw new Error(`${name} is not a readable X export (${error.message})`);
  }
  const rows = Array.isArray(value) ? value : [value];
  const records = [];
  for (const row of rows) {
    if (kind === "tweets" && row?.tweet) {
      const tweet = row.tweet;
      records.push({
        kind: "tweet",
        text: [text(tweet.created_at), text(tweet.full_text)].filter(Boolean).join(" · "),
        label: text(tweet.id_str, "tweet"),
      });
    } else if (kind === "dms" && row?.dmConversation) {
      for (const entry of row.dmConversation.messages ?? []) {
        const message = entry?.messageCreate;
        if (!message) continue;
        records.push({
          kind: "dm",
          text: [text(message.createdAt), `${text(message.senderId, "?")}: ${text(message.text)}`].filter(Boolean).join(" · "),
          label: row.dmConversation.conversationId ?? "dm",
        });
      }
    } else if (kind === "likes" && row?.like) {
      records.push({ kind: "like", text: text(row.like.fullText), label: text(row.like.expandedUrl, "like") });
    }
  }
  return records.filter((record) => record.text.length > 0);
}

/**
 * Parse a container that holds exactly one document (a `.zip` around one
 * `.mbox`, a `.docx`, a `.zip` around a single chat export).
 *
 * Returns `null` when the container is not single-document shaped, which is how
 * `harvest` decides to fall back to `parseArchive`.
 */
export function parseArchiveFile(bytes, options = {}) {
  const archiveName = options.archiveName ?? "<archive>";
  const { members, warnings } = readArchiveMembers(bytes, { archiveName, maxMemberBytes: options.maxMemberBytes });
  const interesting = members.filter((member) => !/(^|\/)(README\.txt|LICENSE\.txt)$/i.test(member.archivePath));

  if (interesting.length === 1) {
    const member = interesting[0];
    const parser = memberParser(member);
    if (parser === "email") return [{ kind: "email", member, parser, warnings }];
    if (parser === "subtitle") return [{ kind: "subtitle", member, parser, warnings }];
    if (parser === "office") return [{ kind: "office", member, parser, warnings }];
    if (parser === "chat") return [{ kind: "chat", member, parser, warnings }];
  }

  if (interesting.length === 0) {
    throw new UnrecognizedFormatError(`${archiveName} is an empty zip container`, { members: [] });
  }
  return null;
}
