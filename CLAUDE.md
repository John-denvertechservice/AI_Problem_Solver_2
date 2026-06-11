# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **This is the quick operational reference** — how to load, test, and orient in the code. For the comprehensive guide (full model IDs and endpoints, detailed decision-tree rules, storage internals, confidence scoring, troubleshooting, and collaboration guidelines), see **[agents.md](agents.md)**. Where the two overlap, agents.md is canonical for deep detail; this file stays intentionally brief.

## What This Is

A Chrome extension (Manifest V3) that injects an AI-powered overlay onto any webpage. Users select text or images and get AI analysis via OpenAI or Anthropic APIs. No build step — the extension loads directly from source files.

## Loading / Testing

1. Open `chrome://extensions/` in Chrome
2. Enable Developer Mode
3. Click "Load unpacked" and select this directory
4. After any code change, click the refresh icon on the extension card
5. On content script changes, also reload the target tab

To test keyboard shortcuts: `chrome://extensions/shortcuts`

## Architecture

**Message flow:** `content.js` (page) → `background.js` (service worker) → AI API → back to `content.js`

- **`background.js`** — Service worker. Owns all AI API calls (`callOpenAI`, `callClaude`, and streaming variants). Houses the decision tree (`analyzeContentType`, `buildPrompt`) that classifies input and shapes prompts. Also tracks usage stats in `chrome.storage.local`.
- **`content.js`** — Injected into every page. Handles text/image selection, creates and manages the overlay UI, listens for hotkeys (`Alt+Shift+A` = analyze, `Alt+Shift+K` = welcome bubble), maintains `conversationHistory` for follow-up turns.
- **`options.js` / `options.html`** — Settings page: provider (OpenAI/Claude), model, API keys stored in `chrome.storage.sync`.
- **`popup.js` / `popup.html`** — Toolbar icon popup showing quick stats and navigation buttons.
- **`analytics.js` / `analytics.html`** — Full analytics dashboard reading usage data from `chrome.storage.local`.

## Current AI Models

```js
// OpenAI (background.js)
'gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1'

// Claude (background.js)
'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'
```

When adding new models, update the model maps in **both** `background.js` and `options.js`. Full model IDs with display names, default fallbacks, and endpoints live in [agents.md → API Integration](agents.md#api-integration).

## Decision Tree (background.js)

`analyzeContentType(text)` classifies input, then `buildPrompt()` sets the system prompt and whether a "Final Answer" field is included:

| Content type | Final Answer? |
|---|---|
| Math, questions, fill-in-blank, commands | Yes |
| Code, long text (>75 words), statements | No |
| Images without text | No |

Follow-up messages bypass classification and use `isQuestion: true`. For the per-content-type prompt rules and formatting expectations, see [agents.md → Decision Tree Behavior](agents.md#decision-tree-behavior).

## Key Constraints

- **No external dependencies** — pure JS, no npm, no bundler. Everything must be CSP-compliant (no `eval`, no remote scripts).
- **Claude API** requires the `anthropic-dangerous-direct-browser-access: true` header because calls come from the service worker context (browser-side fetch).
- **Streaming** uses `analyzeStream` action (fire-and-forget from content.js); chunks and completion are pushed back via `chrome.tabs.sendMessage` with `streamChunk` / `streamComplete` / `streamFinal` / `streamError` actions.
- **Settings** (`provider`, `model`, API keys) live in `chrome.storage.sync`; usage history lives in `chrome.storage.local` (capped at 100 entries).
- Temperature: `0.0` for math content, `0.2` for everything else.
