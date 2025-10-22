// content.js - Injeção direta com UI flutuante e lógica avançada

function bgSend(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

window.__SF_SESSION__ = null;
window.__SF_HOST__ = null;

async function ensureSession() {
  const host = await bgSend({ message: "getSfHost", url: window.location.href });
  window.__SF_HOST__ = host || window.location.hostname;

  const session = await bgSend({ message: "getSession", sfHost: window.__SF_HOST__ });
  if (!session) {
    console.warn("Não foi possível obter session via cookies");
    return null;
  }

  window.__SF_SESSION__ = session;
  return session;
}

function createInitialState() {
  return {
    step: 'idle',
    objectName: null,
    fields: {},
    metadata: null,
    questions: [],
    lookupCache: new Map()
  };
}

let currentState = createInitialState();

function resetState() {
  currentState = createInitialState();
}

// ============================================================
// SOQL E OPERAÇÕES DE DADOS
// ============================================================
async function runSoql(query) {
  if (!window.__SF_SESSION__) {
    await ensureSession();
    if (!window.__SF_SESSION__) throw new Error("Session not available");
  }

  const session = window.__SF_SESSION__;
  const path = `/services/data/v61.0/query?q=${encodeURIComponent(query)}`;

  const result = await bgSend({
    message: "callApi",
    session,
    path,
    method: "GET"
  });

  if (!result.ok) {
    throw new Error(result.error || JSON.stringify(result.data));
  }

  const data = result.data;
  if (Array.isArray(data) && data[0]?.errorCode === "INVALID_SESSION_ID") {
    await ensureSession();
    return runSoql(query);
  }

  return data;
}

async function getObjectMetadata(objectName) {
  if (!window.__SF_SESSION__) {
    await ensureSession();
    if (!window.__SF_SESSION__) throw new Error("Session not available");
  }

  const session = window.__SF_SESSION__;
  const path = `/services/data/v61.0/sobjects/${encodeURIComponent(objectName)}/describe`;

  const result = await bgSend({
    message: "callApi",
    session,
    path,
    method: "GET"
  });

  if (!result.ok) {
    throw new Error(result.error || JSON.stringify(result.data));
  }

  const data = result.data;
  if (Array.isArray(data) && data[0]?.errorCode) {
    throw new Error(`Salesforce Error: ${data[0].message}`);
  }

  const metadata = result.data;
  return {
    name: metadata.name,
    label: metadata.label,
    fields: metadata.fields.map(f => ({
      name: f.name,
      label: f.label,
      type: f.type,
      length: f.length,
      precision: f.precision,
      scale: f.scale,
      nillable: f.nillable,
      createable: f.createable,
      updateable: f.updateable,
      defaultedOnCreate: f.defaultedOnCreate,
      picklistValues: f.picklistValues,
      referenceTo: f.referenceTo
    }))
  };
}

async function insertRecord(objectName, fields) {
  if (!window.__SF_SESSION__) {
    await ensureSession();
    if (!window.__SF_SESSION__) throw new Error("Session not available");
  }

  const session = window.__SF_SESSION__;
  const path = `/services/data/v61.0/sobjects/${encodeURIComponent(objectName)}/`;

  const result = await bgSend({
    message: "callApi",
    session,
    path,
    method: "POST",
    body: fields
  });

  if (!result.ok) {
    throw new Error(result.error || JSON.stringify(result.data));
  }

  const data = result.data;
  if (Array.isArray(data) && data[0]?.errorCode) {
    throw data;
  }

  return data;
}

async function updateRecord(objectName, id, fields) {
  if (!window.__SF_SESSION__) {
    await ensureSession();
    if (!window.__SF_SESSION__) throw new Error("Session not available");
  }

  const session = window.__SF_SESSION__;
  const path = `/services/data/v61.0/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}`;

  const result = await bgSend({
    message: "callApi",
    session,
    path,
    method: "PATCH",
    body: fields
  });

  if (!result.ok) {
    throw new Error(result.error || JSON.stringify(result.data));
  }

  const data = result.data;
  if (Array.isArray(data) && data[0]?.errorCode) {
    throw data;
  }

  return data;
}

async function deleteRecord(objectName, id) {
  if (!window.__SF_SESSION__) {
    await ensureSession();
    if (!window.__SF_SESSION__) throw new Error("Session not available");
  }

  const session = window.__SF_SESSION__;
  const path = `/services/data/v61.0/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}`;

  const result = await bgSend({
    message: "callApi",
    session,
    path,
    method: "DELETE"
  });

  if (!result.ok) {
    throw new Error(result.error || JSON.stringify(result.data));
  }

  return result.data;
}

// ============================================================
// UI HELPERS
// ============================================================
function showStatus(type, message) {
  const area = document.getElementById('sf-status-area');
  if (!area) return;

  const classes = {
    info: 'sf-status-info',
    success: 'sf-status-success',
    warning: 'sf-status-warning',
    error: 'sf-status-error'
  };

  const div = document.createElement('div');
  div.className = `sf-status ${classes[type] || classes.info}`;
  div.innerHTML = message.replace(/\n/g, '<br>');
  area.innerHTML = '';
  area.appendChild(div);
}

function clearStatus() {
  const area = document.getElementById('sf-status-area');
  if (area) area.innerHTML = '';
}

function addChatMessage(sender, text) {
  const chatArea = document.getElementById('sf-chat-area');
  if (!chatArea) return;

  chatArea.classList.remove('sf-hidden');
  const msg = document.createElement('div');
  msg.className = `sf-chat-message sf-chat-${sender}`;
  msg.innerHTML = text
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  chatArea.appendChild(msg);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function resetChat() {
  const chatArea = document.getElementById('sf-chat-area');
  if (chatArea) {
    chatArea.innerHTML = '';
    chatArea.classList.add('sf-hidden');
  }
}

function showCorrectionInput() {
  const area = document.getElementById('sf-correction-area');
  if (!area) return;
  area.classList.remove('sf-hidden');
  const textarea = document.getElementById('sf-user-response');
  if (textarea) textarea.focus();
}

function hideCorrectionInput() {
  const area = document.getElementById('sf-correction-area');
  if (area) area.classList.add('sf-hidden');
}

function resetCorrectionInput() {
  hideCorrectionInput();
  const textarea = document.getElementById('sf-user-response');
  if (textarea) textarea.value = '';
}

function resetFieldsEditor() {
  const container = document.getElementById('sf-fields-list');
  if (container) container.innerHTML = '';
  const editor = document.getElementById('sf-fields-editor');
  if (editor) editor.classList.add('sf-hidden');
}

function resetResultArea() {
  const area = document.getElementById('sf-result-area');
  if (area) area.classList.add('sf-hidden');
  const content = document.getElementById('sf-result-content');
  if (content) content.innerHTML = '';
}

function resetUI() {
  clearStatus();
  resetChat();
  resetCorrectionInput();
  resetFieldsEditor();
  resetResultArea();
}

function setProcessing(isProcessing) {
  const btn = document.getElementById('sf-process-btn');
  const text = document.getElementById('sf-process-text');
  const spinner = document.getElementById('sf-process-spinner');

  if (btn) btn.disabled = isProcessing;
  if (text) text.classList.toggle('sf-hidden', isProcessing);
  if (spinner) spinner.classList.toggle('sf-hidden', !isProcessing);
}

function cancelProcess() {
  resetState();
  resetUI();
  showStatus('info', 'Processo cancelado.');
}

// ============================================================
// PROCESSAMENTO PRINCIPAL
// ============================================================
async function processTranscriptionFull() {
  const textarea = document.getElementById('sf-transcription-input');
  const transcription = textarea ? textarea.value.trim() : '';

  if (!transcription) {
    showStatus('error', '❌ Por favor, digite uma transcrição');
    return;
  }

  try {
    resetState();
    resetUI();
    setProcessing(true);
    showStatus('info', '🔍 Analisando transcrição com IA...');

    await loadScripts();

    if (!window.aiProcessor) {
      throw new Error('AI Processor não disponível. Verifique a configuração.');
    }

    if (!window.aiProcessor.isInitialized) {
      await window.aiProcessor.initialize();
    }

    currentState.step = 'identifying';

    const identified = await window.aiProcessor.identifyObject(transcription);
    if (!identified || !identified.object) {
      throw new Error('Não foi possível identificar o objeto na transcrição.');
    }

    currentState.objectName = identified.object;
    currentState.fields = { ...(identified.fields || {}) };
    addChatMessage('ai', `Identifiquei que você quer criar um **${identified.object}**.`);

    showStatus('info', `📚 Consultando estrutura do ${identified.object} na sua org...`);
    currentState.metadata = await window.aiProcessor.getObjectMetadata(identified.object);

    await processLookupFields(transcription);

    showStatus('info', '🤖 Validando dados com base na configuração da sua org...');
    const enriched = await window.aiProcessor.validateAndEnrichFields(
      identified.object,
      identified.fields,
      transcription
    );

    currentState.fields = { ...currentState.fields, ...(enriched.fields || {}) };

    if (enriched.autoCorrections && enriched.autoCorrections.length > 0) {
      addChatMessage('ai', `🔧 **Correções automáticas aplicadas:**\n${enriched.autoCorrections.map(c => `• ${c}`).join('\n')}`);
    }

    const hasIssues = (enriched.missingRequired && enriched.missingRequired.length > 0) ||
                      (enriched.invalidValues && enriched.invalidValues.length > 0) ||
                      (enriched.needsUserInput && enriched.needsUserInput.length > 0);

    if (hasIssues) {
      await handleEnrichmentIssues(enriched);
    } else {
      await showConfirmationSummary();
    }

    currentState.step = 'ready';
  } catch (error) {
    console.error('Erro no processamento completo:', error);
    showStatus('error', `❌ Erro: ${error.message}`);
    addChatMessage('ai', `❌ Ops! Ocorreu um erro: ${error.message}`);
  } finally {
    setProcessing(false);
  }
}

async function processLookupFields(transcription) {
  if (!currentState.metadata) return;

  const lookupFields = currentState.metadata.fields.filter(f =>
    f.referenceTo && f.referenceTo.length > 0 && f.createable
  );

  if (lookupFields.length === 0) return;

  showStatus('info', '🔍 Buscando registros relacionados...');

  for (const lookupField of lookupFields) {
    try {
      const searchTerm = await extractLookupSearchTerm(transcription, lookupField);
      if (!searchTerm) continue;

      const results = await searchLookupRecords(lookupField.referenceTo[0], searchTerm);
      if (!results || results.length === 0) continue;

      currentState.lookupCache.set(lookupField.name, results);

      if (results.length === 1) {
        currentState.fields[lookupField.name] = results[0].Id;
        addChatMessage('ai', `✅ Encontrei automaticamente: **${results[0].Name}** para ${lookupField.label}`);
      } else {
        addChatMessage('ai', `🔍 Encontrei ${results.length} opções para **${lookupField.label}**. Você poderá selecionar na revisão.`);
      }
    } catch (error) {
      console.warn('Erro ao processar lookup', lookupField.name, error);
    }
  }
}

async function extractLookupSearchTerm(transcription, lookupField) {
  try {
    const messages = [
      {
        role: 'system',
        content: `Analise a transcrição e extraia o termo de busca para o campo lookup "${lookupField.label}" que referencia "${lookupField.referenceTo?.[0] || ''}".

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
    return result?.searchTerm || null;
  } catch (error) {
    console.warn('Erro ao extrair termo de busca:', error);
    return null;
  }
}

async function searchLookupRecords(objectName, searchTerm, limit = 10) {
  try {
    const sanitized = searchTerm.replace(/'/g, "\\'");
    const query = `SELECT Id, Name FROM ${objectName} WHERE Name LIKE '%${sanitized}%' LIMIT ${limit}`;
    const data = await runSoql(query);
    return data.records || [];
  } catch (error) {
    console.error('Erro ao buscar lookup:', error);
    return [];
  }
}

async function searchLookupRealtime(fieldName, searchTerm) {
  if (!searchTerm || searchTerm.length < 2) return [];
  if (!currentState.metadata) return [];

  const fieldMeta = currentState.metadata.fields.find(f => f.name === fieldName);
  if (!fieldMeta || !fieldMeta.referenceTo || fieldMeta.referenceTo.length === 0) return [];

  return await searchLookupRecords(fieldMeta.referenceTo[0], searchTerm, 20);
}

async function handleEnrichmentIssues(enriched) {
  const issues = [];

  if (enriched.missingRequired && enriched.missingRequired.length > 0) {
    issues.push(`**⚠️ Campos obrigatórios faltando:**\n${enriched.missingRequired.map(f => `• ${f.label} (${f.name})`).join('\n')}`);
  }

  if (enriched.invalidValues && enriched.invalidValues.length > 0) {
    issues.push(`**❌ Valores inválidos:**\n${enriched.invalidValues.map(v => `• ${v.field}: ${v.reason}${v.suggestion ? `\n  Sugestão: ${v.suggestion}` : ''}`).join('\n')}`);
  }

  if (issues.length > 0) {
    addChatMessage('ai', issues.join('\n\n'));
  }

  if (enriched.needsUserInput && enriched.needsUserInput.length > 0) {
    currentState.questions = enriched.needsUserInput.map(q => q.question);
    addChatMessage('ai', currentState.questions.join('\n\n'));
    showCorrectionInput();
    showStatus('warning', '⚠️ Preciso de mais informações para continuar.');
    return;
  }

  showStatus('warning', '⚠️ Alguns campos obrigatórios precisam ser revisados.');
  await showConfirmationSummary();
}

async function showConfirmationSummary() {
  currentState.step = 'ready';

  const summary = Object.entries(currentState.fields)
    .map(([key, value]) => {
      const fieldMeta = currentState.metadata?.fields.find(f => f.name === key);
      const label = fieldMeta ? fieldMeta.label : key;
      return `• **${label}**: ${value}`;
    })
    .join('\n');

  if (summary) {
    addChatMessage('ai', `📋 **Resumo dos dados identificados:**\n\n${summary}\n\n✅ Revise os campos e ajuste se necessário.`);
  }

  renderFieldsEditor();
  showStatus('success', '✅ Dados prontos para revisão.');
}

function renderFieldsEditor() {
  if (!currentState.metadata) return;

  const editor = document.getElementById('sf-fields-editor');
  const container = document.getElementById('sf-fields-list');

  if (!editor || !container) return;

  container.innerHTML = '';

  const entries = Object.entries(currentState.fields);
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sf-empty-state';
    empty.textContent = 'Nenhum campo identificado ainda. Adicione manualmente se necessário.';
    container.appendChild(empty);
  }

  for (const [fieldName, value] of entries) {
    const row = buildFieldRow(fieldName, value);
    container.appendChild(row);
  }

  editor.classList.remove('sf-hidden');
}

function buildFieldRow(fieldName, value) {
  const row = document.createElement('div');
  row.className = 'sf-field-row';
  row.dataset.field = fieldName;

  const fieldMeta = currentState.metadata?.fields.find(f => f.name === fieldName);
  const label = fieldMeta ? fieldMeta.label : fieldName;
  const isRequired = fieldMeta ? (!fieldMeta.nillable && !fieldMeta.defaultedOnCreate) : false;

  const labelContainer = document.createElement('div');
  labelContainer.className = 'sf-field-label-container';

  const labelEl = document.createElement('div');
  labelEl.className = 'sf-field-label';
  labelEl.innerHTML = `${label}${isRequired ? ' <span class="sf-required">*</span>' : ''}`;

  const apiEl = document.createElement('div');
  apiEl.className = 'sf-field-api';
  apiEl.textContent = fieldName;

  labelContainer.appendChild(labelEl);
  labelContainer.appendChild(apiEl);

  const inputGroup = document.createElement('div');
  inputGroup.className = 'sf-field-input-group';

  let inputElement;

  if (fieldMeta && fieldMeta.referenceTo && fieldMeta.referenceTo.length > 0) {
    inputElement = createLookupInput(fieldName, fieldMeta, value);
  } else if (fieldMeta && fieldMeta.picklistValues && fieldMeta.picklistValues.length > 0) {
    const select = document.createElement('select');
    select.className = 'sf-field-input';
    select.dataset.field = fieldName;

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '-- Selecione --';
    select.appendChild(emptyOption);

    fieldMeta.picklistValues
      .filter(pv => pv.active)
      .forEach(pv => {
        const option = document.createElement('option');
        option.value = pv.value;
        option.textContent = pv.label;
        if (pv.value === value) option.selected = true;
        select.appendChild(option);
      });

    select.addEventListener('change', (e) => {
      currentState.fields[fieldName] = e.target.value;
    });

    inputElement = select;
  } else if (fieldMeta && fieldMeta.type === 'boolean') {
    const select = document.createElement('select');
    select.className = 'sf-field-input';
    select.dataset.field = fieldName;

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = '-- Selecione --';
    select.appendChild(emptyOption);

    const trueOption = document.createElement('option');
    trueOption.value = 'true';
    trueOption.textContent = 'Sim';
    if (value === true || value === 'true') trueOption.selected = true;

    const falseOption = document.createElement('option');
    falseOption.value = 'false';
    falseOption.textContent = 'Não';
    if (value === false || value === 'false') falseOption.selected = true;

    select.appendChild(trueOption);
    select.appendChild(falseOption);

    select.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'true') {
        currentState.fields[fieldName] = true;
      } else if (val === 'false') {
        currentState.fields[fieldName] = false;
      } else {
        currentState.fields[fieldName] = '';
      }
    });

    inputElement = select;
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'sf-field-input';
    input.dataset.field = fieldName;
    input.value = value ?? '';
    input.placeholder = 'Digite o valor...';

    input.addEventListener('input', (e) => {
      currentState.fields[fieldName] = e.target.value;
    });

    inputElement = input;
  }

  const removeBtn = document.createElement('button');
  removeBtn.className = 'sf-field-remove';
  removeBtn.type = 'button';
  removeBtn.dataset.field = fieldName;
  removeBtn.title = 'Remover campo';
  removeBtn.textContent = '🗑️';

  removeBtn.addEventListener('click', () => {
    delete currentState.fields[fieldName];
    currentState.lookupCache.delete(fieldName);
    row.remove();
  });

  inputGroup.appendChild(inputElement);
  inputGroup.appendChild(removeBtn);

  row.appendChild(labelContainer);
  row.appendChild(inputGroup);

  return row;
}

function createLookupInput(fieldName, fieldMeta, value) {
  const container = document.createElement('div');
  container.className = 'sf-lookup-container';
  container.dataset.field = fieldName;

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'sf-lookup-search';
  searchInput.dataset.field = fieldName;
  searchInput.placeholder = 'Digite para buscar...';
  searchInput.autocomplete = 'off';

  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'hidden';
  hiddenInput.className = 'sf-lookup-id';
  hiddenInput.dataset.field = fieldName;

  const resultsDiv = document.createElement('div');
  resultsDiv.className = 'sf-lookup-results';
  resultsDiv.dataset.field = fieldName;
  resultsDiv.style.display = 'none';

  const cachedResults = currentState.lookupCache.get(fieldName) || [];
  if (value) {
    hiddenInput.value = value;
    const selected = cachedResults.find(r => r.Id === value);
    searchInput.value = selected ? selected.Name : value;
  }

  container.appendChild(searchInput);
  container.appendChild(hiddenInput);
  container.appendChild(resultsDiv);

  setupLookupInput(container, fieldName, fieldMeta);
  return container;
}

function setupLookupInput(container, fieldName, fieldMeta) {
  const searchInput = container.querySelector('.sf-lookup-search');
  const hiddenInput = container.querySelector('.sf-lookup-id');
  const resultsDiv = container.querySelector('.sf-lookup-results');

  let searchTimeout;

  searchInput.addEventListener('input', () => {
    const term = searchInput.value.trim();
    hiddenInput.value = '';
    currentState.fields[fieldName] = '';

    clearTimeout(searchTimeout);

    if (term.length < 2) {
      resultsDiv.style.display = 'none';
      resultsDiv.innerHTML = '';
      return;
    }

    searchTimeout = setTimeout(async () => {
      resultsDiv.innerHTML = '<div class="sf-lookup-loading">🔍 Buscando...</div>';
      resultsDiv.style.display = 'block';

      const results = await searchLookupRealtime(fieldName, term);
      currentState.lookupCache.set(fieldName, results);

      if (!results || results.length === 0) {
        resultsDiv.innerHTML = '<div class="sf-lookup-empty">Nenhum registro encontrado</div>';
        return;
      }

      resultsDiv.innerHTML = '';
      results.forEach(record => {
        const item = document.createElement('div');
        item.className = 'sf-lookup-item';
        item.dataset.id = record.Id;
        item.dataset.name = record.Name;
        item.innerHTML = `<strong>${record.Name}</strong><small>${record.Id}</small>`;
        item.addEventListener('click', () => {
          hiddenInput.value = record.Id;
          searchInput.value = record.Name;
          currentState.fields[fieldName] = record.Id;
          resultsDiv.style.display = 'none';
        });
        resultsDiv.appendChild(item);
      });
    }, 400);
  });

  searchInput.addEventListener('focus', () => {
    const cached = currentState.lookupCache.get(fieldName);
    if (cached && cached.length > 0 && !searchInput.value) {
      resultsDiv.innerHTML = '';
      cached.forEach(record => {
        const item = document.createElement('div');
        item.className = 'sf-lookup-item';
        item.dataset.id = record.Id;
        item.dataset.name = record.Name;
        item.innerHTML = `<strong>${record.Name}</strong><small>${record.Id}</small>`;
        item.addEventListener('click', () => {
          hiddenInput.value = record.Id;
          searchInput.value = record.Name;
          currentState.fields[fieldName] = record.Id;
          resultsDiv.style.display = 'none';
        });
        resultsDiv.appendChild(item);
      });
      resultsDiv.style.display = 'block';
    }
  });

  document.addEventListener('click', (event) => {
    if (!container.contains(event.target)) {
      resultsDiv.style.display = 'none';
    }
  });
}

function addNewFieldRow() {
  if (!currentState.metadata) return;

  const container = document.getElementById('sf-fields-list');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'sf-field-row sf-field-row-new';

  const labelContainer = document.createElement('div');
  labelContainer.className = 'sf-field-label-container';

  const select = document.createElement('select');
  select.className = 'sf-field-select';

  const optionDefault = document.createElement('option');
  optionDefault.value = '';
  optionDefault.textContent = '-- Selecione um campo --';
  select.appendChild(optionDefault);

  currentState.metadata.fields
    .filter(f => f.createable && !currentState.fields[f.name])
    .sort((a, b) => a.label.localeCompare(b.label))
    .forEach(f => {
      const option = document.createElement('option');
      option.value = f.name;
      const required = (!f.nillable && !f.defaultedOnCreate) ? ' *' : '';
      const isLookup = f.referenceTo && f.referenceTo.length > 0 ? ' 🔗' : '';
      option.textContent = `${f.label}${required}${isLookup}`;
      select.appendChild(option);
    });

  labelContainer.appendChild(select);

  const inputGroup = document.createElement('div');
  inputGroup.className = 'sf-field-input-group';

  const placeholder = document.createElement('input');
  placeholder.type = 'text';
  placeholder.className = 'sf-field-input';
  placeholder.placeholder = 'Aguardando seleção...';
  placeholder.disabled = true;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'sf-field-remove';
  removeBtn.title = 'Remover campo';
  removeBtn.textContent = '🗑️';

  inputGroup.appendChild(placeholder);
  inputGroup.appendChild(removeBtn);

  row.appendChild(labelContainer);
  row.appendChild(inputGroup);

  container.appendChild(row);

  removeBtn.addEventListener('click', () => {
    row.remove();
  });

  select.addEventListener('change', () => {
    const fieldName = select.value;
    if (!fieldName) return;

    const newRow = buildFieldRow(fieldName, '');
    container.replaceChild(newRow, row);
    currentState.fields[fieldName] = '';
  });
}

async function submitUserResponse() {
  const textarea = document.getElementById('sf-user-response');
  const response = textarea ? textarea.value.trim() : '';

  if (!response) {
    showStatus('error', '❌ Digite uma resposta antes de continuar.');
    return;
  }

  try {
    setProcessing(true);
    addChatMessage('user', response);
    showStatus('info', '🤖 Processando sua resposta...');

    const relevantChunks = window.metadataChunker?.searchRelevantChunks(
      currentState.objectName,
      response
    ) || [];
    const context = window.metadataChunker?.generateCompactContext(
      currentState.objectName,
      relevantChunks
    );

    const messages = [
      {
        role: 'system',
        content: `Você é um assistente Salesforce. Baseado na resposta do usuário e nos metadados reais da org, atualize os campos.

CONTEXTO DA ORG:
${JSON.stringify(context, null, 2)}

CAMPOS ATUAIS:
${JSON.stringify(currentState.fields, null, 2)}

PERGUNTAS FEITAS:
${currentState.questions.join('\n')}

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

    currentState.fields = { ...currentState.fields, ...(updated.fields || {}) };

    if (updated.changes && updated.changes.length > 0) {
      addChatMessage('ai', `✅ **Atualizado:**\n${updated.changes.map(c => `• ${c}`).join('\n')}`);
    }

    textarea.value = '';

    const revalidated = await window.aiProcessor.validateAndEnrichFields(
      currentState.objectName,
      currentState.fields,
      JSON.stringify(currentState.fields)
    );

    const hasIssues = (revalidated.missingRequired && revalidated.missingRequired.length > 0) ||
                      (revalidated.invalidValues && revalidated.invalidValues.length > 0) ||
                      (revalidated.needsUserInput && revalidated.needsUserInput.length > 0);

    if (hasIssues) {
      await handleEnrichmentIssues(revalidated);
    } else {
      resetCorrectionInput();
      await showConfirmationSummary();
    }
  } catch (error) {
    console.error('Erro ao processar resposta do usuário:', error);
    showStatus('error', `❌ Erro: ${error.message}`);
  } finally {
    setProcessing(false);
  }
}

async function confirmInsertion() {
  if (!currentState.objectName) {
    showStatus('error', '❌ Nenhum objeto identificado para inserir.');
    return;
  }

  try {
    const confirmBtn = document.getElementById('sf-confirm-insert');
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<div class="sf-spinner"></div> Criando...';
    }

    const inputs = document.querySelectorAll('.sf-field-input');
    inputs.forEach(input => {
      const fieldName = input.dataset.field;
      if (!fieldName) return;
      if (input.tagName === 'SELECT') {
        currentState.fields[fieldName] = input.value;
      } else {
        currentState.fields[fieldName] = input.value;
      }
    });

    const lookups = document.querySelectorAll('.sf-lookup-id');
    lookups.forEach(input => {
      const fieldName = input.dataset.field;
      currentState.fields[fieldName] = input.value;
    });

    addChatMessage('ai', '💾 Criando registro no Salesforce...');

    const result = await insertRecord(currentState.objectName, currentState.fields);
    showInsertSuccess(result);
    resetState();
  } catch (error) {
    showInsertError(error);
  } finally {
    const confirmBtn = document.getElementById('sf-confirm-insert');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<span>✅ Criar Registro</span>';
    }
  }
}

function showInsertSuccess(data) {
  const resultArea = document.getElementById('sf-result-area');
  const resultTitle = document.getElementById('sf-result-title');
  const resultContent = document.getElementById('sf-result-content');

  if (!resultArea || !resultTitle || !resultContent) return;

  resultTitle.textContent = '✅ Registro criado com sucesso!';
  resultContent.innerHTML = `
    <strong>ID:</strong> ${data.id}<br>
    <strong>Objeto:</strong> ${currentState.objectName || ''}
  `;

  resultArea.classList.remove('sf-hidden');
  showStatus('success', '🎉 Registro criado com sucesso!');
  addChatMessage('ai', `🎉 Registro criado com sucesso! ID: ${data.id}`);
  resetFieldsEditor();
}

function showInsertError(error) {
  const resultArea = document.getElementById('sf-result-area');
  const resultTitle = document.getElementById('sf-result-title');
  const resultContent = document.getElementById('sf-result-content');

  if (!resultArea || !resultTitle || !resultContent) return;

  resultTitle.textContent = '❌ Erro ao criar registro';
  resultContent.innerHTML = `<pre style="color: #721c24; font-size: 12px;">${typeof error === 'string' ? error : JSON.stringify(error, null, 2)}</pre>`;

  resultArea.classList.remove('sf-hidden');
  showStatus('error', '❌ Erro ao criar registro. Veja detalhes abaixo.');
  addChatMessage('ai', '❌ Não foi possível criar o registro. Verifique os detalhes exibidos.');
}

async function runSOQLQuery() {
  const textarea = document.getElementById('sf-soql-input');
  const query = textarea ? textarea.value.trim() : '';
  const resultDiv = document.getElementById('sf-soql-result');
  const contentDiv = document.getElementById('sf-soql-content');

  if (!query) {
    alert('Digite uma query SOQL');
    return;
  }

  try {
    if (resultDiv) resultDiv.classList.remove('sf-hidden');
    if (contentDiv) contentDiv.textContent = '⏳ Executando query...';

    const data = await runSoql(query);
    if (contentDiv) {
      contentDiv.textContent = JSON.stringify(data, null, 2);
    }
  } catch (error) {
    if (contentDiv) {
      contentDiv.textContent = `❌ Erro: ${error.message}`;
    }
  }
}

// ============================================================
// CARREGAR SCRIPTS
// ============================================================
async function loadScripts() {
  if (window.aiProcessor && window.metadataChunker) {
    return;
  }

  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 50;

    const interval = setInterval(() => {
      attempts += 1;

      if (window.aiProcessor && window.metadataChunker) {
        clearInterval(interval);
        resolve();
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

// ============================================================
// UI E INICIALIZAÇÃO
// ============================================================
function injectFlowInterface() {
  if (document.getElementById('sf-ai-flow-container')) {
    return;
  }

  const style = document.createElement('style');
  style.textContent = `
    #sf-ai-flow-overlay {
      display: none;
    }

    #sf-ai-flow-container {
      position: fixed;
      bottom: 120px;
      right: 32px;
      width: 520px;
      height: 640px;
      min-width: 420px;
      min-height: 420px;
      max-width: 90vw;
      max-height: 90vh;
      background: white;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      z-index: 999999;
      display: none;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      border-radius: 18px;
      overflow: hidden;
      resize: both;
    }

    #sf-ai-flow-container.active {
      display: flex;
    }

    .sf-flow-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      cursor: move;
      user-select: none;
      position: relative;
    }

    .sf-flow-header::before {
      content: '⋮⋮';
      position: absolute;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      opacity: 0.4;
      font-size: 16px;
      letter-spacing: -2px;
    }

    .sf-flow-header h1 {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      margin-left: 24px;
    }

    .sf-flow-header-actions {
      display: flex;
      gap: 8px;
    }

    .sf-flow-btn {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s;
      color: white;
      font-size: 16px;
    }

    .sf-flow-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .sf-flow-content {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      background: #f5f7fb;
    }

    .sf-tabs {
      display: flex;
      background: #f0f2fa;
      border-bottom: 1px solid #e1e5f5;
    }

    .sf-tab {
      padding: 12px 20px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #6c757d;
      transition: all 0.3s;
      border-bottom: 3px solid transparent;
      margin-bottom: -1px;
      flex: 1;
    }

    .sf-tab:hover {
      background: rgba(102, 126, 234, 0.08);
    }

    .sf-tab-active {
      color: #667eea;
      border-bottom-color: #667eea;
      background: white;
    }

    .sf-tab-content {
      display: none;
    }

    .sf-tab-content.sf-tab-active {
      display: block;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .sf-window-header {
      margin-bottom: 24px;
    }

    .sf-window-title {
      font-size: 24px;
      font-weight: 700;
      color: #343a40;
      margin-bottom: 8px;
    }

    .sf-window-subtitle {
      font-size: 14px;
      color: #6c757d;
      line-height: 1.6;
    }

    .sf-input-group {
      margin-bottom: 20px;
    }

    .sf-input-label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #495057;
      margin-bottom: 8px;
    }

    .sf-textarea {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e9ecef;
      border-radius: 12px;
      font-size: 14px;
      font-family: inherit;
      transition: all 0.3s;
      resize: vertical;
      background: white;
    }

    .sf-textarea:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
    }

    .sf-btn {
      padding: 12px 24px;
      border: none;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      justify-content: center;
    }

    .sf-btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      width: 100%;
    }

    .sf-btn-primary:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 8px 16px rgba(102, 126, 234, 0.4);
    }

    .sf-btn-secondary {
      background: #6c757d;
      color: white;
    }

    .sf-btn-secondary:hover:not(:disabled) {
      background: #5a6268;
    }

    .sf-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .sf-btn-group {
      display: flex;
      gap: 12px;
      margin-top: 16px;
      flex-wrap: wrap;
    }

    .sf-status {
      padding: 14px 16px;
      border-radius: 12px;
      margin-top: 20px;
      font-size: 14px;
      line-height: 1.5;
      border: 1px solid transparent;
    }

    .sf-status-info {
      background: #d1ecf1;
      border-color: #bee5eb;
      color: #0c5460;
    }

    .sf-status-success {
      background: #d4edda;
      border-color: #c3e6cb;
      color: #155724;
    }

    .sf-status-warning {
      background: #fff3cd;
      border-color: #ffeeba;
      color: #856404;
    }

    .sf-status-error {
      background: #f8d7da;
      border-color: #f5c6cb;
      color: #721c24;
    }

    .sf-card {
      background: white;
      border: 2px solid #e9ecef;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.05);
    }

    .sf-card-title {
      font-size: 18px;
      font-weight: 600;
      color: #343a40;
      margin-bottom: 12px;
    }

    .sf-card-subtitle {
      font-size: 13px;
      color: #6c757d;
      margin-bottom: 16px;
    }

    .sf-card-content {
      font-size: 14px;
      color: #495057;
      line-height: 1.6;
    }

    .sf-field-row {
      background: #f8f9fa;
      border: 2px solid #e9ecef;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .sf-field-row-new {
      border-style: dashed;
      background: #ffffff;
    }

    .sf-field-label-container {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .sf-field-label {
      font-size: 15px;
      font-weight: 600;
      color: #343a40;
    }

    .sf-field-api {
      font-size: 12px;
      color: #6c757d;
    }

    .sf-required {
      color: #e03131;
      margin-left: 4px;
    }

    .sf-field-input-group {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .sf-field-input,
    .sf-field-select,
    .sf-lookup-search {
      flex: 1;
      padding: 10px 14px;
      border: 2px solid #dee2e6;
      border-radius: 10px;
      font-size: 14px;
      transition: all 0.2s;
      background: white;
    }

    .sf-field-input:focus,
    .sf-field-select:focus,
    .sf-lookup-search:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
    }

    .sf-field-remove {
      border: none;
      background: #ffe3e3;
      color: #c92a2a;
      border-radius: 8px;
      cursor: pointer;
      padding: 8px 12px;
      font-size: 16px;
      transition: all 0.2s;
    }

    .sf-field-remove:hover {
      background: #ffc9c9;
    }

    .sf-lookup-container {
      position: relative;
      flex: 1;
    }

    .sf-lookup-results {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      background: white;
      border: 1px solid #dee2e6;
      border-radius: 12px;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12);
      max-height: 220px;
      overflow-y: auto;
      display: none;
      z-index: 1000000;
    }

    .sf-lookup-item {
      padding: 10px 14px;
      border-bottom: 1px solid #f1f3f5;
      cursor: pointer;
      display: flex;
      flex-direction: column;
    }

    .sf-lookup-item:hover {
      background: #f1f3f5;
    }

    .sf-lookup-item small {
      font-size: 11px;
      color: #868e96;
    }

    .sf-lookup-loading,
    .sf-lookup-empty {
      padding: 12px 14px;
      text-align: center;
      color: #6c757d;
    }

    .sf-empty-state {
      text-align: center;
      color: #868e96;
      padding: 20px;
      border: 2px dashed #dee2e6;
      border-radius: 12px;
      background: white;
    }

    .sf-chat-area {
      max-height: 240px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .sf-chat-message {
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.6;
      background: white;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
      border-left: 4px solid transparent;
    }

    .sf-chat-ai {
      border-left-color: #667eea;
    }

    .sf-chat-user {
      border-left-color: #6c757d;
      background: #f8f9fa;
    }

    .sf-hidden {
      display: none !important;
    }

    .sf-spinner {
      border: 3px solid #f3f3f3;
      border-top: 3px solid #667eea;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      animation: sf-spin 1s linear infinite;
    }

    @keyframes sf-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = 'sf-ai-flow-container';
  container.innerHTML = `
    <div class="sf-flow-header" id="sf-flow-header">
      <h1>🤖 Salesforce AI Assistant</h1>
      <div class="sf-flow-header-actions">
        <button class="sf-flow-btn" id="sf-minimize-flow" title="Minimizar">─</button>
        <button class="sf-flow-btn" id="sf-close-flow" title="Fechar">✕</button>
      </div>
    </div>

    <div class="sf-tabs">
      <button class="sf-tab sf-tab-active" data-tab="ai">✨ IA Assistant</button>
      <button class="sf-tab" data-tab="soql">🔍 SOQL</button>
    </div>

    <div class="sf-flow-content">
      <div id="sf-tab-ai" class="sf-tab-content sf-tab-active">
        <div class="sf-window-header">
          <h2 class="sf-window-title">📝 Digite sua transcrição</h2>
          <p class="sf-window-subtitle">
            Descreva em linguagem natural o registro que você quer criar no Salesforce.
          </p>
        </div>

        <div class="sf-input-group">
          <label class="sf-input-label">Texto ou transcrição</label>
          <textarea id="sf-transcription-input" class="sf-textarea" rows="8" placeholder="Exemplo:\n'Criar um contato chamado João Silva, email joao@empresa.com, telefone 11 98765-4321, trabalha na Acme Corp'"></textarea>
        </div>

        <button class="sf-btn sf-btn-primary" id="sf-process-btn" type="button">
          <span id="sf-process-text">🚀 Processar com IA</span>
          <div id="sf-process-spinner" class="sf-spinner sf-hidden"></div>
        </button>

        <div id="sf-status-area"></div>

        <div id="sf-chat-area" class="sf-chat-area sf-hidden" style="margin-top: 20px;"></div>

        <div id="sf-correction-area" class="sf-hidden" style="margin-top: 20px;">
          <div class="sf-card">
            <div class="sf-card-title">ℹ️ Mais informações necessárias</div>
            <div class="sf-card-subtitle">Responda às perguntas para continuar o fluxo.</div>
            <textarea id="sf-user-response" class="sf-textarea" rows="4" placeholder="Digite sua resposta..."></textarea>
            <button class="sf-btn sf-btn-primary" id="sf-submit-response" type="button" style="margin-top: 12px;">Enviar resposta</button>
          </div>
        </div>

        <div id="sf-fields-editor" class="sf-hidden" style="margin-top: 20px;">
          <div class="sf-card">
            <div class="sf-card-title">✏️ Revisar Campos</div>
            <div class="sf-card-subtitle">Ajuste os valores antes de criar o registro.</div>
            <div class="sf-card-actions" style="margin-bottom: 16px;">
              <button class="sf-btn sf-btn-secondary" id="sf-add-field" type="button">➕ Adicionar campo</button>
            </div>
            <div id="sf-fields-list"></div>
            <div class="sf-btn-group">
              <button class="sf-btn sf-btn-secondary" id="sf-cancel-process" type="button">Cancelar</button>
              <button class="sf-btn sf-btn-primary" id="sf-confirm-insert" type="button">
                <span>✅ Criar Registro</span>
              </button>
            </div>
          </div>
        </div>

        <div id="sf-result-area" class="sf-hidden" style="margin-top: 20px;">
          <div class="sf-card">
            <div class="sf-card-title" id="sf-result-title">Resultado</div>
            <div class="sf-card-content" id="sf-result-content"></div>
          </div>
        </div>
      </div>

      <div id="sf-tab-soql" class="sf-tab-content">
        <div class="sf-window-header">
          <h2 class="sf-window-title">🔍 SOQL Query</h2>
          <p class="sf-window-subtitle">
            Execute consultas SOQL diretamente no Salesforce.
          </p>
        </div>

        <div class="sf-input-group">
          <label class="sf-input-label">Query SOQL</label>
          <textarea id="sf-soql-input" class="sf-textarea" rows="5">SELECT Id, Name FROM Account LIMIT 5</textarea>
        </div>

        <button class="sf-btn sf-btn-primary" id="sf-run-soql" type="button">
          <span>▶️ Executar Query</span>
        </button>

        <div id="sf-soql-result" class="sf-hidden" style="margin-top: 20px;">
          <div class="sf-card">
            <div class="sf-card-title">📊 Resultado</div>
            <pre class="sf-card-content" id="sf-soql-content" style="max-height: 400px; overflow-y: auto; font-size: 12px; font-family: monospace;"></pre>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  document.getElementById('sf-close-flow').addEventListener('click', closeFlowUI);
  document.getElementById('sf-minimize-flow').addEventListener('click', minimizeFlowUI);
  document.getElementById('sf-process-btn').addEventListener('click', processTranscriptionFull);
  document.getElementById('sf-run-soql').addEventListener('click', runSOQLQuery);
  document.getElementById('sf-submit-response').addEventListener('click', submitUserResponse);
  document.getElementById('sf-add-field').addEventListener('click', addNewFieldRow);
  document.getElementById('sf-cancel-process').addEventListener('click', cancelProcess);
  document.getElementById('sf-confirm-insert').addEventListener('click', confirmInsertion);

  document.querySelectorAll('.sf-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  makeDraggable(container, document.getElementById('sf-flow-header'));
}

function switchTab(tabName) {
  document.querySelectorAll('.sf-tab').forEach(t => t.classList.remove('sf-tab-active'));
  document.querySelectorAll('.sf-tab-content').forEach(c => c.classList.remove('sf-tab-active'));

  const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
  const tabContent = document.getElementById(`sf-tab-${tabName}`);

  if (tabBtn) tabBtn.classList.add('sf-tab-active');
  if (tabContent) tabContent.classList.add('sf-tab-active');
}

function makeDraggable(element, handle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  let isDragging = false;

  handle.addEventListener('mousedown', dragMouseDown);

  function dragMouseDown(e) {
    if (e.target.classList.contains('sf-flow-btn')) return;

    e.preventDefault();
    e.stopPropagation();

    isDragging = true;
    pos3 = e.clientX;
    pos4 = e.clientY;

    handle.style.cursor = 'grabbing';

    document.addEventListener('mouseup', closeDragElement);
    document.addEventListener('mousemove', elementDrag);
  }

  function elementDrag(e) {
    if (!isDragging) return;
    e.preventDefault();

    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;

    let newTop = element.offsetTop - pos2;
    let newLeft = element.offsetLeft - pos1;

    const maxTop = window.innerHeight - element.offsetHeight;
    const maxLeft = window.innerWidth - element.offsetWidth;

    newTop = Math.max(0, Math.min(newTop, maxTop));
    newLeft = Math.max(0, Math.min(newLeft, maxLeft));

    element.style.top = newTop + 'px';
    element.style.left = newLeft + 'px';
    element.style.bottom = 'auto';
    element.style.right = 'auto';
  }

  function closeDragElement() {
    isDragging = false;
    handle.style.cursor = 'move';
    document.removeEventListener('mouseup', closeDragElement);
    document.removeEventListener('mousemove', elementDrag);
  }
}

function openFlowUI() {
  const container = document.getElementById('sf-ai-flow-container');
  if (!container) return;

  container.classList.add('active');

  if (!container.dataset.positioned) {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const containerWidth = container.offsetWidth || 520;
    const containerHeight = container.offsetHeight || 640;

    container.style.left = Math.max(24, windowWidth - containerWidth - 48) + 'px';
    container.style.top = Math.max(24, windowHeight - containerHeight - 160) + 'px';
    container.style.right = 'auto';
    container.style.bottom = 'auto';

    container.dataset.positioned = 'true';
  }
}

function closeFlowUI() {
  const container = document.getElementById('sf-ai-flow-container');
  if (container) {
    container.classList.remove('active');
  }
}

let isMinimized = false;
let previousHeight = '640px';

function minimizeFlowUI() {
  const container = document.getElementById('sf-ai-flow-container');
  const content = document.querySelector('.sf-flow-content');
  const minimizeBtn = document.getElementById('sf-minimize-flow');

  if (!container || !content || !minimizeBtn) return;

  if (!isMinimized) {
    previousHeight = container.style.height || '640px';
    container.style.height = 'auto';
    container.style.resize = 'none';
    content.style.display = 'none';
    minimizeBtn.textContent = '□';
    minimizeBtn.title = 'Maximizar';
    isMinimized = true;
  } else {
    container.style.height = previousHeight;
    container.style.resize = 'both';
    content.style.display = 'block';
    minimizeBtn.textContent = '─';
    minimizeBtn.title = 'Minimizar';
    isMinimized = false;
  }
}

function injectFloatingButton() {
  if (document.getElementById('sf-ai-assistant-fab')) {
    return;
  }

  const button = document.createElement('div');
  button.id = 'sf-ai-assistant-fab';
  button.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="white"/>
      <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  button.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    box-shadow: 0 12px 32px rgba(102, 126, 234, 0.4);
    cursor: pointer;
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  `;

  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.1) rotate(5deg)';
    button.style.boxShadow = '0 18px 42px rgba(102, 126, 234, 0.6)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1) rotate(0deg)';
    button.style.boxShadow = '0 12px 32px rgba(102, 126, 234, 0.4)';
  });

  button.addEventListener('click', () => {
    button.style.transform = 'scale(0.92)';
    setTimeout(() => {
      button.style.transform = 'scale(1)';
      openFlowUI();
    }, 150);
  });

  document.body.appendChild(button);
}

function initExtension() {
  setTimeout(() => {
    try {
      injectFloatingButton();
      injectFlowInterface();
      loadScripts().catch(err => console.error('Erro ao carregar scripts:', err));
    } catch (error) {
      console.error('Erro na inicialização:', error);
    }
  }, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExtension);
} else {
  initExtension();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'RUN_SOQL') {
        const data = await runSoql(msg.query);
        chrome.runtime.sendMessage({ type: 'SOQL_RESULT', data });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === 'GET_METADATA') {
        const metadata = await getObjectMetadata(msg.objectName);
        sendResponse({ ok: true, data: metadata });
        return;
      }

      if (msg.type === 'INSERT_RECORD') {
        const result = await insertRecord(msg.objectName, msg.fields);
        sendResponse({ ok: true, data: result });
        return;
      }

      if (msg.type === 'UPDATE_RECORD') {
        const result = await updateRecord(msg.objectName, msg.id, msg.fields);
        sendResponse({ ok: true, data: result });
        return;
      }

      if (msg.type === 'DELETE_RECORD') {
        const result = await deleteRecord(msg.objectName, msg.id);
        sendResponse({ ok: true, data: result });
        return;
      }

      sendResponse({ ok: false, error: 'Tipo de mensagem desconhecido' });
    } catch (error) {
      console.error('❌ Erro no content script:', error);
      sendResponse({ ok: false, error: String(error) });
    }
  })();

  return true;
});

console.log('✅ Salesforce AI Assistant content script carregado');