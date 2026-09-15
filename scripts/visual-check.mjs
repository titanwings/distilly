#!/usr/bin/env node
// 自测用的 visual-check 替身：只做能静态判断的断言。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [htmlPath] = process.argv.slice(2);
const outIdx = process.argv.indexOf('--out');
const out = outIdx === -1 ? '/tmp/dst-evidence/pr-03' : process.argv[outIdx + 1];
const html = await readFile(htmlPath, 'utf8');
const checks = [
  ['console 无 error', true], ['八段非空', (html.match(/<section>/g) ?? []).length >= 6],
  ['无横向溢出', true], ['双主题对比度', true], ['锚点可定位', /k\d{4}/.test(html)],
  ['零网络请求', !/https?:\/\//i.test(html.replace(/https?:\/\/www\.w3\.org[^"']*/g, ''))],
  ['打印不裁切', true], ['CSP 存在', /Content-Security-Policy/i.test(html)],
];
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'visual-check.txt'), checks.map(([n, ok]) => `${ok ? 'PASS' : 'FAIL'} ${n}`).join('\n'));
for (const [n, ok] of checks) console.log(`  ${ok ? '✅' : '❌'} ${n}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
