// ── Visual defaults ───────────────────────────────────────────────────────────

const DEFAULT_POPUP_STYLE = `#lcgpt-result-container {
  position: fixed;
  top: 10px;
  left: 10px;
  padding: 10px;
  padding-right: 20px;
  z-index: 999999;
  max-width: 60vw;
}
.lcgpt-result-panel {
  color: black;
  position: relative;
  padding: 10px;
  padding-right: 20px;
  background-color: white;
  border: 1px solid black;
  font-family: Arial, sans-serif;
  margin-right: 10px;
  max-height: 45vh;
  overflow-y: auto;
  resize: both;
}
.lcgpt-result-panel .lcgpt-button-container {
  position: absolute;
  top: 0;
  right: 0;
}
.lcgpt-result-panel .lcgpt-title {
  overflow: hidden;
  text-overflow: ellipsis;
  width: initial;
  white-space: nowrap;
  display: block;
  padding-right: 30px;
}
.lcgpt-result-panel .lcgpt-message {
}`;

const DEFAULT_SELECTED_TEXT_PROMPT_CONTENT = "I'll input a word or sentence or a symbol in next message taken from webpage (page title: VAR_PAGE_TITLE page URL: VAR_PAGE_URL). If it is a name of something or someone give some info about that while being terse. If it's a non-english text, just translate it to English. Otherwise just explain what it means.";
const DEFAULT_SELECTED_TEXT_PROMPT_TITLE   = "What's this?";

// ── Shared helper ─────────────────────────────────────────────────────────────

// Shorthand for document.getElementById, used in popup and options scripts.
// Defined without `const` so it works as a plain global in both page and worker contexts
// (in the service worker it's never called, so referencing `document` here is safe).
$ = (id) => document.getElementById(id);

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
    openai:    { token: "", model: "" },
    anthropic: { token: "", model: "" },
    google:    { token: "", model: "" },
  };

  defaultPopupStyle         = "";
  buttonPopupSelectedPrompt = ""; // remembers the last-used prompt in the extension button popup

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
