chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === "displayResult") {
    displayResult(message.lookup);
  }
  else if (message.action === "displayWaitForResult") {
    displayWaitForResult(message);//todo
  }
});

function displayWaitForResult() {
  //todo
}

function displayResult(lookup) {
  const popupStyle = lookup.popupStyle;
  const selectedText = lookup.selectedText;
  const promptTitle = lookup.promptTitle;
  const lookupResult = lookup.lookupResult;
  
  if (!document.getElementById("lookupchatgpt-popup-style")) {
    const customStyle = document.createElement("style");
    customStyle.setAttribute("id", "lookupchatgpt-popup-style");
    customStyle.innerHTML = lookup.defaultPopupStyle;
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
    <div id="lookupchatgpt-prompt-id-${lookup.promptId}" class="lookupchatgpt-popup" style="${lookup.popupStyle}">
      <b class="lookupchatgpt-title">[${lookup.promptTitle}: ${lookup.selectedText}]</b>
      <div class="lookupchatgpt-message">${lookupResult}</div>
      <div class="lookupchatgpt-question" id="userQuestion" width="100%" contenteditable style="border-style: solid; border-width: 1px"></div>
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