// Chrome Problem Solver - Content Script
// Handles text/image selection, hotkey listeners, UI creation, and communication

let overlayWindow = null;
let isMinimized = false;
let conversationHistory = [];
let currentConversation = null;
let currentThread = null; // Current conversation thread with context
let overlayMode = 'analysis'; // 'bubble' or 'analysis'

// Initialize on page load
(function() {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

function init() {
  // Listen for Chrome command from background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'analyze-selection') {
      // If selection text or image URL is provided from context menu, use it
      if (request.selectionText || request.srcUrl) {
        handleSelectionWithData(request.selectionText || '', request.srcUrl || null);
      } else {
        handleSelection();
      }
      sendResponse({ success: true });
    } else if (request.action === 'welcome-bubble') {
      handleWelcomeBubbleHotkey();
      sendResponse({ success: true });
    }
    return true; // Keep channel open for async response
  });
  
  // In-page hotkey fallback
  document.addEventListener('keydown', handleHotkey);
  
  // Listen for selection changes
  document.addEventListener('mouseup', handleSelectionChange);
  document.addEventListener('keyup', handleSelectionChange);
}

// Handle hotkey (Alt+Shift+A — Option key on Mac, Alt+Shift+K for Welcome Bubble)
function handleHotkey(event) {
  // Don't trigger if user is typing in an input field
  const activeElement = document.activeElement;
  if (activeElement && (
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA' ||
    activeElement.isContentEditable
  )) {
    return;
  }
  
  const modifier = event.altKey;
  const shiftKey = event.shiftKey;
  const isKeyA = event.code === 'KeyA' || /^a$/i.test(event.key ?? '');
  const isKeyK = event.code === 'KeyK' || /^k$/i.test(event.key ?? '');
  
  // Handle Alt+Shift+A for analysis
  if (modifier && shiftKey && isKeyA) {
    event.preventDefault();
    handleSelection();
  }
  
  // Handle Alt+Shift+K for Welcome Bubble
  if (modifier && shiftKey && isKeyK) {
    event.preventDefault();
    handleWelcomeBubbleHotkey();
  }
}

// Handle selection change
function handleSelectionChange() {
  // This can be used for future enhancements like showing a hint
}

// Get selected text or image
function getSelection() {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  // Check for image selection
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  let imageData = null;
  
  if (range) {
    // Check if an image is selected
    const img = range.commonAncestorContainer.nodeType === 1 
      ? range.commonAncestorContainer.querySelector('img')
      : range.commonAncestorContainer.parentElement?.querySelector('img');
    
    if (img && img.src) {
      imageData = img.src;
    }
  }
  
  return { text: selectedText, imageData };
}

// Handle selection and trigger analysis
function handleSelection() {
  const { text, imageData } = getSelection();
  handleSelectionWithData(text, imageData);
}

// Handle selection with provided data (for context menu)
function handleSelectionWithData(text, imageData) {
  if (!text && !imageData) {
    // No selection, show message
    showOverlayWindow();
    displayMessage('Please select some text or an image to analyze.');
    return;
  }
  
  // Reset thread for new conversation
  currentThread = null;
  
  // Show overlay window
  showOverlayWindow();
  
  // Display loading state
  displayLoading();
  
  // Convert image to base64 if needed
  let processedImageData = imageData;
  if (imageData && !imageData.startsWith('data:')) {
    // Need to convert image URL to base64
    convertImageToBase64(imageData).then(base64 => {
      processedImageData = base64;
      sendAnalysisRequest(text || 'Analyze this image', processedImageData);
    }).catch(() => {
      // If conversion fails, try with original URL
      sendAnalysisRequest(text || 'Analyze this image', imageData);
    });
  } else {
    sendAnalysisRequest(text || 'Analyze this image', processedImageData);
  }
}

