// This script runs in the context of the actual webpage.
// It listens for a message from the popup containing the user's fields,
// extracts matching data, and sends the results back.

// Given one DOM element and a field definition, return the value based on field.type
function getValueForField(el, field) {
  const type = field.type || "text";

  switch (type) {
    case "text":
      return el.textContent.trim();
    case "link":
      return el.getAttribute("href") || "";
    case "image":
      return el.getAttribute("src") || "";
    case "attribute":
      return el.getAttribute(field.attributeName || "") || "";
    case "html":
      return el.innerHTML.trim();
    case "table":
      return el.outerHTML.trim(); // raw table HTML for now; structured parsing comes later
    default:
      return el.textContent.trim();
  }
}

// Given the fields array, extract matching data from the CURRENT page and return an array of row objects.
function extractRows(fields) {
  const fieldMatches = fields.map((field) => {
    const elements = Array.from(document.querySelectorAll(field.selector));
    return {
      name: field.name,
      values: elements.map((el) => getValueForField(el, field)),
    };
  });

  const maxRows = Math.max(...fieldMatches.map((f) => f.values.length), 0);

  const rows = [];
  for (let i = 0; i < maxRows; i++) {
    const row = {};
    fieldMatches.forEach((field) => {
      row[field.name] = field.values[i] !== undefined ? field.values[i] : "";
    });
    rows.push(row);
  }
  return rows;
}

// ---------- Multi-page scraping (pagination) ----------

// Runs one step of a multi-page scrape: extract current page, save results,
// then click the "next page" element if one exists and we haven't hit the page limit.
function doScrapeStep() {
  chrome.storage.local.get(
    ["scrapeConfig", "scrapeResults", "scrapePageCount"],
    (data) => {
      const config = data.scrapeConfig;
      if (!config) return;

      try {
        const { fields, nextPageSelector, maxPages } = config;
        const newRows = extractRows(fields);
        const combinedResults = (data.scrapeResults || []).concat(newRows);
        const pageCount = (data.scrapePageCount || 0) + 1;

        chrome.storage.local.set(
          { scrapeResults: combinedResults, scrapePageCount: pageCount },
          () => {
            if (pageCount >= maxPages) {
              finishScrape();
              return;
            }

            let nextEl = null;
            try {
              nextEl = nextPageSelector ? document.querySelector(nextPageSelector) : null;
            } catch (selectorErr) {
              scrapeError(`Invalid "next page" selector: ${selectorErr.message}`);
              return;
            }

            if (!nextEl) {
              finishScrape(); // no more pages found
              return;
            }

            // Clicking navigates the page — the content script reloads fresh,
            // and the onload check below will continue the scrape automatically.
            nextEl.click();
          }
        );
      } catch (err) {
        scrapeError(err.message);
      }
    }
  );
}

function finishScrape() {
  chrome.storage.local.set({ scrapeStatus: "done" });
}

// Marks the scrape as failed with a message the popup can show, instead of leaving
// it stuck on "running" forever with no way for the user to know something broke.
function scrapeError(message) {
  chrome.storage.local.set({ scrapeStatus: "error", scrapeErrorMessage: message });
}

// On every page load, check if a multi-page scrape is currently in progress.
// If so, continue it automatically (this is how scraping survives page navigation).
chrome.storage.local.get(["scrapeStatus"], (data) => {
  if (data.scrapeStatus === "running") {
    setTimeout(doScrapeStep, 400); // small delay to let the new page render
  }
});

// ---------- End multi-page scraping ----------

// ---------- Nested/child selector scraping (listing -> detail page merge, with optional pagination) ----------

// Resolves an element's link to an absolute URL. Prefers the .href DOM property
// (browsers auto-resolve this for anchors), falls back to manually resolving
// the raw href attribute against the current page's URL.
function resolveHref(el) {
  if (el.href) return el.href;
  const raw = el.getAttribute("href") || "";
  try {
    return new URL(raw, window.location.href).href;
  } catch (err) {
    return raw;
  }
}

// Called once we've finished collecting detail data for the current listing page
// (or found no detail links on it at all). Merges this page's rows into the running
// total, then either moves on to the next listing page or finishes the whole scrape.
function nestedMergeAndTransition() {
  chrome.storage.local.get(
    ["nestedConfig", "nestedAllResults", "nestedPageRows", "nestedPageCount", "nestedNextPageUrl"],
    (data) => {
      const config = data.nestedConfig;
      if (!config) return;

      const allResults = (data.nestedAllResults || []).concat(data.nestedPageRows || []);
      const pageCount = data.nestedPageCount || 0;
      const nextPageUrl = data.nestedNextPageUrl;
      const maxPages = config.maxPages || 1;

      chrome.storage.local.set({ nestedAllResults: allResults }, () => {
        if (pageCount >= maxPages || !nextPageUrl) {
          chrome.storage.local.set({ nestedStatus: "done" });
          return;
        }
        chrome.storage.local.set({ nestedPhase: "listing" }, () => {
          window.location.href = nextPageUrl;
        });
      });
    }
  );
}

