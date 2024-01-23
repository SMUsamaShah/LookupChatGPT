const DEFAULT_POPUP_STYLE = `#lookupchatgpt-popup-container {
  position: fixed;
  top: 10px;
  left: 10px;
  padding: 10px;
  padding-right: 20px;
  z-index: 999999;
  max-width: 60vw;
}
.lookupchatgpt-popup {
  color: black;
  position: relative;
  padding: 10px;
  padding-right: 20px;
  background-color: white;
  border: 1px solid black;
  font-family: Arial, sans-serif;
  margin-right: 10px;
  max-height: 45vh;
  overflow-y: auto;
  resize: both;
}
.lookupchatgpt-popup .lookupchatgpt-button-container {
  position: absolute;
  top: 0;
  right: 0;
}
.lookupchatgpt-popup .lookupchatgpt-title {
  overflow: hidden;
  text-overflow: ellipsis;
  width: initial;
  white-space: nowrap;
  display: block;
  padding-right: 30px;
}
.lookupchatgpt-popup .lookupchatgpt-message {
}`;
const DEFAULT_EXT_BUTTON_PROMPT = "Read instructions carefully. Its very important. \nCurrent page title: VAR_PAGE_TITLE\nCurrent page URL: VAR_PAGE_URL";
const DEFAULT_SELECTED_TEXT_PROMPT_CONTENT = "I'll input a word or sentence or a symbol in next message taken from webpage (page title: VAR_PAGE_TITLE page URL: VAR_PAGE_URL). If it is a name of something or someone give some info about that while being terse. If it's a non-english text, just translate it to English. Otherwise just explain what it means.";
const DEFAULT_SELECTED_TEXT_PROMPT_TITLE = "What's this?";

//helper methods
$ = (id) => document.getElementById(id);

// structs
class StoredPrompt {
  context = "selection";//page
  title = "";
  content = ""; // system prompt
  userContent = ""; //selectedText
  enabled = true;
  promptSettings = "";
  popupStyle = "";
  replaceText = false;
}

class Options {
  /**
   * @type StoredPrompt[]
   */
  promptData = [];
  token = "";
  defaultPopupStyle = "";
  extButtonPrompt = "";
  /** prompt currently in use by button popup */
  buttonPopupSelectedPrompt = "";
}

class Lookup {
  selectedText = "";
  userQuestion = ""; // text entered by the user in popup as a followup question
  tabId = -1;
  promptId = "";
  prompt = new StoredPrompt();
  options = new Options();
  lookupResult = "";
}