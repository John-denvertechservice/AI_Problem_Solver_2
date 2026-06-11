// AI Problem Solver - Content Script
// Handles text/image selection, hotkey listeners, UI creation, and communication

let overlayWindow = null;
let isMinimized = false;
let conversationHistory = [];
let currentConversation = null;
let currentThread = null; // Current conversation thread with context
let overlayMode = 'analysis'; // 'bubble' or 'analysis'
let activeRequestId = null;      // id of the in-flight streaming request, if any
let activeStreamListener = null; // its chrome.runtime.onMessage listener
let lastResponseText = '';       // raw markdown of the latest answer (for Copy)
let lastFollowUpText = '';       // last follow-up the user sent (for ↑ recall)
let currentTheme = 'dark';       // 'dark' | 'light' — persisted in settings.theme
let currentAnswerStyle = 'answer'; // 'answer' | 'explain' — persisted in settings.answerStyle

// Unique id per streaming request so chunks/finals from one request can never
// be applied to another (overlapping requests previously interleaved).
function makeRequestId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// Minimum overlay size (px) when dragging/resizing.
const CPS_MIN_W = 320;
const CPS_MIN_H = 300;
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// ── Theme (dark / light) ─────────────────────────────────────────────────────
// The palette lives in CSS variables; switching is just a data-theme attribute on
// the overlay (and the feedback modal, which lives outside it). Choice persists in
// chrome.storage.sync so it follows the user and stays in sync with the options page.
function applyTheme(theme) {
  currentTheme = theme === 'light' ? 'light' : 'dark';
  if (overlayWindow) overlayWindow.dataset.theme = currentTheme;
  document.querySelectorAll('.cps-modal').forEach((m) => { m.dataset.theme = currentTheme; });
  updateThemeButton();
}

function updateThemeButton() {
  if (!overlayWindow) return;
  const btn = overlayWindow.querySelector('.cps-theme-toggle');
  if (!btn) return;
  const goingLight = currentTheme === 'dark';
  btn.textContent = goingLight ? '☀️' : '🌙';
  btn.title = goingLight ? 'Switch to light theme' : 'Switch to dark theme';
}

function setTheme(theme) {
  applyTheme(theme);
  chrome.storage.sync.get(['settings'], (r) => {
    const settings = r.settings || {};
    settings.theme = currentTheme;
    chrome.storage.sync.set({ settings });
  });
}

function loadTheme() {
  chrome.storage.sync.get(['settings'], (r) => {
    applyTheme(r.settings && r.settings.theme === 'light' ? 'light' : 'dark');
  });
}

// ── Answer style (just-the-answer / concept-explainer) ───────────────────────
// Persisted in settings.answerStyle and read by background.js when building the
// prompt. The overlay selector and the options page stay in sync via storage.
function applyAnswerStyle(style) {
  currentAnswerStyle = style === 'explain' ? 'explain' : 'answer';
  const select = overlayWindow && overlayWindow.querySelector('.cps-style-select');
  if (select && select.value !== currentAnswerStyle) select.value = currentAnswerStyle;
}

function setAnswerStyle(style) {
  applyAnswerStyle(style);
  chrome.storage.sync.get(['settings'], (r) => {
    const settings = r.settings || {};
    settings.answerStyle = currentAnswerStyle;
    chrome.storage.sync.set({ settings });
  });
}

function loadAnswerStyle() {
  chrome.storage.sync.get(['settings'], (r) => {
    applyAnswerStyle(r.settings && r.settings.answerStyle === 'explain' ? 'explain' : 'answer');
  });
}

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
  console.log("[CPS] content script loaded:", location.href);
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
      return true; // Keep channel open for async response
    } else if (request.action === 'welcome-bubble') {
      handleWelcomeBubbleHotkey();
      sendResponse({ success: true });
      return true; // Keep channel open for async response
    }
    // Don't return true for unhandled messages - let other listeners handle them
    return false;
  });
  
  // In-page hotkey fallback
  document.addEventListener('keydown', handleHotkey);

  // Load saved theme + answer style, and keep them live if changed elsewhere
  // (options page, or the overlay in another tab).
  loadTheme();
  loadAnswerStyle();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      const next = changes.settings.newValue || {};
      if (next.theme && next.theme !== currentTheme) applyTheme(next.theme);
      if (next.answerStyle && next.answerStyle !== currentAnswerStyle) applyAnswerStyle(next.answerStyle);
    }
  });
}

