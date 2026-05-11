// All provider-specific API knowledge lives here.
//
// To add a new provider:
//   1. Add an entry to PROVIDERS below (label, defaultModel, buildRequest, parseResponse)
//   2. Add a matching key to Options.providers in defaults.js
//   3. Add a key/model row to the Providers table in options.html
//   Nothing else needs to change.
//
// buildRequest receives:
//   { systemPrompt, userContent, history, lookupResult, userQuestion, model, extraParams }
//
//   - systemPrompt : the prompt's "content" field (system instructions)
//   - userContent  : the user message template after VAR_* substitution
//   - history      : array of completed past exchanges [{role, content}, ...]
//                    role is always "user" or "assistant" (providers translate as needed)
//   - lookupResult : the most recent assistant response; used as the preceding message
//                    when history is empty and a follow-up question is being asked
//   - userQuestion : the current follow-up question, or "" for the initial request
//   - model        : resolved model string (per-prompt override → options override → defaultModel)
//   - extraParams  : parsed object from the prompt's extraParams JSON field
//
// buildRequest returns: { url, headers(apiKey), body }
//   headers is a function so the API key is never baked into a shared object.
//
// parseResponse receives the raw parsed JSON from the provider.
// Returns: { result } on success, or { error } on failure.

const PROVIDERS = {

  openai: {
    label:        "OpenAI",
    defaultModel: "gpt-4o-mini",

    buildRequest({ systemPrompt, userContent, history, lookupResult, userQuestion, model, extraParams }) {
      const messages = [];
      if (systemPrompt) messages.push({ role: "system",    content: systemPrompt });
      if (userContent)  messages.push({ role: "user",      content: userContent  });

      // Append completed past exchanges (oldest first)
      for (const turn of history) messages.push(turn);

      if (userQuestion) {
        // When history is empty the only preceding assistant message is lookupResult.
        // When history is non-empty its last entry is already the preceding assistant message.
        if (history.length === 0) messages.push({ role: "assistant", content: lookupResult });
        messages.push({ role: "user", content: userQuestion });
      }

      return {
        url:     "https://api.openai.com/v1/chat/completions",
        headers: (apiKey) => ({ "Authorization": `Bearer ${apiKey}` }),
        body:    { model, messages, ...extraParams },
      };
    },

    parseResponse(json) {
      if (json.error) return { error: json.error.message };
      return { result: json.choices[0].message.content };
    },
  },

  anthropic: {
    label:        "Anthropic Claude",
    defaultModel: "claude-3-5-haiku-20241022",

    buildRequest({ systemPrompt, userContent, history, lookupResult, userQuestion, model, extraParams }) {
      // Anthropic separates system instructions from the messages array.
      // Roles are "user" / "assistant" — same as our internal format.
      const messages = [];
      if (userContent) messages.push({ role: "user", content: userContent });
      for (const turn of history) messages.push(turn);
      if (userQuestion) {
        if (history.length === 0) messages.push({ role: "assistant", content: lookupResult });
        messages.push({ role: "user", content: userQuestion });
      }

      return {
        url:     "https://api.anthropic.com/v1/messages",
        headers: (apiKey) => ({
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
        }),
        body: {
          model,
          system:     systemPrompt || undefined, // omit entirely if empty; Anthropic rejects an empty string
          messages,
          max_tokens: 1024, // required by Anthropic; override via extraParams if you need more
          ...extraParams,
        },
      };
    },

    parseResponse(json) {
      if (json.error) return { error: json.error.message };
      return { result: json.content[0].text };
    },
  },

  google: {
    label:        "Google Gemini",
    defaultModel: "gemini-1.5-flash",

    buildRequest({ systemPrompt, userContent, history, lookupResult, userQuestion, model, extraParams }) {
      // Google uses { role, parts: [{ text }] } instead of { role, content }.
      // Google also calls the assistant role "model", not "assistant".
      const toTurn = (role, content) => ({
        role:  role === "assistant" ? "model" : "user",
        parts: [{ text: content }],
      });

      const contents = [];
      if (userContent) contents.push(toTurn("user", userContent));
      for (const turn of history) contents.push(toTurn(turn.role, turn.content));
      if (userQuestion) {
        if (history.length === 0) contents.push(toTurn("assistant", lookupResult));
        contents.push(toTurn("user", userQuestion));
      }

      return {
        // Model name is part of the URL for Google
        url:     `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        headers: (apiKey) => ({ "x-goog-api-key": apiKey }),
        body: {
          // system_instruction is Google's equivalent of a system prompt
          ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
          contents,
          ...extraParams,
        },
      };
    },

    parseResponse(json) {
      if (json.error) return { error: json.error.message };
      return { result: json.candidates[0].content.parts[0].text };
    },
  },

};
