/**
 * Coding-agent matrix assertions.
 *
 * Two things must never drift apart:
 *   1. `src/hosts/agents.mjs` — the single source of truth for docs and commands
 *   2. `bin/distilly.mjs`      — the directories the installer actually writes to
 *
 * The second one is a hand-written table inside a plain script, so this test
 * reads that file, evaluates only its `join(...)` expressions, and compares the
 * result with the matrix. Run with: `node --test tests/agents.test.mjs`.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HOST_ALIASES, repoInstallDir, supportedHosts } from '../src/install/hosts.mjs';

import {
  AGENTS,
  REPO,
  SKILL_NAME,
  cloneCommand,
  getAgent,
  listAgents,
  skillsCliCommand,
  skillsCliSupported,
} from '../src/hosts/agents.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const binSource = readFileSync(join(repoRoot, 'bin', 'distilly.mjs'), 'utf8');

/** Hosts that intentionally have no documented project-local directory. */
const GLOBAL_ONLY = ['openclaw'];

/**
 * Hosts that must have a confirmed AgentSkills CLI `--agent` target, and the
 * one host that must not: the upstream registry (verify with
 * `npx skills ls -a <id>`) has no DeepSeek Harness entry.
 */
const CLI_SUPPORTED = [
  'claude-code',
  'codex',
  'opencode',
  'openclaw',
  'hermes',
  'grok-build',
  'pi',
];
const CLONE_ONLY = ['deepseek-harness'];

/**
 * Slice `const hosts = { ... };` out of bin/distilly.mjs and return a Map of
 * host id → the unevaluated arrow-function body (one `join(...)` expression).
 *
 * This is deliberately structural rather than a regex over JavaScript: it only
 * needs the key of each entry and the text between it and the next entry.
 */
function parseBinHosts(source) {
  const block = source.match(/const hosts = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'bin/distilly.mjs must declare a `const hosts = { ... };` table');

  const body = block[1];
  const keyPattern = /(?:^|\n)[ \t]*"?([a-z][a-z0-9-]*)"?[ \t]*:[ \t]*\(\)[ \t]*=>/g;
  const keys = [...body.matchAll(keyPattern)];
  assert.ok(keys.length > 0, 'bin/distilly.mjs hosts table must not be empty');

  const entries = new Map();
  keys.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < keys.length ? keys[index + 1].index : body.length;
    entries.set(match[1], body.slice(start, end).replace(/,\s*$/, '').trim());
  });
  return entries;
}

/**
 * Evaluate one host expression with only `join`, `homedir` and `process.env`
 * defined. `$DSH_HOME` stands for "whatever the user set"; `undefined` means
 * the variable is unset, which must fall back to `~/.dsh`.
 */
function evaluateHostTarget(expression, dshHome) {
  const env = dshHome === undefined ? {} : { DSH_HOME: dshHome };
  const stubJoin = (...parts) => parts.join('/');
  const stubHomedir = () => '~';
  // eslint-disable-next-line no-new-func -- the input is our own repository file
  const evaluate = new Function('join', 'homedir', 'process', `return (${expression});`);
  return evaluate(stubJoin, stubHomedir, { env });
}

/**
 * `$DSH_HOME/skills/distilly` and `~/.dsh/skills/distilly` are the same target
 * spelled two ways; collapse both to the `$DSH_HOME` spelling.
 */
