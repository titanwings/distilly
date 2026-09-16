/**
 * dimensions.mjs — the six derivation dimensions `retrospect` was missing.
 *
 * The recovered `retrospect.mjs` had `stats` only: `voice`, `relations`,
 * `timeline`, `boundaries`, `shifts` and `conflicts` were declared in
 * `DERIVED_KINDS` and had thresholds in `MIN_UNITS`, but no deriver — so six of
 * the seven output files were always empty, the acceptance page could only fill
 * two of its seven authored segments, and no citation ever reached the page.
 *
 * Everything here obeys the same three rules as `stats`:
 *
 *  1. **A claim without a citable anchor is not emitted.** `makeClaim` returns
 *     `null` when there is nothing to cite, and the assembly drops the `null`s.
 *  2. **Nothing is invented.** A dimension that cannot be measured on this
 *     corpus says so in `notes` instead of producing a plausible-looking claim.
 *  3. **No clocks, no randomness.** Every list is sorted before it is summarised,
 *     so two runs over the same ledger are byte-identical.
 *
 * The features each dimension is expected to find on the bundled fixture are
 * listed in `src/derive/fixtures/synthetic-group/README.md`; that table is the
 * spec these implementations were written against.
 */

/* ------------------------------------------------------------------ */
/* small statistics                                                    */
/* ------------------------------------------------------------------ */

const round = (value) => (Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null);

const mean = (numbers) => (numbers.length === 0 ? null : round(numbers.reduce((total, value) => total + value, 0) / numbers.length));

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = numbers.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]);
}

function percentile(numbers, fraction) {
  if (numbers.length === 0) return null;
  const sorted = numbers.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return round(sorted[index]);
}

const unique = (values) => [...new Set(values)];

/** Characters that carry meaning, for length comparisons. */
const countChars = (text) => [...String(text ?? "")].filter((char) => !/\s/.test(char)).length;

/** Sentence-ish units. CJK full stop, ASCII stop, exclamation, question, ellipsis. */
const SENTENCE_SPLIT = /[。！？!?…]+/;
const sentencesOf = (text) =>
  String(text ?? "")
    .split(SENTENCE_SPLIT)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "");


/* ------------------------------------------------------------------ */
/* voice                                                               */
/* ------------------------------------------------------------------ */

