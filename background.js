// Chrome Problem Solver - Background Service Worker
// Handles AI API calls, decision tree logic, and prompt engineering

// Default settings
const DEFAULT_SETTINGS = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  openaiKey: '',
  claudeKey: '',
  temperature: 0.2
};

// OpenAI Models
const OPENAI_MODELS = {
  'gpt-4o-mini': { name: 'GPT-4o Mini', vision: false },
  'gpt-4o': { name: 'GPT-4o', vision: true },
  'gpt-4-turbo': { name: 'GPT-4 Turbo', vision: true }
};

// Claude Models
const CLAUDE_MODELS = {
  'claude-3-5-sonnet-20241022': { name: 'Claude 3.5 Sonnet', vision: true },
  'claude-3-5-haiku-20241022': { name: 'Claude 3.5 Haiku', vision: true },
  'claude-3-opus-20240229': { name: 'Claude 3 Opus', vision: true }
};

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

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'analyze') {
    handleAnalysis(request.data, sendResponse);
    return true; // Keep channel open for async response
  }
  if (request.action === 'analyzeStream') {
    handleAnalysisStream(request.data, sender.tab.id);
    return false; // No sendResponse used; let channel close
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
  const { isMath, isCode, isQuestion, isFillBlank, isCommand, isStatement, isLongText, wordCount } = contentType;
  
  let systemPrompt = 'You are a helpful AI assistant that provides accurate, concise answers. ';
  let userPrompt = '';
  
  if (isImage) {
    systemPrompt += 'Analyze the image and provide a detailed description. ';
    if (contentType.isMath || contentType.isCode) {
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

// Call OpenAI API
async function callOpenAI(text, contentType, imageData = null, conversationContext = []) {
  const settings = await getSettings();
  const apiKey = settings.openaiKey;
  const model = settings.model || 'gpt-4o-mini';
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  const { systemPrompt, userPrompt } = buildPrompt(text, contentType, !!imageData);
  const temperature = getTemperature(contentType);
  
  const messages = [
    { role: 'system', content: systemPrompt }
  ];
  
  // Add conversation context (previous messages)
  if (conversationContext && conversationContext.length > 0) {
    conversationContext.forEach(msg => {
      if (msg.role === 'user') {
        messages.push({
          role: 'user',
          content: msg.imageData ? [
            { type: 'text', text: msg.text },
            { type: 'image_url', image_url: { url: msg.imageData } }
          ] : msg.text
        });
      } else if (msg.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: msg.text
        });
      }
    });
  }
  
  // Add current user message
  const currentUserMessage = { role: 'user', content: [] };
  
  // Add text content
  if (userPrompt) {
    currentUserMessage.content.push({ type: 'text', text: userPrompt });
  }
  
  // Add image if present
  if (imageData) {
    currentUserMessage.content.push({
      type: 'image_url',
      image_url: { url: imageData }
    });
  }
  
  // If content is just an array, use it directly
  if (currentUserMessage.content.length === 0) {
    currentUserMessage.content = userPrompt || text;
  }
  
  messages.push(currentUserMessage);
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: temperature,
      max_tokens: 2000,
      stream: false
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API error');
  }
  
  const data = await response.json();
  return data.choices[0].message.content;
}

