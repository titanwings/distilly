/* Distilly viewer fragment: offline export actions (print, Markdown copy, HTML snapshot).
   No network is used; a download is built from the current document itself. */
(function () {
  "use strict";

  var LABELS = {
    zh: {
      copied: "已复制 Markdown 摘要（{n} 字符）",
      copyFailed: "复制失败：请手动选择页面内容。",
      downloaded: "已生成 HTML 快照（浏览器下载目录）。",
      downloadFailed: "下载失败：可用「打印 / 导出 PDF」代替。",
      printing: "已调用打印对话框；选择「存储为 PDF」即可保存。",
      unavailable: "页面数据缺失，导出内容为空。"
    },
    en: {
      copied: "Markdown summary copied ({n} characters).",
      copyFailed: "Copy failed: please select the page content manually.",
      downloaded: "HTML snapshot written to your downloads folder.",
      downloadFailed: "Download failed: use Print / Export PDF instead.",
      printing: "Print dialog requested; choose \"Save as PDF\".",
      unavailable: "No page data: nothing to export."
    }
  };

  function labels() {
    var lang = document.documentElement.getAttribute("lang") || "zh";
    return lang.toLowerCase().indexOf("en") === 0 ? LABELS.en : LABELS.zh;
  }

  function status(message) {
    var node = document.getElementById("action-status");
    if (node) node.textContent = message;
  }

  function view() {
    return window.DistillyView && window.DistillyView.view ? window.DistillyView.view : null;
  }

  function asArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]" ? value : [];
  }

  function anchorText(anchors) {
    var list = asArray(anchors);
    if (list.length === 0) return "";
    return " `" + list.join("` `") + "`";
  }

  function toMarkdown(source) {
    if (!source) return "";
    var meta = source.meta || {};
    var lines = ["# " + (meta.title || meta.slug || "Person View"), ""];
    if (meta.slug) lines.push("- slug: `" + meta.slug + "`");
    if (meta.generated_at) lines.push("- generated_at: " + meta.generated_at);
    lines.push("- shareable: " + (source.shareable === true ? "true" : "false"));
    lines.push("");

    asArray(source.sections).forEach(function (section, index) {
      lines.push("## " + (index + 1) + ". " + (section.title || section.id));
      if (section.summary) lines.push("", String(section.summary));
      lines.push("");
      asArray(section.items).forEach(function (item) {
        var prefix = section.kind === "timeline" ? "- " + (item.at || "—") + " · " : "- ";
        var suffix = item.confidence ? " (" + item.confidence + ")" : "";
        lines.push(prefix + item.text + suffix + anchorText(item.anchors));
      });
      lines.push("");
    });

    var evidence = asArray(source.evidence);
    lines.push("## " + (evidence.length > 0 ? "证据附录 / Evidence appendix" : "证据附录"), "");
    evidence.forEach(function (entry) {
      var where = [];
      if (entry.source) where.push(entry.source);
      if (entry.kind) where.push(entry.kind);
      if (entry.at) where.push(entry.at);
      if (entry.path) where.push(entry.path);
      lines.push("- `" + entry.anchor + "` — " + where.join(" · ") + (entry.note ? " — " + entry.note : ""));
      if (source.shareable === true && entry.quote) lines.push("  > " + String(entry.quote).replace(/\n/g, " "));
    });
    lines.push("");
    return lines.join("\n");
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "readonly");
    area.className = "visually-hidden";
    area.setAttribute("aria-hidden", "true");
    document.body.appendChild(area);
    var ok = false;
    try {
      area.select();
      ok = document.execCommand("copy");
    } catch (error) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function download() {
    var text = "<!doctype html>\n" + document.documentElement.outerHTML;
    var name = ((view() && view().meta && view().meta.slug) || "distilly-view") + ".html";
    var link = document.createElement("a");
    link.setAttribute("download", name);
    link.className = "visually-hidden";
    link.setAttribute("aria-hidden", "true");
    var url = "";
    try {
      var blob = new Blob([text], { type: "text/html;charset=utf-8" });
      url = URL.createObjectURL(blob);
      link.href = url;
    } catch (error) {
      link.href = "data:text/html;charset=utf-8," + encodeURIComponent(text);
    }
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (url) window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    return true;
  }

  function bind(id, handler) {
    var node = document.getElementById(id);
    if (!node) return;
    node.addEventListener("click", function () {
      var text = labels();
      try {
        handler(text);
      } catch (error) {
        status(text.copyFailed);
      }
    });
  }

  function boot() {
    bind("export-print", function (text) {
      status(text.printing);
      window.print();
    });

    bind("export-copy", function (text) {
      var markdown = toMarkdown(view());
      if (markdown === "") {
        status(text.unavailable);
        return;
      }
      Promise.resolve(copyText(markdown)).then(function (ok) {
        status(ok ? text.copied.replace("{n}", String(markdown.length)) : text.copyFailed);
      });
    });

    bind("export-html", function (text) {
      var ok = false;
      try {
        ok = download();
      } catch (error) {
        ok = false;
      }
      status(ok ? text.downloaded : text.downloadFailed);
    });

    window.DistillyExport = { toMarkdown: toMarkdown, version: 1 };
    document.documentElement.setAttribute("data-export-bound", "true");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
