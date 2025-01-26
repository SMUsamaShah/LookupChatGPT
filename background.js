importScripts("defaults.js");

chrome.storage.local.get(null).then(createContextMenus);
chrome.storage.onChanged.addListener(handleLocalStorageChanges);
chrome.contextMenus.onClicked.addListener(handleContextMenuClicked);
// Listen for regeneration requests from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'relookup': sendRequestToAPI(request.lookup); return true;
    case "ext_button_message": handleExtButtonMessage(request.userText, request.tab, request.selectedText, request.promptId); return true;
    default: return false;
  }
});

const PROMPT_ID_PREFIX = "custom-prompt";

// Set default settings
//runs once on install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    const settings = new Options();
    const prompt = new StoredPrompt();
    prompt.title = DEFAULT_SELECTED_TEXT_PROMPT_TITLE;
    prompt.content = DEFAULT_SELECTED_TEXT_PROMPT_CONTENT;
    prompt.userContent = "VAR_SELECTED_TEXT";
    
    settings.defaultPopupStyle = DEFAULT_POPUP_STYLE;
    settings.extButtonPrompt = DEFAULT_EXT_BUTTON_PROMPT;
    settings.promptData.push(prompt); 
    chrome.storage.local.set(settings);
  }
});

// Remove all existing contextMenus and add the new ones from local storage
/** @param {Options} result */
function createContextMenus(result) {
  chrome.contextMenus.removeAll(() => {
    if (!result || !result.promptData) return;
    result.promptData.forEach((entry, i) => {
      if (!entry.enabled) return;
      chrome.contextMenus.create({id: `${PROMPT_ID_PREFIX}-${i}`, title: entry.title, contexts: [entry.context],});
    });
  });
}

function handleLocalStorageChanges(changes, _) {
  for (let key in changes) {
    if (key === 'promptData') chrome.storage.local.get(null).then(createContextMenus);
  }
}

function processPrompt(prompt = new StoredPrompt(), varData = {selectedText: "", pageTitle: "", pageURL: ""}) {
  // Replace variables in the prompt content
  let evaluatedPromptContent = prompt.content;
  let evaluatedPromptUserContent = prompt.userContent;
  const variables = {
    'VAR_SELECTED_TEXT': varData.selectedText || "",
    'VAR_PAGE_TITLE': varData.pageTitle || "",
    'VAR_PAGE_URL': varData.pageURL || "",
  }
  for (let _var in variables) {
    evaluatedPromptContent = evaluatedPromptContent.replace(_var, variables[_var]);
    evaluatedPromptUserContent = evaluatedPromptUserContent.replace(_var, variables[_var]);
  }
  prompt.content = evaluatedPromptContent.trim();
  prompt.userContent = evaluatedPromptUserContent.trim();
}

function handleExtButtonMessage(userText, tab, selectedText, promptId) {
  chrome.storage.local.get(null).then(/** @param {Options} options */ (options) => {
    const prompt = options.promptData[promptId];
    prompt.userContent = userText + "\n" + prompt.userContent;
    processPrompt(prompt, {selectedText: selectedText, pageTitle: tab.title, pageURL: tab.url})

    const lookup= new Lookup();
    lookup.selectedText = selectedText;
    lookup.tabId = tab.id;
    lookup.prompt = prompt;
    lookup.options = options;
    sendRequestToAPI(lookup);
  });
}

function handleContextMenuClicked(info, tab) {
  const menuItemIdParts = info.menuItemId.split('-');
  const promptId = menuItemIdParts[menuItemIdParts.length - 1];

  chrome.storage.local.get(null).then(/** @param {Options} options */ (options) => {
    const prompt = options.promptData[promptId];
    processPrompt(prompt, {selectedText: info.selectionText, pageTitle: tab.title, pageURL: tab.url})

    const lookup = new Lookup();
    lookup.selectedText = info.selectionText;
    lookup.tabId = tab.id;
    lookup.promptId = promptId;
    lookup.prompt = prompt;
    lookup.options = options;
    sendRequestToAPI(lookup);
  });
}

function sendRequestToAPI(lookup = new Lookup()) {
  const requestData = {
    'model': 'gpt-3.5-turbo',
    'messages': [
      {'role': 'system', 'content': lookup.prompt.content},
    ],
  };
  if (lookup.prompt.userContent) {
    // selected text
    requestData.messages.push({'role': 'user', 'content': lookup.prompt.userContent});
  }
  if (lookup.userQuestion) {
    requestData.messages.push({'role': 'assistant', 'content': lookup.lookupResult});
    requestData.messages.push({'role': 'user', 'content': lookup.userQuestion});
  }

  if (lookup.prompt.promptSettings) {
    const settingsOverride = JSON.parse(lookup.prompt.promptSettings);
    for (let key in settingsOverride) {
      requestData[key] = settingsOverride[key] || requestData[key];
    }
  }

  fetch("https://api.openai.com/v1/chat/completions", {
    "headers": {
      "authorization": `Bearer ${lookup.options.token}`,
      "content-type": "application/json",
    },
    "body": JSON.stringify(requestData),
    "method": "POST",
    "mode": "cors",
    "credentials": "include"
  })
  .then(response => response.json())
  .then(resJson => {
    if (resJson.error) {
      lookup.lookupResult = resJson.error.message;
    } else {
      lookup.lookupResult = resJson.choices[0].message.content;
    }
    chrome.tabs.sendMessage(lookup.tabId, {
      action: "displayResult",
      lookup,
    })
  })
  .catch(error => console.error(error));
}