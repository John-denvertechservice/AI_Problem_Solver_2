// AI Problem Solver - Background Service Worker
// Handles AI API calls, decision tree logic, and prompt engineering.
// Only the streaming path is used by the UI; chunks/final/error are pushed to
// the originating tab via chrome.tabs.sendMessage.

// The single model this extension uses. Haiku is fast, cheap, and more than
// capable for the math / language / multiple-choice problems this tool targets.
// (Display name lives in options.js and analytics.js — keep them in sync.)
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// Default settings. answerStyle: 'answer' (just the answer) | 'explain'
// (concept explainer). monthlyBudgetUsd: 0 means no cap.
const DEFAULT_SETTINGS = {
  claudeKey: '',
  theme: 'dark',
  trackUsage: true,
  answerStyle: 'answer',
  monthlyBudgetUsd: 0
};

// Max output tokens per request. Streaming keeps long answers from hitting SDK
// timeouts, so this can be generous without risking truncated replies.
const MAX_TOKENS = 4096;

// In-flight streaming requests, keyed by requestId, so a Stop button in the
// overlay can abort the right fetch without touching any other request.
const activeStreams = new Map();

// Initialize context menu
function initializeContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'cps-analyze-selection',
      title: 'Analyze with AI Problem Solver',
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

  // Multiple-choice detection: lettered/numbered options (A) B. (c) etc.) or an
  // explicit "which of the following" prompt — the core of a study tool.
  const mcPatterns = [
    /(^|\n)\s*\(?[A-Da-d][).]\s+\S/,           // A) ...  B. ...  (c) ...
    /(^|\n)\s*[1-5][).]\s+\S/,                  // 1) ...  2. ...
    /which of the following|choose the (correct|best)|select the (correct|best)/i
  ];
  const isMultipleChoice = mcPatterns.some(pattern => pattern.test(text));

  // Question detection
  const isQuestion = trimmed.endsWith('?') || /^(what|how|why|when|where|who|which|can|could|should|would|is|are|do|does|did)/i.test(trimmed);

  // Fill-in-the-blank detection
  const isFillBlank = /_+|\bblank\b|_____/i.test(text);

  // Command detection
  const isCommand = /^(answer|calculate|evaluate|graph|select|solve|find)/i.test(trimmed);

  // Matter-of-fact statement
  const isStatement = !isQuestion && !isMath && !isMultipleChoice && !isCommand && wordCount <= 20;

  return {
    wordCount,
    isMath,
    isMultipleChoice,
    isQuestion,
    isFillBlank,
    isCommand,
    isStatement,
    isLongText: wordCount > 75
  };
}

// Per-answer-style directive appended to the system prompt. 'answer' is terse
// (great for multiple-choice / fill-in-the-blank); 'explain' teaches the concept.
function answerStyleDirective(answerStyle) {
  if (answerStyle === 'explain') {
    return 'Answer style: explain the underlying concept needed to reach the answer, then state the answer. ' +
      'Keep it study-oriented and clear, not exhaustive. ';
  }
  return 'Answer style: give the answer directly and concisely. State the Final Answer first; ' +
    'add at most a one-line justification. Avoid long explanations. ';
}

