// Holds the fields the user has added: [{ name, selector, type, attributeName? }, ...]
let fields = [];
// Holds child fields for nested/detail-page scraping, same shape as `fields`
let childFields = [];

const fieldNameInput = document.getElementById("fieldName");
const fieldSelectorInput = document.getElementById("fieldSelector");
const fieldTypeSelect = document.getElementById("fieldType");
const fieldAttributeNameInput = document.getElementById("fieldAttributeName");
const addFieldBtn = document.getElementById("addFieldBtn");
const fieldListEl = document.getElementById("fieldList");
const statusEl = document.getElementById("status");
const nextPageSelectorInput = document.getElementById("nextPageSelector");
const maxPagesInput = document.getElementById("maxPages");
const scrapeBtn = document.getElementById("scrapeBtn");
const previewSection = document.getElementById("previewSection");
const previewTable = document.getElementById("previewTable");
const detailLinkSelectorInput = document.getElementById("detailLinkSelector");
const childFieldNameInput = document.getElementById("childFieldName");
const childFieldSelectorInput = document.getElementById("childFieldSelector");
const childFieldTypeSelect = document.getElementById("childFieldType");
const childFieldAttributeNameInput = document.getElementById("childFieldAttributeName");
const addChildFieldBtn = document.getElementById("addChildFieldBtn");
const childFieldListEl = document.getElementById("childFieldList");
const maxDetailPagesInput = document.getElementById("maxDetailPages");
const nestedScrapeBtn = document.getElementById("nestedScrapeBtn");
const helpBtn = document.getElementById("helpBtn");
const closeHelpBtn = document.getElementById("closeHelpBtn");
const helpModal = document.getElementById("helpModal");
let lastExtractedRows = [];

helpBtn.addEventListener("click", () => {
  helpModal.style.display = "flex";
});
closeHelpBtn.addEventListener("click", () => {
  helpModal.style.display = "none";
});
helpModal.addEventListener("click", (event) => {
  if (event.target === helpModal) {
    helpModal.style.display = "none"; // clicking the dark overlay (not the box) closes it
  }
});

// ---------- Collapsible optional sections (Pagination, Nested Scraping) ----------
// State (open/closed) is saved to chrome.storage.local so it stays exactly as the
// user left it — across closing the popup, reopening it, or even disabling/re-enabling
// the extension. It only changes when the user clicks the arrow themselves.
function setupCollapsible(toggleId, chevronId, bodyId, storageKey) {
  const toggle = document.getElementById(toggleId);
  const chevron = document.getElementById(chevronId);
  const body = document.getElementById(bodyId);

  function setOpen(isOpen) {
    body.style.display = isOpen ? "flex" : "none";
    chevron.classList.toggle("open", isOpen);
  }

  // Restore saved state on popup open (defaults to closed if never set)
  chrome.storage.local.get([storageKey], (result) => {
    setOpen(!!result[storageKey]);
  });

  toggle.addEventListener("click", () => {
    const isCurrentlyOpen = body.style.display !== "none";
    const nextOpen = !isCurrentlyOpen;
    setOpen(nextOpen);
    chrome.storage.local.set({ [storageKey]: nextOpen });
  });
}

setupCollapsible("paginationToggle", "paginationChevron", "paginationBody", "paginationSectionOpen");
setupCollapsible("nestedToggle", "nestedChevron", "nestedBody", "nestedSectionOpen");
// ---------- End collapsible sections ----------

// Renders the first few rows of extracted data as a table inside the popup,
// so the user can visually confirm the selectors are pulling the right data.
function renderPreview(rows) {
  if (!rows || rows.length === 0) {
    previewSection.style.display = "none";
    previewTable.innerHTML = "";
    return;
  }

  const previewRows = rows.slice(0, 5);
  const headers = Object.keys(previewRows[0]);

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement("tbody");
  previewRows.forEach((row) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = row[h];
      td.title = row[h]; // full value on hover, since cells are truncated visually
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  previewTable.innerHTML = "";
  previewTable.appendChild(thead);
  previewTable.appendChild(tbody);
  previewSection.style.display = "block";
}

// ---------- Point-and-click picker: generic, works for any selector input ----------
// Each "pick" icon button calls triggerPick(targetName). We remember which input
// we're filling in chrome.storage.local (since the popup closes during picking),
// then checkForPickedSelector() routes the result back to the right input on reopen.
async function triggerPick(targetName) {
  await chrome.storage.local.set({ activePickTarget: targetName });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: "startPicking" }, () => {
    if (chrome.runtime.lastError) {
      showStatus("Could not start picking — try reloading the page.");
      console.error(chrome.runtime.lastError);
    }
    // Popup will close as soon as the user clicks the page — that's expected.
  });
}

