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
    transcription: '',
    records: [],
    currentRecordIndex: -1,
    currentRecordAlias: null,
    relationshipFields: {},
    recordResults: {},
    resultsLog: [],
    processingMultiple: false,
    objectName: null,
    fields: {},
    metadata: null,
    questions: [],
    lookupCache: new Map(),
    lastCreatedRecord: null
  };
}

let currentState = createInitialState();

function resetState() {
  currentState = createInitialState();
  if (statePersistTimeout) {
    clearTimeout(statePersistTimeout);
    statePersistTimeout = null;
  }
  clearPersistedState();
}

const STATE_STORAGE_KEY = 'sf_ai_assistant_state';
let statePersistTimeout = null;

function getSerializableLookupCache() {
  if (!currentState.lookupCache || !(currentState.lookupCache instanceof Map)) {
    return {};
  }

  const serialized = {};
  currentState.lookupCache.forEach((value, key) => {
    serialized[key] = value;
  });
  return serialized;
}

function getSerializableState() {
  return {
    step: currentState.step,
    transcription: currentState.transcription,
    records: currentState.records,
    currentRecordIndex: currentState.currentRecordIndex,
    currentRecordAlias: currentState.currentRecordAlias,
    relationshipFields: currentState.relationshipFields,
    recordResults: currentState.recordResults,
    resultsLog: currentState.resultsLog,
    processingMultiple: currentState.processingMultiple,
    objectName: currentState.objectName,
    fields: currentState.fields,
    questions: currentState.questions,
    lookupCache: getSerializableLookupCache(),
    lastCreatedRecord: currentState.lastCreatedRecord || null,
    metadataName: currentState.metadata?.name || null,
    timestamp: Date.now()
  };
}

function hasMeaningfulState(state) {
  if (!state) return false;
  const hasRecords = Array.isArray(state.records) && state.records.length > 0;
  const hasFields = state.fields && Object.keys(state.fields).length > 0;
  const hasResults = Array.isArray(state.resultsLog) && state.resultsLog.length > 0;
  return hasRecords || hasFields || hasResults || !!state.transcription;
}

function persistState() {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    const state = getSerializableState();
    if (!hasMeaningfulState(state)) {
      sessionStorage.removeItem(STATE_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Não foi possível salvar o estado da extensão:', error);
  }
}

function clearPersistedState() {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.removeItem(STATE_STORAGE_KEY);
  } catch (error) {
    console.warn('Não foi possível limpar o estado persistido:', error);
  }
}

function scheduleStatePersistence() {
  if (statePersistTimeout) {
    clearTimeout(statePersistTimeout);
  }

  statePersistTimeout = setTimeout(() => {
    statePersistTimeout = null;
    persistState();
  }, 250);
}

async function restoreStateIfAvailable() {
  if (typeof sessionStorage === 'undefined') {
    return false;
  }
  try {
    const stored = sessionStorage.getItem(STATE_STORAGE_KEY);
    if (!stored) {
      return false;
    }

    const parsed = JSON.parse(stored);
    if (!parsed || (!Array.isArray(parsed.records) || parsed.records.length === 0) && (!parsed.fields || Object.keys(parsed.fields).length === 0)) {
      return false;
    }

    const restored = createInitialState();
    Object.assign(restored, parsed);

    restored.lookupCache = new Map();
    if (parsed.lookupCache && typeof parsed.lookupCache === 'object') {
      Object.entries(parsed.lookupCache).forEach(([key, value]) => {
        restored.lookupCache.set(key, value);
      });
    }

    currentState = restored;

    if (!window.aiProcessor) {
      await loadScripts();
    }

    if (window.aiProcessor && window.aiProcessor.initialize && !window.aiProcessor.isInitialized) {
      try {
        await window.aiProcessor.initialize();
      } catch (initError) {
        console.warn('Não foi possível inicializar o AI Processor durante restauração:', initError);
      }
    }

    if (!currentState.metadata && currentState.objectName && window.aiProcessor) {
      try {
        currentState.metadata = await window.aiProcessor.getObjectMetadata(currentState.objectName);
      } catch (error) {
        console.warn('Não foi possível recarregar metadados durante restauração:', error);
      }
    }

    rebuildUIFromState();
    return true;
  } catch (error) {
    console.warn('Erro ao restaurar estado da extensão:', error);
    return false;
  }
}