// Marks the nested scrape as failed with a message the popup can show.
function nestedError(message) {
  chrome.storage.local.set({ nestedStatus: "error", nestedErrorMessage: message });
}

// Runs a "listing step": extract this page's parent fields + detail links + the next-page
// URL (if a pagination selector is configured), then either dive into the first detail page
// or, if there are none, merge and move straight to the next listing page.
function doNestedListingStep() {
  chrome.storage.local.get(["nestedConfig", "nestedPageCount"], (data) => {
    const config = data.nestedConfig;
    if (!config) return;

    try {
      const { fields, linkSelector, nextPageSelector, maxDetailPages } = config;

      const rows = extractRows(fields);
      const linkEls = Array.from(document.querySelectorAll(linkSelector));
      const links = linkEls.map(resolveHref);

      let nextEl = null;
      if (nextPageSelector) {
        nextEl = document.querySelector(nextPageSelector);
      }
      const nextPageUrl = nextEl ? resolveHref(nextEl) : null;

      const count = Math.min(rows.length, links.length, maxDetailPages || 10);
      const slicedRows = rows.slice(0, count);
      const slicedLinks = links.slice(0, count);
      const pageCount = (data.nestedPageCount || 0) + 1;

      chrome.storage.local.set(
        {
          nestedPageRows: slicedRows,
          nestedLinks: slicedLinks,
          nestedIndex: 0,
          nestedNextPageUrl: nextPageUrl,
          nestedPageCount: pageCount,
        },
        () => {
          if (slicedLinks.length === 0) {
            nestedMergeAndTransition(); // no detail links on this page — skip straight to next page
            return;
          }
          chrome.storage.local.set({ nestedPhase: "detail" }, () => {
            window.location.href = slicedLinks[0];
          });
        }
      );
    } catch (err) {
      nestedError(err.message);
    }
  });
}

// Runs a "detail step": we've just navigated to one item's detail page.
// Extract the child fields here, merge into the matching row, then move to the
// next detail page — or, if that was the last one, merge this page and transition.
function doNestedDetailStep() {
  chrome.storage.local.get(
    ["nestedConfig", "nestedPageRows", "nestedLinks", "nestedIndex"],
    (data) => {
      const config = data.nestedConfig;
      if (!config) return;

      try {
        const pageRows = data.nestedPageRows || [];
        const links = data.nestedLinks || [];
        const index = data.nestedIndex || 0;

        const childRows = extractRows(config.childFields || []);
        const childRow = childRows[0] || {}; // detail pages have one instance of each field

        if (pageRows[index]) {
          pageRows[index] = Object.assign({}, pageRows[index], childRow);
        }

        const nextIndex = index + 1;

        chrome.storage.local.set({ nestedPageRows: pageRows, nestedIndex: nextIndex }, () => {
          if (nextIndex >= links.length) {
            nestedMergeAndTransition(); // done with all detail pages for this listing page
            return;
          }
          window.location.href = links[nextIndex];
        });
      } catch (err) {
        nestedError(err.message);
      }
    }
  );
}

// On every page load, check if a nested scrape is in progress and continue the right phase.
chrome.storage.local.get(["nestedStatus", "nestedPhase"], (data) => {
  if (data.nestedStatus === "running") {
    if (data.nestedPhase === "detail") {
      setTimeout(doNestedDetailStep, 400);
    } else {
      setTimeout(doNestedListingStep, 400);
    }
  }
});

// ---------- End nested/child selector scraping ----------

// ---------- Point-and-click element picker ----------

let pickerActive = false;
let pickerOverlay = null;
let currentHoverEl = null;

function createOverlay() {
  const overlay = document.createElement("div");
  overlay.style.position = "absolute";
  overlay.style.pointerEvents = "none";
  overlay.style.border = "2px solid #4a86e8";
  overlay.style.backgroundColor = "rgba(74, 134, 232, 0.15)";
  overlay.style.zIndex = "2147483647"; // max z-index, stay on top of page content
  overlay.style.transition = "all 0.05s ease-in-out";
  overlay.style.boxSizing = "border-box";
  document.body.appendChild(overlay);
  return overlay;
}

