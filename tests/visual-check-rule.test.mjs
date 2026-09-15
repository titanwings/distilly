/**
 * The anchor rule `scripts/visual-check.mjs` applies.
 *
 * An appendix row nobody cites is legitimate — it is the ledger index — so it must
 * exist and be focusable, but it cannot have a back-link. Requiring one failed
 * every page whose appendix carries the whole anchor table (a multi-source Skill
 * does), which the run-4 blind page exposed.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { anchorProblem } from "../scripts/visual-check.mjs";

const good = { id: "k0001", ok: true, inAppendix: true, focused: true, visible: true, backLinks: 1 };

test("a cited anchor needs a back-link", () => {
  assert.equal(anchorProblem(good, true), false);
  assert.equal(anchorProblem({ ...good, backLinks: 0 }, true), true, "no back-link on a cited anchor is a problem");
});

test("an uncited appendix row is fine without one", () => {
  assert.equal(anchorProblem({ ...good, backLinks: 0 }, false), false);
});

test("missing, unfocused or invisible anchors are problems either way", () => {
  assert.equal(anchorProblem({ id: "k1", ok: false }, false), true);
  assert.equal(anchorProblem({ ...good, inAppendix: false }, false), true);
  assert.equal(anchorProblem({ ...good, focused: false }, false), true);
  assert.equal(anchorProblem({ ...good, visible: false }, false), true);
  assert.equal(anchorProblem(undefined, true), true);
});
