// ── Visual defaults ───────────────────────────────────────────────────────────

// The follow-up question box styles live in their own constant because CSS
// migration needs them separately: CSS stored by pre-1.73 versions predates the
// question box, and without these rules the box renders as an invisible
// zero-height div. migrateCSSClassNames() appends this block to legacy CSS.
const DEFAULT_QUESTION_STYLE = `.lcgpt-question {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 1.4em;
  margin-top: 6px;
  padding: 2px 4px;
  border: 1px solid #ccc;
  outline: none;
  background: #fff;
  color: #000;
}`;

const DEFAULT_POPUP_STYLE = `:host {
  display: block;
  position: fixed;
  top: 10px;
  left: 10px;
  z-index: 999999;
  max-width: 60vw;
  font-family: Arial, sans-serif;
  font-size: 14px;
  line-height: 1.4;
  color: #000;
  box-sizing: border-box;
}
.lcgpt-result-panel {
  position: relative;
  padding: 10px 20px 10px 10px;
  background-color: #fff;
  border: 1px solid #000;
  margin-bottom: 6px;
  max-height: 45vh;
  overflow-y: auto;
  resize: both;
  box-sizing: border-box;
}
.lcgpt-button-container {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
}
.lcgpt-btn-dismiss,
.lcgpt-btn-regen {
  display: inline-block;
  padding: 2px 5px;
  cursor: pointer;
  background: none;
  border: none;
  font-size: 12px;
  line-height: 1;
  color: #555;
}
.lcgpt-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 40px;
  font-weight: bold;
  margin-bottom: 6px;
}
.lcgpt-message {
  white-space: pre-wrap;
}
${DEFAULT_QUESTION_STYLE}`;

const DEFAULT_SELECTED_TEXT_PROMPT_CONTENT = "I'll input a word or sentence or a symbol in next message taken from webpage (page title: VAR_PAGE_TITLE page URL: VAR_PAGE_URL). If it is a name of something or someone give some info about that while being terse. If it's a non-english text, just translate it to English. Otherwise just explain what it means.";
const DEFAULT_SELECTED_TEXT_PROMPT_TITLE   = "What's this?";

const DEFAULT_CUSTOM_QUERY_SYSTEM_PROMPT = `Web page title: VAR_PAGE_TITLE
Web page URL: VAR_PAGE_URL
Text in focus from this web page:
VAR_SELECTED_TEXT`;

// ── Shared helpers ────────────────────────────────────────────────────────────

// Shorthand for document.getElementById, used in popup and options scripts.
// The body isn't evaluated until called, so defining it in the service worker
// (where there is no `document`) is harmless — nothing there calls it.
const $ = (id) => document.getElementById(id);

