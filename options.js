// Options page logic.
// Loaded after defaults.js and providers.js, so StoredPrompt, Options, and PROVIDERS are available.

chrome.storage.local.get(null).then(loadOptions);

let showAdvanced = false;

document.addEventListener("click", (e) => {
  if      (e.target.matches(".deleteButton"))          { e.target.closest("tr").remove(); refreshSelectionButtonPrompts(); }
  else if (e.target.matches(".moveUpButton"))          moveRow(e.target, "up");
  else if (e.target.matches(".moveDownButton"))        moveRow(e.target, "down");
  else if (e.target.matches("#toggleAdvancedColumns")) toggleAdvancedColumns();
  else if (e.target.matches("#addNewPrompt"))          appendPromptRow(new StoredPrompt());
  else if (e.target.matches("#resetPrompts"))          resetPrompts();
  else if (e.target.matches("#resetCSS"))              resetCSS();
  else if (e.target.matches("#savePrompts"))           saveOptions();
});

// Anything that changes which prompts qualify, or what they are called, has to
// be reflected in the floating-button dropdown straight away — it is the only
// record of which prompt the user picked.
document.addEventListener("change", (e) => {
  if (e.target.matches("#promptTable .enabled, #promptTable .context")) refreshSelectionButtonPrompts();
  else if (e.target.matches("#selectionButtonPrompt")) {
    const rows = [...document.querySelectorAll("#promptTable tbody .promptRow")];
    _defaultPromptRow = rows[Number(e.target.value)] || null;
  }
});

document.addEventListener("input", (e) => {
  if (e.target.matches("#promptTable .title")) refreshSelectionButtonPrompts();
});

// ── Floating button permission ────────────────────────────────────────────────
// The floating ✦ button is the only feature that needs to run on every page, so
// the extension does not ask for <all_urls> up front. It is requested here, at
// the moment the user opts in, and dropped again when they opt out.
//
// The request has to happen in the checkbox's own change event: Chrome only
// honours permissions.request() from a user gesture, so deferring it to Save
// would be rejected. Because the grant takes effect immediately while the rest
// of the page waits for Save, the setting is written straight through here too —
// otherwise closing the page without saving leaves the permission and the stored
// setting disagreeing, and the checkbox comes back ticked on a dead feature.
$("selectionButtonEnabled").addEventListener("change", (e) => {
  const checkbox = e.target;
  if (!checkbox.checked) {
    chrome.permissions.remove({ origins: ["<all_urls>"] });
    persistSelectionButtonEnabled(false);
    return;
  }
  chrome.permissions.request({ origins: ["<all_urls>"] }, (granted) => {
    if (granted) { persistSelectionButtonEnabled(true); return; }
    // Declined — leave the feature off rather than storing a setting that
    // silently cannot work.
    checkbox.checked = false;
    persistSelectionButtonEnabled(false);
    alert("The floating button needs permission to run on the pages you visit.\n\n" +
          "Without it the extension only acts on the page when you use the right-click " +
          "menu or the toolbar button.");
  });
});

function persistSelectionButtonEnabled(enabled) {
  chrome.storage.local.get("selectionButton").then(({ selectionButton }) => {
    chrome.storage.local.set({
      selectionButton: { ...(selectionButton || { defaultPromptId: 0 }), enabled },
    });
  }).catch((err) => console.warn("lcgpt: could not record the floating button setting:", err));
}

// ── Load ──────────────────────────────────────────────────────────────────────

function loadOptions(raw) {
  if (!raw) return;
  const opts = normalizeOptions(raw);

  // Providers
  for (const key of Object.keys(PROVIDERS)) {
    const cfg = opts.providers?.[key] || {};
    const tokenEl = document.getElementById(`${key}-token`);
    const modelEl = document.getElementById(`${key}-model`);
    if (tokenEl) tokenEl.value = cfg.token || "";
    if (modelEl) modelEl.value = cfg.model || "";
  }
  const defProv = document.getElementById("defaultProvider");
  if (defProv) defProv.value = opts.defaultProvider || "openai";

  // Appearance
  $("defaultPopupStyle").value = opts.defaultPopupStyle || DEFAULT_POPUP_STYLE;

  // Behavior — floating selection button
  const selBtn = opts.selectionButton || {};
  $("selectionButtonEnabled").checked    = selBtn.enabled || false;
  $("customQueryOutputMode").value       = opts.customQueryOutputMode   || "auto";
  $("customQuerySystemPrompt").value     = opts.customQuerySystemPrompt ?? "";

  // Sync
  $("syncEnabled").checked     = opts.syncEnabled     !== false;
  $("syncIncludeKeys").checked = opts.syncIncludeKeys === true;

  // The permission can be revoked from the browser's own extension settings, in
  // which case the stored flag is stale. What the box shows must match what the
  // feature can actually do.
  chrome.permissions.contains({ origins: ["<all_urls>"] }).then((granted) => {
    if (granted || !$("selectionButtonEnabled").checked) return;
    $("selectionButtonEnabled").checked = false;
    persistSelectionButtonEnabled(false);
  }).catch(() => {});

  // Prompts — build both the table rows and the floating-button default dropdown
  if (opts.promptData) populatePromptTable(opts.promptData.map(normalizePrompt), selBtn.defaultPromptId ?? 0);

  toggleAdvancedColumns(); // apply initial visibility
}