// Call OpenAI API with streaming
async function callOpenAIStream(text, contentType, imageData = null, conversationContext = [], tabId) {
  const settings = await getSettings();
  const apiKey = settings.openaiKey;
  const model = settings.model || 'gpt-4o-mini';
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }
  
  const { systemPrompt, userPrompt } = buildPrompt(text, contentType, !!imageData);
  const temperature = getTemperature(contentType);
  
  const messages = [
    { role: 'system', content: systemPrompt }
  ];
  
  // Add conversation context (previous messages)
  if (conversationContext && conversationContext.length > 0) {
    conversationContext.forEach(msg => {
      if (msg.role === 'user') {
        messages.push({
          role: 'user',
          content: msg.imageData ? [
            { type: 'text', text: msg.text },
            { type: 'image_url', image_url: { url: msg.imageData } }
          ] : msg.text
        });
      } else if (msg.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: msg.text
        });
      }
    });
  }
  
  // Add current user message
  const currentUserMessage = { role: 'user', content: [] };
  
  if (userPrompt) {
    currentUserMessage.content.push({ type: 'text', text: userPrompt });
  }
  
  if (imageData) {
    currentUserMessage.content.push({
      type: 'image_url',
      image_url: { url: imageData }
    });
  }
  
  if (currentUserMessage.content.length === 0) {
    currentUserMessage.content = userPrompt || text;
  }
  
  messages.push(currentUserMessage);
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: temperature,
      max_tokens: 2000,
      stream: true
    })
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'OpenAI API error' } }));
    throw new Error(error.error?.message || 'OpenAI API error');
  }
  
  // Stream the response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            // Send final message
            chrome.tabs.sendMessage(tabId, {
              action: 'streamComplete',
              fullResponse: fullResponse
            });
            return fullResponse;
          }
          
          try {
            const json = JSON.parse(data);
            const delta = json.choices[0]?.delta?.content || '';
            if (delta) {
              fullResponse += delta;
              chrome.tabs.sendMessage(tabId, {
                action: 'streamChunk',
                chunk: delta
              });
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return fullResponse;
}

// Call Claude API
async function callClaude(text, contentType, imageData = null, conversationContext = []) {
  const settings = await getSettings();
  const apiKey = settings.claudeKey;
  const model = settings.model || 'claude-3-5-sonnet-20241022';
  
  if (!apiKey) {
    throw new Error('Claude API key not configured');
  }
  
  const { systemPrompt, userPrompt } = buildPrompt(text, contentType, !!imageData);
  const temperature = getTemperature(contentType);
  
  const messages = [];
  
  // Add conversation context (previous messages)
  if (conversationContext && conversationContext.length > 0) {
    conversationContext.forEach(msg => {
      if (msg.role === 'user') {
        if (msg.imageData) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: msg.text },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: msg.imageData.split(',')[1] || msg.imageData
                }
              }
            ]
          });
        } else {
          messages.push({
            role: 'user',
            content: msg.text
          });
        }
      } else if (msg.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: msg.text
        });
      }
    });
  }
  
  // Add current user message
  if (imageData) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt || text },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: imageData.split(',')[1] || imageData
          }
        }
      ]
    });
  } else {
    messages.push({
      role: 'user',
      content: userPrompt || text
    });
  }
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model,
      system: systemPrompt,
      messages: messages,
      temperature: temperature,
      max_tokens: 2000
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Claude API error');
  }
  
  const data = await response.json();
  return data.content[0].text;
}

// Call Claude API with streaming
async function callClaudeStream(text, contentType, imageData = null, conversationContext = [], tabId) {
  const settings = await getSettings();
  const apiKey = settings.claudeKey;
  const model = settings.model || 'claude-3-5-sonnet-20241022';
  
  if (!apiKey) {
    throw new Error('Claude API key not configured');
  }
  
  const { systemPrompt, userPrompt } = buildPrompt(text, contentType, !!imageData);
  const temperature = getTemperature(contentType);
  
  const messages = [];
  
  // Add conversation context
  if (conversationContext && conversationContext.length > 0) {
    conversationContext.forEach(msg => {
      if (msg.role === 'user') {
        if (msg.imageData) {
          messages.push({
            role: 'user',
            content: [
              { type: 'text', text: msg.text },
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: msg.imageData.split(',')[1] || msg.imageData
                }
              }
            ]
          });
        } else {
          messages.push({
            role: 'user',
            content: msg.text
          });
        }
      } else if (msg.role === 'assistant') {
        messages.push({
          role: 'assistant',
          content: msg.text
        });
      }
    });
  }
  
  // Add current user message
  if (imageData) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt || text },
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: imageData.split(',')[1] || imageData
          }
        }
      ]
    });
  } else {
    messages.push({
      role: 'user',
      content: userPrompt || text
    });
  }
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: model,
      system: systemPrompt,
      messages: messages,
      temperature: temperature,
      max_tokens: 2000,
      stream: true
    })
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Claude API error' } }));
    throw new Error(error.error?.message || 'Claude API error');
  }
  
  // Stream the response
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullResponse = '';
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            chrome.tabs.sendMessage(tabId, {
              action: 'streamComplete',
              fullResponse: fullResponse
            });
            return fullResponse;
          }
          
          try {
            const json = JSON.parse(data);
            if (json.type === 'content_block_delta' && json.delta?.text) {
              const delta = json.delta.text;
              fullResponse += delta;
              chrome.tabs.sendMessage(tabId, {
                action: 'streamChunk',
                chunk: delta
              });
            } else if (json.type === 'message_stop') {
              chrome.tabs.sendMessage(tabId, {
                action: 'streamComplete',
                fullResponse: fullResponse
              });
              return fullResponse;
            }
          } catch (e) {
            // Skip invalid JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  
  return fullResponse;
}

