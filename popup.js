// popup.js
document.getElementById("run").onclick = async () => {
  const query = document.getElementById("query").value;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // envia diretamente para content script
  chrome.tabs.sendMessage(tab.id, { type: "RUN_SOQL", query }, (resp) => {
    // resp é só confirmação; resultados chegam via chrome.runtime.onMessage abaixo
  });

  document.getElementById("result").textContent = "Executando...";
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SOQL_RESULT") {
    document.getElementById("result").textContent = JSON.stringify(msg.data, null, 2);
  } else if (msg.type === "SOQL_ERROR") {
    document.getElementById("result").textContent = "Erro: " + msg.error;
  } else if (msg.type === "CRUD_RESULT") {
    document.getElementById("result").textContent = JSON.stringify(msg.result, null, 2);
  }
});
