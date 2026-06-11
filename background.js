// Chrome Problem Solver - Background Service Worker
// Handles AI API calls, decision tree logic, and prompt engineering.
// Only the streaming path is used by the UI; chunks/final/error are pushed to
// the originating tab via chrome.tabs.sendMessage.

// Default settings
const DEFAULT_SETTINGS = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  openaiKey: '',
  claudeKey: ''
};

// Max output tokens per request. Streaming keeps long answers from hitting SDK
// timeouts, so this can be generous without risking truncated replies.
const MAX_TOKENS = 4096;

// OpenAI Models
const OPENAI_MODELS = {
  'gpt-4.1-nano': { name: 'GPT-4.1 Nano', vision: true },
  'gpt-4.1-mini': { name: 'GPT-4.1 Mini', vision: true },
  'gpt-4.1': { name: 'GPT-4.1', vision: true }
};

// Claude Models
const CLAUDE_MODELS = {
  'claude-haiku-4-5-20251001': { name: 'Claude Haiku 4.5', vision: true },
  'claude-sonnet-4-6': { name: 'Claude Sonnet 4.6', vision: true },
  'claude-opus-4-8': { name: 'Claude Opus 4.8', vision: true }
};

// In-flight streaming requests, keyed by requestId, so a Stop button in the
// overlay can abort the right fetch without touching any other request.
const activeStreams = new Map();

// Initialize context menu
function initializeContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cps-analyze-selection',
      title: 'Analyze with Chrome Problem Solver',
      contexts: ['selection', 'image', 'page']
    });
  });
}

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  // Ensure default settings exist
  chrome.storage.sync.get(['settings'], (result) => {
    if (!result.settings) {
      chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    }
  });

  // Create a context menu for manual triggering
  initializeContextMenu();
});

// Also create context menu on startup (service worker may restart)
chrome.runtime.onStartup.addListener(() => {
  initializeContextMenu();
});

// Create context menu when service worker starts
initializeContextMenu();

// Listen for messages from the extension's own content scripts / pages.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Only accept messages from this extension (defense in depth — there's no
  // externally_connectable, but this rejects anything unexpected).
  if (sender.id !== chrome.runtime.id) return;

  if (request.action === 'analyzeStream') {
    // Requires a tab to push stream chunks back to.
    if (sender.tab && typeof sender.tab.id === 'number') {
      handleAnalysisStream(request.data, sender.tab.id);
    }
    return false; // No sendResponse used; let channel close
  }
  if (request.action === 'abortStream') {
    const controller = activeStreams.get(request.requestId);
    if (controller) controller.abort();
    return false;
  }
  if (request.action === 'trackUsage') {
    trackUsage(request.data);
  }
});

// Decision Tree: Analyze content type and determine response format
function analyzeContentType(text) {
  const wordCount = text.trim().split(/\s+/).length;
  const trimmed = text.trim();

  // Math problem detection
  const mathPatterns = [
    /^[\d+\-*/().\s=<>≤≥]+$/,
    /solve|calculate|evaluate|compute|find|derivative|integral|limit/i,
    /\d+\s*[+\-*/]\s*\d+/,
    /x\s*[=+\-*/]|y\s*[=+\-*/]/
  ];
  const isMath = mathPatterns.some(pattern => pattern.test(text));

  // Code detection
  const codePatterns = [
    /function\s+\w+|def\s+\w+|class\s+\w+|import\s+|const\s+\w+|let\s+\w+|var\s+\w+/,
    /[{}();]|=>|->|::/
  ];
  const isCode = codePatterns.some(pattern => pattern.test(text));

  // Question detection
  const isQuestion = trimmed.endsWith('?') || /^(what|how|why|when|where|who|which|can|could|should|would|is|are|do|does|did)/i.test(trimmed);

  // Fill-in-the-blank detection
  const isFillBlank = /_+|\bblank\b|_____/i.test(text);

  // Command detection
  const isCommand = /^(answer|calculate|evaluate|graph|select|solve|find)/i.test(trimmed);

  // Matter-of-fact statement
  const isStatement = !isQuestion && !isMath && !isCode && !isCommand && wordCount <= 20;

  return {
    wordCount,
    isMath,
    isCode,
    isQuestion,
    isFillBlank,
    isCommand,
    isStatement,
    isLongText: wordCount > 75
  };
}

