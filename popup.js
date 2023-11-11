chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === "displayResult") {
    displayResult(message.lookup, message.lookupResult);
  }
  else if (message.action === "displayWaitForResult") {
    displayWaitForResult(message);//todo
  }
});

function displayWaitForResult() {
  //todo
}

function displayResult(lookup, lookupResult) {
  const popupStyle = lookup.popupStyle;
  const selectedText = lookup.selectedText;
  const promptTitle = lookup.promptTitle;
  
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
  
  const popup = document.createElement("div");"".
  popup.innerHTML = `
    <div id="lookupchatgpt-prompt-id-${lookup.promptId}" class="lookupchatgpt-popup" style="${lookup.popupStyle}">
      <b class="title">[${lookup.promptTitle}: ${lookup.selectedText}]</b>
      <div class="message">${lookupResult}</div>
      <div class="button-container">
        <button id="regenerateButton" title="Re-Lookup">r</button>
        <button id="dismissButton" title="Close">x</button>
      </div>
    </div>
  `;
  lookupPopupsContainer.appendChild(popup);

  const dismissButton = popup.querySelector("#dismissButton");
  const regenerateButton = popup.querySelector("#regenerateButton");

  dismissButton.addEventListener("click", function(event){
    event.target.closest(".lookupchatgpt-popup").parentElement.remove();
  });

  regenerateButton.addEventListener("click", function(event) {
    event.target.closest(".lookupchatgpt-popup").parentElement.remove();
    chrome.runtime.sendMessage({ action: 'relookup', lookup }); 
  });
}