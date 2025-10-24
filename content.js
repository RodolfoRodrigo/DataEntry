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
  resultContent.innerHTML = `<pre class="sf-pre-error">${typeof error === 'string' ? error : JSON.stringify(error, null, 2)}</pre>`;

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

  const container = document.createElement('div');
  container.id = 'sf-ai-flow-container';
  const template = window.sfAiTemplates?.flowInterface;
  if (!template) {
    console.error('Salesforce AI Assistant: UI template not found.');
    return;
  }

  container.innerHTML = template;

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
  button.classList.add('sf-ai-assistant-fab');
  button.innerHTML = `
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="white"/>
      <path d="M2 17L12 22L22 17M2 12L12 17L22 12" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
  button.addEventListener('click', () => {
    button.classList.add('sf-ai-assistant-fab--pressed');
    setTimeout(() => {
      button.classList.remove('sf-ai-assistant-fab--pressed');
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