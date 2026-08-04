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

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderList(filter) {
  const filtered = filter
    ? _prompts.filter((p) => p.title.toLowerCase().includes(filter.toLowerCase()))
    : _prompts;
  listEl.innerHTML = filtered.map((p) =>
    `<div class="item" data-id="${p.id}">${esc(p.title)}</div>`
  ).join("");
  listEl.querySelectorAll(".item").forEach((item) => {
    item.addEventListener("mouseover", () => setHighlight(item));
    item.addEventListener("click",     () => runPrompt(parseInt(item.dataset.id)));
  });
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
    // content.js is no longer on every page, so it cannot be messaged for the
    // selection. Read it directly instead: opening this popup is a click on the
    // extension action, which grants activeTab for this tab and permits the
    // injection. Nothing is left behind on the page.
    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, func: () => window.getSelection().toString() },
      (results) => {
        if (chrome.runtime.lastError) { callback(tab, ""); return; }
        callback(tab, results?.[0]?.result || "");
      }
    );
  });
}

function runPrompt(promptId) {
  withActiveTab((tab, selectedText) => {
    chrome.runtime.sendMessage(
      { action: "ext_button_message", userText: "", tab, selectedText, promptId: String(promptId) },
      window.close
    );
  });
}

function runCustomQuery(queryText) {
  withActiveTab((tab, selectedText) => {
    chrome.runtime.sendMessage(
      { action: "custom_selection_query", queryText, selectedText, pageTitle: tab.title, pageURL: tab.url, outputMode: "popup", tabId: tab.id },
      window.close
    );
  });
}
