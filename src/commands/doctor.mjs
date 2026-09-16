/**
 * `distilly doctor` — inventory health check (minimal, honest version).
 *
 * Checks what is actually on disk:
 *   1. every host in the shared matrix: is Distilly installed there, at which
 *      version, and does the directory look like a Distilly install;
 *   2. generated Skills under `skills/<family>/<slug>` (version, corrections);
 *   3. ledger coverage whenever `knowledge/index.json` exists;
 *   4. capabilities this build cannot run yet are listed in `unavailable`
 *      (CONTRACT §3: nothing is silently skipped).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { register, PLANNED } from "./index.mjs";
import { createReceipt, describeFile, displayPath } from "../cli/receipt.mjs";
import { parseArgs } from "../cli/args.mjs";
import { listAgents } from "../hosts/agents.mjs";
import { inspectInstall, repoInstallDir } from "../install/hosts.mjs";
import { resolveSkillsRoot } from "../cli/paths.mjs";
import { parseAnchor } from "../knowledge/anchors.mjs";
import { CHARACTER_PRESETS } from "../skill/presets.mjs";
import { listSkills } from "../skill/writer.mjs";

function doctorHelp(binary = "distilly") {
  const zh = [
    "用法：",
    `  ${binary} doctor [--base-dir <dir>] [--json]`,
    "",
    "检查项（最小版）：",
    "  1. 宿主矩阵里每个宿主是否已安装 Distilly（路径、SKILL.md 版本）；",
    "  2. 生成的 Skill 清单（skills/<family>/<slug>，含版本与 corrections）；",
    "  3. 账本覆盖率：有 knowledge/index.json 时统计条目与字节数；",
    "  4. 未实现能力（parse/view/collect 等）写进回执的 unavailable，不静默跳过。",
  ].join("\n");
  const en = [
    "Usage:",
    `  ${binary} doctor [--base-dir <dir>] [--json]`,
    "",
    "Checks (minimal):",
    "  1. whether Distilly is installed for each host in the shared matrix (path, SKILL.md version);",
    "  2. the generated Skill inventory (skills/<family>/<slug> with version and corrections);",
    "  3. ledger coverage: entry and byte counts whenever knowledge/index.json exists;",
    "  4. capabilities this build cannot run yet (parse/view/collect …) are reported in the receipt's unavailable list, never skipped silently.",
  ].join("\n");
  return { zh, en };
}

const OPTIONS = {
  "base-dir": { type: "string", value: "dir" },
  // Opt-in: make a corpus-shape FAIL affect `ok` and the exit code. The shape verdict
  // is always *reported*; it only becomes a gate when the caller says so, because
  // reading a corpus that cannot carry a person is a legitimate thing to do while
  // collecting more material.
  "require-shape": { type: "boolean" },
};

/**
 * Every anchor string an `evidence/derived/*.json` file cites.
 *
 * The derived layer is prose-plus-claims: a claim carries `evidence: ["k0001"]`,
 * a boundary carries anchors too. Walking the JSON for `k00NN`-shaped strings
 * finds them all without coupling to one schema, which is what "doctor checks
 * what is on disk" means here.
 */
function citedAnchors(skillDir) {
  const derivedDir = join(skillDir, "evidence", "derived");
  if (!existsSync(derivedDir)) return [];
  const found = new Set();
  const walk = (value) => {
    if (typeof value === "string") {
      if (parseAnchor(value)) found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };
  for (const name of readdirSync(derivedDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      walk(JSON.parse(readFileSync(join(derivedDir, name), "utf8")));
    } catch {
      // A malformed derived file is reported by `view check`, not here.
    }
  }
  return [...found];
}

/**
 * Every anchor string the **deliverable** cites — the generated Skill and the page.
 *
 * `citedAnchors` above walks `evidence/derived/` only, which is the intermediate
 * layer nobody reads. What this product ships is `SKILL.md` / `work.md` /
 * `persona.md` / `work_skill.md` / `persona_skill.md` (and the rendered view). A
 * Skill whose every rule cites evidence used to contribute **zero** to the `cited`
 * figure, so the number described the middle of the pipeline while the artifact at
 * the end of it went unexamined.
 */
function deliveredAnchors(skillDir) {
  const found = new Set();
  const collect = (text) => {
    for (const match of String(text).matchAll(/\[(k\d{4}(?::t\d+)?)\]/g)) found.add(match[1]);
  };
  for (const name of ["SKILL.md", "work.md", "persona.md", "work_skill.md", "persona_skill.md"]) {
    const path = join(skillDir, name);
    if (existsSync(path)) collect(readFileSync(path, "utf8"));
  }
  const viewsDir = join(skillDir, "views");
  if (existsSync(viewsDir)) {
    for (const name of readdirSync(viewsDir)) {
      if (name.endsWith(".view.json")) collect(readFileSync(join(viewsDir, name), "utf8"));
    }
  }
  return found;
}

/** Every anchor a skill's ledger knows about, so a citation can be checked. */
function resolvedAnchors(skillDir) {
  const ledgerPath = join(skillDir, "knowledge", "index.json");
  if (!existsSync(ledgerPath)) return new Set();
  let entries = [];
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
    entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
  } catch {
    return new Set();
  }
  const known = new Set();
  for (const entry of entries) {
    for (const anchor of entry?.anchors ?? []) {
      const id = typeof anchor === "string" ? anchor : anchor?.anchor ?? anchor?.id;
      if (id) known.add(id);
    }
    for (const detail of entry?.anchor_detail ?? []) {
      const id = detail?.anchor ?? detail?.id;
      if (id) known.add(id);
    }
  }
  return known;
}

