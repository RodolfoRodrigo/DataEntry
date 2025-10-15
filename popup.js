// popup.js - Interface simplificada com dropdowns

const appState = {
  step: 'idle',
  objectName: null,
  fields: {},
  metadata: null,
  validationResult: null,
  questions: []
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  if (!window.aiProcessor) {
    showStatus('error', '❌ Erro ao carregar o processador de IA');
    return;
  }
  
  try {
    await window.aiProcessor.initialize();
    setupEventListeners();
    checkAPIKey();
  } catch (error) {
    showStatus('error', `❌ Erro na inicialização: ${error.message}`);
  }
});

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  
  // IA Assistant
  document.getElementById('processBtn').addEventListener('click', processTranscription);
  document.getElementById('submitResponse').addEventListener('click', submitUserResponse);
  document.getElementById('confirmInsert').addEventListener('click', confirmInsert);
  document.getElementById('cancelInsert').addEventListener('click', cancelProcess);
  document.getElementById('addFieldBtn').addEventListener('click', addNewFieldRow);
  
  // SOQL
  document.getElementById('runQuery').addEventListener('click', runSOQL);
}

function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`${tabName}-tab`).classList.add('active');
}

async function checkAPIKey() {
  const { openai_api_key } = await chrome.storage.sync.get('openai_api_key');
  if (!openai_api_key) {
    showStatus('warning', '⚠️ Configure sua API Key do OpenAI nas opções da extensão!');
  }
}

// ============================================================
// FLUXO PRINCIPAL DE IA
// ============================================================
async function processTranscription() {
  const transcription = document.getElementById('transcription').value.trim();
  
  if (!transcription) {
    showStatus('error', '❌ Por favor, digite uma transcrição');
    return;
  }
  
  try {
    setProcessing(true);
    resetUI();
    appState.step = 'identifying';
    
    showStatus('info', '🔍 Analisando transcrição com IA...');
    
    // PASSO 1: Identificar objeto e campos
    const identified = await window.aiProcessor.identifyObject(transcription);
    console.log('📦 Objeto identificado:', identified);
    
    appState.objectName = identified.object;
    appState.fields = identified.fields;
    
    addChatMessage('ai', `Identifiquei que você quer criar um **${identified.object}**`);
    
    // PASSO 2: Buscar metadados do objeto
    showStatus('info', `📚 Consultando estrutura do ${identified.object} na sua org...`);
    appState.metadata = await window.aiProcessor.getObjectMetadata(identified.object);
    
    // PASSO 3: Validar e enriquecer
    showStatus('info', '🤖 Validando dados com base na configuração da sua org...');
    const enriched = await window.aiProcessor.validateAndEnrichFields(
      identified.object,
      identified.fields,
      transcription
    );
    
    console.log('✨ Dados enriquecidos:', enriched);
    
    // Atualiza campos
    appState.fields = enriched.fields;
    
    // Mostra correções automáticas
    if (enriched.autoCorrections && enriched.autoCorrections.length > 0) {
      addChatMessage('ai', `🔧 **Correções automáticas aplicadas:**\n${enriched.autoCorrections.map(c => `• ${c}`).join('\n')}`);
    }
    
    // Verifica se há issues
    const hasIssues = (enriched.missingRequired && enriched.missingRequired.length > 0) ||
                      (enriched.invalidValues && enriched.invalidValues.length > 0) ||
                      (enriched.needsUserInput && enriched.needsUserInput.length > 0);
    
    if (hasIssues) {
      await handleEnrichmentIssues(enriched);
    } else {
      await showConfirmationSummary();
    }
    
  } catch (error) {
    console.error('Erro no processamento:', error);
    showStatus('error', `❌ Erro: ${error.message}`);
    addChatMessage('ai', `Ops! Ocorreu um erro: ${error.message}`);
  } finally {
    setProcessing(false);
  }
}

