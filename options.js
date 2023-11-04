
// Get stored messages or load initial ones
chrome.storage.local.get(null, function (result) {
  result.promptData.forEach((prompt, index) => {
    appendNewRowToForm(prompt);
  });
  document.getElementById('authToken').value = result.token;
  document.getElementById('promptSettings').value = result.defaultPromptSettings || "";
  document.getElementById('popupStyle').value = result.defaultPopupStyle || "";
});

const form = document.getElementById('customMessagesForm');
form.addEventListener('submit', function (event) {
  event.preventDefault();

  const newPromptData = [];
  const row = document.querySelectorAll(".inputGroup");
  row.forEach((group) => {
    const title = group.querySelector(".title").value;
    const content = group.querySelector(".content").value;
    const enabled = group.querySelector(".enabled").checked;
    const popupStyle = group.querySelector(".popupStyle").value;
    const promptSettings = group.querySelector(".promptSettings").value;
    newPromptData.push({title, content, enabled, promptSettings, popupStyle});
  });
  const token = document.getElementById('authToken').value;
  const defaultPromptSettings = document.getElementById('promptSettings').value;
  const defaultPopupStyle = document.getElementById('popupStyle').value;

  chrome.storage.local.set({promptData: newPromptData, token, defaultPromptSettings, defaultPopupStyle});
});

const addButton = document.getElementById('addNewPrompt');
addButton.addEventListener('click', function (event) {
  event.preventDefault();
  appendNewRowToForm({});
});

// When the delete button is pressed, remove the relevant message
document.addEventListener('click', function (event) {
  if (event.target && event.target.matches(".deleteButton")) {
    event.preventDefault();
    event.target.parentElement.remove();
  }
});

function appendNewRowToForm(message) {
  const title = message.title || "";
  const content = message.content || "";
  const enabled = message.enabled || true;
  const promptSettings = message.promptSettings || "";
  const popupStyle = message.popupStyle || "";
  
  const newInputGroup = document.createElement('div');
  newInputGroup.setAttribute("style", "display: flex; align-items: flex-start;border-bottom-style: solid;border-bottom-width: thin;");
  newInputGroup.classList.add('inputGroup');
  newInputGroup.innerHTML = `
        <input type="checkbox" class="enabled" ${enabled ? 'checked' : ''} title="Check to enable">
        <label>Title: </label>
        <input type="text" class="title" value="${title}">
        <label>System Prompt: </label>
        <textarea type="text" class="content" rows="1" >${content}</textarea>
        <label>Prompt Settings: </label>
        <textarea type="text" class="promptSettings">${promptSettings}</textarea>
        <label>Popup Style: </label>
        <textarea type="text" class="popupStyle">${popupStyle}</textarea>
        <button class="deleteButton">Delete</button>
    `;

  addButton.parentElement.insertBefore(newInputGroup, addButton);
}