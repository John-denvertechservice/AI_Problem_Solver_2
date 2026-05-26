# Chrome Problem Solver - Agent Collaboration Guide

## Project Overview

**Chrome Problem Solver** is an AI-powered Chrome extension that provides accurate, user-friendly assistance for solving math, logic, and coding problems. The extension leverages the OpenAI and Anthropic Claude APIs to deliver contextually aware, well-formatted responses.

> **This is the comprehensive reference.** For a quick start — how to load and test the unpacked extension, the `content.js` → `background.js` → API message flow, and the core code-level constraints — see **[CLAUDE.md](CLAUDE.md)**. This guide goes deeper on features, the decision tree, API integration, storage, and collaboration; CLAUDE.md is the fast orientation.

## Project Status

### ✅ What's Working Well

1. **AI Behavior & Accuracy**
   - High degree of accuracy and context awareness
   - Robust AI decision tree implementation
   - Replies provide additional helpful context
   - Excellent overall output quality

2. **Formatting & Presentation**
   - Answers appear concise and well-formatted
   - No markup or error message bleedthroughs
   - Confidence indicator is graphically appealing and powerful
   - Clean, professional presentation

3. **Performance**
   - Lightning-fast performance
   - Strong foundation architecture
   - Improved speed for sending and returning API calls
   - Optimized response times

4. **User Interface**
   - Strong graphical user interface
   - Great theme design around settings page
   - Like/dislike buttons and interactive features
   - Modern, intuitive design

### ✨ Upgraded Functionality (Current Version)

1. **Additional GUI Features**
   - Support for tracking, managing usage, and visualizing data
   - Additional pages are well-designed and user-friendly
   - Data stored locally for privacy

2. **User Feedback System**
   - Dislike button prompts user input
   - Helps improve model behavior in the future
   - Feedback mechanism for continuous improvement

3. **Enhanced Ergonomics**
   - Window pane opens when text is highlighted
   - Hotkey: Shift+Alt+A (use the Option key on macOS)
   - Opens in bottom-right corner
   - Can be scaled, minimized, and closed
   - Improved user experience

## Architecture

### Core Components

```
Chrome_Problem_Solver2/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker: AI API calls, decision tree, streaming, usage tracking
├── content.js             # Content script: overlay UI, text/image selection, follow-up conversation
├── content.css            # Styling for the overlay interface
├── popup.html             # Toolbar popup interface
├── popup.js               # Popup functionality
├── popup.css              # Popup styling
├── options.html           # Settings page
├── options.js             # Settings functionality (provider/model/key management)
├── options.css            # Settings page styling
├── analytics.html         # Usage analytics dashboard
├── analytics.js           # Analytics dashboard logic (reads chrome.storage.local usage data)
├── analytics.css          # Analytics dashboard styling
├── icons/                 # Extension icons (icon16/48/128.png)
├── agents.md              # This agent collaboration guide
├── README.md              # User-facing project documentation
├── LICENSE                # MIT license
└── .gitignore             # Git ignore rules
```

### Technical Stack

- **Manifest Version**: V3 (Modern Chrome extension architecture)
- **AI Providers**: 
  - OpenAI API (GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano)
  - Claude API (Claude Opus 4.7, Claude Sonnet 4.6, Claude Haiku 4.5)
- **Storage**: Chrome sync storage for API keys and settings
- **Architecture**: Content scripts + Background service worker

### Key Features

1. **Text Analysis**
   - General text analysis and insights
   - Content summarization
   - Key point extraction
   - Trend analysis
   - Interactive follow-up conversations

2. **Image Analysis**
   - Photo descriptions and scene analysis
   - Chart and graph interpretation
   - Screenshot and UI analysis
   - Text extraction from images
   - Object and person identification

3. **Mathematical Problem Solving**
   - Algebraic equations
   - Calculus problems
   - Geometry problems
   - Statistics and probability
   - Step-by-step solutions with verification

4. **Coding Problem Solving**
   - Code analysis and explanation
   - Language identification
   - Functionality summarization
   - Code improvement suggestions

## Decision Tree Behavior

The extension follows a structured decision tree to ensure consistent AI responses across all models:

### Text Analysis Rules

