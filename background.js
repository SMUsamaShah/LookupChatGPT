// Chrome runs this as a service worker (importScripts available); Firefox runs it
// as an event page where manifest_firefox.json loads defaults.js/providers.js first.
if (typeof importScripts === "function") importScripts("defaults.js", "providers.js");

chrome.storage.local.get(null).then(createContextMenus);
chrome.storage.onChanged.addListener(handleStorageChanges);
// Catch up on snapshots that synced in while the service worker was asleep
restoreOptionsFromSync();
chrome.contextMenus.onClicked.addListener(handleContextMenuClicked);

// Dynamic content-script registrations do survive restarts, but the setting or
// the permission can change while the worker is asleep, so reconcile on wake.
syncSelectionButtonScript();
chrome.permissions.onAdded.addListener(syncSelectionButtonScript);
chrome.permissions.onRemoved.addListener(syncSelectionButtonScript);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "relookup":
      sendRequestToAPI(request.lookup);
      return true;
    case "ext_button_message":
      handleExtButtonMessage(request.userText, request.tab, request.selectedText, request.promptId);
      return true;
    case "selection_button_click":
      // sender.tab.id is used so the content script doesn't need to know its own tab ID
      handleSelectionButtonClick(request.promptId, request.selectedText, request.pageTitle, request.pageURL, sender.tab.id);
      return true;
    case "custom_selection_query":
      handleCustomSelectionQuery(request.queryText, request.selectedText, request.pageTitle, request.pageURL, request.outputMode, request.tabId ?? sender.tab?.id);
      return true;
    default:
      return false;
  }
});

const PROMPT_ID_PREFIX = "custom-prompt";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  // If this browser profile already has synced settings from another machine,
  // adopt them instead of seeding defaults — the user shouldn't have to set
  // anything up again. (If Chrome hasn't downloaded the sync data yet, defaults
  // are seeded now and the snapshot is adopted when it arrives, because its
  // savedAt will be newer than this machine's.)
  restoreOptionsFromSync({ force: true }).then((restored) => {
    if (restored) return;
    const settings = new Options();
    makeDefaultPrompts().forEach(p => settings.promptData.push(p));
    settings.defaultPopupStyle = DEFAULT_POPUP_STYLE;
    chrome.storage.local.set(settings);
  });
});

// ── Context menu ──────────────────────────────────────────────────────────────

function createContextMenus(result) {
  chrome.contextMenus.removeAll(() => {
    if (!result || !result.promptData) return;
    result.promptData.forEach((entry, i) => {
      if (!entry.enabled) return;
      chrome.contextMenus.create({
        id:       `${PROMPT_ID_PREFIX}-${i}`,
        title:    entry.title,
        contexts: [entry.context || "selection"],
      });
    });
  });
}

function handleStorageChanges(changes, area) {
  if (area === "local" && "promptData" in changes) {
    chrome.storage.local.get(null).then(createContextMenus);
  }
  // Enabling or disabling the floating button decides whether content.js runs
  // persistently on every page.
  if (area === "local" && "selectionButton" in changes) syncSelectionButtonScript();
  // A sync-area change means the user saved settings on another machine (or this
  // one — then the snapshot timestamp check inside makes the restore a no-op).
  // Applying the snapshot writes promptData locally, which re-enters this
  // function via the local branch above and rebuilds the context menus.
  if (area === "sync" && "syncMeta" in changes) {
    restoreOptionsFromSync();
  }
}

// ── Migration helpers ─────────────────────────────────────────────────────────
// These normalise data saved by older versions so the rest of the code can
// assume the current shape without sprinkling version checks everywhere.

function normalizeOptions(options) {
  // Old format had a single top-level `token` field (OpenAI only)
  if (options.token && !options.providers?.openai?.token) {
    options.providers = options.providers || {};
    options.providers.openai = { token: options.token, model: "" };
  }
  options.defaultProvider = options.defaultProvider || "openai";
  options.providers       = options.providers || {};
  for (const key of Object.keys(PROVIDERS)) {
    options.providers[key] = options.providers[key] || { token: "", model: "" };
  }
  options.selectionButton = options.selectionButton || { enabled: false, defaultPromptId: 0 };
  // Migrate CSS stored by older versions; fall back to built-in default if empty/missing
  options.defaultPopupStyle       = migrateCSSClassNames(options.defaultPopupStyle) || DEFAULT_POPUP_STYLE;
  options.customQuerySystemPrompt = options.customQuerySystemPrompt || DEFAULT_CUSTOM_QUERY_SYSTEM_PROMPT;
  options.customQueryOutputMode   = options.customQueryOutputMode   || "auto";
  return options;
}

