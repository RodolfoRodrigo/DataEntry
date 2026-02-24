// popup.js - Interface com lookup inteligente

const appState = {
  step: 'idle',
  objectName: null,
  fields: {},
  metadata: null,
  validationResult: null,
  questions: [],
  lookupCache: new Map(), // Cache de buscas lookup
  lastSoqlResult: null,
  lastChartHtml: ''
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
  document.getElementById('generateSoql').addEventListener('click', generateSOQLFromNaturalLanguage);
  document.getElementById('runQuery').addEventListener('click', runSOQL);
  document.getElementById('generateChart').addEventListener('click', generateChartFromResult);
  document.getElementById('saveChart').addEventListener('click', saveChartHtml);
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
    
    // PASSO 3: Processar campos lookup automaticamente
    await processLookupFields(transcription);
    
    // PASSO 4: Validar e enriquecer
    showStatus('info', '🤖 Validando dados com base na configuração da sua org...');
    const enriched = await window.aiProcessor.validateAndEnrichFields(
      identified.object,
      identified.fields,
      transcription
    );
    
    console.log('✨ Dados enriquecidos:', enriched);
    
    // Atualiza campos
    appState.fields = { ...appState.fields, ...enriched.fields };
    
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

// ============================================================
// BUSCA INTELIGENTE DE LOOKUP
// ============================================================
async function processLookupFields(transcription) {
  const lookupFields = appState.metadata.fields.filter(f => 
    f.referenceTo && f.referenceTo.length > 0 && f.createable
  );
  
  if (lookupFields.length === 0) return;
  
  showStatus('info', '🔍 Buscando registros relacionados...');
  
  for (const lookupField of lookupFields) {
    // Tenta extrair o nome mencionado na transcrição para este lookup
    const searchTerm = await extractLookupSearchTerm(transcription, lookupField);
    
    if (searchTerm) {
      const results = await searchLookupRecords(lookupField.referenceTo[0], searchTerm);
      
      if (results && results.length > 0) {
        if (results.length === 1) {
          // Apenas 1 resultado - auto-seleciona
          appState.fields[lookupField.name] = results[0].Id;
          appState.lookupCache.set(lookupField.name, results);
          addChatMessage('ai', `✅ Encontrei automaticamente: **${results[0].Name}** para ${lookupField.label}`);
        } else {
          // Múltiplos resultados - salva para seleção posterior
          appState.lookupCache.set(lookupField.name, results);
          addChatMessage('ai', `🔍 Encontrei ${results.length} opções para **${lookupField.label}**. Você pode selecionar na revisão.`);
        }
      }
    }
  }
}

async function extractLookupSearchTerm(transcription, lookupField) {
  try {
    const messages = [
      {
        role: 'system',
        content: `Analise a transcrição e extraia o termo de busca para o campo lookup "${lookupField.label}" que referencia "${lookupField.referenceTo[0]}".

Exemplos:
- "Criar contato na empresa Acme Corp" → "Acme Corp" (para AccountId)
- "Oportunidade para o cliente XYZ" → "XYZ" (para AccountId)
- "Criar caso para contato João Silva" → "João Silva" (para ContactId)

Retorne JSON:
{
  "searchTerm": "termo extraído ou null"
}`
      },
      {
        role: 'user',
        content: `Transcrição: ${transcription}\nCampo Lookup: ${lookupField.label} (${lookupField.name})`
      }
    ];
    
    const result = await window.aiProcessor.callGPT(messages, 0.1);
    return result.searchTerm;
  } catch (error) {
    console.error('Erro ao extrair termo de busca:', error);
    return null;
  }
}

async function searchLookupRecords(objectName, searchTerm, limit = 10) {
  try {
    // Monta query SOQL para buscar registros
    const query = `SELECT Id, Name FROM ${objectName} WHERE Name LIKE '%${searchTerm}%' LIMIT ${limit}`;
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { 
        type: 'RUN_SOQL', 
        query 
      }, (resp) => {});
      
      // Listener temporário para resultado
      const listener = (msg) => {
        if (msg.type === 'SOQL_RESULT') {
          chrome.runtime.onMessage.removeListener(listener);
          resolve(msg.data.records || []);
        }
      };
      
      chrome.runtime.onMessage.addListener(listener);
      
      // Timeout de 5 segundos
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        resolve([]);
      }, 5000);
    });
  } catch (error) {
    console.error('Erro ao buscar lookup:', error);
    return [];
  }
}

