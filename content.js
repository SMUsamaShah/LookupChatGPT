// Content script.
// Responsibilities:
//   1. Draw the result panel — pending first, then the answer (showPendingPanel,
//      displayResult), or swap the answer into the selection in replace mode
//   2. Show a floating ✦ button near text selections when the feature is enabled
//
// This script is NOT declared in the manifest. background.js injects it into a
// single tab, on demand, using the activeTab access the user's click grants —
// that is what lets the extension ship without "read your data on all websites".
// When the user opts into the floating button, background.js registers this same
// file as a persistent content script against the <all_urls> permission they
// granted at that point.
//
// The whole file is wrapped in a function so a second injection into the same
// frame is a no-op. Without it, re-injecting would redeclare the top-level
// const/let bindings below (a SyntaxError) and stack duplicate listeners.
(function () {
if (window.__lcgptRunning) return;
window.__lcgptRunning = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Every branch answers synchronously, so the listener need not return true.
  if (message.action === "showPending") {
    showPendingPanel(message.lookup);
    sendResponse(true);
  }

  if (message.action === "displayResult") {
    displayResult(message.lookup, message.failed);
    // Acknowledge, or the port closes unanswered and sendMessageToTab treats it
    // as a delivery failure and retries — redrawing the panel each time.
    sendResponse(true);
  }

  // Lets background.js detect that this frame already has the script, so it can
  // skip injecting again.
  if (message.action === "ping") sendResponse(true);
});

// ── Floating selection button ─────────────────────────────────────────────────
//
// A small ✦ button that appears just above selected text when enabled in settings.
// Clicking it runs the configured default prompt; the ▾ arrow opens a dropdown
// of all enabled selection-context prompts.
//
// Disabled by default — the user opts in via Options → Behavior.

// Only the keys the floating button needs. Never chrome.storage.local.get(null):
// that would pull the API keys into the page's content-script world for no reason.
const FLOAT_BUTTON_KEYS = ["selectionButton", "promptData", "customQueryOutputMode"];

let _cachedOptions        = null;  // invalidated whenever storage changes
let _loadingOptions       = false; // prevents duplicate in-flight storage reads
let _buttonPagePos        = null;  // page-coordinate anchor for the floating button
let _capturedText         = "";    // selected text at the moment the button appeared
let _capturedTitle        = "";
let _capturedURL          = "";
let _capturedEditable     = false; // whether the selection was inside an editable element
let _suppressSelectionHide = false; // true while a mousedown inside the button is in flight
let _menuOpen             = false;  // true while the floating-button dropdown is open
let _menuKeyHandler       = null;   // the one live capture-phase key handler for the dropdown

// The dropdown's key handler closes over that dropdown's search box and list, so
// exactly one may be attached at a time. Every path that closes or rebuilds the
// menu goes through here.
function closeMenuKeyHandler() {
  if (!_menuKeyHandler) return;
  document.removeEventListener("keydown", _menuKeyHandler, true);
  _menuKeyHandler = null;
}

// ── Shadow host hardening ─────────────────────────────────────────────────────
//
// A shadow root stops page *selectors* reaching inside it. It does not stop two
// other routes in, and page CSS regularly takes both:
//
//   1. The host is an ordinary element sitting in the page's DOM, so page rules
//      match it like any other. In the cascade a normal declaration from the
//      outer tree beats a normal :host rule from the inner one whatever the
//      specificity, so a page's `div { position: relative }` is enough to
//      override the panel's own `position: fixed` and drop it into the page flow.
//   2. Inherited properties cross the boundary regardless of selectors. Anything
//      the panel does not set for itself — letter-spacing, text-transform,
//      word-spacing, font-style — arrives from the host's computed style, which
//      is to say from the page.
//
// Setting `all: initial` in the host's own style attribute closes both at once:
// an inline important declaration outranks any page rule, and resetting the
// host's computed values leaves the shadow tree nothing to inherit. What the
// host is actually meant to look like is then re-applied at the same priority.
//
// Everything written to a hardened host afterwards has to be important too, or
// the `all: initial` in the same declaration block wins over it.
const setImportant = (el, prop, value) => el.style.setProperty(prop, value, "important");

