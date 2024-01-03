document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener("click", (event) => {
    if (event.target.matches("#submitButton")) {
      sendMessage();
      window.close();
    }
  });
  document.addEventListener("keypress", (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendMessage();
      window.close();
    }
  });
});

function getSelectedText() {
  return window.getSelection().toString();
}

function sendMessage() {
  let userText = document.getElementById("myInput").value;
  chrome.tabs.query({active: true, lastFocusedWindow: true}, function (tabs) {
    chrome.scripting.executeScript({
      target: {tabId: tabs[0].id}, function: getSelectedText,
    }, (results) => {
      let selectedText = "";
      if (results.length > 0) selectedText = results[0].result;
      // Now that we have the selected text, we can send it to background.js
      chrome.runtime.sendMessage({
        action: 'ext_button_message', userText: userText, tab: tabs[0], selectedText: selectedText,
      });
    });
  });
}