// Build prompt based on content type. This is a study/subject assistant
// (math, language, multiple-choice, fill-in-the-blank, word problems) — not a
// coding tool — so prompts lean on stating a clear Final Answer.
function buildPrompt(text, contentType, isImage = false, answerStyle = 'answer') {
  const { isMath, isMultipleChoice, isQuestion, isFillBlank, isCommand, isStatement, isLongText } = contentType;

  let systemPrompt = 'You are a helpful study assistant that solves academic problems across subjects ' +
    '(math, language, science, history, and general knowledge) with accurate, concise answers. ' +
    'Format replies in Markdown: use headings, bullet/numbered lists, and tables. Write math in LaTeX — ' +
    'inline as \\( ... \\) and display equations as $$ ... $$. ';
  let userPrompt = '';

  if (isImage) {
    systemPrompt += 'Read the problem in the image and solve it. Provide a clear Final Answer. ';
    if (isMath) {
      systemPrompt += 'If it contains math, solve it step-by-step. ';
    }
  } else if (isMath) {
    systemPrompt += 'You are solving a mathematical problem. Restate the problem clearly, solve it step-by-step showing all work, and provide a Final Answer at the end. ';
    userPrompt = `Solve this math problem step-by-step:\n\n${text}`;
  } else if (isMultipleChoice) {
    systemPrompt += 'This is a multiple-choice question. Identify the single best option, state it as the Final Answer (the letter/number and its text), and briefly say why. ';
    userPrompt = `Answer this multiple-choice question:\n\n${text}`;
  } else if (isFillBlank) {
    systemPrompt += 'Provide the most likely answer for this fill-in-the-blank question. Include a Final Answer field. ';
    userPrompt = `Fill in the blank:\n\n${text}`;
  } else if (isQuestion) {
    systemPrompt += 'Provide a brief, accurate answer to this question. Include a Final Answer field. ';
    userPrompt = `Answer this question:\n\n${text}`;
  } else if (isCommand) {
    systemPrompt += 'Carry out this instruction and return the result. Include a Final Answer field. For graphs, use ASCII art. ';
    userPrompt = `Do this:\n\n${text}`;
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

  // Style applies to answer-bearing content types, not summaries/clarifications.
  if (isMath || isMultipleChoice || isFillBlank || isQuestion || isCommand || isImage) {
    systemPrompt += answerStyleDirective(answerStyle);
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

// Call Claude with streaming. Returns the accumulated text plus the token usage
// reported by the API (used for cost tracking). Haiku is the only model.
async function callClaudeStream(text, contentType, imageData, conversationContext, tabId, requestId, usage) {
  const settings = await getSettings();
  const apiKey = settings.claudeKey;
  if (!apiKey) throw new Error('Claude API key not configured');

  const { systemPrompt, userPrompt } = buildPrompt(text, contentType, !!imageData, settings.answerStyle);

  return streamCompletion({
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: {
      model: CLAUDE_MODEL,
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
      // Capture token usage as it streams: message_start carries input_tokens,
      // message_delta carries the running output_tokens.
      if (json.type === 'message_start' && json.message?.usage) {
        usage.inputTokens = json.message.usage.input_tokens || 0;
        usage.outputTokens = json.message.usage.output_tokens || 0;
      }
      if (json.type === 'message_delta' && json.usage && json.usage.output_tokens != null) {
        usage.outputTokens = json.usage.output_tokens;
      }
      if (json.type === 'content_block_delta' && json.delta?.text) return { delta: json.delta.text };
      if (json.type === 'message_stop') return { stop: true };
      return {};
    }
  });
}

// Content type used for follow-up turns (skip classification, treat as a question).
function followUpContentType(text) {
  return {
    isMath: false, isMultipleChoice: false, isQuestion: true, isFillBlank: false,
    isCommand: false, isStatement: false, isLongText: false,
    wordCount: (text || '').split(/\s+/).length
  };
}

// Label the primary content type for usage stats.
function contentTypeLabel(contentType) {
  if (contentType.isMath) return 'math';
  if (contentType.isMultipleChoice) return 'multipleChoice';
  if (contentType.isFillBlank) return 'fillBlank';
  if (contentType.isQuestion) return 'question';
  if (contentType.isCommand) return 'command';
  if (contentType.isLongText) return 'longText';
  return 'text';
}

// Handle streaming analysis request
async function handleAnalysisStream(data, tabId) {
  try {
    const startTime = Date.now();
    const { text, imageData, conversationContext, isFollowUp, requestId } = data;

    const contentType = isFollowUp ? followUpContentType(text) : analyzeContentType(text || '');

    const usage = { inputTokens: 0, outputTokens: 0 };
    const fullResponse = await callClaudeStream(
      text, contentType, imageData, conversationContext, tabId, requestId, usage
    );

    const responseTime = Date.now() - startTime;
    const costUsd = estimateCost(usage.inputTokens, usage.outputTokens);

    trackUsage({
      model: CLAUDE_MODEL,
      responseTime,
      success: true,
      contentType: contentTypeLabel(contentType),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd
    });

    chrome.tabs.sendMessage(tabId, {
      action: 'streamFinal',
      responseTime,
      fullResponse,
      requestId
    });
  } catch (error) {
    trackUsage({
      model: CLAUDE_MODEL,
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

// Claude Haiku 4.5 pricing (USD per million tokens). Verified against
// Anthropic's pricing page — update if the rates change.
const HAIKU_PRICE_PER_MTOK = { input: 1.0, output: 5.0 };

// Estimate request cost in USD from token counts.
function estimateCost(inputTokens, outputTokens) {
  const input = (inputTokens || 0) / 1e6 * HAIKU_PRICE_PER_MTOK.input;
  const output = (outputTokens || 0) / 1e6 * HAIKU_PRICE_PER_MTOK.output;
  return input + output;
}

// Get settings from storage, normalizing any legacy shape (pre-v2 settings had
// provider/model/openaiKey) onto the current defaults so old installs keep working.
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['settings'], (result) => {
      const saved = result.settings || {};
      resolve({
        claudeKey: saved.claudeKey || '',
        theme: saved.theme === 'light' ? 'light' : 'dark',
        trackUsage: saved.trackUsage !== false,
        answerStyle: saved.answerStyle === 'explain' ? 'explain' : 'answer',
        monthlyBudgetUsd: Number(saved.monthlyBudgetUsd) || 0
      });
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
