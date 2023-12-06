document.addEventListener('DOMContentLoaded', function () {
  document.addEventListener("click", function(event) {
    if (event.target.matches("#myButton")) {
      sendMessage();
      window.close();
    }
  });
  document.addEventListener("keypress", function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendMessage();
      window.close();
    }
  });
});

function sendMessage() {
  let userText = document.getElementById("myInput").value;
  chrome.tabs.query({active: true, lastFocusedWindow: true}, function (tabs) {
    chrome.runtime.sendMessage({
      action: 'ext_button_message',
      userText: userText,
      tab: tabs[0]
    });
  });
}