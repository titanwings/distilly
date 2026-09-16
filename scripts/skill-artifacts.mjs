/**
 * The mechanical checks an acceptance run applies to a **generated Skill**.
 *
 * They live in their own module, and take plain strings, so they can be falsified by
 * a unit test: a gate nobody has ever seen go red is not a gate. That was the state
 * of this repo until now — the end-to-end acceptance covered harvest → retrospect →
 * view → render and never touched `skill create`, so the artifact this product
 * actually delivers could be missing, or could contradict itself, with every gate
 * green.
 *
 * The three failure modes these checks exist for, all observed for real:
 *
 *  - `SKILL.md` absent, or missing PART A / PART B / its operating rules;
 *  - a persona without the Layer 0–5 structure `prompts/persona_builder.md` defines —
 *    the shipped operating rules promise "Layer 0 rules always take priority" while
 *    nothing generated or checked that a Layer 0 existed;
 *  - an anchor the artifact cites that the ledger does not declare (a citation that
 *    cannot be followed back to the corpus, which is the product's whole claim).
 *
 * Distillation *quality* is deliberately not here: it needs a judge, and lives in the
 * effect layer (`scripts/blind-test.mjs`).
 */

/** The artifact set `distilly skill create` promises for a character family. */
export const REQUIRED_ARTIFACTS = [
  'SKILL.md',
  'work.md',
  'persona.md',
  'work_skill.md',
  'persona_skill.md',
  'manifest.json',
  'meta.json',
];

/** Sections the assembled `SKILL.md` must carry. */
export const REQUIRED_SECTIONS = ['PART A', 'PART B', 'Operating Rules'];

/** Layer headings the persona builder defines. */
export const REQUIRED_LAYERS = [0, 1, 2, 3, 4, 5].map((index) => `Layer ${index}`);

/**
 * Whether `body` carries `Layer N` as a **heading**.
 *
 * Not a substring test: the operating rules that ship with every generated Skill
 * contain the sentence "Layer 0 rules in PART B always take priority", so
 * `body.includes("Layer 0")` is true even when PART B has no Layer 0 at all — which
 * is exactly the shape that shipped green. Requiring `##` makes the promise text
 * unable to satisfy the check it promises.
 */
function hasLayerHeading(body, index) {
  return new RegExp(`^##\\s*Layer\\s*${index}\\b`, "m").test(body);
}

/** Anchors an artifact cites, as `k00NN` / `k00NN:tM`, deduplicated. */
export function citedAnchors(body) {
  const found = new Set();
  for (const match of String(body ?? '').matchAll(/\[(k\d{4}(?::t\d+)?)\]/g)) found.add(match[1]);
  return found;
}

/**
 * Inspect a generated Skill.
 *
 * @param {Record<string, string|null>} files artifact name → body (`null` when absent)
 * @param {Set<string>} knownAnchors anchors the ledger declares
 */
export function inspectSkillArtifacts(files, knownAnchors = new Set()) {
  const missingArtifacts = REQUIRED_ARTIFACTS.filter((name) => files[name] === undefined || files[name] === null);

  const skillBody = files['SKILL.md'] ?? '';
  const missingSections = REQUIRED_SECTIONS.filter((section) => !skillBody.includes(section));
  const missingLayers = REQUIRED_LAYERS.filter((_layer, index) => !hasLayerHeading(skillBody, index));

  // Layer 0 must say something: the heading alone is what a non-compliant persona
  // produces when the builder prompt is skipped, and it is exactly the shape that
  // shipped once already.
  const layer0Body = skillBody.split('## Layer 0')[1]?.split('## Layer 1')[0] ?? '';
  const layer0Rules = layer0Body
    .split('\n')
    .filter((row) => row.trim().startsWith('- ') && row.trim().length > 4).length;

  const cited = new Set();
  for (const name of ['SKILL.md', 'work.md', 'persona.md']) {
    for (const anchor of citedAnchors(files[name])) cited.add(anchor);
  }
  const dangling = [...cited].filter((anchor) => !knownAnchors.has(anchor));

  return { missingArtifacts, missingSections, missingLayers, layer0Rules, cited: [...cited], dangling };
}