function rebuildUIFromState() {
  injectFlowInterface();
  openFlowUI();
  updateRecordContextDisplay();

  if (currentState.metadata) {
    renderFieldsEditor();
  }

  if (Array.isArray(currentState.resultsLog) && currentState.resultsLog.length > 0) {
    const resultArea = document.getElementById('sf-result-area');
    const resultTitle = document.getElementById('sf-result-title');
    const resultContent = document.getElementById('sf-result-content');

    if (resultArea && resultTitle && resultContent) {
      resultTitle.textContent = currentState.processingMultiple
        ? '✅ Registros criados'
        : '✅ Registro criado com sucesso!';

      resultContent.innerHTML = currentState.resultsLog
        .map(entry => {
          const aliasInfo = entry.alias && entry.alias !== entry.object
            ? ` <span class="sf-result-alias">(${entry.alias})</span>`
            : '';
          return `<div class="sf-result-item"><strong>${entry.object}</strong>${aliasInfo}<br><span class="sf-result-id">ID: ${entry.id}</span></div>`;
        })
        .join('');

      resultArea.classList.remove('sf-hidden');
    }
  }

  if (currentState.step === 'completed') {
    showStatus('success', '🎉 Registro criado com sucesso!');
  } else if (currentState.step && currentState.step !== 'idle') {
    showStatus('info', '📄 Continuando do ponto onde você parou.');
  }
}

const MAX_AUDIO_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const DEFAULT_RECORD_NAVIGATION = 'same_tab';
let audioRecorder = null;
let audioChunks = [];
let audioStream = null;
let isRecordingAudio = false;
let recordingStartTime = 0;
let recordingTimerInterval = null;

const DEFAULT_TRANSCRIPTION_LANGUAGE = 'auto';
const TRANSCRIPTION_LANGUAGE_LABELS = {
  auto: 'Detecção automática',
  pt: 'Português',
  en: 'Inglês',
  es: 'Espanhol',
  fr: 'Francês',
  de: 'Alemão',
  it: 'Italiano',
  ja: 'Japonês',
  zh: 'Chinês (Mandarim)'
};

function ensureUniqueAliases(records) {
  const aliasCount = {};
  return records.map((record) => {
    const base = (record.alias || record.object || 'Registro').toString().trim() || 'Registro';
    const sanitized = base.replace(/[^a-zA-Z0-9_]/g, '_') || 'Registro';
    aliasCount[sanitized] = (aliasCount[sanitized] || 0) + 1;
    const uniqueAlias = aliasCount[sanitized] > 1 ? `${sanitized}_${aliasCount[sanitized]}` : sanitized;
    return {
      ...record,
      alias: uniqueAlias
    };
  });

  scheduleStatePersistence();
}

function normalizeIdentifiedRecords(identified) {
  if (!identified) return [];

  const rawRecords = Array.isArray(identified.records) && identified.records.length > 0
    ? identified.records
    : (identified.object ? [{
        alias: identified.alias || identified.object,
        object: identified.object,
        action: identified.action || 'insert',
        fields: identified.fields || {},
        relationshipFields: identified.relationshipFields || {},
        confidence: identified.confidence
      }] : []);

  const normalized = rawRecords
    .map((record, index) => {
      const objectName = record.object || record.objectName || identified.object;
      if (!objectName) {
        return null;
      }

      const fields = { ...(record.fields || {}) };
      const relationships = { ...(record.relationshipFields || {}) };

      Object.entries(fields).forEach(([fieldName, value]) => {
        if (value && typeof value === 'object' && value.fromRecord) {
          relationships[fieldName] = {
            fromRecord: value.fromRecord,
            field: value.field || 'Id'
          };
          delete fields[fieldName];
        }
      });

      Object.entries(relationships).forEach(([fieldName, info]) => {
        if (!info || !info.fromRecord) {
          delete relationships[fieldName];
          return;
        }
        relationships[fieldName] = {
          fromRecord: info.fromRecord,
          field: info.field || 'Id'
        };
      });

      return {
        alias: (record.alias || objectName || `Registro${index + 1}`).toString().trim(),
        object: objectName,
        action: record.action || 'insert',
        fields,
        relationshipFields: relationships,
        confidence: typeof record.confidence === 'number'
          ? record.confidence
          : (typeof identified.confidence === 'number' ? identified.confidence : null),
        summary: record.summary || null
      };
    })
    .filter(Boolean);

  return ensureUniqueAliases(normalized);
}

function findRecordByAlias(alias) {
  if (!alias || !Array.isArray(currentState.records)) return null;
  return currentState.records.find(record => record.alias === alias) || null;
}

