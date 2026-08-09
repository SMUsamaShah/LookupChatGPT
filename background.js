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

// Every branch answers synchronously, so none of them returns true. Returning
// true promises a later sendResponse; without one the message channel stays open
// indefinitely, the sender's callback never runs and its promise never settles.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "relookup":               handleRelookup(request.lookup);              break;
    case "ext_button_message":     handleExtButtonMessage(request);             break;
    case "selection_button_click": handleSelectionButtonClick(request, sender); break;
    case "custom_selection_query": handleCustomSelectionQuery(request, sender); break;
    default:
      return false;
  }
  sendResponse(true);
  return false;
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

// ── Message handlers ──────────────────────────────────────────────────────────
//
// Every entry point ends up doing the same four things: read the settings, decide
// which prompt to run, substitute the page variables into it, and send it. They
// differ only in where the selected text and page details come from, and in how
// the prompt is chosen — so that last part is the callback.

function startLookup({ tabId, selectedText, pageTitle, pageURL, promptId = "", choosePrompt }) {
  chrome.storage.local.get(null).then((options) => {
    normalizeOptions(options);
    const prompt = choosePrompt(options);
    processPrompt(prompt, { selectedText, pageTitle, pageURL });
    sendRequestToAPI(Object.assign(new Lookup(), { selectedText, tabId, promptId, prompt, options }));
  }).catch((err) => console.error("lcgpt: lookup failed:", err));
}

function handleContextMenuClicked(info, tab) {
  const promptId = info.menuItemId.split("-").pop();
  startLookup({
    tabId: tab.id, selectedText: info.selectionText, pageTitle: tab.title, pageURL: tab.url, promptId,
    choosePrompt: (options) => normalizePrompt(options.promptData[promptId]),
  });
}

// From the toolbar popup, which supplies the tab because it has no sender.tab.
function handleExtButtonMessage({ userText, tab, selectedText, promptId }) {
  startLookup({
    tabId: tab.id, selectedText, pageTitle: tab.title, pageURL: tab.url, promptId,
    choosePrompt: (options) => {
      const prompt = normalizePrompt(options.promptData[promptId]);
      if (userText) prompt.userContent = userText + "\n" + prompt.userContent;
      return prompt;
    },
  });
}

// From the floating button in the page; sender.tab.id saves the content script
// from having to know its own tab ID.
function handleSelectionButtonClick({ promptId, selectedText, pageTitle, pageURL }, sender) {
  startLookup({
    tabId: sender.tab?.id, selectedText, pageTitle, pageURL, promptId,
    choosePrompt: (options) => normalizePrompt(options.promptData[promptId]),
  });
}

// A question typed straight into the floating button or the toolbar popup, with
// no stored prompt behind it.
function handleCustomSelectionQuery(request, sender) {
  const { queryText, selectedText, pageTitle, pageURL, outputMode } = request;
  startLookup({
    tabId: request.tabId ?? sender.tab?.id, selectedText, pageTitle, pageURL,
    choosePrompt: (options) => Object.assign(new StoredPrompt(), {
      title:          "Custom query",
      // normalizeOptions fills in the default when the field is absent, so an
      // empty string here is the user's deliberate "no system message".
      content:        options.customQuerySystemPrompt,
      userContent:    queryText,
      outputMode,
      followUpRounds: 1,
    }),
  });
}

