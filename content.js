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

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let _cachedOptions        = null;  // invalidated whenever storage changes
let _loadingOptions       = false; // prevents duplicate in-flight storage reads
let _buttonPagePos        = null;  // page-coordinate anchor for the floating button
let _capturedText         = "";    // selected text at the moment the button appeared
let _capturedTitle        = "";
let _capturedURL          = "";
let _capturedEditable     = false; // whether the selection was inside an editable element
let _suppressSelectionHide = false; // true while a mousedown inside the button is in flight
let _menuOpen             = false;  // true while the floating-button dropdown is open

function initFloatingButton() {
  // Hover/active styles for the floating button are injected into its own
  // shadow root in showFloatingButton — no document.head injection needed.

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest("#lcgpt-float-btn")) {
      // e.preventDefault() stops the browser from moving focus away from whatever
      // currently has it. This has two effects:
      //   1. A document text selection stays highlighted (browser only dims it on focus loss).
      //   2. A textarea/input that the user selected text in keeps focus, so its selection
      //      highlight also stays visible while they interact with the floating button.
      // Click events still fire normally despite preventDefault on mousedown.
      e.preventDefault();
      _suppressSelectionHide = true;
      return;
    }
    hideFloatingButton();
  });

  document.addEventListener("mouseup", onSelectionMouseUp);
  document.addEventListener("keyup",   onSelectionKeyUp);

  document.addEventListener("selectionchange", () => {
    if (_suppressSelectionHide) return;
    // While the dropdown is open the user is typing into the search input. That
    // typing can clear the document selection, but we must not hide the button —
    // the captured text (_capturedText) is already saved and is still valid.
    if (_menuOpen) return;
    if (document.activeElement?.closest("#lcgpt-float-btn")) return;
    if (!window.getSelection()?.toString().trim()) hideFloatingButton();
  });

  document.addEventListener("scroll", updateFloatingButtonPosition, { passive: true });
  chrome.storage.onChanged.addListener(() => { _cachedOptions = null; });
}

function loadOptionsAndShow(sel) {
  if (_cachedOptions !== null) { maybeShowFloatingButton(sel, _cachedOptions); return; }
  if (_loadingOptions) return;
  _loadingOptions = true;
  chrome.storage.local.get(null).then((opts) => {
    _cachedOptions  = opts;
    _loadingOptions = false;
    maybeShowFloatingButton(sel, opts);
  });
}

function onSelectionMouseUp(e) {
  _suppressSelectionHide = false;
  if (e.target.closest("#lcgpt-float-btn, #lcgpt-result-container")) return;
  const sel = window.getSelection();
  if (!sel?.toString().trim()) { hideFloatingButton(); return; }
  loadOptionsAndShow(sel);
}