function resolveRelationshipFields(record) {
  if (!record || !record.relationshipFields) return;

  Object.entries(record.relationshipFields).forEach(([fieldName, info]) => {
    if (!info || !info.fromRecord) return;

    const sourceAlias = info.fromRecord;
    const result = currentState.recordResults[sourceAlias] || findRecordByAlias(sourceAlias)?.insertResult || null;

    if (!result) return;

    let resolvedValue = null;
    if (info.field && info.field !== 'Id') {
      resolvedValue = result[info.field] ?? findRecordByAlias(sourceAlias)?.fields?.[info.field] ?? null;
    } else {
      resolvedValue = result.id || result.Id || null;
    }

    if (resolvedValue !== null && resolvedValue !== undefined) {
      currentState.fields[fieldName] = resolvedValue;
    }
  });

  scheduleStatePersistence();
}

function updateDependentRecords(sourceAlias, insertResult) {
  if (!sourceAlias || !insertResult || !Array.isArray(currentState.records)) return;

  currentState.records.forEach(record => {
    if (!record.relationshipFields) return;

    Object.entries(record.relationshipFields).forEach(([fieldName, info]) => {
      if (!info || info.fromRecord !== sourceAlias) return;

      let resolvedValue = null;
      if (info.field && info.field !== 'Id') {
        resolvedValue = insertResult[info.field] ?? record.fields?.[info.field] ?? null;
      } else {
        resolvedValue = insertResult.id || insertResult.Id || null;
      }

      if (resolvedValue !== null && resolvedValue !== undefined) {
        record.fields = { ...(record.fields || {}) };
        record.fields[fieldName] = resolvedValue;
      }
    });
  });
}

function updateCurrentRecordField(fieldName, value) {
  if (!Array.isArray(currentState.records)) return;
  const record = currentState.records[currentState.currentRecordIndex];
  if (!record) return;

  if (!record.fields) {
    record.fields = {};
  }

  if (value === undefined) {
    delete record.fields[fieldName];
  } else {
    record.fields[fieldName] = value;
  }

  scheduleStatePersistence();
}

function updateRecordContextDisplay() {
  const contextEl = document.getElementById('sf-record-context');
  if (!contextEl) return;

  const total = Array.isArray(currentState.records) ? currentState.records.length : 0;
  const index = currentState.currentRecordIndex;
  const record = total > 0 && index >= 0 ? currentState.records[index] : null;

  if (!record) {
    contextEl.textContent = '';
    contextEl.classList.add('sf-hidden');
    return;
  }

  const progress = total > 1 ? `Registro ${index + 1} de ${total}` : 'Registro único';
  const aliasLabel = record.alias && record.alias !== record.object
    ? ` <span class="sf-record-alias">(${record.alias})</span>`
    : '';

  contextEl.innerHTML = `${progress} • <strong>${record.object}</strong>${aliasLabel}`;
  contextEl.classList.remove('sf-hidden');
}

function appendResultLog(record, result) {
  const resultArea = document.getElementById('sf-result-area');
  const resultTitle = document.getElementById('sf-result-title');
  const resultContent = document.getElementById('sf-result-content');

  if (!resultArea || !resultTitle || !resultContent) return;

  currentState.resultsLog = currentState.resultsLog || [];
  currentState.resultsLog.push({
    object: record?.object || 'Registro',
    alias: record?.alias || record?.object || 'Registro',
    id: result?.id || result?.Id || '—'
  });

  resultTitle.textContent = currentState.processingMultiple
    ? '✅ Registros criados'
    : '✅ Registro criado com sucesso!';

  const itemsHtml = currentState.resultsLog
    .map(entry => {
      const aliasInfo = entry.alias && entry.alias !== entry.object
        ? ` <span class="sf-result-alias">(${entry.alias})</span>`
        : '';
      return `
        <div class="sf-result-item">
          <div class="sf-result-item-title"><strong>${entry.object}</strong>${aliasInfo}</div>
          <div class="sf-result-item-id">ID: ${entry.id}</div>
        </div>
      `;
    })
    .join('');

  resultContent.innerHTML = itemsHtml;
  resultArea.classList.remove('sf-hidden');

  scheduleStatePersistence();
}

function finalizeRecordCreationFlow() {
  if (statePersistTimeout) {
    clearTimeout(statePersistTimeout);
    statePersistTimeout = null;
  }

  currentState.step = 'idle';
  currentState.records = [];
  currentState.currentRecordIndex = -1;
  currentState.currentRecordAlias = null;
  currentState.objectName = null;
  currentState.fields = {};
  currentState.relationshipFields = {};
  currentState.recordResults = {};
  currentState.processingMultiple = false;
  currentState.metadata = null;
  currentState.questions = [];
  currentState.lookupCache = new Map();
  currentState.transcription = '';
  currentState.resultsLog = [];
  currentState.lastCreatedRecord = null;

  resetCorrectionInput();
  resetFieldsEditor();
  updateRecordContextDisplay();

  const transcriptionInput = document.getElementById('sf-transcription-input');
  if (transcriptionInput) {
    transcriptionInput.value = '';
  }

  const confirmBtn = document.getElementById('sf-confirm-insert');
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<span>✅ Criar Registro</span>';
  }

  setProcessing(false);
  clearPersistedState();
}

