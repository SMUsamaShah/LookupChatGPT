// Content script — injected into every page at document_end.
// Responsibilities:
//   1. Display result popups (displayResult)
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

let _cachedOptions   = null; // invalidated whenever storage changes
let _loadingOptions  = false; // prevents duplicate in-flight storage reads

function initFloatingButton() {
  document.addEventListener("mouseup",  onSelectionMouseUp);
  // Hide on any outside click (but not clicks inside our own button or popup)
  document.addEventListener("mousedown", (e) => {
    if (!e.target.closest("#lcgpt-float-btn")) hideFloatingButton();
  });
  // Hide when the page scrolls so the button doesn't drift away from the selection
  document.addEventListener("scroll", hideFloatingButton, { passive: true });
  // Invalidate options cache whenever the user changes settings
  chrome.storage.onChanged.addListener(() => { _cachedOptions = null; });
}

function onSelectionMouseUp(e) {
  if (e.target.closest("#lcgpt-float-btn, #lookupchatgpt-popup-container")) return;

  const sel  = window.getSelection();
  const text = sel?.toString().trim();
  if (!text) { hideFloatingButton(); return; }

  if (_cachedOptions !== null) {
    maybeShowFloatingButton(sel, _cachedOptions);
    return;
  }
  // Only start one storage read at a time; if one is already in flight, skip
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
    .filter((p) => p.enabled && p.context === "selection");
  if (enabledPrompts.length === 0) return;

  const defaultId     = opts.selectionButton.defaultPromptId ?? 0;
  const defaultPrompt = enabledPrompts.find((p) => p.id === defaultId) || enabledPrompts[0];
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
      "font-size:12px", "cursor:default", "user-select:none",
    ].join(";");
    document.body.appendChild(btn);
  }

  btn.innerHTML = `
    <button id="lcgpt-float-main"  style="border:none;background:none;padding:4px 8px;cursor:pointer;font-size:12px;font-family:inherit"></button>
    <button id="lcgpt-float-arrow" style="border:none;border-left:1px solid #ccc;background:none;padding:4px 6px;cursor:pointer;font-size:11px" title="Choose prompt">▾</button>
    <div    id="lcgpt-float-menu"  hidden style="position:absolute;top:100%;left:0;background:white;border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.18);white-space:nowrap;min-width:100%;z-index:1"></div>
  `;

  btn.querySelector("#lcgpt-float-main").textContent = `✦ ${defaultPrompt.title}`;
  btn.querySelector("#lcgpt-float-main").onclick = () => {
    hideFloatingButton();
    runFloatingPrompt(defaultPrompt.id);
  };

  const menu = btn.querySelector("#lcgpt-float-menu");
  btn.querySelector("#lcgpt-float-arrow").onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  };

  menu.innerHTML = prompts.map((p) =>
    `<div data-id="${p.id}" style="padding:5px 10px;cursor:pointer">${p.title}</div>`
  ).join("");
  menu.querySelectorAll("[data-id]").forEach((item) => {
    item.onmouseover = () => { item.style.background = "#f0f0f0"; };
    item.onmouseout  = () => { item.style.background = ""; };
    item.onclick     = () => { hideFloatingButton(); runFloatingPrompt(parseInt(item.dataset.id)); };
  });

  // Position the button just above the selection rectangle (viewport coordinates)
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  btn.style.left    = `${Math.round(rect.left)}px`;
  btn.style.top     = `${Math.max(4, Math.round(rect.top) - 36)}px`;
  btn.hidden        = false;
}

function hideFloatingButton() {
  const btn = document.getElementById("lcgpt-float-btn");
  if (btn) btn.hidden = true;
}

function runFloatingPrompt(promptId) {
  chrome.runtime.sendMessage({
    action:       "selection_button_click",
    promptId:     String(promptId),
    selectedText: window.getSelection().toString(),
    pageTitle:    document.title,
    pageURL:      location.href,
  });
}

initFloatingButton();

// ── Result popup ──────────────────────────────────────────────────────────────

function displayResult(lookup) {
  if (lookup.prompt.outputMode === "replace") {
    replaceSelectedText(lookup.lookupResult);
    return;
  }

  // Inject shared popup CSS once per page
  if (!document.getElementById("lookupchatgpt-popup-style")) {
    const style  = document.createElement("style");
    style.id     = "lookupchatgpt-popup-style";
    style.innerHTML = lookup.options.defaultPopupStyle;
    document.head.appendChild(style);
  }

  let container = document.getElementById("lookupchatgpt-popup-container");
  if (!container) {
    container    = document.createElement("div");
    container.id = "lookupchatgpt-popup-container";
    document.body.appendChild(container);
  }

  // followUpRounds = 0 means one-shot: hide the follow-up input box entirely
  const showFollowUp = (lookup.prompt.followUpRounds ?? 1) > 0;

  const popup = document.createElement("div");
  popup.innerHTML = `
    <div class="lookupchatgpt-popup" style="${lookup.prompt.popupStyle}">
      <b class="lookupchatgpt-title">[${lookup.prompt.title}: ${lookup.prompt.userContent}]</b>
      <div class="lookupchatgpt-message">${lookup.lookupResult}</div>
      ${showFollowUp
        ? `<div class="lookupchatgpt-question" contenteditable
               style="border:1px solid #ccc;width:100%;min-height:1.4em;margin-top:4px;padding:2px"
               placeholder="Ask a follow-up…"></div>`
        : ""}
      <div class="lookupchatgpt-button-container">
        <button class="lcgpt-btn-regen"    title="Re-run original prompt">r</button>
        <button class="lcgpt-btn-dismiss"  title="Close">x</button>
      </div>
    </div>
  `;
  container.appendChild(popup);

  // Dismiss
  popup.querySelector(".lcgpt-btn-dismiss").addEventListener("click", () => popup.remove());

  // Regenerate — re-runs the original prompt, clearing any follow-up state
  popup.querySelector(".lcgpt-btn-regen").addEventListener("click", () => {
    popup.remove();
    lookup.userQuestion = "";
    lookup.history      = [];
    chrome.runtime.sendMessage({ action: "relookup", lookup });
  });

  if (!showFollowUp) return;

  const questionInput = popup.querySelector(".lookupchatgpt-question");
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
    popup.remove();
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