function positionOverlay(el) {
  if (!pickerOverlay || !el) return;
  const rect = el.getBoundingClientRect();
  pickerOverlay.style.top = `${rect.top + window.scrollY}px`;
  pickerOverlay.style.left = `${rect.left + window.scrollX}px`;
  pickerOverlay.style.width = `${rect.width}px`;
  pickerOverlay.style.height = `${rect.height}px`;
}

// Escapes a value so it can be safely used inside a CSS class selector (e.g. "col-md-4" -> ".col-md-4")
function escapeClassName(cls) {
  return cls.replace(/([^\w-])/g, "\\$1");
}

// Fallback: build a fully structural path using nth-of-type, walking up to <body>.
// Brittle (locks to one exact position), used only when no id/class exists anywhere up the tree.
function buildStructuralPath(el) {
  let current = el;
  const parts = [];
  while (current && current.nodeType === 1 && current.tagName.toLowerCase() !== "body") {
    const parent = current.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === current.tagName
    );
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
    current = parent;
  }
  return parts.join(" > ");
}

// Generates a reasonable CSS selector for the given element.
// Strategy: if the element itself has an id or class, use that directly.
// Otherwise, walk up to the nearest ancestor that HAS an id/class, and build
// a selector from that ancestor down to the element using plain tag names
// (no nth-of-type), so the selector naturally generalizes to sibling items
// (e.g. all book titles in a listing), not just the one clicked element.
function generateSelector(el) {
  if (el.id) {
    return `#${escapeClassName(el.id)}`;
  }
  if (el.classList && el.classList.length > 0) {
    const tag = el.tagName.toLowerCase();
    return tag + "." + Array.from(el.classList).map(escapeClassName).join(".");
  }

  let current = el;
  const tagPath = []; // tag names from el up to (not including) the anchor, bottom-up
  let anchor = null;

  while (true) {
    const parent = current.parentElement;
    if (!parent || parent.tagName.toLowerCase() === "html") {
      break; // reached the top without finding an anchor
    }

    tagPath.push(current.tagName.toLowerCase());

    if (parent.id) {
      anchor = `#${escapeClassName(parent.id)}`;
      break;
    }
    if (parent.classList && parent.classList.length > 0) {
      const tag = parent.tagName.toLowerCase();
      anchor = tag + "." + Array.from(parent.classList).map(escapeClassName).join(".");
      break;
    }

    current = parent;
  }

  if (!anchor) {
    // No id/class found anywhere up the tree — fall back to a brittle structural path
    return buildStructuralPath(el);
  }

  // tagPath is bottom-up (el's tag first); reverse it to get top-down order,
  // then join with ">" since each step is a direct parent-child relationship
  const descendantPath = tagPath.reverse().join(" > ");
  return `${anchor} ${descendantPath}`;
}

function handleMouseOver(event) {
  if (!pickerActive) return;
  currentHoverEl = event.target;
  positionOverlay(currentHoverEl);
}

function handleClick(event) {
  if (!pickerActive) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const selector = generateSelector(event.target);
  chrome.storage.local.set({ pickedSelector: selector }, () => {
    stopPicking();
  });
}

function handleKeyDown(event) {
  if (!pickerActive) return;
  if (event.key === "Escape") {
    stopPicking();
  }
}

function startPicking() {
  if (pickerActive) return;
  pickerActive = true;
  pickerOverlay = createOverlay();
  document.addEventListener("mouseover", handleMouseOver, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
  document.body.style.cursor = "crosshair";
}

function stopPicking() {
  pickerActive = false;
  document.removeEventListener("mouseover", handleMouseOver, true);
  document.removeEventListener("click", handleClick, true);
  document.removeEventListener("keydown", handleKeyDown, true);
  document.body.style.cursor = "";
  if (pickerOverlay) {
    pickerOverlay.remove();
    pickerOverlay = null;
  }
}

// ---------- End picker logic ----------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startPicking") {
    startPicking();
    sendResponse({ success: true });
    return;
  }

  if (message.action === "runScrapeStep") {
    doScrapeStep();
    sendResponse({ success: true });
    return;
  }

  if (message.action === "runNestedListingStep") {
    doNestedListingStep();
    sendResponse({ success: true });
    return;
  }

  if (message.action !== "extractData") {
    return; // not for us
  }

  const fields = message.fields || [];

  if (fields.length === 0) {
    sendResponse({ success: false, error: "No fields provided." });
    return;
  }

  try {
    const rows = extractRows(fields);
    sendResponse({ success: true, rows });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }

  // Return true to indicate we'll respond asynchronously (safe default)
  return true;
});

console.log("Content script loaded on:", window.location.href);