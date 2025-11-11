# Chrome Problem Solver - Agent Collaboration Guide

## Project Overview

**Chrome Problem Solver** is an AI-powered Chrome extension that provides accurate, user-friendly assistance for solving math, logic, and coding problems. The extension leverages ChatGPT and Claude AI to deliver contextually aware, well-formatted responses with excellent performance.

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
Chrome Problem Solver/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker for AI API calls
├── content.js            # Content script for UI and text selection
├── content.css           # Styling for overlay interface
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality
├── options.html          # Settings page
├── options.js            # Settings functionality
└── README.md             # Project documentation
```

### Technical Stack

- **Manifest Version**: V3 (Modern Chrome extension architecture)
- **AI Providers**: 
  - OpenAI API (GPT-5 Mini, GPT-5 Nano, GPT-4o)
  - Claude API (Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus)
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

- **Temperature**: Optimized for accuracy (0.0 for math, 0.2 for general)
- **Token Limits**: Up to 2000 tokens for comprehensive responses
- **Context**: Intelligent prompt engineering for different content types
- **Vision**: High-detail image analysis with both OpenAI and Claude models

## User Interface

### Hotkey Activation
- **macOS**: Shift+Alt+A (Option key)
- **Windows/Linux**: Shift+Alt+A
- **Fallback**: In-page hotkey that works when page is focused
- **Behavior**: Opens window pane in bottom-right corner when text/image is selected

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
- **No external dependencies**: Self-contained extension
- **Secure API calls**: Direct communication with OpenAI and Claude APIs
- **Local storage**: API keys stored securely in Chrome sync
- **CSP compliant**: No external script loading
- **Privacy**: No data collection, only sends selected text to AI APIs

### Testing
1. Load the extension in developer mode
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
- **Models**: GPT-5 Mini (default), GPT-5 Nano, GPT-4o
- **Vision**: GPT-4o for image analysis
- **Endpoint**: Direct API calls from background service worker

### Claude API
- **Models**: Claude 3.5 Sonnet (default), Claude 3.5 Haiku, Claude 3 Opus
- **Vision**: All Claude models support image analysis
- **Beta Features**: Latest API capabilities with enhanced tool usage
- **Endpoint**: Direct API calls from background service worker

### API Key Management
- Stored in Chrome sync storage
- User-configurable in settings
- Secure, local-only storage
- No transmission to third parties

## Data Storage

### Local Storage
- Usage tracking data
- User preferences
- Feedback data
- Visualization data
- All stored locally (no cloud sync for user data)

### Chrome Sync Storage
- API keys (encrypted)
- Extension settings
- User preferences

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

**Last Updated**: Based on current project state as of initial repository setup
**Maintainer**: John-denvertechservice
**Project Status**: Active Development