// Convert image URL to base64
function convertImageToBase64(imageUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      try {
        const base64 = canvas.toDataURL('image/png');
        resolve(base64);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
}

// Send analysis request to background script (with streaming)
function sendAnalysisRequest(text, imageData = null, isFollowUp = false) {
  // Initialize new thread if this is the first message
  if (!isFollowUp && !currentThread) {
    currentThread = {
      id: Date.now(),
      messages: [],
      timestamp: Date.now()
    };
  }
  
  // Add user message to thread
  if (currentThread) {
    currentThread.messages.push({
      role: 'user',
      text: text,
      imageData: imageData,
      timestamp: Date.now()
    });
  }
  
  // Get conversation history for context
  const conversationContext = currentThread ? currentThread.messages.slice(0, -1) : [];
  
  // Initialize streaming response
  let streamedResponse = '';
  const responseArea = overlayWindow.querySelector('.cps-response-area');
  
  // Clear response area and show initial state
  if (currentThread && currentThread.messages.length >= 2) {
    // Show conversation thread so far
    let threadHTML = '<div class="cps-conversation-thread">';
    currentThread.messages.slice(0, -1).forEach((msg) => {
      if (msg.role === 'user') {
        threadHTML += `
          <div class="cps-message cps-user-message">
            <div class="cps-message-content">${formatResponse(msg.text || '')}</div>
          </div>
        `;
      } else if (msg.role === 'assistant') {
        threadHTML += `
          <div class="cps-message cps-assistant-message">
            <div class="cps-message-content">${formatResponse(msg.text || '')}</div>
            ${msg.confidence ? `<div class="cps-message-confidence">Confidence: ${Math.round(msg.confidence)}%</div>` : ''}
          </div>
        `;
      }
    });
    // Add streaming message placeholder
    threadHTML += `
      <div class="cps-message cps-assistant-message cps-streaming">
        <div class="cps-message-content" id="streaming-content"></div>
      </div>
    `;
    threadHTML += '</div>';
    responseArea.innerHTML = threadHTML;
  } else {
    // Single response with streaming
    responseArea.innerHTML = '<div class="cps-response" id="streaming-content"></div>';
  }
  
  const streamingContent = responseArea.querySelector('#streaming-content');
  
  // Set up message listener for streaming
  const messageListener = (request, sender, sendResponse) => {
    if (request.action === 'streamChunk') {
      streamedResponse += request.chunk;
      if (streamingContent) {
        streamingContent.innerHTML = formatResponse(streamedResponse);
        // Auto-scroll to bottom
        responseArea.scrollTop = responseArea.scrollHeight;
      }
    } else if (request.action === 'streamComplete' || request.action === 'streamFinal') {
      // Remove streaming class
      const streamingMsg = responseArea.querySelector('.cps-streaming');
      if (streamingMsg) {
        streamingMsg.classList.remove('cps-streaming');
      }
      
      const finalResponse = request.fullResponse || streamedResponse;
      const confidence = request.confidence || 70;
      const responseTime = request.responseTime || 0;
      
      // Update final response
      if (streamingContent) {
        streamingContent.innerHTML = formatResponse(finalResponse);
      }
      
      // Add AI response to thread
      if (currentThread) {
        currentThread.messages.push({
          role: 'assistant',
          text: finalResponse,
          confidence: confidence,
          timestamp: Date.now()
        });
      }
      
      // Show and update confidence indicator
      const confidenceSection = overlayWindow.querySelector('.cps-confidence');
      if (confidenceSection) {
        confidenceSection.style.display = 'block';
      }
      updateConfidence(confidence);
      
      // Save to conversation history
      if (!isFollowUp) {
        addToHistory({
          text,
          response: finalResponse,
          confidence: confidence,
          timestamp: Date.now(),
          threadId: currentThread?.id
        });
      } else {
        updateHistoryThread(currentThread);
      }
      
      // Clear follow-up input
      const followUpInput = overlayWindow.querySelector('.cps-followup-input');
      if (followUpInput) {
        followUpInput.value = '';
        updateWordCount();
      }
      
      // Remove message listener
      chrome.runtime.onMessage.removeListener(messageListener);
    } else if (request.action === 'streamError') {
      displayError(request.error);
      chrome.runtime.onMessage.removeListener(messageListener);
    }
  };
  
  chrome.runtime.onMessage.addListener(messageListener);
  
  // Send streaming request
  chrome.runtime.sendMessage({
    action: 'analyzeStream',
    data: { 
      text, 
      imageData,
      conversationContext: conversationContext,
      isFollowUp: isFollowUp
    }
  });
}

// Show overlay window
function showOverlayWindow() {
  if (!overlayWindow) {
    createOverlayWindow('analysis');
  }
  
  // Ensure we're in analysis mode
  if (overlayMode !== 'analysis') {
    morphToAnalysisMode();
  }
  
  // Remove hidden and minimized classes to show the window
  overlayWindow.classList.remove('hidden');
  overlayWindow.classList.remove('minimized');
  isMinimized = false;
  
  // Restore size/position from storage
  restoreWindowState();
}

// Create overlay window
function createOverlayWindow(mode = 'analysis') {
  overlayWindow = document.createElement('div');
  overlayWindow.id = 'chrome-problem-solver-overlay';
  overlayMode = mode;
  overlayWindow.className = `cps-mode-${mode}`;
  
  if (mode === 'bubble') {
    overlayWindow.innerHTML = `
      <div class="cps-header">
        <div class="cps-title">Welcome to ProblemSolver ✨</div>
        <div class="cps-controls">
          <button class="cps-btn cps-close" title="Close">×</button>
        </div>
      </div>
      <div class="cps-bubble-content">
        <div class="cps-bubble-input-wrapper">
          <input 
            type="text" 
            class="cps-bubble-input" 
            placeholder="search anything!"
            id="bubble-text-input"
          />
          <button class="cps-bubble-go-btn" id="bubble-go-btn">Go</button>
        </div>
        <button class="cps-bubble-upload-btn" id="bubble-upload-btn">Upload image</button>
        <input type="file" accept="image/*" id="bubble-file-input" style="display: none;" />
        <div class="cps-bubble-dropzone" id="bubble-dropzone">
          Drag & drop an image to analyze instantly
        </div>
      </div>
    `;
    
    document.body.appendChild(overlayWindow);
    setupWindowControls();
    setupWelcomeBubbleDragDrop();
    setupWelcomeBubbleSubmit();
  } else {
    overlayWindow.innerHTML = `
      <div class="cps-header">
        <div class="cps-title">Chrome Problem Solver</div>
        <div class="cps-controls">
          <button class="cps-btn cps-minimize" title="Minimize">−</button>
          <button class="cps-btn cps-close" title="Close">×</button>
        </div>
      </div>
      <div class="cps-tabs">
        <button class="cps-tab active" data-tab="main">Analysis</button>
        <button class="cps-tab" data-tab="history">History</button>
      </div>
      <div class="cps-content">
        <div class="cps-tab-content active" data-content="main">
          <div class="cps-response-area"></div>
          <div class="cps-confidence">
            <div class="cps-confidence-label">Confidence</div>
            <div class="cps-confidence-bar">
              <div class="cps-confidence-fill"></div>
            </div>
            <div class="cps-confidence-percentage">0%</div>
          </div>
          <div class="cps-followup">
            <div class="cps-followup-input-wrapper">
              <textarea 
                class="cps-followup-input" 
                placeholder="Ask a follow up or clarification!"
                maxlength="500"
                rows="2"
              ></textarea>
              <div class="cps-word-count">0/50 words</div>
            </div>
            <button class="cps-send-btn" id="send-followup">Send</button>
          </div>
          <div class="cps-feedback">
            <button class="cps-feedback-btn cps-like" title="Like">👍</button>
            <button class="cps-feedback-btn cps-dislike" title="Dislike">👎</button>
          </div>
        </div>
        <div class="cps-tab-content" data-content="history">
          <div class="cps-history-list"></div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlayWindow);
    setupWindowControls();
    setupTabs();
    setupFeedback();
    setupFollowUp();
  }
}

// Setup window controls
function setupWindowControls() {
  const minimizeBtn = overlayWindow.querySelector('.cps-minimize');
  const closeBtn = overlayWindow.querySelector('.cps-close');
  
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isMinimized) {
      overlayWindow.classList.remove('minimized');
      isMinimized = false;
    } else {
      overlayWindow.classList.add('minimized');
      isMinimized = true;
    }
    saveWindowState();
  });
  
  closeBtn.addEventListener('click', () => {
    overlayWindow.classList.add('hidden');
    saveWindowState();
  });
}

// Setup tabs
function setupTabs() {
  const tabs = overlayWindow.querySelectorAll('.cps-tab');
  const contents = overlayWindow.querySelectorAll('.cps-tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      // Update active states
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      overlayWindow.querySelector(`[data-content="${targetTab}"]`).classList.add('active');
      
      // Load history if switching to history tab
      if (targetTab === 'history') {
        loadHistory();
      }
    });
  });
}

// Setup feedback buttons
function setupFeedback() {
  const likeBtn = overlayWindow.querySelector('.cps-like');
  const dislikeBtn = overlayWindow.querySelector('.cps-dislike');
  
  likeBtn.addEventListener('click', () => {
    saveFeedback('like');
    likeBtn.classList.add('active');
    setTimeout(() => likeBtn.classList.remove('active'), 1000);
  });
  
  dislikeBtn.addEventListener('click', () => {
    showFeedbackModal();
  });
}

// Setup follow-up input
function setupFollowUp() {
  const followUpInput = overlayWindow.querySelector('.cps-followup-input');
  const sendBtn = overlayWindow.querySelector('#send-followup');
  
  if (!followUpInput || !sendBtn) return;
  
  // Word count update
  followUpInput.addEventListener('input', () => {
    updateWordCount();
  });
  
  // Send on Enter (but allow Shift+Enter for new line)
  followUpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFollowUp();
    }
  });
  
  // Send button click
  sendBtn.addEventListener('click', () => {
    sendFollowUp();
  });
}

// Update word count
function updateWordCount() {
  const followUpInput = overlayWindow.querySelector('.cps-followup-input');
  const wordCountEl = overlayWindow.querySelector('.cps-word-count');
  
  if (!followUpInput || !wordCountEl) return;
  
  const text = followUpInput.value.trim();
  const words = text.split(/\s+/).filter(word => word.length > 0);
  const wordCount = words.length;
  const maxWords = 50;
  
  wordCountEl.textContent = `${wordCount}/${maxWords} words`;
  
  // Update styling based on word count
  if (wordCount > maxWords) {
    wordCountEl.classList.add('over-limit');
    followUpInput.classList.add('over-limit');
  } else {
    wordCountEl.classList.remove('over-limit');
    followUpInput.classList.remove('over-limit');
  }
}

// Send follow-up message
function sendFollowUp() {
  const followUpInput = overlayWindow.querySelector('.cps-followup-input');
  if (!followUpInput) return;
  
  const text = followUpInput.value.trim();
  if (!text) return;
  
  // Check word count
  const words = text.split(/\s+/).filter(word => word.length > 0);
  if (words.length > 50) {
    alert('Please limit your follow-up to 50 words or less.');
    return;
  }
  
  // Check if we have an active conversation
  if (!currentThread || currentThread.messages.length === 0) {
    alert('Please start a conversation first by analyzing some content.');
    return;
  }
  
  // Display loading
  displayLoading();
  
  // Send follow-up request
  sendAnalysisRequest(text, null, true);
}

// Show feedback modal
function showFeedbackModal() {
  const modal = document.createElement('div');
  modal.className = 'cps-modal';
  modal.innerHTML = `
    <div class="cps-modal-content">
      <div class="cps-modal-header">
        <h3>Provide Feedback</h3>
        <button class="cps-modal-close">×</button>
      </div>
      <div class="cps-modal-body">
        <p>What could be improved?</p>
        <textarea class="cps-feedback-input" placeholder="Enter your feedback..." maxlength="500"></textarea>
      </div>
      <div class="cps-modal-footer">
        <button class="cps-btn cps-btn-secondary cps-modal-cancel">Cancel</button>
        <button class="cps-btn cps-btn-primary cps-modal-submit">Submit</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const closeModal = () => {
    modal.remove();
  };
  
  modal.querySelector('.cps-modal-close').addEventListener('click', closeModal);
  modal.querySelector('.cps-modal-cancel').addEventListener('click', closeModal);
  modal.querySelector('.cps-modal-submit').addEventListener('click', () => {
    const feedback = modal.querySelector('.cps-feedback-input').value;
    if (feedback.trim()) {
      saveFeedback('dislike', feedback);
    }
    closeModal();
  });
  
  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
}

// Save feedback
function saveFeedback(type, comment = '') {
  const feedback = {
    type,
    comment,
    timestamp: Date.now(),
    conversationId: currentConversation?.timestamp || Date.now()
  };
  
  chrome.storage.local.get(['feedback'], (result) => {
    const feedbackList = result.feedback || [];
    feedbackList.push(feedback);
    chrome.storage.local.set({ feedback: feedbackList });
  });
}

// Display loading state
function displayLoading() {
  // Ensure we're in analysis mode
  if (overlayMode !== 'analysis' && overlayWindow) {
    morphToAnalysisMode();
  }
  
  const responseArea = overlayWindow?.querySelector('.cps-response-area');
  const confidenceSection = overlayWindow?.querySelector('.cps-confidence');
  
  if (!responseArea) return;
  
  responseArea.innerHTML = `
    <div class="cps-loading">
      <div class="cps-typing-indicator">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <p>Analyzing...</p>
    </div>
  `;
  
  // Hide confidence indicator during loading
  if (confidenceSection) {
    confidenceSection.style.display = 'none';
  }
  
  // Switch to main tab
  const mainTab = overlayWindow.querySelector('[data-tab="main"]');
  if (mainTab) {
    mainTab.click();
  }
}

// Display response
function displayResponse(response, confidence, responseTime, isFollowUp = false) {
  const responseArea = overlayWindow.querySelector('.cps-response-area');
  
  // Display full conversation thread if we have multiple messages
  if (currentThread && currentThread.messages.length >= 2) {
    let threadHTML = '<div class="cps-conversation-thread">';
    
    currentThread.messages.forEach((msg, index) => {
      if (msg.role === 'user') {
        threadHTML += `
          <div class="cps-message cps-user-message">
            <div class="cps-message-content">${formatResponse(msg.text || '')}</div>
          </div>
        `;
      } else if (msg.role === 'assistant') {
        threadHTML += `
          <div class="cps-message cps-assistant-message">
            <div class="cps-message-content">${formatResponse(msg.text || '')}</div>
            ${msg.confidence ? `<div class="cps-message-confidence">Confidence: ${Math.round(msg.confidence)}%</div>` : ''}
          </div>
        `;
      }
    });
    
    threadHTML += '</div>';
    responseArea.innerHTML = threadHTML;
  } else {
    // Display single response
    responseArea.innerHTML = `<div class="cps-response">${formatResponse(response)}</div>`;
  }
  
  // Show and update confidence indicator
  const confidenceSection = overlayWindow.querySelector('.cps-confidence');
  if (confidenceSection) {
    confidenceSection.style.display = 'block';
  }
  updateConfidence(confidence);
  
  // Store current conversation
  currentConversation = {
    response,
    confidence,
    responseTime,
    timestamp: Date.now()
  };
  
  // Scroll to bottom
  responseArea.scrollTop = responseArea.scrollHeight;
}

// Format response text
function formatResponse(text) {
  // Clean up LaTeX markup characters
  let cleaned = text
    // Remove inline math delimiters \( and \)
    .replace(/\\\(/g, '')
    .replace(/\\\)/g, '')
    // Remove display math delimiters \[ and \]
    .replace(/\\\[/g, '')
    .replace(/\\\]/g, '')
    // Remove dollar sign math delimiters (display math: $$...$$)
    .replace(/\$\$([^$]+)\$\$/g, '$1')
    // Remove common LaTeX text formatting commands (convert to HTML)
    .replace(/\\textbf\{([^}]+)\}/g, '<strong>$1</strong>')
    .replace(/\\textit\{([^}]+)\}/g, '<em>$1</em>')
    .replace(/\\texttt\{([^}]+)\}/g, '<code>$1</code>')
    .replace(/\\text\{([^}]+)\}/g, '$1')
    // Remove other common LaTeX commands (extract content from braces)
    .replace(/\\[a-zA-Z]+\{([^}]+)\}/g, '$1')
    // Clean up escaped special characters
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\#/g, '#')
    .replace(/\\\$/g, '$')
    .replace(/\\_/g, '_')
    .replace(/\\\{/g, '{')
    .replace(/\\\}/g, '}')
    // Remove standalone backslashes that might be LaTeX remnants
    .replace(/\\([^a-zA-Z{}_^$&#%])/g, '$1');
  
  // Basic formatting - preserve line breaks and basic markdown
  return cleaned
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>');
}

// Display error
function displayError(error) {
  const responseArea = overlayWindow.querySelector('.cps-response-area');
  responseArea.innerHTML = `<div class="cps-error">Error: ${error}</div>`;
  updateConfidence(0);
}

// Display message
function displayMessage(message) {
  const responseArea = overlayWindow.querySelector('.cps-response-area');
  responseArea.innerHTML = `<div class="cps-message">${message}</div>`;
}

// Update confidence indicator
function updateConfidence(confidence) {
  const fill = overlayWindow.querySelector('.cps-confidence-fill');
  const percentage = overlayWindow.querySelector('.cps-confidence-percentage');
  
  fill.style.width = `${confidence}%`;
  percentage.textContent = `${Math.round(confidence)}%`;
  
  // Update color based on confidence
  if (confidence >= 80) {
    fill.style.backgroundColor = '#4caf50';
  } else if (confidence >= 60) {
    fill.style.backgroundColor = '#ff9800';
  } else {
    fill.style.backgroundColor = '#f44336';
  }
}

// Add to conversation history
function addToHistory(conversation) {
  // Include thread if available
  if (currentThread) {
    conversation.thread = currentThread;
  }
  
  conversationHistory.unshift(conversation);
  if (conversationHistory.length > 50) {
    conversationHistory.pop();
  }
  
  // Save to storage
  chrome.storage.local.set({ conversationHistory });
}

// Update history thread
function updateHistoryThread(thread) {
  chrome.storage.local.get(['conversationHistory'], (result) => {
    const history = result.conversationHistory || [];
    
    // Find the history entry with matching threadId
    const index = history.findIndex(item => item.threadId === thread.id);
    if (index !== -1) {
      history[index].thread = thread;
      chrome.storage.local.set({ conversationHistory: history });
    }
  });
}

// Load history
function loadHistory() {
  chrome.storage.local.get(['conversationHistory'], (result) => {
    const history = result.conversationHistory || [];
    const historyList = overlayWindow.querySelector('.cps-history-list');
    
    if (history.length === 0) {
      historyList.innerHTML = '<div class="cps-empty">No conversation history</div>';
      return;
    }
    
    historyList.innerHTML = history.map((item, index) => {
      const date = new Date(item.timestamp);
      return `
        <div class="cps-history-item" data-index="${index}">
          <div class="cps-history-header">
            <span class="cps-history-time">${date.toLocaleString()}</span>
            <span class="cps-history-confidence">${Math.round(item.confidence)}%</span>
          </div>
          <div class="cps-history-text">${item.text.substring(0, 100)}${item.text.length > 100 ? '...' : ''}</div>
        </div>
      `;
    }).join('');
    
    // Add click handlers
    historyList.querySelectorAll('.cps-history-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index);
        displayHistoryItem(history[index]);
      });
    });
  });
}

