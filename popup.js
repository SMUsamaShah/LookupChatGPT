chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === "displayResult") {
    displayResult(message);
  }
});

function displayResult(message) {
  const result = message.data;
  const popupStyle = message.popupStyle;
  const selectedText = message.selectedText;
  const defaultStyle = "color: black; position: fixed; top: 10px; left: 10px; padding: 10px; padding-right: 20px; background-color: white; border: 1px solid black; z-index: 999999; font-family: Arial, sans-serif;";
  const dismissButtonHTML = '<button style="position: absolute; top: 0; right: 0;">x</button>';
  
  const messageContainer = document.createElement("div");
  messageContainer.innerHTML = `
    <div id="result-message" style="${popupStyle || defaultStyle}">
      <b>${selectedText}</b>: ${result}
      ${dismissButtonHTML}
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