// Handle hotkey (Alt+Shift+A — Option key on Mac, Alt+Shift+K for Welcome Bubble)
function handleHotkey(event) {
  const activeElement = document.activeElement;

  // Escape closes the overlay when it (or one of its inputs) holds focus — works
  // even while typing, but won't hijack Escape elsewhere on the page.
  if (event.key === 'Escape' && overlayWindow && !overlayWindow.classList.contains('hidden')
      && overlayWindow.contains(activeElement)) {
    event.preventDefault();
    overlayWindow.classList.add('hidden');
    saveWindowState();
    return;
  }

  // Don't trigger the analyze/welcome hotkeys while typing in an input field.
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

// Get selected text or image
function getCurrentSelection() {
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
  const { text, imageData } = getCurrentSelection();
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

  // Supersede any in-flight request: detach its listener and abort its fetch so
  // overlapping streams can't interleave their chunks into this one.
  if (activeStreamListener) {
    chrome.runtime.onMessage.removeListener(activeStreamListener);
    activeStreamListener = null;
  }
  if (activeRequestId) {
    chrome.runtime.sendMessage({ action: 'abortStream', requestId: activeRequestId });
  }
  const requestId = makeRequestId();
  activeRequestId = requestId;

  // Streaming is starting — show a Stop control, hide post-answer actions.
  showStreamingActions();

  // Initialize streaming response
  let streamedResponse = '';
  const responseArea = overlayWindow.querySelector('.cps-response-area');
  
  // Clear response area and show initial state
  if (currentThread && currentThread.messages.length >= 2) {
    // Show conversation thread so far, with a placeholder for the streaming reply.
    responseArea.innerHTML = renderThread(currentThread.messages.slice(0, -1), { streamingPlaceholder: true });
    // Render code/math in the already-complete prior messages.
    enhanceElement(responseArea);
  } else {
    // Single response with streaming
    responseArea.innerHTML = '<div class="cps-response" id="streaming-content"></div>';
  }

  const streamingContent = responseArea.querySelector('#streaming-content');
  // During streaming we append raw text (pre-wrap preserves newlines/indent);
  // the final render swaps in formatted markdown and resets this.
  if (streamingContent) streamingContent.style.whiteSpace = 'pre-wrap';

  // Throttle state for incremental markdown rendering during streaming.
  let lastRenderAt = 0;
  let renderedOnce = false;

  // Set up message listener for streaming
  const messageListener = (request, sender, sendResponse) => {
    // Ignore anything belonging to a different (e.g. superseded) request.
    if (request.requestId && request.requestId !== requestId) return;
    if (request.action === 'streamChunk') {
      streamedResponse += request.chunk;
      if (streamingContent) {
        const nowTs = Date.now();
        // Re-render markdown at most ~4×/sec, and only when not mid-formula or
        // mid-code-fence (rendering an unclosed $$ or ``` would garble output).
        if (nowTs - lastRenderAt > 250 && streamRenderSafe(streamedResponse)) {
          lastRenderAt = nowTs;
          renderedOnce = true;
          streamingContent.style.whiteSpace = '';
          streamingContent.innerHTML = formatResponse(streamedResponse);
          enhanceElement(streamingContent);
        } else if (!renderedOnce) {
          // Before the first render, show accurate raw text so output appears live.
          streamingContent.style.whiteSpace = 'pre-wrap';
          streamingContent.textContent = streamedResponse;
        }
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
      const responseTime = request.responseTime || 0;
      lastResponseText = finalResponse; // raw text for Copy

      // Update final response — full markdown/code/math render now that the
      // complete text is available, then enhance (highlight + KaTeX). An empty
      // result means the user stopped before any text arrived.
      if (streamingContent) {
        streamingContent.style.whiteSpace = ''; // drop the streaming pre-wrap
        if (finalResponse) {
          streamingContent.innerHTML = formatResponse(finalResponse);
          enhanceElement(streamingContent);
        } else {
          streamingContent.innerHTML = '<span class="cps-stopped">(stopped)</span>';
        }
      }

      // Add AI response to thread / history only if we actually got content.
      if (finalResponse) {
        if (currentThread) {
          currentThread.messages.push({
            role: 'assistant',
            text: finalResponse,
            timestamp: Date.now()
          });
        }

        // Save to conversation history
        if (!isFollowUp) {
          addToHistory({
            text,
            response: finalResponse,
            timestamp: Date.now(),
            threadId: currentThread?.id
          });
        } else {
          updateHistoryThread(currentThread);
        }

        // Surface a spend warning if the user is over their monthly budget.
        maybeShowBudgetNotice();
      }

      // Clear follow-up input
      const followUpInput = overlayWindow.querySelector('.cps-followup-input');
      if (followUpInput) {
        followUpInput.value = '';
        updateWordCount();
      }

      // Answer is final: offer Copy/Regenerate, drop the Stop control, and
      // clear the in-flight markers (only if we're still the active request).
      showCompletedActions(!!finalResponse);
      chrome.runtime.onMessage.removeListener(messageListener);
      if (activeRequestId === requestId) {
        activeRequestId = null;
        activeStreamListener = null;
      }
    } else if (request.action === 'streamError') {
      displayError(request.error);
      showErrorActions(); // allow Regenerate, nothing to copy
      chrome.runtime.onMessage.removeListener(messageListener);
      if (activeRequestId === requestId) {
        activeRequestId = null;
        activeStreamListener = null;
      }
    }
  };

  activeStreamListener = messageListener;
  chrome.runtime.onMessage.addListener(messageListener);

  // Send streaming request
  chrome.runtime.sendMessage({
    action: 'analyzeStream',
    data: {
      text,
      imageData,
      conversationContext: conversationContext,
      isFollowUp: isFollowUp,
      requestId: requestId
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

// Overlay markup, shared by createOverlayWindow() and the morph helpers so the
// two modes are defined in exactly one place each.
function bubbleShellHTML() {
  return `
    <div class="cps-header">
      <div class="cps-titlewrap">
        <span class="cps-title">AI Problem Solver</span>
        <span class="cps-version"></span>
      </div>
      <div class="cps-controls">
        <button class="cps-btn cps-theme-toggle" title="Toggle theme">☀️</button>
        <button class="cps-btn cps-close" title="Close">×</button>
      </div>
    </div>
    <div class="cps-bubble-content">
      <div class="cps-bubble-input-wrapper">
        <input
          type="text"
          class="cps-bubble-input"
          placeholder="ask anything!"
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
}

function analysisShellHTML() {
  return `
    <div class="cps-header">
      <div class="cps-titlewrap">
        <span class="cps-title">AI Problem Solver</span>
        <span class="cps-version"></span>
      </div>
      <div class="cps-controls">
        <select class="cps-style-select" title="Answer style">
          <option value="answer">Just the answer</option>
          <option value="explain">Concept explainer</option>
        </select>
        <button class="cps-btn cps-theme-toggle" title="Toggle theme">☀️</button>
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
        <div class="cps-actions">
          <button class="cps-action-btn cps-stop" title="Stop generating" style="display:none;">⏹ Stop</button>
          <button class="cps-action-btn cps-copy" title="Copy answer" style="display:none;">📋 Copy</button>
          <button class="cps-action-btn cps-regenerate" title="Regenerate answer" style="display:none;">🔄 Regenerate</button>
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
        <div class="cps-history-controls">
          <input type="text" class="cps-history-search" placeholder="Search history…" />
          <button class="cps-history-export" title="Export history as JSON">⬇ Export</button>
        </div>
        <div class="cps-history-list"></div>
      </div>
    </div>
    <div class="cps-resize-handle" title="Drag to resize"></div>
  `;
}

// Wire up the controls for a freshly-rendered shell.
function wireBubbleShell() {
  setupWindowControls();
  setupWelcomeBubbleDragDrop();
  setupWelcomeBubbleSubmit();
}

function wireAnalysisShell() {
  setupWindowControls();
  setupTabs();
  setupFeedback();
  setupFollowUp();
  setupActions();
  setupHistoryControls();
}

// Latest history list, cached so the search box can filter without re-reading
// storage on every keystroke.
let conversationHistoryCache = [];

// Wire the history search box and export button (once per shell render).
function setupHistoryControls() {
  const search = overlayWindow.querySelector('.cps-history-search');
  if (search) {
    search.addEventListener('input', () => renderHistoryList());
  }
  const exportBtn = overlayWindow.querySelector('.cps-history-export');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportHistory());
  }
}

// Download the full conversation history as JSON.
function exportHistory() {
  chrome.storage.local.get(['conversationHistory'], (result) => {
    const history = result.conversationHistory || [];
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-problem-solver-history-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// Create overlay window
function createOverlayWindow(mode = 'analysis') {
  overlayWindow = document.createElement('div');
  overlayWindow.id = 'chrome-problem-solver-overlay';
  overlayMode = mode;
  overlayWindow.className = `cps-mode-${mode}`;

  if (mode === 'bubble') {
    overlayWindow.innerHTML = bubbleShellHTML();
    document.body.appendChild(overlayWindow);
    // setTimeout ensures the appended DOM is queryable before wiring.
    setTimeout(wireBubbleShell, 0);
  } else {
    overlayWindow.innerHTML = analysisShellHTML();
    document.body.appendChild(overlayWindow);
    wireAnalysisShell();
  }
}

// Setup window controls
function setupWindowControls() {
  // The shell markup is rebuilt on every mode morph, so (re)apply theme, stamp
  // the live version, and wire the theme toggle here each time.
  overlayWindow.dataset.theme = currentTheme;

  const versionEl = overlayWindow.querySelector('.cps-version');
  if (versionEl) versionEl.textContent = 'v' + (chrome.runtime.getManifest().version || '');

  const themeBtn = overlayWindow.querySelector('.cps-theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
  }
  updateThemeButton();

  // Answer-style selector (analysis shell only): reflect current value and persist on change.
  const styleSelect = overlayWindow.querySelector('.cps-style-select');
  if (styleSelect) {
    styleSelect.value = currentAnswerStyle;
    styleSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      setAnswerStyle(styleSelect.value);
    });
  }

  const minimizeBtn = overlayWindow.querySelector('.cps-minimize');
  const closeBtn = overlayWindow.querySelector('.cps-close');

  if (minimizeBtn) {
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
  }
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      overlayWindow.classList.add('hidden');
      saveWindowState();
    });
  }

  // Header-drag and corner-resize (re-bound here since the markup is rebuilt
  // on every mode morph).
  enableDragAndResize();
}

// Enable dragging the overlay by its header and resizing via the corner handle.
// Both switch the overlay from its default bottom/right anchoring to explicit
// left/top, clamp to the viewport, and persist on release.
function enableDragAndResize() {
  if (!overlayWindow) return;
  const header = overlayWindow.querySelector('.cps-header');
  const handle = overlayWindow.querySelector('.cps-resize-handle');

  // Pin current on-screen rect as left/top and drop bottom/right anchoring.
  const anchorTopLeft = () => {
    const rect = overlayWindow.getBoundingClientRect();
    overlayWindow.style.left = rect.left + 'px';
    overlayWindow.style.top = rect.top + 'px';
    overlayWindow.style.right = 'auto';
    overlayWindow.style.bottom = 'auto';
    return rect;
  };

  // --- Drag via header ---
  if (header) {
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.cps-controls')) return; // let window buttons work
      e.preventDefault();
      const rect = anchorTopLeft();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      overlayWindow.classList.add('cps-dragging');

      const onMove = (ev) => {
        const w = overlayWindow.offsetWidth;
        const h = overlayWindow.offsetHeight;
        overlayWindow.style.left = clamp(ev.clientX - offsetX, 0, Math.max(0, window.innerWidth - w)) + 'px';
        overlayWindow.style.top = clamp(ev.clientY - offsetY, 0, Math.max(0, window.innerHeight - h)) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        overlayWindow.classList.remove('cps-dragging');
        saveWindowState();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // --- Resize via bottom-right handle (analysis mode only) ---
  if (handle) {
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = anchorTopLeft();
      const startX = e.clientX;
      const startY = e.clientY;
      overlayWindow.classList.add('cps-resizing');

      const onMove = (ev) => {
        const w = clamp(rect.width + (ev.clientX - startX), CPS_MIN_W, window.innerWidth - rect.left);
        const h = clamp(rect.height + (ev.clientY - startY), CPS_MIN_H, window.innerHeight - rect.top);
        overlayWindow.style.width = w + 'px';
        overlayWindow.style.height = h + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        overlayWindow.classList.remove('cps-resizing');
        saveWindowState();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
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
  
  // Send on Enter (Shift+Enter = newline); ↑ on an empty input recalls the last
  // sent follow-up so it can be edited and re-sent.
  followUpInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendFollowUp();
    } else if (e.key === 'ArrowUp' && !followUpInput.value && lastFollowUpText) {
      e.preventDefault();
      followUpInput.value = lastFollowUpText;
      updateWordCount();
    }
  });
  
  // Send button click
  sendBtn.addEventListener('click', () => {
    sendFollowUp();
  });
}

// Setup response action buttons (Stop / Copy / Regenerate)
function setupActions() {
  const stopBtn = overlayWindow.querySelector('.cps-stop');
  const copyBtn = overlayWindow.querySelector('.cps-copy');
  const regenBtn = overlayWindow.querySelector('.cps-regenerate');

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (activeRequestId) {
        // Background aborts the fetch and returns whatever streamed so far.
        chrome.runtime.sendMessage({ action: 'abortStream', requestId: activeRequestId });
      }
    });
  }
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyLastResponse(copyBtn));
  }
  if (regenBtn) {
    regenBtn.addEventListener('click', () => regenerate());
  }
}

// Toggle which response actions are visible.
function setActionVisibility({ stop = false, copy = false, regen = false }) {
  if (!overlayWindow) return;
  const stopBtn = overlayWindow.querySelector('.cps-stop');
  const copyBtn = overlayWindow.querySelector('.cps-copy');
  const regenBtn = overlayWindow.querySelector('.cps-regenerate');
  if (stopBtn) stopBtn.style.display = stop ? 'inline-flex' : 'none';
  if (copyBtn) copyBtn.style.display = copy ? 'inline-flex' : 'none';
  if (regenBtn) regenBtn.style.display = regen ? 'inline-flex' : 'none';
}
function showStreamingActions() { setActionVisibility({ stop: true }); }
function showCompletedActions(hasText = true) { setActionVisibility({ copy: hasText, regen: true }); }
function showErrorActions() { setActionVisibility({ regen: true }); }

// Copy the latest raw answer to the clipboard.
function copyLastResponse(btn) {
  if (!lastResponseText) return;
  const flash = () => {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = '✓ Copied';
    setTimeout(() => { btn.textContent = prev; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(lastResponseText).then(flash).catch(() => fallbackCopy(lastResponseText, flash));
  } else {
    fallbackCopy(lastResponseText, flash);
  }
}
function fallbackCopy(text, cb) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    if (cb) cb();
  } catch (_) {}
}

// Re-run the most recent user turn, replacing the last answer.
function regenerate() {
  if (!currentThread || !currentThread.messages.length) return;
  const msgs = currentThread.messages;
  // Drop the trailing assistant answer we want to redo.
  if (msgs[msgs.length - 1].role === 'assistant') msgs.pop();
  // The last remaining turn should be the user prompt to re-run.
  const lastUser = msgs.length ? msgs[msgs.length - 1] : null;
  if (!lastUser || lastUser.role !== 'user') return;
  // Pop it so sendAnalysisRequest re-adds it against the trimmed context.
  msgs.pop();
  const isFollowUp = msgs.length > 0;
  displayLoading();
  sendAnalysisRequest(lastUser.text, lastUser.imageData || null, isFollowUp);
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
  
  // Remember it for ↑ recall, then send.
  lastFollowUpText = text;

  // Display loading
  displayLoading();

  // Send follow-up request
  sendAnalysisRequest(text, null, true);
}

// Show feedback modal
function showFeedbackModal() {
  const modal = document.createElement('div');
  modal.className = 'cps-modal';
  modal.dataset.theme = currentTheme;
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

  if (!responseArea) return;

  // Clear any stale Copy/Regenerate from a previous answer while loading.
  setActionVisibility({});

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

  // Switch to main tab
  const mainTab = overlayWindow.querySelector('[data-tab="main"]');
  if (mainTab) {
    mainTab.click();
  }
}

// Display response
function displayResponse(response, responseTime, isFollowUp = false) {
  const responseArea = overlayWindow.querySelector('.cps-response-area');

  // Display full conversation thread if we have multiple messages
  if (currentThread && currentThread.messages.length >= 2) {
    responseArea.innerHTML = renderThread(currentThread.messages);
  } else {
    // Display single response
    responseArea.innerHTML = `<div class="cps-response">${formatResponse(response)}</div>`;
  }

  // Highlight code and render math in whatever was just inserted.
  enhanceElement(responseArea);

  // Store current conversation
  currentConversation = {
    response,
    responseTime,
    timestamp: Date.now()
  };

  // Scroll to bottom
  responseArea.scrollTop = responseArea.scrollHeight;
}

// Escape HTML so untrusted text (selected page content, AI output, errors)
// can never inject markup when inserted via innerHTML. Must run BEFORE we add
// our own intentional tags (<strong>, <code>, ...) in formatResponse.
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Math delimiters shared by the markdown-protect step and KaTeX auto-render,
// so both agree on what counts as math.
const MATH_DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
  { left: '$', right: '$', display: false }
];

// Harden sanitized output: external links open in a new tab without leaking the
// opener or referrer, and images don't leak the referrer. Registered once at
// load (DOMPurify is injected before this script per the manifest).
if (typeof DOMPurify !== 'undefined') {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    if (node.tagName === 'IMG') {
      node.setAttribute('referrerpolicy', 'no-referrer');
      node.setAttribute('loading', 'lazy');
    }
  });
}

// Render a markdown/LaTeX response to safe HTML.
// Pipeline: stash math -> marked (GFM) -> DOMPurify (input is untrusted!) -> restore math.
// Code highlighting and KaTeX run afterward via enhanceElement() on the live DOM.
function formatResponse(text) {
  const src = String(text ?? '');

  // 1) Protect math so markdown doesn't treat _ * \ inside formulas as syntax.
  const mathSpans = [];
  const stash = (m) => `@@KMATH${mathSpans.push(m) - 1}@@`;
  const protectedSrc = src
    .replace(/\$\$[\s\S]+?\$\$/g, stash)
    .replace(/\\\[[\s\S]+?\\\]/g, stash)
    .replace(/\\\([\s\S]+?\\\)/g, stash)
    .replace(/\$[^\n$]+?\$/g, stash);

  // 2) Markdown -> HTML (fall back to escaped text if marked failed to load).
  let html;
  try {
    html = marked.parse(protectedSrc, { gfm: true, breaks: true });
  } catch (_) {
    html = escapeHtml(protectedSrc).replace(/\n/g, '<br>');
  }

  // 3) Sanitize — marked passes raw HTML through and the input is untrusted.
  if (typeof DOMPurify !== 'undefined') {
    html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }

  // 4) Restore math as escaped text for KaTeX auto-render to pick up later.
  html = html.replace(/@@KMATH(\d+)@@/g, (_, i) => escapeHtml(mathSpans[Number(i)] || ''));
  return html;
}

// After response HTML is in the DOM, syntax-highlight code blocks and render math.
function enhanceElement(el) {
  if (!el) return;
  if (typeof hljs !== 'undefined') {
    el.querySelectorAll('pre code').forEach((block) => {
      try { hljs.highlightElement(block); } catch (_) {}
    });
  }
  if (typeof renderMathInElement !== 'undefined') {
    try {
      renderMathInElement(el, {
        delimiters: MATH_DELIMITERS,
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (_) {}
  }
}

// One conversation message → HTML. Shared by every thread-render site.
function messageBlockHTML(msg) {
  const cls = msg.role === 'user' ? 'cps-user-message' : 'cps-assistant-message';
  return `
    <div class="cps-message ${cls}">
      <div class="cps-message-content">${formatResponse(msg.text || '')}</div>
    </div>
  `;
}

// Render a list of user/assistant messages as a conversation thread. With
// streamingPlaceholder, append an empty assistant bubble (#streaming-content)
// for the in-flight answer. Single source of truth for thread markup.
function renderThread(messages, { streamingPlaceholder = false } = {}) {
  let html = '<div class="cps-conversation-thread">';
  (messages || []).forEach((msg) => {
    if (msg.role === 'user' || msg.role === 'assistant') html += messageBlockHTML(msg);
  });
  if (streamingPlaceholder) {
    html += `
      <div class="cps-message cps-assistant-message cps-streaming">
        <div class="cps-message-content" id="streaming-content"></div>
      </div>
    `;
  }
  html += '</div>';
  return html;
}

// True when partial streamed markdown can be rendered without garbling — i.e.
// no unclosed code fence (```) or display-math ($$) span.
function streamRenderSafe(text) {
  const fences = (text.match(/```/g) || []).length;
  const dd = (text.match(/\$\$/g) || []).length;
  return fences % 2 === 0 && dd % 2 === 0;
}

// If the user set a monthly budget and this month's spend exceeds it, prepend a
// one-line notice to the answer. Reads the same usage history analytics uses.
function maybeShowBudgetNotice() {
  chrome.storage.sync.get(['settings'], (s) => {
    const budget = Number(s.settings && s.settings.monthlyBudgetUsd) || 0;
    if (budget <= 0) return;
    chrome.storage.local.get(['usage'], (u) => {
      const history = (u.usage && u.usage.history) || [];
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      let monthCost = 0;
      history.forEach((it) => { if (it.timestamp >= monthStart) monthCost += Number(it.costUsd) || 0; });
      if (monthCost <= budget) return;

      const responseArea = overlayWindow && overlayWindow.querySelector('.cps-response-area');
      if (!responseArea || responseArea.querySelector('.cps-budget-notice')) return;
      const notice = document.createElement('div');
      notice.className = 'cps-budget-notice';
      notice.textContent = `⚠ Over monthly budget: $${monthCost.toFixed(2)} of $${budget}.`;
      responseArea.prepend(notice);
    });
  });
}

// Map a raw API error message to a friendlier, actionable line.
function friendlyError(error) {
  const msg = String(error || '');
  if (/api key not configured|401|authentication/i.test(msg)) {
    return 'No valid Claude API key. Open Settings and add your Anthropic key.';
  }
  if (/429|rate.?limit/i.test(msg)) {
    return 'Rate limited by the Claude API. Wait a moment, then retry.';
  }
  if (/network|failed to fetch|connection/i.test(msg)) {
    return 'Network error reaching the Claude API. Check your connection and retry.';
  }
  return msg || 'Something went wrong.';
}

// Display error as a friendly card with an inline Retry.
function displayError(error) {
  const responseArea = overlayWindow.querySelector('.cps-response-area');
  responseArea.innerHTML = `
    <div class="cps-error">
      <div class="cps-error-text">${escapeHtml(friendlyError(error))}</div>
      <button class="cps-action-btn cps-error-retry">🔄 Retry</button>
    </div>
  `;
  const retry = responseArea.querySelector('.cps-error-retry');
  if (retry) retry.addEventListener('click', () => regenerate());
}

// Display message
function displayMessage(message) {
  const responseArea = overlayWindow.querySelector('.cps-response-area');
  responseArea.innerHTML = `<div class="cps-message">${escapeHtml(message)}</div>`;
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

// Load history into the cache, then render (honoring any active search filter).
function loadHistory() {
  chrome.storage.local.get(['conversationHistory'], (result) => {
    conversationHistoryCache = result.conversationHistory || [];
    renderHistoryList();
  });
}

// Render the history list from the cache, filtered by the search box. Items keep
// their original cache index in data-index so clicks resolve the right entry.
function renderHistoryList() {
  const historyList = overlayWindow.querySelector('.cps-history-list');
  if (!historyList) return;

  const term = (overlayWindow.querySelector('.cps-history-search')?.value || '').trim().toLowerCase();
  const items = conversationHistoryCache
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !term || (item.text || '').toLowerCase().includes(term));

  if (conversationHistoryCache.length === 0) {
    historyList.innerHTML = '<div class="cps-empty">No conversation history</div>';
    return;
  }
  if (items.length === 0) {
    historyList.innerHTML = '<div class="cps-empty">No matches</div>';
    return;
  }

  historyList.innerHTML = items.map(({ item, index }) => {
    const date = new Date(item.timestamp);
    const text = item.text || '';
    return `
      <div class="cps-history-item" data-index="${index}">
        <div class="cps-history-header">
          <span class="cps-history-time">${date.toLocaleString()}</span>
        </div>
        <div class="cps-history-text">${escapeHtml(text.substring(0, 100))}${text.length > 100 ? '...' : ''}</div>
      </div>
    `;
  }).join('');

  historyList.querySelectorAll('.cps-history-item').forEach(el => {
    el.addEventListener('click', () => {
      const index = parseInt(el.dataset.index);
      displayHistoryItem(conversationHistoryCache[index]);
    });
  });
}

// Display history item
function displayHistoryItem(item) {
  // Restore thread if available
  if (item.thread) {
    currentThread = item.thread;
    const responseArea = overlayWindow.querySelector('.cps-response-area');
    responseArea.innerHTML = renderThread(currentThread.messages);
    enhanceElement(responseArea);
  } else {
    displayResponse(item.response, item.responseTime);
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
  overlayWindow.innerHTML = bubbleShellHTML();

  // setTimeout ensures the new DOM is queryable before wiring.
  setTimeout(wireBubbleShell, 0);
}

// Morph overlay to analysis mode
function morphToAnalysisMode() {
  if (!overlayWindow) return;
  
  overlayMode = 'analysis';
  overlayWindow.className = 'cps-mode-analysis';
  overlayWindow.innerHTML = analysisShellHTML();
  wireAnalysisShell();
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
    if (fileInput) {
      fileInput.click();
    }
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

// Save window state — minimized flag plus any explicit position/size the user
// set by dragging or resizing. Size is only meaningful in analysis mode (bubble
// mode is auto-height), so width/height are recorded only there.
function saveWindowState() {
  if (!overlayWindow) return;

  const s = overlayWindow.style;
  const state = { minimized: isMinimized };

  if (s.left) state.left = parseInt(s.left, 10);
  if (s.top) state.top = parseInt(s.top, 10);
  if (overlayMode === 'analysis') {
    if (s.width) state.width = parseInt(s.width, 10);
    if (s.height) state.height = parseInt(s.height, 10);
  }

  chrome.storage.local.set({ windowState: state });
}

// Apply a saved geometry to the current overlay, clamped to the viewport so a
// position saved on another screen size (e.g. a different machine) stays visible.
function applyGeometry(state) {
  if (!overlayWindow || !state) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let width = overlayWindow.offsetWidth;
  let height = overlayWindow.offsetHeight;

  if (overlayMode === 'analysis') {
    if (typeof state.width === 'number') {
      width = clamp(state.width, CPS_MIN_W, vw);
      overlayWindow.style.width = width + 'px';
    }
    if (typeof state.height === 'number') {
      height = clamp(state.height, CPS_MIN_H, vh);
      overlayWindow.style.height = height + 'px';
    }
  }

  if (typeof state.left === 'number' && typeof state.top === 'number') {
    overlayWindow.style.left = clamp(state.left, 0, Math.max(0, vw - width)) + 'px';
    overlayWindow.style.top = clamp(state.top, 0, Math.max(0, vh - height)) + 'px';
    overlayWindow.style.right = 'auto';
    overlayWindow.style.bottom = 'auto';
  }
}

// Restore window state
function restoreWindowState() {
  chrome.storage.local.get(['windowState'], (result) => {
    if (result.windowState && overlayWindow) {
      const state = result.windowState;
      isMinimized = state.minimized || false;

      if (isMinimized) {
        overlayWindow.classList.add('minimized');
      } else {
        overlayWindow.classList.remove('minimized');
      }

      applyGeometry(state);
    }
  });
}