// Display history item
function displayHistoryItem(item) {
  // Restore thread if available
  if (item.thread) {
    currentThread = item.thread;
    // Display full thread
    const responseArea = overlayWindow.querySelector('.cps-response-area');
    let threadHTML = '<div class="cps-conversation-thread">';
    
    currentThread.messages.forEach((msg) => {
      if (msg.role === 'user') {
        threadHTML += `
          <div class="cps-message cps-user-message">
            <div class="cps-message-content">${formatResponse(msg.text || '')}</div>
          </div>
        `;
      } else if (msg.role === 'assistant') {
        threadHTML += `
          <div class="cps-message cps-assistant-message">
            <div class="cps-message-content">${formatResponse(msg.text || '')}</div>
            ${msg.confidence ? `<div class="cps-message-confidence">Confidence: ${Math.round(msg.confidence)}%</div>` : ''}
          </div>
        `;
      }
    });
    
    threadHTML += '</div>';
    responseArea.innerHTML = threadHTML;
    updateConfidence(item.confidence);
  } else {
    displayResponse(item.response, item.confidence, item.responseTime);
  }
  
  overlayWindow.querySelector('[data-tab="main"]').click();
}

// Show Welcome Bubble
function showWelcomeBubble() {
  if (!overlayWindow) {
    createOverlayWindow('bubble');
  } else {
    // Morph existing overlay to bubble mode
    morphToBubbleMode();
  }
  
  // Remove hidden and minimized classes to show the window
  overlayWindow.classList.remove('hidden');
  overlayWindow.classList.remove('minimized');
  isMinimized = false;
  
  // Restore size/position from storage
  restoreWindowState();
}

