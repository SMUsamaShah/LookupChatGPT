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

document.addEventListener('click', function (event) {
  // Handle delete prompt button
  if (event.target && event.target.matches(".deleteButton")) {
    event.preventDefault();
    const row = event.target.parentElement.parentElement;
    row.parentNode.removeChild(row);
  }
  if (event.target && event.target.matches(".moveUpButton")) {
    event.preventDefault();
    moveRow(event.target, 'up');
  }
  if (event.target && event.target.matches(".moveDownButton")) {
    event.preventDefault();
    moveRow(event.target, 'down');
  }
});

// Function to move a row up or down
function moveRow(button, direction) {
  const row = button.closest('tr');
  if (!row) return;

  if (direction === 'up') {
    const previousRow = row.previousElementSibling;
    if (previousRow) row.parentNode.insertBefore(row, previousRow);
  } else if (direction === 'down') {
    const nextRow = row.nextElementSibling;
    if (nextRow) row.parentNode.insertBefore(nextRow, row);
  }
}

function saveOptions() {
  const token = document.getElementById('authToken').value.trim();
  const defaultPopupStyle = document.getElementById('defaultPopupStyle').value.trim();
  
  const newPromptData = [];
  const row = document.querySelectorAll(".inputGroup");
  row.forEach((group) => {
    const enabled = group.querySelector(".enabled").checked;
    const title = group.querySelector(".title").textContent.trim();
    const content = group.querySelector(".content").textContent.trim();
    const popupStyle = group.querySelector(".popupStyle").textContent.trim();
    const promptSettings = group.querySelector(".promptSettings").textContent.trim();
    newPromptData.push({title, content, enabled, promptSettings, popupStyle});
  });
  
  chrome.storage.local.set({promptData: newPromptData, token, defaultPopupStyle, });
}

function loadOptions(options) {
  if (!options) return;
  document.getElementById('authToken').value = options.token;
  if (options.defaultPopupStyle) {
    document.getElementById('defaultPopupStyle').value = options.defaultPopupStyle;
  }
  if (!options.promptData) return;
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
        <td><button class="moveUpButton">^</button><button class="moveDownButton">v</button></td>
        <td><input type="checkbox" class="enabled" ${enabled ? 'checked' : ''} title="Check to enable"></td>
        <td><div contenteditable="true" class="title">${title}</div></td>
        <td><div contenteditable="true" class="content" style="white-space: pre-wrap;">${content}</div></td>
        <td><div contenteditable="true" class="promptSettings" style="white-space: pre-wrap;">${promptSettings}</div></td>
        <td><div contenteditable="true" class="popupStyle" style="white-space: pre-wrap;">${popupStyle}</div></td>
        <td><button class="deleteButton">Delete</button></td>
    </tr>
    `;

  table.insertAdjacentHTML('beforeend', newRow);
}