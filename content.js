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

let _cachedOptions  = null;  // invalidated whenever storage changes
let _loadingOptions = false; // prevents duplicate in-flight storage reads
let _buttonPagePos  = null;  // page-coordinate anchor for the floating button

function initFloatingButton() {
  // Inject hover/active styles for the floating button once per page.
  // Inline styles can't express :hover/:active, so a <style> tag is the only option.
  if (!document.getElementById("lcgpt-float-style")) {
    const s = document.createElement("style");
    s.id = "lcgpt-float-style";
    s.textContent = `
      #lcgpt-float-btn button:hover  { background: #f0f0f0 !important; }
      #lcgpt-float-btn button:active { background: #ddd    !important; }
      .lcgpt-menu-item:hover         { background: #f0f0f0 !important; }
    `;
    document.head.appendChild(s);
  }

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest("#lcgpt-float-btn")) return;
    hideFloatingButton();
  });

  document.addEventListener("mouseup", onSelectionMouseUp);

  document.addEventListener("selectionchange", () => {
    if (!window.getSelection()?.toString().trim()) hideFloatingButton();
  });

  document.addEventListener("scroll", updateFloatingButtonPosition, { passive: true });
  chrome.storage.onChanged.addListener(() => { _cachedOptions = null; });
}

function onSelectionMouseUp(e) {
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
    <div    id="lcgpt-float-menu"  style="display:none;position:absolute;top:100%;left:0;background:white;border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.18);white-space:nowrap;min-width:100%;z-index:1"></div>
  `;

  btn.querySelector("#lcgpt-float-main").textContent = `✦ ${defaultPrompt.title}`;
  btn.querySelector("#lcgpt-float-main").onclick = () => {
    hideFloatingButton();
    runFloatingPrompt(defaultPrompt.id);
  };

  const menu = btn.querySelector("#lcgpt-float-menu");
  btn.querySelector("#lcgpt-float-arrow").onclick = (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "none" ? "block" : "none";
  };

  menu.innerHTML = prompts.map((p) =>
    `<div class="lcgpt-menu-item" data-id="${p.id}" style="padding:5px 10px;cursor:pointer">${p.title}</div>`
  ).join("");
  menu.querySelectorAll("[data-id]").forEach((item) => {
    item.onclick = () => { hideFloatingButton(); runFloatingPrompt(parseInt(item.dataset.id)); };
  });

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