async function handleEnrichmentIssues(enriched) {
  appState.step = 'correcting';
  
  const issues = [];
  
  if (enriched.missingRequired && enriched.missingRequired.length > 0) {
    issues.push(`**⚠️ Campos obrigatórios faltando:**\n${enriched.missingRequired.map(f => `• ${f.label} (${f.name})`).join('\n')}`);
  }
  
  if (enriched.invalidValues && enriched.invalidValues.length > 0) {
    issues.push(`**❌ Valores inválidos:**\n${enriched.invalidValues.map(v => `• ${v.field}: ${v.reason}${v.suggestion ? `\n  Sugestão: ${v.suggestion}` : ''}`).join('\n')}`);
  }
  
  if (enriched.needsUserInput && enriched.needsUserInput.length > 0) {
    const questions = enriched.needsUserInput.map(q => q.question);
    appState.questions = questions;
    
    showStatus('warning', '⚠️ Preciso de mais informações...');
    addChatMessage('ai', issues.join('\n\n'));
    addChatMessage('ai', questions.join('\n\n'));
    showCorrectionInput();
    return;
  }
  
  showStatus('warning', '⚠️ Alguns campos obrigatórios estão faltando');
  addChatMessage('ai', issues.join('\n\n'));
  await showFieldEditor();
}

async function showConfirmationSummary() {
  appState.step = 'ready';
  
  showStatus('success', '✅ Dados prontos!');
  
  const summary = Object.entries(appState.fields)
    .map(([key, value]) => {
      const fieldMeta = appState.metadata.fields.find(f => f.name === key);
      const label = fieldMeta ? fieldMeta.label : key;
      return `• **${label}**: ${value}`;
    })
    .join('\n');
  
  addChatMessage('ai', `📋 **Resumo dos dados:**\n\n${summary}\n\n✅ **Confira os campos e adicione mais se necessário:**`);
  
  await showFieldEditor();
}

async function submitUserResponse() {
  const response = document.getElementById('userResponse').value.trim();
  
  if (!response) {
    showStatus('error', '❌ Digite uma resposta');
    return;
  }
  
  try {
    setProcessing(true);
    addChatMessage('user', response);
    document.getElementById('userResponse').value = '';
    
    showStatus('info', '🤖 Processando sua resposta...');
    
    const relevantChunks = window.metadataChunker.searchRelevantChunks(appState.objectName, response);
    const context = window.metadataChunker.generateCompactContext(appState.objectName, relevantChunks);
    
    const messages = [
      {
        role: 'system',
        content: `Você é um assistente Salesforce. Baseado na resposta do usuário e nos metadados REAIS da org, atualize os campos.

CONTEXTO DA ORG:
${JSON.stringify(context, null, 2)}

CAMPOS ATUAIS:
${JSON.stringify(appState.fields, null, 2)}

PERGUNTAS FEITAS:
${appState.questions.join('\n')}

Retorne JSON:
{
  "fields": {"FieldName": "valor atualizado"},
  "changes": ["Descrição das mudanças"],
  "allResolved": true/false
}`
      },
      {
        role: 'user',
        content: response
      }
    ];
    
    const updated = await window.aiProcessor.callGPT(messages);
    
    appState.fields = { ...appState.fields, ...updated.fields };
    
    if (updated.changes && updated.changes.length > 0) {
      addChatMessage('ai', `✅ **Atualizado:**\n${updated.changes.map(c => `• ${c}`).join('\n')}`);
    }
    
    if (updated.allResolved) {
      hideCorrectionInput();
      await showConfirmationSummary();
    } else {
      const revalidated = await window.aiProcessor.validateAndEnrichFields(
        appState.objectName,
        appState.fields,
        JSON.stringify(appState.fields)
      );
      await handleEnrichmentIssues(revalidated);
    }
    
  } catch (error) {
    console.error('Erro ao processar resposta:', error);
    showStatus('error', `❌ Erro: ${error.message}`);
  } finally {
    setProcessing(false);
  }
}