// Build prompt based on content type
function buildPrompt(text, contentType, isImage = false) {
  const { isMath, isCode, isQuestion, isFillBlank, isCommand, isStatement, isLongText } = contentType;

  let systemPrompt = 'You are a helpful AI assistant that provides accurate, concise answers. ' +
    'Format replies in Markdown: use headings, bullet/numbered lists, tables, and fenced code blocks ' +
    'with a language tag (e.g. ```python). Write math in LaTeX — inline as \\( ... \\) and display ' +
    'equations as $$ ... $$. ';
  let userPrompt = '';

  if (isImage) {
    systemPrompt += 'Analyze the image and provide a detailed description. ';
    if (isMath || isCode) {
      systemPrompt += 'If the image contains math or code, solve or explain it step-by-step. ';
    }
  } else if (isMath) {
    systemPrompt += 'You are solving a mathematical problem. Restate the problem clearly, solve it step-by-step showing all work, and provide a Final Answer at the end. ';
    userPrompt = `Solve this math problem step-by-step:\n\n${text}`;
  } else if (isCode) {
    systemPrompt += 'Identify the programming language, summarize the functionality, and offer clarification or improvements. Do NOT include a Final Answer field. ';
    userPrompt = `Analyze this code:\n\n${text}`;
  } else if (isFillBlank) {
    systemPrompt += 'Provide the most likely answer for this fill-in-the-blank question. Include a Final Answer field. ';
    userPrompt = `Fill in the blank:\n\n${text}`;
  } else if (isQuestion) {
    systemPrompt += 'Provide a brief, accurate answer to this question. Include a Final Answer field. ';
    userPrompt = `Answer this question:\n\n${text}`;
  } else if (isCommand) {
    systemPrompt += 'Execute this command and return the result. Include a Final Answer field. For graphs, use ASCII art. ';
    userPrompt = `Execute:\n\n${text}`;
  } else if (isLongText) {
    systemPrompt += 'Summarize the key points of this text, then ask how the user would like to proceed with helpful suggestions. Do NOT include a Final Answer field. ';
    userPrompt = `Summarize this text:\n\n${text}`;
  } else if (isStatement) {
    systemPrompt += 'Provide a brief summary (15 words or less) and ask how the user wants to proceed. Do NOT include a Final Answer field. ';
    userPrompt = `Summarize:\n\n${text}`;
  } else {
    systemPrompt += 'Provide helpful analysis and insights. ';
    userPrompt = text;
  }

  return { systemPrompt, userPrompt };
}

// Get temperature based on content type
function getTemperature(contentType) {
  return contentType.isMath ? 0.0 : 0.2;
}

// Parse an image data URL into a Claude image source, preserving the real MIME
// type. Falls back to PNG for bare base64 with no data-URL prefix.
function parseImageSource(imageData) {
  const match = /^data:([^;]+);base64,(.*)$/is.exec(imageData || '');
  if (match) {
    return { type: 'base64', media_type: match[1], data: match[2] };
  }
  return { type: 'base64', media_type: 'image/png', data: (imageData || '').split(',')[1] || imageData };
}

// Build the OpenAI chat messages array (system + history + current turn).
function buildOpenAIMessages(systemPrompt, userPrompt, text, imageData, conversationContext) {
  const messages = [{ role: 'system', content: systemPrompt }];

  (conversationContext || []).forEach(msg => {
    if (msg.role === 'user') {
      messages.push({
        role: 'user',
        content: msg.imageData
          ? [{ type: 'text', text: msg.text }, { type: 'image_url', image_url: { url: msg.imageData } }]
          : msg.text
      });
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.text });
    }
  });

  const content = [];
  if (userPrompt) content.push({ type: 'text', text: userPrompt });
  if (imageData) content.push({ type: 'image_url', image_url: { url: imageData } });
  messages.push({ role: 'user', content: content.length ? content : (userPrompt || text) });

  return messages;
}

// Build the Claude messages array (history + current turn). The system prompt
// is passed as a top-level field, not a message.
function buildClaudeMessages(userPrompt, text, imageData, conversationContext) {
  const messages = [];

  (conversationContext || []).forEach(msg => {
    if (msg.role === 'user') {
      messages.push(msg.imageData
        ? { role: 'user', content: [{ type: 'text', text: msg.text }, { type: 'image', source: parseImageSource(msg.imageData) }] }
        : { role: 'user', content: msg.text });
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.text });
    }
  });

  if (imageData) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt || text },
        { type: 'image', source: parseImageSource(imageData) }
      ]
    });
  } else {
    messages.push({ role: 'user', content: userPrompt || text });
  }

  return messages;
}