function hardenShadowHost(host, declarations) {
  setImportant(host, "all", "initial");
  // `all` deliberately excludes these two, so they need saying explicitly.
  setImportant(host, "direction", "ltr");
  setImportant(host, "unicode-bidi", "normal");
  setImportant(host, "display", "block");
  for (const [prop, value] of declarations) setImportant(host, prop, value);
}

const PANEL_HOST_FALLBACK = [
  ["position", "fixed"], ["top", "10px"], ["left", "10px"],
  ["z-index", "999999"], ["max-width", "60vw"],
];

// The :host declarations out of a stylesheet, read back through the CSSOM rather
// than parsed by hand. These are what the host is meant to look like, and they
// have to move to the style attribute to survive a hostile page.
function hostDeclarations(styleEl) {
  const out = [];
  let rules;
  try { rules = styleEl.sheet?.cssRules; } catch { return out; }  // cross-origin sheets throw
  for (const rule of rules || []) {
    if (rule.selectorText !== ":host") continue;
    for (const prop of rule.style) out.push([prop, rule.style.getPropertyValue(prop)]);
  }
  return out;
}

// True for the floating button and the result panel — the extension's own UI,
// which selection handling must leave alone.
const inExtensionUI = (target, selector = "#lcgpt-float-btn, #lcgpt-result-container") =>
  Boolean(target?.closest?.(selector));