// ============================================================
// BUSCA LOOKUP EM TEMPO REAL
// ============================================================
async function searchLookupRealtime(fieldName, searchTerm) {
  if (!searchTerm || searchTerm.length < 2) return [];
  
  const fieldMeta = appState.metadata.fields.find(f => f.name === fieldName);
  if (!fieldMeta || !fieldMeta.referenceTo) return [];
  
  const objectName = fieldMeta.referenceTo[0];
  return await searchLookupRecords(objectName, searchTerm, 20);
}

// ============================================================
// EDITOR DE CAMPOS COM LOOKUP INTELIGENTE
// ============================================================
async function showFieldEditor() {
  appState.step = 'ready';
  
  showStatus('success', '✅ Revise os campos e clique em Confirmar');
  
  const container = document.getElementById('fieldsContainer');
  container.innerHTML = '';
  
  // Adiciona campos identificados pela IA
  for (const [fieldName, value] of Object.entries(appState.fields)) {
    await addFieldRow(container, fieldName, value);
  }
  
  document.getElementById('fieldEditor').classList.remove('hidden');
  document.getElementById('chatBox').classList.add('hidden');
}

async function addFieldRow(container, fieldName, value) {
  const fieldMeta = appState.metadata.fields.find(f => f.name === fieldName);
  const label = fieldMeta ? fieldMeta.label : fieldName;
  const isRequired = fieldMeta ? (!fieldMeta.nillable && !fieldMeta.defaultedOnCreate) : false;
  
  const row = document.createElement('div');
  row.className = 'field-row';
  row.dataset.fieldname = fieldName;
  
  // Cria input apropriado baseado no tipo de campo
  let inputHtml = '';
  
  if (fieldMeta && fieldMeta.referenceTo && fieldMeta.referenceTo.length > 0) {
    // ===== CAMPO LOOKUP =====
    inputHtml = await createLookupInput(fieldName, fieldMeta, value);
  } else if (fieldMeta && fieldMeta.picklistValues && fieldMeta.picklistValues.length > 0) {
    // Campo PICKLIST
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
    // Campo BOOLEAN
    inputHtml = `
      <select class="field-input" data-field="${fieldName}">
        <option value="">-- Selecione --</option>
        <option value="true" ${value === true || value === 'true' ? 'selected' : ''}>Sim</option>
        <option value="false" ${value === false || value === 'false' ? 'selected' : ''}>Não</option>
      </select>
    `;
  } else {
    // Campo TEXTO
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
  
  // Setup lookup se necessário
  if (fieldMeta && fieldMeta.referenceTo && fieldMeta.referenceTo.length > 0) {
    setupLookupInput(row, fieldName, fieldMeta);
  }
  
  // Event listener para remover campo
  row.querySelector('.btn-remove-field').addEventListener('click', (e) => {
    const field = e.target.dataset.field;
    delete appState.fields[field];
    row.remove();
  });
}

async function createLookupInput(fieldName, fieldMeta, value) {
  const cachedResults = appState.lookupCache.get(fieldName) || [];
  
  // Se já tem um ID selecionado, busca o nome
  let selectedName = '';
  if (value && cachedResults.length > 0) {
    const selected = cachedResults.find(r => r.Id === value);
    selectedName = selected ? selected.Name : value;
  }
  
  let html = `
    <div class="lookup-container" data-field="${fieldName}">
      <input 
        type="text" 
        class="lookup-search" 
        data-field="${fieldName}"
        placeholder="Digite para buscar..."
        value="${selectedName}"
        autocomplete="off"
      >
      <input type="hidden" class="lookup-id" data-field="${fieldName}" value="${value || ''}">
      <div class="lookup-results" data-field="${fieldName}" style="display: none;"></div>
  `;
  
  // Se já tem resultados em cache, mostra as opções
  if (cachedResults.length > 0) {
    html += `
      <div class="lookup-cached">
        <small>💡 ${cachedResults.length} opção(ões) encontrada(s)</small>
      </div>
    `;
  }
  
  html += `</div>`;
  
  return html;
}

function setupLookupInput(row, fieldName, fieldMeta) {
  const searchInput = row.querySelector('.lookup-search');
  const hiddenInput = row.querySelector('.lookup-id');
  const resultsDiv = row.querySelector('.lookup-results');
  
  let searchTimeout;
  
  // Busca em tempo real
  searchInput.addEventListener('input', async (e) => {
    const term = e.target.value.trim();
    
    clearTimeout(searchTimeout);
    
    if (term.length < 2) {
      resultsDiv.style.display = 'none';
      resultsDiv.innerHTML = '';
      hiddenInput.value = '';
      return;
    }
    
    searchTimeout = setTimeout(async () => {
      resultsDiv.innerHTML = '<div class="lookup-loading">🔍 Buscando...</div>';
      resultsDiv.style.display = 'block';
      
      const results = await searchLookupRealtime(fieldName, term);
      
      if (results.length === 0) {
        resultsDiv.innerHTML = '<div class="lookup-empty">Nenhum registro encontrado</div>';
        return;
      }
      
      // Renderiza resultados
      resultsDiv.innerHTML = results.map(record => `
        <div class="lookup-item" data-id="${record.Id}" data-name="${record.Name}">
          <strong>${record.Name}</strong>
          <small>${record.Id}</small>
        </div>
      `).join('');
      
      // Event listeners para seleção
      resultsDiv.querySelectorAll('.lookup-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.id;
          const name = item.dataset.name;
          
          searchInput.value = name;
          hiddenInput.value = id;
          appState.fields[fieldName] = id;
          
          resultsDiv.style.display = 'none';
        });
      });
    }, 500);
  });
  
  // Fecha ao clicar fora
  document.addEventListener('click', (e) => {
    if (!row.contains(e.target)) {
      resultsDiv.style.display = 'none';
    }
  });
  
  // Mostra cache ao focar
  searchInput.addEventListener('focus', () => {
    const cached = appState.lookupCache.get(fieldName);
    if (cached && cached.length > 0 && !searchInput.value) {
      resultsDiv.innerHTML = cached.map(record => `
        <div class="lookup-item" data-id="${record.Id}" data-name="${record.Name}">
          <strong>${record.Name}</strong>
          <small>${record.Id}</small>
        </div>
      `).join('');
      
      resultsDiv.style.display = 'block';
      
      resultsDiv.querySelectorAll('.lookup-item').forEach(item => {
        item.addEventListener('click', () => {
          const id = item.dataset.id;
          const name = item.dataset.name;
          
          searchInput.value = name;
          hiddenInput.value = id;
          appState.fields[fieldName] = id;
          
          resultsDiv.style.display = 'none';
        });
      });
    }
  });
}

