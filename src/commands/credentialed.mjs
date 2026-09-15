/**
 * Credentialed commands — `collect`, `consent`, `transcribe` (from ds/07).
 *
 * Those modules own their flags, receipts and exit codes; this adapter only
 * registers them with the command registry and guarantees CONTRACT §3: in
 * `--json` mode stdout carries exactly one JSON object, whatever the module
 * prints while it works (hence the stdout capture).
 */

import { register } from "./index.mjs";

const CHANNELS = {
  feishu: () => import("../collect/feishu.mjs"),
  slack: () => import("../collect/slack.mjs"),
  dingtalk: () => import("../collect/dingtalk.mjs"),
  x: () => import("../collect/x.mjs"),
};

/** Run `fn` with stdout/stderr captured, so the dispatcher owns the output. */
async function capture(fn) {
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  let out = "";
  let err = "";
  process.stdout.write = (chunk) => {
    out += String(chunk);
    return true;
  };
  process.stderr.write = (chunk) => {
    err += String(chunk);
    return true;
  };
  try {
    const result = await fn();
    return { result, out, err };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

function parseReceiptFrom(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function forward(text, write) {
  for (const line of text.split("\n")) if (line.trim()) write(line);
}

async function runModule(load, argv, { json, reporter }) {
  const module = await load();
  const entry = module.runCollectCli ?? module.runConsentCli ?? module.runTranscribeCli;
  if (typeof entry !== "function") throw new Error("module exposes no CLI entry point");
  const { result, out, err } = await capture(() => entry(argv, {}));
  if (!json) {
    forward(out, (line) => reporter.line(line));
    forward(err, (line) => reporter.warn(line));
  }
  const receipt = result?.receipt ?? parseReceiptFrom(out) ?? undefined;
  const exitCode = result?.exitCode ?? (result?.ok === false ? 1 : 0);
  return { receipt, exitCode };
}

const collectHelp = {
  zh: [
    "用法 / Usage:",
    "  distilly collect <feishu|slack|dingtalk|x> [options] [--json]",
    "  distilly collect x --mode browser --consent <token>   # computer use，需显式同意",
    "",
    "需要凭据的渠道由脚本负责鉴权/分页/限流/续采；缺 key 或缺同意 → 响亮失败并给补救步骤，",
    "回执与日志里只出现配置文件名，永不出现 key 值。",
  ].join("\n"),
  en: [
    "Distilly collect — credentialed channels (feishu, slack, dingtalk, x).",
    "Browser collection requires `--consent <token>`; without it the command exits 2.",
    "Receipts and logs name the credential file, never its contents.",
  ].join("\n"),
};

register("collect", {
  summary: "需要凭据的渠道采集 / credentialed collection",
  usage: "distilly collect <feishu|slack|dingtalk|x> [options] [--json]",
  ...collectHelp,
  async run({ argv, json, reporter }) {
    const [channel, ...rest] = argv;
    if (!channel || channel === "--help" || channel === "help") {
      reporter.line(`Usage: distilly collect <${Object.keys(CHANNELS).join("|")}> [options] [--json]`);
      return { receipt: undefined, exitCode: channel ? 0 : 2 };
    }
    const load = CHANNELS[channel];
    if (!load) {
      return {
        receipt: {
          command: "collect",
          person: null,
          ok: false,
          inputs: [],
          outputs: [],
          anchors: { total: 0, cited: 0 },
          warnings: [],
          unavailable: [],
          error: { code: "collect/unknown-channel", message: `unsupported channel: ${channel}`, remedy: `known channels: ${Object.keys(CHANNELS).join(", ")}` },
        },
        exitCode: 2,
      };
    }
    return runModule(load, rest, { json, reporter });
  },
});

register("consent", {
  summary: "computer-use 同意管理 / consent tokens",
  usage: "distilly consent <grant|list|verify|revoke|prune> [options] [--json]",
  zh: ["用法 / Usage:", "  distilly consent <grant|list|verify|revoke|prune> [--json]", "", "同意令牌存在 ~/.distilly/consent.json；没有令牌时 collect --mode browser 退出码 2。"].join("\n"),
  en: ["Distilly consent — grant, list, verify, revoke or prune the computer-use consent tokens kept in ~/.distilly/consent.json."].join("\n"),
  async run({ argv, json, reporter }) {
    return runModule(() => import("../consent.mjs"), argv, { json, reporter });
  },
});

register("transcribe", {
  summary: "可选的转写后端 / optional transcription backend",
  usage: "distilly transcribe <audio|video> [options] [--json]",
  zh: ["用法 / Usage:", "  distilly transcribe <audio|video> [--json]", "", "没有可用后端时明确报 unavailable，不静默降级；产物带 provenance{method,producer,confidence}。"].join("\n"),
  en: ["Distilly transcribe — optional backend (OpenAI-compatible HTTP or a host capability). Reports `unavailable` instead of degrading silently, and records provenance with every transcript."].join("\n"),
  async run({ argv, json, reporter }) {
    return runModule(() => import("../optional/transcribe.mjs"), argv, { json, reporter });
  },
});
