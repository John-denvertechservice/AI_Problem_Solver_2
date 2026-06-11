# AI Problem Solver

An AI-powered Chrome extension that provides accurate, user-friendly assistance for solving math, logic, and coding problems. Leverages OpenAI and Claude AI to deliver contextually aware, well-formatted responses with excellent performance.

## Features

- **AI-Powered Analysis**: Supports both OpenAI (GPT-4.1, GPT-4.1 Mini, GPT-4.1 Nano) and Claude (Opus 4.8, Sonnet 4.6, Haiku 4.5) models
- **Smart Decision Tree**: Automatically detects content type (math, code, questions, etc.) and formats responses accordingly
- **Image Analysis**: Analyze images, charts, and screenshots using vision APIs
- **Beautiful UI**: Chrome-inspired shiny, modern design with glossy surfaces
- **Usage Tracking**: Comprehensive analytics dashboard for tracking usage and performance
- **Feedback System**: Like/dislike buttons with feedback collection
- **Conversation History**: Separate tab to view and revisit previous conversations
- **Hotkey Support**: Quick activation with Alt+Shift+A (Option key on Mac)

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top-right)
4. Click "Load unpacked" and select the extension directory
5. Configure your API keys in the extension options

## Configuration

1. Click the extension icon and select "Settings"
2. Choose your preferred AI provider (OpenAI or Claude)
3. Select a model
4. Enter your API keys:
   - **OpenAI**: Get from [OpenAI Platform](https://platform.openai.com/api-keys)
   - **Claude**: Get from [Anthropic Console](https://console.anthropic.com/)

## Usage

1. Select text or an image on any webpage
2. Press `Shift+Alt+A` (Option key on Mac)
3. The analysis window will appear in the bottom-right corner
4. View results with confidence indicator
5. Use like/dislike buttons to provide feedback
6. Access conversation history via the History tab

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
- **Matter-of-fact statements**: ≤15-word summary, ask how to proceed (no Final Answer)
- **Commands**: Execute and return result (with Final Answer)
- **Code**: Identify language, summarize functionality (no Final Answer)
- **Images with text**: Apply text analysis rules to extracted text
- **Images without text**: Descriptive analysis (no Final Answer)

## Privacy

- Usage statistics and history stay on your device (`chrome.storage.local`); they are never uploaded to us
- API keys and settings are kept in `chrome.storage.sync`, so Chrome syncs them across the browsers where you're signed in. They are **not** sent to any server we control, but note that `chrome.storage.sync` is **not encrypted at rest** — treat the keys as plaintext on your machine(s)
- No external dependencies and no third-party analytics
- The only network calls are HTTPS requests to the OpenAI and Anthropic APIs you configure
- Only the text/image you select is sent to your chosen AI provider

## License

MIT License - see LICENSE file for details

## Support

For issues, feature requests, or questions, please open an issue on the repository.
