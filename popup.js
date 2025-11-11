// Chrome Problem Solver - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  loadQuickStats();
  setupButtons();
  checkStatus();
});

// Load quick statistics
function loadQuickStats() {
  chrome.storage.local.get(['usage'], (result) => {
    const usage = result.usage || {};
    const totalRequests = usage.totalRequests || 0;
    const successRate = usage.totalRequests > 0
      ? Math.round((usage.successfulRequests / usage.totalRequests) * 100)
      : 0;
    
    document.getElementById('quick-requests').textContent = totalRequests;
    document.getElementById('quick-success').textContent = `${successRate}%`;
  });
}

// Check extension status
function checkStatus() {
  chrome.storage.sync.get(['settings'], (result) => {
    const settings = result.settings || {};
    const statusIndicator = document.getElementById('status-indicator');
    const statusDot = statusIndicator.querySelector('.status-dot');
    const statusText = statusIndicator.querySelector('.status-text');
    
    const requiredKey = settings.provider === 'openai' ? 'openaiKey' : 'claudeKey';
    const hasKey = settings[requiredKey] && settings[requiredKey].length > 0;
    
    if (hasKey && settings.model) {
      statusDot.classList.add('active');
      statusText.textContent = 'Ready';
    } else {
      statusDot.classList.remove('active');
      statusText.textContent = 'Setup Required';
    }
  });
}

// Setup buttons
function setupButtons() {
  document.getElementById('open-settings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  document.getElementById('open-analytics').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('analytics.html') });
  });
}

