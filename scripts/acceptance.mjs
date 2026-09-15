#!/usr/bin/env node
/**
 * 端到端验收（机械部分）。见 docs/v2/ACCEPTANCE.md §5。
 *
 * 断言：回执形状 / 幂等 / 确定性 / 锚点回指 / 字节守恒 / 单文件离线 / visual-check 八项。
 * 任何一步的依赖命令还不存在时，**响亮失败**并指出缺哪个分支的产出，不静默跳过。
 *
 * usage:
 *   node scripts/acceptance.mjs [--corpus <dir>] [--person <slug>] [--keep] [--evidence <dir>]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
import { baselineSections, buildView } from './blind-test.mjs';
import { REQUIRED_ARTIFACTS, inspectSkillArtifacts } from './skill-artifacts.mjs';

const root = path.resolve(here, '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);

const corpus = path.resolve(arg('corpus', path.join(root, 'tests/fixtures/public-corpus/synthetic-interview')));
const person = arg('person', 'lin-gong');
const keep = has('keep');
const evidenceDir = path.resolve(arg('evidence', '/tmp/dst-evidence/pr-acceptance'));
const results = [];
let failed = 0;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function distilly(args, { allowMissing = false } = {}) {
  const res = spawnSync('node', [path.join(root, 'bin/distilly.mjs'), ...args], {
    cwd: workdir,
    encoding: 'utf8',
    env: { ...process.env, DISTILLY_HOME: path.join(workdir, '.distilly') },
  });
  if (res.status !== 0 && /unknown command|not implemented|Cannot find module/i.test(res.stderr || '')) {
    if (allowMissing) return { missing: true, stderr: res.stderr };
    throw new Error(`命令不可用：distilly ${args.join(' ')}\n${res.stderr?.slice(0, 400)}`);
  }
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function parseReceipt(out) {
  const start = out.indexOf('{');
  if (start === -1) return null;
  try {
    return JSON.parse(out.slice(start));
  } catch {
    return null;
  }
}

/**
 * A mechanical Distill: the `work.md` + `persona.md` the acceptance run feeds to
 * `skill create`.
 *
 * Acceptance cannot call a model, so the *content* is a fixture — but it is built
 * from the corpus's own units, each quoted with its anchor, so the artifact cites
 * real evidence instead of placeholders. The rows that use it check the part the
 * mechanical layer owns:
 *
 *  - `skill create` writes the documented artifact set;
 *  - the persona carries the Layer 0–5 structure `prompts/persona_builder.md` defines.
 *    Nothing checked this before, and the failure mode was real: a Skill whose
 *    Operating Rules promised "Layer 0 always wins" while its PART B contained no
 *    Layer 0 at all passed every gate, because nothing looked;
 *  - every anchor the artifact cites resolves in the ledger.
 *
 * Distillation *quality* is not this function's business — that is the effect layer
 * (`scripts/blind-test.mjs`) and it needs a judge, not a fixture.
 */
function distillFixture({ units, displayName }) {
  if (units.length === 0) throw new Error('交付物夹具需要至少一个锚点：knowledge/text 里没有段落锚点');
  const at = (index) => units[index % units.length];
  const line = (index) => {
    const unit = at(index);
    return `- ${unit.text.slice(0, 60)} [${unit.anchor}]`;
  };
  const short = (text) => (text.length > 24 ? `${text.slice(0, 24)}…` : text);

  const work = [
    '# Work（交付物夹具）',
    '',
    '> 由 scripts/acceptance.mjs 机械生成：每条都引用语料原文与锚点，用于验证 writer 与结构判据，不代表蒸馏质量。',
    '',
    '## 负责范围',
    line(0),
    line(1),
    '',
    '## 工作流程',
    line(2),
    line(3),
    '',
    '## 输出偏好',
    line(4),
    '',
    '## 经验知识',
    line(5),
    line(6),
    '',
  ].join('\n');

  const layer0 = ['## Layer 0：核心性格（最高优先级，任何情况下不得违背）'];
  for (const index of [0, 1]) {
    const unit = at(index);
    layer0.push(`- 当讨论到「${short(unit.text)}」时 → 以原文为准，不改写、不补充 [${unit.anchor}]`);
  }
  layer0.push('');

  const persona = [
    `# ${displayName} — Persona（交付物夹具）`,
    '',
    ...layer0,
    '## Layer 1：身份',
    line(2),
    '',
    '## Layer 2：表达风格',
    line(3),
    line(4),
    '',
    '## Layer 3：决策与判断',
    line(5),
    '',
    '## Layer 4：人际行为',
    line(6),
    '',
    '## Layer 5：边界与雷区',
    '（原材料不足，不推断）',
    '',
  ].join('\n');

  return { work, persona };
}

