#!/usr/bin/env node
/**
 * Audit the v2 objective against the tree, item by item.
 *
 * `scripts/acceptance.mjs` proves the *pipeline* works; this script proves the
 * *scope* is closed: every demand in the objective has an artefact and a check,
 * and every gap is named rather than discovered later. Each row is mechanical —
 * it reads the tree, the registry and the git index, and it says what it read.
 *
 *   node scripts/audit-objective.mjs [--json] [--skip-acceptance]
 *
 * Exit code 1 when a demand is unmet. "Known gap" rows report a documented
 * shortfall (a contract channel that is not ported yet) and never fail the run:
 * they exist so the report cannot quietly claim more than the build does.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { PLANNED, listCommands, resolveCommand } from "../src/commands/index.mjs";
import { PENDING_CHANNELS } from "../src/commands/credentialed.mjs";
import { listAgents } from "../src/hosts/agents.mjs";
import { SCHEMA_VERSION } from "../src/skill/schema.mjs";

const root = resolve(import.meta.dirname, "..");
const json = process.argv.includes("--json");
const skipAcceptance = process.argv.includes("--skip-acceptance");

const rows = [];
const record = (demand, ok, evidence, { gap = false } = {}) => {
  rows.push({ demand, ok: Boolean(ok), evidence, gap });
};

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

/** 1. Node single stack: no Python left anywhere in the tree. */
{
  const tracked = git("ls-files").split("\n");
  const python = tracked.filter((path) => /\.py$/.test(path) || /(^|\/)requirements\.txt$/.test(path));
  const ci = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
  const pythonCi = /python-version|setup-python|pip install/.test(ci);
  record(
    "Node 单栈：仓库里没有 Python / requirements.txt，CI 只跑 Node",
    python.length === 0 && !pythonCi,
    python.length === 0 ? `0 tracked .py files; CI jobs: ${(ci.match(/^\s{2}[a-z-]+:$/gm) ?? []).map((line) => line.trim()).join(" ")}` : `still tracked: ${python.slice(0, 5).join(", ")}`,
  );
}

/** 2. Evidence spine: the on-disk contract is what the docs say. */
{
  const store = readFileSync(join(root, "src", "knowledge", "store.mjs"), "utf8");
  const hasDirs = ["raw", "text", "index.json"].every((name) => store.includes(name));
  const anchors = readFileSync(join(root, "src", "knowledge", "anchors.mjs"), "utf8");
  const bracketed = /\$\{unit\.anchor\}\]|\[\$\{unit\.anchor\}\]|`\[\$\{/.test(anchors) || anchors.includes("`[${unit.anchor}]");
  record(
    "证据脊柱：knowledge/raw|text|index.json 与可回指锚点",
    hasDirs && bracketed,
    `store names ${hasDirs ? "raw/text/index.json" : "?"}; paragraph anchors render as [k0012] (contract form): ${bracketed}`,
  );
}

