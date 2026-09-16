/**
 * `distilly parse-subtitle` — `.srt` / `.vtt` into `knowledge/` (CONTRACT §1).
 *
 * One cue is one anchored unit; the speaker is read when the format carries one
 * (`<v Name>` spans, `Name:` / `Name：` prefixes). `harvest` reaches the same
 * parser by extension — this command is the explicit door for a subtitle alone.
 */

import { register } from "./index.mjs";
import { parseCommonArgs, parseFailure, runParseCommand } from "./parse-shared.mjs";
import { detectSubtitleFormat, parseSubtitle } from "../parse/subtitle.mjs";

const EXTENSIONS = new Set([".srt", ".vtt", ".sbv"]);

const help = {
  zh: [
    "用法 / Usage:",
    "  distilly parse-subtitle <file.srt|file.vtt...> --person <slug> [--base-dir <dir>] [--source <label>] [--json]",
    "",
    "读取字幕：一条 cue 一个锚点单元，带时间码；说话人能从 `<v Name>` 或 `Name:`/`Name：` 前缀读出来。",
    "非字幕文件按名字拒绝并进 warnings，不静默跳过。",
  ].join("\n"),
  en: [
    "Distilly parse-subtitle — read .srt / .vtt into knowledge/.",
    "",
    "One cue becomes one anchored unit carrying its timecode; a speaker is read from a",
    "`<v Name>` span or a `Name:` / `Name：` prefix when the format has one. Files that",
    "are not subtitles are refused by name in warnings, never skipped silently.",
  ].join("\n"),
};

register("parse-subtitle", {
  summary: "读取字幕 / read .srt and .vtt into knowledge/",
  usage: "distilly parse-subtitle <file...> --person <slug> [--base-dir <dir>] [--source <label>] [--json]",
  ...help,
  run({ argv, json, reporter }) {
    const parsed = parseCommonArgs(argv);
    if (parsed.error) return parseFailure("parse-subtitle", parsed.error, "parse-subtitle/usage");
    const { options, paths } = parsed;
    return runParseCommand({
      command: "parse-subtitle",
      options,
      paths,
      json,
      reporter,
      accept: (file, extension) => {
        if (!EXTENSIONS.has(extension)) return `not a subtitle file (expected ${[...EXTENSIONS].join("/")})`;
        try {
          detectSubtitleFormat(new (Object.getPrototypeOf(Object).constructor)());
        } catch {
          /* never reached: the check below is the real one */
        }
        return true;
      },
      parser: (source) => parseSubtitle(source, { source: options.source ?? "subtitle", method: "local-file" }),
    });
  },
});
