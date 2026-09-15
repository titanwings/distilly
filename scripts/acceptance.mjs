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
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
import { baselineSections, buildView } from './blind-test.mjs';

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
        anchorIndex.set(base, {
          id: base,
          anchor: base,
          source: entry.source ?? entry.origin ?? '',
          kind: entry.kind ?? 'message',
          path: raw ?? entry.locations?.text ?? '',
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
  record('view 由派生证据机械构造', baseline.sections.length >= 7 && baseline.cited > 0,
    `${baseline.sections.length} 段 / ${baseline.cited} 个锚点 / 缺口 ${baseline.gaps.length}`);

  const check = distilly(['view', 'check', '--person', person, '--json']);
  record('view check 通过', check.status === 0, check.stderr.slice(0, 160));

  const render1 = distilly(['view', 'render', '--person', person, '--json']);
  const htmlPath = path.join(viewsDir, `${person}.html`);
  const html1 = await readFile(htmlPath);
  distilly(['view', 'render', '--person', person, '--json']);
  const html2 = await readFile(htmlPath);
  record('render 两次产物字节相同', sha256(html1) === sha256(html2), `${html1.length} bytes`);
  const html = html1.toString('utf8');
  record('产物单文件且无外链', !/https?:\/\//i.test(html.replace(/https?:\/\/www\.w3\.org[^"']*/g, '')), '');
  record('产物含 CSP', /Content-Security-Policy/i.test(html));

  // 4. visual-check（八项）
  const vcScript = path.join(root, 'scripts/visual-check.mjs');
  const vc = spawnSync('node', [vcScript, htmlPath, '--out', evidenceDir], { cwd: workdir, encoding: 'utf8' });
  if (/Cannot find module|ENOENT/.test(vc.stderr ?? '')) {
    record('visual-check 可用', false, 'scripts/visual-check.mjs 尚不存在（ds/03-render 的产出）');
  } else {
    record('visual-check 八项通过', vc.status === 0, (vc.stdout ?? '').trim().split('\n').slice(-3).join(' / '));
  }
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
