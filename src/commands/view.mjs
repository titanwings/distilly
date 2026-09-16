/**
 * `distilly view check|render` — the single-file HTML layer (from ds/03-render).
 *
 * Registered into the ds/01 dispatcher instead of being handled inline in
 * `bin/distilly.mjs`: the modules doing the work (`src/views/schema.mjs`,
 * `src/views/render.mjs`) are unchanged, only the entry point moved.
 *
 * Receipts follow CONTRACT §3, and validation failures are *returned* (with
 * diagnostics) rather than thrown, so `--json` always yields one object.
 */

import { relative, resolve } from "node:path";

import { register } from "./index.mjs";
import { CliError, createReceipt } from "../cli/receipt.mjs";
import { checkView, expectedSlug, formatDiagnostic, normalizeView } from "../views/schema.mjs";
import { ViewError, findViewDocuments, loadViewDocument, renderView } from "../views/render.mjs";

const OPTIONS = {
  person: { type: "string", value: "slug" },
  slug: { type: "string", value: "slug" },
  file: { type: "string", value: "path" },
  root: { type: "string", value: "dir" },
  // `--base-dir` is the CLI-wide spelling of "workspace root" (harvest / doctor /
  // retrospect / skill all take it that way). `view` accepted only `--root` while
  // `distilly view --help` advertised `--base-dir`, so the documented flag died with
  // `unknown option: --base-dir`. Both spellings now mean the same thing.
  "base-dir": { type: "string", value: "dir" },
  out: { type: "string", value: "path" },
  shareable: { type: "boolean" },
  // 声明「我知道这里有缺口」：只把「本节稀薄」从错误降为警告
  "allow-missing": { type: "boolean" },
};

function parseViewArgs(argv) {
  const options = { slug: null, file: null, root: process.cwd(), out: null, shareable: false, allowMissing: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--shareable") options.shareable = true;
    else if (arg === "--allow-missing") options.allowMissing = true;
    else if (
      arg === "--person" ||
      arg === "--slug" ||
      arg === "--file" ||
      arg === "--root" ||
      arg === "--base-dir" ||
      arg === "--out"
    ) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      const key = arg === "--person" ? "slug" : arg === "--base-dir" ? "root" : arg.slice(2);
      options[key] = value;
      index += 1;
    } else if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
    else if (arg.endsWith(".view.json") && !options.file && !options.slug) options.file = arg;
    else if (!options.slug) options.slug = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return options;
}

function resolveViewPath(options) {
  if (options.file) return resolve(options.file);
  if (!options.slug) throw new Error("view check|render needs a <slug> or --file <path>");
  const candidates = findViewDocuments(options.slug, resolve(options.root));
  if (candidates.length === 0) {
    throw new Error(
      `no views/${options.slug}.view.json under ${resolve(options.root)}; ` +
        "expected skills/<family>/<slug>/views/<slug>.view.json — pass --file to point at one",
    );
  }
  if (candidates.length > 1) {
    throw new Error(`ambiguous slug "${options.slug}": ${candidates.join(", ")} — pass --file to choose one`);
  }
  return candidates[0];
}

function helpFor(sub) {
  const zh = [
    "用法：",
    `  distilly view ${sub} [--person <slug>|--file <path>] [--base-dir <workspace>|--root <dir>] [--json]`,
    sub === "render" ? "  distilly view render [--out <path>] [--shareable]" : "",
    "",
    "说明：",
    "  --base-dir 是工作区根（下面有 skills/），与 harvest / doctor / retrospect / skill 一致；--root 是同义别名。",
    "  默认私有模式只输出结论与锚点编号；--shareable 才内联原文并写进回执。",
  ].filter(Boolean).join("\n");
  const en = [
    "Usage:",
    `  distilly view ${sub} [--person <slug>|--file <path>] [--base-dir <workspace>|--root <dir>] [--json]`,
    sub === "render" ? "  distilly view render [--out <path>] [--shareable]" : "",
    "",
    "Notes:",
    "  --base-dir is the workspace root (the directory holding skills/), the same meaning it has in harvest / doctor / retrospect / skill; --root is an alias.",
    "  Private mode (default) prints conclusions plus anchor ids only; --shareable inlines quotes and records them in the receipt.",
  ].filter(Boolean).join("\n");
  return { zh, en };
}

