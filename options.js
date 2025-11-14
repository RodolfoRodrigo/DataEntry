// options.js - Gerencia configurações da extensão

const DEFAULT_RECORD_NAVIGATION = 'new_tab';

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadCacheInfo();
  await loadValidationRules();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('testBtn').addEventListener('click', testConnection);
  document.getElementById('clearCacheBtn').addEventListener('click', clearCache);
  const addRuleBtn = document.getElementById('addRuleBtn');
  if (addRuleBtn) {
    addRuleBtn.addEventListener('click', addCustomRule);
  }

  const validationList = document.getElementById('validationRulesList');
  if (validationList) {
    validationList.addEventListener('click', handleValidationListClick);
  }
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

  const normalizedNavigation = record_navigation_behavior === 'background_tab'
    ? 'background_tab'
    : DEFAULT_RECORD_NAVIGATION;

  document.getElementById('recordNavigationBehavior').value = normalizedNavigation;

  if (record_navigation_behavior === 'same_tab') {
    try {
      await chrome.storage.sync.set({ record_navigation_behavior: normalizedNavigation });
    } catch (error) {
      console.warn('Não foi possível atualizar a preferência antiga de navegação:', error);
    }
  }
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
  const [{ metadata_cache }, { custom_validation_rules }] = await Promise.all([
    chrome.storage.local.get('metadata_cache'),
    chrome.storage.sync.get('custom_validation_rules')
  ]);

  const countEl = document.getElementById('cacheCount');
  const listEl = document.getElementById('cacheList');

  const metadataCache = metadata_cache || {};
  const customRules = custom_validation_rules || {};
  const objects = Object.keys(metadataCache).sort();

  countEl.textContent = objects.length;
  populateRuleObjectSelect(objects);

  if (objects.length === 0) {
    listEl.innerHTML = '<div class="cache-item">Nenhum objeto em cache</div>';
    return;
  }

  const cacheItems = objects
    .map(objectName => {
      const metadata = metadataCache[objectName] || {};
      const fieldsCount = metadata.fields?.length || 0;
      const standardRulesCount = metadata.validationRules?.length || 0;
      const customRulesCount = customRules[objectName]?.length || 0;
      const totalRules = standardRulesCount + customRulesCount;
      const cachedAt = metadata.cachedAt
        ? new Date(metadata.cachedAt).toLocaleString()
        : '—';

      return `
        <div class="cache-item">
          <div class="cache-object-title">📦 ${objectName}</div>
          <div class="cache-object-details">
            Campos: <strong>${fieldsCount}</strong> • Regras: <strong>${totalRules}</strong><br>
            Atualizado em: ${cachedAt}
          </div>
        </div>`;
    })
    .join('');

  listEl.innerHTML = cacheItems;
}

async function clearCache() {
  if (!confirm('Tem certeza que deseja limpar o cache de metadados?\n\nIsso irá remover todas as informações armazenadas de objetos Salesforce.')) {
    return;
  }

  try {
    await chrome.storage.local.remove('metadata_cache');
    await loadCacheInfo();
    await loadValidationRules();
    showStatus('success', '✅ Cache limpo com sucesso!');

    setTimeout(() => {
      hideStatus();
    }, 3000);

  } catch (error) {
    showStatus('error', `❌ Erro ao limpar cache: ${error.message}`);
  }
}

