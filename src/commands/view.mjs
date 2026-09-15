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
import { createReceipt } from "../cli/receipt.mjs";
import { checkView, expectedSlug, formatDiagnostic, normalizeView } from "../views/schema.mjs";
import { ViewError, findViewDocuments, loadViewDocument, renderView } from "../views/render.mjs";

const OPTIONS = {
  person: { type: "string", value: "slug" },
  slug: { type: "string", value: "slug" },
  file: { type: "string", value: "path" },
  root: { type: "string", value: "dir" },
  out: { type: "string", value: "path" },
  shareable: { type: "boolean" },
};

function parseViewArgs(argv) {
  const options = { slug: null, file: null, root: process.cwd(), out: null, shareable: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--shareable") options.shareable = true;
    else if (arg === "--person" || arg === "--slug" || arg === "--file" || arg === "--root" || arg === "--out") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg === "--person" ? "slug" : arg.slice(2)] = value;
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
    `  distilly view ${sub} [--person <slug>|--file <path>] [--root <dir>] [--json]`,
    sub === "render" ? "  distilly view render [--out <path>] [--shareable]" : "",
    "",
    "说明：",
    "  默认私有模式只输出结论与锚点编号；--shareable 才内联原文并写进回执。",
  ].filter(Boolean).join("\n");
  const en = [
    "Usage:",
    `  distilly view ${sub} [--person <slug>|--file <path>] [--root <dir>] [--json]`,
    sub === "render" ? "  distilly view render [--out <path>] [--shareable]" : "",
    "",
    "Notes:",
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
    const report = checkView(document.view, { viewPath: document.path, shareable: options.shareable });
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

register("view check", checkCommand);
register("view render", renderCommand);