function buildRecordPageUrl(objectName, recordId) {
  if (!recordId) {
    return null;
  }

  const origin = window.location.origin;
  const encodedId = encodeURIComponent(recordId);
  const isLightning = window.location.pathname.includes('/lightning');

  if (isLightning && objectName) {
    return `${origin}/lightning/r/${encodeURIComponent(objectName)}/${encodedId}/view`;
  }

  return `${origin}/${encodedId}`;
}

async function openRecordPageAfterCreation(objectName, recordId) {
  if (!recordId) {
    return;
  }

  const targetUrl = buildRecordPageUrl(objectName, recordId);
  if (!targetUrl) {
    return;
  }

  let behavior = DEFAULT_RECORD_NAVIGATION;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    try {
      const stored = await chrome.storage.sync.get('record_navigation_behavior');
      if (stored && stored.record_navigation_behavior) {
        behavior = stored.record_navigation_behavior;
      }
    } catch (error) {
      console.warn('Não foi possível obter preferência de navegação do registro:', error);
    }
  }

  if (behavior === 'new_tab') {
    window.open(targetUrl, '_blank', 'noopener');
  } else {
    window.location.assign(targetUrl);
  }
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
  const context = document.getElementById('sf-record-context');
  if (context) {
    context.textContent = '';
    context.classList.add('sf-hidden');
  }
}

