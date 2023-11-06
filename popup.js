chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === "displayResult") {
    displayResult(message.lookup, message.lookupResult);
  }
  else if (message.action === "displayWaitForResult") {
    displayWaitForResult(message);//todo
  }
  console.log("message")
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
          position: fixed;
          top: 10px;
          left: 10px;
          padding: 10px;
          padding-right: 20px;
          background-color: white;
          border: 1px solid black;
          z-index: 999999;
          font-family: Arial, sans-serif;
      }
    `;
    document.head.appendChild(customStyle);
  }
  
  const messageContainer = document.createElement("div");
  messageContainer.innerHTML = `
    <div id="lookupchatgpt-prompt-id-${lookup.promptId}" class="lookupchatgpt-popup" style="${lookup.popupStyle}">
      <b>[${lookup.promptTitle}: ${lookup.selectedText}]</b> ${lookupResult}
      <button style="position: absolute; top: 0; right: 0;">x</button>
    </div>
  `;
  
  document.body.appendChild(messageContainer);

  const dismissButton = messageContainer.getElementsByTagName("button")[0];
  dismissButton.addEventListener("click", function(event){
    event.target.parentElement.remove();
  });

  // remove result after 15 seconds
  //setTimeout(() => messageContainer.remove(), 15000);
}