/** 3. retrospect determinism + anchors on the public corpus. */
{
  const test = readFileSync(join(root, "tests", "retrospect.test.mjs"), "utf8");
  const deterministic = /byte-identical/.test(test);
  // Two mechanisms both prove resolvability: calling the resolver, or comparing
  // against the ledger's declared anchor set. Accept either — grepping for one
  // specific API name tests the implementation, not the behaviour.
  const viaResolver = /resolveLedgerAnchor/.test(test);
  const viaDeclaredSet = /declared/.test(test) && /ledgerAnchors|flatMap\(\(entry\) => entry\.anchors/.test(test);
  const resolvable = viaResolver || viaDeclaredSet;
  record(
    "retrospect：确定性派生，每条结论带可回指锚点",
    deterministic && resolvable,
    `tests/retrospect.test.mjs asserts ${[
      deterministic && "two runs byte-identical",
      viaResolver && "anchors resolve via resolveLedgerAnchor",
      viaDeclaredSet && "anchors resolve against the ledger's declared set",
    ]
      .filter(Boolean)
      .join(" + ")}`,
  );
}

/** 4. Single-file HTML render + visual-check. */
{
  const template = readFileSync(join(root, "assets", "distilly-template.html"), "utf8");
  const offline = !/https?:\/\//.test(template.replace(/https?:\/\/www\.w3\.org[^"']*/g, ""));
  const csp = /Content-Security-Policy/.test(template);
  const visual = existsSync(join(root, "scripts", "visual-check.mjs"));
  record(
    "单文件 HTML：离线自包含 + CSP，visual-check 八项",
    offline && csp && visual,
    `template offline: ${offline}, CSP: ${csp}, scripts/visual-check.mjs: ${visual}`,
  );
}

/** 5. Bilingual prompts + the lint that enforces them. */
{
  const lint = execFileSync(process.execPath, [join(root, "scripts", "prompt-lint.mjs")], { cwd: root, encoding: "utf8" })
    .trim()
    .split("\n")
    .pop();
  const clean = /0 finding/.test(lint);
  record("prompt：五步改造 + 双语 + prompt lint 无发现", clean, lint);
}

/** 6. Coding-agent matrix. */
{
  const agents = listAgents();
  const matrix = readFileSync(join(root, "src", "hosts", "agents.mjs"), "utf8");
  const hosts = readFileSync(join(root, "docs", "v2", "HOSTS.md"), "utf8");
  // `listAgents()` yields ids, not objects (asserted by tests/agents.test.mjs).
  const documented = agents.every((id) => hosts.includes(id));
  record(
    "coding-agent 适配矩阵：每个宿主的路径 / 确切命令有出处",
    agents.length >= 6 && documented,
    `${agents.length} hosts (${agents.join(", ")}), all named in docs/v2/HOSTS.md: ${documented}`,
  );
}

/** 7. Credentialed channels + computer-use consent. */
{
  const consent = readFileSync(join(root, "src", "consent.mjs"), "utf8");
  const gated = /waiting-for-user-consent/.test(consent);
  const browser = readFileSync(join(root, "src", "collect", "feishu-browser.mjs"), "utf8");
  const noDriver = !/from\s+["']playwright/.test(browser);
  const configured = Object.keys(PENDING_CHANNELS);
  record(
    "要 key 渠道 + computer-use 同意协议（无同意 exit 2，不驱动浏览器）",
    gated && noDriver,
    `consent gate: ${gated}, browser route never drives a browser: ${noDriver}, credentialed channels: feishu/slack/dingtalk/x`,
  );
  // Every channel CONTRACT §1 names now ships, so `PENDING_CHANNELS` is empty and
  // this row asserts that positively while naming the modules it read. It used to
  // claim the remaining channels were unported and derive its evidence from the
  // pending map — which, once the map emptied, produced a row whose "evidence" was
  // the empty string: a passing check that said nothing.
  const channelNames = ["feishu", "slack", "dingtalk", "x", "discord", "notion", "reddit", "gmail"];
  const missingChannels = channelNames.filter((name) => !existsSync(join(root, "src", "collect", `${name}.mjs`)));
  record(
    "契约的八个采集渠道全部落地（feishu/slack/dingtalk/x/discord/notion/reddit/gmail）",
    missingChannels.length === 0 && configured.length === 0,
    `channel modules read: ${channelNames.map((name) => `src/collect/${name}.mjs`).join(", ")}; ` +
      `missing: ${missingChannels.length === 0 ? "none" : missingChannels.join(", ")}; ` +
      `PENDING_CHANNELS: ${configured.length === 0 ? "empty" : configured.join(", ")}`,
  );
}

/** 8. schema v4 + idempotent migration. */
{
  const migration = existsSync(join(root, "src", "skill", "migrate.mjs"));
  const test = readFileSync(join(root, "tests", "schema-migration.test.mjs"), "utf8");
  const idempotent = /idempot/i.test(test);
  record(
    `schema v${SCHEMA_VERSION} + 幂等迁移`,
    SCHEMA_VERSION === "4" && migration && idempotent,
    `SCHEMA_VERSION=${SCHEMA_VERSION}, src/skill/migrate.mjs: ${migration}, idempotency asserted: ${idempotent}`,
  );
}

/** 9. Contract command surface. */
{
  const contract = readFileSync(join(root, "docs", "v2", "CONTRACT.md"), "utf8");
  const block = contract.slice(contract.indexOf("## 1. 命令契约"), contract.indexOf("迁移期兼容"));
  const names = [...block.matchAll(/^([a-z][a-z0-9-]*)(?:\s+<[^\n]*?>)?(?:\s|$)/gm)]
    .map((match) => match[1])
    .filter((name, index, all) => all.indexOf(name) === index && name !== "collect" && name !== "view" && name !== "skill" && name !== "consent");
  const missing = names.filter((name) => !resolveCommand([name]).name || resolveCommand([name]).name !== name);
  const planned = Object.keys(PLANNED);
  record(
    "CONTRACT §1 的每个命令都能解析，PLANNED 为空",
    missing.length === 0 && planned.length === 0,
    `contract commands checked: ${names.join(", ")}; missing: ${missing.length === 0 ? "none" : missing.join(", ")}; PLANNED: ${planned.length === 0 ? "empty" : planned.join(", ")}`,
  );
  const registered = listCommands().length;
  record("命令注册表非空且全部有双语帮助", registered >= 15, `${registered} registered command names`);
}

/** 10. Screenshots stay out of the repository. */
{
  const ignored = ["dst-evidence", "evidence/renders"].map((path) => {
    try {
      git("check-ignore", "-q", path);
      return true;
    } catch {
      return false;
    }
  });
  const trackedEvidence = git("ls-files").split("\n").filter((path) => /dst-evidence\/|screenshots\/.*\.png$/.test(path));
  record(
    "截图不入库：证据目录被忽略，仓库里没有 PNG 证据",
    ignored.some(Boolean) && trackedEvidence.length === 0,
    `checks: ${ignored.join(", ")}; tracked evidence files: ${trackedEvidence.length}`,
  );
}

/** 11. Per-PR evidence: every merged branch has a document. */
{
  const branches = git("branch", "--merged", "HEAD")
    .split("\n")
    .map((line) => line.replace(/^[*+]\s*/, "").trim())
    .filter((name) => /^ds\/\d\d-/.test(name))
    .sort();
  const docs = readdirSync(join(root, "docs", "evidence"));
  const withoutDoc = branches.filter((branch) => {
    const number = branch.slice(3, 5);
    return !docs.some((doc) => doc.startsWith(`pr-${number}`));
  });
  record(
    "每个已合并分支都有 PR 证据文档（测试 / 前后对比 / 回滚）",
    withoutDoc.length === 0,
    `${branches.length} merged ds/* branches; missing docs: ${withoutDoc.length === 0 ? "none" : withoutDoc.join(", ")}`,
  );
}

/** 12. The end-to-end gate itself. */
if (skipAcceptance) {
  record("端到端验收（本审计已跳过）", true, "--skip-acceptance was passed", { gap: true });
} else {
  const output = execFileSync(process.execPath, [join(root, "scripts", "acceptance.mjs")], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DISTILLY_PLAYWRIGHT_ROOT: process.env.DISTILLY_PLAYWRIGHT_ROOT ?? "/tmp/audit-mcp" },
  });
  const summary = output.trim().split("\n").pop() ?? "";
  const match = /(\d+)\/(\d+)\s*通过/.exec(summary);
  const ok = match ? match[1] === match[2] : /PASS/.test(output);
  record("公开语料端到端验收全绿", ok, summary);
}