// ============================================================
// ADICIONAR NOVO CAMPO
// ============================================================
function addNewFieldRow() {
  const container = document.getElementById('fieldsContainer');
  
  const row = document.createElement('div');
  row.className = 'field-row field-row-new';
  
  const availableFields = appState.metadata.fields
    .filter(f => f.createable && !appState.fields[f.name])
    .sort((a, b) => a.label.localeCompare(b.label));
  
  const fieldOptions = availableFields
    .map(f => {
      const required = (!f.nillable && !f.defaultedOnCreate) ? ' *' : '';
      const isLookup = f.referenceTo && f.referenceTo.length > 0 ? ' 🔗' : '';
      return `<option value="${f.name}">${f.label}${required}${isLookup}</option>`;
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
  const removeBtn = row.querySelector('.btn-remove-field');
  
  select.addEventListener('change', async () => {
    const fieldName = select.value;
    if (!fieldName) return;
    
    const fieldMeta = appState.metadata.fields.find(f => f.name === fieldName);
    if (!fieldMeta) return;
    
    row.classList.remove('field-row-new');
    row.dataset.fieldname = fieldName;
    
    const labelContainer = row.querySelector('.field-label-container');
    const isRequired = !fieldMeta.nillable && !fieldMeta.defaultedOnCreate;
    
    labelContainer.innerHTML = `
      <div class="field-label">
        ${fieldMeta.label}
        ${isRequired ? '<span class="required-badge">*</span>' : ''}
      </div>
      <div class="field-api-name">${fieldName}</div>
    `;
    
    const inputGroup = row.querySelector('.field-input-group');
    let newInput = '';
    
    if (fieldMeta.referenceTo && fieldMeta.referenceTo.length > 0) {
      newInput = await createLookupInput(fieldName, fieldMeta, '');
    } else if (fieldMeta.picklistValues && fieldMeta.picklistValues.length > 0) {
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
    
    if (fieldMeta.referenceTo && fieldMeta.referenceTo.length > 0) {
      setupLookupInput(row, fieldName, fieldMeta);
    }
    
    inputGroup.querySelector('.btn-remove-field').addEventListener('click', () => {
      delete appState.fields[fieldName];
      row.remove();
    });
    
    const finalInput = inputGroup.querySelector('.field-input, .lookup-search');
    if (finalInput) finalInput.focus();
  });
  
  removeBtn.addEventListener('click', () => row.remove());
  select.focus();
}

// ============================================================
// CONFIRMAÇÃO E INSERÇÃO
// ============================================================
async function confirmInsert() {
  try {
    setProcessing(true);
    appState.step = 'inserting';
    
    // Coleta valores de todos os inputs
    document.querySelectorAll('.field-input').forEach(input => {
      const fieldName = input.dataset.field;
      appState.fields[fieldName] = input.value;
    });
    
    // Coleta IDs dos lookups
    document.querySelectorAll('.lookup-id').forEach(hidden => {
      const fieldName = hidden.dataset.field;
      if (hidden.value) {
        appState.fields[fieldName] = hidden.value;
      }
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
  appState.lookupCache.clear();
  showStatus('info', 'Processo cancelado');
}

// Continua nos próximos artefatos...

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



async function generateSOQLFromNaturalLanguage() {
  const prompt = document.getElementById('naturalSoql').value.trim();
  const queryResult = document.getElementById('queryResult');

  if (!prompt) {
    queryResult.classList.remove('hidden');
    queryResult.textContent = 'Descreva em linguagem natural o que deseja consultar.';
    return;
  }

  try {
    queryResult.classList.remove('hidden');
    queryResult.textContent = '✨ Gerando SOQL com IA...';

    const generated = await window.aiProcessor.generateSOQLFromNaturalLanguage(prompt);
    document.getElementById('query').value = generated.query || '';
    queryResult.textContent = `SOQL gerada (${generated.confidence || 'sem confiança'}):\n${generated.query}`;
  } catch (error) {
    queryResult.classList.remove('hidden');
    queryResult.textContent = `❌ Erro ao gerar SOQL: ${error.message}`;
  }
}

async function generateChartFromResult() {
  const queryResult = document.getElementById('queryResult');
  const chartCode = document.getElementById('chartCode');
  const chartPreview = document.getElementById('chartPreview');

  if (!appState.lastSoqlResult || !Array.isArray(appState.lastSoqlResult.records)) {
    queryResult.classList.remove('hidden');
    queryResult.textContent = 'Execute uma SOQL primeiro para gerar o gráfico.';
    return;
  }

  try {
    queryResult.classList.remove('hidden');
    queryResult.textContent = '📊 Gerando HTML/CSS/JS do gráfico com IA...';

    const naturalPrompt = document.getElementById('naturalSoql').value.trim();
    const chart = await window.aiProcessor.generateChartHtml({
      prompt: naturalPrompt,
      query: document.getElementById('query').value.trim(),
      result: appState.lastSoqlResult
    });

    const html = chart.html || '';
    appState.lastChartHtml = html;

    chartPreview.classList.remove('hidden');
    chartPreview.srcdoc = html;

    chartCode.classList.remove('hidden');
    chartCode.textContent = html;

    queryResult.textContent = '✅ Gráfico gerado. Pré-visualização e código HTML disponíveis abaixo.';
  } catch (error) {
    queryResult.classList.remove('hidden');
    queryResult.textContent = `❌ Erro ao gerar gráfico: ${error.message}`;
  }
}

async function saveChartHtml() {
  const queryResult = document.getElementById('queryResult');

  if (!appState.lastChartHtml) {
    queryResult.classList.remove('hidden');
    queryResult.textContent = 'Gere um gráfico primeiro para salvar o HTML.';
    return;
  }

  try {
    const filename = `salesforce-chart-${Date.now()}.html`;

    const { saved_chart_html = [] } = await chrome.storage.local.get('saved_chart_html');
    const updated = [{ filename, html: appState.lastChartHtml, createdAt: new Date().toISOString() }, ...saved_chart_html].slice(0, 20);
    await chrome.storage.local.set({ saved_chart_html: updated });

    const blob = new Blob([appState.lastChartHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);

    queryResult.classList.remove('hidden');
    queryResult.textContent = `💾 HTML salvo no storage local e baixado como ${filename}.`;
  } catch (error) {
    queryResult.classList.remove('hidden');
    queryResult.textContent = `❌ Erro ao salvar HTML: ${error.message}`;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SOQL_RESULT') {
    appState.lastSoqlResult = msg.data;
    document.getElementById('queryResult').classList.remove('hidden');
    document.getElementById('queryResult').textContent = JSON.stringify(msg.data, null, 2);
  } else if (msg.type === 'SOQL_ERROR') {
    document.getElementById('queryResult').classList.remove('hidden');
    document.getElementById('queryResult').textContent = `❌ Erro: ${msg.error}`;
  }
});