- **Over 75 words**: Summarize key points, then ask how the user would like to proceed with helpful suggestions (no Final Answer)
- **Fill-in-the-blank**: Return most likely answer (with Final Answer)
- **Questions**: Provide a brief answer and include a Final Answer field
- **Math problems**: Restate clearly, solve step-by-step, and include a Final Answer field
- **Matter-of-fact statements**: Give a ≤15-word summary and ask how the user wants to proceed (no Final Answer)
- **Commands** (answer/calculate/evaluate/graph/select...): Execute and return result (with Final Answer; graphs as ASCII)
- **Code**: Identify language, summarize functionality, offer clarification (no Final Answer)

### Image Analysis Rules

- **Images with text**: Apply the text analysis rules to the extracted text
- **Images without text**: Provide descriptive analysis without a Final Answer field

### AI Configuration

- **Temperature**: `0.0` for math problems, `0.2` for everything else (`getTemperature()` in `background.js`)
- **Token Limits**: `max_tokens: 2000` on every request
- **Context**: Per-content-type system/user prompts built by `buildPrompt()`; follow-up turns skip content-type detection and are treated as questions
- **Vision**: Image analysis supported on all OpenAI and Claude models (sent as `image_url` for OpenAI, base64 `image` blocks for Claude)
- **Streaming**: Both providers support streamed responses (`callOpenAIStream` / `callClaudeStream`). Chunks are relayed to the content script via `streamChunk` → `streamComplete`/`streamFinal` messages; a non-streaming path (`callOpenAI` / `callClaude`) also exists.
- **Conversation context**: Prior turns are passed back to the API as `conversationContext`, enabling multi-turn follow-ups within a session.

### Confidence Scoring

`calculateConfidence()` in `background.js` returns a heuristic 0–100 score (clamped to 50–95), surfaced in the overlay:
- Base score: **70**
- Math answer with a clear "Final Answer"/numeric result: **90**
- Substantial code analysis (response > 100 chars): **85**
- Very short response to long-text input: **60**

> This is a heuristic based on response shape, **not** a model-reported probability. Don't describe it as the model's actual certainty.

## User Interface

### Activation Triggers
The extension can be invoked four ways (all defined in `manifest.json` and wired up in `background.js`):
- **Analyze hotkey**: `Alt+Shift+A` (the `analyze-selection` command) — analyzes the current text/image selection. On macOS, Alt is the Option key.
- **Welcome bubble hotkey**: `Alt+Shift+K` (the `welcome-bubble` command) — opens the welcome bubble.
- **Context menu**: Right-click → "Analyze with Chrome Problem Solver" (available on selection, image, and page contexts).
- **Toolbar icon**: Clicking the extension's toolbar icon analyzes the current selection.
- **Behavior**: Opens the overlay pane in the bottom-right corner. The background worker only messages `http(s)://` and `file://` tabs, so triggers are silently ignored on `chrome://` and Web Store pages.

### Window Pane Features
- Scalable (resizable)
- Minimizable
- Closable
- Positioned in bottom-right corner
- Opens automatically on text/image selection with hotkey

### Settings Page
- Provider selection (OpenAI or Claude)
- Model selection (provider-specific)
- API key configuration
- Theme customization
- Usage tracking and visualization

## Development Guidelines

### Code Style
- Use modern JavaScript (ES6+)
- Follow Chrome Extension Manifest V3 best practices
- Maintain clean, readable code with comments
- Ensure CSP compliance (no external script loading)

### Security
- **No external dependencies**: Self-contained extension; no third-party scripts loaded
- **HTTPS API calls**: Requests go directly from the background service worker to `api.openai.com` and `api.anthropic.com` over TLS (`host_permissions` are scoped to just these two origins)
- **Key storage**: API keys and settings live in `chrome.storage.sync`. This keeps them on the user's machine(s) and out of any server we control, but `chrome.storage.sync` is **not encrypted at rest** — do not describe the keys as "encrypted" or "secure storage." Treat them as plaintext local data that Chrome syncs across the user's signed-in browsers.
- **CSP compliant**: No external script loading
- **Privacy**: No first-party data collection; only the user's selected text/image is sent to the chosen provider