// Read an SSE response line-by-line, parsing each `data:` payload as JSON and
// handing it to onData. Returning false from onData (or a `data: [DONE]`)
// stops the pump.
async function pumpSSE(response, onData) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return;
        let json;
        try { json = JSON.parse(data); } catch (_) { continue; }
        if (onData(json) === false) return;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
}

// Shared streaming core. Fires the request, relays each text delta to the tab as
// a streamChunk, and returns the accumulated text. A user Stop (AbortError) is
// swallowed so whatever streamed so far is kept.
//   extractDelta(json) -> { delta?: string, stop?: boolean }
async function streamCompletion({ url, headers, body, tabId, requestId, extractDelta, errorLabel }) {
  const controller = new AbortController();
  if (requestId) activeStreams.set(requestId, controller);

  let fullResponse = '';
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: { message: errorLabel } }));
      throw new Error(error.error?.message || errorLabel);
    }

    await pumpSSE(response, (json) => {
      const { delta, stop } = extractDelta(json);
      if (delta) {
        fullResponse += delta;
        chrome.tabs.sendMessage(tabId, { action: 'streamChunk', chunk: delta, requestId });
      }
      if (stop) return false;
    });
  } catch (e) {
    // User-initiated Stop: keep whatever streamed so far (graceful finish).
    if (e.name !== 'AbortError') throw e;
  } finally {
    if (requestId) activeStreams.delete(requestId);
  }

  return fullResponse;
}

// Call OpenAI with streaming
async function callOpenAIStream(text, contentType, imageData, conversationContext, tabId, requestId) {
  const settings = await getSettings();
  const apiKey = settings.openaiKey;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  const model = settings.model || 'gpt-4.1-mini';
  const { systemPrompt, userPrompt } = buildPrompt(text, contentType, !!imageData);

  return streamCompletion({
    url: 'https://api.openai.com/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: {
      model,
      messages: buildOpenAIMessages(systemPrompt, userPrompt, text, imageData, conversationContext),
      temperature: getTemperature(contentType),
      max_tokens: MAX_TOKENS,
      stream: true
    },
    tabId,
    requestId,
    errorLabel: 'OpenAI API error',
    extractDelta: (json) => ({ delta: json.choices?.[0]?.delta?.content || '' })
  });
}

// Call Claude with streaming
async function callClaudeStream(text, contentType, imageData, conversationContext, tabId, requestId) {
  const settings = await getSettings();
  const apiKey = settings.claudeKey;
  if (!apiKey) throw new Error('Claude API key not configured');

  const model = settings.model || 'claude-sonnet-4-6';
  const { systemPrompt, userPrompt } = buildPrompt(text, contentType, !!imageData);

  return streamCompletion({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: {
      model,
      system: systemPrompt,
      messages: buildClaudeMessages(userPrompt, text, imageData, conversationContext),
      temperature: getTemperature(contentType),
      max_tokens: MAX_TOKENS,
      stream: true
    },
    tabId,
    requestId,
    errorLabel: 'Claude API error',
    extractDelta: (json) => {
      if (json.type === 'content_block_delta' && json.delta?.text) return { delta: json.delta.text };
      if (json.type === 'message_stop') return { stop: true };
      return {};
    }
  });
}

// Content type used for follow-up turns (skip classification, treat as a question).
function followUpContentType(text) {
  return {
    isMath: false, isCode: false, isQuestion: true, isFillBlank: false,
    isCommand: false, isStatement: false, isLongText: false,
    wordCount: (text || '').split(/\s+/).length
  };
}

