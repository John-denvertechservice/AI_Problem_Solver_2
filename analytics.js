// Chrome Problem Solver - Analytics Page Script

let usageData = null;

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
      byProvider: {},
      byModel: {},
      byContentType: {},
      history: []
    };
    
    const conversationHistory = result.conversationHistory || [];
    
    updateOverview(usageData, conversationHistory);
    updateProviderStats(usageData);
    updateModelStats(usageData);
    updateContentTypeStats(usageData);
    updateRecentActivity(usageData.history);
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

// Update provider stats
function updateProviderStats(data) {
  const openaiCount = data.byProvider?.openai || 0;
  const claudeCount = data.byProvider?.claude || 0;
  const total = openaiCount + claudeCount;
  
  document.getElementById('openai-count').textContent = openaiCount;
  document.getElementById('claude-count').textContent = claudeCount;
  
  if (total > 0) {
    document.getElementById('openai-percentage').textContent = `${Math.round((openaiCount / total) * 100)}%`;
    document.getElementById('claude-percentage').textContent = `${Math.round((claudeCount / total) * 100)}%`;
  } else {
    document.getElementById('openai-percentage').textContent = '0%';
    document.getElementById('claude-percentage').textContent = '0%';
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
            <span class="model-name">${formatModelName(model)}</span>
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
            <span class="content-type-name">${typeLabel}</span>
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
    const date = new Date(item.timestamp);
    const timeAgo = getTimeAgo(item.timestamp);
    const provider = item.provider || 'unknown';
    const model = item.model || 'unknown';
    const success = item.success !== false;
    
    return `
      <div class="activity-item ${success ? 'success' : 'error'}">
        <div class="activity-header">
          <span class="activity-time">${timeAgo}</span>
          <span class="activity-status">${success ? '✅' : '❌'}</span>
        </div>
        <div class="activity-details">
          <span class="activity-provider">${provider}</span>
          <span class="activity-separator">•</span>
          <span class="activity-model">${formatModelName(model)}</span>
          ${item.responseTime ? `<span class="activity-separator">•</span><span class="activity-time">${Math.round(item.responseTime)}ms</span>` : ''}
        </div>
        ${item.error ? `<div class="activity-error">${item.error}</div>` : ''}
      </div>
    `;
  }).join('');
}

// Format model name
function formatModelName(model) {
  const modelMap = {
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4o': 'GPT-4o',
    'gpt-4-turbo': 'GPT-4 Turbo',
    'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
    'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
    'claude-3-opus-20240229': 'Claude 3 Opus'
  };
  
  return modelMap[model] || model;
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
      a.download = `chrome-problem-solver-analytics-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}