// Handle Welcome Bubble hotkey
function handleWelcomeBubbleHotkey() {
  showWelcomeBubble();
}

// Morph overlay to bubble mode
function morphToBubbleMode() {
  if (!overlayWindow) return;
  
  overlayMode = 'bubble';
  overlayWindow.className = 'cps-mode-bubble';
  overlayWindow.innerHTML = `
    <div class="cps-header">
      <div class="cps-title">Welcome to ProblemSolver ✨</div>
      <div class="cps-controls">
        <button class="cps-btn cps-close" title="Close">×</button>
      </div>
    </div>
    <div class="cps-bubble-content">
      <div class="cps-bubble-input-wrapper">
        <input 
          type="text" 
          class="cps-bubble-input" 
          placeholder="search anything!"
          id="bubble-text-input"
        />
        <button class="cps-bubble-go-btn" id="bubble-go-btn">Go</button>
      </div>
      <button class="cps-bubble-upload-btn" id="bubble-upload-btn">Upload image</button>
      <input type="file" accept="image/*" id="bubble-file-input" style="display: none;" />
      <div class="cps-bubble-dropzone" id="bubble-dropzone">
        Drag & drop an image to analyze instantly
      </div>
    </div>
  `;
  
  setupWindowControls();
  setupWelcomeBubbleDragDrop();
  setupWelcomeBubbleSubmit();
}

