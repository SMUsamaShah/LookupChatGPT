// Options page logic.
// Loaded after defaults.js and providers.js, so StoredPrompt, Options, and PROVIDERS are available.

chrome.storage.local.get(null).then(loadOptions);

let showAdvanced = false;

document.addEventListener("click", (e) => {
  if      (e.target.matches(".deleteButton"))        e.target.closest("tr").remove();
  else if (e.target.matches(".moveUpButton"))        moveRow(e.target, "up");
  else if (e.target.matches(".moveDownButton"))      moveRow(e.target, "down");
  else if (e.target.matches("#toggleAdvancedColumns")) toggleAdvancedColumns();
  else if (e.target.matches("#addNewPrompt"))        appendPromptRow(new StoredPrompt());
  else if (e.target.matches("#savePrompts"))         saveOptions();
});

// ── Load ──────────────────────────────────────────────────────────────────────

function loadOptions(raw) {
  if (!raw) return;
  const opts = migrateOptions(raw);

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
  $("customQuerySystemPrompt").value     = opts.customQuerySystemPrompt || "";

  // Prompts — build both the table rows and the floating-button default dropdown
  if (opts.promptData) {
    const selBtnSelect = $("selectionButtonPrompt");
    selBtnSelect.innerHTML = "";
    opts.promptData.forEach((prompt, i) => {
      appendPromptRow(normalizePrompt(prompt));
      // Populate the floating-button default dropdown with enabled selection prompts
      if (prompt.enabled && prompt.context === "selection") {
        const opt   = document.createElement("option");
        opt.value   = i;
        opt.text    = prompt.title;
        opt.selected = i === (selBtn.defaultPromptId ?? 0);
        selBtnSelect.appendChild(opt);
      }
    });
  }

  toggleAdvancedColumns(); // apply initial visibility
}

// ── Migration ─────────────────────────────────────────────────────────────────
// Handle data saved by older versions of the extension.

function migrateOptions(opts) {
  // Old format had a single top-level `token` (OpenAI only)
  if (opts.token && !opts.providers?.openai?.token) {
    opts.providers = opts.providers || {};
    opts.providers.openai = { token: opts.token, model: "" };
  }
  opts.defaultProvider = opts.defaultProvider || "openai";
  opts.providers       = opts.providers       || {};
  // Ensure every known provider has an entry (new providers added after first install)
  for (const key of Object.keys(PROVIDERS)) {
    opts.providers[key] = opts.providers[key] || { token: "", model: "" };
  }
  opts.selectionButton = opts.selectionButton || { enabled: false, defaultPromptId: 0 };
  // Migrate CSS stored by older versions; fall back to built-in default if empty/missing
  opts.defaultPopupStyle      = migrateCSSClassNames(opts.defaultPopupStyle) || DEFAULT_POPUP_STYLE;
  opts.customQuerySystemPrompt = opts.customQuerySystemPrompt || DEFAULT_CUSTOM_QUERY_SYSTEM_PROMPT;
  opts.customQueryOutputMode   = opts.customQueryOutputMode   || "auto";
  return opts;
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

  // Behavior
  opts.selectionButton = {
    enabled:         $("selectionButtonEnabled").checked,
    defaultPromptId: parseInt($("selectionButtonPrompt").value) || 0,
  };
  opts.customQueryOutputMode   = $("customQueryOutputMode").value;
  opts.customQuerySystemPrompt = $("customQuerySystemPrompt").value.trim();

  // Prompts
  document.querySelectorAll("#promptTable tbody .promptRow").forEach((row) => {
    const p           = new StoredPrompt();
    p.enabled         = row.querySelector(".enabled").checked;
    p.context         = row.querySelector(".context").value;
    p.outputMode      = row.querySelector(".outputMode").value;
    p.followUpRounds  = parseInt(row.querySelector(".followUpRounds").value) || 0;
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
    // Briefly flash the save button to confirm
    const btn = $("savePrompts");
    btn.textContent = "Saved ✓";
    setTimeout(() => { btn.textContent = "Save"; }, 1200);
  });
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
}

function toggleAdvancedColumns() {
  showAdvanced = $("toggleAdvancedColumns").checked;
  document.querySelectorAll(".advanced").forEach((el) => {
    el.style.display = showAdvanced ? "" : "none";
  });
}

// Builds the provider <select> options from PROVIDERS so the table
// stays in sync automatically when new providers are added to providers.js
function providerSelectHTML(selected) {
  const blank = `<option value="">— global default —</option>`;
  const rest  = Object.entries(PROVIDERS)
    .map(([key, p]) => `<option value="${key}" ${selected === key ? "selected" : ""}>${p.label}</option>`)
    .join("");
  return blank + rest;
}

function appendPromptRow(prompt) {
  const adv  = `class="advanced" style="display:${showAdvanced ? "" : "none"}"`;
  const row  = document.createElement("tr");
  row.className = "promptRow";
  row.innerHTML = `
    <td>
      <button class="moveUpButton"   title="Move up">^</button>
      <button class="moveDownButton" title="Move down">v</button>
    </td>
    <td style="text-align:center">
      <input type="checkbox" class="enabled" ${prompt.enabled ? "checked" : ""} title="Enable this prompt">
    </td>
    <td>
      <select class="outputMode">
        <option value="popup"   ${prompt.outputMode !== "replace" ? "selected" : ""}>Show popup</option>
        <option value="replace" ${prompt.outputMode === "replace" ? "selected" : ""}>Replace selection</option>
      </select>
    </td>
    <td style="text-align:center">
      <input type="number" class="followUpRounds" value="${prompt.followUpRounds ?? 1}"
             min="0" max="20" title="0 = hide follow-up box | 1 = last exchange only (default) | N = last N exchanges">
    </td>
    <td><div contenteditable class="title">${prompt.title}</div></td>
    <td><div contenteditable class="content">${prompt.content}</div></td>
    <td ${adv}>
      <select class="context">
        <option value="selection" ${prompt.context !== "page" ? "selected" : ""}>Selection</option>
        <option value="page"      ${prompt.context === "page" ? "selected" : ""}>Page</option>
      </select>
    </td>
    <td ${adv}><div contenteditable class="userContent">${prompt.userContent || ""}</div></td>
    <td ${adv}>
      <select class="providerOverride">
        ${providerSelectHTML(prompt.providerOverride || "")}
      </select>
    </td>
    <td ${adv}><input type="text" class="modelOverride" value="${prompt.modelOverride || ""}" placeholder="(provider default)"></td>
    <td ${adv}><div contenteditable class="extraParams">${prompt.extraParams || ""}</div></td>
    <td ${adv}><div contenteditable class="popupStyle">${prompt.popupStyle || ""}</div></td>
    <td><button class="deleteButton">x</button></td>
  `;
  document.querySelector("#promptTable tbody").appendChild(row);
}
