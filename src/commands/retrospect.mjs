/**
 * `distilly retrospect` — deterministic retrospection (from ds/06-retrospect).
 *
 * The derivation itself lives in `src/derive/retrospect.mjs`; this module only
 * registers it with the command registry and routes its output through the
 * shared reporter so `--json` still produces exactly one object on stdout.
 */

import { register } from "./index.mjs";
import { run as runRetrospect } from "../derive/retrospect.mjs";

const help = {
  zh: [
    "用法 / Usage:",
    "  distilly retrospect [--person <slug>] [--dir <dir>] [--json]",
    "",
    "选项 / Options:",
    "  --person <slug>   要回望的 Skill slug",
    "  --dir <dir>       指定 skills 根目录（默认当前目录）",
    "  --json            输出 JSON 回执",
    "",
    "从 knowledge/index.json 与 knowledge/text/*.md 派生 evidence/derived/*.json：",
    "每条结论都带可回指的锚点；同一输入跑两次产物字节相同；样本不足时输出空集并说明理由。",
  ].join("\n"),
  en: [
    "Distilly retrospect — deterministic retrospection",
    "",
    "Derives evidence/derived/*.json from knowledge/index.json and knowledge/text/*.md.",
    "Every claim carries resolvable anchors, two runs are byte-identical, and a thin",
    "sample produces an empty set with a stated reason instead of a guess.",
  ].join("\n"),
};

register("retrospect", {
  summary: "确定性回望派生 / deterministic retrospection",
  usage: "distilly retrospect [--person <slug>] [--base-dir <workspace>] [--dir <person-dir>] [--json]",
  ...help,
  run({ argv, json, reporter }) {
    const sink = (write) => ({ write: (chunk) => write(String(chunk).replace(/\n$/, "")) });
    const io = json
      ? { stdout: { write: () => {} }, stderr: { write: () => {} } }
      : { stdout: sink((line) => line && reporter.line(line)), stderr: sink((line) => line && reporter.warn(line)) };
    const result = runRetrospect(argv, io) ?? {};
    return { receipt: result.receipt, exitCode: result.exitCode ?? 0 };
  },
});

