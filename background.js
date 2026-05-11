importScripts("defaults.js", "providers.js");

chrome.storage.local.get(null).then(createContextMenus);
chrome.storage.onChanged.addListener(handleLocalStorageChanges);
chrome.contextMenus.onClicked.addListener(handleContextMenuClicked);

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
    default:
      return false;
  }
});

const PROMPT_ID_PREFIX = "custom-prompt";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    const settings = new Options();
    const prompt   = new StoredPrompt();
    prompt.title       = DEFAULT_SELECTED_TEXT_PROMPT_TITLE;
    prompt.content     = DEFAULT_SELECTED_TEXT_PROMPT_CONTENT;
    prompt.userContent = "VAR_SELECTED_TEXT";
    settings.defaultPopupStyle = DEFAULT_POPUP_STYLE;
    settings.promptData.push(prompt);
    chrome.storage.local.set(settings);
  }
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
        contexts: [entry.context],
      });
    });
  });
}

function handleLocalStorageChanges(changes) {
  if ("promptData" in changes) chrome.storage.local.get(null).then(createContextMenus);
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
  options.providers       = options.providers || { openai: { token: "", model: "" } };
  options.selectionButton = options.selectionButton || { enabled: false, defaultPromptId: 0 };
  return options;
}

function normalizePrompt(prompt) {
  // Old format used a boolean `replaceText`; map it to the string outputMode
  if (prompt.replaceText === true && !prompt.outputMode) prompt.outputMode = "replace";
  // Old format used `promptSettings` for raw API JSON; treat it as extraParams
  if (prompt.promptSettings && !prompt.extraParams) prompt.extraParams = prompt.promptSettings;
  prompt.outputMode     = prompt.outputMode     || "popup";
  prompt.followUpRounds = prompt.followUpRounds ?? 1;
  return prompt;
}

// ── Prompt variable substitution ──────────────────────────────────────────────

function processPrompt(prompt, varData) {
  const vars = {
    VAR_SELECTED_TEXT: varData.selectedText || "",
    VAR_PAGE_TITLE:    varData.pageTitle    || "",
    VAR_PAGE_URL:      varData.pageURL      || "",
  };
  for (const [key, val] of Object.entries(vars)) {
    prompt.content     = prompt.content.replace(key, val);
    prompt.userContent = prompt.userContent.replace(key, val);
  }
  prompt.content     = prompt.content.trim();
  prompt.userContent = prompt.userContent.trim();
}

// ── Lookup assembly ───────────────────────────────────────────────────────────

function buildLookup(options, prompt, tabId, promptId, selectedText) {
  const lookup        = new Lookup();
  lookup.selectedText = selectedText;
  lookup.tabId        = tabId;
  lookup.promptId     = promptId ?? "";
  lookup.prompt       = prompt;
  lookup.options      = options;
  return lookup;
}

// ── Message handlers ──────────────────────────────────────────────────────────

function handleContextMenuClicked(info, tab) {
  const parts    = info.menuItemId.split("-");
  const promptId = parts[parts.length - 1];

  chrome.storage.local.get(null).then((options) => {
    normalizeOptions(options);
    const prompt = normalizePrompt(options.promptData[promptId]);
    processPrompt(prompt, { selectedText: info.selectionText, pageTitle: tab.title, pageURL: tab.url });
    sendRequestToAPI(buildLookup(options, prompt, tab.id, promptId, info.selectionText));
  });
}

function handleExtButtonMessage(userText, tab, selectedText, promptId) {
  chrome.storage.local.get(null).then((options) => {
    normalizeOptions(options);
    const prompt = normalizePrompt(options.promptData[promptId]);
    // Any text typed in the extension button popup is prepended to the prompt's user message
    if (userText) prompt.userContent = userText + "\n" + prompt.userContent;
    processPrompt(prompt, { selectedText, pageTitle: tab.title, pageURL: tab.url });
    sendRequestToAPI(buildLookup(options, prompt, tab.id, promptId, selectedText));
  });
}

function handleSelectionButtonClick(promptId, selectedText, pageTitle, pageURL, tabId) {
  chrome.storage.local.get(null).then((options) => {
    normalizeOptions(options);
    const prompt = normalizePrompt(options.promptData[promptId]);
    processPrompt(prompt, { selectedText, pageTitle, pageURL });
    sendRequestToAPI(buildLookup(options, prompt, tabId, promptId, selectedText));
  });
}

// ── Tab messaging ─────────────────────────────────────────────────────────────

// Sends a message to the content script in a tab.
// Retries with exponential backoff in case the content script isn't ready yet
// (e.g. document_end hasn't fired, or the page is still loading).
function sendMessageToTab(tabId, message, retries = 5, delay = 200) {
  chrome.tabs.sendMessage(tabId, message).catch((err) => {
    if (retries > 0) {
      setTimeout(() => sendMessageToTab(tabId, message, retries - 1, delay * 1.5), delay);
    } else {
      console.error("Could not deliver message to tab after retries:", err);
    }
  });
}

// ── API call ──────────────────────────────────────────────────────────────────

function sendRequestToAPI(lookup) {
  // Resolve provider: per-prompt override → global default → fallback to openai
  const providerKey = lookup.prompt.providerOverride || lookup.options.defaultProvider || "openai";
  const provider    = PROVIDERS[providerKey];
  if (!provider) {
    console.error(`Unknown provider "${providerKey}". Check your settings.`);
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
      console.warn("Invalid extraParams JSON — ignoring:", lookup.prompt.extraParams);
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
    sendMessageToTab(lookup.tabId, { action: "displayResult", lookup });
  })
  .catch((err) => console.error("API request failed:", err));
}
