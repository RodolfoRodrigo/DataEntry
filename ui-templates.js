(function () {
  const flowInterfaceTemplate = `
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

        <div id="sf-chat-area" class="sf-chat-area sf-hidden sf-section-spacing"></div>

        <div id="sf-correction-area" class="sf-hidden sf-section-spacing">
          <div class="sf-card">
            <div class="sf-card-title">ℹ️ Mais informações necessárias</div>
            <div class="sf-card-subtitle">Responda às perguntas para continuar o fluxo.</div>
            <textarea id="sf-user-response" class="sf-textarea" rows="4" placeholder="Digite sua resposta..."></textarea>
            <button class="sf-btn sf-btn-primary sf-btn-spaced" id="sf-submit-response" type="button">Enviar resposta</button>
          </div>
        </div>

        <div id="sf-fields-editor" class="sf-hidden sf-section-spacing">
          <div class="sf-card">
            <div class="sf-card-title">✏️ Revisar Campos</div>
            <div class="sf-card-subtitle">Ajuste os valores antes de criar o registro.</div>
            <div class="sf-card-actions">
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

        <div id="sf-result-area" class="sf-hidden sf-section-spacing">
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

        <div id="sf-soql-result" class="sf-hidden sf-section-spacing">
          <div class="sf-card">
            <div class="sf-card-title">📊 Resultado</div>
            <pre class="sf-card-content sf-pre-scroll" id="sf-soql-content"></pre>
          </div>
        </div>
      </div>
    </div>
  `;

  window.sfAiTemplates = window.sfAiTemplates || {};
  window.sfAiTemplates.flowInterface = flowInterfaceTemplate;
})();