function resetResultArea() {
  const area = document.getElementById('sf-result-area');
  if (area) area.classList.add('sf-hidden');
  const content = document.getElementById('sf-result-content');
  if (content) content.innerHTML = '';
  currentState.resultsLog = [];
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

function setAudioStatus(message, type = 'info') {
  const statusEl = document.getElementById('sf-audio-status');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.dataset.status = type || 'info';
}

function getTranscriptionLanguageDescription(code) {
  if (!code) return TRANSCRIPTION_LANGUAGE_LABELS[DEFAULT_TRANSCRIPTION_LANGUAGE];
  const normalized = code.toLowerCase();
  return TRANSCRIPTION_LANGUAGE_LABELS[normalized] || normalized.toUpperCase();
}

async function updateTranscriptionLanguageDisplay() {
  const labelEl = document.getElementById('sf-transcription-language');
  if (!labelEl) return;

  try {
    const { transcription_language } = await chrome.storage.sync.get('transcription_language');
    const languageCode = transcription_language || DEFAULT_TRANSCRIPTION_LANGUAGE;
    const description = getTranscriptionLanguageDescription(languageCode);
    if (languageCode === 'auto' || languageCode === DEFAULT_TRANSCRIPTION_LANGUAGE) {
      labelEl.textContent = `Idioma atual: ${TRANSCRIPTION_LANGUAGE_LABELS.auto}`;
    } else {
      labelEl.textContent = `Idioma atual: ${description}`;
    }
  } catch (error) {
    console.warn('Não foi possível atualizar idioma da transcrição:', error);
    labelEl.textContent = `Idioma atual: ${TRANSCRIPTION_LANGUAGE_LABELS.auto}`;
  }
}

function openExtensionSettings(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const runtime = typeof chrome !== 'undefined' ? chrome.runtime : null;
  if (!runtime) {
    return;
  }

  const fallbackToWindow = () => {
    try {
      const optionsUrl = runtime.getURL('options.html');
      if (optionsUrl) {
        window.open(optionsUrl, '_blank', 'noopener');
      }
    } catch (error) {
      console.warn('Não foi possível abrir opções via fallback:', error);
    }
  };

  try {
    runtime.sendMessage({ message: 'openOptions' }, response => {
      const lastError = chrome.runtime?.lastError;
      if (lastError) {
        console.warn('Erro ao solicitar abertura das opções:', lastError);
        fallbackToWindow();
        return;
      }

      if (!response || response.ok !== true) {
        fallbackToWindow();
      }
    });
  } catch (error) {
    console.warn('Erro inesperado ao abrir configurações:', error);
    fallbackToWindow();
  }
}

function setFileInputDisabled(disabled) {
  const fileInput = document.getElementById('sf-audio-upload');
  if (fileInput) fileInput.disabled = disabled;
  const fileLabel = document.querySelector('#sf-tab-ai .sf-file-input');
  if (fileLabel) fileLabel.classList.toggle('sf-disabled', !!disabled);
}

function setAudioTranscribing(isTranscribing) {
  const recordBtn = document.getElementById('sf-record-btn');
  if (recordBtn && !isRecordingAudio) {
    recordBtn.disabled = isTranscribing;
  }
  setFileInputDisabled(isTranscribing || isRecordingAudio);
}

function toggleRecordingUI(isActive) {
  const recordBtn = document.getElementById('sf-record-btn');
  const stopBtn = document.getElementById('sf-stop-record-btn');
  const indicator = document.getElementById('sf-recording-indicator');

  if (recordBtn) {
    recordBtn.classList.toggle('sf-hidden', isActive);
    if (!isActive) recordBtn.disabled = false;
  }

  if (stopBtn) {
    stopBtn.classList.toggle('sf-hidden', !isActive);
    stopBtn.disabled = !isActive;
  }

  if (indicator) {
    indicator.classList.toggle('sf-hidden', !isActive);
  }
}

function updateRecordingTimerDisplay() {
  if (!isRecordingAudio) return;
  const timerEl = document.getElementById('sf-recording-timer');
  if (!timerEl) return;

  const elapsed = Math.max(0, Date.now() - recordingStartTime);
  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  timerEl.textContent = `${minutes}:${seconds}`;
}

function stopRecordingTimer() {
  if (recordingTimerInterval) {
    clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }
}

function cleanupAudioStream() {
  if (audioStream) {
    try {
      audioStream.getTracks().forEach(track => track.stop());
    } catch (error) {
      console.warn('Erro ao encerrar stream de áudio:', error);
    }
  }
  audioStream = null;
}

async function startAudioRecording() {
  if (isRecordingAudio) {
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setAudioStatus('Seu navegador não suporta gravação de áudio.', 'error');
    return;
  }

  const recordBtn = document.getElementById('sf-record-btn');
  const stopBtn = document.getElementById('sf-stop-record-btn');

  try {
    setAudioStatus('🎙️ Preparando microfone...');
    if (recordBtn) recordBtn.disabled = true;
    setFileInputDisabled(true);

    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    const recorder = new MediaRecorder(audioStream);
    audioRecorder = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    recorder.onstop = async () => {
      stopRecordingTimer();
      toggleRecordingUI(false);
      cleanupAudioStream();

      const capturedChunks = [...audioChunks];
      audioChunks = [];
      audioRecorder = null;

      try {
        if (!capturedChunks.length) {
          setAudioStatus('Nenhum áudio foi capturado.', 'error');
          return;
        }

        const mimeType = recorder.mimeType || 'audio/webm';
        const extension = mimeType.includes('mp3')
          ? 'mp3'
          : mimeType.includes('wav')
            ? 'wav'
            : mimeType.includes('ogg')
              ? 'ogg'
              : 'webm';
        const blob = new Blob(capturedChunks, { type: mimeType });

        if (!blob || blob.size === 0) {
          setAudioStatus('Nenhum áudio foi capturado.', 'error');
          return;
        }

        await runAudioTranscription(blob, `gravacao.${extension}`, 'gravação de áudio');
      } finally {
        if (recordBtn) recordBtn.disabled = false;
        setFileInputDisabled(false);
      }
    };

    recorder.start();
    isRecordingAudio = true;
    toggleRecordingUI(true);
    if (stopBtn) stopBtn.disabled = false;
    recordingStartTime = Date.now();
    updateRecordingTimerDisplay();
    recordingTimerInterval = setInterval(updateRecordingTimerDisplay, 500);
    setAudioStatus('🎙️ Gravando... Fale agora!');
  } catch (error) {
    console.error('Erro ao iniciar gravação de áudio:', error);
    setAudioStatus(`❌ Não foi possível iniciar a gravação: ${error.message}`, 'error');
    if (recordBtn) recordBtn.disabled = false;
    setFileInputDisabled(false);
    cleanupAudioStream();
    audioRecorder = null;
    isRecordingAudio = false;
    stopRecordingTimer();
  }
}

function stopAudioRecording() {
  if (!isRecordingAudio) {
    return;
  }

  const stopBtn = document.getElementById('sf-stop-record-btn');
  if (stopBtn) stopBtn.disabled = true;

  isRecordingAudio = false;
  setAudioStatus('⏹️ Finalizando gravação...');

  try {
    if (audioRecorder && audioRecorder.state !== 'inactive') {
      audioRecorder.stop();
    }
  } catch (error) {
    console.error('Erro ao finalizar gravação:', error);
    setAudioStatus(`❌ Erro ao finalizar gravação: ${error.message}`, 'error');
  }
}

async function runAudioTranscription(blob, filename, sourceDescription) {
  try {
    setAudioTranscribing(true);
    setAudioStatus(`⏳ Transcrevendo ${sourceDescription}...`);

    await loadScripts();

    if (!window.aiProcessor) {
      throw new Error('AI Processor não disponível. Verifique a configuração.');
    }

    if (!window.aiProcessor.isInitialized) {
      await window.aiProcessor.initialize();
    }

    const text = await window.aiProcessor.transcribeAudio(blob, filename);
    const textarea = document.getElementById('sf-transcription-input');
    if (textarea) {
      textarea.value = text;
      textarea.focus();
    }

    setAudioStatus(`✅ Transcrição concluída (${sourceDescription}).`, 'success');
    showStatus('success', '✅ Áudio transcrito com sucesso! Revise o texto antes de processar.');
  } catch (error) {
    console.error('Erro ao transcrever áudio:', error);
    setAudioStatus(`❌ Erro ao transcrever áudio: ${error.message}`, 'error');
    showStatus('error', `❌ Erro ao transcrever áudio: ${error.message}`);
  } finally {
    setAudioTranscribing(false);
  }
}

async function handleAudioFileSelected(event) {
  const { files } = event.target || {};
  const file = files && files[0];

  if (!file) {
    return;
  }

  if (isRecordingAudio) {
    setAudioStatus('Finalize a gravação antes de enviar um arquivo.', 'error');
    event.target.value = '';
    return;
  }

  if (file.size > MAX_AUDIO_FILE_SIZE) {
    setAudioStatus('❌ O arquivo selecionado ultrapassa o limite de 25 MB.', 'error');
    event.target.value = '';
    return;
  }

  await runAudioTranscription(file, file.name || 'audio-enviado', 'arquivo de áudio');
  event.target.value = '';
}

function initializeAudioControls() {
  const recordBtn = document.getElementById('sf-record-btn');
  const stopBtn = document.getElementById('sf-stop-record-btn');
  const uploadInput = document.getElementById('sf-audio-upload');
  const settingsBtn = document.getElementById('sf-open-settings');

  if (recordBtn && !recordBtn.dataset.bound) {
    recordBtn.addEventListener('click', startAudioRecording);
    recordBtn.dataset.bound = 'true';
  }

  if (stopBtn && !stopBtn.dataset.bound) {
    stopBtn.addEventListener('click', stopAudioRecording);
    stopBtn.dataset.bound = 'true';
  }

  if (uploadInput && !uploadInput.dataset.bound) {
    uploadInput.addEventListener('change', handleAudioFileSelected);
    uploadInput.dataset.bound = 'true';
  }

  if (settingsBtn && !settingsBtn.dataset.bound) {
    settingsBtn.addEventListener('click', openExtensionSettings);
    settingsBtn.dataset.bound = 'true';
  }

  setAudioStatus('Pronto para gravar ou enviar um áudio.');
  setFileInputDisabled(false);
  toggleRecordingUI(false);
  updateTranscriptionLanguageDisplay();
}

function cancelProcess() {
  resetState();
  resetUI();
  showStatus('info', 'Processo cancelado.');
}

// ============================================================
// PROCESSAMENTO PRINCIPAL
// ============================================================
async function prepareRecordForReview(recordIndex) {
  if (!Array.isArray(currentState.records) || recordIndex < 0 || recordIndex >= currentState.records.length) {
    throw new Error('Índice de registro inválido para processamento.');
  }

  const record = currentState.records[recordIndex];
  record.status = 'processing';

  currentState.currentRecordIndex = recordIndex;
  currentState.currentRecordAlias = record.alias;
  currentState.objectName = record.object;
  currentState.relationshipFields = { ...(record.relationshipFields || {}) };
  currentState.fields = { ...(record.fields || {}) };
  currentState.metadata = null;
  currentState.questions = [];
  currentState.lookupCache = new Map();
  currentState.step = 'processing';

  const total = currentState.records.length;
  const aliasLabel = record.alias && record.alias !== record.object ? ` (${record.alias})` : '';
  addChatMessage('ai', `➡️ Processando registro ${recordIndex + 1} de ${total}: **${record.object}**${aliasLabel}.`);

  showStatus('info', `📚 Consultando estrutura do ${record.object} na sua org...`);
  currentState.metadata = await window.aiProcessor.getObjectMetadata(record.object);

  resolveRelationshipFields(record);
  record.fields = { ...currentState.fields };

  await processLookupFields(currentState.transcription);

  showStatus('info', '🤖 Validando dados com base na configuração da sua org...');
  const enriched = await window.aiProcessor.validateAndEnrichFields(
    record.object,
    currentState.fields,
    currentState.transcription
  );

  currentState.fields = { ...currentState.fields, ...(enriched.fields || {}) };
  record.fields = { ...currentState.fields };

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

  record.status = 'ready';
  record.enriched = enriched;
  currentState.step = 'ready';
  updateRecordContextDisplay();
  scheduleStatePersistence();
}

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
    currentState.transcription = transcription;
    scheduleStatePersistence();

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
    const records = normalizeIdentifiedRecords(identified);

    if (!records || records.length === 0) {
      throw new Error('Não foi possível identificar registros para criar.');
    }

    currentState.records = records.map(record => ({
      ...record,
      fields: { ...(record.fields || {}) },
      status: 'pending'
    }));

    currentState.processingMultiple = currentState.records.length > 1;
    scheduleStatePersistence();

    if (currentState.processingMultiple) {
      const summaryList = currentState.records
        .map((record, index) => `• ${index + 1}. **${record.object}**${record.alias && record.alias !== record.object ? ` (${record.alias})` : ''}`)
        .join('\n');
      addChatMessage('ai', `Identifiquei ${currentState.records.length} registros para criar:\n${summaryList}`);
    } else {
      addChatMessage('ai', `Identifiquei que você quer criar um **${currentState.records[0].object}**.`);
    }

    if (identified && identified.summary) {
      addChatMessage('ai', `🧠 ${identified.summary}`);
    }

    await prepareRecordForReview(0);
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
        updateCurrentRecordField(lookupField.name, results[0].Id);
        addChatMessage('ai', `✅ Encontrei automaticamente: **${results[0].Name}** para ${lookupField.label}`);
      } else {
        addChatMessage('ai', `🔍 Encontrei ${results.length} opções para **${lookupField.label}**. Você poderá selecionar na revisão.`);
      }
    } catch (error) {
      console.warn('Erro ao processar lookup', lookupField.name, error);
    }
  }

  scheduleStatePersistence();
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
  updateRecordContextDisplay();

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
    scheduleStatePersistence();
    return;
  }

  showStatus('warning', '⚠️ Alguns campos obrigatórios precisam ser revisados.');
  await showConfirmationSummary();
}

