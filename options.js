// Get stored messages or load initial ones
chrome.storage.local.get(null, loadOptions);

const form = document.getElementById('customMessagesForm');
form.addEventListener('submit', function (event) {
  event.preventDefault();
  saveOptions();
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
    const row = event.target.parentElement.parentElement;
    row.parentNode.removeChild(row);
  }
});

function saveOptions() {
  const token = document.getElementById('authToken').value;
  const defaultPromptSettings = document.getElementById('promptSettings').value;
  const defaultPopupStyle = document.getElementById('popupStyle').value;
  
  const newPromptData = [];
  const row = document.querySelectorAll(".inputGroup");
  row.forEach((group) => {
    const enabled = group.querySelector(".enabled").checked;
    const title = group.querySelector(".title").innerText;
    const content = group.querySelector(".content").innerText;
    const popupStyle = group.querySelector(".popupStyle").innerText;
    const promptSettings = group.querySelector(".promptSettings").innerText;
    newPromptData.push({title, content, enabled, promptSettings, popupStyle});
  });
  
  chrome.storage.local.set({promptData: newPromptData, token, defaultPromptSettings, defaultPopupStyle});
}

function loadOptions(options) {
  document.getElementById('authToken').value = options.token;
  document.getElementById('promptSettings').value = options.defaultPromptSettings || "";
  document.getElementById('popupStyle').value = options.defaultPopupStyle || "";
  options.promptData.forEach((prompt, i) => { appendNewRowToForm(prompt); });
}

function appendNewRowToForm(message) {
  const title = message.title || "";
  const content = message.content || "";
  const enabled = message.enabled || true;
  const promptSettings = message.promptSettings || "";
  const popupStyle = message.popupStyle || "";

  const table = document.querySelector('#promptTable tbody');

  const newRow = `
    <tr class="inputGroup">
        <td style="width: 5%;"><input type="checkbox" class="enabled" ${enabled ? 'checked' : ''} title="Check to enable"></td>
        <td style="width: 10%;"><div contenteditable="true" class="title">${title}</div></td>
        <td style="width: 30%;"><div contenteditable="true" class="content">${content}</div></td>
        <td style="width: 10%;"><div contenteditable="true" class="promptSettings">${promptSettings}</div></td>
        <td style="width: 10%;"><div contenteditable="true" class="popupStyle">${popupStyle}</div></td>
        <td style="width: 5%;"><button class="deleteButton">Delete</button></td>
    </tr>
    `;

  table.insertAdjacentHTML('beforeend', newRow);
}