// Rewrites CSS stored by older versions of the extension to use the current
// lcgpt-* selector names. Called by normalizeOptions() in both background.js
// and options.js so the migration happens at every load path.
function migrateCSSClassNames(css) {
  if (!css) return css;
  const isLegacy = css.includes("lookupchatgpt");
  if (isLegacy) {
    css = css
      // Oldest names: lookupchatgpt-popup-* (before the "result-dialog" rename)
      .replace(/#lookupchatgpt-popup-container\b/g,         "#lcgpt-result-container")
      .replace(/\.lookupchatgpt-popup\b/g,                  ".lcgpt-result-panel")
      // Intermediate names: lookupchatgpt-result-dialog-*
      .replace(/#lookupchatgpt-result-dialog-container\b/g, "#lcgpt-result-container")
      .replace(/\.lookupchatgpt-result-dialog\b/g,          ".lcgpt-result-panel")
      // Sub-class names
      .replace(/\.lookupchatgpt-title\b/g,                  ".lcgpt-title")
      .replace(/\.lookupchatgpt-message\b/g,                ".lcgpt-message")
      .replace(/\.lookupchatgpt-question\b/g,               ".lcgpt-question")
      .replace(/\.lookupchatgpt-button-container\b/g,       ".lcgpt-button-container");
  }
  // Migrate from regular DOM selector to shadow DOM :host selector
  css = css.replace(/#lcgpt-result-container\b/g, ":host");
  // Legacy CSS predates the follow-up question box; without these rules the box
  // renders as an invisible zero-height div. Only heal CSS that was actually
  // migrated — CSS already in the current format is the user's own business.
  if (isLegacy && !css.includes(".lcgpt-question")) {
    css += "\n" + DEFAULT_QUESTION_STYLE;
  }
  return css;
}

// Normalises a StoredPrompt loaded from storage, handling fields added or renamed
// in past versions. Called by both background.js and options.js at every load path.
function normalizePrompt(prompt) {
  if (!prompt) return new StoredPrompt();
  // Old format used a boolean `replaceText`; map it to the string outputMode
  if (prompt.replaceText === true && !prompt.outputMode) prompt.outputMode = "replace";
  // Old format used `promptSettings` for raw API JSON; treat it as extraParams
  if (prompt.promptSettings && !prompt.extraParams) prompt.extraParams = prompt.promptSettings;
  prompt.outputMode     = prompt.outputMode     || "popup";
  prompt.followUpRounds = prompt.followUpRounds ?? 1;
  prompt.context        = prompt.context        || "selection";
  prompt.content        = prompt.content        ?? "";
  prompt.userContent    = prompt.userContent    ?? "";
  return prompt;
}

function makeDefaultPrompts() {
  const whatIsThis       = new StoredPrompt();
  whatIsThis.title       = DEFAULT_SELECTED_TEXT_PROMPT_TITLE;
  whatIsThis.content     = DEFAULT_SELECTED_TEXT_PROMPT_CONTENT;
  whatIsThis.userContent = "VAR_SELECTED_TEXT";

  // Deliberately plain: no provider or model override, and it works on the text
  // the user selected rather than on a URL. A shipped default that needs a
  // particular provider's key fails on first click for everyone else.
  const summarize          = new StoredPrompt();
  summarize.title          = "Summarize";
  summarize.content        = "Summarize the following text concisely.";
  summarize.userContent    = "VAR_SELECTED_TEXT";
  summarize.followUpRounds = 0;

  return [whatIsThis, summarize];
}

// ── Options normalisation ─────────────────────────────────────────────────────
// Brings an options object loaded from storage up to the current shape, handling
// fields added or renamed in past versions. Lives here rather than in background.js
// and options.js because a migration that drifts between two copies corrupts data.
// Requires PROVIDERS (providers.js) to be loaded.

function normalizeOptions(options) {
  // Old format had a single top-level `token` field (OpenAI only)
  if (options.token && !options.providers?.openai?.token) {
    options.providers = options.providers || {};
    options.providers.openai = { token: options.token, model: "" };
  }
  options.defaultProvider = options.defaultProvider || "openai";
  options.providers       = options.providers || {};
  // Ensure every known provider has an entry (new providers added after first install)
  for (const key of Object.keys(PROVIDERS)) {
    options.providers[key] = options.providers[key] || { token: "", model: "" };
  }
  options.selectionButton = options.selectionButton || { enabled: false, defaultPromptId: 0 };
  // Migrate CSS stored by older versions; fall back to built-in default if empty/missing
  options.defaultPopupStyle = migrateCSSClassNames(options.defaultPopupStyle) || DEFAULT_POPUP_STYLE;
  // ?? not || : an empty string is a deliberate "send no system message", which
  // the options page explicitly offers. Only an absent value gets the default.
  options.customQuerySystemPrompt = options.customQuerySystemPrompt ?? DEFAULT_CUSTOM_QUERY_SYSTEM_PROMPT;
  options.customQueryOutputMode   = options.customQueryOutputMode || "auto";
  options.syncEnabled     = options.syncEnabled     ?? true;
  options.syncIncludeKeys = options.syncIncludeKeys ?? false;
  return options;
}

// ── Settings sync ─────────────────────────────────────────────────────────────
// The Options object is mirrored to chrome.storage.sync on every save, so a
// signed-in browser profile carries settings (prompts, CSS, behaviour) to the
// user's other machines. chrome.storage.local stays the single source of truth
// that all other code reads; sync is only a transport.
//
// API keys are NOT part of the snapshot unless the user ticks "Include API keys"
// in the options page. chrome.storage.sync leaves the machine and lands on the
// browser vendor's servers, which is not what someone typing a key into a
// password field expects, so it is opt-in. syncMeta records which way a snapshot
// was written; a snapshot written without keys leaves the receiving machine's
// own keys alone instead of blanking them.
//
// chrome.storage.sync allows ~8 KB per item, so the JSON is split into chunks:
//   syncMeta          { savedAt, chunkCount, keysIncluded }
//   syncChunk_0..N-1  string pieces of JSON.stringify(options)
// `syncSavedAt` in *local* storage records which snapshot this machine has
// applied; a snapshot is only adopted when its savedAt is newer, so the most
// recent Save on any machine wins.

// 2000 UTF-16 units re-stringify to at most ~6 KB of UTF-8 (worst case 3 bytes
// per unit; JSON escapes are 2 ASCII bytes), comfortably under the item quota.
const SYNC_CHUNK_CHARS = 2000;

// Resolves to the snapshot timestamp, or null when sync is switched off.
function pushOptionsToSync(options) {
  if (options.syncEnabled === false) return Promise.resolve(null);

  const snapshot     = JSON.parse(JSON.stringify(options));
  const keysIncluded = Boolean(options.syncIncludeKeys);
  if (!keysIncluded) {
    for (const cfg of Object.values(snapshot.providers || {})) cfg.token = "";
  }

  const json    = JSON.stringify(snapshot);
  const payload = {};
  let chunkCount = 0;
  for (let i = 0; i < json.length; i += SYNC_CHUNK_CHARS) {
    payload[`syncChunk_${chunkCount++}`] = json.slice(i, i + SYNC_CHUNK_CHARS);
  }
  const savedAt = Date.now();
  payload.syncMeta = { savedAt, chunkCount, keysIncluded };

  return chrome.storage.sync.get("syncMeta").then((old) =>
    chrome.storage.sync.set(payload).then(() => {
      // Remove chunks left over from a previously larger snapshot, so a stale
      // tail can never be glued onto a shorter one.
      const stale = [];
      for (let i = chunkCount; i < (old.syncMeta?.chunkCount || 0); i++) stale.push(`syncChunk_${i}`);
      return stale.length ? chrome.storage.sync.remove(stale) : undefined;
    })
  ).then(() => savedAt);
}

// Wipes the synced snapshot. Called when the user switches sync off, so keys and
// prompts uploaded by an earlier version do not sit there indefinitely.
function clearSyncedOptions() {
  return chrome.storage.sync.clear()
    .catch((err) => console.warn("lcgpt: could not clear sync storage:", err));
}

// Applies the synced snapshot to local storage if it is newer than what this
// machine has already applied (or unconditionally with force, used on fresh
// installs). Resolves to true when a snapshot was applied.
function restoreOptionsFromSync({ force = false } = {}) {
  return Promise.all([
    chrome.storage.sync.get(null),
    chrome.storage.local.get(["syncSavedAt", "syncEnabled", "providers"]),
  ]).then(([synced, local]) => {
    const meta = synced.syncMeta;
    if (!meta?.chunkCount) return false;
    // A machine that has opted out of sync does not pull snapshots either. The
    // force path (fresh install) still adopts, since that is how a new machine
    // inherits an existing profile — the snapshot carries its own syncEnabled.
    if (!force && local.syncEnabled === false) return false;
    if (!force && meta.savedAt <= (local.syncSavedAt || 0)) return false;
    let json = "";
    for (let i = 0; i < meta.chunkCount; i++) {
      const piece = synced[`syncChunk_${i}`];
      if (typeof piece !== "string") return false; // partially propagated — retry on next sync event
      json += piece;
    }
    const options = JSON.parse(json); // corrupt data throws into the catch below
    // The snapshot was written without keys, so it carries empty token strings.
    // Keep the ones this machine already has rather than wiping them.
    if (meta.keysIncluded === false && options.providers) {
      for (const [key, cfg] of Object.entries(options.providers)) {
        const existing = local.providers?.[key]?.token;
        if (existing) cfg.token = existing;
      }
    }
    return chrome.storage.local
      .set({ ...options, syncSavedAt: meta.savedAt })
      .then(() => true);
  }).catch((err) => {
    console.warn("lcgpt: could not restore settings from sync storage:", err);
    return false;
  });
}

// ── Data classes ──────────────────────────────────────────────────────────────

class StoredPrompt {
  title       = "";
  content     = ""; // system prompt — provider-agnostic instructions sent before the user's text
  userContent = ""; // user message template; supports VAR_SELECTED_TEXT, VAR_PAGE_TITLE, VAR_PAGE_URL
  enabled     = true;
  context     = "selection"; // "selection" = appears on right-click of selected text | "page" = always appears
  outputMode  = "popup";     // "popup" = show result in floating popup | "replace" = replace selected text in-place
  popupStyle  = "";          // CSS override applied inline to .lookupchatgpt-result-dialog for this prompt

  // Controls the follow-up input box shown below every result popup:
  //   0 = hide it entirely (one-shot prompt — translate, replace-text, etc.)
  //   1 = show it, but only keep the immediately preceding exchange in context (default)
  //       This intentionally prevents unbounded chat history; background.js only ever
  //       sees [system, userContent, lastResponse, newQuestion].
  //   N = keep the last N complete exchanges in context (each exchange = user + assistant turn)
  followUpRounds = 1;

  // Advanced per-prompt overrides — leave empty to inherit the global defaults from Options.
  providerOverride = ""; // e.g. "anthropic" — overrides Options.defaultProvider for this prompt only
  modelOverride    = ""; // e.g. "claude-3-5-sonnet-20241022" — overrides the provider's default model
  extraParams      = ""; // JSON string of extra API parameters, e.g. {"temperature": 0.3, "max_tokens": 512}
}

class Options {
  promptData      = [];
  defaultProvider = "openai"; // which provider to use when a prompt has no providerOverride

  // Per-provider configuration. Add a matching entry here when adding a new provider to providers.js.
  // token is required to call that provider; model is optional (empty = use the provider's defaultModel).
  providers = {
    openai:      { token: "", model: "" },
    anthropic:   { token: "", model: "" },
    google:      { token: "", model: "" },
    openrouter:  { token: "", model: "" },
  };

  defaultPopupStyle = "";

  // Custom on-the-fly queries typed directly in the floating button dropdown
  customQuerySystemPrompt = DEFAULT_CUSTOM_QUERY_SYSTEM_PROMPT;
  customQueryOutputMode   = "auto"; // "auto" = replace if selection is editable, popup otherwise

  // Mirror settings to chrome.storage.sync so other machines on the same browser
  // profile pick them up. API keys are excluded unless explicitly opted in —
  // see the Settings sync section above.
  syncEnabled     = true;
  syncIncludeKeys = false;

  selectionButton = {
    enabled:         false, // show a floating ✦ button near any text selection (opt-in, off by default)
    defaultPromptId: 0,     // index into promptData — which prompt the main button click runs
  };
}

class Lookup {
  selectedText = "";
  tabId        = -1;
  promptId     = "";
  prompt       = new StoredPrompt();
  // Full Options inside the background script. What gets messaged to a tab is
  // stripped to the fields the panel needs (see viewForTab in background.js) —
  // API keys must never be handed to a content script.
  options      = new Options();
  requestId    = 0;  // identifies the panel this lookup owns, so a pending panel can be filled in
  lookupResult = ""; // the most recent response from the API
  userQuestion = ""; // the current follow-up question (empty on the initial request)

  // Completed past exchanges, oldest first: [{ role: "user"|"assistant", content: string }, ...]
  // Populated only when followUpRounds > 1. Length is kept ≤ (followUpRounds - 1) * 2
  // (each complete exchange = 2 entries). See popup.js for the trimming logic.
  history = [];
}