// ============================================================
// EDITOR DE CAMPOS SIMPLIFICADO COM DROPDOWNS
// ============================================================
async function showFieldEditor() {
  appState.step = 'ready';
  
  showStatus('success', '✅ Revise os campos e clique em Confirmar');
  
  const container = document.getElementById('fieldsContainer');
  container.innerHTML = '';
  
  // Adiciona campos identificados pela IA
  for (const [fieldName, value] of Object.entries(appState.fields)) {
    addFieldRow(container, fieldName, value);
  }
  
  document.getElementById('fieldEditor').classList.remove('hidden');
  document.getElementById('chatBox').classList.add('hidden');
}

function addFieldRow(container, fieldName, value) {
  const fieldMeta = appState.metadata.fields.find(f => f.name === fieldName);
  const label = fieldMeta ? fieldMeta.label : fieldName;
  const isRequired = fieldMeta ? (!fieldMeta.nillable && !fieldMeta.defaultedOnCreate) : false;
  
  const row = document.createElement('div');
  row.className = 'field-row';
  row.dataset.fieldname = fieldName;
  
  // Cria input apropriado baseado no tipo de campo
  let inputHtml = '';
  
  if (fieldMeta && fieldMeta.picklistValues && fieldMeta.picklistValues.length > 0) {
    // Campo PICKLIST - usa dropdown
    const options = fieldMeta.picklistValues
      .filter(pv => pv.active)
      .map(pv => `<option value="${pv.value}" ${pv.value === value ? 'selected' : ''}>${pv.label}</option>`)
      .join('');
    
    inputHtml = `
      <select class="field-input" data-field="${fieldName}">
        <option value="">-- Selecione --</option>
        ${options}
      </select>
    `;
  } else if (fieldMeta && fieldMeta.type === 'boolean') {
    // Campo BOOLEAN - usa dropdown sim/não
    inputHtml = `
      <select class="field-input" data-field="${fieldName}">
        <option value="">-- Selecione --</option>
        <option value="true" ${value === true || value === 'true' ? 'selected' : ''}>Sim</option>
        <option value="false" ${value === false || value === 'false' ? 'selected' : ''}>Não</option>
      </select>
    `;
  } else {
    // Campo TEXTO - usa input normal
    inputHtml = `<input type="text" class="field-input" data-field="${fieldName}" value="${value || ''}" placeholder="Digite o valor...">`;
  }
  
  row.innerHTML = `
    <div class="field-label-container">
      <div class="field-label">
        ${label}
        ${isRequired ? '<span class="required-badge">*</span>' : ''}
      </div>
      <div class="field-api-name">${fieldName}</div>
    </div>
    <div class="field-input-group">
      ${inputHtml}
      <button class="btn-remove-field" data-field="${fieldName}" title="Remover campo">🗑️</button>
    </div>
  `;
  
  container.appendChild(row);
  
  // Event listener para remover campo
  row.querySelector('.btn-remove-field').addEventListener('click', (e) => {
    const field = e.target.dataset.field;
    delete appState.fields[field];
    row.remove();
  });
}

