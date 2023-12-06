chrome.storage.local.get(null, createContextMenus);
chrome.contextMenus.onClicked.addListener(handleContextMenuClicked);
chrome.storage.onChanged.addListener(handleLocalStorageChanges);
// Listen for regeneration requests from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if(request.action === 'relookup') {
    sendRequestToAPI(request.lookup);
  }
  if (request.action === "ext_button_message") {
    handleExtButtonMessage(request.userText, request.tab);
	}
});
//runs once on install
chrome.runtime.onInstalled.addListener(function(details) {
  if(details.reason == "install") {
    
  }
});

// Remove all existing contextMenus and add the new ones from local storage
function createContextMenus(result) {
  chrome.contextMenus.removeAll(function () {
    if (!result || !result.promptData) return;
    result.promptData.forEach((entry, i) => {
      if (!entry.enabled) return;
      chrome.contextMenus.create({ id: `custom-prompt-${i}`, title: entry.title, contexts: [entry.context], });
    });
  });
}

function handleLocalStorageChanges(changes, _) {
  for (let key in changes) {
    if (key === 'promptData') chrome.storage.local.get({promptData: []}, createContextMenus);
  }
}

function processPrompt(prompt, varData = {selectedText:"", pageTitle:"", pageURL:""}) {
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

function handleExtButtonMessage(userText, tab) {
  chrome.storage.local.get(null, function (options) {
    const prompt = {
      content: options.extButtonPrompt || "",
      userContent: userText,
      title: "Popup"
    };
    processPrompt(prompt, {selectedText: "", pageTitle: tab.title, pageURL: tab.url})

    sendRequestToAPI({
      selectedText: "",
      tabId: tab.id,
      token: options.token,
      //promptId: promptId,
      prompt: prompt,
      defaultPopupStyle: options.defaultPopupStyle,
    });
  });
}

function handleContextMenuClicked(info, tab) {
  const menuItemIdParts = info.menuItemId.split('-');
  const promptId = menuItemIdParts[menuItemIdParts.length - 1];

  chrome.storage.local.get(null, function (options) {
    const prompt = options.promptData[promptId];
    processPrompt(prompt, {selectedText: info.selectionText, pageTitle: tab.title, pageURL: tab.url})
    
    sendRequestToAPI({
      selectedText: info.selectionText, 
      tabId: tab.id, 
      token: options.token, 
      promptId: promptId,
      prompt: prompt,
      defaultPopupStyle: options.defaultPopupStyle,
    });
  });
}

function sendRequestToAPI(lookup = {selectedText:"", }) {
  const requestData = {
    'model': 'gpt-3.5-turbo',
    'messages': [
      { 'role': 'system', 'content': lookup.prompt.content },
      // { 'role': 'user', 'content': lookup.selectedText },
    ],
  };
  if (lookup.prompt.userContent) {
    requestData.messages.push({ 'role': 'user', 'content': lookup.prompt.userContent });
  }
  if (lookup.userQuestion) {
    requestData.messages.push({ 'role': 'assistant', 'content': lookup.lookupResult });
    requestData.messages.push({ 'role': 'user', 'content': lookup.userQuestion });
  }

  if (lookup.prompt.promptSettings) {
    const settingsOverride = JSON.parse(lookup.prompt.promptSettings);
    for (let key in settingsOverride) {
      requestData[key] = settingsOverride[key] || requestData[key];
    }
  }
  
  fetch("https://api.openai.com/v1/chat/completions", {
    "headers": {
      "authorization": `Bearer ${lookup.token}`,
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
    }
    else {
      lookup.lookupResult = resJson.choices[0].message.content;
    }
    chrome.tabs.sendMessage(lookup.tabId, {
      action: "displayResult",
      lookup,
    })
  })
  .catch(error => console.error(error));
}