function initFloatingButton() {
  document.addEventListener("mousedown", (e) => {
    if (inExtensionUI(e.target, "#lcgpt-float-btn")) {
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
    if (inExtensionUI(document.activeElement, "#lcgpt-float-btn")) return;
    if (!selectedText()) hideFloatingButton();
  });

  document.addEventListener("scroll", updateFloatingButtonPosition, { passive: true });
  chrome.storage.onChanged.addListener(() => { _cachedOptions = null; });
}

function loadOptionsAndShow(sel) {
  if (_cachedOptions !== null) { maybeShowFloatingButton(sel, _cachedOptions); return; }
  if (_loadingOptions) return;
  _loadingOptions = true;
  chrome.storage.local.get(FLOAT_BUTTON_KEYS).then((opts) => {
    _cachedOptions  = opts;
    _loadingOptions = false;
    maybeShowFloatingButton(sel, opts);
  });
}

const selectedText = () => window.getSelection()?.toString().trim() || "";

function onSelectionMouseUp(e) {
  _suppressSelectionHide = false;
  if (inExtensionUI(e.target)) return;
  if (!selectedText()) { hideFloatingButton(); return; }
  loadOptionsAndShow(window.getSelection());
}

// Keyboard selection (shift+arrows, ctrl+A) shows the button but never hides it:
// an ordinary keystroke that happens to clear the selection is not a dismissal.
function onSelectionKeyUp(e) {
  if (_menuOpen || inExtensionUI(e.target)) return;
  if (selectedText()) loadOptionsAndShow(window.getSelection());
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
    document.body.appendChild(btn);
    shadow = btn.attachShadow({ mode: "open" });
    // Only layout and visibility live on the host; the look is in the shadow.
    hardenShadowHost(btn, [["position", "fixed"], ["z-index", "999998"], ["display", "none"]]);
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

  // Replacing the markup below detaches any open menu, so its key handler goes too.
  closeMenuKeyHandler();
  _menuOpen = false;

  wrap.innerHTML = `
    <button id="lcgpt-float-main"></button>
    <button id="lcgpt-float-arrow" title="Choose prompt">▾</button>
    <div    id="lcgpt-float-menu"  style="display:none"></div>
  `;

  const menu = wrap.querySelector("#lcgpt-float-menu");
  // Prompt titles are the user's own text and go in as text, never as markup.
  wrap.querySelector("#lcgpt-float-main").textContent =
    defaultPrompt ? `✦ ${defaultPrompt.title}` : "✦ Ask…";

  function openMenu() {
    // A handler left over from an earlier menu still holds that menu's search
    // text and highlight, and would act on them on the next Enter — firing a
    // prompt nothing on screen shows as chosen. Only one may ever be attached.
    closeMenuKeyHandler();
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
      const needle = filter.toLowerCase();
      listEl.textContent = "";
      for (const p of prompts) {
        if (needle && !p.title.toLowerCase().includes(needle)) continue;
        const item = document.createElement("div");
        item.className   = "lcgpt-menu-item";
        item.dataset.id  = p.id;          // read back by the Enter key handler
        item.textContent = p.title;
        item.addEventListener("mouseover", () => setHighlight(item));
        item.addEventListener("click", () => { hideFloatingButton(); runFloatingPrompt(p.id); });
        listEl.appendChild(item);
      }
    }

    function getHighlighted() { return listEl.querySelector(".lcgpt-menu-item--active"); }

    function setHighlight(el) {
      listEl.querySelectorAll(".lcgpt-menu-item--active").forEach((i) => i.classList.remove("lcgpt-menu-item--active"));
      if (el) { el.classList.add("lcgpt-menu-item--active"); el.scrollIntoView({ block: "nearest" }); }
    }

    function handleMenuKey(e) {
      // hideFloatingButton() sets _menuOpen = false; that's the authoritative signal to clean up.
      if (!_menuOpen) { closeMenuKeyHandler(); return; }

      const items = [...listEl.querySelectorAll(".lcgpt-menu-item")];
      const hi    = getHighlighted();
      const idx   = hi ? items.indexOf(hi) : -1;

      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        _menuOpen = false;
        menu.style.display = "none";
        closeMenuKeyHandler();
      } else if (e.key === "ArrowDown") {
        e.preventDefault(); e.stopPropagation();
        if (items.length) setHighlight(items[Math.min(idx + 1, items.length - 1)]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        if (idx <= 0) setHighlight(null); else setHighlight(items[idx - 1]);
      } else if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        closeMenuKeyHandler();
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

    _menuKeyHandler = handleMenuKey;
    document.addEventListener("keydown", handleMenuKey, true);

    renderList("");
    menu.style.display = "block";
  }

  function closeMenu() {
    _menuOpen = false;
    menu.style.display = "none";
    closeMenuKeyHandler();
  }

  wrap.querySelector("#lcgpt-float-main").onclick = () => {
    if (defaultPrompt) { hideFloatingButton(); runFloatingPrompt(defaultPrompt.id); }
    else openMenu();
  };

  wrap.querySelector("#lcgpt-float-arrow").onclick = (e) => {
    e.stopPropagation();
    if (menu.style.display === "none") openMenu(); else closeMenu();
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
  setImportant(btn, "display", "block");
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
  setImportant(btn, "left", `${x}px`);
  setImportant(btn, "top",  `${Math.max(4, y)}px`);
}

function hideFloatingButton() {
  _menuOpen = false;
  closeMenuKeyHandler();
  const btn = document.getElementById("lcgpt-float-btn");
  if (btn) setImportant(btn, "display", "none");
  _buttonPagePos = null;
}

// The single answer to "can text be swapped in here?", used both to pick the
// output mode for a custom query and to carry it out. The input types listed are
// exactly those that expose selectionStart/selectionEnd — input[type=email] and
// [type=number] do not, so they count as not editable rather than as fields the
// replacement would silently fail on.
function isEditableElement(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  return tag === "textarea" || (tag === "input" && /^(text|search|url|tel)$/.test(el.type || "text"));
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

// Get or create the shadow host. The shadow root completely isolates the panel
// from host-page CSS — including rules with !important — so no all:initial /
// all:unset tricks are needed inside the panel styles.
function resultShadowRoot(lookup) {
  const existing = document.getElementById("lcgpt-result-container");
  if (existing) return existing.shadowRoot;

  const host = document.createElement("div");
  host.id    = "lcgpt-result-container";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style  = document.createElement("style");
  // Silently migrate stored CSS that still uses #lcgpt-result-container
  // instead of the shadow-DOM :host selector.
  style.textContent = (lookup.options?.defaultPopupStyle || "")
    .replace(/#lcgpt-result-container\b/g, ":host");
  shadow.appendChild(style);
  // The :host block stays in the sheet, but it is the copy on the style
  // attribute that actually holds against the page. The fallbacks go on first so
  // a stylesheet with no :host rules of its own still floats above the page
  // instead of landing in its flow; anything it does declare wins over them.
  hardenShadowHost(host, [...PANEL_HOST_FALLBACK, ...hostDeclarations(style)]);
  return shadow;
}

// Draws the panel skeleton for a lookup, or returns the one already on screen for
// it. Both the "working on it" placeholder and the finished answer render through
// here, so the answer replaces the placeholder in place rather than stacking.
function panelFor(lookup) {
  const shadow   = resultShadowRoot(lookup);
  // Number() keeps this a safe selector whatever arrives; a bogus id simply misses.
  const existing = lookup.requestId
    ? shadow.querySelector(`.lcgpt-panel-wrap[data-req="${Number(lookup.requestId)}"]`)
    : null;
  if (existing) return existing;

  // followUpRounds = 0 means one-shot: hide the follow-up input box entirely
  const showFollowUp = (lookup.prompt.followUpRounds ?? 1) > 0;

  const dialog = document.createElement("div");
  dialog.className = "lcgpt-panel-wrap";
  if (lookup.requestId) dialog.dataset.req = String(lookup.requestId);
  dialog.innerHTML = `
    <div class="lcgpt-result-panel">
      <b class="lcgpt-title"></b>
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
  // The per-prompt CSS is set as a property, never interpolated into a style
  // attribute: an ordinary declaration like font-family: "Segoe UI" contains
  // quotes, which would close the attribute and turn the rest into stray
  // attributes on the element.
  dialog.querySelector(".lcgpt-result-panel").style.cssText = lookup.prompt.popupStyle || "";
  // Neither the prompt title nor the user's text is trusted as markup.
  dialog.querySelector(".lcgpt-title").textContent =
    `[${lookup.prompt.title}: ${lookup.prompt.userContent}]`;

  dialog.querySelector(".lcgpt-btn-dismiss").addEventListener("click", () => dialog.remove());

  // Regenerate — re-runs the original prompt, clearing any follow-up state
  dialog.querySelector(".lcgpt-btn-regen").addEventListener("click", () => {
    dialog.remove();
    lookup.userQuestion = "";
    lookup.history      = [];
    chrome.runtime.sendMessage({ action: "relookup", lookup });
  });

  shadow.appendChild(dialog);
  return dialog;
}

// Shown the moment a request goes out, so there is never a silent gap between
// clicking and an answer arriving.
function showPendingPanel(lookup) {
  if (!document.body) return;
  panelFor(lookup).querySelector(".lcgpt-message").textContent = "…";
}

function displayResult(lookup, failed) {
  if (lookup.prompt.outputMode === "replace" && !failed) {
    // Falls back to the popup when there is nothing replaceable in focus, rather
    // than dropping an answer that has already been paid for.
    if (replaceSelectedText(lookup.lookupResult)) return;
  }
  if (!document.body) return;

  const dialog = panelFor(lookup);
  // API response must never be injected as HTML — use textContent to prevent XSS.
  dialog.querySelector(".lcgpt-message").textContent =
    failed ? `⚠ ${lookup.lookupResult}` : lookup.lookupResult;

  const questionInput = dialog.querySelector(".lcgpt-question");
  // followUpRounds = 0 hides the box; the panel may also already be wired if a
  // result somehow arrives twice for the same request.
  if (!questionInput || dialog.dataset.followUpWired) return;
  dialog.dataset.followUpWired = "1";

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

// Returns true when the text actually went somewhere, false when there was
// nowhere to put it. The caller shows the answer in the popup instead of
// discarding it — the request has already been made and paid for either way.
function replaceSelectedText(text) {
  const el = document.activeElement;
  if (!isEditableElement(el)) return false;

  const tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "input") {
    const start = el.selectionStart;
    const end   = el.selectionEnd;
    // Fields such as input[type=email] disallow selectionStart/End entirely.
    if (start == null || end == null) return false;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    // Frameworks that mirror the field into their own state need to be told.
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // contenteditable
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  // Move caret to end of inserted text
  range.selectNodeContents(node);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

})();