/** The `[k00NN] text` units of a normalised body, in file order. */
function unitsOf(body) {
  const units = [];
  for (const match of body.matchAll(/^\[(k\d{4}(?::t\d+)?)\]\s+(.*)$/gm)) {
    units.push({ anchor: match[1], text: match[2].trim() });
  }
  return units;
}

const workdir = await mkdtemp(path.join(tmpdir(), 'dst-acceptance-'));
await mkdir(evidenceDir, { recursive: true });

try {
  // 0. 准备一个 person 目录，把语料放进去
  const personDir = path.join(workdir, 'skills', 'colleague', person);
  await mkdir(personDir, { recursive: true });
  await cp(corpus, path.join(workdir, 'corpus'), { recursive: true });

  console.log(`验收语料：${path.relative(root, corpus)}  工作目录：${workdir}`);

  // 1. harvest（幂等）
  const h1 = distilly(['harvest', path.join(workdir, 'corpus'), '--person', person, '--json']);
  const r1 = parseReceipt(h1.stdout);
  record('harvest 退出码 0 且回执可解析', h1.status === 0 && !!r1, r1 ? `${r1.outputs?.length ?? 0} 个产物` : '无回执');
  record('回执形状（command/ok/inputs/outputs/sha256）',
    !!r1 && typeof r1.command === 'string' && typeof r1.ok === 'boolean' && Array.isArray(r1.inputs) && Array.isArray(r1.outputs)
      && r1.outputs.every((o) => typeof o.sha256 === 'string' && typeof o.bytes === 'number'));

  const ledgerPath = path.join(personDir, 'knowledge', 'index.json');
  const ledger1 = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const h2 = distilly(['harvest', path.join(workdir, 'corpus'), '--person', person, '--json']);
  const ledger2 = JSON.parse(await readFile(ledgerPath, 'utf8'));
  record('重复 harvest 幂等', h2.status === 0 && ledger1.length === ledger2.length,
    `${ledger1.length} → ${ledger2.length} 条账本记录`);

  const anchors = (ledger2.flatMap((e) => e.anchors ?? []));
  record('账本里有锚点且有正文', anchors.length > 0, `${anchors.length} 个锚点`);

  // 2. retrospect（确定性）
  const runRetrospect = () => {
    const r = distilly(['retrospect', '--person', person, '--json']);
    return { status: r.status, receipt: parseReceipt(r.stdout) };
  };
  const retro1 = runRetrospect();
  const derivedDir = path.join(personDir, 'evidence', 'derived');
  const hashDir = async (dir) => {
    const { readdir } = await import('node:fs/promises');
    const names = (await readdir(dir)).sort();
    const hashes = {};
    for (const n of names) hashes[n] = sha256(await readFile(path.join(dir, n)));
    return hashes;
  };
  const d1 = await hashDir(derivedDir);
  runRetrospect();
  const d2 = await hashDir(derivedDir);
  record('retrospect 两次产物字节相同', JSON.stringify(d1) === JSON.stringify(d2), Object.keys(d1).join(', '));

  const knownAnchors = new Set(anchors.map((a) => (typeof a === 'string' ? a : a.id)));
  let dangling = 0;
  for (const [name, text] of Object.entries(d1)) {
    const body = await readFile(path.join(derivedDir, name), 'utf8');
    for (const m of body.matchAll(/"(k\d{4}(?::t\d+)?)"/g)) if (!knownAnchors.has(m[1])) dangling += 1;
  }
  record('派生结论里的锚点全部可回指', dangling === 0, dangling ? `${dangling} 个悬空锚点` : '0 悬空');

  // 3. view check / render。
  //
  // 以前这里读 `expected/view.template.json` 再按序替换 `{{ANCHOR:n}}`。那份模板是
  // **契约之前**的形状（sections 叫 voice/work/relations，只有 6 段且顺序与契约不符），
  // 于是 `view check` 必然失败。改成用 `scripts/blind-test.mjs` 里那套已有的
  // 「按派生结论机械填段」的构造器：形状由 `REQUIRED_SECTIONS` 保证，引用的是真实锚点，
  // 派生不出来的段记成缺口而不是编造。
  const derived = {};
  for (const name of await (await import('node:fs/promises')).readdir(derivedDir)) {
    derived[name.replace(/\.json$/, '')] = JSON.parse(await readFile(path.join(derivedDir, name), 'utf8'));
  }
  const anchorIndex = new Map();
  for (const entry of ledger2) {
    const raw = entry.locations?.raw ?? null;
    for (const anchor of entry.anchors ?? []) {
      const id = typeof anchor === 'string' ? anchor : anchor.id;
      const base = id.split(':')[0];
      const detail = (entry.anchor_detail ?? []).find((d) => (d.anchor ?? d.id) === id) ?? {};
      if (!anchorIndex.has(base)) {
        // 形状与 `scripts/blind-test.mjs` 的锚点索引保持一致：`source` 取账本的
        // `kind`（subtitle / chat / doc …），`path` 指向归一化正文。原来这里取
        // `entry.source`，而账本根本没有这个字段 —— 于是每个条目都因
        // "evidence[].source is required" 报错，27 条一起红。
        anchorIndex.set(base, {
          id: entry.id ?? base,
          anchor: base,
          source: entry.kind ?? 'note',
          kind: entry.kind ?? 'note',
          path: `knowledge/${entry.locations?.text ?? 'index.json'}`,
          at: entry.fetched_at ?? null,
        });
      }
      void detail;
    }
  }
  const baseline = baselineSections({ claims: derived, anchors: anchorIndex });
  const view = buildView({ slug: person, sections: baseline.sections, evidence: baseline.evidence });
  const viewsDir = path.join(personDir, 'views');
  await mkdir(viewsDir, { recursive: true });
  await writeFile(path.join(viewsDir, `${person}.view.json`), `${JSON.stringify(view, null, 2)}\n`, 'utf8');
  // 七段**都必须在场**（页面顺序是契约的一部分），填不出来的段渲染成「本节证据不足」
  // 而不是被丢掉；缺口数量单独报出来，免得"7 段"这个数字掩盖了内容稀薄。
  record('view 由派生证据机械构造', baseline.sections.length === 7 && baseline.cited > 0,
    `${baseline.sections.length} 段 / ${baseline.cited} 个锚点 / 其中 ${baseline.gaps.length} 段记为缺口`);

  // `--allow-missing`：验收语料没有绝对时间戳，时间线一段必然是缺口。缺口要
  // 渲染成「本节证据不足」而不是被丢掉，所以这个开关是**声明**而非消音 ——
  // 引用不存在锚点之类的真错误仍然会让 check 失败。
  const check = distilly(['view', 'check', '--person', person, '--allow-missing', '--json']);
  record('view check 通过', check.status === 0, check.stderr.slice(0, 160));

  const render1 = distilly(['view', 'render', '--person', person, '--allow-missing', '--json']);
  const htmlPath = path.join(viewsDir, `${person}.html`);
  const html1 = await readFile(htmlPath);
  distilly(['view', 'render', '--person', person, '--allow-missing', '--json']);
  const html2 = await readFile(htmlPath);
  record('render 两次产物字节相同', sha256(html1) === sha256(html2), `${html1.length} bytes`);
  const html = html1.toString('utf8');
  record('产物单文件且无外链', !/https?:\/\//i.test(html.replace(/https?:\/\/www\.w3\.org[^"']*/g, '')), '');
  record('产物含 CSP', /Content-Security-Policy/i.test(html));

  // 4. visual-check（八项）
  const vcScript = path.join(root, 'scripts/visual-check.mjs');
  const vc = spawnSync('node', [vcScript, htmlPath, '--out', evidenceDir], { cwd: workdir, encoding: 'utf8' });
  // The hint that playwright is missing goes to **stderr**, so a row that quoted
  // only stdout went red with an empty reason — a gate nobody can act on.
  const vcDetail =
    (vc.stdout ?? '').trim().split('\n').slice(-3).join(' / ') ||
    (vc.stderr ?? '').trim().split('\n').slice(-2).join(' / ');
  if (/Cannot find module|ENOENT/.test(vc.stderr ?? '')) {
    record('visual-check 可用', false, 'scripts/visual-check.mjs 尚不存在（ds/03-render 的产出）');
  } else if (/DISTILLY_PLAYWRIGHT_ROOT/.test(vc.stderr ?? '')) {
    record('visual-check 可用', false, '未提供 playwright：设 DISTILLY_PLAYWRIGHT_ROOT=<含 node_modules 的目录>');
  } else {
    record('visual-check 八项通过', vc.status === 0, vcDetail);
  }

  // 5. 交付物：Distill 的最后一公里。
  //
  // 这一段以前不存在。验收的 12 项全部围绕 harvest → retrospect → view → render，
  // **没有一步碰 `skill create`**，于是 SKILL.md —— 这个产品真正交付的东西 —— 可以
  // 完全不存在而门禁全绿。加进来的判据是机械层能保证的部分：产物齐、六层结构在、
  // 每条规则都带能回指的锚点。内容由 distillFixture 从语料原文机械拼出。
  const textDir = path.join(personDir, 'knowledge', 'text');
  const bodies = await Promise.all(
    (await (await import('node:fs/promises')).readdir(textDir)).map((name) => readFile(path.join(textDir, name), 'utf8')),
  );
  const units = bodies.flatMap((body) => unitsOf(body));
  const fixture = distillFixture({ units, displayName: person });

  const fixturePaths = {
    work: path.join(workdir, '.acceptance-work.md'),
    persona: path.join(workdir, '.acceptance-persona.md'),
    meta: path.join(workdir, '.acceptance-meta.json'),
  };
  await writeFile(fixturePaths.work, fixture.work, 'utf8');
  await writeFile(fixturePaths.persona, fixture.persona, 'utf8');
  await writeFile(
    fixturePaths.meta,
    `${JSON.stringify({ name: person, display_name: person, character: 'colleague' }, null, 2)}\n`,
    'utf8',
  );

  const created = distilly([
    'skill', 'create',
    '--character', 'colleague',
    '--slug', person,
    '--base-dir', workdir,
    '--meta', fixturePaths.meta,
    '--work', fixturePaths.work,
    '--persona', fixturePaths.persona,
    '--no-install-claude-skill',
    '--json',
  ]);
  const skillDir = path.join(personDir);
  const delivered = {};
  for (const name of REQUIRED_ARTIFACTS) {
    const file = path.join(skillDir, name);
    delivered[name] = existsSync(file) ? await readFile(file, 'utf8') : null;
  }
  const inspected = inspectSkillArtifacts(delivered, knownAnchors);

  record(
    'skill create 产出完整交付物',
    created.status === 0 && inspected.missingArtifacts.length === 0,
    inspected.missingArtifacts.length === 0
      ? `${REQUIRED_ARTIFACTS.length} 个产物`
      : `缺: ${inspected.missingArtifacts.join(', ')}；${created.stderr?.slice(0, 120)}`,
  );
  record(
    '交付物含 PART A / PART B / 运行规则',
    inspected.missingSections.length === 0,
    inspected.missingSections.length ? `缺: ${inspected.missingSections.join(', ')}` : '',
  );
  record(
    '交付物六层结构齐且 Layer 0 有规则',
    inspected.missingLayers.length === 0 && inspected.layer0Rules > 0,
    inspected.missingLayers.length
      ? `缺: ${inspected.missingLayers.join(', ')}`
      : `Layer 0 规则 ${inspected.layer0Rules} 条`,
  );
  record(
    '交付物里的锚点全部可回指',
    inspected.cited.length > 0 && inspected.dangling.length === 0,
    `${inspected.cited.length} 个锚点，悬空 ${inspected.dangling.length}` +
      (inspected.dangling.length ? `: ${inspected.dangling.slice(0, 5).join(', ')}` : ''),
  );

  const doctor = distilly(['doctor', '--base-dir', workdir, '--json']);
  const doctorReceipt = parseReceipt(doctor.stdout);
  const citedRate = doctorReceipt ? `${doctorReceipt.anchors?.cited ?? 0}/${doctorReceipt.anchors?.total ?? 0}` : '无回执';
  record(
    'doctor 报出锚点回指率',
    doctor.status === 0 && (doctorReceipt?.anchors?.cited ?? 0) > 0,
    citedRate,
  );
} catch (error) {
  record('验收流程未中断', false, String(error.message).split('\n')[0]);
} finally {
  if (!keep) await rm(workdir, { recursive: true, force: true });
  else console.log(`保留工作目录：${workdir}`);
}

console.log(`\n验收结果：${results.length - failed}/${results.length} 通过`);
if (failed) {
  console.log('未通过项（依赖尚未落地时属预期，落地后必须转绿）：');
  for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.name}: ${r.detail}`);
  process.exit(1);
}