async function showConfirmationSummary() {
  currentState.step = 'ready';

  const total = Array.isArray(currentState.records) ? currentState.records.length : 1;
  const recordIndex = currentState.currentRecordIndex >= 0 ? currentState.currentRecordIndex : 0;
  const record = Array.isArray(currentState.records) ? currentState.records[recordIndex] : null;
  const aliasInfo = record && record.alias && record.alias !== record.object ? ` (${record.alias})` : '';
  const intro = currentState.processingMultiple && record
    ? `📋 **Resumo do registro ${recordIndex + 1}/${total} - ${record.object}${aliasInfo}:**`
    : '📋 **Resumo dos dados identificados:**';

  const summary = Object.entries(currentState.fields)
    .map(([key, value]) => {
      const fieldMeta = currentState.metadata?.fields.find(f => f.name === key);
      const label = fieldMeta ? fieldMeta.label : key;
      return `• **${label}**: ${value}`;
    })
    .join('\n');

  if (summary) {
    addChatMessage('ai', `${intro}\n\n${summary}\n\n✅ Revise os campos e ajuste se necessário.`);
  }

  updateRecordContextDisplay();
  renderFieldsEditor();
  showStatus('success', '✅ Dados prontos para revisão.');
  scheduleStatePersistence();
}

function renderFieldsEditor() {
  if (!currentState.metadata) return;

  const editor = document.getElementById('sf-fields-editor');
  const container = document.getElementById('sf-fields-list');

  if (!editor || !container) return;

  updateRecordContextDisplay();

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
      updateCurrentRecordField(fieldName, currentState.fields[fieldName]);
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
      updateCurrentRecordField(fieldName, currentState.fields[fieldName]);
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
      updateCurrentRecordField(fieldName, e.target.value);
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
    updateCurrentRecordField(fieldName, undefined);
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
    updateCurrentRecordField(fieldName, '');

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
      scheduleStatePersistence();

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
          updateCurrentRecordField(fieldName, record.Id);
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
          updateCurrentRecordField(fieldName, record.Id);
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
    updateCurrentRecordField(fieldName, '');
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

    if (Array.isArray(currentState.records)) {
      const record = currentState.records[currentState.currentRecordIndex];
      if (record) {
        record.fields = { ...currentState.fields };
      }
    }

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

  const recordIndex = currentState.currentRecordIndex;
  const record = Array.isArray(currentState.records) ? currentState.records[recordIndex] : null;

  if (!record) {
    showStatus('error', '❌ Nenhum registro pendente para criação.');
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

    record.fields = { ...currentState.fields };

    const aliasInfo = record.alias && record.alias !== record.object ? ` (${record.alias})` : '';
    addChatMessage('ai', `💾 Criando registro ${record.object}${aliasInfo} no Salesforce...`);

    const result = await insertRecord(currentState.objectName, currentState.fields);

    record.insertResult = result;
    record.status = 'completed';
    currentState.recordResults[record.alias] = result;

    const recordId = result?.id || result?.Id || null;
    if (recordId) {
      currentState.lastCreatedRecord = {
        object: record.object,
        alias: record.alias,
        id: recordId
      };
    }

    appendResultLog(record, result);
    showInsertSuccess(result, record);

    updateDependentRecords(record.alias, result);
    scheduleStatePersistence();

    const nextIndex = recordIndex + 1;
    if (nextIndex < currentState.records.length) {
      const nextRecord = currentState.records[nextIndex];
      const nextAlias = nextRecord.alias && nextRecord.alias !== nextRecord.object ? ` (${nextRecord.alias})` : '';
      addChatMessage('ai', `➡️ Registro ${recordIndex + 1} criado. Preparando **${nextRecord.object}${nextAlias}**...`);

      setProcessing(true);
      try {
        await prepareRecordForReview(nextIndex);
      } finally {
        setProcessing(false);
      }
    } else {
      addChatMessage('ai', '🎉 Todos os registros foram criados com sucesso!');
      showStatus('success', '🎉 Todos os registros foram criados com sucesso!');
      finalizeRecordCreationFlow();

      if (recordId) {
        await openRecordPageAfterCreation(record.object, recordId);
      }
    }
  } catch (error) {
    showInsertError(error, record);
  } finally {
    const confirmBtn = document.getElementById('sf-confirm-insert');
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<span>✅ Criar Registro</span>';
    }
  }
}