// ── Floating-button default prompt ────────────────────────────────────────────
// Prompts are identified by their position in promptData, so every reorder,
// insertion and deletion moves the target of an index recorded earlier. The
// selection is therefore tracked as the row element itself, and the <select> is
// rebuilt from the live table whenever the rows change — including immediately
// before Save, which is what turns the choice back into an index.

let _defaultPromptRow = null;

function refreshSelectionButtonPrompts() {
  const select = $("selectionButtonPrompt");
  if (!select) return;
  const rows = [...document.querySelectorAll("#promptTable tbody .promptRow")];
  if (!rows.includes(_defaultPromptRow)) _defaultPromptRow = null;

  select.innerHTML = "";
  rows.forEach((row, i) => {
    if (!row.querySelector(".enabled").checked) return;
    if (row.querySelector(".context").value === "page") return;
    const opt = document.createElement("option");
    opt.value = i;
    opt.text  = row.querySelector(".title").textContent.trim() || "(untitled)";
    select.appendChild(opt);
  });

  if (_defaultPromptRow) select.value = String(rows.indexOf(_defaultPromptRow));
  // The remembered row may have been disabled or switched to page context, in
  // which case it is no longer offered; fall back to the first prompt that is.
  if (select.selectedIndex < 0) {
    _defaultPromptRow = select.options.length ? rows[Number(select.options[0].value)] : null;
    if (_defaultPromptRow) select.value = String(rows.indexOf(_defaultPromptRow));
  }
}

function populatePromptTable(prompts, defaultPromptId = 0) {
  document.querySelector("#promptTable tbody").innerHTML = "";
  _defaultPromptRow = null;
  prompts.forEach((p) => appendPromptRow(p));
  const rows = [...document.querySelectorAll("#promptTable tbody .promptRow")];
  _defaultPromptRow = rows[defaultPromptId] || null;
  refreshSelectionButtonPrompts();
}

function resetPrompts() {
  if (!confirm("Reset all prompts to the extension defaults?\n\nClick Save to make it permanent.")) return;
  populatePromptTable(makeDefaultPrompts());
}

function resetCSS() {
  $("defaultPopupStyle").value = DEFAULT_POPUP_STYLE;
}

// ── Save ──────────────────────────────────────────────────────────────────────

function saveOptions() {
  const opts = new Options();

  // Providers
  for (const key of Object.keys(PROVIDERS)) {
    opts.providers[key] = {
      token: (document.getElementById(`${key}-token`)?.value || "").trim(),
      model: (document.getElementById(`${key}-model`)?.value || "").trim(),
    };
  }
  opts.defaultProvider = $("defaultProvider").value;

  // Appearance
  opts.defaultPopupStyle = $("defaultPopupStyle").value.trim();

  // Behavior. The dropdown is rebuilt first so its value is an index into the
  // rows as they stand now, not as they stood when the page loaded.
  refreshSelectionButtonPrompts();
  opts.selectionButton = {
    enabled:         $("selectionButtonEnabled").checked,
    defaultPromptId: parseInt($("selectionButtonPrompt").value) || 0,
  };
  opts.customQueryOutputMode   = $("customQueryOutputMode").value;
  // Not trimmed away to a default: an empty box means "send no system message".
  opts.customQuerySystemPrompt = $("customQuerySystemPrompt").value.trim();

  // Sync
  opts.syncEnabled     = $("syncEnabled").checked;
  opts.syncIncludeKeys = $("syncIncludeKeys").checked;

  // Prompts
  document.querySelectorAll("#promptTable tbody .promptRow").forEach((row) => {
    const p           = new StoredPrompt();
    p.enabled         = row.querySelector(".enabled").checked;
    p.context         = row.querySelector(".context").value;
    p.outputMode      = row.querySelector(".outputMode").value;
    p.followUpRounds  = readFollowUpRounds(row.querySelector(".followUpRounds"));
    p.title           = row.querySelector(".title").textContent.trim();
    p.content         = row.querySelector(".content").textContent.trim();
    p.userContent     = row.querySelector(".userContent").textContent.trim();
    p.providerOverride = row.querySelector(".providerOverride").value;
    p.modelOverride   = row.querySelector(".modelOverride").value.trim();
    p.extraParams     = row.querySelector(".extraParams").textContent.trim();
    p.popupStyle      = row.querySelector(".popupStyle").textContent.trim();
    opts.promptData.push(p);
  });

  chrome.storage.local.set(opts).then(() => {
    // Drop pre-1.73 keys. chrome.storage.local.set merges, so the legacy top-level
    // `token` would otherwise linger and get re-migrated into providers.openai.token
    // on every load — resurrecting the key even after the user deliberately clears it.
    chrome.storage.local.remove(["token", "extButtonPrompt", "buttonPopupSelectedPrompt"]);
    // Mirror to chrome.storage.sync so a signed-in browser profile carries prompts,
    // CSS and behaviour to the user's other machines (background.js applies it on
    // the other side). API keys travel only if the user ticked that box. Failure is
    // non-fatal: sync may be over quota or unavailable (e.g. Firefox temporary
    // installs); local storage remains the source of truth either way.
    const mirrored = opts.syncEnabled
      ? pushOptionsToSync(opts)
      : clearSyncedOptions().then(() => null);
    mirrored
      .then((savedAt) => chrome.storage.local.set({ syncSavedAt: savedAt || 0 }))
      .catch((err) => console.warn("lcgpt: could not mirror settings to sync storage:", err));
    // Briefly flash the save button to confirm
    const btn = $("savePrompts");
    btn.textContent = "Saved ✓";
    setTimeout(() => { btn.textContent = "Save"; }, 1200);
  });
}

