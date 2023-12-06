// Get stored messages or load initial ones
chrome.storage.local.get(null, loadOptions);
let showAdvanced = false;

document.addEventListener('click', function (event) {
  if (event.target.matches(".deleteButton")) { event.target.parentElement.parentElement.remove();}
  else if (event.target.matches(".moveUpButton")) { moveRow(event.target, 'up'); }
  else if (event.target.matches(".moveDownButton")) { moveRow(event.target, 'down'); }
  else if (event.target.matches("#toggleAdvancedColumns")) { toggleAdvancedOptions(); }
  else if (event.target.matches("#addNewPrompt")) { appendNewRowToForm({}); }
  else if (event.target.matches("#savePrompts")) { saveOptions(); }
});

document.addEventListener("DOMContentLoaded", function(event) {
   toggleAdvancedOptions();
});

function toggleAdvancedOptions() {
  showAdvanced = document.getElementById("toggleAdvancedColumns").checked;
  let advancedEls = document.getElementsByClassName('advanced');
  for (let i = 0; i < advancedEls.length; i++) {
      advancedEls[i].style.display = showAdvanced?'table-cell':'none';
  }
}

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
  const extButtonPrompt = document.getElementById('extButtonPrompt').value.trim();
  
  const newPromptData = [];
  const row = document.querySelectorAll(".inputGroup");
  row.forEach((group) => {
    const enabled = group.querySelector(".enabled").checked;
    const title = group.querySelector(".title").textContent.trim();
    const content = group.querySelector(".content").textContent.trim();
    const userContent = group.querySelector(".userContent").textContent.trim();
    const popupStyle = group.querySelector(".popupStyle").textContent.trim();
    const promptSettings = group.querySelector(".promptSettings").textContent.trim();
    const context = group.querySelector(".context").value;
    newPromptData.push({context, title, content, userContent, enabled, promptSettings, popupStyle});
  });
  
  chrome.storage.local.set({promptData: newPromptData, token, defaultPopupStyle, extButtonPrompt});
}

function loadOptions(options) {
  if (!options) return;
  document.getElementById('authToken').value = options.token;
  if (options.extButtonPrompt) document.getElementById('extButtonPrompt').value = options.extButtonPrompt;
  if (options.defaultPopupStyle) document.getElementById('defaultPopupStyle').value = options.defaultPopupStyle;
  if (!options.promptData) return;
  options.promptData.forEach((prompt, i) => { appendNewRowToForm(prompt); });
}

function appendNewRowToForm(message) {
  const title = message.title || "";
  const content = message.content || "";
  const enabled = message.enabled !== undefined ? message.enabled : true;
  const promptSettings = message.promptSettings || "";
  const popupStyle = message.popupStyle || "";

  const table = document.querySelector('#promptTable tbody');

  const context = message.context || "selection";
  const userContent = message.userContent;
  const advancedColumn = `class="advanced" style=display:${showAdvanced?'table-cell':'none'}`;
  const newRow = `
    <tr class="inputGroup">
        <td><button class="moveUpButton">^</button><button class="moveDownButton">v</button></td>
        <td><input type="checkbox" class="enabled" ${enabled ? 'checked' : ''} title="Check to enable"></td>
        <td ${advancedColumn}>
          <select class="context">
            <option value="page" ${context === 'page' ? 'selected' : ''}>Page</option>
            <option value="selection" ${context === 'selection' ? 'selected' : ''}>Selection</option>
          </select>
        </td>
        <td><div contenteditable="true" class="title">${title}</div></td>
        <td><div contenteditable="true" class="content" style="white-space: pre-wrap;">${content}</div></td>
        <td ${advancedColumn}><div contenteditable="true" class="userContent" style="white-space: pre-wrap;">${userContent}</div></td>
        <td ${advancedColumn}><div contenteditable="true" class="promptSettings" style="white-space: pre-wrap;">${promptSettings}</div></td>
        <td ${advancedColumn}><div contenteditable="true" class="popupStyle" style="white-space: pre-wrap;">${popupStyle}</div></td>
        <td><button class="deleteButton">Delete</button></td>
    </tr>
    `;

  table.insertAdjacentHTML('beforeend', newRow);
}