function normalizeTarget(target) {
  const home = homedir();
  const withTilde = target.startsWith(`${home}/`) ? `~/${target.slice(home.length + 1)}` : target;
  return withTilde.replace(/^~\/\.dsh\//, '$DSH_HOME/').replace(/\/{2,}/g, '/');
}

test('matrix shape: 8 unique hosts, each with a global path and a bilingual note', () => {
  assert.equal(AGENTS.length, 8, 'the matrix must describe exactly 8 hosts');

  const ids = AGENTS.map((agent) => agent.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate host id in ${ids.join(', ')}`);
  assert.deepEqual(listAgents(), ids, 'listAgents() must return the matrix ids in order');

  for (const agent of AGENTS) {
    assert.equal(typeof agent.globalPath, 'string', `${agent.id}: globalPath must be a string`);
    assert.ok(agent.globalPath.length > 0, `${agent.id}: globalPath must not be empty`);
    assert.ok(agent.note && typeof agent.note === 'object', `${agent.id}: note must be an object`);
    for (const language of ['zh', 'en']) {
      assert.equal(
        typeof agent.note[language],
        'string',
        `${agent.id}: note.${language} must be a string`,
      );
      assert.ok(
        agent.note[language].trim().length > 0,
        `${agent.id}: note.${language} must not be empty`,
      );
    }
    assert.ok(['full', 'prompt-only'].includes(agent.capability), `${agent.id}: unknown capability`);
    assert.equal(getAgent(agent.id), agent, `getAgent('${agent.id}') must return the matrix entry`);
  }
});

test('installer and matrix agree host-for-host', () => {
  // ds/01 moved the inline `hosts` table out of bin/distilly.mjs into
  // src/install/hosts.mjs, so the anti-drift check now goes through that API
  // instead of regex-parsing the executable.
  assert.deepEqual(
    [...supportedHosts()].sort(),
    [...listAgents()].sort(),
    'src/install/hosts.mjs and src/hosts/agents.mjs must list the same hosts',
  );

  for (const id of listAgents()) {
    // A fixed env, not the ambient one: the assertion is about the *target* the
    // installer computes, and this suite may itself be running under a host that
    // exports DSH_HOME (the harness does). Without pinning it, `deepseek-harness`
    // resolves to that host's `$DSH_HOME/skills/distilly` and the comparison
    // against the `$DSH_HOME/...` template fails for an unrelated reason.
    assert.equal(
      normalizeTarget(repoInstallDir(id, { env: {} })),
      normalizeTarget(getAgent(id).globalPath),
      `the installer puts ${id} somewhere else than the matrix says`,
    );
  }

  // DeepSeek Harness reads $DSH_HOME and falls back to ~/.dsh; both spellings are
  // the same target and must stay equivalent to the matrix value.
  assert.equal(
    normalizeTarget(repoInstallDir('deepseek-harness', { env: {} })),
    normalizeTarget(getAgent('deepseek-harness').globalPath),
    'an unset DSH_HOME must resolve to the same global path as $DSH_HOME',
  );

  // `install <alias>` must not be able to reach a host the matrix does not know.
  for (const [alias, target] of Object.entries(HOST_ALIASES)) {
    assert.ok(listAgents().includes(target), `alias "${alias}" points at unknown host "${target}"`);
  }

  // The help text must mention every host, so `distilly install` is discoverable.
  const help = execFileSync('node', ['bin/distilly.mjs', '--help'], { encoding: 'utf8' });
  for (const id of listAgents()) {
    assert.ok(
      new RegExp(`(^|[\\s,])${id}([\\s,]|$)`, 'm').test(help),
      `distilly --help never mentions host "${id}"`,
    );
  }
});

test('only DeepSeek Harness lacks an AgentSkills CLI target, and its error names the clone route', () => {
  for (const id of CLONE_ONLY) {
    assert.equal(
      skillsCliSupported(id),
      false,
      `${id} has no upstream --agent target and must stay on the clone route`,
    );

    assert.throws(
      () => skillsCliCommand(id, 'global', { requireVerified: true }),
      (error) => {
        assert.ok(error instanceof Error, 'strict mode must throw an Error');
        assert.match(
          error.message,
          new RegExp(`cloneCommand\\('${id}', 'global'\\)`),
          'the error must name the cloneCommand alternative',
        );
        return true;
      },
      `${id} must refuse an unverified --agent target`,
    );
  }

  assert.equal(
    CLI_SUPPORTED.length + CLONE_ONLY.length,
    AGENTS.length,
    'every host must be either CLI-capable or clone-only',
  );

  for (const id of CLI_SUPPORTED) {
    assert.equal(skillsCliSupported(id), true, `${id} must have a confirmed --agent target`);
    assert.match(getAgent(id).cliId, /^[a-z][a-z0-9-]*$/, `${id}: malformed --agent target`);
    const command = skillsCliCommand(id, 'global', { requireVerified: true });
    assert.match(command, /^npx -y skills add titanwings\/distilly /, `${id}: unexpected command`);
    assert.match(command, new RegExp(`--agent ${getAgent(id).cliId}`), `${id}: wrong --agent flag`);
    assert.ok(!command.includes('undefined'), `${id}: command contains "undefined"`);
  }
});

test('cloneCommand("project") fails for global-only hosts and targets the documented dir', () => {
  const withoutProjectPath = AGENTS.filter((agent) => !agent.projectPath).map((agent) => agent.id);
  assert.deepEqual(
    withoutProjectPath.sort(),
    [...GLOBAL_ONLY].sort(),
    `only ${GLOBAL_ONLY.join(' and ')} may lack a project-local directory`,
  );

  for (const id of GLOBAL_ONLY) {
    assert.throws(
      () => cloneCommand(id, 'project'),
      (error) => {
        assert.match(error.message, /no documented project-local path/);
        assert.match(error.message, /global install/);
        return true;
      },
      `${id} must refuse a project-scope clone`,
    );
  }

  for (const agent of AGENTS) {
    if (!agent.projectPath) continue;
    assert.equal(
      cloneCommand(agent.id, 'project'),
      `git clone https://github.com/${REPO} ${agent.projectPath}`,
      `${agent.id}: project clone must point at ${agent.projectPath}`,
    );
    assert.equal(
      cloneCommand(agent.id, 'global'),
      `git clone https://github.com/${REPO} ${agent.globalPath}`,
      `${agent.id}: global clone must point at ${agent.globalPath}`,
    );
  }
});

test('every emitted command uses the current repo and skill name', () => {
  assert.equal(REPO, 'titanwings/distilly');
  assert.equal(SKILL_NAME, 'distilly');

  const commands = [];
  for (const agent of AGENTS) {
    commands.push(cloneCommand(agent.id, 'global'));
    if (agent.projectPath) commands.push(cloneCommand(agent.id, 'project'));
    commands.push(skillsCliCommand(agent.id, 'global'));
  }

  for (const command of commands) {
    assert.ok(command.includes('titanwings/distilly'), `stale repository in: ${command}`);
    assert.ok(!command.includes('dot-skill'), `old repo name leaked into: ${command}`);
    assert.ok(!command.includes('colleague-skill'), `old repo name leaked into: ${command}`);
    assert.ok(!command.includes('python3 '), `the Python entrypoint leaked into: ${command}`);
  }

  for (const id of listAgents()) {
    assert.match(
      skillsCliCommand(id, 'global'),
      /--skill distilly\b/,
      `${id}: the skills CLI route must pin --skill distilly`,
    );
  }
});