/**
 * A pre-flight read on the **corpus shape**: is this material able to carry a
 * person at all?
 *
 * Nothing in the pipeline asked that question before Step 4, and the failure is not
 * hypothetical — a 47-minute multi-speaker floor proceeding was run through the whole
 * five-step mainline, producing a portrait of a room instead of a person, because the
 * only judge of "is this the right material" was the model's own judgement at the end.
 * The numbers here come from what `retrospect` already derived, so this is a reading,
 * not a second derivation:
 *
 *  - `units`     anchors the ledger records (how much material there is);
 *  - `speakers`  distinct speakers the voice derivation could attribute units to;
 *  - `top_share` the busiest speaker's share of the attributed units.
 *
 * Verdict rules, deliberately blunt and stated in the receipt:
 *  - fewer than 20 citable units → FAIL (nothing to be a person *from*);
 *  - two or more speakers but under 40% of units attributable, or no speaker with at
 *    least 20% → FAIL (a meeting, not a person: ask for that person's own material);
 *  - one or no speaker labels → PASS with a note (a single-voice source is legitimate;
 *    absence of labels is not evidence of a crowd).
 */
function corpusShape(skillDir, ledger) {
  const reasons = [];
  const notes = [];
  const units = ledger.anchors;
  const voicePath = join(skillDir, "evidence", "derived", "voice.json");
  let bySpeaker = null;
  if (existsSync(voicePath)) {
    try {
      const voice = JSON.parse(readFileSync(voicePath, "utf8"));
      const claim = (voice.claims ?? []).find((item) => item?.id === "voice.sentence_length");
      bySpeaker = claim?.value?.by_speaker ?? null;
    } catch {
      bySpeaker = null;
    }
  }
  const speakers = bySpeaker ? Object.keys(bySpeaker) : [];
  const attributed = bySpeaker ? Object.values(bySpeaker).reduce((total, item) => total + (item?.samples ?? 0), 0) : 0;
  const top = bySpeaker
    ? Object.entries(bySpeaker).sort(([, a], [, b]) => (b?.samples ?? 0) - (a?.samples ?? 0))[0]
    : null;
  const topShare = top && attributed > 0 ? (top[1]?.samples ?? 0) / attributed : null;

  if (units < 20) reasons.push(`可引用单元只有 ${units} 个，低于 20：材料量不足以支撑一个人物画像`);
  if (speakers.length >= 2) {
    const share = units > 0 ? attributed / units : 0;
    if (share < 0.4) {
      reasons.push(
        `这是多人材料，但只有 ${(share * 100).toFixed(0)}% 的单元能归到某个说话人（阈值 40%）：` +
          "先补这个人自己的一手产出（本人访谈/演讲字幕、本人文章），不要从会议流水里切人",
      );
    }
    if (topShare !== null && topShare < 0.2) {
      reasons.push(`最活跃的说话人只占已归属单元的 ${(topShare * 100).toFixed(0)}%（阈值 20%）：没有哪个人是这份材料的主角`);
    }
  } else if (speakers.length === 0) {
    notes.push("材料里没有说话人标注：按单一对象处理（对本人文章/邮件/单人口述是正常的）");
  } else {
    notes.push("只有一位说话人：按单一对象处理");
  }

  return {
    units,
    sources: ledger.entries,
    speakers: speakers.length,
    attributed_units: attributed,
    top_speaker: top ? top[0] : null,
    top_share: topShare === null ? null : Number(topShare.toFixed(4)),
    verdict: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
    notes,
  };
}

