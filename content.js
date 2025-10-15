// content.js - Atualizado com suporte a metadados e inserção

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

function instanceUrlFromSession(session) {
  if (!session) return window.location.origin;
  const h = session.hostname || window.location.hostname;
  return `${window.location.protocol}//${h.replace(/^\./, "")}`;
}

// ============================================================
// SOQL Query
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
    console.error("Erro no callApi:", result.error || result.data);
    throw new Error(result.error || JSON.stringify(result.data));
  }

  const data = result.data;
  if (Array.isArray(data) && data[0]?.errorCode === "INVALID_SESSION_ID") {
    console.warn("INVALID_SESSION_ID — renovando sessão...");
    await ensureSession();
    return runSoql(query);
  }

  return data;
}

// ============================================================
// Buscar Metadados do Objeto
// ============================================================
async function getObjectMetadata(objectName) {
  console.log(`🔍 getObjectMetadata chamado para: ${objectName}`);
  
  if (!window.__SF_SESSION__) {
    console.log('⚠️ Sessão não encontrada, tentando obter...');
    await ensureSession();
    if (!window.__SF_SESSION__) {
      throw new Error("Session not available. Certifique-se de estar logado no Salesforce.");
    }
  }

  const session = window.__SF_SESSION__;
  const path = `/services/data/v61.0/sobjects/${encodeURIComponent(objectName)}/describe`;

  console.log(`📚 Buscando metadados de ${objectName}...`);
  console.log(`📍 URL: https://${session.hostname}${path}`);

  const result = await bgSend({
    message: "callApi",
    session,
    path,
    method: "GET"
  });

  console.log('📦 Resultado da API:', result);

  if (!result.ok) {
    console.error('❌ Erro na resposta da API:', result);
    throw new Error(result.error || JSON.stringify(result.data));
  }

  // Verifica se retornou erro do Salesforce
  const data = result.data;
  if (Array.isArray(data) && data[0]?.errorCode) {
    console.error('❌ Erro do Salesforce:', data);
    throw new Error(`Salesforce Error: ${data[0].message}`);
  }

  // Retorna apenas os campos relevantes
  const metadata = result.data;
  console.log(`✅ Metadados obtidos para ${objectName}:`, metadata.name);
  
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

// ============================================================
// Inserir Registro
// ============================================================
async function insertRecord(objectName, fields) {
  if (!window.__SF_SESSION__) {
    await ensureSession();
    if (!window.__SF_SESSION__) throw new Error("Session not available");
  }

  const session = window.__SF_SESSION__;
  const path = `/services/data/v61.0/sobjects/${encodeURIComponent(objectName)}/`;

  console.log(`💾 Inserindo ${objectName}:`, fields);

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

  // Verifica se houve erro na resposta
  const data = result.data;
  if (Array.isArray(data) && data[0]?.errorCode) {
    throw data; // Lança o array de erros do Salesforce
  }

  return data;
}

// ============================================================
// Atualizar Registro
// ============================================================
async function updateRecord(objectName, id, fields) {
  if (!window.__SF_SESSION__) {
    await ensureSession();
    if (!window.__SF_SESSION__) throw new Error("Session not available");
  }

  const session = window.__SF_SESSION__;
  const path = `/services/data/v61.0/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}`;

  console.log(`🔄 Atualizando ${objectName} (${id}):`, fields);

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

// ============================================================
// Deletar Registro
// ============================================================
async function deleteRecord(objectName, id) {
  if (!window.__SF_SESSION__) {
    await ensureSession();
    if (!window.__SF_SESSION__) throw new Error("Session not available");
  }

  const session = window.__SF_SESSION__;
  const path = `/services/data/v61.0/sobjects/${encodeURIComponent(objectName)}/${encodeURIComponent(id)}`;

  console.log(`🗑️ Deletando ${objectName} (${id})`);

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
// Message Listener
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('📨 Mensagem recebida no content script:', msg.type);
  
  (async () => {
    try {
      if (msg.type === "RUN_SOQL") {
        console.log('🔍 Executando SOQL:', msg.query);
        const data = await runSoql(msg.query);
        chrome.runtime.sendMessage({ type: "SOQL_RESULT", data });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "GET_METADATA") {
        console.log('📚 Requisição de metadados para:', msg.objectName);
        const metadata = await getObjectMetadata(msg.objectName);
        console.log('✅ Enviando metadados de volta');
        sendResponse({ ok: true, data: metadata });
        return;
      }

      if (msg.type === "INSERT_RECORD") {
        console.log('💾 Inserindo registro:', msg.objectName);
        const result = await insertRecord(msg.objectName, msg.fields);
        sendResponse({ ok: true, data: result });
        return;
      }

      if (msg.type === "UPDATE_RECORD") {
        console.log('🔄 Atualizando registro:', msg.objectName, msg.id);
        const result = await updateRecord(msg.objectName, msg.id, msg.fields);
        sendResponse({ ok: true, data: result });
        return;
      }

      if (msg.type === "DELETE_RECORD") {
        console.log('🗑️ Deletando registro:', msg.objectName, msg.id);
        const result = await deleteRecord(msg.objectName, msg.id);
        sendResponse({ ok: true, data: result });
        return;
      }

      console.warn('⚠️ Tipo de mensagem desconhecido:', msg.type);
      sendResponse({ ok: false, error: 'Tipo de mensagem desconhecido' });

    } catch (err) {
      console.error("❌ Erro no content script:", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keep channel open
});

console.log("✅ Salesforce AI Assistant content script carregado");