// ============================================================
// ADICIONAR NOVO CAMPO (SIMPLIFICADO)
// ============================================================
function addNewFieldRow() {
  const container = document.getElementById('fieldsContainer');
  
  // Cria uma nova linha com dropdown de campos
  const row = document.createElement('div');
  row.className = 'field-row field-row-new';
  
  // Filtra campos disponíveis
  const availableFields = appState.metadata.fields
    .filter(f => f.createable && !appState.fields[f.name])
    .sort((a, b) => a.label.localeCompare(b.label));
  
  const fieldOptions = availableFields
    .map(f => {
      const required = (!f.nillable && !f.defaultedOnCreate) ? ' *' : '';
      return `<option value="${f.name}">${f.label}${required}</option>`;
    })
    .join('');
  
  row.innerHTML = `
    <div class="field-label-container">
      <select class="field-select" data-row="new">
        <option value="">-- Selecione um campo --</option>
        ${fieldOptions}
      </select>
    </div>
    <div class="field-input-group">
      <input type="text" class="field-input-new" placeholder="Aguardando seleção..." disabled>
      <button class="btn-remove-field" title="Remover linha">❌</button>
    </div>
  `;
  
  container.appendChild(row);
  
  const select = row.querySelector('.field-select');
  const input = row.querySelector('.field-input-new');
  const removeBtn = row.querySelector('.btn-remove-field');
  
  // Quando selecionar um campo
  select.addEventListener('change', () => {
    const fieldName = select.value;
    
    if (!fieldName) {
      input.disabled = true;
      input.placeholder = 'Aguardando seleção...';
      return;
    }
    
    const fieldMeta = appState.metadata.fields.find(f => f.name === fieldName);
    
    if (!fieldMeta) return;
    
    // Remove a classe de nova e transforma em campo normal
    row.classList.remove('field-row-new');
    row.dataset.fieldname = fieldName;
    
    // Atualiza o visual
    const labelContainer = row.querySelector('.field-label-container');
    const isRequired = !fieldMeta.nillable && !fieldMeta.defaultedOnCreate;
    
    labelContainer.innerHTML = `
      <div class="field-label">
        ${fieldMeta.label}
        ${isRequired ? '<span class="required-badge">*</span>' : ''}
      </div>
      <div class="field-api-name">${fieldName}</div>
    `;
    
    // Substitui o input pelo tipo correto
    const inputGroup = row.querySelector('.field-input-group');
    let newInput = '';
    
    if (fieldMeta.picklistValues && fieldMeta.picklistValues.length > 0) {
      const options = fieldMeta.picklistValues
        .filter(pv => pv.active)
        .map(pv => `<option value="${pv.value}">${pv.label}</option>`)
        .join('');
      
      newInput = `
        <select class="field-input" data-field="${fieldName}">
          <option value="">-- Selecione --</option>
          ${options}
        </select>
      `;
    } else if (fieldMeta.type === 'boolean') {
      newInput = `
        <select class="field-input" data-field="${fieldName}">
          <option value="">-- Selecione --</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>
      `;
    } else {
      newInput = `<input type="text" class="field-input" data-field="${fieldName}" placeholder="Digite o valor...">`;
    }
    
    inputGroup.innerHTML = `
      ${newInput}
      <button class="btn-remove-field" data-field="${fieldName}" title="Remover campo">🗑️</button>
    `;
    
    // Atualiza o event listener do botão remover
    inputGroup.querySelector('.btn-remove-field').addEventListener('click', () => {
      delete appState.fields[fieldName];
      row.remove();
    });
    
    // Foca no novo input
    const finalInput = inputGroup.querySelector('.field-input');
    if (finalInput) finalInput.focus();
  });
  
  // Remover linha vazia
  removeBtn.addEventListener('click', () => {
    row.remove();
  });
  
  // Foca no select
  select.focus();
}

// ============================================================
// CONFIRMAÇÃO E INSERÇÃO
// ============================================================
async function confirmInsert() {
  try {
    setProcessing(true);
    appState.step = 'inserting';
    
    // Coleta valores de todos os inputs/selects
    document.querySelectorAll('.field-input').forEach(input => {
      const fieldName = input.dataset.field;
      appState.fields[fieldName] = input.value;
    });
    
    showStatus('info', '💾 Inserindo registro no Salesforce...');
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.tabs.sendMessage(tab.id, {
      type: 'INSERT_RECORD',
      objectName: appState.objectName,
      fields: appState.fields
    }, async (response) => {
      if (response?.ok) {
        showStatus('success', '✅ Registro criado com sucesso!');
        document.getElementById('resultBox').classList.remove('hidden');
        document.getElementById('resultBox').textContent = JSON.stringify(response.data, null, 2);
        
        addChatMessage('ai', `🎉 Registro criado com sucesso!\n\nID: ${response.data.id}`);
        
        setTimeout(() => {
          resetUI();
          document.getElementById('transcription').value = '';
        }, 3000);
        
      } else if (response?.error) {
        await handleDMLError(response.error);
      }
    });
    
  } catch (error) {
    console.error('Erro ao inserir:', error);
    showStatus('error', `❌ Erro: ${error.message}`);
  } finally {
    setProcessing(false);
  }
}