// An empty box is someone who cleared it to retype, not a request for a one-shot
// prompt. Blank means the default of one round; 0 stays 0.
function readFollowUpRounds(input) {
  const raw = (input?.value || "").trim();
  if (raw === "") return 1;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function moveRow(button, direction) {
  const row = button.closest("tr");
  if (!row) return;
  if (direction === "up" && row.previousElementSibling) {
    row.parentNode.insertBefore(row, row.previousElementSibling);
  } else if (direction === "down" && row.nextElementSibling) {
    row.parentNode.insertBefore(row.nextElementSibling, row);
  }
  refreshSelectionButtonPrompts();
}

function toggleAdvancedColumns() {
  showAdvanced = $("toggleAdvancedColumns").checked;
  document.querySelectorAll(".advanced").forEach((el) => {
    el.style.display = showAdvanced ? "" : "none";
  });
}

// Rows are assembled from DOM nodes, never from an HTML string. Prompt text is
// arbitrary user content — "wrap the answer in <b> tags", an extraParams value of
// {"stop": ["<end>"]}, a model override containing a quote — and anything the HTML
// parser takes for a tag is lost on screen and lost again when the row is read back
// out and saved. Set text as text and none of that arises.

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.appendChild(child);
  return node;
}

function cell(children, { advanced = false, align } = {}) {
  const td = el("td", {}, [].concat(children));
  if (advanced) {
    td.className = "advanced";
    td.style.display = showAdvanced ? "" : "none";
  }
  if (align) td.style.textAlign = align;
  return td;
}

// A contenteditable div whose text is set as text, never parsed as markup.
function editableCell(className, text, options) {
  const div = el("div", { className, contentEditable: "true", textContent: text || "" });
  return cell(div, options);
}

function selectCell(className, entries, selected, options) {
  const select = el("select", { className });
  for (const [value, label] of entries) {
    select.appendChild(el("option", { value, textContent: label, selected: value === selected }));
  }
  return cell(select, options);
}

function appendPromptRow(prompt) {
  const row = el("tr", { className: "promptRow" });

  row.appendChild(cell([
    el("button", { className: "moveUpButton",   title: "Move up",   textContent: "^" }),
    el("button", { className: "moveDownButton", title: "Move down", textContent: "v" }),
  ]));

  row.appendChild(cell(el("input", {
    type: "checkbox", className: "enabled", checked: Boolean(prompt.enabled), title: "Enable this prompt",
  }), { align: "center" }));

  row.appendChild(selectCell("outputMode", [
    ["popup",   "Show popup"],
    ["replace", "Replace selection"],
  ], prompt.outputMode === "replace" ? "replace" : "popup"));

  row.appendChild(cell(el("input", {
    type: "number", className: "followUpRounds", value: String(prompt.followUpRounds ?? 1),
    min: "0", max: "20",
    title: "0 = hide follow-up box | 1 = last exchange only (default) | N = last N exchanges",
  }), { align: "center" }));

  row.appendChild(editableCell("title",   prompt.title));
  row.appendChild(editableCell("content", prompt.content));

  row.appendChild(selectCell("context", [
    ["selection", "Selection"],
    ["page",      "Page"],
  ], prompt.context === "page" ? "page" : "selection", { advanced: true }));

  row.appendChild(editableCell("userContent", prompt.userContent, { advanced: true }));

  row.appendChild(selectCell("providerOverride", [
    ["", "— global default —"],
    ...Object.entries(PROVIDERS).map(([key, p]) => [key, p.label]),
  ], prompt.providerOverride || "", { advanced: true }));

  row.appendChild(cell(el("input", {
    type: "text", className: "modelOverride", value: prompt.modelOverride || "",
    placeholder: "(provider default)",
  }), { advanced: true }));

  row.appendChild(editableCell("extraParams", prompt.extraParams, { advanced: true }));
  row.appendChild(editableCell("popupStyle",  prompt.popupStyle,  { advanced: true }));

  row.appendChild(cell(el("button", { className: "deleteButton", textContent: "x" })));

  document.querySelector("#promptTable tbody").appendChild(row);
  refreshSelectionButtonPrompts();
}