// Morph overlay to analysis mode
function morphToAnalysisMode() {
  if (!overlayWindow) return;
  
  overlayMode = 'analysis';
  overlayWindow.className = 'cps-mode-analysis';
  overlayWindow.innerHTML = `
    <div class="cps-header">
      <div class="cps-title">Chrome Problem Solver</div>
      <div class="cps-controls">
        <button class="cps-btn cps-minimize" title="Minimize">−</button>
        <button class="cps-btn cps-close" title="Close">×</button>
      </div>
    </div>
    <div class="cps-tabs">
      <button class="cps-tab active" data-tab="main">Analysis</button>
      <button class="cps-tab" data-tab="history">History</button>
    </div>
    <div class="cps-content">
      <div class="cps-tab-content active" data-content="main">
        <div class="cps-response-area"></div>
        <div class="cps-confidence">
          <div class="cps-confidence-label">Confidence</div>
          <div class="cps-confidence-bar">
            <div class="cps-confidence-fill"></div>
          </div>
          <div class="cps-confidence-percentage">0%</div>
        </div>
        <div class="cps-followup">
          <div class="cps-followup-input-wrapper">
            <textarea 
              class="cps-followup-input" 
              placeholder="Ask a follow up or clarification!"
              maxlength="500"
              rows="2"
            ></textarea>
            <div class="cps-word-count">0/50 words</div>
          </div>
          <button class="cps-send-btn" id="send-followup">Send</button>
        </div>
        <div class="cps-feedback">
          <button class="cps-feedback-btn cps-like" title="Like">👍</button>
          <button class="cps-feedback-btn cps-dislike" title="Dislike">👎</button>
        </div>
      </div>
      <div class="cps-tab-content" data-content="history">
        <div class="cps-history-list"></div>
      </div>
    </div>
  `;
  
  setupWindowControls();
  setupTabs();
  setupFeedback();
  setupFollowUp();
}

