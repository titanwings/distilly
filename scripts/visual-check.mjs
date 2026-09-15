#!/usr/bin/env node
/**
 * Is this anchor's outcome a problem?
 *
 * Every appendix row must exist, be focusable and be visible; only an anchor the
 * prose cites must also carry a back-link. Pure so it can be unit-tested without a
 * browser.
 */
export function anchorProblem(outcome, cited) {
  if (!outcome || outcome.ok !== true) return true;
  if (outcome.inAppendix !== true) return true;
  if (outcome.focused !== true) return true;
  if (outcome.visible !== true) return true;
  if (cited === true && !(outcome.backLinks >= 1)) return true;
  return false;
}

/**
 * distilly visual-check — open a rendered view page in Chrome and assert the
 * eight visual contracts from docs/v2/CONTRACT.md §4:
 *
 *   1 console is silent (no error/warning, no pageerror, no failed request)
 *   2 the eight page segments exist and are non-empty
 *   3 no horizontal overflow (1280 / 768 / 375 px)
 *   4 dual-theme contrast spot checks (system preference + manual toggle)
 *   5 every evidence anchor resolves to a focusable row in the appendix
 *   6 zero network requests, CSP present, no external reference
 *   7 @media print does not clip or drop content
 *   8 PNG evidence is written to --out
 *
 * playwright is a DEVELOPMENT dependency and is never imported by the runtime:
 * when it is missing this script fails loudly with install guidance.
 *
 *   node scripts/visual-check.mjs views/<slug>.html [--out <dir>] [--json]
 */
import { isEntryPoint } from "../src/cli/entry.mjs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_OUT = "/tmp/dst-evidence/pr-03";
const RESULTS = [];

const SAMPLE_SELECTORS = [
  "#page-title",
  ".claim__text",
  ".claim__meta",
  ".anchor-ref",
  ".badge",
  ".warning__text",
  ".evidence__anchor",
];