// ── Prompt variable substitution ──────────────────────────────────────────────

function processPrompt(prompt, varData) {
  const vars = {
    VAR_SELECTED_TEXT: varData.selectedText || "",
    VAR_PAGE_TITLE:    varData.pageTitle    || "",
    VAR_PAGE_URL:      varData.pageURL      || "",
  };
  for (const [key, val] of Object.entries(vars)) {
    prompt.content     = prompt.content.replaceAll(key, val);
    prompt.userContent = prompt.userContent.replaceAll(key, val);
  }
  prompt.content     = prompt.content.trim();
  prompt.userContent = prompt.userContent.trim();
}

// ── Lookup assembly ───────────────────────────────────────────────────────────

// ── Message handlers ──────────────────────────────────────────────────────────

function handleContextMenuClicked(info, tab) {
  const parts    = info.menuItemId.split("-");
  const promptId = parts[parts.length - 1];
  chrome.storage.local.get(null).then((options) => {
    normalizeOptions(options);
    const prompt = normalizePrompt(options.promptData[promptId]);
    processPrompt(prompt, { selectedText: info.selectionText, pageTitle: tab.title, pageURL: tab.url });
    const lookup = Object.assign(new Lookup(), { selectedText: info.selectionText, tabId: tab.id, promptId, prompt, options });
    sendRequestToAPI(lookup);
  }).catch((err) => console.error("lcgpt: context menu handler failed:", err));
}

function handleExtButtonMessage(userText, tab, selectedText, promptId) {
  chrome.storage.local.get(null).then((options) => {
    normalizeOptions(options);
    const prompt = normalizePrompt(options.promptData[promptId]);
    if (userText) prompt.userContent = userText + "\n" + prompt.userContent;
    processPrompt(prompt, { selectedText, pageTitle: tab.title, pageURL: tab.url });
    const lookup = Object.assign(new Lookup(), { selectedText, tabId: tab.id, promptId, prompt, options });
    sendRequestToAPI(lookup);
  }).catch((err) => console.error("lcgpt: ext button handler failed:", err));
}

function handleCustomSelectionQuery(queryText, selectedText, pageTitle, pageURL, outputMode, tabId) {
  chrome.storage.local.get(null).then((options) => {
    normalizeOptions(options);
    const prompt          = new StoredPrompt();
    prompt.title          = "Custom query";
    prompt.content        = options.customQuerySystemPrompt || DEFAULT_CUSTOM_QUERY_SYSTEM_PROMPT;
    prompt.userContent    = queryText;
    prompt.outputMode     = outputMode;
    prompt.followUpRounds = 1;
    processPrompt(prompt, { selectedText, pageTitle, pageURL });
    const lookup = Object.assign(new Lookup(), { selectedText, tabId, promptId: "", prompt, options });
    sendRequestToAPI(lookup);
  }).catch((err) => console.error("lcgpt: custom query handler failed:", err));
}

function handleSelectionButtonClick(promptId, selectedText, pageTitle, pageURL, tabId) {
  chrome.storage.local.get(null).then((options) => {
    normalizeOptions(options);
    const prompt = normalizePrompt(options.promptData[promptId]);
    processPrompt(prompt, { selectedText, pageTitle, pageURL });
    const lookup = Object.assign(new Lookup(), { selectedText, tabId, promptId, prompt, options });
    sendRequestToAPI(lookup);
  }).catch((err) => console.error("lcgpt: selection button handler failed:", err));
}

// ── Tab messaging ─────────────────────────────────────────────────────────────

