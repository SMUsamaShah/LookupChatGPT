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
    customStyle.innerHTML = `
      .lookupchatgpt-popup {
          color: black;
          position: relative;
          padding: 10px;
          padding-right: 20px;
          background-color: white;
          border: 1px solid black;
          z-index: 999999;
          font-family: Arial, sans-serif;
          margin-right: 10px;
          max-height: 45vh;
          overflow-y: auto;
          max-width: 97.5vw;
          resize: both;
          width: fit-content;
      }
    `;
    document.head.appendChild(customStyle);
  }

  let lookupPopupsContainer = document.getElementById("lookupchatgpt-popup-container");
  if (!lookupPopupsContainer) {
    lookupPopupsContainer = document.createElement("div");
    lookupPopupsContainer.setAttribute("id", "lookupchatgpt-popup-container");
    lookupPopupsContainer.setAttribute("style", "position: absolute; top: 10px; left: 10px; padding: 10px; padding-right: 20px;");
    document.body.appendChild(lookupPopupsContainer);
  }
  
  const popup = document.createElement("div");
  popup.innerHTML = `
    <div id="lookupchatgpt-prompt-id-${lookup.promptId}" class="lookupchatgpt-popup" style="${lookup.popupStyle}">
      <b style="overflow: hidden; text-overflow: ellipsis; width: initial; white-space: nowrap; display: block; padding-right: 30px">[${lookup.promptTitle}: ${lookup.selectedText}]</b>
      ${lookupResult}
      <div style="position: absolute; top: 0; right: 0;">
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