// Handle streaming analysis request
async function handleAnalysisStream(data, tabId) {
  const settings = await getSettings();
  try {
    const startTime = Date.now();
    const { text, imageData, conversationContext, isFollowUp, requestId } = data;

    const contentType = isFollowUp ? followUpContentType(text) : analyzeContentType(text || '');

    const callStream = settings.provider === 'openai' ? callOpenAIStream : callClaudeStream;
    const fullResponse = await callStream(text, contentType, imageData, conversationContext, tabId, requestId);

    const responseTime = Date.now() - startTime;
    const confidence = calculateConfidence(fullResponse, contentType);

    trackUsage({
      provider: settings.provider,
      model: settings.model,
      responseTime,
      success: true,
      contentType: contentType.isMath ? 'math' : contentType.isCode ? 'code' : 'text'
    });

    // Single completion signal — carries the real confidence (fixes the prior
    // bug where an earlier streamComplete pinned confidence at the 70% default).
    chrome.tabs.sendMessage(tabId, {
      action: 'streamFinal',
      confidence,
      responseTime,
      fullResponse,
      requestId
    });
  } catch (error) {
    trackUsage({
      provider: settings.provider,
      model: settings.model,
      success: false,
      error: error.message
    });

    chrome.tabs.sendMessage(tabId, {
      action: 'streamError',
      error: error.message,
      requestId: data && data.requestId
    });
  }
}

// Calculate confidence score (0-100). Heuristic based on response shape — not a
// model-reported probability.
function calculateConfidence(response, contentType) {
  let confidence = 70; // Base confidence

  if (contentType.isMath && /final answer|answer:\s*\d+/i.test(response)) {
    confidence = 90;
  }
  if (contentType.isCode && response.length > 100) {
    confidence = 85;
  }
  if (contentType.isLongText && response.length < 50) {
    confidence = 60;
  }

  return Math.max(50, Math.min(95, confidence));
}

// Get settings from storage
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['settings'], (result) => {
      resolve(result.settings || DEFAULT_SETTINGS);
    });
  });
}

// Track usage statistics
function trackUsage(data) {
  chrome.storage.local.get(['usage'], (result) => {
    const usage = result.usage || {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      averageResponseTime: 0,
      byProvider: {},
      byModel: {},
      byContentType: {},
      history: []
    };

    usage.totalRequests++;
    if (data.success) {
      usage.successfulRequests++;
      if (data.responseTime) {
        usage.totalResponseTime += data.responseTime;
        usage.averageResponseTime = usage.totalResponseTime / usage.successfulRequests;
      }
    } else {
      usage.failedRequests++;
    }

    if (data.provider) {
      usage.byProvider[data.provider] = (usage.byProvider[data.provider] || 0) + 1;
    }
    if (data.model) {
      usage.byModel[data.model] = (usage.byModel[data.model] || 0) + 1;
    }
    if (data.contentType) {
      usage.byContentType[data.contentType] = (usage.byContentType[data.contentType] || 0) + 1;
    }

    // Add to history (keep last 100)
    usage.history.push({ timestamp: Date.now(), ...data });
    if (usage.history.length > 100) {
      usage.history.shift();
    }

    chrome.storage.local.set({ usage });
  });
}

// True only for tabs where content scripts run (http/https/file).
function isContentScriptUrl(url) {
  return /^https?:\/\//.test(url || '') || /^file:\/\//.test(url || '');
}

// Errors that are expected when no content script is present on a tab.
function isExpectedMessagingError(message) {
  const msg = message || '';
  return (
    msg.includes('Could not establish connection') ||
    msg.includes('Receiving end does not exist') ||
    msg.includes('message port closed') ||
    msg.includes('Extension context invalidated') ||
    msg === ''
  );
}

// Send an action message to a tab's content script, swallowing the common
// "no receiver" errors that occur on chrome:// and Web Store pages.
function messageTab(tabId, payload, context) {
  try {
    chrome.tabs.sendMessage(tabId, payload, () => {
      const err = chrome.runtime.lastError;
      if (err && !isExpectedMessagingError(err.message)) {
        console.error(`${context} error:`, err.message);
      }
    });
  } catch (error) {
    console.error(`${context} exception:`, error);
  }
}

// Handle command shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command !== 'analyze-selection' && command !== 'welcome-bubble') return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab || !isContentScriptUrl(tab.url)) return;
    messageTab(tab.id, { action: command }, 'Command');
  });
});

// Toolbar icon click → analyze current selection
chrome.action?.onClicked.addListener((tab) => {
  if (!tab || !isContentScriptUrl(tab.url)) return;
  messageTab(tab.id, { action: 'analyze-selection' }, 'Action');
});

// Context menu click → analyze selection
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (!tab || !isContentScriptUrl(tab.url)) return;
  messageTab(tab.id, {
    action: 'analyze-selection',
    selectionText: info.selectionText || null,
    srcUrl: info.srcUrl || null
  }, 'Context menu');
});