const PUNCTUATION = /[，。！？、；：""''（）《》…—,.!?;:()"']/g;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const QUESTION = /[？?]/;
/**
 * A probe does not have to end in a question mark: real chat leaves the question
 * implicit ("那offer的事..."), and the fixture's second deflection is exactly
 * that shape. An interrogative word or a trailing ellipsis counts too — but a
 * bare statement does not, or every refusal would claim the previous message as
 * its probe.
 */
const PROBE_LIKE = /[？?]|(?:吗|呢|怎么|为什么|什么|哪|谁|是否|有没有)[？?]?|(?:\.\.\.|…)\s*$/;
const ADDRESS_SUFFIXES = ["哥", "姐", "总", "工", "老师", "老板", "同学"];

/** Stop words that would otherwise dominate the n-gram counts. */
const STOP_WORDS = new Set(["这个", "那个", "我们", "你们", "他们", "什么", "怎么", "可以", "还是", "就是", "一下", "一个", "没有", "不是"]);

/** Half-open character n-grams, CJK-aware (no word segmentation available). */
function ngramsOf(text, size) {
  const clean = String(text ?? "").replace(/[\s，。！？、；：""''（）《》…—,.!?;:()"']/g, "");
  const out = [];
  for (let index = 0; index + size <= clean.length; index += 1) out.push(clean.slice(index, index + size));
  return out;
}

function speakerStats(units, measure) {
  const bySpeaker = {};
  for (const unit of units) {
    const speaker = unit.speaker ?? null;
    if (speaker === null) continue;
    const values = measure(unit);
    if (values.length === 0) continue;
    if (!bySpeaker[speaker]) bySpeaker[speaker] = { samples: 0, values: [], anchors: [] };
    bySpeaker[speaker].samples += values.length;
    bySpeaker[speaker].values.push(...values);
    bySpeaker[speaker].anchors.push(unit.anchor);
  }
  const summarised = {};
  for (const speaker of Object.keys(bySpeaker).sort()) {
    const entry = bySpeaker[speaker];
    summarised[speaker] = {
      samples: entry.samples,
      mean: mean(entry.values),
      median: median(entry.values),
      p90: percentile(entry.values, 0.9),
      min: entry.values.length > 0 ? Math.min(...entry.values) : null,
      max: entry.values.length > 0 ? Math.max(...entry.values) : null,
      anchors: unique(entry.anchors).sort(),
    };
  }
  return summarised;
}

const anchorList = (bySpeaker) => unique(Object.values(bySpeaker).flatMap((entry) => entry.anchors)).sort();

/**
 * How one person talks: sentence length, punctuation density, emoji, catch
 * phrases, address terms, question ratio.
 *
 * Per-speaker numbers are reported alongside the pooled one, because a corpus
 * average over a terse engineer and a chatty PM describes neither of them.
 */
export function deriveVoice(corpus, helpers) {
  const { units } = corpus;
  const { makeClaim, note, MIN } = helpers;
  const claims = [];
  const notes = [];
  const withSpeaker = units.filter((unit) => unit.speaker !== null && unit.speaker !== undefined);

  // ---- sentence length -----------------------------------------------------
  const sentenceValues = (unit) => sentencesOf(unit.text).map(countChars).filter((value) => value > 0);
  const bySpeaker = speakerStats(withSpeaker, sentenceValues);
  const allSentences = units.flatMap(sentenceValues);
  const speakerCount = Object.keys(bySpeaker).length;

  if (allSentences.length >= MIN.sentences) {
    const anchorable = anchorList(bySpeaker);
    const claim = makeClaim(
      "voice.sentence_length",
      "句长分布（字符数）",
      "Sentence length (characters)",
      {
        unit: "chars",
        mean: mean(allSentences),
        median: median(allSentences),
        p90: percentile(allSentences, 0.9),
        sentences: allSentences.length,
        // `pooled: true` means this number mixes speakers. When it does, the
        // per-speaker breakdown below is the one to read.
        pooled: speakerCount > 1,
        mixes_speakers: speakerCount > 1,
        by_speaker: bySpeaker,
      },
      anchorable,
      allSentences.length,
      units.map((unit) => unit.anchor),
    );
    if (claim) claims.push(claim);
    else notes.push(note("句长可算但没有可引用锚点。", "Sentence lengths were computed but no citable anchor exists."));
  } else {
    notes.push(
      note(
        `句长样本不足：只有 ${allSentences.length} 句，低于最低样本数 ${MIN.sentences}。`,
        `Not enough sentences for length: ${allSentences.length} < ${MIN.sentences}.`,
      ),
    );
  }

  // ---- punctuation density -------------------------------------------------
  const punctuationValues = (unit) => {
    const text = String(unit.text ?? "");
    if (text === "") return [];
    return [(text.match(PUNCTUATION) ?? []).length / Math.max(1, countChars(text))];
  };
  const punctBySpeaker = speakerStats(withSpeaker, punctuationValues);
  const allPunct = units.flatMap(punctuationValues);
  if (allPunct.length >= MIN.punctuation) {
    const claim = makeClaim(
      "voice.punctuation_density",
      "标点密度（每字符）",
      "Punctuation density (per character)",
      {
        mean: mean(allPunct),
        median: median(allPunct),
        messages: allPunct.length,
        pooled: Object.keys(punctBySpeaker).length > 1,
        by_speaker: Object.fromEntries(
          Object.entries(punctBySpeaker).map(([speaker, entry]) => [speaker, { samples: entry.samples, mean: entry.mean, median: entry.median }]),
        ),
      },
      anchorList(punctBySpeaker),
      allPunct.length,
      units.map((unit) => unit.anchor),
    );
    if (claim) claims.push(claim);
  } else {
    notes.push(note(`标点样本不足：${allPunct.length} < ${MIN.punctuation}。`, `Not enough messages for punctuation: ${allPunct.length} < ${MIN.punctuation}.`));
  }

  // ---- emoji ---------------------------------------------------------------
  const emojiUnits = units.filter((unit) => (String(unit.text ?? "").match(EMOJI) ?? []).length > 0);
  if (emojiUnits.length >= MIN.emoji) {
    const counts = emojiUnits.map((unit) => (String(unit.text).match(EMOJI) ?? []).length);
    const claim = makeClaim(
      "voice.emoji_density",
      "表情使用",
      "Emoji usage",
      {
        messages_with_emoji: emojiUnits.length,
        messages: units.length,
        per_message: round(emojiUnits.length / Math.max(1, units.length)),
        max_in_one_message: Math.max(...counts),
      },
      emojiUnits.map((unit) => unit.anchor),
      emojiUnits.length,
    );
    if (claim) claims.push(claim);
  } else {
    notes.push(note(`表情样本不足：${emojiUnits.length} < ${MIN.emoji}。`, `Not enough emoji messages: ${emojiUnits.length} < ${MIN.emoji}.`));
  }

  // ---- catch phrases -------------------------------------------------------
  const counts = new Map();
  const owners = new Map();
  for (const unit of units) {
    for (const gram of ngramsOf(unit.text, 3)) {
      if (STOP_WORDS.has(gram)) continue;
      counts.set(gram, (counts.get(gram) ?? 0) + 1);
      if (!owners.has(gram)) owners.set(gram, new Set());
      owners.get(gram).add(unit.anchor);
    }
  }
  const repeated = [...counts.entries()].filter(([, count]) => count >= 3).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (units.length >= MIN.ngram && repeated.length > 0) {
    const phrases = repeated.slice(0, 8).map(([phrase, count]) => ({
      phrase,
      count,
      anchors: [...owners.get(phrase)].sort().slice(0, 3),
    }));
    const claim = makeClaim(
      "voice.catchphrases",
      "口头禅（重复三字组）",
      "Catch phrases (repeated trigrams)",
      { phrases },
      unique(phrases.flatMap((entry) => entry.anchors)),
      units.length,
    );
    if (claim) claims.push(claim);
  } else {
    notes.push(note(`口头禅样本不足：语料 ${units.length} 条 < ${MIN.ngram}。`, `Not enough text for catch phrases: ${units.length} < ${MIN.ngram}.`));
  }

  // ---- address terms -------------------------------------------------------
  const names = unique(units.flatMap((unit) => unit.speakers ?? []));
  const terms = new Map();
  for (const name of names) {
    if (name.length < 2) continue;
    const stem = name.slice(0, -1);
    for (const suffix of ADDRESS_SUFFIXES) terms.set(`${stem}${suffix}`, name);
  }
  const addressUnits = new Map();
  for (const unit of units) {
    for (const [term, owner] of terms) {
      if (String(unit.text ?? "").includes(term)) {
        if (!addressUnits.has(term)) addressUnits.set(term, { owner, anchors: [] });
        addressUnits.get(term).anchors.push(unit.anchor);
      }
    }
  }
  const used = [...addressUnits.entries()].filter(([, entry]) => entry.anchors.length >= 2).sort((left, right) => left[0].localeCompare(right[0]));
  if (used.length > 0) {
    const claim = makeClaim(
      "voice.address_terms",
      "称呼用法",
      "Address terms",
      {
        terms: used.map(([term, entry]) => ({ term, refers_to: entry.owner, count: entry.anchors.length })),
      },
      unique(used.flatMap(([, entry]) => entry.anchors)),
      used.reduce((total, [, entry]) => total + entry.anchors.length, 0),
    );
    if (claim) claims.push(claim);
  } else if (units.length >= MIN.address) {
    notes.push(note("没有找到重复出现的称呼词。", "No repeated address term was found."));
  }

  // ---- questions -----------------------------------------------------------
  const questionUnits = units.filter((unit) => QUESTION.test(String(unit.text ?? "")));
  if (units.length >= MIN.questions) {
    const claim = makeClaim(
      "voice.question_ratio",
      "提问比例",
      "Question ratio",
      { questions: questionUnits.length, messages: units.length, ratio: round(questionUnits.length / units.length) },
      questionUnits.map((unit) => unit.anchor),
      units.length,
      units.map((unit) => unit.anchor),
    );
    if (claim) claims.push(claim);
  } else {
    notes.push(note(`提问比例样本不足：${units.length} < ${MIN.questions}。`, `Not enough messages for the question ratio: ${units.length} < ${MIN.questions}.`));
  }

  return { claims: claims.filter(Boolean), notes };
}

/* ------------------------------------------------------------------ */
/* timeline                                                            */
/* ------------------------------------------------------------------ */

/**
 * Dated phases.
 *
 * Only produced when the corpus carries timestamps: a phase without dates would
 * be a phase in name only, and `docs/v2/RENDER.md` tells the page to show a gap
 * instead of an invented axis. Each phase cites the anchors that bound it, so a
 * reader can check the range rather than trust the label.
 */
export function deriveTimeline(corpus, helpers) {
  const { units } = corpus;
  const { makeClaim, note, MIN } = helpers;
  const claims = [];
  const notes = [];
  const timed = units.filter((unit) => unit.at !== null && unit.at !== undefined);
  if (timed.length < MIN.phases) {
    notes.push(
      note(
        `时间线样本不足：只有 ${timed.length} 条带时间戳的消息，低于 ${MIN.phases}。`,
        `Not enough dated messages for a timeline: ${timed.length} < ${MIN.phases}.`,
      ),
    );
    return { claims, notes };
  }

  const first = timed[0].at;
  const last = timed[timed.length - 1].at;
  const span = Math.max(1, last - first);
  const phaseCount = span > 0 ? Math.min(4, Math.max(2, Math.round(timed.length / 15))) : 1;
  const buckets = Array.from({ length: phaseCount }, () => []);
  for (const unit of timed) {
    const index = span === 0 ? 0 : Math.min(phaseCount - 1, Math.floor(((unit.at - first) / span) * phaseCount));
    buckets[index].push(unit);
  }

  buckets.forEach((bucket, index) => {
    if (bucket.length === 0) return;
    const anchors = bucket.map((unit) => unit.anchor);
    const lengths = bucket.flatMap((unit) => sentencesOf(unit.text).map(countChars)).filter((value) => value > 0);
    const speakers = unique(bucket.flatMap((unit) => unit.speakers ?? []));
    const claim = makeClaim(
      `timeline.phase.${index + 1}`,
      `阶段 ${index + 1}（按时间切分）`,
      `Phase ${index + 1} (time-based)`,
      {
        // `time`, not `order`: the buckets come from timestamps, so an export
        // that is missing dates cannot silently produce order-based phases.
        basis: "time",
        // A time-of-day corpus shows the times it has; only a corpus that really
        // carried dates gets instants.
        from: bucket[0].atLabel ?? new Date(bucket[0].at).toISOString(),
        to: bucket[bucket.length - 1].atLabel ?? new Date(bucket[bucket.length - 1].at).toISOString(),
        messages: bucket.length,
        speakers,
        mean_chars: mean(lengths),
        questions: bucket.filter((unit) => QUESTION.test(String(unit.text ?? ""))).length,
        // The two anchors that bound the range: a phase claim that cited only its
        // first message would not let a reader check where it ends.
        range_anchors: { from: bucket[0].anchor, to: bucket[bucket.length - 1].anchor },
      },
      [anchors[0], anchors[anchors.length - 1], ...anchors.slice(1, 3)],
      bucket.length,
      anchors,
    );
    if (claim) claims.push(claim);
  });

  claims.push(
    makeClaim(
      "timeline.span",
      "时间跨度",
      "Time span",
      {
        basis: "time",
        from: timed[0].atLabel ?? new Date(first).toISOString(),
        to: timed[timed.length - 1].atLabel ?? new Date(last).toISOString(),
        days: round(span / 86_400_000),
        messages: timed.length,
        range_anchors: { from: timed[0].anchor, to: timed[timed.length - 1].anchor },
      },
      [timed[0].anchor, timed[timed.length - 1].anchor],
      timed.length,
      timed.map((unit) => unit.anchor),
    ),
  );

  return { claims: claims.filter(Boolean), notes };
}

/* ------------------------------------------------------------------ */
/* relations                                                           */
/* ------------------------------------------------------------------ */

/**
 * Who answers whom, and what they call each other.
 *
 * Reply counts come from adjacency (a turn answered within the same file, in
 * order). The asymmetry report is the interesting part: "A answers B twice as
 * often as B answers A" is a relationship fact, while the raw counts are not.
 */
export function deriveRelations(corpus, helpers) {
  const { units } = corpus;
  const { makeClaim, note, MIN } = helpers;
  const claims = [];
  const notes = [];

  const replies = new Map(); // "A→B" -> anchors
  for (let index = 1; index < units.length; index += 1) {
    const from = units[index - 1];
    const to = units[index];
    if (from.file !== to.file) continue;
    if (!from.speaker || !to.speaker || from.speaker === to.speaker) continue;
    const key = `${from.speaker}→${to.speaker}`;
    if (!replies.has(key)) replies.set(key, []);
    replies.get(key).push(to.anchor);
  }

  const totalReplies = [...replies.values()].reduce((total, list) => total + list.length, 0);
  if (totalReplies >= MIN.interactions) {
    const pairs = [...replies.entries()].sort((left, right) => left[0].localeCompare(right[0]));
    const claim = makeClaim(
      "relations.reply_counts",
      "回应频次",
      "Reply counts",
      {
        pairs: pairs.map(([pair, anchors]) => {
          const [from, to] = pair.split("→");
          const reverse = replies.get(`${to}→${from}`)?.length ?? 0;
          return {
            from,
            to,
            replies: anchors.length,
            reverse_replies: reverse,
            asymmetry: round(anchors.length / Math.max(1, anchors.length + reverse)),
          };
        }),
      },
      unique(pairs.flatMap(([, anchors]) => anchors)).sort(),
      totalReplies,
    );
    if (claim) claims.push(claim);
  } else {
    notes.push(note(`回应样本不足：${totalReplies} < ${MIN.interactions}。`, `Not enough replies: ${totalReplies} < ${MIN.interactions}.`));
  }

  // ---- address shift -------------------------------------------------------
  // An address term is "how A calls B". A change *within one conversation* is
  // the signal: the same pair moving from 林工 to 林哥 is a change in closeness,
  // while two different files using different terms is just two contexts.
  const names = unique(units.flatMap((unit) => unit.speakers ?? []));
  const variants = new Map();
  for (const name of names) {
    if (name.length < 2) continue;
    const stem = name.slice(0, -1);
    for (const suffix of ADDRESS_SUFFIXES) {
      // The canonical name is a term too, and it is usually the *earlier* one:
      // 林工 in the first half, 林哥 in the second. Excluding it (the first
      // version did) leaves nothing to shift *from*, so the change is invisible.
      variants.set(`${stem}${suffix}`, name);
    }
  }

  let shiftIndex = 0;
  for (const file of unique(units.map((unit) => unit.file)).sort()) {
    const inFile = units.filter((unit) => unit.file === file && unit.speaker !== null);
    if (inFile.length < 4) continue;
    const half = Math.floor(inFile.length / 2);
    const count = (slice) => {
      const tally = new Map();
      for (const unit of slice) {
        for (const [term, owner] of variants) {
          if (String(unit.text ?? "").includes(term)) {
            if (!tally.has(term)) tally.set(term, { owner, anchors: [] });
            tally.get(term).anchors.push(unit.anchor);
          }
        }
      }
      return tally;
    };
    const firstHalf = count(inFile.slice(0, half));
    const secondHalf = count(inFile.slice(half));
    for (const [term, entry] of firstHalf) {
      if (secondHalf.has(entry.owner) && !secondHalf.has(term)) {
        // The person was called `owner` early and something else later.
        const later = secondHalf.get(entry.owner);
        shiftIndex += 1;
        const claim = makeClaim(
          `relations.address_shift.${shiftIndex}`,
          `称呼变化：${entry.owner} → ${term}`,
          `Address shift: ${entry.owner} → ${term}`,
          {
            from: entry.owner,
            to: term,
            file,
            before: entry.anchors.length,
            after: later.anchors.length,
          },
          [...entry.anchors, ...later.anchors],
          entry.anchors.length + later.anchors.length,
        );
        if (claim) claims.push(claim);
      }
    }

    // The common case is the reverse spelling: the *later* half uses a variant
    // that never appears early. Report that as the shift as well.
    for (const [term, entry] of secondHalf) {
      if (!firstHalf.has(term) && !firstHalf.has(entry.owner)) continue;
      const earlierTerm = firstHalf.has(entry.owner) ? entry.owner : null;
      if (earlierTerm === null) continue;
      const already = claims.some((claim) => claim.id.startsWith("relations.address_shift.") && claim.value.to === term && claim.value.file === file);
      if (already) continue;
      shiftIndex += 1;
      const claim = makeClaim(
        `relations.address_shift.${shiftIndex}`,
        `称呼变化：${earlierTerm} → ${term}`,
        `Address shift: ${earlierTerm} → ${term}`,
        { from: earlierTerm, to: term, file, before: firstHalf.get(earlierTerm).anchors.length, after: entry.anchors.length },
        [...firstHalf.get(earlierTerm).anchors, ...entry.anchors],
        firstHalf.get(earlierTerm).anchors.length + entry.anchors.length,
      );
      if (claim) claims.push(claim);
    }
  }
  if (shiftIndex === 0 && units.length >= MIN.address) {
    notes.push(note("没有发现同一段对话中的称呼变化。", "No address-term change was found inside one conversation."));
  }

  return { claims: claims.filter(Boolean), notes };
}

/* ------------------------------------------------------------------ */
/* boundaries                                                          */
/* ------------------------------------------------------------------ */

/**
 * Refusals and deflections.
 *
 * Two rules, kept apart because they mean different things:
 *
 *   R1  the person declines a *topic*  ("先不说这个" / "这个不方便说")
 *   R3  the person declines *detail*   ("不太想细说")
 *
 * `value.probe` is the question that preceded the refusal — but only when it is
 * in the same session (within six hours). Without that gate the "probe" would
 * routinely point at something said days earlier, which is not a probe.
 */
const SESSION_GAP_MS = 6 * 60 * 60 * 1000;

const REFUSAL_RULES = [
  {
    rule: "R1_topic_deflection",
    // Tolerant of the infixes real speech inserts: 先不说 / 先不细说 / 这个不方便说.
    pattern: /(?:先不|不方便|不想|别)(?:多|细|再)?(?:说|讲|谈|聊)|(?:这个|那个)(?:我)?(?:不方便|不好)(?:说|讲)|换个话题|跳过/,
  },
  {
    rule: "R3_explicit_refusal",
    pattern: /不(?:太|怎么)?想(?:多|细|再)?(?:说|讲|谈)|(?:就|先)(?:这样|到这儿)|无可奉告/,
  },
];

export function deriveBoundaries(corpus, helpers) {
  const { units } = corpus;
  const { makeClaim, note, MIN } = helpers;
  const claims = [];
  const notes = [];

  let index = 0;
  for (const [position, unit] of units.entries()) {
    const text = String(unit.text ?? "");
    const matched = REFUSAL_RULES.filter((entry) => entry.pattern.test(text));
    if (matched.length === 0) continue;

    // The question this refusal answers, if it is close enough in time to be one.
    const previous = units[position - 1] ?? null;
    const sameSession =
      previous !== null &&
      previous.file === unit.file &&
      previous.at !== null &&
      unit.at !== null &&
      previous.at !== undefined &&
      unit.at !== undefined &&
      Math.abs(unit.at - previous.at) <= SESSION_GAP_MS;
    const probe = sameSession && PROBE_LIKE.test(String(previous.text ?? "")) ? previous.anchor : null;

    const excerpt = text.length > 80 ? `${text.slice(0, 79)}…` : text;
    const evidence = unique([...(probe === null ? [] : [probe]), unit.anchor]).sort();
    index += 1;
    const claim = makeClaim(
      `boundaries.candidate.${String(index).padStart(4, "0")}`,
      `回避候选 ${index}（${matched.map((entry) => entry.rule).join("+")}）`,
      `Deflection candidate ${index} (${matched.map((entry) => entry.rule).join("+")})`,
      {
        speaker: unit.speaker ?? null,
        deflection: matched.map((entry) => entry.pattern.exec(text)?.[0] ?? null).filter(Boolean),
        excerpt,
        probe,
        rules: matched.map((entry) => entry.rule),
      },
      evidence,
      evidence.length,
    );
    // A refusal is a *candidate*, never a conclusion: the rule fires on wording,
    // and wording alone cannot tell a boundary from an ordinary aside.
    if (claim) claims.push({ ...claim, confidence: "low" });
  }

  if (claims.length === 0) {
    const why = units.length < MIN.boundaries ? `语料只有 ${units.length} 条，低于 ${MIN.boundaries}` : "语料里没有出现回避用语";
    notes.push(note(`没有回避候选：${why}。`, `No deflection candidate: ${units.length < MIN.boundaries ? `only ${units.length} messages, below ${MIN.boundaries}` : "no refusal wording appeared"}.`));
  }
  return { claims, notes };
}

/* ------------------------------------------------------------------ */
/* shifts                                                              */
/* ------------------------------------------------------------------ */

/**
 * Tone/length jumps.
 *
 * A sliding window compares the messages just before a point with the messages
 * just after it; a point is a candidate when the relative change clears
 * `SHIFT_RELATIVE` **and** the absolute change clears `SHIFT_ABSOLUTE`. Two
 * thresholds because either alone produces noise: 40% of three characters is
 * nothing, and ten characters on a 200-character baseline is nothing either.
 */
export function deriveShifts(corpus, helpers) {
  const { units } = corpus;
  const { makeClaim, note, MIN, SHIFT_WINDOW_RATIO, SHIFT_WINDOW_MIN, SHIFT_WINDOW_MAX, SHIFT_RELATIVE, SHIFT_ABSOLUTE } = helpers;
  const claims = [];
  const notes = [];

  if (units.length < MIN.shifts) {
    notes.push(note(`突变点样本不足：${units.length} < ${MIN.shifts}。`, `Not enough messages for shifts: ${units.length} < ${MIN.shifts}.`));
    return { claims, notes };
  }

  const window = Math.min(SHIFT_WINDOW_MAX, Math.max(SHIFT_WINDOW_MIN, Math.round(units.length * SHIFT_WINDOW_RATIO)));
  const lengths = units.map((unit) => countChars(unit.text));
  const candidates = [];

  for (let index = window; index <= units.length - window; index += 1) {
    const before = lengths.slice(index - window, index);
    const after = lengths.slice(index, index + window);
    const meanBefore = mean(before);
    const meanAfter = mean(after);
    if (meanBefore === null || meanAfter === null || meanBefore === 0) continue;
    const relative = Math.abs(meanAfter - meanBefore) / meanBefore;
    const absolute = Math.abs(meanAfter - meanBefore);
    if (relative < SHIFT_RELATIVE || absolute < SHIFT_ABSOLUTE) continue;
    candidates.push({ index, meanBefore, meanAfter, relative, absolute });
  }

  // Keep the strongest candidate per neighbourhood so one long stretch does not
  // report the same jump at every offset.
  const kept = [];
  for (const candidate of candidates.sort((left, right) => right.relative - left.relative)) {
    if (kept.some((other) => Math.abs(other.index - candidate.index) < window)) continue;
    kept.push(candidate);
  }

  kept.sort((left, right) => left.index - right.index);
  kept.slice(0, 6).forEach((candidate, order) => {
    const before = units.slice(candidate.index - window, candidate.index);
    const after = units.slice(candidate.index, candidate.index + window);
    const speakersBefore = unique(before.flatMap((unit) => unit.speakers ?? []));
    const speakersAfter = unique(after.flatMap((unit) => unit.speakers ?? []));
    const mixes = speakersBefore.length > 1 || speakersAfter.length > 1;
    const claim = makeClaim(
      `shifts.candidate.${order + 1}`,
      `突变候选 ${order + 1}（消息长度）`,
      `Shift candidate ${order + 1} (message length)`,
      {
        metric: "mean_chars",
        at: units[candidate.index].anchor,
        at_time: units[candidate.index].at === null ? null : new Date(units[candidate.index].at).toISOString(),
        before: candidate.meanBefore,
        after: candidate.meanAfter,
        relative_change: round(candidate.relative),
        absolute_change: round(candidate.absolute),
        window,
        // Whether the windows mix speakers: a jump measured across a change of
        // who is talking says more about the participants than the mood.
        pooled: mixes,
        mixes_speakers: mixes,
        speakers_before: speakersBefore,
        speakers_after: speakersAfter,
      },
      [...before.slice(-3).map((unit) => unit.anchor), ...after.slice(0, 3).map((unit) => unit.anchor)],
      before.length + after.length,
      units.map((unit) => unit.anchor),
    );
    if (claim) claims.push(claim);
  });

  if (claims.length === 0) {
    notes.push(note("没有超过双阈值的长度突变。", "No length jump cleared both shift thresholds."));
  }
  return { claims, notes };
}

/* ------------------------------------------------------------------ */
/* conflicts                                                           */
/* ------------------------------------------------------------------ */

/**
 * Stance contradictions, on two dimensions.
 *
 *   sentiment  how the person feels about something (挺好 / 很烦)
 *   certainty  how sure they are (保证 / 可能还要再看)
 *
 * A pair qualifies only when both messages talk about the **same thing** — the
 * shared substring is what makes it a contradiction rather than two unrelated
 * opinions — and the two values sit on opposite sides. `same_speaker` separates
 * "changed their mind" from "disagrees with someone", which are different
 * findings and are reported as such.
 */
const SENTIMENT = {
  positive: ["挺好", "不错", "没问题", "挺好的", "可以", "靠谱", "顺利", "满意", "支持"],
  negative: ["很烦", "不行", "糟糕", "问题很大", "麻烦", "担心", "反对", "拖累", "不靠谱"],
};
const CERTAINTY = {
  sure: ["保证", "一定", "肯定", "确定", "必然", "绝对", "不会再"],
  unsure: ["可能", "也许", "大概", "估计", "不确定", "再看", "说不准", "还要再"],
};

const polarityOf = (text, lexicon) => {
  let score = 0;
  for (const word of lexicon.positive ?? lexicon.sure ?? []) if (text.includes(word)) score += 1;
  for (const word of lexicon.negative ?? lexicon.unsure ?? []) if (text.includes(word)) score -= 1;
  return score === 0 ? 0 : Math.sign(score);
};

/** Longest shared run of non-punctuation characters, capped so it stays a topic. */
function sharedTopic(left, right) {
  const a = String(left ?? "").replace(/[\s，。！？、；：""''（）《》…—,.!?;:()"']/g, "");
  const b = String(right ?? "").replace(/[\s，。！？、；：""''（）《》…—,.!?;:()"']/g, "");
  let best = "";
  for (let start = 0; start < a.length; start += 1) {
    for (let end = start + best.length + 1; end <= a.length; end += 1) {
      const piece = a.slice(start, end);
      if (!b.includes(piece)) break;
      if (piece.length > best.length) best = piece;
    }
  }
  return best.length >= 2 && best.length <= 8 ? best : null;
}

export function deriveConflicts(corpus, helpers) {
  const { units } = corpus;
  const { makeClaim, note, MIN } = helpers;
  const claims = [];
  const notes = [];

  if (units.length < MIN.conflicts) {
    notes.push(note(`矛盾样本不足：${units.length} < ${MIN.conflicts}。`, `Not enough messages for conflicts: ${units.length} < ${MIN.conflicts}.`));
    return { claims, notes };
  }

  const found = [];
  const seen = new Set();
  for (let left = 0; left < units.length; left += 1) {
    for (let right = left + 1; right < units.length; right += 1) {
      const a = units[left];
      const b = units[right];
      const topic = sharedTopic(a.text, b.text);
      if (topic === null) continue;
      for (const [dimension, lexicon, positiveKey, negativeKey] of [
        ["sentiment", SENTIMENT, "positive", "negative"],
        ["certainty", CERTAINTY, "sure", "unsure"],
      ]) {
        const polarityA = polarityOf(a.text, lexicon);
        const polarityB = polarityOf(b.text, lexicon);
        if (polarityA === 0 || polarityB === 0 || polarityA === polarityB) continue;
        const positive = polarityA > 0 ? a : b;
        const negative = polarityA > 0 ? b : a;
        const key = `${dimension}:${topic}:${positive.anchor}:${negative.anchor}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({
          dimension,
          topic,
          sameSpeaker: a.speaker !== null && a.speaker === b.speaker,
          positive,
          negative,
          lexiconKeys: [positiveKey, negativeKey],
        });
      }
    }
  }

  found.sort((left, right) => left.dimension.localeCompare(right.dimension) || left.topic.localeCompare(right.topic) || left.positive.anchor.localeCompare(right.positive.anchor));

  // One claim per (dimension, topic, same/different speaker): the point is the
  // contradiction, not how many sentence pairs happen to express it.
  const grouped = new Map();
  for (const entry of found) {
    const key = `${entry.dimension}|${entry.topic}|${entry.sameSpeaker}`;
    if (!grouped.has(key)) grouped.set(key, entry);
  }

  let index = 0;
  for (const entry of [...grouped.values()].slice(0, 12)) {
    index += 1;
    const claim = makeClaim(
      `conflicts.candidate.${String(index).padStart(4, "0")}`,
      `矛盾候选 ${index}（${entry.dimension}）`,
      `Contradiction candidate ${index} (${entry.dimension})`,
      {
        dimension: entry.dimension,
        topic: entry.topic,
        same_speaker: entry.sameSpeaker,
        speaker: entry.sameSpeaker ? entry.positive.speaker : null,
        speakers: unique([entry.positive.speaker, entry.negative.speaker].filter((name) => name !== null)),
        positive: { anchor: entry.positive.anchor, text: String(entry.positive.text).slice(0, 60) },
        negative: { anchor: entry.negative.anchor, text: String(entry.negative.text).slice(0, 60) },
      },
      [entry.positive.anchor, entry.negative.anchor],
      2,
    );
    if (claim) claims.push({ ...claim, confidence: "low" });
  }

  if (claims.length === 0) {
    notes.push(note("没有发现同一话题上的立场对立。", "No opposing stance on a shared topic was found."));
  }
  return { claims, notes };
}
