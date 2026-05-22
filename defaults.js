// ── Visual defaults ───────────────────────────────────────────────────────────

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
.lcgpt-question {
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

const DEFAULT_SELECTED_TEXT_PROMPT_CONTENT = "I'll input a word or sentence or a symbol in next message taken from webpage (page title: VAR_PAGE_TITLE page URL: VAR_PAGE_URL). If it is a name of something or someone give some info about that while being terse. If it's a non-english text, just translate it to English. Otherwise just explain what it means.";
const DEFAULT_SELECTED_TEXT_PROMPT_TITLE   = "What's this?";

const DEFAULT_CUSTOM_QUERY_SYSTEM_PROMPT = `Web page title: VAR_PAGE_TITLE
Web page URL: VAR_PAGE_URL
Text in focus from this web page:
VAR_SELECTED_TEXT`;

// ── Shared helpers ────────────────────────────────────────────────────────────

// Shorthand for document.getElementById, used in popup and options scripts.
// Defined without `const` so it works as a plain global in both page and worker contexts
// (in the service worker it's never called, so referencing `document` here is safe).
$ = (id) => document.getElementById(id);

// Rewrites CSS stored by older versions of the extension to use the current
// lcgpt-* selector names. Called by normalizeOptions() in both background.js
// and options.js so the migration happens at every load path.
function migrateCSSClassNames(css) {
  if (!css) return css;
  if (css.includes("lookupchatgpt")) {
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
  return css.replace(/#lcgpt-result-container\b/g, ":host");
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

  defaultPopupStyle         = "";
  buttonPopupSelectedPrompt = ""; // remembers the last-used prompt in the extension button popup

  // Custom on-the-fly queries typed directly in the floating button dropdown
  customQuerySystemPrompt = DEFAULT_CUSTOM_QUERY_SYSTEM_PROMPT;
  customQueryOutputMode   = "auto"; // "auto" = replace if selection is editable, popup otherwise

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
  options      = new Options();
  lookupResult = ""; // the most recent response from the API
  userQuestion = ""; // the current follow-up question (empty on the initial request)

  // Completed past exchanges, oldest first: [{ role: "user"|"assistant", content: string }, ...]
  // Populated only when followUpRounds > 1. Length is kept ≤ (followUpRounds - 1) * 2
  // (each complete exchange = 2 entries). See popup.js for the trimming logic.
  history = [];
}
