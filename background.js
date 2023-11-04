function addContextMenus() {
  chrome.storage.local.get({promptData: []}, function (result) {
    result.promptData.forEach((entry, i) => {
      if (entry.enabled == false) return;
      
      chrome.contextMenus.create({
        id: `custom-prompt-${i}`,
        title: entry.title,
        contexts: ['selection'],
      });
    });
  });
}

//for debugging local storage
//chrome.storage.local.get(null, function callback(items) { console.log(items) });

// Remove all existing contextMenus and add the new ones from local storage
function reCreateContextMenus() {
  chrome.contextMenus.removeAll(addContextMenus);
}

reCreateContextMenus();

// Add a listener for when storage changes
chrome.storage.onChanged.addListener(function (changes, _) {
  for (let key in changes) {
    if (key === 'promptData') reCreateContextMenus();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const menuItemIdParts = info.menuItemId.split('-');
  const messageId = menuItemIdParts[menuItemIdParts.length - 1];

  chrome.storage.local.get(null, function (result) {
    const selectedText = info.selectionText;
    const prompt = result.promptData[messageId];
    const token = result.token;
    const promptSettings = prompt.promptSettings || result.defaultPromptSettings;
    const popupStyle = prompt.popupStyle || result.defaultPopupStyle;
    sendRequestToAPI(selectedText, tab.id, prompt.content, token, promptSettings, popupStyle);
  });
});

function sendRequestToAPI(selectedText, tabId, systemPrompt, token, promptSettings, popupStyle) {
  const requestData = {
    'model': 'gpt-3.5-turbo',
    'messages': [
      {
        'role': 'system',
        'content': systemPrompt
      },
      {
        'role': 'user',
        'content': selectedText
      }
    ],
  };
  const settingsOverride = JSON.parse(promptSettings);
  for (let key in settingsOverride) {
    requestData[key] = settingsOverride[key] || requestData[key];
  }
  
  fetch("https://api.openai.com/v1/chat/completions", {
    "headers": {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
    },
    "body": JSON.stringify(requestData),
    "method": "POST",
    "mode": "cors",
    "credentials": "include"
  })
  .then(response => response.json())
  .then(resJson => chrome.tabs.sendMessage(tabId, {action: "displayResult", data: resJson.choices[0].message.content, style: popupStyle}))
  .catch(error => console.error(error));
}