// Setup Welcome Bubble drag & drop
function setupWelcomeBubbleDragDrop() {
  const dropzone = overlayWindow.querySelector('#bubble-dropzone');
  const fileInput = overlayWindow.querySelector('#bubble-file-input');
  
  if (!dropzone) return;
  
  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });
  
  // Highlight drop zone on drag enter/over
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => {
      dropzone.classList.add('cps-drag-active');
    });
  });
  
  // Remove highlight on drag leave
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('cps-drag-active');
  });
  
  // Handle file drop
  dropzone.addEventListener('drop', (e) => {
    dropzone.classList.remove('cps-drag-active');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleImageFile(files[0]);
    }
  });
  
  // Click on dropzone to trigger file input
  dropzone.addEventListener('click', () => {
    fileInput.click();
  });
  
  // Handle file input change
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleImageFile(e.target.files[0]);
      }
    });
  }
}

// Setup Welcome Bubble submit handlers
function setupWelcomeBubbleSubmit() {
  const textInput = overlayWindow.querySelector('#bubble-text-input');
  const goBtn = overlayWindow.querySelector('#bubble-go-btn');
  const uploadBtn = overlayWindow.querySelector('#bubble-upload-btn');
  const fileInput = overlayWindow.querySelector('#bubble-file-input');
  
  // Go button click
  if (goBtn) {
    goBtn.addEventListener('click', () => {
      handleWelcomeBubbleSubmit();
    });
  }
  
  // Enter key in text input
  if (textInput) {
    textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleWelcomeBubbleSubmit();
      }
    });
  }
  
  // Upload button click
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => {
      fileInput.click();
    });
  }
}

