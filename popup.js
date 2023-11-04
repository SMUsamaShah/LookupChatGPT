chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === "displayResult") {
    displayResult(request.data, request.style);
  }
});

function displayResult(result, popupStyle) {
  const dismissButtonHTML = '<button style="position: absolute; top: 0; right: 0;">x</button>';
  const defaultStyle = "color: black; position: fixed; top: 10px; left: 10px; padding: 10px; background-color: white; border: 1px solid black; z-index: 999999; font-family: Arial, sans-serif;";
  
  const messageContainer = document.createElement("div");
  messageContainer.innerHTML = `
    <div id="result-message" style="${popupStyle || defaultStyle}">
      ${result}
      ${dismissButtonHTML}
    </div>
  `;
  
  document.body.appendChild(messageContainer);

  const dismissButton = messageContainer.getElementsByTagName("button")[0];
  dismissButton.addEventListener("click", function(event){
    event.target.parentElement.remove();
  });

  // remove result after 15 seconds
  setTimeout(() => messageContainer.remove(), 15000);
}