// Content script — injected into every page at document_end.
// Responsibilities:
//   1. Display result dialogs (displayResult)
//   2. Show a floating ✦ button near text selections when the feature is enabled

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "displayResult") displayResult(message.lookup);
});

// ── Floating selection button ─────────────────────────────────────────────────
//
// A small ✦ button that appears just above selected text when enabled in settings.
// Clicking it runs the configured default prompt; the ▾ arrow opens a dropdown
// of all enabled selection-context prompts.
//
// Disabled by default — the user opts in via Options → Behavior.

let _cachedOptions        = null;  // invalidated whenever storage changes
let _loadingOptions       = false; // prevents duplicate in-flight storage reads
let _buttonPagePos        = null;  // page-coordinate anchor for the floating button
let _capturedText         = "";    // selected text at the moment the button appeared
let _capturedTitle        = "";
let _capturedURL          = "";
let _capturedEditable     = false; // whether the selection was inside an editable element
let _suppressSelectionHide = false; // true while a mousedown inside the button is in flight

function initFloatingButton() {
  // Inject hover/active styles for the floating button once per page.
  // Inline styles can't express :hover/:active, so a <style> tag is the only option.
  if (!document.getElementById("lcgpt-float-style")) {
    const s = document.createElement("style");
    s.id = "lcgpt-float-style";
    s.textContent = `
      #lcgpt-float-btn button:hover       { background: #f0f0f0 !important; }
      #lcgpt-float-btn button:active      { background: #ddd    !important; }
      .lcgpt-menu-item:hover,
      .lcgpt-menu-item--active            { background: #e8f0fe !important; }
    `;
    document.head.appendChild(s);
  }

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest("#lcgpt-float-btn")) {
      e.preventDefault(); // keeps text selection intact; click events still fire
      _suppressSelectionHide = true;
      return;
    }
    hideFloatingButton();
  });

  document.addEventListener("mouseup", onSelectionMouseUp);

  document.addEventListener("selectionchange", () => {
    if (_suppressSelectionHide) return;
    if (document.activeElement?.closest("#lcgpt-float-btn")) return;
    if (!window.getSelection()?.toString().trim()) hideFloatingButton();
  });

  document.addEventListener("scroll", updateFloatingButtonPosition, { passive: true });
  chrome.storage.onChanged.addListener(() => { _cachedOptions = null; });
}

function onSelectionMouseUp(e) {
  _suppressSelectionHide = false;
  if (e.target.closest("#lcgpt-float-btn, #lcgpt-result-container")) return;

  const sel  = window.getSelection();
  const text = sel?.toString().trim();
  if (!text) { hideFloatingButton(); return; }

  if (_cachedOptions !== null) {
    maybeShowFloatingButton(sel, _cachedOptions);
    return;
  }
  if (_loadingOptions) return;
  _loadingOptions = true;
  chrome.storage.local.get(null).then((opts) => {
    _cachedOptions  = opts;
    _loadingOptions = false;
    maybeShowFloatingButton(sel, opts);
  });
}

function maybeShowFloatingButton(sel, opts) {
  if (!opts.selectionButton?.enabled) return;

  const enabledPrompts = (opts.promptData || [])
    .map((p, i) => ({ ...p, id: i }))
    .filter((p) => p.enabled && (!p.context || p.context === "selection"));

  const defaultId     = opts.selectionButton.defaultPromptId ?? 0;
  const defaultPrompt = enabledPrompts.find((p) => p.id === defaultId) || enabledPrompts[0] || null;
  showFloatingButton(sel, enabledPrompts, defaultPrompt);
}