function showInsertSuccess(data, record) {
  const total = Array.isArray(currentState.records) ? currentState.records.length : 1;
  const recordIndex = currentState.currentRecordIndex >= 0 ? currentState.currentRecordIndex : 0;
  const aliasInfo = record && record.alias && record.alias !== record.object ? ` (${record.alias})` : '';

  const message = currentState.processingMultiple
    ? `🎉 Registro ${recordIndex + 1} de ${total} (${record.object}${aliasInfo}) criado com sucesso! ID: ${data.id}`
    : `🎉 Registro criado com sucesso! ID: ${data.id}`;

  addChatMessage('ai', message);
  showStatus('success', currentState.processingMultiple
    ? `🎉 Registro ${recordIndex + 1} de ${total} criado com sucesso!`
    : '🎉 Registro criado com sucesso!');
}

function showInsertError(error, record) {
  const resultArea = document.getElementById('sf-result-area');
  const resultTitle = document.getElementById('sf-result-title');
  const resultContent = document.getElementById('sf-result-content');

  if (!resultArea || !resultTitle || !resultContent) return;

  const aliasInfo = record && record.alias && record.alias !== record.object ? ` (${record.alias})` : '';
  resultTitle.textContent = currentState.processingMultiple && record
    ? `❌ Erro ao criar ${record.object}${aliasInfo}`
    : '❌ Erro ao criar registro';
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

  initializeAudioControls();

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
  setTimeout(async () => {
    try {
      injectFloatingButton();
      injectFlowInterface();
      await loadScripts();
      await restoreStateIfAvailable();
    } catch (error) {
      console.error('Erro na inicialização:', error);
    }
  }, 1500);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') {
    return;
  }

  if (changes.transcription_language) {
    updateTranscriptionLanguageDisplay();
    if (window.aiProcessor) {
      window.aiProcessor.transcriptionLanguage = changes.transcription_language.newValue || DEFAULT_TRANSCRIPTION_LANGUAGE;
    }
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initExtension);
} else {
  initExtension();
}

window.addEventListener('beforeunload', () => {
  try {
    persistState();
  } catch (error) {
    console.warn('Não foi possível persistir o estado antes de sair da página:', error);
  }
});

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