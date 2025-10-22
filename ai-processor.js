// ai-processor.js
// Motor de processamento de IA para transcrições

class AIProcessor {
  constructor() {
    this.apiKey = null;
    this.metadataCache = new Map();
    this.isInitialized = false;
  }

  async initialize() {
    try {
      const { openai_api_key } = await chrome.storage.sync.get('openai_api_key');
      this.apiKey = openai_api_key;
      
      const { metadata_cache } = await chrome.storage.local.get('metadata_cache');
      if (metadata_cache) {
        this.metadataCache = new Map(Object.entries(metadata_cache));
      }
      
      this.isInitialized = true;
      console.log('✅ AI Processor inicializado');
    } catch (error) {
      console.error('❌ Erro ao inicializar AI Processor:', error);
      throw error;
    }
  }

  async saveMetadataCache() {
    const cacheObj = Object.fromEntries(this.metadataCache);
    await chrome.storage.local.set({ metadata_cache: cacheObj });
  }

  async callGPT(messages, temperature = 0.3) {
    if (!this.apiKey) {
      throw new Error('API Key do OpenAI não configurada. Vá em Opções para configurar.');
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        temperature,
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OpenAI API Error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
  }

  async identifyObject(transcription) {
    const messages = [
      {
        role: 'system',
        content: `Você é um especialista em Salesforce. Analise a transcrição e identifique:
1. Qual objeto Salesforce está sendo mencionado (Account, Contact, Opportunity, Case, Lead, etc)
2. Extraia todos os campos e valores mencionados

IMPORTANTE: 
- Se o usuário mencionar "nome completo" ou "nome" para Contact/Lead, sempre separe em FirstName e LastName
- Nunca use o campo "Name" diretamente em Contact/Lead
- Para outros objetos, use "Name" normalmente

Retorne JSON no formato:
{
  "object": "NomeDoObjeto",
  "fields": {"FieldName": "valor", ...},
  "confidence": 0.95
}`
      },
      {
        role: 'user',
        content: `Transcrição: ${transcription}`
      }
    ];

    return await this.callGPT(messages);
  }

  async getObjectMetadata(objectName) {
    // Verifica cache primeiro
    if (this.metadataCache.has(objectName)) {
      console.log(`✅ Metadados de ${objectName} carregados do cache`);
      return this.metadataCache.get(objectName);
    }

    // Usa função global que já está no content.js
    if (typeof window.getObjectMetadata === 'function') {
      console.log(`📡 Usando função global para buscar metadados de ${objectName}`);
      const metadata = await window.getObjectMetadata(objectName);
      
      // Cria chunks do metadata para RAG
      if (window.metadataChunker) {
        console.log('🧩 Criando chunks do metadata...');
        window.metadataChunker.chunkMetadata(objectName, metadata);
      }
      
      // Salva no cache
      this.metadataCache.set(objectName, metadata);
      this.saveMetadataCache();
      console.log(`✅ Metadados de ${objectName} salvos no cache`);
      
      return metadata;
    }
    
    throw new Error('Função getObjectMetadata não disponível. Certifique-se de estar em uma página Salesforce.');
  }

  async validateAndEnrichFields(objectName, fields, transcription) {
    // Busca metadados se ainda não tiver
    let metadata = this.metadataCache.get(objectName);
    if (!metadata) {
      metadata = await this.getObjectMetadata(objectName);
    }

    // Busca chunks relevantes baseado na transcrição
    const relevantChunks = window.metadataChunker.searchRelevantChunks(objectName, transcription);
    const context = window.metadataChunker.generateCompactContext(objectName, relevantChunks);

    console.log('📋 Contexto compacto gerado:', context);

    // Usa GPT com contexto da org para validar e enriquecer
    const messages = [
      {
        role: 'system',
        content: `Você é um assistente Salesforce especializado. Você tem acesso aos metadados REAIS da org do usuário.

CONTEXTO DA ORG:
Objeto: ${context.objectLabel} (${context.object})

CAMPOS OBRIGATÓRIOS:
${JSON.stringify(context.requiredFields, null, 2)}

CAMPOS DISPONÍVEIS:
${JSON.stringify(context.availableFields, null, 2)}

REGRAS DE VALIDAÇÃO:
${JSON.stringify(context.validationRules, null, 2)}

CAMPOS PICKLIST:
${JSON.stringify(context.picklistFields, null, 2)}

CAMPOS LOOKUP:
${JSON.stringify(context.lookupFields, null, 2)}

INSTRUÇÕES:
1. Valide os campos fornecidos contra os metadados REAIS da org
2. Corrija automaticamente erros óbvios (ex: "Nome Completo" → FirstName + LastName para Contact)
3. Preencha campos obrigatórios faltantes com valores padrão quando possível
4. Ajuste valores de picklist para os valores corretos da org
5. NUNCA pergunte coisas óbvias como "pode separar o nome?"
6. Seja inteligente e resolva problemas automaticamente

Retorne JSON:
{
  "fields": {"FieldName": "valor corrigido"},
  "autoCorrections": ["O que foi corrigido automaticamente"],
  "missingRequired": [{"name": "FieldName", "label": "Label"}],
  "invalidValues": [{"field": "FieldName", "reason": "motivo", "suggestion": "sugestão"}],
  "needsUserInput": [{"field": "FieldName", "question": "pergunta"}]
}`
      },
      {
        role: 'user',
        content: `Transcrição original: ${transcription}

Campos extraídos: ${JSON.stringify(fields, null, 2)}

Valide e enriqueça esses dados usando os metadados da org.`
      }
    ];

    return await this.callGPT(messages);
  }

  async validateFields(objectName, fields, metadata) {
    const requiredFields = metadata.fields
      .filter(f => !f.nillable && f.createable && !f.defaultedOnCreate)
      .map(f => ({ name: f.name, label: f.label, type: f.type }));

    const invalidFields = [];
    const missingRequired = [];
    const suggestions = [];

    // Verifica campos obrigatórios
    for (const req of requiredFields) {
      if (!fields[req.name]) {
        missingRequired.push(req);
      }
    }

    // Valida tipos e valores dos campos fornecidos
    for (const [fieldName, value] of Object.entries(fields)) {
      const fieldMeta = metadata.fields.find(f => f.name === fieldName);
      
      if (!fieldMeta) {
        invalidFields.push({ field: fieldName, reason: 'Campo não existe no objeto' });
        continue;
      }

      if (!fieldMeta.createable) {
        invalidFields.push({ field: fieldName, reason: 'Campo não é criável' });
        continue;
      }

      // Validação de tipo
      const validation = this.validateFieldType(fieldMeta, value);
      if (!validation.valid) {
        invalidFields.push({ field: fieldName, reason: validation.reason });
      }
    }

    return {
      valid: invalidFields.length === 0 && missingRequired.length === 0,
      invalidFields,
      missingRequired,
      suggestions
    };
  }

  validateFieldType(fieldMeta, value) {
    const { type, length, precision, scale } = fieldMeta;

    switch (type) {
      case 'string':
      case 'textarea':
      case 'email':
      case 'phone':
      case 'url':
        if (length && value.length > length) {
          return { valid: false, reason: `Tamanho máximo: ${length} caracteres` };
        }
        break;
      
      case 'int':
        if (!Number.isInteger(Number(value))) {
          return { valid: false, reason: 'Deve ser um número inteiro' };
        }
        break;
      
      case 'double':
      case 'currency':
      case 'percent':
        if (isNaN(Number(value))) {
          return { valid: false, reason: 'Deve ser um número' };
        }
        break;
      
      case 'boolean':
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          return { valid: false, reason: 'Deve ser true ou false' };
        }
        break;
      
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return { valid: false, reason: 'Formato de data inválido (YYYY-MM-DD)' };
        }
        break;
      
      case 'datetime':
        if (isNaN(Date.parse(value))) {
          return { valid: false, reason: 'Formato de data/hora inválido' };
        }
        break;
    }

