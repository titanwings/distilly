#!/usr/bin/env node
// 验收脚本自测用的最小实现（不属于仓库，只在 /tmp 下临时目录里）。
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Credentialed commands (`collect` / `consent` / `transcribe`) are dispatched
 * here, in their own block: the install path above is untouched, and each module
 * owns its flags, receipts and exit codes (2 means "waiting for user consent").
 */
const collectChannels = {
  feishu: () => import("../src/collect/feishu.mjs"),
  slack: () => import("../src/collect/slack.mjs"),
  dingtalk: () => import("../src/collect/dingtalk.mjs"),
  x: () => import("../src/collect/x.mjs"),
};

async function runCredentialedCommand(commandArgs) {
  const [command, ...rest] = commandArgs;
  if (command === "consent") {
    const { runConsentCli } = await import("../src/consent.mjs");
    return runConsentCli(rest);
  }
  if (command === "transcribe") {
    const { runTranscribeCli } = await import("../src/optional/transcribe.mjs");
    return runTranscribeCli(rest);
  }

  const [channel, ...channelArgs] = rest;
  const known = Object.keys(collectChannels).join("|");
  if (!channel || channel === "--help" || channel === "help") {
    console.log(`Usage: distilly collect <${known}> [options] [--json]`);
    console.log("Run `distilly collect <channel> --help` for the per-channel options.");
    return channel ? 0 : 1;
  }
  const load = collectChannels[channel];
  if (!load) fail(`unsupported channel: ${channel} (known: ${Object.keys(collectChannels).join(", ")})`);
  const { runCollectCli } = await load();
  return runCollectCli(channelArgs);
}

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const person = opt('person', 'lin-gong');
const dir = path.join(process.cwd(), 'skills', 'colleague', person);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const receipt = (extra) => console.log(JSON.stringify({ command: `${cmd}`, person, ok: true, inputs: [], outputs: [], warnings: [], ...extra }, null, 2));

if (cmd === 'harvest') {
  const src = args[1];
  const rawDir = path.join(dir, 'knowledge', 'raw');
  const textDir = path.join(dir, 'knowledge', 'text');
  await mkdir(rawDir, { recursive: true }); await mkdir(textDir, { recursive: true });
  const name = path.basename(src);
  const bytes = await readFile(path.join(src, 'transcript.srt'));
  const rawPath = path.join(rawDir, name);
  await writeFile(rawPath, bytes);
  const cues = bytes.toString('utf8').trim().split(/\n\n+/).map((c, i) => ({ n: i + 1, text: c.split('\n').slice(2).join(' ') }));
  const anchors = [];
  const md = cues.map((c, i) => { const a = `k${String(i + 1).padStart(4, '0')}`; anchors.push(a); return `[${a}] ${c.text}`; }).join('\n\n');
  const textPath = path.join(textDir, `${name}.md`);
  await writeFile(textPath, md, 'utf8');
  const ledgerPath = path.join(dir, 'knowledge', 'index.json');
  let ledger = [];
  try { ledger = JSON.parse(await readFile(ledgerPath, 'utf8')); } catch { /* new */ }
  const digest = sha(bytes);
  if (!ledger.some((e) => e.sha256 === digest)) {
    ledger.push({ id: 'k-src-1', kind: 'subtitle', origin: name, fetched_at: '2026-09-13T00:00:00Z', bytes: bytes.length, sha256: digest, credentialed: false, method: 'local', warnings: [], anchors });
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
  }
  receipt({ inputs: [{ path: rawPath, sha256: digest, bytes: bytes.length }], outputs: [{ path: textPath, sha256: sha(Buffer.from(md)), bytes: Buffer.byteLength(md) }], anchors: { total: anchors.length } });
} else if (cmd === 'retrospect') {
  const ledger = JSON.parse(await readFile(path.join(dir, 'knowledge', 'index.json'), 'utf8'));
  const anchors = ledger.flatMap((e) => e.anchors ?? []);
  const derDir = path.join(dir, 'evidence', 'derived');
  await mkdir(derDir, { recursive: true });
  const kinds = ['stats', 'voice', 'relations', 'timeline', 'boundaries', 'shifts', 'conflicts'];
  const outputs = [];
  for (const kind of kinds) {
    const body = JSON.stringify({ kind, claims: [{ id: `${kind}.sample`, value: 1, confidence: 'high', evidence: anchors.slice(0, 2) }] }, null, 2);
    const p = path.join(derDir, `${kind}.json`);
    await writeFile(p, body);
    outputs.push({ path: p, sha256: sha(Buffer.from(body)), bytes: Buffer.byteLength(body) });
  }
  receipt({ outputs });
} else if (cmd === 'view') {
  const sub = args[1];
  const viewPath = path.join(dir, 'views', `${person}.view.json`);
  const view = JSON.parse(await readFile(viewPath, 'utf8'));
  const ledger = JSON.parse(await readFile(path.join(dir, 'knowledge', 'index.json'), 'utf8'));
  const known = new Set(ledger.flatMap((e) => e.anchors ?? []));
  if (sub === 'check') {
    const bad = [];
    for (const s of view.sections ?? []) for (const c of s.claims ?? []) for (const a of c.anchors ?? []) if (!known.has(a)) bad.push(a);
    if (bad.length) { console.error(JSON.stringify({ ok: false, code: 'view/orphan-anchor', bad })); process.exit(1); }
    receipt({});
  } else {
    const htmlPath = path.join(dir, 'views', `${person}.html`);
    const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${view.meta?.title ?? person}</title></head><body><h1>${view.headline?.text ?? ''}</h1>${(view.sections ?? []).map((s) => `<section><h2>${s.title}</h2>${(s.claims ?? []).map((c) => `<p>${c.text} ${(c.anchors ?? []).join(' ')}</p>`).join('')}</section>`).join('')}</body></html>`;
    await writeFile(htmlPath, html);
    receipt({ outputs: [{ path: htmlPath, sha256: sha(Buffer.from(html)), bytes: Buffer.byteLength(html) }] });
  }
} else {
  console.error(`unknown command ${cmd}`); process.exit(2);
}
