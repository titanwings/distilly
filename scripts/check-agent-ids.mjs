#!/usr/bin/env node
/**
 * Optional check: is every `cliId` in the host matrix still a target the
 * upstream AgentSkills CLI accepts?
 *
 *   node scripts/check-agent-ids.mjs
 *
 * The matrix (`src/hosts/agents.mjs`) maps our host ids to the `--agent` value
 * the upstream `skills` CLI publishes, and those two names do not always match
 * (`grok-build` → `grok`, `hermes` → `hermes-agent`). Upstream can rename a
 * target in any release, so this script replays `skills ls -a <id>` for each
 * host and reports the ones it rejects.
 *
 * It is deliberately NOT part of the test gate: it needs the upstream CLI on
 * this machine (or `SKILLS_CLI` pointing at its entry file) and fails soft when
 * that is missing, so CI never touches the network — nothing here is installed
 * on demand:
 *
 *   - nothing to run  → prints "skipped: ..." and exits 0
 *   - a rejected id   → exits 1, naming the host and the target
 *
 * Env:
 *   SKILLS_CLI   path to the upstream CLI entry file (run with this Node)
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AGENTS } from '../src/hosts/agents.mjs';

const TIMEOUT_MS = 30_000;
const SKIP_MESSAGE = 'skipped: upstream skills CLI unavailable';

/** @returns {{command: string, prefix: string[], version: string}|null} */
function resolveUpstreamCli() {
  const candidates = [];

  if (process.env.SKILLS_CLI) {
    candidates.push({ command: process.execPath, prefix: [process.env.SKILLS_CLI] });
  }

  candidates.push({ command: 'skills', prefix: [] });
  // `--no-install`: use an already-installed copy only, never the network.
  candidates.push({ command: 'npx', prefix: ['--no-install', 'skills'] });

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.prefix, '--version'], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
    });
    if (probe.error || probe.status !== 0) continue;
    const version = (probe.stdout || '').trim().split('\n').pop() || 'unknown';
    return { ...candidate, version };
  }

  return null;
}

function main() {
  const cli = resolveUpstreamCli();
  if (!cli) {
    console.log(SKIP_MESSAGE);
    return 0;
  }

  console.log(`upstream skills CLI: ${cli.command} ${[...cli.prefix, `v${cli.version}`].join(' ')}`);

  const sandboxHome = mkdtempSync(join(tmpdir(), 'distilly-agent-ids-'));
  const env = {
    ...process.env,
    HOME: sandboxHome,
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
  };

  const cloneOnly = [];
  const invalid = [];

  try {
    for (const agent of AGENTS) {
      if (!agent.cliId) {
        cloneOnly.push(agent.id);
        continue;
      }

      const result = spawnSync(cli.command, [...cli.prefix, 'ls', '-a', agent.cliId], {
        encoding: 'utf8',
        env,
        timeout: TIMEOUT_MS,
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      const rejected = /Invalid agents:/i.test(output) || result.status !== 0;

      if (rejected) {
        invalid.push(agent);
        console.log(`FAIL ${agent.id.padEnd(18)} --agent ${agent.cliId}`);
      } else {
        console.log(`ok   ${agent.id.padEnd(18)} --agent ${agent.cliId}`);
      }
    }
  } finally {
    rmSync(sandboxHome, { recursive: true, force: true });
  }

  console.log(
    `checked ${AGENTS.length - cloneOnly.length} cliId targets: ` +
      `${AGENTS.length - cloneOnly.length - invalid.length} valid, ${invalid.length} invalid`,
  );
  if (cloneOnly.length > 0) {
    console.log(`clone-only (no upstream target): ${cloneOnly.join(', ')}`);
  }

  if (invalid.length > 0) {
    console.error('');
    console.error('The upstream CLI rejected these targets; update src/hosts/agents.mjs:');
    for (const agent of invalid) {
      console.error(`  ${agent.id}: cliId "${agent.cliId}" -> run \`npx skills ls -a <id>\` to find the new name`);
    }
    return 1;
  }

  return 0;
}

process.exit(main());
