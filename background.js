chrome.storage.local.get(null, createContextMenus);
chrome.contextMenus.onClicked.addListener(handleContextMenuClicked);
chrome.storage.onChanged.addListener(handleLocalStorageChanges);
// Listen for regeneration requests from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if(request.action === 'relookup') {
    sendRequestToAPI(request.lookup);
  }
});

// Remove all existing contextMenus and add the new ones from local storage
function createContextMenus(result) {
  chrome.contextMenus.removeAll(function () {
    if (!result || !result.promptData) return;
    result.promptData.forEach((entry, i) => {
      if (!entry.enabled) return;
      chrome.contextMenus.create({ id: `custom-prompt-${i}`, title: entry.title, contexts: ['selection'], });
    });
  });
}

function handleLocalStorageChanges(changes, _) {
  for (let key in changes) {
    if (key === 'promptData') chrome.storage.local.get({promptData: []}, createContextMenus);
  }
}

function handleContextMenuClicked(info, tab) {
  const menuItemIdParts = info.menuItemId.split('-');
  const promptId = menuItemIdParts[menuItemIdParts.length - 1];

  chrome.storage.local.get(null, function (options) {
    const prompt = options.promptData[promptId];
    
    sendRequestToAPI({
      selectedText: info.selectionText, 
      tabId: tab.id, 
      token: options.token, 
      promptId, 
      promptSettings: prompt.promptSettings,
      popupStyle: prompt.popupStyle,
      promptTitle: prompt.title,
      promptContent: prompt.content, 
      defaultPopupStyle: options.defaultPopupStyle,
    });
  });
};

function sendRequestToAPI(lookup) {
  const requestData = {
    'model': 'gpt-3.5-turbo',
    'messages': [
      { 'role': 'system', 'content': lookup.promptContent },
      { 'role': 'user', 'content': lookup.selectedText }
    ],
  };
  if (lookup.lookupResult) {
    requestData.messages.push({ 'role': 'assistant', 'content': lookup.lookupResult });
    requestData.messages.push({ 'role': 'user', 'content': lookup.userQuestion });
  }
  if (lookup.promptSettings) {
    const settingsOverride = JSON.parse(lookup.promptSettings);
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

