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
    const title = group.querySelector(".title").innerText.trim();
    const content = group.querySelector(".content").innerText.trim();
    const popupStyle = group.querySelector(".popupStyle").innerText.trim();
    const promptSettings = group.querySelector(".promptSettings").innerText.trim();
    newPromptData.push({title, content, enabled, promptSettings, popupStyle});
  });
  
  chrome.storage.local.set({promptData: newPromptData, token, defaultPopupStyle, });
}

function loadOptions(options) {
  document.getElementById('authToken').value = options.token;
  if (options.defaultPopupStyle) {
    document.getElementById('defaultPopupStyle').value = options.defaultPopupStyle;
  }
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
        <td style="width: 2%;"><button class="moveUpButton">^</button><button class="moveDownButton">v</button></td>
        <td style="width: 2%;"><input type="checkbox" class="enabled" ${enabled ? 'checked' : ''} title="Check to enable"></td>
        <td style="width: 10%;"><div contenteditable="true" class="title">${title}</div></td>
        <td style="width: 30%;"><div contenteditable="true" class="content">${content}</div></td>
        <td style="width: 10%;"><div contenteditable="true" class="promptSettings">${promptSettings}</div></td>
        <td style="width: 10%;"><div contenteditable="true" class="popupStyle">${popupStyle}</div></td>
        <td style="width: 5%;"><button class="deleteButton">Delete</button></td>
    </tr>
    `;

  table.insertAdjacentHTML('beforeend', newRow);
}