# SelectorScrape

A Chrome extension for extracting structured data from any website — no coding required. Define your own fields with CSS selectors (or just point and click), and SelectorScrape pulls matching data across the page, across multiple pages, and even across linked detail pages.

## Features

- **Point-and-click element picker** — click any element on a page to auto-generate its CSS selector
- **Multiple field types** — Text, Link (href), Image (src), Attribute, HTML, and Table
- **Pagination** — set a "next page" selector and it walks through multiple pages automatically
- **Nested/detail-page scraping** — follow each item's link to its detail page and merge extra fields into the same record (combinable with pagination)
- **Live preview** — see your first few results right in the popup before exporting
- **Multi-format export** — CSV, JSON, and Excel
- **Sitemap save/load** — export your whole field setup as JSON and reuse it later
- **Persistent fields** — your configuration survives closing the popup

## Tech Stack

Vanilla JavaScript, Chrome Extension Manifest V3, `chrome.storage.local` for persistence and cross-page-load state during multi-page/nested scraping.

## Install (unpacked)

1. Clone this repo
2. Go to `chrome://extensions`, enable **Developer mode**
3. Click **Load unpacked**, select the project folder