document.getElementById("pickFieldBtn").addEventListener("click", () => triggerPick("fieldSelector"));
document.getElementById("pickNextPageBtn").addEventListener("click", () => triggerPick("nextPageSelector"));
document.getElementById("pickDetailLinkBtn").addEventListener("click", () => triggerPick("detailLinkSelector"));
document.getElementById("pickChildFieldBtn").addEventListener("click", () => triggerPick("childFieldSelector"));

// If a selector was just picked on the page (popup was closed during picking),
// grab it from storage, route it to whichever input was active, then clear storage.
function checkForPickedSelector() {
  chrome.storage.local.get(["pickedSelector", "activePickTarget"], (result) => {
    if (result.pickedSelector) {
      const target = result.activePickTarget;
      if (target === "nextPageSelector") {
        nextPageSelectorInput.value = result.pickedSelector;
      } else if (target === "detailLinkSelector") {
        detailLinkSelectorInput.value = result.pickedSelector;
      } else if (target === "childFieldSelector") {
        childFieldSelectorInput.value = result.pickedSelector;
      } else {
        fieldSelectorInput.value = result.pickedSelector;
      }
      saveScrapeSettings(); // picker fills the input programmatically, so persist it explicitly
      chrome.storage.local.remove(["pickedSelector", "activePickTarget"]);
      showStatus("Selector picked!");
    }
  });
}

// ---------- End generic picker ----------

// Persist the standalone pagination/nested-scraping inputs (these aren't part of
// the fields list, so they need their own save/load — otherwise they reset every
// time the popup closes, e.g. right after using the picker on one of them).
function saveScrapeSettings() {
  chrome.storage.local.set({
    nextPageSelectorValue: nextPageSelectorInput.value,
    maxPagesValue: maxPagesInput.value,
    detailLinkSelectorValue: detailLinkSelectorInput.value,
    maxDetailPagesValue: maxDetailPagesInput.value,
  });
}

function loadScrapeSettings() {
  chrome.storage.local.get(
    ["nextPageSelectorValue", "maxPagesValue", "detailLinkSelectorValue", "maxDetailPagesValue"],
    (result) => {
      if (typeof result.nextPageSelectorValue === "string") {
        nextPageSelectorInput.value = result.nextPageSelectorValue;
      }
      if (result.maxPagesValue) {
        maxPagesInput.value = result.maxPagesValue;
      }
      if (typeof result.detailLinkSelectorValue === "string") {
        detailLinkSelectorInput.value = result.detailLinkSelectorValue;
      }
      if (result.maxDetailPagesValue) {
        maxDetailPagesInput.value = result.maxDetailPagesValue;
      }
    }
  );
}

nextPageSelectorInput.addEventListener("input", saveScrapeSettings);
maxPagesInput.addEventListener("input", saveScrapeSettings);
detailLinkSelectorInput.addEventListener("input", saveScrapeSettings);
maxDetailPagesInput.addEventListener("input", saveScrapeSettings);

// Show the attribute-name input only when type is "attribute"
fieldTypeSelect.addEventListener("change", () => {
  fieldAttributeNameInput.style.display =
    fieldTypeSelect.value === "attribute" ? "block" : "none";
});

childFieldTypeSelect.addEventListener("change", () => {
  childFieldAttributeNameInput.style.display =
    childFieldTypeSelect.value === "attribute" ? "block" : "none";
});