function readLedger(skillDir) {
  const ledgerPath = join(skillDir, "knowledge", "index.json");
  if (!existsSync(ledgerPath)) {
    return { path: ledgerPath, entries: 0, bytes: 0, anchors: 0, present: false };
  }
  const text = readFileSync(ledgerPath, "utf8");
  let entries = [];
  try {
    const parsed = JSON.parse(text);
    entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
  } catch {
    entries = [];
  }
  const anchors = entries.reduce((total, entry) => {
    const list = entry?.anchors;
    return total + (Array.isArray(list) ? list.length : 0);
  }, 0);
  return {
    path: ledgerPath,
    entries: entries.length,
    bytes: statSync(ledgerPath).size,
    anchors,
    present: true,
  };
}

register("doctor", {
  summary: "体检宿主与 Skill 库存 / Health-check hosts and skill inventory",
  usage: "distilly doctor [--base-dir <dir>] [--require-shape] [--json]",
  options: OPTIONS,
  ...doctorHelp(),
  run({ argv, reporter }) {
    const { flags } = parseArgs(argv, OPTIONS);
    const requireShape = Boolean(flags["require-shape"]);
    const warnings = [];
    const inputs = [];
    const outputs = [];

    reporter.line("Hosts / 宿主:");
    const hostRows = [];
    for (const id of listAgents()) {
      const target = repoInstallDir(id);
      const state = inspectInstall(target);
      hostRows.push({ host: id, path: displayPath(target), installed: state.installed, version: state.version });
      reporter.line(
        `  ${state.installed ? "installed" : "missing  "}  ${id.padEnd(18)} ${displayPath(target)}${state.version ? `  (v${state.version})` : ""}`,
      );
      if (state.installed) {
        const described = describeFile(join(target, "SKILL.md"));
        if (described) inputs.push(described);
      }
    }

    reporter.line("");
    reporter.line("Skills / 人物 Skill:");
    const familyBase = flags["base-dir"];
    let skillCount = 0;
    const shapes = [];
    let anchorTotal = 0;
    let citedTotal = 0;
    const dangling = [];
    for (const [family, preset] of Object.entries(CHARACTER_PRESETS)) {
      if (preset.character !== family) continue;
      // One resolver for all three `--base-dir` spellings: a bare directory must
      // not be read as if a `skills/` level were underneath it.
      // `--base-dir <...>/skills/colleague` names ONE family's storage root. The
      // other families must not read the same directory again — doing so counted
      // the same skill three times over ("inspected once, not once per family").
      if (familyBase && Object.hasOwn(CHARACTER_PRESETS, basename(familyBase)) && basename(familyBase) !== family) {
        continue;
      }
      const resolved = familyBase
        ? resolveSkillsRoot({ baseDir: familyBase, family })
        : { root: preset.storage_root ?? preset.legacy_storage_root, warning: null };
      if (resolved.warning && !warnings.includes(resolved.warning)) warnings.push(resolved.warning);
      const baseDir = resolved.root;
      // The corpus check is a **pre-flight** reading: it has to fire before Step 4 has
      // produced a `SKILL.md`, so it walks every person directory that has a ledger
      // rather than only the finished Skills `listSkills` returns. (Enumerating
      // finished Skills made the check silently inapplicable in exactly the situation
      // it exists for — right after Collect, before Distill.)
      if (existsSync(baseDir)) {
        for (const entry of readdirSync(baseDir).sort()) {
          const personDir = join(baseDir, entry);
          const ledgerPath = join(personDir, "knowledge", "index.json");
          if (!existsSync(ledgerPath)) continue;
          shapes.push({ slug: `${family}/${entry}`, ...corpusShape(personDir, readLedger(personDir)) });
        }
      }
      const skills = listSkills(baseDir);
      for (const skill of skills) {
        skillCount += 1;
        const skillDir = join(baseDir, skill.slug);
        const ledger = readLedger(skillDir);
        anchorTotal += ledger.anchors;
        // `cited` counts the citations that actually resolve; a dangling one is
        // reported in `warnings`, never folded into the number — "we cite two
        // anchors" and "one of the two is broken" are different claims.
        const known = resolvedAnchors(skillDir);
        // Both layers count now: the derived claims *and* what the generated Skill and
        // the page actually cite. A citation that does not resolve is a broken promise
        // — "every conclusion can be traced back" — so it is collected for the verdict
        // below, not only for a warning line.
        const citedInSkill = new Set([...citedAnchors(skillDir), ...deliveredAnchors(skillDir)]);
        for (const anchor of citedInSkill) {
          if (known.has(anchor)) citedTotal += 1;
          else dangling.push(`${family}/${skill.slug}: ${anchor}`);
        }
        reporter.line(
          `  ${family}/${skill.slug}  ${skill.version}  corrections=${skill.corrections_count}  ` +
            `knowledge=${ledger.present ? `${ledger.entries} entries / ${ledger.bytes} bytes` : "none"}`,
        );
        if (ledger.present) {
          const described = describeFile(ledger.path);
          if (described) outputs.push(described);
        }
        const skillFile = describeFile(join(skillDir, "SKILL.md"));
        if (skillFile) outputs.push(skillFile);
      }
    }
    if (skillCount === 0) {
      reporter.line("  none found (run `distilly skill create` first)");
      warnings.push("no generated skills found");
    }

    if (dangling.length > 0) {
      warnings.push(
        `${dangling.length} anchor(s) cited by evidence/derived cannot be resolved against knowledge/index.json: ` +
          dangling.join(", "),
      );
    }

    reporter.line("");
    reporter.line("Corpus shape / 语料体检:");
    if (shapes.length === 0) reporter.line("  （没有可检查的 Skill）");
    for (const shape of shapes) {
      reporter.line(
        `  ${shape.slug}  ${shape.verdict}  units=${shape.units} sources=${shape.sources} ` +
          `speakers=${shape.speakers} attributed=${shape.attributed_units}` +
          (shape.top_speaker ? ` top=${shape.top_speaker}(${((shape.top_share ?? 0) * 100).toFixed(0)}%)` : ""),
      );
      for (const reason of shape.reasons) reporter.line(`      ✗ ${reason}`);
      for (const note of shape.notes) reporter.line(`      · ${note}`);
    }

    const coverage = anchorTotal === 0 ? null : citedTotal / anchorTotal;
    reporter.line("");
    reporter.line(
      `Ledger coverage / 账本：${skillCount} skills, ${anchorTotal} anchors recorded, ${citedTotal} cited ` +
        `by derived evidence or the generated Skill` +
        (coverage === null ? "" : ` (${(coverage * 100).toFixed(0)}% of the ledger)`) +
        (dangling.length > 0 ? `, ${dangling.length} DANGLING` : ", 0 dangling"),
    );
    // The gate is **dangling = 0**, not a coverage percentage: a Skill is not obliged
    // to cite every cue in the corpus, but it is obliged to not cite evidence that
    // does not exist. Coverage stays in the receipt as information for a human.
    const shapeFailed = shapes.filter((shape) => shape.verdict === "FAIL");
    if (dangling.length > 0) {
      reporter.line("Verdict / 判定：FAIL —— 有引用回指不到账本，交付物在承诺它没有的证据");
    } else if (requireShape && shapeFailed.length > 0) {
      reporter.line("Verdict / 判定：FAIL —— 语料形状撑不起一个人（见上），先补材料再蒸馏");
    } else if (shapeFailed.length > 0) {
      reporter.line(
        `Verdict / 判定：PASS（引用完整）；但语料体检 FAIL（${shapeFailed.length} 个）——` +
          "加 --require-shape 会让它成为硬门槛",
      );
    } else {
      reporter.line(`Verdict / 判定：PASS —— 0 悬空引用${coverage === null ? "" : `；账本覆盖 ${(coverage * 100).toFixed(0)}%`}`);
    }

    const unavailable = Object.entries(PLANNED).map(([command, branch]) => ({
      channel: command,
      reason: `not implemented in this build; delivered by ${branch}`,
    }));
    reporter.line("");
    reporter.line(`Unavailable / 未实现：${unavailable.map((item) => item.channel).join(", ")}`);

    // `createReceipt` keeps exactly the eight contract fields, so anything command
    // specific has to be attached to the object afterwards.
    const receipt = createReceipt("doctor", {
      inputs,
      outputs,
      // `ok: false` when a citation cannot be followed back: the CLI derives its exit
      // code from this, so doctor now *fails* instead of printing a warning beside a
      // green `ok: true`. Coverage stays a number, not a verdict — see above.
      ok: dangling.length === 0 && (!requireShape || shapes.every((shape) => shape.verdict !== "FAIL")),
      anchors: { total: anchorTotal, cited: citedTotal, dangling: dangling.length },
      warnings,
      unavailable,
    });
    receipt.skills = skillCount;
    receipt.verdict =
      dangling.length > 0 || (requireShape && shapes.some((shape) => shape.verdict === "FAIL")) ? "FAIL" : "PASS";
    receipt.shape = shapes;
    // The host inventory belongs in the receipt too: it is the part of `doctor`
    // a caller most often wants to read programmatically (`--json` is the
    // machine interface), and it was reachable only through the internal `extra`.
    receipt.hosts = hostRows.map(({ host, installed, path }) => ({ host, installed, path }));
    return { receipt, extra: { hosts: hostRows, skills: skillCount } };
  },
});