function onSelectionKeyUp(e) {
  if (_menuOpen) return;
  if (e.target.closest?.("#lcgpt-float-btn, #lcgpt-result-container")) return;
  const sel = window.getSelection();
  if (!sel?.toString().trim()) return;
  loadOptionsAndShow(sel);
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
  let shadow;
  if (!btn) {
    btn = document.createElement("div");
    btn.id = "lcgpt-float-btn";
    // Only layout/visibility properties live on the host; visual styles go in
    // the shadow so page CSS (including !important) cannot reach them.
    btn.style.cssText = "position:fixed;z-index:999998;display:none";
    document.body.appendChild(btn);
    shadow = btn.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      #lcgpt-float-wrap {
        display: flex; align-items: stretch;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18);
        font-family: Arial, sans-serif; font-size: 12px;
        cursor: default; user-select: none; color: #000;
      }
      button { border: none; background: none; cursor: pointer; font-family: inherit; color: inherit; }
      button:hover  { background: #f0f0f0; }
      button:active { background: #ddd; }
      #lcgpt-float-main  { padding: 4px 8px; font-size: 12px; }
      #lcgpt-float-arrow { border-left: 1px solid #ccc; padding: 4px 6px; font-size: 11px; }
      #lcgpt-float-menu  {
        position: absolute; top: 100%; left: 0; min-width: 220px;
        background: white; border: 1px solid #ccc; border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18); z-index: 1;
      }
      .lcgpt-search-wrap { padding: 4px; border-bottom: 1px solid #eee; }
      #lcgpt-float-search {
        width: 100%; box-sizing: border-box;
        border: 1px solid #ccc; border-radius: 3px;
        padding: 3px 6px; font-size: 12px;
        font-family: Arial, sans-serif; color: #000; background: #fff; outline: none;
      }
      #lcgpt-float-list { max-height: 130px; overflow-y: auto; }
      .lcgpt-menu-item  { padding: 5px 10px; cursor: pointer; color: #000; white-space: nowrap; }
      .lcgpt-menu-item:hover,
      .lcgpt-menu-item--active { background: #e8f0fe; }
    `;
    shadow.appendChild(style);
    const wrap = document.createElement("div");
    wrap.id = "lcgpt-float-wrap";
    shadow.appendChild(wrap);
  } else {
    shadow = btn.shadowRoot;
  }

  const wrap = shadow.getElementById("lcgpt-float-wrap");

  const mainLabel  = defaultPrompt ? `✦ ${esc(defaultPrompt.title)}` : "✦ Ask…";

  wrap.innerHTML = `
    <button id="lcgpt-float-main">${mainLabel}</button>
    <button id="lcgpt-float-arrow" title="Choose prompt">▾</button>
    <div    id="lcgpt-float-menu"  style="display:none"></div>
  `;

  const menu = wrap.querySelector("#lcgpt-float-menu");

  function openMenu() {
    _menuOpen = true;
    // The search input intentionally never receives browser focus (no .focus() call,
    // and mousedown on the button is already e.preventDefault()'d). All keyboard
    // input is intercepted by a capture-phase document listener (handleMenuKey).
    // This preserves whatever text selection was active when the button appeared —
    // both a normal document selection and a selection inside a focused textarea.
    menu.innerHTML = `
      <div class="lcgpt-search-wrap">
        <input id="lcgpt-float-search" type="text" autocomplete="off"
               placeholder="Type a question or filter prompts…">
      </div>
      <div id="lcgpt-float-list"></div>
    `;
    const searchInput = menu.querySelector("#lcgpt-float-search");
    const listEl      = menu.querySelector("#lcgpt-float-list");

    function renderList(filter) {
      const filtered = filter
        ? prompts.filter((p) => p.title.toLowerCase().includes(filter.toLowerCase()))
        : prompts;
      listEl.innerHTML = filtered.map((p) =>
        `<div class="lcgpt-menu-item" data-id="${p.id}">${esc(p.title)}</div>`
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

    function handleMenuKey(e) {
      // hideFloatingButton() sets _menuOpen = false; that's the authoritative signal to clean up.
      if (!_menuOpen) { document.removeEventListener("keydown", handleMenuKey, true); return; }

      const items = [...listEl.querySelectorAll(".lcgpt-menu-item")];
      const hi    = getHighlighted();
      const idx   = hi ? items.indexOf(hi) : -1;

      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        _menuOpen = false;
        menu.style.display = "none";
        document.removeEventListener("keydown", handleMenuKey, true);
      } else if (e.key === "ArrowDown") {
        e.preventDefault(); e.stopPropagation();
        if (items.length) setHighlight(items[Math.min(idx + 1, items.length - 1)]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        if (idx <= 0) setHighlight(null); else setHighlight(items[idx - 1]);
      } else if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener("keydown", handleMenuKey, true);
        if (hi) {
          hideFloatingButton();
          runFloatingPrompt(parseInt(hi.dataset.id));
        } else {
          const query = searchInput.value.trim();
          if (query) { hideFloatingButton(); runCustomQuery(query); }
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Append directly to the input's value without focusing it — focusing would
        // clear the document/textarea selection the user had before opening the menu.
        searchInput.value += e.key;
        renderList(searchInput.value);
        setHighlight(null);
        e.preventDefault(); e.stopPropagation();
      } else if (e.key === "Backspace") {
        searchInput.value = searchInput.value.slice(0, -1);
        renderList(searchInput.value);
        setHighlight(null);
        e.preventDefault(); e.stopPropagation();
      }
    }

    document.addEventListener("keydown", handleMenuKey, true);

    renderList("");
    menu.style.display = "block";
  }

  wrap.querySelector("#lcgpt-float-main").onclick = () => {
    if (defaultPrompt) { hideFloatingButton(); runFloatingPrompt(defaultPrompt.id); }
    else openMenu();
  };

  wrap.querySelector("#lcgpt-float-arrow").onclick = (e) => {
    e.stopPropagation();
    if (menu.style.display === "none") openMenu(); else { _menuOpen = false; menu.style.display = "none"; }
  };

  // Capture selection context now — focus shifts when the button is clicked,
  // which clears window.getSelection() for contenteditable elements.
  _capturedText     = sel.toString();
  _capturedTitle    = document.title;
  _capturedURL      = location.href;
  _capturedEditable = isEditableElement(document.activeElement);

  // Store the page-coordinate anchor (above the selection) so the button can
  // follow the text when the page is scrolled.
  // For selections inside form controls (textarea, input) the Range's bounding
  // rect is zero — browsers don't expose text-node positions inside form controls.
  // Fall back to the element's own bounding rect so the button appears above
  // the control rather than at the top-left corner of the page.
  let rect = sel.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    rect = document.activeElement?.getBoundingClientRect() || rect;
  }
  _buttonPagePos = {
    x: Math.round(rect.left + window.scrollX),
    y: Math.round(rect.top  + window.scrollY) - 36,
  };
  btn.style.display = "block";
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
  _menuOpen = false;
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

  // Get or create the shadow host. The shadow root completely isolates the
  // panel from host-page CSS — including rules with !important — so no
  // all:initial / all:unset tricks are needed inside the panel styles.
  let host = document.getElementById("lcgpt-result-container");
  let shadow;
  if (!host) {
    host    = document.createElement("div");
    host.id = "lcgpt-result-container";
    document.body.appendChild(host);
    shadow  = host.attachShadow({ mode: "open" });
    const style       = document.createElement("style");
    // Silently migrate stored CSS that still uses #lcgpt-result-container
    // instead of the shadow-DOM :host selector.
    style.textContent = lookup.options.defaultPopupStyle
      .replace(/#lcgpt-result-container\b/g, ":host");
    shadow.appendChild(style);
  } else {
    shadow = host.shadowRoot;
  }

  // followUpRounds = 0 means one-shot: hide the follow-up input box entirely
  const showFollowUp = (lookup.prompt.followUpRounds ?? 1) > 0;

  const dialog = document.createElement("div");
  dialog.innerHTML = `
    <div class="lcgpt-result-panel" style="${lookup.prompt.popupStyle}">
      <b class="lcgpt-title">[${esc(lookup.prompt.title)}: ${esc(lookup.prompt.userContent)}]</b>
      <div class="lcgpt-message"></div>
      ${showFollowUp
        ? `<div class="lcgpt-question" contenteditable placeholder="Ask a follow-up…"></div>`
        : ""}
      <div class="lcgpt-button-container">
        <button class="lcgpt-btn-regen"    title="Re-run original prompt">r</button>
        <button class="lcgpt-btn-dismiss"  title="Close">x</button>
      </div>
    </div>
  `;
  // API response must never be injected as HTML — use textContent to prevent XSS.
  dialog.querySelector(".lcgpt-message").textContent = lookup.lookupResult;
  shadow.appendChild(dialog);

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
