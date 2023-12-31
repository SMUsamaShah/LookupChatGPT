chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === "displayResult") {
    displayResult(message.lookup);
  }
});

function displayResult(lookup = new Lookup()) {
  const popupStyle = lookup.prompt.popupStyle;
  const selectedText = lookup.prompt.userContent;
  const promptTitle = lookup.prompt.title;
  const lookupResult = lookup.lookupResult;
  const defaultPopupStyle = lookup.options.defaultPopupStyle;
  const promptId = lookup.promptId;
  
  if (!document.getElementById("lookupchatgpt-popup-style")) {
    const customStyle = document.createElement("style");
    customStyle.setAttribute("id", "lookupchatgpt-popup-style");
    customStyle.innerHTML = defaultPopupStyle;
    document.head.appendChild(customStyle);
  }

  let lookupPopupsContainer = document.getElementById("lookupchatgpt-popup-container");
  if (!lookupPopupsContainer) {
    lookupPopupsContainer = document.createElement("div");
    lookupPopupsContainer.setAttribute("id", "lookupchatgpt-popup-container");
    document.body.appendChild(lookupPopupsContainer);
  }
  
  const popup = document.createElement("div");
  popup.innerHTML = `
    <div id="lookupchatgpt-prompt-id-${promptId}" class="lookupchatgpt-popup" style="${popupStyle}">
      <b class="lookupchatgpt-title">[${promptTitle}: ${selectedText}]</b>
      <div class="lookupchatgpt-message">${lookupResult}</div>
      <div class="lookupchatgpt-question" id="userQuestion" contenteditable style="border-style: solid; border-width: 1px; width: 100%"></div>
      <div class="lookupchatgpt-button-container">
        <button id="regenerateButton" title="Re-Lookup">r</button>
        <button id="dismissButton" title="Close">x</button>
      </div>
    </div>
  `;
  lookupPopupsContainer.appendChild(popup);

  const dismissButton = popup.querySelector("#dismissButton");
  const regenerateButton = popup.querySelector("#regenerateButton");
  const userQuestion = popup.querySelector("#userQuestion");

  dismissButton.addEventListener("click", function(event){
    popup.remove();
  });

  regenerateButton.addEventListener("click", function(event) {
    popup.remove();
    chrome.runtime.sendMessage({ action: 'relookup', lookup });
  });

  userQuestion.addEventListener("keypress", function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      lookup.userQuestion = userQuestion.textContent;
      chrome.runtime.sendMessage({ action: 'relookup', lookup });
      popup.remove();
    }
  });
}