async function handleDMLError(error) {
  showStatus('error', '❌ Erro ao inserir registro');
  
  try {
    const explanation = await window.aiProcessor.explainDMLError(
      error,
      appState.objectName,
      appState.fields
    );
    
    addChatMessage('ai', `❌ ${explanation.problem}\n\n💡 ${explanation.solution}\n\n${explanation.user_message}`);
    
    if (explanation.suggested_fields) {
      appState.fields = { ...appState.fields, ...explanation.suggested_fields };
      await showFieldEditor();
    }
    
    document.getElementById('resultBox').classList.remove('hidden');
    document.getElementById('resultBox').textContent = JSON.stringify(error, null, 2);
    
  } catch (err) {
    addChatMessage('ai', `Erro ao processar: ${JSON.stringify(error, null, 2)}`);
  }
}

function cancelProcess() {
  resetUI();
  appState.step = 'idle';
  appState.objectName = null;
  appState.fields = {};
  appState.metadata = null;
  appState.validationResult = null;
  appState.questions = [];
  showStatus('info', 'Processo cancelado');
}

// ============================================================
// UI HELPERS
// ============================================================
function showStatus(type, message) {
  const box = document.getElementById('statusBox');
  box.innerHTML = `<div class="status ${type}">${message}</div>`;
}

function addChatMessage(sender, text) {
  const chatBox = document.getElementById('chatBox');
  chatBox.classList.remove('hidden');
  
  const msg = document.createElement('div');
  msg.className = `chat-message ${sender}`;
  msg.innerHTML = text.replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function showCorrectionInput() {
  document.getElementById('correctionInput').classList.remove('hidden');
  document.getElementById('userResponse').focus();
}

function hideCorrectionInput() {
  document.getElementById('correctionInput').classList.add('hidden');
}

function setProcessing(isProcessing) {
  const btn = document.getElementById('processBtn');
  const text = document.getElementById('processBtnText');
  const spinner = document.getElementById('processBtnSpinner');
  
  btn.disabled = isProcessing;
  text.classList.toggle('hidden', isProcessing);
  spinner.classList.toggle('hidden', !isProcessing);
}

function resetUI() {
  document.getElementById('statusBox').innerHTML = '';
  document.getElementById('chatBox').innerHTML = '';
  document.getElementById('chatBox').classList.add('hidden');
  document.getElementById('correctionInput').classList.add('hidden');
  document.getElementById('fieldEditor').classList.add('hidden');
  document.getElementById('resultBox').classList.add('hidden');
  document.getElementById('userResponse').value = '';
}

// ============================================================
// SOQL
// ============================================================
async function runSOQL() {
  const query = document.getElementById('query').value.trim();
  
  if (!query) {
    document.getElementById('queryResult').textContent = 'Digite uma query SOQL';
    return;
  }
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    chrome.tabs.sendMessage(tab.id, { type: 'RUN_SOQL', query }, (resp) => {});
    
    document.getElementById('queryResult').classList.remove('hidden');
    document.getElementById('queryResult').textContent = '⏳ Executando...';
    
  } catch (error) {
    document.getElementById('queryResult').textContent = `Erro: ${error.message}`;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SOQL_RESULT') {
    document.getElementById('queryResult').classList.remove('hidden');
    document.getElementById('queryResult').textContent = JSON.stringify(msg.data, null, 2);
  } else if (msg.type === 'SOQL_ERROR') {
    document.getElementById('queryResult').classList.remove('hidden');
    document.getElementById('queryResult').textContent = `❌ Erro: ${msg.error}`;
  }
});