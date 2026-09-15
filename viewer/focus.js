/* Distilly viewer fragment: keyboard reachability and anchor focus behaviour.
   Anchor ids can contain ':' (k0012:t3), so every lookup goes through getElementById. */
(function () {
  "use strict";

  var HIGHLIGHT = "is-focused";
  var LABELS = {
    zh: { jumped: "已定位到 {what}", back: "返回引用处", skipped: "已跳到正文" },
    en: { jumped: "Jumped to {what}", back: "Back to the reference", skipped: "Skipped to content" }
  };

  function labels() {
    var lang = document.documentElement.getAttribute("lang") || "zh";
    return lang.toLowerCase().indexOf("en") === 0 ? LABELS.en : LABELS.zh;
  }

  function status(message) {
    var node = document.getElementById("action-status");
    if (node) node.textContent = message;
  }

  function targetFromHash(hash) {
    var raw = String(hash || "").replace(/^#/, "");
    if (raw === "") return null;
    try {
      return document.getElementById(decodeURIComponent(raw));
    } catch (error) {
      return document.getElementById(raw);
    }
  }

  function describe(node) {
    if (!node) return "";
    if (node.hasAttribute("data-anchor")) return "证据 " + node.getAttribute("data-anchor");
    var heading = node.querySelector ? node.querySelector(".section__title") : null;
    if (heading) return heading.textContent || "";
    return node.id || "";
  }

  function clearHighlights() {
    var marked = document.querySelectorAll("." + HIGHLIGHT);
    for (var index = 0; index < marked.length; index += 1) {
      marked[index].classList.remove(HIGHLIGHT);
    }
    var active = document.querySelectorAll(".anchor-ref.is-active");
    for (var i = 0; i < active.length; i += 1) active[i].classList.remove("is-active");
  }

  function focusTarget(node, announce) {
    if (!node) return false;
    clearHighlights();
    if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
    node.classList.add(HIGHLIGHT);
    try {
      node.focus({ preventScroll: true });
    } catch (error) {
      node.focus();
    }
    if (typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "start", behavior: "auto" });
    }
    if (announce) status(labels().jumped.replace("{what}", describe(node)));
    return true;
  }

  function bindAnchorRefs() {
    var refs = document.querySelectorAll(".anchor-ref[data-anchor-ref]");
    for (var index = 0; index < refs.length; index += 1) {
      var ref = refs[index];
      ref.addEventListener("focus", function (event) {
        event.currentTarget.classList.add("is-active");
      });
      ref.addEventListener("blur", function (event) {
        event.currentTarget.classList.remove("is-active");
      });
      ref.addEventListener("click", function (event) {
        var anchor = event.currentTarget.getAttribute("data-anchor-ref");
        var node = document.getElementById("anchor-" + anchor);
        if (node) {
          event.preventDefault();
          focusTarget(node, true);
          if (window.history && typeof window.history.replaceState === "function") {
            window.history.replaceState(null, "", "#anchor-" + anchor);
          }
        }
      });
    }

    var backs = document.querySelectorAll('.evidence__meta a[href^="#section-"]');
    for (var i = 0; i < backs.length; i += 1) {
      backs[i].setAttribute("title", labels().back);
    }
  }

  function bindSkipLink() {
    var link = document.querySelector(".skip-link");
    var main = document.getElementById("main");
    if (!link || !main) return;
    link.addEventListener("click", function () {
      focusTarget(main, false);
      status(labels().skipped);
    });
  }

  function bindEscape() {
    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") return;
      var active = document.activeElement;
      if (!active || active === document.body) return;
      if (active.classList && (active.classList.contains(HIGHLIGHT) || active.classList.contains("anchor-ref"))) {
        clearHighlights();
        if (typeof active.blur === "function") active.blur();
      }
    });
  }

  function boot() {
    bindSkipLink();
    bindAnchorRefs();
    bindEscape();
    if (window.location.hash) focusTarget(targetFromHash(window.location.hash), false);
    window.addEventListener("hashchange", function () {
      focusTarget(targetFromHash(window.location.hash), true);
    });
    document.documentElement.setAttribute("data-focus-bound", "true");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