// ============================================================
// REGRAS DE VALIDAÇÃO
// ============================================================
async function loadValidationRules() {
  const [{ metadata_cache }, { custom_validation_rules }] = await Promise.all([
    chrome.storage.local.get('metadata_cache'),
    chrome.storage.sync.get('custom_validation_rules')
  ]);

  const metadataCache = metadata_cache || {};
  const customRules = custom_validation_rules || {};
  const listEl = document.getElementById('validationRulesList');

  if (!listEl) return;

  const objects = Object.keys(metadataCache).sort();

  if (objects.length === 0) {
    listEl.innerHTML = '<div class="cache-item">Nenhum objeto em cache. Abra um registro no Salesforce para carregar metadados e regras.</div>';
    populateRuleObjectSelect([]);
    return;
  }

  const fragments = objects.map(objectName => {
    const metadata = metadataCache[objectName] || {};
    const standardRules = Array.isArray(metadata.validationRules) ? metadata.validationRules : [];
    const customRulesList = Array.isArray(customRules[objectName]) ? customRules[objectName] : [];
    const totalRules = standardRules.length + customRulesList.length;
    const cachedAt = metadata.cachedAt ? new Date(metadata.cachedAt).toLocaleString() : '—';

    const ruleItems = [];

    if (standardRules.length > 0) {
      standardRules.forEach(rule => {
        const name = escapeHtml(rule.name || rule.type || 'Regra de validação');
        const message = escapeHtml(rule.errorMessage || rule.description || 'Sem descrição disponível');
        const fieldInfo = rule.errorDisplayField || (Array.isArray(rule.fields) ? rule.fields.join(', ') : '—');
        const fieldLabel = fieldInfo ? escapeHtml(fieldInfo) : '—';
        const formula = rule.formula ? `<div class="rule-meta">Fórmula: ${escapeHtml(rule.formula)}</div>` : '';
        const activeLabel = rule.active === false ? '<span class="rule-meta">(Inativa)</span>' : '';
        const sourceLabel = rule.source === 'common' ? 'Regra sugerida' : 'Salesforce';

        ruleItems.push(`
          <div class="rule-item">
            <div class="rule-header">${name} ${activeLabel}</div>
            <div class="rule-meta">Fonte: ${escapeHtml(sourceLabel)} • Campo: ${fieldLabel}</div>
            ${formula}
            <div>${message}</div>
          </div>
        `);
      });
    }

    if (customRulesList.length > 0) {
      customRulesList.forEach(rule => {
        const name = escapeHtml(rule.name || 'Regra personalizada');
        const message = escapeHtml(rule.message || rule.description || 'Sem descrição disponível');
        const fields = Array.isArray(rule.fields) && rule.fields.length > 0 ? escapeHtml(rule.fields.join(', ')) : '—';
        const formula = rule.formula ? `<div class="rule-meta">Fórmula: ${escapeHtml(rule.formula)}</div>` : '';

        ruleItems.push(`
          <div class="rule-item custom-rule" data-object="${escapeHtml(objectName)}" data-rule-id="${escapeHtml(rule.id)}">
            <div class="rule-header">
              ${name}
              <button class="remove-rule" data-object="${escapeHtml(objectName)}" data-rule-id="${escapeHtml(rule.id)}">Remover</button>
            </div>
            <div class="rule-meta">Fonte: Regra personalizada • Campos: ${fields}</div>
            ${formula}
            <div>${message}</div>
          </div>
        `);
      });
    }

    if (ruleItems.length === 0) {
      ruleItems.push('<div class="rule-item">Nenhuma regra encontrada para este objeto.</div>');
    }

    return `
      <details class="validation-object">
        <summary>${escapeHtml(objectName)} • ${totalRules} regra(s) • Atualizado em ${escapeHtml(cachedAt)}</summary>
        ${ruleItems.join('')}
      </details>
    `;
  });

  listEl.innerHTML = fragments.join('');
  populateRuleObjectSelect(objects);
}