// A follow-up arrives carrying the lookup its panel was rendered from, stripped
// of everything secret on the way out (see viewForTab). Options are re-read from
// storage rather than trusted from the tab: that keeps API keys in the service
// worker, and picks up settings changed since the first request.
function handleRelookup(view) {
  if (!view) return;
  chrome.storage.local.get(null).then((options) => {
    normalizeOptions(options);
    sendRequestToAPI(Object.assign(new Lookup(), view, { options, prompt: normalizePrompt(view.prompt) }));
  }).catch((err) => console.error("lcgpt: follow-up failed:", err));
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

// What a tab is allowed to see of a Lookup. Everything the panel needs and
// nothing else — in particular no `providers`, which holds the API keys. The
// content script sends this object back for follow-ups, and handleRelookup
// re-reads the real options from storage.
function viewForTab(lookup) {
  return {
    selectedText: lookup.selectedText,
    tabId:        lookup.tabId,
    promptId:     lookup.promptId,
    prompt:       lookup.prompt,
    requestId:    lookup.requestId,
    lookupResult: lookup.lookupResult,
    userQuestion: lookup.userQuestion,
    history:      lookup.history || [],
    options:      { defaultPopupStyle: lookup.options.defaultPopupStyle },
  };
}

// ── Toolbar badge ─────────────────────────────────────────────────────────────
// The extension icon is the only surface that works everywhere, including the
// pages a content script can never reach, so it carries both "working on it" and
// "that failed". Badges are per-tab so one tab's request cannot clear another's.

const BADGE_WORKING = "…";
const BADGE_FAILED  = "!";
const _pendingByTab = new Map(); // tabId -> count of in-flight requests

// Firefox's chrome.* shims do not all return promises the way Chrome's do, and a
// tab closed mid-request rejects these anyway. Neither is worth reporting.
function ignoreResult(maybePromise) {
  if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch(() => {});
}

function setBadge(tabId, text, colour, title) {
  if (typeof tabId !== "number" || tabId < 0) return;
  ignoreResult(chrome.action.setBadgeText({ tabId, text }));
  if (colour) ignoreResult(chrome.action.setBadgeBackgroundColor({ tabId, color: colour }));
  ignoreResult(chrome.action.setTitle({ tabId, title: title || "" }));
}

function markRequestStarted(tabId) {
  _pendingByTab.set(tabId, (_pendingByTab.get(tabId) || 0) + 1);
  setBadge(tabId, BADGE_WORKING, "#4a76d0", "Looking up…");
}

function markRequestFinished(tabId) {
  const left = (_pendingByTab.get(tabId) || 1) - 1;
  if (left > 0) { _pendingByTab.set(tabId, left); return; } // another lookup is still running
  _pendingByTab.delete(tabId);
  setBadge(tabId, "", null, "");
}

function markRequestFailed(tabId, message) {
  _pendingByTab.delete(tabId);
  setBadge(tabId, BADGE_FAILED, "#c0392b", message);
  setTimeout(() => {
    if (!_pendingByTab.has(tabId)) setBadge(tabId, "", null, "");
  }, 8000);
}

// ── API call ──────────────────────────────────────────────────────────────────

let _nextRequestId = 1;

// Turns whatever went wrong into one line a person can act on.
function describeRequestError(err) {
  const text = String(err?.message || err || "");
  if (/Failed to fetch|NetworkError|network error/i.test(text)) {
    return "Could not reach the API. Check your connection and that the extension has access to that host.";
  }
  if (/Unexpected token|JSON/i.test(text)) {
    return "The API returned something that wasn't JSON — usually a proxy or an error page.";
  }
  return text || "The request failed.";
}

async function sendRequestToAPI(lookup) {
  const wantsPanel = lookup.prompt.outputMode !== "replace";
  lookup.requestId = lookup.requestId || _nextRequestId++;

  // The toolbar icon is the only surface that works on every page, so it always
  // carries the failure. Pages that can host a panel get the reason spelled out
  // there too, including in replace mode where no panel was opened up front.
  const badgeFail = (message) => markRequestFailed(lookup.tabId, `Lookup failed — ${message}`);

  let panelIsUp = false;
  const fail = async (message) => {
    badgeFail(message);
    lookup.lookupResult = message;
    if (!panelIsUp && !await ensureContentScript(lookup.tabId)) return;
    sendMessageToTab(lookup.tabId, { action: "displayResult", lookup: viewForTab(lookup), failed: true });
  };

  // Get the panel up before spending anything. Doing this first means a page that
  // can never host a panel (chrome://, the Web Store, the PDF viewer) is found out
  // now rather than after a paid-for round trip whose answer has nowhere to go.
  if (wantsPanel) {
    if (!await ensureContentScript(lookup.tabId)) {
      badgeFail("this page doesn't allow extensions to show anything. Try the same lookup on a normal web page.");
      return;
    }
    sendMessageToTab(lookup.tabId, { action: "showPending", lookup: viewForTab(lookup) });
    panelIsUp = true;
  }

  // Resolve provider: per-prompt override → global default → fallback to openai
  const providerKey = lookup.prompt.providerOverride || lookup.options.defaultProvider || "openai";
  const provider    = PROVIDERS[providerKey];
  if (!provider) {
    await fail(`unknown provider "${providerKey}". Check your settings.`);
    return;
  }

  const providerSettings = lookup.options.providers?.[providerKey] || {};
  const apiKey           = providerSettings.token || "";
  if (!apiKey) {
    await fail(`no API key set for ${provider.label}. Add one in the extension's settings.`);
    return;
  }

  markRequestStarted(lookup.tabId);

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

  try {
    const response = await fetch(url, {
      method:  "POST",
      mode:    "cors",
      headers: { ...headers(apiKey), "content-type": "application/json" },
      body:    JSON.stringify(body),
    });

    // Read as text first: a gateway error page or a captive portal answers with
    // HTML, and .json() on that throws something meaningless to the reader. The
    // status line below is what they can act on.
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(response.ok
        ? "The API returned something that wasn't JSON."
        : `HTTP ${response.status} ${response.statusText || ""}`.trim());
    }

    const { result, error } = provider.parseResponse(json);
    lookup.lookupResult = result || error || "No response received.";
    markRequestFinished(lookup.tabId);

    // Replace mode has no pending panel, but still needs the script in the tab.
    if (!wantsPanel && !await ensureContentScript(lookup.tabId)) {
      badgeFail("this page doesn't allow extensions to change it.");
      return;
    }
    sendMessageToTab(lookup.tabId, { action: "displayResult", lookup: viewForTab(lookup) });
  } catch (err) {
    console.error("lcgpt: API request failed:", err);
    await fail(describeRequestError(err));
  }
}