// Handle analysis request
async function handleAnalysis(data, sendResponse) {
  try {
    const startTime = Date.now();
    const settings = await getSettings();
    const { text, imageData, conversationContext, isFollowUp } = data;
    
    // Analyze content type (only for first message, follow-ups use general)
    const contentType = isFollowUp 
      ? { isMath: false, isCode: false, isQuestion: true, isFillBlank: false, isCommand: false, isStatement: false, isLongText: false, wordCount: (text || '').split(/\s+/).length }
      : analyzeContentType(text || '');
    
    // Call appropriate API with conversation context
    let response;
    if (settings.provider === 'openai') {
      response = await callOpenAI(text, contentType, imageData, conversationContext);
    } else {
      response = await callClaude(text, contentType, imageData, conversationContext);
    }
    
    const responseTime = Date.now() - startTime;
    
    // Calculate confidence (simplified - could be enhanced)
    const confidence = calculateConfidence(response, contentType);
    
    // Track usage
    trackUsage({
      provider: settings.provider,
      model: settings.model,
      responseTime,
      success: true,
      contentType: contentType.isMath ? 'math' : contentType.isCode ? 'code' : 'text'
    });
    
    sendResponse({
      success: true,
      response: response,
      confidence: confidence,
      responseTime: responseTime
    });
  } catch (error) {
    const settings = await getSettings();
    trackUsage({
      provider: settings.provider,
      model: settings.model,
      success: false,
      error: error.message
    });
    
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

// Handle streaming analysis request
async function handleAnalysisStream(data, tabId) {
  try {
    const startTime = Date.now();
    const settings = await getSettings();
    const { text, imageData, conversationContext, isFollowUp } = data;
    
    // Analyze content type
    const contentType = isFollowUp 
      ? { isMath: false, isCode: false, isQuestion: true, isFillBlank: false, isCommand: false, isStatement: false, isLongText: false, wordCount: (text || '').split(/\s+/).length }
      : analyzeContentType(text || '');
    
    // Call appropriate API with streaming
    let fullResponse;
    if (settings.provider === 'openai') {
      fullResponse = await callOpenAIStream(text, contentType, imageData, conversationContext, tabId);
    } else {
      fullResponse = await callClaudeStream(text, contentType, imageData, conversationContext, tabId);
    }
    
    const responseTime = Date.now() - startTime;
    const confidence = calculateConfidence(fullResponse, contentType);
    
    // Track usage
    trackUsage({
      provider: settings.provider,
      model: settings.model,
      responseTime,
      success: true,
      contentType: contentType.isMath ? 'math' : contentType.isCode ? 'code' : 'text'
    });
    
    // Send final response with confidence
    chrome.tabs.sendMessage(tabId, {
      action: 'streamFinal',
      confidence: confidence,
      responseTime: responseTime,
      fullResponse: fullResponse
    });
  } catch (error) {
    const settings = await getSettings();
    trackUsage({
      provider: settings.provider,
      model: settings.model,
      success: false,
      error: error.message
    });
    
    chrome.tabs.sendMessage(tabId, {
      action: 'streamError',
      error: error.message
    });
  }
}

// Calculate confidence score (0-100)
function calculateConfidence(response, contentType) {
  let confidence = 70; // Base confidence
  
  // Increase confidence for math problems with clear answers
  if (contentType.isMath && /final answer|answer:\s*\d+/i.test(response)) {
    confidence = 90;
  }
  
  // Increase confidence for code analysis
  if (contentType.isCode && response.length > 100) {
    confidence = 85;
  }
  
  // Decrease confidence for very short responses to complex questions
  if (contentType.isLongText && response.length < 50) {
    confidence = 60;
  }
  
  // Ensure confidence is within bounds
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
    
    // Track by provider
    if (data.provider) {
      usage.byProvider[data.provider] = (usage.byProvider[data.provider] || 0) + 1;
    }
    
    // Track by model
    if (data.model) {
      usage.byModel[data.model] = (usage.byModel[data.model] || 0) + 1;
    }
    
    // Track by content type
    if (data.contentType) {
      usage.byContentType[data.contentType] = (usage.byContentType[data.contentType] || 0) + 1;
    }
    
    // Add to history (keep last 100)
    usage.history.push({
      timestamp: Date.now(),
      ...data
    });
    if (usage.history.length > 100) {
      usage.history.shift();
    }
    
    chrome.storage.local.set({ usage });
  });
}