// Sends a message to the content script in a tab.
// Retries with exponential backoff in case the content script isn't ready yet
// (e.g. document_end hasn't fired, or the page is still loading).
// content.js is not declared in the manifest, so it has to be put into the tab
// before anything can be shown there. The user's click (context menu or toolbar
// icon) grants activeTab for that tab, which is what permits this injection —
// no host permission required, and therefore no install-time warning.
//
// Ping first: a tab that already has the script must not be injected again.
function ensureContentScript(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: "ping" }, () => {
      if (!chrome.runtime.lastError) { resolve(true); return; }   // already present
      chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })
        .then(() => resolve(true))
        .catch((err) => {
          // Restricted pages (chrome://, the Web Store, PDF viewer) can never be
          // injected into. Nothing can be displayed there, with or without this.
          console.error("lcgpt: could not inject content script:", err);
          resolve(false);
        });
    });
  });
}

// ── Floating button registration ──────────────────────────────────────────────
// The floating ✦ button is the one feature needing a script on every page at all
// times, so it is gated behind the optional <all_urls> permission the user grants
// when enabling it. Registration is kept in step with (enabled AND granted).

const SELECTION_BUTTON_SCRIPT_ID = "lcgpt-selection-button";

async function syncSelectionButtonScript() {
  try {
    const { selectionButton } = await chrome.storage.local.get("selectionButton");
    const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] });
    const shouldRun = Boolean(selectionButton?.enabled) && granted;

    const registered = await chrome.scripting.getRegisteredContentScripts({
      ids: [SELECTION_BUTTON_SCRIPT_ID],
    });

    if (shouldRun && registered.length === 0) {
      await chrome.scripting.registerContentScripts([{
        id:      SELECTION_BUTTON_SCRIPT_ID,
        matches: ["<all_urls>"],
        js:      ["content.js"],
        runAt:   "document_end",
      }]);
    } else if (!shouldRun && registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [SELECTION_BUTTON_SCRIPT_ID] });
    }
  } catch (err) {
    console.warn("lcgpt: could not sync the selection-button content script:", err);
  }
}

function sendMessageToTab(tabId, message, retries = 5, delay = 200) {
  chrome.tabs.sendMessage(tabId, message).catch((err) => {
    if (retries > 0) {
      setTimeout(() => sendMessageToTab(tabId, message, retries - 1, delay * 1.5), delay);
    } else {
      console.error("lcgpt: could not deliver message to tab after retries:", err);
    }
  });
}

// ── API call ──────────────────────────────────────────────────────────────────

function sendRequestToAPI(lookup) {
  // Resolve provider: per-prompt override → global default → fallback to openai
  const providerKey = lookup.prompt.providerOverride || lookup.options.defaultProvider || "openai";
  const provider    = PROVIDERS[providerKey];
  if (!provider) {
    console.error(`lcgpt: unknown provider "${providerKey}". Check your settings.`);
    return;
  }

  const providerSettings = lookup.options.providers?.[providerKey] || {};
  const apiKey           = providerSettings.token || "";

  // Model priority: per-prompt override → per-provider setting in options → provider's built-in default
  const model = lookup.prompt.modelOverride || providerSettings.model || provider.defaultModel;

  let extraParams = {};
  if (lookup.prompt.extraParams) {
    try {
      extraParams = JSON.parse(lookup.prompt.extraParams);
    } catch {
      console.warn("lcgpt: invalid extraParams JSON — ignoring:", lookup.prompt.extraParams);
    }
  }

  const { url, headers, body } = provider.buildRequest({
    systemPrompt: lookup.prompt.content,
    userContent:  lookup.prompt.userContent,
    history:      lookup.history || [],
    lookupResult: lookup.lookupResult,
    userQuestion: lookup.userQuestion,
    model,
    extraParams,
  });

  fetch(url, {
    method:  "POST",
    mode:    "cors",
    headers: { ...headers(apiKey), "content-type": "application/json" },
    body:    JSON.stringify(body),
  })
  .then((r) => r.json())
  .then((json) => {
    const { result, error } = provider.parseResponse(json);
    lookup.lookupResult = result || error || "No response received.";
    // Put content.js in the tab before asking it to render anything.
    ensureContentScript(lookup.tabId)
      .then(() => sendMessageToTab(lookup.tabId, { action: "displayResult", lookup }));
  })
  .catch((err) => console.error("lcgpt: API request failed:", err));
}
