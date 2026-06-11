// Chrome Problem Solver - Options Page Script

const OPENAI_MODELS = {
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-4.1': 'GPT-4.1'
};

const CLAUDE_MODELS = {
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-8': 'Claude Opus 4.8'
};

let currentSettings = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
  openaiKey: '',
  claudeKey: ''
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupTabs();
  setupProviderCards();
  setupModelSelector();
  setupToggleVisibility();
  setupSaveButton();
  setupDataButtons();
});

// Load settings from storage
function loadSettings() {
  chrome.storage.sync.get(['settings'], (result) => {
    if (result.settings) {
      currentSettings = { ...currentSettings, ...result.settings };
      applySettings();
    }
  });
}

// Apply settings to UI
function applySettings() {
  // Provider
  document.querySelectorAll('.provider-card').forEach(card => {
    card.classList.toggle('active', card.dataset.provider === currentSettings.provider);
  });
  
  // Model selector
  updateModelSelector();
  
  // API keys (masked)
  document.getElementById('openai-key').value = currentSettings.openaiKey ? '••••••••' : '';
  document.getElementById('claude-key').value = currentSettings.claudeKey ? '••••••••' : '';
  
  // Preferences
  document.getElementById('track-usage').checked = currentSettings.trackUsage !== false;
}

// Setup tabs
function setupTabs() {
  const tabs = document.querySelectorAll('.options-tab');
  const contents = document.querySelectorAll('.options-tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.querySelector(`[data-content="${targetTab}"]`).classList.add('active');
    });
  });
}

// Setup provider cards
function setupProviderCards() {
  document.querySelectorAll('.provider-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.provider-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      currentSettings.provider = card.dataset.provider;
      updateModelSelector();
    });
  });
}

// Update model selector
function updateModelSelector() {
  const modelSelect = document.getElementById('model-select');
  const modelHint = document.getElementById('model-hint');
  const models = currentSettings.provider === 'openai' ? OPENAI_MODELS : CLAUDE_MODELS;
  
  modelSelect.innerHTML = '<option value="">Select a model...</option>';
  
  Object.entries(models).forEach(([value, name]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = name;
    if (value === currentSettings.model) {
      option.selected = true;
    }
    modelSelect.appendChild(option);
  });
  
  // Update hint
  if (currentSettings.provider === 'openai') {
    modelHint.textContent = 'GPT-4.1 Mini is recommended for fast responses. All GPT-4.1 models support vision.';
  } else {
    modelHint.textContent = 'Claude Sonnet 4.6 is recommended for best accuracy. All Claude models support vision.';
  }
  
  // Listen for model changes
  modelSelect.addEventListener('change', (e) => {
    currentSettings.model = e.target.value;
  });
}

// Initialize the model selector (shim for earlier call sites)
// Ensures the selector is populated on load. Further updates happen
// via provider-card clicks which call updateModelSelector().
function setupModelSelector() {
  updateModelSelector();
}

// Setup toggle visibility
function setupToggleVisibility() {
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      const isPassword = input.type === 'password';
      
      input.type = isPassword ? 'text' : 'password';
      btn.textContent = isPassword ? '🙈' : '👁️';
      
      // If showing and it's masked, we need to get the real value
      if (isPassword && input.value === '••••••••') {
        // Get actual key from storage
        chrome.storage.sync.get(['settings'], (result) => {
          if (result.settings) {
            const keyName = targetId === 'openai-key' ? 'openaiKey' : 'claudeKey';
            input.value = result.settings[keyName] || '';
          }
        });
      }
    });
  });
  
  // Handle input changes
  document.getElementById('openai-key').addEventListener('input', (e) => {
    if (e.target.value !== '••••••••') {
      currentSettings.openaiKey = e.target.value;
    }
  });
  
  document.getElementById('claude-key').addEventListener('input', (e) => {
    if (e.target.value !== '••••••••') {
      currentSettings.claudeKey = e.target.value;
    }
  });
}

// Setup save button
function setupSaveButton() {
  document.getElementById('save-settings').addEventListener('click', () => {
    saveSettings();
  });
}

// Save settings
function saveSettings() {
  // Get actual API key values
  const openaiKeyInput = document.getElementById('openai-key');
  const claudeKeyInput = document.getElementById('claude-key');
  
  if (openaiKeyInput.value !== '••••••••') {
    currentSettings.openaiKey = openaiKeyInput.value;
  }
  
  if (claudeKeyInput.value !== '••••••••') {
    currentSettings.claudeKey = claudeKeyInput.value;
  }
  
  // Get preferences
  currentSettings.trackUsage = document.getElementById('track-usage').checked;
  
  // Validate
  if (!currentSettings.model) {
    showStatus('Please select a model', 'error');
    return;
  }
  
  const requiredKey = currentSettings.provider === 'openai' ? 'openaiKey' : 'claudeKey';
  if (!currentSettings[requiredKey]) {
    showStatus(`Please enter your ${currentSettings.provider === 'openai' ? 'OpenAI' : 'Claude'} API key`, 'error');
    return;
  }
  
  // Save to storage
  chrome.storage.sync.set({ settings: currentSettings }, () => {
    showStatus('Settings saved successfully!', 'success');
    
    // Re-mask API keys
    openaiKeyInput.type = 'password';
    openaiKeyInput.value = currentSettings.openaiKey ? '••••••••' : '';
    claudeKeyInput.type = 'password';
    claudeKeyInput.value = currentSettings.claudeKey ? '••••••••' : '';
  });
}

// Show status message
function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('save-status');
  statusEl.textContent = message;
  statusEl.className = `save-status ${type}`;
  
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'save-status';
  }, 3000);
}

// Setup data buttons
function setupDataButtons() {
  document.getElementById('clear-data').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all usage data? This cannot be undone.')) {
      chrome.storage.local.clear(() => {
        showStatus('All data cleared', 'success');
      });
    }
  });
  
  document.getElementById('export-data').addEventListener('click', () => {
    chrome.storage.local.get(null, (data) => {
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chrome-problem-solver-data-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus('Data exported', 'success');
    });
  });
}
