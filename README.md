# AI Problem Solver

An AI-powered Chrome extension that helps you solve academic/subject problems — math, language, multiple-choice, and fill-in-the-blank — right on the page. Powered by **Claude Haiku 4.5**, it delivers fast, well-formatted answers. (It's a study/subject solver, not a coding tool.)

## Features

- **Powered by Claude Haiku 4.5**: One fast, cost-effective model — no provider or model picking
- **Smart Decision Tree**: Detects content type (math, multiple-choice, fill-in-the-blank, questions, …) and formats responses accordingly
- **Answer Styles**: Switch between "just the answer" and "concept explainer" from the overlay
- **Image Analysis**: Read and solve problems from images and screenshots
- **Beautiful UI**: Chrome-inspired modern design, with dark and light themes
- **Usage & Cost Tracking**: Analytics dashboard with token spend and an optional monthly budget
- **Conversation History**: Searchable, exportable history tab
- **Hotkeys**: `Alt+Shift+A` to analyze, `Esc` to close, `↑` to recall your last follow-up (Option key on Mac)

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked" and select the extension directory
5. Configure your API keys in the extension options

## Configuration

1. Click the extension icon and select "Settings"
2. Enter your **Claude API key** — get one from [Anthropic Console](https://console.anthropic.com/)
3. (Optional) Pick a theme, answer style, and a monthly spend budget

## Usage

1. Select text or an image on any webpage
2. Press `Shift+Alt+A` (Option key on Mac)
3. The analysis window appears in the bottom-right corner
4. Read the answer; switch answer style or ask a follow-up
5. Use like/dislike buttons to provide feedback
6. Search and revisit past conversations via the History tab

## Architecture

- **Manifest V3**: Modern Chrome extension architecture
- **Background Service Worker**: Handles AI API calls and decision tree logic
- **Content Scripts**: Injected into web pages for text/image selection
- **Local Storage**: All user data stored locally for privacy

## File Structure

```
Chrome_Problem_Solver2/
├── manifest.json          # Extension configuration
├── background.js          # Service worker for AI API calls
├── content.js            # Content script for UI and selection
├── content.css           # Overlay window styling
├── popup.html/js/css     # Extension popup interface
├── options.html/js/css   # Settings page
├── analytics.html/js/css  # Analytics dashboard
├── icons/                # Extension icons
└── README.md             # This file
```

## Decision Tree

The extension follows a structured decision tree:

- **Over 75 words**: Summarize key points, suggest next steps (no Final Answer)
- **Fill-in-the-blank**: Return most likely answer (with Final Answer)
- **Questions**: Brief answer with Final Answer field
- **Math problems**: Step-by-step solution with Final Answer
- **Multiple-choice**: Pick the single best option, state it as the Final Answer
- **Matter-of-fact statements**: ≤15-word summary, ask how to proceed (no Final Answer)
- **Commands**: Carry out and return result (with Final Answer)
- **Images**: Read the problem in the image and solve it

## Privacy

- Usage statistics and history stay on your device (`chrome.storage.local`); they are never uploaded to us
- API keys and settings are kept in `chrome.storage.sync`, so Chrome syncs them across the browsers where you're signed in. They are **not** sent to any server we control, but note that `chrome.storage.sync` is **not encrypted at rest** — treat the keys as plaintext on your machine(s)
- No external dependencies and no third-party analytics
- The only network calls are HTTPS requests to the Anthropic (Claude) API
- Only the text/image you select is sent to the Claude API

## License

MIT License - see LICENSE file for details

## Support

For issues, feature requests, or questions, please open an issue on the repository.