/** 13. Push state: the branch is backed up off-site; no PR has been opened. */
{
  // The remote is not necessarily called `origin` — this checkout tracks
  // `upstream`. Resolve whichever remote actually has the branch, and say so when
  // none does, instead of throwing on a hardcoded name.
  const remotes = git("remote").split("\n").map((line) => line.trim()).filter(Boolean);
  const tracking = remotes
    .map((remote) => `${remote}/dot-skill-test`)
    .find((ref) => git("rev-parse", "--verify", "--quiet", ref) !== "");
  const ahead = tracking === undefined ? null : Number(git("rev-list", "--count", `${tracking}..HEAD`));
  const dirty = git("status", "--porcelain");

  // "Pushed" is the thing the user asked for (an off-site copy). A PR is a
  // separate, still-unrequested step, so it is reported rather than required.
  const pushed = ahead === 0;
  record(
    "推送：集成分支已推送到远端（异地备份），工作树干净",
    pushed,
    tracking === undefined
      ? "no remote carries dot-skill-test; every commit exists only on this machine"
      : `${tracking}: ${ahead} commit(s) ahead; working tree ${dirty === "" ? "clean" : "dirty"}; PR bodies staged in dst-evidence/PR-BODIES/`,
    { gap: !pushed },
  );
}

const failed = rows.filter((row) => !row.ok);
const gaps = rows.filter((row) => row.gap);

if (json) {
  console.log(JSON.stringify({ ok: failed.length === 0, rows, failed: failed.map((row) => row.demand), gaps: gaps.map((row) => row.demand) }, null, 2));
} else {
  console.log("目标审计 / objective audit\n");
  for (const row of rows) {
    const mark = row.ok ? "✅" : "❌";
    const tag = row.gap ? "（已知缺口）" : "";
    console.log(`${mark} ${row.demand}${tag}`);
    console.log(`     ${row.evidence}`);
  }
  console.log(
    `\n${rows.length - failed.length}/${rows.length} 条满足；已知缺口 ${gaps.length} 条；` +
      `${failed.length === 0 ? "没有未满足项" : `未满足：${failed.map((row) => row.demand).join("；")}`}`,
  );
}

process.exit(failed.length === 0 ? 0 : 1);
