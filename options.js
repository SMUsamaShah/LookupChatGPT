

// Get stored messages or load initial ones
chrome.storage.local.get(null).then(loadOptions);
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
  showAdvanced = $("toggleAdvancedColumns").checked;
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
  const options = new Options();
  options.token = $('authToken').value.trim();
  options.defaultPopupStyle = $('defaultPopupStyle').value.trim();
  options.extButtonPrompt = $('extButtonPrompt').value.trim();
  // save each row
  document.querySelectorAll(".inputGroup").forEach((group) => {
    const p = new StoredPrompt();
    p.enabled = group.querySelector(".enabled").checked;
    p.title = group.querySelector(".title").textContent.trim();
    p.content = group.querySelector(".content").textContent.trim();
    p.userContent = group.querySelector(".userContent").textContent.trim();
    p.popupStyle = group.querySelector(".popupStyle").textContent.trim();
    p.promptSettings = group.querySelector(".promptSettings").textContent.trim();
    p.context = group.querySelector(".context").value;
    p.replaceText = group.querySelector(".replaceText").checked;
    options.promptData.push(p);
  });
  chrome.storage.local.set(options);
}

function loadOptions(options= new Options()) {
  if (!options) return;
  $('authToken').value = options.token;
  if (options.extButtonPrompt) $('extButtonPrompt').value = options.extButtonPrompt.trim() || DEFAULT_EXT_BUTTON_PROMPT;
  if (options.defaultPopupStyle) $('defaultPopupStyle').value = options.defaultPopupStyle.trim() || DEFAULT_POPUP_STYLE;
  if (!options.promptData) return;
  options.promptData.forEach((prompt, i) => { 
    appendNewRowToForm(prompt); 
  });
}

function appendNewRowToForm(message) {
  const title = message.title || "";
  const content = message.content || "";
  const enabled = message.enabled !== undefined ? message.enabled : true;
  const promptSettings = message.promptSettings || "";
  const popupStyle = message.popupStyle || "";
  const replaceText = message.replaceText !== undefined ? message.replaceText : false;

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
<!--            <option value="editable" ${context === 'editable' ? 'selected' : ''}>Editable</option>-->
          </select>
        </td>
        <td><input type="checkbox" class="replaceText" ${replaceText ? 'checked' : ''} title="Check to replace selected text"></td>
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