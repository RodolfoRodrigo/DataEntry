// content.js

// helper para chamar background
function bgSend(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

// armazena sessão localmente
window.__SF_SESSION__ = null;
window.__SF_HOST__ = null;

async function ensureSession() {
  // 1) pega host provável
  const host = await bgSend({ message: "getSfHost", url: window.location.href });
  window.__SF_HOST__ = host || window.location.hostname;
  // 2) pede session (cookie sid) para o background
  const session = await bgSend({ message: "getSession", sfHost: window.__SF_HOST__ });
  if (!session) {
    console.warn("Não foi possível obter session via cookies (getSession retornou null).");
    return null;
  }
  window.__SF_SESSION__ = session; // { key, hostname }
  return session;
}

function instanceUrlFromSession(session) {
  if (!session) return window.location.origin;
  const h = session.hostname || window.location.hostname;
  return `${window.location.protocol}//${h.replace(/^\./, "")}`;
}

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

  // revalida se deu INVALID_SESSION_ID e tenta nova sessão
  const data = result.data;
  if (
    Array.isArray(data) &&
    data[0]?.errorCode === "INVALID_SESSION_ID"
  ) {
    console.warn("INVALID_SESSION_ID — tentando renovar sessão...");
    await ensureSession();
    return runSoql(query);
  }

  return data;
}

// CRUD genérico: method = 'PATCH'|'POST'|'DELETE'
async function runCrud({ method, sobject, id = "", body = null }) {
  if (!window.__SF_SESSION__) await ensureSession();
  if (!window.__SF_SESSION__) throw new Error("session not available");

  const session = window.__SF_SESSION__;
  const instanceUrl = instanceUrlFromSession(session);
  const sid = session.key;

  const url = id
    ? `${instanceUrl}/services/data/v61.0/sobjects/${encodeURIComponent(sobject)}/${encodeURIComponent(id)}`
    : `${instanceUrl}/services/data/v61.0/sobjects/${encodeURIComponent(sobject)}/`;

  const opts = {
    method,
    headers: { Authorization: `Bearer ${sid}`, "Content-Type": "application/json" },
    credentials: "include"
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: res.status, body: text };
  }
}

// listener para mensagens do popup/background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "RUN_SOQL") {
        const data = await runSoql(msg.query);
        // usa runtime.sendMessage para responder ao popup/background
        chrome.runtime.sendMessage({ type: "SOQL_RESULT", data });
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === "CRUD") {
        const result = await runCrud(msg.payload);
        chrome.runtime.sendMessage({ type: "CRUD_RESULT", result });
        sendResponse({ ok: true });
        return;
      }
    } catch (err) {
      chrome.runtime.sendMessage({ type: "SOQL_ERROR", error: String(err) });
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keep channel open
});
