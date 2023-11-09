chrome.storage.local.get(null, createContextMenus);
chrome.contextMenus.onClicked.addListener(handleContextMenuClicked);
chrome.storage.onChanged.addListener(handleLocalStorageChanges);

// Remove all existing contextMenus and add the new ones from local storage
function createContextMenus(result) {
  chrome.contextMenus.removeAll(function () {
    // chrome.storage.local.get(null, function (result) {
      result.promptData.forEach((entry, i) => {
        if (!entry.enabled) return;
        chrome.contextMenus.create({ id: `custom-prompt-${i}`, title: entry.title, contexts: ['selection'], });
      });
    // });
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

  chrome.storage.local.get(null, function (result) {
    const tabId = tab.id;
    const selectedText = info.selectionText;
    const prompt = result.promptData[promptId];
    
    const token = result.token;
    const promptSettings = prompt.promptSettings;
    const popupStyle = prompt.popupStyle;
    const promptTitle = prompt.title;
    const promptContent = prompt.content;
    
    sendRequestToAPI({selectedText, tabId, token, promptId, promptSettings, popupStyle , promptTitle, promptContent,});
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
    chrome.tabs.sendMessage(lookup.tabId, {
      action: "displayResult",
      lookupResult: resJson.choices[0].message.content,
      lookup,
    })
  })
  .catch(error => console.error(error));
}