// Handle command shortcut
chrome.commands.onCommand.addListener((command) => {
  if (command === 'analyze-selection' || command === 'welcome-bubble') {
    // Send message to active tab's content script (safely)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) return;

      // Only message tabs where content scripts are allowed
      const url = tab.url || '';
      const isAllowed = /^https?:\/\//.test(url) || /^file:\/\//.test(url);
      if (!isAllowed) {
        // Avoid noisy errors on chrome://, chrome web store, etc.
        return;
      }

      try {
        chrome.tabs.sendMessage(tab.id, { action: command }, (response) => {
          // Swallow the common MV3 error when no receiver exists on a page
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message || '';
            // These are expected errors when content script isn't available
            const isExpectedError = 
              errorMsg.includes('Could not establish connection') ||
              errorMsg.includes('Receiving end does not exist') ||
              errorMsg.includes('message port closed') ||
              errorMsg.includes('Extension context invalidated') ||
              errorMsg === '';
            
            if (!isExpectedError) {
              console.error('Command error:', errorMsg);
            }
          }
        });
      } catch (error) {
        console.error('Command exception:', error);
      }
    });
  }
});

// Toolbar icon click → analyze current selection
chrome.action?.onClicked.addListener((tab) => {
  if (!tab) return;
  const url = tab.url || '';
  const isAllowed = /^https?:\/\//.test(url) || /^file:\/\//.test(url);
  if (!isAllowed) return;
  try {
    chrome.tabs.sendMessage(tab.id, { action: 'analyze-selection' }, () => {
      // Ignore missing receiver errors
      void chrome.runtime.lastError;
    });
  } catch (_) {}
});

// Context menu click → analyze selection
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (!tab) return;
  const url = tab.url || '';
  const isAllowed = /^https?:\/\//.test(url) || /^file:\/\//.test(url);
  if (!isAllowed) return;
  try {
    chrome.tabs.sendMessage(tab.id, { 
      action: 'analyze-selection',
      selectionText: info.selectionText || null,
      srcUrl: info.srcUrl || null
    }, (response) => {
      if (chrome.runtime.lastError) {
        const errorMsg = chrome.runtime.lastError.message || '';
        // These are expected errors when content script isn't available
        const isExpectedError = 
          errorMsg.includes('Could not establish connection') ||
          errorMsg.includes('Receiving end does not exist') ||
          errorMsg.includes('message port closed') ||
          errorMsg.includes('Extension context invalidated') ||
          errorMsg === '';
        
        if (!isExpectedError) {
          console.error('Context menu error:', errorMsg);
        }
      }
    });
  } catch (error) {
    console.error('Context menu exception:', error);
  }
});