### Testing
1. Load the unpacked extension and reload after changes — see [CLAUDE.md → Loading / Testing](CLAUDE.md#loading--testing)
2. Test on various websites with different content types
3. Verify API key configuration works
4. Test keyboard shortcuts and UI interactions
5. Test all decision tree paths
6. Verify image analysis functionality
7. Test feedback system

### Error Handling
- Graceful fallback mechanisms
- User-friendly error messages
- No error message bleedthrough in UI
- Proper API error handling

## API Integration

### OpenAI API
- **Models**: `gpt-4.1-mini` (GPT-4.1 Mini, default), `gpt-4.1-nano` (GPT-4.1 Nano), `gpt-4.1` (GPT-4.1)
- **Vision**: All three models support image analysis
- **Endpoint**: `POST https://api.openai.com/v1/chat/completions`, called from the background service worker

### Claude API
- **Models**: `claude-sonnet-4-6` (Claude Sonnet 4.6, default fallback), `claude-haiku-4-5-20251001` (Claude Haiku 4.5), `claude-opus-4-7` (Claude Opus 4.7)
- **Vision**: All Claude models support image analysis
- **Endpoint**: `POST https://api.anthropic.com/v1/messages`, called from the background service worker
- **API version header**: `anthropic-version: 2023-06-01`; uses `anthropic-dangerous-direct-browser-access` for direct calls from the worker

> **Note**: The extension's default provider is OpenAI with `gpt-4.1-mini`. Each provider's call site falls back to its own default model (`gpt-4.1-mini` for OpenAI, `claude-sonnet-4-6` for Claude) if none is selected. Model IDs are defined in `background.js` and `options.js` — keep both in sync when adding or changing models.

### API Key Management
- Stored in `chrome.storage.sync` under the `settings` object (`openaiKey` / `claudeKey`)
- User-configurable in the options page (keys are masked in the UI but stored as plaintext)
- Not encrypted at rest; Chrome syncs them across the user's signed-in browsers
- Never transmitted to any third party other than the provider's own API endpoint

## Data Storage

### `chrome.storage.local` (device-only, not synced)
- Usage tracking and analytics (`usage` object: request counts, average response time, breakdowns by provider/model/content type)
- Rolling request history (last 100 entries)
- Feedback data from the like/dislike buttons
- Cleared by the "Clear Data" button on the options page; exportable as JSON via "Export Data"

### `chrome.storage.sync` (synced across the user's signed-in Chrome browsers)
- API keys (`openaiKey`, `claudeKey`) — stored as plaintext, **not encrypted**
- Extension settings: selected `provider`, `model`, and the `trackUsage` preference

## Collaboration Guidelines

### For AI Agents Working on This Project

1. **Understand the Decision Tree**: Always follow the decision tree rules when implementing or modifying AI response logic
2. **Maintain UI Consistency**: Keep the clean, professional formatting and avoid markup/error bleedthrough
3. **Preserve Performance**: Any changes should maintain or improve the lightning-fast performance
4. **Respect Privacy**: Never add data collection or external dependencies
5. **Test Thoroughly**: Test all decision tree paths and edge cases
6. **Document Changes**: Update relevant documentation when making changes

### Key Files to Understand

- `manifest.json`: Extension configuration and permissions
- `background.js`: AI API calls and service worker logic
- `content.js`: UI injection and text/image selection handling
- `content.css`: Overlay interface styling
- `popup.js`: Extension popup functionality
- `options.js`: Settings page functionality

### Common Tasks

1. **Adding New AI Models**: Update model selection in options.js and add API handling in background.js
2. **Modifying Decision Tree**: Update prompt engineering in background.js
3. **UI Changes**: Modify content.js and content.css
4. **New Features**: Follow existing patterns and maintain consistency

## Future Enhancements

### Potential Improvements
- Additional AI provider support
- Enhanced visualization capabilities
- More granular usage analytics
- Export functionality for analysis history
- Custom prompt templates
- Multi-language support

## Troubleshooting

### Common Issues

1. **Hotkey Not Working**
   - Check Chrome's command registration at `chrome://extensions/shortcuts`
   - Verify page has focus
   - Ensure text/image is selected
   - Try in-page fallback hotkey

2. **API Errors**
   - Verify API keys are correctly configured
   - Check API quota/limits
   - Verify network connectivity
   - Check console for detailed error messages

3. **UI Not Appearing**
   - Verify content script injection
   - Check for CSP violations
   - Verify manifest permissions
   - Check console for errors

## Resources

- **GitHub Repository**: https://github.com/John-denvertechservice/AI_analysis_chrome_extension
- **OpenAI API**: https://platform.openai.com
- **Claude API**: https://console.anthropic.com
- **Chrome Extension Docs**: https://developer.chrome.com/docs/extensions/

## License

MIT License - See LICENSE file for details

---

**Last Updated**: 2026-05-26 — reconciled model lists, provider naming, storage/security claims, file tree, and feature coverage with the actual code (`background.js`, `options.js`, `manifest.json`)
**Extension Version**: 1.0.0 (see `manifest.json`)
**Maintainer**: John-denvertechservice
**Project Status**: Active Development