function renderChildFields() {
  childFieldListEl.innerHTML = "";

  childFields.forEach((field, index) => {
    const li = document.createElement("li");

    const label = document.createElement("span");
    const typeLabel = field.type
      ? field.type + (field.attributeName ? `:${field.attributeName}` : "")
      : "text";
    label.textContent = `${field.name} [${typeLabel}]: ${field.selector}`;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove child field";
    removeBtn.addEventListener("click", () => {
      childFields.splice(index, 1);
      renderChildFields();
      saveChildFields();
    });

    li.appendChild(label);
    li.appendChild(removeBtn);
    childFieldListEl.appendChild(li);
  });
}

function saveChildFields() {
  chrome.storage.local.set({ childFields });
}

function loadChildFields() {
  chrome.storage.local.get(["childFields"], (result) => {
    if (Array.isArray(result.childFields)) {
      childFields = result.childFields;
      renderChildFields();
    }
  });
}

addChildFieldBtn.addEventListener("click", () => {
  const name = childFieldNameInput.value.trim();
  const selector = childFieldSelectorInput.value.trim();
  const type = childFieldTypeSelect.value;
  const attributeName = childFieldAttributeNameInput.value.trim();

  if (!name || !selector) {
    showStatus("Please enter both a child field name and a CSS selector.");
    return;
  }

  if (type === "attribute" && !attributeName) {
    showStatus("Please enter an attribute name (e.g. data-id).");
    return;
  }

  if (childFields.some((f) => f.name === name)) {
    showStatus(`A child field named "${name}" already exists — use a different name.`);
    return;
  }

  const newField = { name, selector, type };
  if (type === "attribute") {
    newField.attributeName = attributeName;
  }

  childFields.push(newField);
  renderChildFields();
  saveChildFields();

  childFieldNameInput.value = "";
  childFieldSelectorInput.value = "";
  childFieldAttributeNameInput.value = "";
  childFieldTypeSelect.value = "text";
  childFieldAttributeNameInput.style.display = "none";
  childFieldNameInput.focus();
});

function renderFields() {
  fieldListEl.innerHTML = "";

  fields.forEach((field, index) => {
    const li = document.createElement("li");

    const label = document.createElement("span");
    const typeLabel = field.type
      ? field.type + (field.attributeName ? `:${field.attributeName}` : "")
      : "text";
    label.textContent = `${field.name} [${typeLabel}]: ${field.selector}`;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "✕";
    removeBtn.title = "Remove field";
    removeBtn.addEventListener("click", () => {
      fields.splice(index, 1);
      renderFields();
      saveFields();
    });

    li.appendChild(label);
    li.appendChild(removeBtn);
    fieldListEl.appendChild(li);
  });
}

function showStatus(message) {
  statusEl.textContent = message;
  setTimeout(() => {
    statusEl.textContent = "";
  }, 2500);
}

// Save the current fields array to chrome.storage.local so it survives popup close
function saveFields() {
  chrome.storage.local.set({ fields });
}

// Load saved fields (if any) when the popup opens
function loadFields() {
  chrome.storage.local.get(["fields"], (result) => {
    if (Array.isArray(result.fields)) {
      fields = result.fields;
      renderFields();
    }
  });
}

addFieldBtn.addEventListener("click", () => {
  const name = fieldNameInput.value.trim();
  const selector = fieldSelectorInput.value.trim();
  const type = fieldTypeSelect.value;
  const attributeName = fieldAttributeNameInput.value.trim();

  if (!name || !selector) {
    showStatus("Please enter both a field name and a CSS selector.");
    return;
  }

  if (type === "attribute" && !attributeName) {
    showStatus("Please enter an attribute name (e.g. data-id).");
    return;
  }

  if (fields.some((f) => f.name === name)) {
    showStatus(`A field named "${name}" already exists — use a different name.`);
    return;
  }

  const newField = { name, selector, type };
  if (type === "attribute") {
    newField.attributeName = attributeName;
  }

  fields.push(newField);
  renderFields();
  saveFields();

  fieldNameInput.value = "";
  fieldSelectorInput.value = "";
  fieldAttributeNameInput.value = "";
  fieldTypeSelect.value = "text";
  fieldAttributeNameInput.style.display = "none";
  fieldNameInput.focus();
});

