let _prompts = [];

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(null).then((opts) => {
    _prompts = (opts.promptData || [])
      .map((p, i) => ({ ...p, id: i }))
      .filter((p) => p.enabled);
    renderList("");
  });
});

const searchEl = document.getElementById("search");
const listEl   = document.getElementById("prompt-list");

function renderList(filter) {
  const needle = filter.toLowerCase();
  listEl.textContent = "";
  for (const p of _prompts) {
    if (needle && !p.title.toLowerCase().includes(needle)) continue;
    const item = document.createElement("div");
    item.className   = "item";
    item.dataset.id  = p.id;          // read back by the Enter key handler
    item.textContent = p.title;       // a prompt title is the user's own text, not markup
    item.addEventListener("mouseover", () => setHighlight(item));
    item.addEventListener("click",     () => runPrompt(p.id));
    listEl.appendChild(item);
  }
}

function getHighlighted() { return listEl.querySelector(".item--active"); }

function setHighlight(el) {
  listEl.querySelectorAll(".item--active").forEach((i) => i.classList.remove("item--active"));
  if (el) { el.classList.add("item--active"); el.scrollIntoView({ block: "nearest" }); }
}

searchEl.addEventListener("input",   () => { renderList(searchEl.value); setHighlight(null); });
searchEl.addEventListener("keydown", (e) => {
  const items = [...listEl.querySelectorAll(".item")];
  const hi    = getHighlighted();
  const idx   = hi ? items.indexOf(hi) : -1;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (items.length) setHighlight(items[Math.min(idx + 1, items.length - 1)]);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (idx <= 0) setHighlight(null); else setHighlight(items[idx - 1]);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (hi) {
      runPrompt(parseInt(hi.dataset.id));
    } else {
      const query = searchEl.value.trim();
      if (query) runCustomQuery(query);
    }
  } else if (e.key === "Escape") {
    window.close();
  }
});

function withActiveTab(callback) {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    // Read the selection straight out of the page rather than asking a content
    // script for it: opening this popup is a click on the extension action, which
    // grants activeTab for this tab and permits the injection. The function runs
    // and returns; nothing is left behind on the page.
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, func: () => window.getSelection().toString() },
      (results) => {
        if (chrome.runtime.lastError) { callback(tab, ""); return; }
        callback(tab, results?.[0]?.result || "");
      }
    );
  });
}

// The popup closes itself rather than waiting for a reply to come back. The
// message is already on its way by the time close() runs, and a popup left on
// screen because a reply went missing is the worse failure of the two.
function send(message) {
  chrome.runtime.sendMessage(message);
  window.close();
}

function runPrompt(promptId) {
  withActiveTab((tab, selectedText) => {
    send({ action: "ext_button_message", userText: "", tab, selectedText, promptId: String(promptId) });
  });
}

function runCustomQuery(queryText) {
  withActiveTab((tab, selectedText) => {
    send({ action: "custom_selection_query", queryText, selectedText, pageTitle: tab.title, pageURL: tab.url, outputMode: "popup", tabId: tab.id });
  });
}
