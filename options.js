// AI Problem Solver - Options Page Script
// Single provider (Claude Haiku). Settings: { claudeKey, theme, trackUsage,
// answerStyle, monthlyBudgetUsd }. Theme and answer style persist immediately so
// the in-page overlay updates live via chrome.storage.onChanged.

let currentSettings = {
  claudeKey: '',
  theme: 'dark',
  trackUsage: true,
  answerStyle: 'answer',
  monthlyBudgetUsd: 0
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupTabs();
  setupToggleVisibility();
  setupThemeSelector();
  setupAnswerStyleSelector();
  setupSaveButton();
  setupDataButtons();
});

// Load settings from storage
function loadSettings() {
  chrome.storage.sync.get(['settings'], (result) => {
    if (result.settings) {
      currentSettings = { ...currentSettings, ...result.settings };
    }
    applySettings();
  });
}

// Apply settings to UI
function applySettings() {
  document.getElementById('claude-key').value = currentSettings.claudeKey ? '••••••••' : '';
  document.getElementById('track-usage').checked = currentSettings.trackUsage !== false;

  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) themeSelect.value = currentSettings.theme === 'light' ? 'light' : 'dark';

  const styleSelect = document.getElementById('answer-style-select');
  if (styleSelect) styleSelect.value = currentSettings.answerStyle === 'explain' ? 'explain' : 'answer';

  const budget = document.getElementById('monthly-budget');
  if (budget) budget.value = Number(currentSettings.monthlyBudgetUsd) || 0;
}

// Persist a single settings field immediately, merging with whatever is stored.
function persistSetting(key, value) {
  currentSettings[key] = value;
  chrome.storage.sync.get(['settings'], (result) => {
    const settings = result.settings || {};
    settings[key] = value;
    chrome.storage.sync.set({ settings });
  });
}

// Theme selector — persist immediately so the in-page overlay updates live.
function setupThemeSelector() {
  const select = document.getElementById('theme-select');
  if (!select) return;
  select.addEventListener('change', () => {
    persistSetting('theme', select.value === 'light' ? 'light' : 'dark');
  });
}

// Answer-style selector — persist immediately (mirrors the overlay's quick switch).
function setupAnswerStyleSelector() {
  const select = document.getElementById('answer-style-select');
  if (!select) return;
  select.addEventListener('change', () => {
    persistSetting('answerStyle', select.value === 'explain' ? 'explain' : 'answer');
  });
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

// Setup toggle visibility for the API key field
function setupToggleVisibility() {
  document.querySelectorAll('.toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      const isPassword = input.type === 'password';

      input.type = isPassword ? 'text' : 'password';
      btn.textContent = isPassword ? '🙈' : '👁️';

      // If revealing a masked key, fetch the real value from storage.
      if (isPassword && input.value === '••••••••') {
        chrome.storage.sync.get(['settings'], (result) => {
          if (result.settings) input.value = result.settings.claudeKey || '';
        });
      }
    });
  });

  document.getElementById('claude-key').addEventListener('input', (e) => {
    if (e.target.value !== '••••••••') currentSettings.claudeKey = e.target.value;
  });
}

// Setup save button
function setupSaveButton() {
  document.getElementById('save-settings').addEventListener('click', saveSettings);
}

// Save settings. Merge this page's owned fields into the latest stored object
// rather than overwriting it wholesale — theme/answerStyle may have been
// live-persisted from the overlay (or another tab) since this page loaded.
function saveSettings() {
  const claudeKeyInput = document.getElementById('claude-key');
  if (claudeKeyInput.value !== '••••••••') {
    currentSettings.claudeKey = claudeKeyInput.value;
  }

  currentSettings.trackUsage = document.getElementById('track-usage').checked;
  currentSettings.monthlyBudgetUsd = Number(document.getElementById('monthly-budget').value) || 0;

  if (!currentSettings.claudeKey) {
    showStatus('Please enter your Claude API key', 'error');
    return;
  }

  chrome.storage.sync.get(['settings'], (result) => {
    const settings = {
      ...(result.settings || {}),
      claudeKey: currentSettings.claudeKey,
      trackUsage: currentSettings.trackUsage,
      monthlyBudgetUsd: currentSettings.monthlyBudgetUsd
    };
    currentSettings = { ...currentSettings, ...settings };
    chrome.storage.sync.set({ settings }, () => {
      showStatus('Settings saved successfully!', 'success');
      claudeKeyInput.type = 'password';
      claudeKeyInput.value = currentSettings.claudeKey ? '••••••••' : '';
    });
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
      a.download = `ai-problem-solver-data-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus('Data exported', 'success');
    });
  });
}