    return { valid: true };
  }

  async askForCorrections(objectName, fields, validationResult, metadata) {
    const problems = [
      ...validationResult.invalidFields.map(f => `❌ ${f.field}: ${f.reason}`),
      ...validationResult.missingRequired.map(f => `⚠️ Campo obrigatório faltando: ${f.label} (${f.name})`)
    ].join('\n');

    const messages = [
      {
        role: 'system',
        content: `Você é um assistente do Salesforce. Baseado nos problemas de validação, faça perguntas específicas e amigáveis ao usuário para corrigir os dados.

Problemas encontrados:
${problems}

Campos atuais:
${JSON.stringify(fields, null, 2)}

Metadados do objeto ${objectName}:
${JSON.stringify(metadata.fields.map(f => ({ name: f.name, label: f.label, type: f.type, required: !f.nillable })), null, 2)}

Retorne JSON com:
{
  "questions": ["Pergunta 1?", "Pergunta 2?"],
  "suggested_fixes": {"FieldName": "valor sugerido"},
  "explanation": "Explicação amigável do que precisa ser corrigido"
}`
      },
      {
        role: 'user',
        content: 'Gere as perguntas para correção'
      }
    ];

    return await this.callGPT(messages);
  }

  async processUserResponse(response, originalFields, questions, metadata) {
    const messages = [
      {
        role: 'system',
        content: `Com base nas respostas do usuário, extraia os valores corretos para os campos.

Perguntas feitas:
${questions.join('\n')}

Campos originais:
${JSON.stringify(originalFields, null, 2)}

Metadados disponíveis:
${JSON.stringify(metadata.fields.map(f => ({ name: f.name, label: f.label, type: f.type })), null, 2)}

Retorne JSON com os campos atualizados:
{
  "fields": {"FieldName": "valor", ...},
  "changes": ["Campo X foi atualizado para Y"]
}`
      },
      {
        role: 'user',
        content: `Resposta do usuário: ${response}`
      }
    ];

    return await this.callGPT(messages);
  }

  async explainDMLError(error, objectName, fields) {
    const messages = [
      {
        role: 'system',
        content: `Você é um especialista em Salesforce. Analise o erro DML e sugira correções de forma clara e amigável.

Erro recebido:
${JSON.stringify(error, null, 2)}

Objeto: ${objectName}
Campos enviados:
${JSON.stringify(fields, null, 2)}

Retorne JSON com:
{
  "problem": "Descrição clara do problema",
  "solution": "Como resolver",
  "suggested_fields": {"FieldName": "valor corrigido"},
  "user_message": "Mensagem amigável para o usuário"
}`
      },
      {
        role: 'user',
        content: 'Analise o erro e sugira correção'
      }
    ];

    return await this.callGPT(messages);
  }
}

// Exporta instância única IMEDIATAMENTE
if (typeof window !== 'undefined') {
  window.aiProcessor = new AIProcessor();
  console.log('✅ AI Processor criado e disponível');
}