function parseArgs(argv) {
  const options = { html: null, out: DEFAULT_OUT, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.json = true;
    else if (arg === "--out" || arg === "--out-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a directory`);
      options.out = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option: ${arg}`);
    else if (!options.html) options.html = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return options;
}

function usage() {
  console.log(`Usage: node scripts/visual-check.mjs <rendered.html> [--out <dir>] [--json]

  <rendered.html>  a page produced by: distilly view render <slug>
  --out <dir>      PNG output directory (default ${DEFAULT_OUT}; never committed)
  --json           print the machine-readable result

Exit code 0 only when all eight checks pass.`);
}

/** playwright is a dev dependency: resolve it from the usual places, else fail loudly. */
async function loadChromium() {
  const roots = [process.env.DISTILLY_PLAYWRIGHT_ROOT, ROOT, process.cwd()].filter(Boolean);
  for (const root of roots) {
    try {
      const require = createRequire(join(root, "index.cjs"));
      const resolved = require.resolve("playwright");
      const mod = await import(pathToFileURL(resolved).href);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch (error) {
      /* try the next root */
    }
  }
  try {
    const mod = await import("playwright");
    const chromium = mod.chromium ?? mod.default?.chromium;
    if (chromium) return chromium;
  } catch (error) {
    /* fall through to the loud failure below */
  }
  console.error("Error: the visual check needs playwright, which is a development dependency.");
  console.error("  npm install --no-save playwright   # or: pnpm add -D playwright");
  console.error("  DISTILLY_PLAYWRIGHT_ROOT=<dir with node_modules> node scripts/visual-check.mjs <html>");
  console.error("  distilly itself has zero runtime dependencies; nothing else needs playwright.");
  process.exit(2);
}

async function launch(chromium) {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch (error) {
    return chromium.launch();
  }
}

function record(id, name, ok, detail) {
  RESULTS.push({ id, name, ok: Boolean(ok), detail });
  return Boolean(ok);
}

/** Contrast of a node against its nearest opaque ancestor background, WCAG 2.x ratio. */
function contrastProbe(selectors) {
  const parse = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!match) return null;
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const background = (node) => {
    let current = node;
    while (current && current.nodeType === 1) {
      const colour = parse(getComputedStyle(current).backgroundColor);
      if (colour && colour.a > 0.5) return colour;
      current = current.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const ratio = (a, b) => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };

  const samples = [];
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (!node) {
      samples.push({ selector, missing: true });
      continue;
    }
    const style = getComputedStyle(node);
    const foreground = parse(style.color);
    const behind = background(node);
    samples.push({
      selector,
      fontSize: Number.parseFloat(style.fontSize),
      ratio: foreground ? Number(ratio(foreground, behind).toFixed(2)) : null,
      foreground: style.color,
      background: `rgb(${behind.r}, ${behind.g}, ${behind.b})`,
    });
  }
  return { theme: document.documentElement.getAttribute("data-theme-effective"), samples };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return 0;
  }
  if (!options.html) {
    usage();
    return 2;
  }
  const htmlPath = resolve(options.html);
  if (!existsSync(htmlPath)) {
    console.error(`Error: rendered page not found: ${htmlPath}`);
    console.error("  fix: distilly view render <slug>   (or pass the path of an existing views/<slug>.html)");
    return 2;
  }
  const outDir = resolve(options.out);
  mkdirSync(outDir, { recursive: true });
  const url = pathToFileURL(htmlPath).href;
  const ready = () => page.waitForFunction(() => document.documentElement.getAttribute("data-view-ready") === "true", null, { timeout: 15000 });

  const chromium = await loadChromium();
  const browser = await launch(chromium);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  const page = await context.newPage();

  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const requests = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleMessages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => pageErrors.push(String(error && error.message ? error.message : error)));
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText ?? null }));
  page.on("request", (request) => requests.push({ url: request.url(), type: request.resourceType() }));

  const pngs = [];
  const screenshot = async (name) => {
    const file = join(outDir, name);
    await page.screenshot({ path: file, fullPage: true });
    pngs.push({ file, bytes: statSync(file).size });
  };

  try {
    await page.goto(url, { waitUntil: "load" });
    await ready();

    /* 1 — console silence ------------------------------------------------ */
    record(
      "console",
      "console has no error/warning, no page error, no failed request",
      consoleMessages.length === 0 && pageErrors.length === 0 && failedRequests.length === 0,
      { messages: consoleMessages, pageErrors, failedRequests },
    );

    /* 2 — eight non-empty segments --------------------------------------- */
    const segments = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("[data-section]")].map((node) => ({
        id: node.getAttribute("data-section"),
        chars: (node.textContent || "").trim().length,
        items: node.querySelectorAll(".claim, .warning, .timeline__item, .evidence").length,
      }));
      const view = window.DistillyView || {};
      return {
        rows,
        payloadAnchors: view.view && Array.isArray(view.view.evidence) ? view.view.evidence.length : 0,
        appendixAnchors: document.querySelectorAll('[data-section="evidence"] .evidence[data-anchor]').length,
        shareable: Boolean(view.shareable),
        quotesRendered: document.querySelectorAll(".quote[data-inlined]").length,
      };
    });
    const emptySegments = segments.rows.filter((entry) => entry.chars < 8);
    record(
      "segments",
      "the eight page segments exist and are non-empty",
      segments.rows.length === 8 && emptySegments.length === 0 && segments.appendixAnchors > 0,
      {
        count: segments.rows.length,
        empty: emptySegments.map((entry) => entry.id),
        rows: segments.rows,
        shareable: segments.shareable,
        quotesRendered: segments.quotesRendered,
      },
    );

    /* 3 — no horizontal overflow ---------------------------------------- */
    const overflow = [];
    for (const width of [1280, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      const measured = await page.evaluate(() => {
        const limit = window.innerWidth + 1;
        const offenders = [];
        for (const node of document.querySelectorAll("body *")) {
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.right > limit) {
            offenders.push({
              tag: node.tagName.toLowerCase(),
              cls: String(node.className || "").slice(0, 60),
              right: Math.round(rect.right),
            });
          }
        }
        return { delta: document.documentElement.scrollWidth - window.innerWidth, offenders: offenders.slice(0, 5) };
      });
      overflow.push({ width, delta: measured.delta, offenders: measured.offenders });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    record(
      "overflow",
      "no horizontal overflow at 1280/768/375 px",
      overflow.every((entry) => entry.delta <= 1),
      overflow,
    );

    /* 4 — dual theme contrast ------------------------------------------- */
    const themeRuns = [];
    // `emulateMedia` resolves as soon as the emulation is applied; the page learns
    // about it through a `matchMedia` change event and updates
    // `data-theme-effective` a tick later. Probing immediately recorded the
    // *previous* theme — which is how this gate went red roughly one run in two
    // with byte-identical HTML (same sha256), and why the toggle then saw
    // `before: "dark"` after being put back into light mode.
    const settle = (scheme) =>
      page
        .waitForFunction(
          (expected) => {
            const current = document.documentElement.getAttribute("data-theme-effective");
            return current === null || current === expected;
          },
          scheme,
          { timeout: 2000 },
        )
        .catch(() => {});
    await page.emulateMedia({ colorScheme: "light" });
    await settle("light");
    themeRuns.push(await page.evaluate(contrastProbe, SAMPLE_SELECTORS));
    await page.emulateMedia({ colorScheme: "dark" });
    await settle("dark");
    themeRuns.push(await page.evaluate(contrastProbe, SAMPLE_SELECTORS));
    await page.emulateMedia({ colorScheme: "light" });
    await settle("light");
    const toggle = await page.evaluate(() => {
      const button = document.getElementById("theme-toggle");
      if (!button) return { ok: false, reason: "no #theme-toggle button" };
      const before = document.documentElement.getAttribute("data-theme-effective");
      button.click();
      return { ok: null, before, after: null, pressed: button.getAttribute("aria-pressed"), label: button.textContent };
    });
    // The click is handled by the page, so its effect is also a tick away.
    toggle.after = await page
      .waitForFunction(
        (before) => document.documentElement.getAttribute("data-theme-effective") !== before,
        toggle.before,
        { timeout: 2000 },
      )
      .then(() => page.evaluate(() => document.documentElement.getAttribute("data-theme-effective")))
      .catch(() => page.evaluate(() => document.documentElement.getAttribute("data-theme-effective")));
    toggle.pressed = await page.evaluate(() => document.getElementById("theme-toggle")?.getAttribute("aria-pressed") ?? null);
    toggle.ok = toggle.before === "light" && toggle.after === "dark";
    themeRuns.push(await page.evaluate(contrastProbe, SAMPLE_SELECTORS));
    const contrastFailures = [];
    for (const run of themeRuns) {
      for (const sample of run.samples) {
        if (sample.missing) contrastFailures.push({ ...sample, theme: run.theme, reason: "sample element missing" });
        else if (sample.ratio !== null && sample.ratio < 4.5 && sample.fontSize < 24) {
          contrastFailures.push({ ...sample, theme: run.theme, reason: "contrast below 4.5:1" });
        }
      }
    }
    record(
      "theme",
      "dual theme (system + manual) with >= 4.5:1 contrast samples",
      contrastFailures.length === 0 && toggle.ok === true && new Set(themeRuns.map((run) => run.theme)).size >= 2,
      { runs: themeRuns, toggle, failures: contrastFailures },
    );
    await page.emulateMedia({ colorScheme: "light" });
    await page.evaluate(() => {
      const button = document.getElementById("theme-toggle");
      if (button && document.documentElement.getAttribute("data-theme-effective") === "dark") button.click();
    });

    /* 5 — anchors resolve into the appendix ------------------------------ */
    const anchorIds = await page.evaluate(() =>
      [...document.querySelectorAll('[data-section="evidence"] .evidence[data-anchor]')].map((node) => node.getAttribute("data-anchor")),
    );
    const anchorProblems = [];
    for (const anchor of anchorIds) {
      await page.evaluate((id) => {
        window.location.hash = `#anchor-${id}`;
      }, anchor);
      await page.waitForTimeout(40);
      const outcome = await page.evaluate((id) => {
        const node = document.getElementById(`anchor-${id}`);
        if (!node) return { id, ok: false, reason: "no element with that id" };
        const rect = node.getBoundingClientRect();
        return {
          id,
          ok: true,
          inAppendix: Boolean(node.closest('[data-section="evidence"]')),
          focused: document.activeElement === node,
          visible: rect.top < window.innerHeight && rect.bottom > 0,
          backLinks: node.querySelectorAll('a[href^="#section-"]').length,
        };
      }, anchor);
      if (!outcome.ok || !outcome.inAppendix || !outcome.focused || !outcome.visible || outcome.backLinks === 0) {
        anchorProblems.push(outcome);
      }
    }
    await page.evaluate(() => {
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch (error) {
        window.location.hash = "";
      }
    });
    record(
      "anchors",
      "each evidence anchor locates a focusable row in the appendix",
      anchorIds.length > 0 && anchorIds.length === segments.payloadAnchors && anchorProblems.length === 0,
      { anchors: anchorIds.length, payloadAnchors: segments.payloadAnchors, problems: anchorProblems },
    );

    /* 6 — zero network requests ----------------------------------------- */
    const staticRefs = await page.evaluate(() => {
      const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      return {
        csp: csp ? csp.getAttribute("content") : null,
        externalLinks: document.querySelectorAll('link[href]:not([href^="data:"])').length,
        externalScripts: document.querySelectorAll("script[src]").length,
        externalImages: document.querySelectorAll('img[src]:not([src^="data:"])').length,
        embeds: document.querySelectorAll("iframe, object, embed").length,
        urls: (document.documentElement.outerHTML.match(/https?:\/\/[^\s"'<>]+/g) || []).filter(
          (value) => !value.includes("www.w3.org"),
        ),
      };
    });
    const externalRequests = requests.filter(
      (entry) => !entry.url.startsWith("file:") && !entry.url.startsWith("data:") && !entry.url.startsWith("blob:"),
    );
    record(
      "offline",
      "zero network requests, frozen CSP present, no external reference",
      externalRequests.length === 0 &&
        Boolean(staticRefs.csp && staticRefs.csp.includes("default-src 'none'")) &&
        staticRefs.externalLinks === 0 &&
        staticRefs.externalScripts === 0 &&
        staticRefs.externalImages === 0 &&
        staticRefs.embeds === 0 &&
        staticRefs.urls.length === 0,
      { requests: requests.length, externalRequests, staticRefs },
    );

    /* 7 — print media does not clip -------------------------------------- */
    await page.emulateMedia({ media: "print" });
    const printReport = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("[data-section]")];
      const clipped = [];
      let sectionText = 0;
      for (const node of nodes) {
        const style = getComputedStyle(node);
        sectionText += (node.textContent || "").length;
        if (style.display === "none" || style.visibility === "hidden") {
          clipped.push({ id: node.getAttribute("data-section"), reason: "hidden in print" });
          continue;
        }
        if (node.scrollWidth > node.clientWidth + 2) {
          clipped.push({ id: node.getAttribute("data-section"), reason: "horizontal clip", scrollWidth: node.scrollWidth, clientWidth: node.clientWidth });
        }
        if (node.scrollHeight > node.clientHeight + 2) {
          clipped.push({ id: node.getAttribute("data-section"), reason: "vertical clip", scrollHeight: node.scrollHeight, clientHeight: node.clientHeight });
        }
      }
      return { segments: nodes.length, clipped, sectionText, overflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    await screenshot("view-print.png");
    await page.emulateMedia({ media: "screen" });
    const screenReport = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("[data-section]")];
      let sectionText = 0;
      for (const node of nodes) sectionText += (node.textContent || "").length;
      return { sectionText, segments: nodes.length };
    });
    record(
      "print",
      "@media print does not clip or drop content",
      printReport.clipped.length === 0 &&
        printReport.segments === 8 &&
        printReport.overflow <= 1 &&
        printReport.sectionText === screenReport.sectionText,
      { ...printReport, screenSectionText: screenReport.sectionText, screenSegments: screenReport.segments },
    );

    /* 8 — PNG evidence --------------------------------------------------- */
    await page.goto(`${url}?theme=light`, { waitUntil: "load" });
    await ready();
    await page.setViewportSize({ width: 1280, height: 900 });
    await screenshot("view-light.png");
    await page.goto(`${url}?theme=dark`, { waitUntil: "load" });
    await ready();
    await screenshot("view-dark.png");
    // Three PNGs: print, light, dark. The 375 px capture was dropped on request —
    // the narrow-viewport *check* stays (it is check 3, at 1280/768/375), so a
    // layout that breaks on a phone still fails; only the picture goes away.
    record(
      "png",
      "PNG evidence written to the output directory (print + light + dark)",
      pngs.length >= 3 && pngs.every((entry) => entry.bytes > 1024),
      { outDir, pngs },
    );

    const failed = RESULTS.filter((entry) => !entry.ok);
    const payload = {
      command: "visual-check",
      ok: failed.length === 0,
      html: htmlPath,
      html_sha256: createHash("sha256").update(readFileSync(htmlPath)).digest("hex"),
      html_bytes: statSync(htmlPath).size,
      out_dir: outDir,
      shareable: segments.shareable,
      appendix_anchors: segments.appendixAnchors,
      checks: RESULTS,
      pngs,
      failed: failed.map((entry) => entry.id),
      checks_passed: RESULTS.length - failed.length,
      checks_total: RESULTS.length,
    };

    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else {
      for (const entry of RESULTS) {
        console.log(`${entry.ok ? "PASS" : "FAIL"}  ${entry.id.padEnd(9)} ${entry.name}`);
        if (!entry.ok) console.log(`      detail: ${JSON.stringify(entry.detail)}`);
      }
      console.log(`  input: ${htmlPath} (${payload.html_bytes} bytes, sha256 ${payload.html_sha256})`);
    }
    console.log(
      failed.length === 0
        ? `visual-check: PASS — ${RESULTS.length}/8 checks, PNGs in ${outDir} (${pngs.map((entry) => entry.file.split("/").pop()).join(", ")})`
        : `visual-check: FAIL — ${failed.length}/${RESULTS.length} checks failed: ${failed.map((entry) => entry.id).join(", ")}`,
    );
    return failed.length === 0 ? 0 : 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

// Only run when invoked directly. `tests/visual-check-rule.test.mjs` imports this
// module for its checks, and an unguarded `main()` launched a browser and printed
// the usage text during that import — which made the whole test *file* fail rather
// than any single assertion in it.
if (isEntryPoint(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`Error: ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  }
}
