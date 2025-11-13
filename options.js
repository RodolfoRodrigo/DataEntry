// options.js - Gerencia configurações da extensão

const DEFAULT_RECORD_NAVIGATION = 'new_tab';

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadCacheInfo();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('testBtn').addEventListener('click', testConnection);
  document.getElementById('clearCacheBtn').addEventListener('click', clearCache);
}

// ============================================================
// CARREGAR CONFIGURAÇÕES
// ============================================================
async function loadSettings() {
  const { openai_api_key, transcription_language, record_navigation_behavior } = await chrome.storage.sync.get([
    'openai_api_key',
    'transcription_language',
    'record_navigation_behavior'
  ]);

  if (openai_api_key) {
    document.getElementById('apiKey').value = openai_api_key;
  }

  document.getElementById('transcriptionLanguage').value = transcription_language || 'auto';
  document.getElementById('recordNavigationBehavior').value = record_navigation_behavior || DEFAULT_RECORD_NAVIGATION;
}

// ============================================================
// SALVAR CONFIGURAÇÕES
// ============================================================
async function saveSettings() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const language = document.getElementById('transcriptionLanguage').value || 'auto';
  const navigationBehavior = document.getElementById('recordNavigationBehavior').value || DEFAULT_RECORD_NAVIGATION;

  if (!apiKey) {
    showStatus('error', '❌ Por favor, insira uma API Key');
    return;
  }
  
  if (!apiKey.startsWith('sk-')) {
    showStatus('error', '❌ API Key inválida. Deve começar com "sk-"');
    return;
  }

  try {
    await chrome.storage.sync.set({
      openai_api_key: apiKey,
      transcription_language: language,
      record_navigation_behavior: navigationBehavior
    });
    showStatus('success', '✅ Configurações salvas com sucesso!');

    setTimeout(() => {
      hideStatus();
    }, 3000);
    
  } catch (error) {
    showStatus('error', `❌ Erro ao salvar: ${error.message}`);
  }
}

// ============================================================
// TESTAR CONEXÃO COM OPENAI
// ============================================================
async function testConnection() {
  const apiKey = document.getElementById('apiKey').value.trim();
  
  if (!apiKey) {
    showStatus('error', '❌ Por favor, insira uma API Key primeiro');
    return;
  }
  
  const btn = document.getElementById('testBtn');
  btn.disabled = true;
  btn.textContent = '🔄 Testando...';
  
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });
    
    if (response.ok) {
      showStatus('success', '✅ Conexão bem-sucedida! API Key válida.');
    } else {
      const error = await response.json();
      showStatus('error', `❌ Erro: ${error.error?.message || 'API Key inválida'}`);
    }
    
  } catch (error) {
    showStatus('error', `❌ Erro de conexão: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '🧪 Testar Conexão';
  }
}

// ============================================================
// GERENCIAR CACHE
// ============================================================
async function loadCacheInfo() {
  const { metadata_cache } = await chrome.storage.local.get('metadata_cache');
  
  const countEl = document.getElementById('cacheCount');
  const listEl = document.getElementById('cacheList');
  
  if (!metadata_cache || Object.keys(metadata_cache).length === 0) {
    countEl.textContent = '0';
    listEl.innerHTML = '<div class="cache-item">Nenhum objeto em cache</div>';
    return;
  }
  
  const objects = Object.keys(metadata_cache);
  countEl.textContent = objects.length;
  
  listEl.innerHTML = objects
    .map(obj => `<div class="cache-item">📦 ${obj}</div>`)
    .join('');
}

async function clearCache() {
  if (!confirm('Tem certeza que deseja limpar o cache de metadados?\n\nIsso irá remover todas as informações armazenadas de objetos Salesforce.')) {
    return;
  }
  
  try {
    await chrome.storage.local.remove('metadata_cache');
    await loadCacheInfo();
    showStatus('success', '✅ Cache limpo com sucesso!');
    
    setTimeout(() => {
      hideStatus();
    }, 3000);
    
  } catch (error) {
    showStatus('error', `❌ Erro ao limpar cache: ${error.message}`);
  }
}

// ============================================================
// UI HELPERS
// ============================================================
function showStatus(type, message) {
  const status = document.getElementById('status');
  status.className = `status ${type} show`;
  status.textContent = message;
}

function hideStatus() {
  const status = document.getElementById('status');
  status.classList.remove('show');
}