// Checks whether a previously-started multi-page scrape has finished.
// If done, loads the accumulated results so they're ready to export, and clears the scrape state.
function checkScrapeStatus() {
  chrome.storage.local.get(
    ["scrapeStatus", "scrapeResults", "scrapePageCount", "scrapeErrorMessage"],
    (data) => {
      if (data.scrapeStatus === "running") {
        showStatus(`Scraping in progress (page ${data.scrapePageCount || 0})... reopen popup to check again.`);
        scrapeBtn.disabled = true;
        scrapeBtn.textContent = "Scraping in progress...";
      } else if (data.scrapeStatus === "error") {
        showStatus(`Scrape stopped due to an error: ${data.scrapeErrorMessage || "unknown error"}`);
        chrome.storage.local.remove(["scrapeStatus"]);
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = "Scrape All Pages";
      } else if (data.scrapeStatus === "done" && Array.isArray(data.scrapeResults)) {
        lastExtractedRows = data.scrapeResults;
        renderPreview(data.scrapeResults);
        showStatus(
          `Scrape complete: ${data.scrapeResults.length} row(s) from ${data.scrapePageCount || 0} page(s). Ready to export.`
        );
        chrome.storage.local.remove(["scrapeStatus"]);
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = "Scrape All Pages";
      } else {
        scrapeBtn.disabled = false;
        scrapeBtn.textContent = "Scrape All Pages";
      }
    }
  );
}

scrapeBtn.addEventListener("click", async () => {
  if (fields.length === 0) {
    showStatus("Add at least one field before scraping.");
    return;
  }

  // Guard: don't let a fresh click reset an already-running scrape's accumulated data,
  // and don't collide with a nested (detail-page) scrape either.
  const existing = await new Promise((resolve) =>
    chrome.storage.local.get(["scrapeStatus", "nestedStatus"], resolve)
  );
  if (existing.scrapeStatus === "running") {
    showStatus("A scrape is already in progress — reopen the popup in a moment to check its status.");
    return;
  }
  if (existing.nestedStatus === "running") {
    showStatus("A nested (detail-page) scrape is already in progress — wait for it to finish first.");
    return;
  }

  const nextPageSelector = nextPageSelectorInput.value.trim();
  const maxPages = parseInt(maxPagesInput.value, 10) || 5;

  await chrome.storage.local.set({
    scrapeConfig: { fields, nextPageSelector, maxPages },
    scrapeResults: [],
    scrapePageCount: 0,
    scrapeStatus: "running",
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: "runScrapeStep" }, () => {
    if (chrome.runtime.lastError) {
      showStatus("Could not start scraping — try reloading the page.");
      console.error(chrome.runtime.lastError);
      return;
    }
    showStatus("Scraping started — this runs across page loads, reopen popup to check progress.");
  });
});

// Checks whether a previously-started nested scrape (with optional pagination) has finished.
function checkNestedStatus() {
  chrome.storage.local.get(
    ["nestedStatus", "nestedAllResults", "nestedPageCount", "nestedIndex", "nestedLinks", "nestedErrorMessage"],
    (data) => {
      if (data.nestedStatus === "running") {
        const total = (data.nestedLinks || []).length;
        showStatus(`Nested scrape in progress (page ${data.nestedPageCount || 0}, detail item ${data.nestedIndex || 0} of ${total})... reopen popup to check again.`);
        nestedScrapeBtn.disabled = true;
        nestedScrapeBtn.textContent = "Scraping detail pages...";
      } else if (data.nestedStatus === "error") {
        showStatus(`Nested scrape stopped due to an error: ${data.nestedErrorMessage || "unknown error"}`);
        chrome.storage.local.remove(["nestedStatus"]);
        nestedScrapeBtn.disabled = false;
        nestedScrapeBtn.textContent = "Scrape With Detail Pages";
      } else if (data.nestedStatus === "done" && Array.isArray(data.nestedAllResults)) {
        lastExtractedRows = data.nestedAllResults;
        renderPreview(data.nestedAllResults);
        showStatus(`Nested scrape complete: ${data.nestedAllResults.length} merged record(s) from ${data.nestedPageCount || 0} page(s). Ready to export.`);
        chrome.storage.local.remove(["nestedStatus"]);
        nestedScrapeBtn.disabled = false;
        nestedScrapeBtn.textContent = "Scrape With Detail Pages";
      } else {
        nestedScrapeBtn.disabled = false;
        nestedScrapeBtn.textContent = "Scrape With Detail Pages";
      }
    }
  );
}