// Handle Welcome Bubble submission
function handleWelcomeBubbleSubmit(text = null, imageData = null) {
  const textInput = overlayWindow.querySelector('#bubble-text-input');
  const inputText = text || (textInput ? textInput.value.trim() : '');
  
  if (!inputText && !imageData) {
    // No input provided
    return;
  }
  
  // Reset thread for new conversation
  currentThread = null;
  
  // Morph to analysis mode
  morphToAnalysisMode();
  
  // Display loading state
  displayLoading();
  
  // Process image if provided
  if (imageData) {
    if (typeof imageData === 'string' && !imageData.startsWith('data:')) {
      // Convert image URL to base64
      convertImageToBase64(imageData).then(base64 => {
        sendAnalysisRequest(inputText || 'Analyze this image', base64);
      }).catch(() => {
        sendAnalysisRequest(inputText || 'Analyze this image', imageData);
      });
    } else {
      sendAnalysisRequest(inputText || 'Analyze this image', imageData);
    }
  } else {
    sendAnalysisRequest(inputText);
  }
}

// Handle image file
function handleImageFile(file) {
  // Check if it's an image
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    return;
  }
  
  // Convert file to base64
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    handleWelcomeBubbleSubmit(null, base64);
  };
  reader.onerror = () => {
    alert('Error reading image file.');
  };
  reader.readAsDataURL(file);
}

// Save window state
function saveWindowState() {
  if (!overlayWindow) return;
  
  const state = {
    minimized: isMinimized
  };
  
  chrome.storage.local.set({ windowState: state });
}

// Restore window state
function restoreWindowState() {
  chrome.storage.local.get(['windowState'], (result) => {
    if (result.windowState && overlayWindow) {
      const state = result.windowState;
      isMinimized = state.minimized || false;
      
      if (isMinimized) {
        overlayWindow.classList.add('minimized');
      }
    }
  });
}
