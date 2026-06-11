# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **This is the quick operational reference** — how to load, test, and orient in the code. For the comprehensive guide (full model ID and endpoint, detailed decision-tree rules, storage internals, troubleshooting, and collaboration guidelines), see **[agents.md](agents.md)**. Where the two overlap, agents.md is canonical for deep detail; this file stays intentionally brief.

## What This Is

A Chrome extension (Manifest V3) that injects an AI-powered **study/subject solver** overlay onto any webpage. Users select text or images (math, language, multiple-choice, fill-in-the-blank, word problems) and get answers via the Anthropic Claude API. It is **not** a coding tool. A single model — **Claude Haiku 4.5** — handles everything; there is no provider/model selection. No build step — the extension loads directly from source files.

## Loading / Testing

1. Open `chrome://extensions/` in Chrome
2. Enable Developer Mode
3. Click "Load unpacked" and select this directory
4. After any code change, click the refresh icon on the extension card
5. On content script changes, also reload the target tab

To test keyboard shortcuts: `chrome://extensions/shortcuts`

## Architecture

**Message flow:** `content.js` (page) → `background.js` (service worker) → AI API → back to `content.js`

- **`background.js`** — Service worker. Owns the Claude API call (`callClaudeStream`). Houses the decision tree (`analyzeContentType`, `buildPrompt`) that classifies input and shapes prompts, and the `answerStyle` directive. Tracks usage + token/cost stats in `chrome.storage.local`.
- **`content.js`** — Injected into every page. Handles text/image selection, creates and manages the overlay UI, the answer-style selector and theme toggle, listens for hotkeys (`Alt+Shift+A` = analyze, `Alt+Shift+K` = welcome bubble, `Esc` = close, `↑` = recall last follow-up), maintains `conversationHistory` (searchable/exportable).
- **`options.js` / `options.html`** — Settings page: Claude API key, theme, answer style, monthly budget — stored in `chrome.storage.sync`.
- **`popup.js` / `popup.html`** — Toolbar icon popup showing quick stats and navigation buttons.
- **`analytics.js` / `analytics.html`** — Analytics dashboard (requests, content types, **spend/budget**) reading usage data from `chrome.storage.local`.

## Current AI Model

Single model, defined once as `CLAUDE_MODEL` in `background.js`:

```js
'claude-haiku-4-5-20251001'  // Claude Haiku 4.5 — $1/MTok in, $5/MTok out
```

There is no model/provider selection. The display name also appears in `options`/`analytics`; the pricing constant `HAIKU_PRICE_PER_MTOK` lives in `background.js`. See [agents.md → API Integration](agents.md#api-integration).

## Decision Tree (background.js)

`analyzeContentType(text)` classifies input, then `buildPrompt()` sets the system prompt and whether a "Final Answer" field is included:

| Content type | Final Answer? |
|---|---|
| Math, multiple-choice, fill-in-blank, questions, commands, images | Yes |
| Long text (>75 words), statements | No |

`buildPrompt()` also appends the `answerStyle` directive (`answer` = terse / `explain` = concept-first) to answer-bearing types. Follow-up messages bypass classification and use `isQuestion: true`. For the per-content-type prompt rules, see [agents.md → Decision Tree Behavior](agents.md#decision-tree-behavior).

## Key Constraints

- **No external dependencies** — pure JS, no npm, no bundler. Everything must be CSP-compliant (no `eval`, no remote scripts).
- **Claude API** requires the `anthropic-dangerous-direct-browser-access: true` header because calls come from the service worker context (browser-side fetch).
- **Streaming** uses `analyzeStream` action (fire-and-forget from content.js); chunks and completion are pushed back via `chrome.tabs.sendMessage` with `streamChunk` / `streamComplete` / `streamFinal` / `streamError` actions. Token usage is captured from the SSE stream for cost tracking.
- **Settings** (`claudeKey`, `theme`, `trackUsage`, `answerStyle`, `monthlyBudgetUsd`) live in `chrome.storage.sync`; `getSettings()` normalizes legacy pre-v2 settings. Usage history lives in `chrome.storage.local` (capped at 100 entries).
- Temperature: `0.0` for math content, `0.2` for everything else.