nestedScrapeBtn.addEventListener("click", async () => {
  if (fields.length === 0) {
    showStatus("Add at least one listing field before nested scraping.");
    return;
  }
  if (childFields.length === 0) {
    showStatus("Add at least one child field (to extract from detail pages).");
    return;
  }
  const linkSelector = detailLinkSelectorInput.value.trim();
  if (!linkSelector) {
    showStatus("Please enter a detail link selector.");
    return;
  }

  // Guard: don't let a fresh click reset an already-running nested scrape,
  // and don't let it collide with a plain pagination-only scrape either.
  const existing = await new Promise((resolve) =>
    chrome.storage.local.get(["nestedStatus", "scrapeStatus"], resolve)
  );
  if (existing.nestedStatus === "running") {
    showStatus("A nested scrape is already in progress — reopen the popup in a moment to check its status.");
    return;
  }
  if (existing.scrapeStatus === "running") {
    showStatus("A plain page scrape is already in progress — wait for it to finish first.");
    return;
  }

  // Pagination is optional here — if Next Page Selector is filled in (even though
  // the Pagination section is separate), this nested scrape will also walk through
  // every page, not just the current one.
  const nextPageSelector = nextPageSelectorInput.value.trim();
  const maxPages = parseInt(maxPagesInput.value, 10) || 1;
  const maxDetailPages = parseInt(maxDetailPagesInput.value, 10) || 10;

  await chrome.storage.local.set({
    nestedConfig: { fields, childFields, linkSelector, nextPageSelector, maxPages, maxDetailPages },
    nestedAllResults: [],
    nestedPageRows: [],
    nestedLinks: [],
    nestedIndex: 0,
    nestedPageCount: 0,
    nestedPhase: "listing",
    nestedStatus: "running",
  });

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { action: "runNestedListingStep" }, () => {
    if (chrome.runtime.lastError) {
      showStatus("Could not start scraping — try reloading the page.");
      console.error(chrome.runtime.lastError);
      return;
    }
    const pageNote = nextPageSelector ? ` across up to ${maxPages} page(s)` : "";
    showStatus(`Nested scrape started${pageNote} — reopen popup to check progress.`);
  });
});

loadFields();
checkForPickedSelector();
checkScrapeStatus();
loadChildFields();
checkNestedStatus();
loadScrapeSettings();
console.log("Popup loaded");

const extractBtn = document.getElementById("extractBtn");

