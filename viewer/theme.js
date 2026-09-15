/* Distilly viewer fragment: dual theme (system preference + manual override).
   The palette lives in CSS (light-dark()); this file only flips the data-theme
   attribute on the root element. */
(function () {
  "use strict";

  var STORAGE_KEY = "distilly-view-theme";
  var MODES = ["auto", "light", "dark"];
  var LABELS = {
    zh: { toDark: "深色模式", toLight: "浅色模式", toSystem: "跟随系统", status: "主题：" },
    en: { toDark: "Dark mode", toLight: "Light mode", toSystem: "Follow system", status: "Theme: " }
  };

  function labels() {
    var lang = document.documentElement.getAttribute("lang") || "zh";
    return lang.toLowerCase().indexOf("en") === 0 ? LABELS.en : LABELS.zh;
  }

  function stored() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return MODES.indexOf(value) === -1 ? null : value;
    } catch (error) {
      return null;
    }
  }

  function remember(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
      /* file:// or a locked-down profile: the switch still works for this page view. */
    }
  }

  function requested() {
    var match = /[?&]theme=(auto|light|dark)(?:&|$)/.exec(window.location.search || "");
    return match ? match[1] : null;
  }

  function systemPrefersDark() {
    return Boolean(window.matchMedia) && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  var mode = requested() || stored() || "auto";

  function effective() {
    return mode === "auto" ? (systemPrefersDark() ? "dark" : "light") : mode;
  }

  function resetButton() {
    var existing = document.getElementById("theme-system");
    if (mode === "auto") {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    if (existing) return;
    var toggle = document.getElementById("theme-toggle");
    if (!toggle || !toggle.parentNode) return;
    var text = labels();
    var button = document.createElement("button");
    button.type = "button";
    button.id = "theme-system";
    button.className = "button button--quiet";
    button.textContent = text.toSystem;
    button.addEventListener("click", function () {
      apply("auto", true);
    });
    toggle.parentNode.insertBefore(button, toggle.nextSibling);
  }

  function apply(next, announce) {
    mode = MODES.indexOf(next) === -1 ? "auto" : next;
    var active = effective();
    document.documentElement.setAttribute("data-theme", mode);
    document.documentElement.setAttribute("data-theme-effective", active);
    remember(mode);

    var text = labels();
    var toggle = document.getElementById("theme-toggle");
    if (toggle) {
      var action = active === "dark" ? text.toLight : text.toDark;
      toggle.textContent = action;
      toggle.setAttribute("aria-pressed", active === "dark" ? "true" : "false");
      toggle.setAttribute("aria-label", action);
    }
    resetButton();
    if (announce) {
      var status = document.getElementById("action-status");
      if (status) status.textContent = text.status + active + (mode === "auto" ? " (" + text.toSystem + ")" : "");
    }
    document.documentElement.setAttribute("data-theme-ready", "true");
  }

  function boot() {
    apply(mode, false);
    var toggle = document.getElementById("theme-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        apply(effective() === "dark" ? "light" : "dark", true);
      });
    }
    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        if (mode === "auto") apply("auto", false);
      };
      if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
      else if (typeof query.addListener === "function") query.addListener(onChange);
    }
    document.documentElement.setAttribute("data-theme-bound", "true");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
