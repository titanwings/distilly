/**
 * "Am I the process entry point?" — the guard every executable here needs.
 *
 * `bin/distilly.mjs` and the two runnable scripts under `scripts/` must dispatch
 * only when they were invoked directly, because tests import their internals.
 * The obvious spelling is wrong in a way that fails *silently*:
 *
 *     resolve(process.argv[1]) === fileURLToPath(import.meta.url)
 *
 * `import.meta.url` is always the realpath, while `argv[1]` is whatever the
 * caller wrote. Under a symlink the two differ, the guard concludes "I was
 * imported", and the program exits 0 having done nothing. That is not an edge
 * case: `/tmp` is a symlink to `/private/tmp` on macOS, and — more importantly —
 * an npm `bin` shim in `node_modules/.bin/` is a symlink, so a published
 * `distilly` would have silently ignored every command.
 *
 * Resolving both sides is the fix. A path that cannot be resolved (an eval, a
 * repl) is not an entry point, which is also the honest answer.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** True when `moduleUrl` names the file the process was started with. */
export function isEntryPoint(moduleUrl) {
  const invoked = process.argv[1];
  if (invoked === undefined || invoked === "") return false;
  try {
    return realpathSync(invoked) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