const checkCommand = {
  summary: "校验 view spec / validate a view spec",
  usage: "distilly view check [--person <slug>|--file <path>] [--shareable] [--json]",
  options: OPTIONS,
  ...helpFor("check"),
  run({ argv, json, reporter, ctx }) {
    const options = parseViewArgs(argv);
    const viewPath = resolveViewPath(options);
    const document = loadViewDocument(viewPath);
    const report = checkView(document.view, { viewPath: document.path, shareable: options.shareable, allowMissing: options.allowMissing });
    const normalized = normalizeView(document.view).view;
    const receipt = {
      ...createReceipt("view check", {
        person: normalized?.meta?.slug ?? expectedSlug(document.path) ?? null,
        ok: report.ok,
      }),
      shareable: options.shareable,
      inputs: [{ path: relative(process.cwd(), document.path), sha256: document.sha256, bytes: document.bytes }],
      anchors: { total: report.summary.anchors, cited: report.summary.cited },
      summary: report.summary,
      diagnostics: report.diagnostics,
      warnings: report.warnings.map((entry) => entry.message),
    };
    if (!json) {
      for (const entry of report.diagnostics) reporter.line(formatDiagnostic(entry));
      reporter.line(
        `view check ${report.ok ? "ok" : `${report.errors.length} error(s)`}: ` +
          `${report.summary.sections}/8 segments, ${report.summary.items} items, ` +
          `${report.summary.cited}/${report.summary.anchors} anchors cited, ${report.warnings.length} warning(s)`,
      );
    }
    return { receipt, exitCode: report.ok ? 0 : 1 };
  },
};

const renderCommand = {
  summary: "渲染单文件 HTML / render the single-file HTML",
  usage: "distilly view render [--person <slug>|--file <path>] [--out <path>] [--shareable] [--json]",
  options: OPTIONS,
  ...helpFor("render"),
  run({ argv, json, reporter }) {
    const options = parseViewArgs(argv);
    const viewPath = resolveViewPath(options);
    try {
      const result = renderView({
        allowMissing: options.allowMissing,
        viewPath,
        outPath: options.out ? resolve(options.out) : undefined,
        shareable: options.shareable,
        root: resolve(options.root),
      });
      if (!json) {
        const output = result.receipt.outputs[0];
        reporter.line(`view render ok: ${output.path} (${output.bytes} bytes, sha256 ${output.sha256})`);
        reporter.line(`  receipt: ${relative(process.cwd(), result.receiptPath)}`);
        reporter.line(
          `  mode: ${options.shareable ? "shareable (quotes inlined)" : "private (conclusions + anchor ids only)"}, ` +
            `segments: ${result.receipt.segments.length}, anchors: ${result.receipt.anchors.cited}/${result.receipt.anchors.total} cited`,
        );
        for (const entry of result.report.warnings) {
          reporter.line(`  warning: ${formatDiagnostic(entry).replace(/\n\s*/g, " ")}`);
        }
      }
      return { receipt: result.receipt, exitCode: 0 };
    } catch (error) {
      if (!(error instanceof ViewError)) throw error;
      const receipt = {
        ...createReceipt("view render", { ok: false }),
        diagnostics: error.diagnostics,
        supported_fixes: error.supportedFixes,
      };
      if (!json) {
        reporter.error(`Error: ${error.message}`);
        for (const entry of error.diagnostics) reporter.error(formatDiagnostic(entry));
        for (const fix of error.supportedFixes) reporter.error(`  fix: ${fix}`);
      }
      return { receipt, exitCode: 1 };
    }
  },
};

const viewHelp = {
  zh: [
    "用法 / Usage:",
    "  distilly view check  --person <slug> [--base-dir <dir>] [--json]",
    "  distilly view render --person <slug> [--base-dir <dir>] [--shareable] [--json]",
    "",
    "`view` 没有独立行为：它是一组子命令的入口。`check` 只读校验视图与锚点，",
    "`render` 生成单文件离线 HTML；SKILL.md 里写的 `distilly view check` 属于前者。",
  ].join("\n"),
  en: [
    "Distilly view — inspect and render a view.",
    "",
    "`view` has no behaviour of its own; it is the entry point for its subcommands.",
    "`check` validates the view and its anchors without writing anything, `render`",
    "produces the single-file offline HTML. `distilly view check` in SKILL.md is the",
    "former.",
  ].join("\n"),
};

register("view", {
  summary: "View 子命令入口 / View subcommand entry",
  usage: "distilly view <check|render> [options]",
  ...viewHelp,
  run({ argv, reporter }) {
    if (argv.length === 0) {
      reporter.line(viewHelp.zh);
      return { receipt: createReceipt("view", { warnings: [] }) };
    }
    throw new CliError(`unknown view subcommand: ${argv[0]}`, {
      code: "usage",
      remedy: "choose one of: check, render.",
    });
  },
});

register("view check", checkCommand);
register("view render", renderCommand);
