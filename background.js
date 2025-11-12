// background.js
// Service Worker do plugin Salesforce Helper
// Responsável por capturar sessionId e fazer chamadas REST (sem CORS)

// ============================================================
// --- Funções utilitárias
// ============================================================
function getCookieAsync(details) {
  return new Promise(resolve => chrome.cookies.get(details, resolve));
}

function getAllCookiesAsync(details) {
  return new Promise(resolve => chrome.cookies.getAll(details, resolve));
}

// ============================================================
// --- Localiza o host correto do Salesforce
// ============================================================
async function findSfHost(requestUrl, sender) {
  const currentDomain = new URL(requestUrl).hostname;
  try {
    // tenta cookie no domínio atual
    const cookie = await getCookieAsync({
      url: requestUrl,
      name: "sid",
      storeId: sender?.tab?.cookieStoreId
    });

    if (!cookie || currentDomain.endsWith(".mcas.ms")) {
      return currentDomain.replace(/^\./, "");
    }

    const [orgId] = cookie.value.split("!");
    const orderedDomains = [
      "salesforce.com",
      "cloudforce.com",
      "salesforce.mil",
      "cloudforce.mil",
      "sfcrmproducts.cn",
      "force.com",
      "visual.force.com"
    ];

    for (const domainCandidate of orderedDomains) {
      const cookies = await getAllCookiesAsync({
        name: "sid",
        domain: domainCandidate,
        secure: true,
        storeId: sender?.tab?.cookieStoreId
      });

      if (!cookies || cookies.length === 0) continue;
      const sessionCookie = cookies.find(
        c => c.value && c.value.startsWith(orgId + "!") && c.domain !== "help.salesforce.com"
      );
      if (sessionCookie) {
        return (sessionCookie.domain || domainCandidate).replace(/^\./, "");
      }
    }
  } catch (e) {
    console.warn("findSfHost error", e);
  }
  return currentDomain.replace(/^\./, "");
}

// ============================================================
// --- Obtém o sessionId do domínio correto
// ============================================================
async function getSessionForHost(hostname, sender) {
  try {
    const url = `https://${hostname.replace(/^\./, "")}/`;
    const cookie = await getCookieAsync({
      url,
      name: "sid",
      storeId: sender?.tab?.cookieStoreId
    });
    if (!cookie) return null;
    return {
      key: cookie.value,
      hostname: (cookie.domain || hostname).replace(/^\./, "")
    };
  } catch (e) {
    console.warn("getSessionForHost error", e);
    return null;
  }
}

// ============================================================
// --- Listener principal
// ============================================================
let sfHost = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      // --- 1️⃣ Obter o host Salesforce ---
      if (request.message === "getSfHost") {
        const host = await findSfHost(request.url, sender);
        sendResponse(host);
        return;
      }

      // --- 2️⃣ Obter o sessionId (cookie sid) ---
      if (request.message === "getSession") {
        sfHost = request.sfHost;
        const session = await getSessionForHost(request.sfHost, sender);
        sendResponse(session);
        return;
      }

      // --- 3️⃣ Abrir página de opções ---
      if (request.message === "openOptions") {
        const openOptions = () =>
          new Promise(resolve => {
            if (chrome.runtime.openOptionsPage) {
              chrome.runtime.openOptionsPage(() => {
                if (chrome.runtime.lastError) {
                  resolve({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                  resolve({ ok: true });
                }
              });
            } else {
              resolve({ ok: false, error: "openOptionsPage not available" });
            }
          });

        let result = await openOptions();
        if (!result.ok) {
          const optionsUrl = chrome.runtime.getURL("options.html");
          await new Promise(resolve => {
            chrome.tabs.create({ url: optionsUrl }, () => {
              if (chrome.runtime.lastError) {
                result = { ok: false, error: chrome.runtime.lastError.message };
              } else {
                result = { ok: true, fallback: true };
              }
              resolve();
            });
          });
        }

        sendResponse(result);
        return;
      }

      // --- 4️⃣ Criar nova janela (opcional) ---
      if (request.message === "createWindow") {
        const brow = typeof browser === "undefined" ? chrome : browser;
        brow.windows.create({
          url: request.url,
          incognito: request.incognito ?? false
        });
        sendResponse({ ok: true });
        return;
      }

      // --- 5️⃣ Recarregar aba atual ---
      if (request.message === "reloadPage") {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs[0]) chrome.tabs.reload(tabs[0].id);
          sendResponse({ ok: true });
        });
        return;
      }

      // --- 6️⃣ Fazer chamada REST ao Salesforce (sem CORS) ---
      if (request.message === "callApi") {
        const { session, path, method = "GET", body = null } = request;
        const url = `https://${session.hostname}${path}`;
        console.log("🔵 Executando callApi:", method, url);

        try {
          const res = await fetch(url, {
            method,
            headers: {
              Authorization: `Bearer ${session.key}`,
              "Content-Type": "application/json"
            },
            body: body ? JSON.stringify(body) : undefined,
            credentials: "omit"
          });

          const text = await res.text();
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }

          sendResponse({ ok: true, data: json, status: res.status });
        } catch (err) {
          console.error("Erro no callApi:", err);
          sendResponse({ ok: false, error: String(err) });
        }

        return;
      }
    } catch (err) {
      console.error("background handler error", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  // mantém o canal aberto para respostas assíncronas
  return true;
});

// ============================================================
// --- Ações e atalhos
// ============================================================
chrome.action.onClicked.addListener(() => {
  chrome.runtime.sendMessage({
    msg: "shortcut_pressed",
    sfHost,
    command: "open-popup"
  });
});

//chrome.runtime.setUninstallURL("https://forms.gle/y7LbTNsFqEqSrtyc6");
