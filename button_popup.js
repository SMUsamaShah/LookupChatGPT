document.addEventListener('DOMContentLoaded', () => {
  $("submitButton").addEventListener("click", (event) => {
    sendMessage(()=> window.close());
  });
  document.addEventListener("keypress", (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendMessage(()=> window.close());
    }
  });
  chrome.storage.local.get(null).then((/** @param {Options} result */result) => {
    const promptsDropdown = $("availablePrompts");
    for (let i = 0; i < result.promptData.length; i++){
      const prompt = result.promptData[i];
      if (!prompt.enabled) continue;
      const option = document.createElement("option");
      option.text = prompt.title;
      option.value = i.toString();
      if (option.value === result.buttonPopupSelectedPrompt) option.selected = true;
      promptsDropdown.appendChild(option);
    }
  });
  $("availablePrompts").addEventListener("change", (event) => {
    chrome.storage.local.set({"buttonPopupSelectedPrompt": event.target.value});
  })
});

function getSelectedText() {
  return window.getSelection().toString();
}

function sendMessage(onSent) {
  const userText = $("myInput").value;
  const promptId = document.getElementById("availablePrompts").value;
  chrome.tabs.query({active: true, lastFocusedWindow: true}, function (tabs) {
    chrome.scripting.executeScript({
      target: {tabId: tabs[0].id}, function: getSelectedText,
    }, (results) => {
      let selectedText = "";
      if (results.length > 0) selectedText = results[0].result;
      // Now that we have the selected text, we can send it to background.js
      chrome.runtime.sendMessage({
        action: 'ext_button_message', userText: userText, tab: tabs[0], selectedText: selectedText, promptId: promptId,
      }, onSent);
    });
  });
}