extractBtn.addEventListener("click", async () => {
  if (fields.length === 0) {
    showStatus("Add at least one field before extracting.");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(
    tab.id,
    { action: "extractData", fields },
    (response) => {
      if (chrome.runtime.lastError) {
        showStatus("Error: could not reach the page. Try reloading it.");
        console.error(chrome.runtime.lastError);
        return;
      }

      if (!response || !response.success) {
        showStatus("Extraction failed: " + (response ? response.error : "unknown error"));
        return;
      }

      console.log("Extracted rows:", response.rows);
      lastExtractedRows = response.rows;
      renderPreview(response.rows);
      showStatus(`Extracted ${response.rows.length} row(s). Ready to export.`);
    }
  );
});

const exportBtn = document.getElementById("exportBtn");

function escapeCsvValue(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function rowsToCsv(rows) {
  if (rows.length === 0) return "";

  const headers = Object.keys(rows[0]);
  const headerLine = headers.map(escapeCsvValue).join(",");

  const lines = rows.map((row) =>
    headers.map((header) => escapeCsvValue(row[header])).join(",")
  );

  return [headerLine, ...lines].join("\n");
}

exportBtn.addEventListener("click", () => {
  if (lastExtractedRows.length === 0) {
    showStatus("Nothing to export yet — click Extract Data first.");
    return;
  }

  const csvContent = rowsToCsv(lastExtractedRows);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "extracted_data.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showStatus("CSV downloaded.");
});

const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportExcelBtn = document.getElementById("exportExcelBtn");

exportJsonBtn.addEventListener("click", () => {
  if (lastExtractedRows.length === 0) {
    showStatus("Nothing to export yet — click Extract Data first.");
    return;
  }

  const jsonContent = JSON.stringify(lastExtractedRows, null, 2);
  const blob = new Blob([jsonContent], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "extracted_data.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showStatus("JSON downloaded.");
});

// Escapes a value for safe use inside HTML (so values with <, >, & don't break the table)
function escapeHtml(value) {
  const str = String(value ?? "");
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Builds an HTML table wrapped in an Excel-recognizable document.
// Saved with a .xls extension, this opens correctly in Excel/Google Sheets/LibreOffice
// as a real spreadsheet — a common lightweight alternative to building a true binary .xlsx file.
function rowsToExcelHtml(rows) {
  const headers = Object.keys(rows[0]);

  const headerRow = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join("")}</tr>`
    )
    .join("");

  return `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="UTF-8"></head>
    <body>
      <table border="1">
        ${headerRow}
        ${bodyRows}
      </table>
    </body>
    </html>
  `;
}

exportExcelBtn.addEventListener("click", () => {
  if (lastExtractedRows.length === 0) {
    showStatus("Nothing to export yet — click Extract Data first.");
    return;
  }

  const excelHtml = rowsToExcelHtml(lastExtractedRows);
  const blob = new Blob([excelHtml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "extracted_data.xls";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showStatus("Excel file downloaded.");
});

// ---------- Sitemap export/import (save/reuse the field + pagination config) ----------

const exportSitemapBtn = document.getElementById("exportSitemapBtn");
const importSitemapBtn = document.getElementById("importSitemapBtn");
const importSitemapInput = document.getElementById("importSitemapInput");

exportSitemapBtn.addEventListener("click", () => {
  if (fields.length === 0) {
    showStatus("Add at least one field before exporting a sitemap.");
    return;
  }

  const sitemap = {
    fields,
    nextPageSelector: nextPageSelectorInput.value.trim(),
    maxPages: parseInt(maxPagesInput.value, 10) || 5,
  };

  const blob = new Blob([JSON.stringify(sitemap, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "sitemap.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showStatus("Sitemap exported.");
});

importSitemapBtn.addEventListener("click", () => {
  importSitemapInput.click();
});

importSitemapInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);

      if (!Array.isArray(parsed.fields)) {
        showStatus("Invalid sitemap file: missing or malformed 'fields' array.");
        return;
      }

      // Basic validation: each field needs at least a name and selector
      const allValid = parsed.fields.every(
        (f) => typeof f.name === "string" && typeof f.selector === "string"
      );
      if (!allValid) {
        showStatus("Invalid sitemap file: some fields are missing name/selector.");
        return;
      }

      // Guard against a broken "attribute" field with no attribute name — it would
      // silently return empty for every row, so fall back it to "text" instead.
      let downgradedCount = 0;
      const sanitizedFields = parsed.fields.map((f) => {
        if (f.type === "attribute" && !f.attributeName) {
          downgradedCount++;
          return { ...f, type: "text" };
        }
        return f;
      });

      fields = sanitizedFields;
      renderFields();
      saveFields();

      if (typeof parsed.nextPageSelector === "string") {
        nextPageSelectorInput.value = parsed.nextPageSelector;
      }
      if (typeof parsed.maxPages === "number") {
        maxPagesInput.value = parsed.maxPages;
      }
      saveScrapeSettings();

      const downgradeNote = downgradedCount > 0
        ? ` (${downgradedCount} "attribute" field(s) without an attribute name were converted to "text")`
        : "";
      showStatus(`Sitemap imported: ${parsed.fields.length} field(s) loaded.${downgradeNote}`);
    } catch (err) {
      showStatus("Could not parse sitemap file — make sure it's valid JSON.");
      console.error(err);
    } finally {
      importSitemapInput.value = ""; // reset so the same file can be re-selected later
    }
  };
  reader.readAsText(file);
});

// ---------- End sitemap export/import ----------