function showFloatingButton(sel, prompts, defaultPrompt) {
  let btn = document.getElementById("lcgpt-float-btn");
  if (!btn) {
    btn = document.createElement("div");
    btn.id = "lcgpt-float-btn";
    btn.style.cssText = [
      "position:fixed", "z-index:999998", "display:flex", "align-items:stretch",
      "background:white", "border:1px solid #ccc", "border-radius:4px",
      "box-shadow:0 2px 8px rgba(0,0,0,0.18)", "font-family:Arial,sans-serif",
      "font-size:12px", "cursor:default", "user-select:none", "color:#000",
    ].join(";");
    document.body.appendChild(btn);
  }

  const esc        = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const mainLabel  = defaultPrompt ? `✦ ${esc(defaultPrompt.title)}` : "✦ Ask…";

  btn.innerHTML = `
    <button id="lcgpt-float-main"  style="border:none;background:none;padding:4px 8px;cursor:pointer;font-size:12px;font-family:inherit;color:inherit">${mainLabel}</button>
    <button id="lcgpt-float-arrow" style="border:none;border-left:1px solid #ccc;background:none;padding:4px 6px;cursor:pointer;font-size:11px;color:inherit" title="Choose prompt">▾</button>
    <div    id="lcgpt-float-menu"  style="display:none;position:absolute;top:100%;left:0;min-width:220px;background:white;border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.18);z-index:1"></div>
  `;

  const menu = btn.querySelector("#lcgpt-float-menu");

  function openMenu() {
    menu.innerHTML = `
      <div style="padding:4px;border-bottom:1px solid #eee">
        <input id="lcgpt-float-search" type="text" autocomplete="off"
               placeholder="Type a question or filter prompts…"
               style="width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:3px;padding:3px 6px;font-size:12px;font-family:Arial,sans-serif;color:#000;background:#fff;outline:none;">
      </div>
      <div id="lcgpt-float-list" style="max-height:130px;overflow-y:auto;"></div>
    `;
    const searchInput = menu.querySelector("#lcgpt-float-search");
    const listEl      = menu.querySelector("#lcgpt-float-list");

    function renderList(filter) {
      const filtered = filter
        ? prompts.filter((p) => p.title.toLowerCase().includes(filter.toLowerCase()))
        : prompts;
      listEl.innerHTML = filtered.map((p) =>
        `<div class="lcgpt-menu-item" data-id="${p.id}" style="padding:5px 10px;cursor:pointer;color:#000;white-space:nowrap">${esc(p.title)}</div>`
      ).join("");
      listEl.querySelectorAll(".lcgpt-menu-item").forEach((item) => {
        item.addEventListener("mouseover", () => setHighlight(item));
        item.onclick = () => { hideFloatingButton(); runFloatingPrompt(parseInt(item.dataset.id)); };
      });
    }

    function getHighlighted() { return listEl.querySelector(".lcgpt-menu-item--active"); }

    function setHighlight(el) {
      listEl.querySelectorAll(".lcgpt-menu-item--active").forEach((i) => i.classList.remove("lcgpt-menu-item--active"));
      if (el) { el.classList.add("lcgpt-menu-item--active"); el.scrollIntoView({ block: "nearest" }); }
    }

    searchInput.addEventListener("input", () => { renderList(searchInput.value); setHighlight(null); });

    searchInput.addEventListener("keydown", (e) => {
      const items = [...listEl.querySelectorAll(".lcgpt-menu-item")];
      const hi    = getHighlighted();
      const idx   = hi ? items.indexOf(hi) : -1;

      if (e.key === "Escape") {
        e.preventDefault();
        menu.style.display = "none";
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (items.length) setHighlight(items[Math.min(idx + 1, items.length - 1)]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (idx <= 0) setHighlight(null); else setHighlight(items[idx - 1]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (hi) {
          hideFloatingButton();
          runFloatingPrompt(parseInt(hi.dataset.id));
        } else {
          const query = searchInput.value.trim();
          if (query) { hideFloatingButton(); runCustomQuery(query); }
        }
      }
    });

    renderList("");
    menu.style.display = "block";
    searchInput.focus();
  }

  btn.querySelector("#lcgpt-float-main").onclick = () => {
    if (defaultPrompt) { hideFloatingButton(); runFloatingPrompt(defaultPrompt.id); }
    else openMenu();
  };

  btn.querySelector("#lcgpt-float-arrow").onclick = (e) => {
    e.stopPropagation();
    if (menu.style.display === "none") openMenu(); else menu.style.display = "none";
  };

  // Capture selection context now — focus shifts when the button is clicked,
  // which clears window.getSelection() for contenteditable elements.
  _capturedText     = sel.toString();
  _capturedTitle    = document.title;
  _capturedURL      = location.href;
  _capturedEditable = isEditableElement(document.activeElement);

  // Store the page-coordinate anchor (above the selection) so the button can
  // follow the text when the page is scrolled.
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  _buttonPagePos = {
    x: Math.round(rect.left + window.scrollX),
    y: Math.round(rect.top  + window.scrollY) - 36,
  };
  btn.style.display = "flex";
  updateFloatingButtonPosition();
}

function updateFloatingButtonPosition() {
  if (!_buttonPagePos) return;
  const btn = document.getElementById("lcgpt-float-btn");
  if (!btn || btn.style.display === "none") return;
  const x = _buttonPagePos.x - window.scrollX;
  const y = _buttonPagePos.y - window.scrollY;
  // Hide once the anchor has scrolled well out of view
  if (y < -50 || y > window.innerHeight + 50) { hideFloatingButton(); return; }
  btn.style.left = `${x}px`;
  btn.style.top  = `${Math.max(4, y)}px`;
}

function hideFloatingButton() {
  const btn = document.getElementById("lcgpt-float-btn");
  if (btn) btn.style.display = "none";
  _buttonPagePos = null;
}

function isEditableElement(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  return tag === "textarea" || (tag === "input" && /^(text|search|url|email|tel)$/.test(el.type || "text"));
}

function runFloatingPrompt(promptId) {
  chrome.runtime.sendMessage({
    action:       "selection_button_click",
    promptId:     String(promptId),
    selectedText: _capturedText,
    pageTitle:    _capturedTitle,
    pageURL:      _capturedURL,
  });
}

function runCustomQuery(queryText) {
  chrome.runtime.sendMessage({
    action:       "custom_selection_query",
    queryText,
    selectedText: _capturedText,
    pageTitle:    _capturedTitle,
    pageURL:      _capturedURL,
    outputMode:   resolveCustomOutputMode(),
  });
}

function resolveCustomOutputMode() {
  const setting = _cachedOptions?.customQueryOutputMode || "auto";
  if (setting !== "auto") return setting;
  return _capturedEditable
    ? "replace" : "popup";
}

initFloatingButton();

// ── Result dialog ─────────────────────────────────────────────────────────────

function displayResult(lookup) {
  if (lookup.prompt.outputMode === "replace") {
    replaceSelectedText(lookup.lookupResult);
    return;
  }

  // Inject shared result panel CSS once per page
  if (!document.getElementById("lcgpt-result-style")) {
    const style  = document.createElement("style");
    style.id     = "lcgpt-result-style";
    style.innerHTML = lookup.options.defaultPopupStyle;
    document.head.appendChild(style);
  }

  let container = document.getElementById("lcgpt-result-container");
  if (!container) {
    container    = document.createElement("div");
    container.id = "lcgpt-result-container";
    document.body.appendChild(container);
  }

  // followUpRounds = 0 means one-shot: hide the follow-up input box entirely
  const showFollowUp = (lookup.prompt.followUpRounds ?? 1) > 0;

  const dialog = document.createElement("div");
  dialog.innerHTML = `
    <div class="lcgpt-result-panel" style="${lookup.prompt.popupStyle}">
      <b class="lcgpt-title">[${lookup.prompt.title}: ${lookup.prompt.userContent}]</b>
      <div class="lcgpt-message">${lookup.lookupResult}</div>
      ${showFollowUp
        ? `<div class="lcgpt-question" contenteditable placeholder="Ask a follow-up…"></div>`
        : ""}
      <div class="lcgpt-button-container">
        <button class="lcgpt-btn-regen"    title="Re-run original prompt">r</button>
        <button class="lcgpt-btn-dismiss"  title="Close">x</button>
      </div>
    </div>
  `;
  container.appendChild(dialog);

  // Dismiss
  dialog.querySelector(".lcgpt-btn-dismiss").addEventListener("click", () => dialog.remove());

  // Regenerate — re-runs the original prompt, clearing any follow-up state
  dialog.querySelector(".lcgpt-btn-regen").addEventListener("click", () => {
    dialog.remove();
    lookup.userQuestion = "";
    lookup.history      = [];
    chrome.runtime.sendMessage({ action: "relookup", lookup });
  });

  if (!showFollowUp) return;

  const questionInput = dialog.querySelector(".lcgpt-question");
  questionInput.addEventListener("keypress", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();

    const newQuestion = questionInput.textContent.trim();
    if (!newQuestion) return;

    const rounds = lookup.prompt.followUpRounds ?? 1;

    // Archive the just-completed exchange into history when followUpRounds > 1.
    //
    // When rounds === 1 (default) we deliberately do NOT accumulate history.
    // background.js will only see [system, userContent, lastResponse, newQuestion].
    // This keeps context bounded and prevents runaway token usage.
    //
    // When rounds > 1, we push the previous exchange (userQuestion → lookupResult)
    // into history before overwriting userQuestion with the new question.
    // History is trimmed so it never exceeds (rounds - 1) complete exchanges,
    // leaving room for the current question to become the Nth exchange.
    if (rounds > 1 && lookup.userQuestion) {
      lookup.history = lookup.history || [];
      lookup.history.push({ role: "user",      content: lookup.userQuestion  });
      lookup.history.push({ role: "assistant", content: lookup.lookupResult  });
      // Each exchange = 2 entries; keep at most (rounds - 1) past exchanges
      lookup.history = lookup.history.slice(-(rounds - 1) * 2);
    }

    lookup.userQuestion = newQuestion;
    chrome.runtime.sendMessage({ action: "relookup", lookup });
    dialog.remove();
  });
}

// ── Replace selected text ─────────────────────────────────────────────────────

function replaceSelectedText(text) {
  const sel = window.getSelection();
  const el  = document.activeElement;

  if (el.tagName.toLowerCase() === "textarea" ||
      (el.tagName.toLowerCase() === "input" && el.type === "text")) {
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;

  } else if (el.isContentEditable) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    // Move caret to end of inserted text
    range.selectNodeContents(node);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
