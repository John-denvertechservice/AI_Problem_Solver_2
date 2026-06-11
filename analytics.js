// AI Problem Solver - Analytics Page Script

let usageData = null;

// Escape untrusted values before interpolating into innerHTML. Stored fields
// (API error messages, provider/model names) can contain markup, and this page
// runs in the privileged extension origin.
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadAnalytics();
  setupButtons();
});

// Load analytics data
function loadAnalytics() {
  chrome.storage.local.get(['usage', 'conversationHistory'], (result) => {
    usageData = result.usage || {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      averageResponseTime: 0,
      byModel: {},
      byContentType: {},
      history: []
    };

    const conversationHistory = result.conversationHistory || [];

    updateOverview(usageData, conversationHistory);
    updateModelStats(usageData);
    updateContentTypeStats(usageData);
    updateRecentActivity(usageData.history);

    // Cost panel needs the monthly budget, which lives in sync settings.
    chrome.storage.sync.get(['settings'], (r) => {
      updateCostStats(usageData, (r.settings && Number(r.settings.monthlyBudgetUsd)) || 0);
    });
  });
}

// Update overview cards
function updateOverview(data, conversations) {
  document.getElementById('total-requests').textContent = data.totalRequests || 0;
  
  const successRate = data.totalRequests > 0 
    ? Math.round((data.successfulRequests / data.totalRequests) * 100)
    : 0;
  document.getElementById('success-rate').textContent = `${successRate}%`;
  
  const avgTime = data.averageResponseTime || 0;
  document.getElementById('avg-response-time').textContent = `${Math.round(avgTime)}ms`;
  
  document.getElementById('total-conversations').textContent = conversations.length || 0;
}

// Update cost / spending stats from the usage history. Each history entry written
// on a successful request carries costUsd and token counts.
function updateCostStats(data, monthlyBudgetUsd) {
  const history = data.history || [];
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let totalCost = 0;
  let totalTokens = 0;
  let monthCost = 0;

  history.forEach((item) => {
    const cost = Number(item.costUsd) || 0;
    totalCost += cost;
    totalTokens += (Number(item.inputTokens) || 0) + (Number(item.outputTokens) || 0);
    if (item.timestamp >= monthStart) monthCost += cost;
  });

  document.getElementById('total-cost').textContent = `$${totalCost.toFixed(4)}`;
  document.getElementById('total-tokens').textContent = `${totalTokens.toLocaleString()} tokens`;
  document.getElementById('month-cost').textContent = `$${monthCost.toFixed(4)}`;

  const status = document.getElementById('budget-status');
  if (monthlyBudgetUsd > 0) {
    const pct = Math.round((monthCost / monthlyBudgetUsd) * 100);
    const over = monthCost > monthlyBudgetUsd;
    status.textContent = over
      ? `⚠ ${pct}% — over $${monthlyBudgetUsd} budget`
      : `${pct}% of $${monthlyBudgetUsd} budget`;
    status.style.color = over ? '#f44336' : '';
  } else {
    status.textContent = 'No budget set';
    status.style.color = '';
  }
}

// Update model stats
function updateModelStats(data) {
  const modelStats = document.getElementById('model-stats');
  const models = data.byModel || {};
  
  if (Object.keys(models).length === 0) {
    modelStats.innerHTML = '<div class="empty-state">No model usage data</div>';
    return;
  }
  
  const total = Object.values(models).reduce((sum, count) => sum + count, 0);
  
  modelStats.innerHTML = Object.entries(models)
    .sort((a, b) => b[1] - a[1])
    .map(([model, count]) => {
      const percentage = Math.round((count / total) * 100);
      return `
        <div class="model-stat-item">
          <div class="model-stat-header">
            <span class="model-name">${escapeHtml(formatModelName(model))}</span>
            <span class="model-count">${count}</span>
          </div>
          <div class="model-stat-bar">
            <div class="model-stat-fill" style="width: ${percentage}%"></div>
          </div>
          <div class="model-stat-percentage">${percentage}%</div>
        </div>
      `;
    }).join('');
}

// Update content type stats
function updateContentTypeStats(data) {
  const contentTypeStats = document.getElementById('content-type-stats');
  const types = data.byContentType || {};
  
  if (Object.keys(types).length === 0) {
    contentTypeStats.innerHTML = '<div class="empty-state">No content type data</div>';
    return;
  }
  
  const total = Object.values(types).reduce((sum, count) => sum + count, 0);
  
  contentTypeStats.innerHTML = Object.entries(types)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const percentage = Math.round((count / total) * 100);
      const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      return `
        <div class="content-type-item">
          <div class="content-type-header">
            <span class="content-type-name">${escapeHtml(typeLabel)}</span>
            <span class="content-type-count">${count}</span>
          </div>
          <div class="content-type-bar">
            <div class="content-type-fill" style="width: ${percentage}%"></div>
          </div>
          <div class="content-type-percentage">${percentage}%</div>
        </div>
      `;
    }).join('');
}

// Update recent activity
function updateRecentActivity(history) {
  const activityList = document.getElementById('activity-list');
  
  if (!history || history.length === 0) {
    activityList.innerHTML = '<div class="empty-state">No recent activity</div>';
    return;
  }
  
  // Show last 10 items
  const recent = history.slice(-10).reverse();
  
  activityList.innerHTML = recent.map(item => {
    const timeAgo = getTimeAgo(item.timestamp);
    const success = item.success !== false;
    const cost = Number(item.costUsd) || 0;

    return `
      <div class="activity-item ${success ? 'success' : 'error'}">
        <div class="activity-header">
          <span class="activity-time">${timeAgo}</span>
          <span class="activity-status">${success ? '✅' : '❌'}</span>
        </div>
        <div class="activity-details">
          <span class="activity-model">${escapeHtml(formatModelName(item.model))}</span>
          ${item.contentType ? `<span class="activity-separator">•</span><span class="activity-type">${escapeHtml(item.contentType)}</span>` : ''}
          ${item.responseTime ? `<span class="activity-separator">•</span><span class="activity-time">${Math.round(item.responseTime)}ms</span>` : ''}
          ${cost > 0 ? `<span class="activity-separator">•</span><span class="activity-cost">$${cost.toFixed(4)}</span>` : ''}
        </div>
        ${item.error ? `<div class="activity-error">${escapeHtml(item.error)}</div>` : ''}
      </div>
    `;
  }).join('');
}

// Format model name
function formatModelName(model) {
  const modelMap = {
    'claude-haiku-4-5-20251001': 'Claude Haiku 4.5'
  };

  return modelMap[model] || model || 'unknown';
}

// Get time ago
function getTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

// Setup buttons
function setupButtons() {
  document.getElementById('refresh-data').addEventListener('click', () => {
    loadAnalytics();
  });
  
  document.getElementById('export-analytics').addEventListener('click', () => {
    chrome.storage.local.get(['usage', 'conversationHistory', 'feedback'], (data) => {
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-problem-solver-analytics-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}

