/* Distilly viewer fragment: renders the eight page sections from the embedded view.json.
   Classic script (no modules, no network). Text only: every value is written with
   textContent, so a hostile view.json cannot inject markup. */
(function () {
  "use strict";

  var DATA_ID = "distilly-view-data";
  var ROOT_SELECTOR = "[data-sections-root]";

  var LABELS = {
    zh: {
      confidence: { high: "高置信", medium: "中置信", low: "低置信" },
      severity: { high: "雷区·高", medium: "雷区·中", low: "雷区·低" },
      claims: "条结论",
      timeline: "个节点",
      warnings: "条边界",
      evidence: "条锚点",
      anchorLabel: "查看证据 ",
      citedBy: "被引用",
      where: "出处",
      digest: "校验",
      quote: "原文",
      empty: "本节没有可展示的内容。",
      noData: "尚未嵌入 view.json 数据；这是一份可直接打开的模板。",
      privacyPrivate: "默认私有：本页只显示结论与锚点编号，不内联任何原始引文。",
      privacyShareable: "可分享模式：本页内联了下列来源的原文引文，请自行确认分享范围。",
      appendixTitle: "证据附录",
      appendixNote: "编号可在 knowledge/index.json 回指；点编号可从结论跳到此处。",
      quotedSources: "内联来源",
      footer: "渲染器不产生事实：所有结论与锚点均来自 view.json 与知识账本。"
    },
    en: {
      confidence: { high: "high confidence", medium: "medium confidence", low: "low confidence" },
      severity: { high: "red line · high", medium: "red line · medium", low: "red line · low" },
      claims: "claims",
      timeline: "milestones",
      warnings: "boundaries",
      evidence: "anchors",
      anchorLabel: "Show evidence ",
      citedBy: "cited by",
      where: "source",
      digest: "digest",
      quote: "quote",
      empty: "This section has nothing to show.",
      noData: "No view.json payload is embedded; this file is the openable template itself.",
      privacyPrivate: "Private by default: conclusions and anchor ids only, no source wording.",
      privacyShareable: "Shareable mode: verbatim quotes from the sources below are inlined.",
      appendixTitle: "Evidence appendix",
      appendixNote: "Anchor ids trace back to knowledge/index.json.",
      quotedSources: "inlined sources",
      footer: "The renderer invents nothing: every claim and anchor comes from view.json."
    }
  };

  var DEFAULT_TITLES = [
    { id: "portrait", zh: "一句话画像", en: "One-line portrait" },
    { id: "communication", zh: "沟通风格", en: "Communication style" },
    { id: "values", zh: "决策与价值观", en: "Decisions and values" },
    { id: "workstyle", zh: "工作方式", en: "Working style" },
    { id: "relationship", zh: "关系与称呼", en: "Relationship and address" },
    { id: "boundaries", zh: "边界与雷区", en: "Boundaries and red lines" },
    { id: "timeline", zh: "时间线演变", en: "Timeline" }
  ];

  function readView() {
    var node = document.getElementById(DATA_ID);
    if (!node) return null;
    var raw = (node.textContent || "").trim();
    if (raw === "" || raw === "null") return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function labelsFor(view) {
    var lang = view && view.meta && typeof view.meta.lang === "string" ? view.meta.lang : "zh";
    return lang.toLowerCase().indexOf("en") === 0 ? LABELS.en : LABELS.zh;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function asArray(value) {
    return Object.prototype.toString.call(value) === "[object Array]" ? value : [];
  }

  function anchorRef(anchor, label) {
    var link = el("a", "anchor-ref", String(anchor));
    link.setAttribute("href", "#anchor-" + String(anchor));
    link.setAttribute("data-anchor-ref", String(anchor));
    link.setAttribute("aria-label", label + String(anchor));
    return link;
  }

  function confidenceBadge(level, labels) {
    var known = Object.prototype.hasOwnProperty.call(labels.confidence, level) ? level : "low";
    var badge = el("span", "badge badge--" + known, labels.confidence[known]);
    badge.setAttribute("data-confidence", known);
    return badge;
  }

  function sectionShell(spec, index) {
    var section = el("section", "section");
    section.id = "section-" + spec.id;
    section.setAttribute("data-section", spec.id);
    section.setAttribute("data-section-index", String(index + 1));
    section.setAttribute("aria-labelledby", "heading-" + spec.id);

    var head = el("div", "section__head");
    var number = el("span", "section__index", String(index + 1).padStart(2, "0"));
    number.setAttribute("aria-hidden", "true");
    var title = el("h2", "section__title", spec.title);
    title.id = "heading-" + spec.id;
    head.appendChild(number);
    head.appendChild(title);
    head.appendChild(el("span", "section__count", spec.count));
    section.appendChild(head);

    if (spec.summary) section.appendChild(el("p", "section__summary", spec.summary));
    return section;
  }

  function renderClaims(section, spec, view, labels, citations) {
    var list = el("ul", "claims");
    spec.items.forEach(function (item) {
      var row = el("li", "claim");
      if (item.emphasis === true) row.className = "claim is-emphasis";
      row.setAttribute("data-confidence", item.confidence);
      row.appendChild(el("p", "claim__text", item.text));
      var meta = el("ul", "claim__meta");
      meta.appendChild(confidenceBadge(item.confidence, labels));
      asArray(item.anchors).forEach(function (anchor) {
        var li = el("li");
        li.appendChild(anchorRef(anchor, labels.anchorLabel));
        meta.appendChild(li);
        if (!citations[anchor]) citations[anchor] = [];
        citations[anchor].push({ id: spec.id, title: spec.title });
      });
      row.appendChild(meta);
      list.appendChild(row);
    });
    section.appendChild(list);
  }

  function renderWarnings(section, spec, view, labels, citations) {
    var list = el("ul", "warnings");
    spec.items.forEach(function (item) {
      var row = el("li", "warning");
      row.setAttribute("data-severity", item.severity || "medium");
      row.appendChild(el("p", "warning__text", item.text));
      var meta = el("ul", "warning__meta");
      var severity = Object.prototype.hasOwnProperty.call(labels.severity, item.severity)
        ? item.severity
        : "medium";
      var badge = el("span", "badge badge--severity", labels.severity[severity]);
      badge.setAttribute("data-severity", severity);
      meta.appendChild(badge);
      meta.appendChild(confidenceBadge(item.confidence, labels));
      asArray(item.anchors).forEach(function (anchor) {
        var li = el("li");
        li.appendChild(anchorRef(anchor, labels.anchorLabel));
        meta.appendChild(li);
        if (!citations[anchor]) citations[anchor] = [];
        citations[anchor].push({ id: spec.id, title: spec.title });
      });
      row.appendChild(meta);
      list.appendChild(row);
    });
    section.appendChild(list);
  }

  function renderTimeline(section, spec, view, labels, citations) {
    var list = el("ol", "timeline");
    spec.items.forEach(function (item) {
      var row = el("li", "timeline__item");
      row.setAttribute("data-confidence", item.confidence);
      var at = el("span", "timeline__at", item.at || "—");
      row.appendChild(at);
      row.appendChild(el("span", "timeline__text", item.text));
      var meta = el("ul", "timeline__meta");
      meta.appendChild(confidenceBadge(item.confidence, labels));
      asArray(item.anchors).forEach(function (anchor) {
        var li = el("li");
        li.appendChild(anchorRef(anchor, labels.anchorLabel));
        meta.appendChild(li);
        if (!citations[anchor]) citations[anchor] = [];
        citations[anchor].push({ id: spec.id, title: spec.title });
      });
      row.appendChild(meta);
      list.appendChild(row);
    });
    section.appendChild(list);
  }

  function renderEvidenceItem(entry, labels, citations, shareable) {
    var row = el("li", "evidence");
    row.id = "anchor-" + entry.anchor;
    row.setAttribute("data-anchor", entry.anchor);
    row.setAttribute("tabindex", "-1");

    var head = el("div", "evidence__head");
    head.appendChild(el("span", "evidence__anchor", entry.anchor));
    head.appendChild(el("span", "badge badge--kind", entry.kind || "source"));
    head.appendChild(el("span", "badge", entry.source || "unknown"));
    if (entry.at) head.appendChild(el("span", "evidence__at", entry.at));
    row.appendChild(head);

    if (entry.note) row.appendChild(el("p", "evidence__why", entry.note));

    if (shareable && entry.quote) {
      var quote = el("blockquote", "quote", entry.quote);
      quote.setAttribute("data-inlined", "true");
      row.appendChild(quote);
      row.appendChild(el("p", "quote__note", labels.quote + " · " + (entry.source || "unknown")));
    }

    var where = [];
    if (entry.path) where.push(labels.where + ": " + entry.path);
    if (entry.id) where.push("id: " + entry.id);
    if (entry.sha256) where.push(labels.digest + ": " + String(entry.sha256).slice(0, 12));
    if (where.length > 0) row.appendChild(el("p", "evidence__where", where.join(" · ")));

    var cited = citations[entry.anchor] || [];
    if (cited.length > 0) {
      var meta = el("ul", "evidence__meta");
      meta.appendChild(el("li", null, labels.citedBy));
      cited.forEach(function (ref) {
        var li = el("li");
        var link = el("a", null, ref.title);
        link.setAttribute("href", "#section-" + ref.id);
        li.appendChild(link);
        meta.appendChild(li);
      });
      row.appendChild(meta);
    }
    return row;
  }

  function appendixSpec(view, labels) {
    return {
      id: "evidence",
      title: labels.appendixTitle,
      summary: labels.appendixNote,
      items: asArray(view.evidence)
    };
  }

  function renderInto(root, view) {
    var labels = labelsFor(view);
    root.textContent = "";

    if (!view) {
      var state = el("section", "section", labels.noData);
      state.setAttribute("data-section", "empty");
      root.appendChild(state);
      return { sections: 0, anchors: 0 };
    }

    var specs = [];
    var citations = {};
    asArray(view.sections).forEach(function (raw) {
      var id = String(raw && raw.id ? raw.id : "");
      var fallback = DEFAULT_TITLES.filter(function (entry) { return entry.id === id; })[0];
      var items = asArray(raw && raw.items);
      specs.push({
        id: id,
        kind: String(raw && raw.kind ? raw.kind : "claims"),
        title: String(raw && raw.title ? raw.title : (fallback ? fallback.zh : id)),
        summary: raw && raw.summary ? String(raw.summary) : "",
        items: items,
        count: ""
      });
    });

    var appendix = appendixSpec(view, labels);
    appendix.count = String(appendix.items.length) + " " + labels.evidence;
    specs.push(appendix);

    specs.forEach(function (spec, index) {
      if (!spec.count) {
        var unit = spec.kind === "timeline" ? labels.timeline
          : spec.kind === "warnings" ? labels.warnings : labels.claims;
        spec.count = String(spec.items.length) + " " + unit;
      }
    });

    var holder = document.createDocumentFragment();
    specs.forEach(function (spec, index) {
      var section = sectionShell(spec, index);
      if (spec.id === "evidence") {
        section.className = "section section--evidence";
        var list = el("ol", "appendix");
        spec.items.forEach(function (entry) {
          list.appendChild(renderEvidenceItem(entry, labels, citations, view.shareable === true));
        });
        section.appendChild(list);
      } else if (spec.kind === "timeline") {
        renderTimeline(section, spec, view, labels, citations);
      } else if (spec.kind === "warnings") {
        renderWarnings(section, spec, view, labels, citations);
      } else {
        renderClaims(section, spec, view, labels, citations);
      }
      holder.appendChild(section);
    });

    root.appendChild(holder);
    var count = root.querySelectorAll("[data-section]").length;
    var anchors = root.querySelectorAll(".evidence[data-anchor]").length;
    return { sections: count, anchors: anchors, citations: citations };
  }

  function renderToc(view, labels) {
    var toc = document.getElementById("toc");
    if (!toc) return;
    toc.textContent = "";
    if (!view) return;
    var heading = el("h2", null, document.documentElement.lang.indexOf("en") === 0 ? "Contents" : "目录");
    var list = el("ol");
    var specs = asArray(view.sections).concat([appendixSpec(view, labels)]);
    specs.forEach(function (spec, index) {
      var fallback = DEFAULT_TITLES.filter(function (entry) { return entry.id === spec.id; })[0];
      var li = el("li");
      var link = el("a");
      link.setAttribute("href", "#section-" + spec.id);
      link.appendChild(el("span", "toc__index", String(index + 1).padStart(2, "0")));
      link.appendChild(document.createTextNode(spec.title || (fallback ? fallback.zh : spec.id)));
      li.appendChild(link);
      list.appendChild(li);
    });
    toc.appendChild(heading);
    toc.appendChild(list);
  }

  function renderHeader(view, labels) {
    var title = document.getElementById("page-title");
    var subtitle = document.getElementById("page-subtitle");
    var meta = document.getElementById("page-meta");
    var note = document.getElementById("privacy-note");
    var footer = document.getElementById("footer-note");
    if (footer) footer.textContent = labels.footer;

    if (!view) {
      if (subtitle) subtitle.textContent = labels.noData;
      if (note) note.textContent = labels.privacyPrivate;
      return;
    }

    var meta_ = view.meta || {};
    var displayTitle = meta_.title || meta_.slug || "Person View";
    if (title) title.textContent = displayTitle;
    document.title = displayTitle + " · Distilly";
    if (subtitle) {
      subtitle.textContent = meta_.subtitle || (meta_.display_name ? meta_.display_name : meta_.slug || "");
    }
    if (meta) {
      meta.textContent = "";
      var parts = [];
      if (meta_.slug) parts.push("slug: " + meta_.slug);
      if (meta_.generated_at) parts.push("generated_at: " + meta_.generated_at);
      var appendix = appendixSpec(view, labels);
      parts.push("anchors: " + appendix.items.length);
      meta.textContent = parts.join(" · ");
    }
    if (note) note.textContent = view.shareable === true ? labels.privacyShareable : labels.privacyPrivate;
  }

  function boot() {
    var root = document.querySelector(ROOT_SELECTOR);
    var view = readView();
    var labels = labelsFor(view);
    renderHeader(view, labels);
    var result = root ? renderInto(root, view) : { sections: 0, anchors: 0 };
    renderToc(view, labels);
    window.DistillyView = {
      version: 1,
      view: view,
      labels: labels,
      shareable: Boolean(view && view.shareable === true),
      sections: result.sections || 0,
      anchors: result.anchors || 0,
      citations: result.citations || {}
    };
    document.documentElement.setAttribute("data-view-ready", "true");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