async function addCustomRule() {
  const objectSelect = document.getElementById('ruleObject');
  const nameInput = document.getElementById('ruleName');
  const messageInput = document.getElementById('ruleMessage');
  const fieldsInput = document.getElementById('ruleFields');
  const formulaInput = document.getElementById('ruleFormula');

  const objectName = objectSelect?.value || '';
  const ruleName = nameInput?.value.trim() || '';
  const ruleMessage = messageInput?.value.trim() || '';
  const ruleFields = fieldsInput?.value.trim() || '';
  const ruleFormula = formulaInput?.value.trim() || '';

  if (!objectName) {
    showStatus('error', '❌ Selecione um objeto para adicionar a regra.');
    return;
  }

  if (!ruleName) {
    showStatus('error', '❌ Informe um nome para a regra.');
    return;
  }

  if (!ruleMessage) {
    showStatus('error', '❌ Informe a mensagem de erro da regra.');
    return;
  }

  const fields = ruleFields
    ? ruleFields.split(',').map(field => field.trim()).filter(Boolean)
    : [];

  const ruleId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rule_${Date.now()}`;
  const newRule = {
    id: ruleId,
    name: ruleName,
    message: ruleMessage,
    fields,
    formula: ruleFormula,
    active: true,
    createdAt: new Date().toISOString()
  };

  try {
    const { custom_validation_rules } = await chrome.storage.sync.get('custom_validation_rules');
    const rulesMap = custom_validation_rules || {};
    if (!Array.isArray(rulesMap[objectName])) {
      rulesMap[objectName] = [];
    }
    rulesMap[objectName].push(newRule);

    await chrome.storage.sync.set({ custom_validation_rules: rulesMap });

    if (nameInput) nameInput.value = '';
    if (messageInput) messageInput.value = '';
    if (fieldsInput) fieldsInput.value = '';
    if (formulaInput) formulaInput.value = '';

    showStatus('success', '✅ Regra personalizada adicionada!');
    await loadValidationRules();
    await loadCacheInfo();

    setTimeout(() => {
      hideStatus();
    }, 3000);
  } catch (error) {
    console.error('Erro ao adicionar regra personalizada:', error);
    showStatus('error', `❌ Erro ao salvar regra: ${error.message}`);
  }
}

async function handleValidationListClick(event) {
  const target = event.target;
  if (!target.classList.contains('remove-rule')) {
    return;
  }

  const objectName = target.dataset.object;
  const ruleId = target.dataset.ruleId;

  if (!objectName || !ruleId) {
    return;
  }

  if (!confirm('Tem certeza que deseja remover esta regra personalizada?')) {
    return;
  }

  try {
    const { custom_validation_rules } = await chrome.storage.sync.get('custom_validation_rules');
    const rulesMap = custom_validation_rules || {};

    if (!Array.isArray(rulesMap[objectName])) {
      return;
    }

    rulesMap[objectName] = rulesMap[objectName].filter(rule => rule.id !== ruleId);
    if (rulesMap[objectName].length === 0) {
      delete rulesMap[objectName];
    }

    await chrome.storage.sync.set({ custom_validation_rules: rulesMap });
    showStatus('success', '✅ Regra removida.');
    await loadValidationRules();
    await loadCacheInfo();

    setTimeout(() => {
      hideStatus();
    }, 2000);
  } catch (error) {
    console.error('Erro ao remover regra personalizada:', error);
    showStatus('error', `❌ Erro ao remover regra: ${error.message}`);
  }
}

function populateRuleObjectSelect(objects) {
  const select = document.getElementById('ruleObject');
  const addBtn = document.getElementById('addRuleBtn');
  if (!select) return;

  const previousValue = select.value;

  if (!objects || objects.length === 0) {
    select.innerHTML = '<option value="" selected>Nenhum objeto em cache</option>';
    select.disabled = true;
    if (addBtn) addBtn.disabled = true;
    return;
  }

  select.disabled = false;
  if (addBtn) addBtn.disabled = false;

  const options = ['<option value="" disabled selected>Selecione um objeto</option>'].concat(
    objects.map(obj => `<option value="${escapeHtml(obj)}">${escapeHtml(obj)}</option>`)
  );
  select.innerHTML = options.join('');

  if (objects.includes(previousValue)) {
    select.value = previousValue;
  }
}

function escapeHtml(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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