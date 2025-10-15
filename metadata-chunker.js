// metadata-chunker.js
// Sistema de chunking e indexação de metadados Salesforce

class MetadataChunker {
  constructor() {
    this.chunks = new Map(); // objectName -> chunks[]
    this.embeddings = new Map(); // chunkId -> embedding
  }

  /**
   * Transforma metadados em chunks estruturados
   */
  chunkMetadata(objectName, metadata) {
    const chunks = [];

    // CHUNK 1: Informações básicas do objeto
    chunks.push({
      id: `${objectName}_basic`,
      type: 'object_info',
      objectName,
      content: {
        name: metadata.name,
        label: metadata.label,
        description: `Objeto ${metadata.label} (API Name: ${metadata.name})`
      }
    });

    // CHUNK 2: Campos obrigatórios
    const requiredFields = metadata.fields.filter(
      f => !f.nillable && f.createable && !f.defaultedOnCreate
    );

    if (requiredFields.length > 0) {
      chunks.push({
        id: `${objectName}_required`,
        type: 'required_fields',
        objectName,
        content: {
          fields: requiredFields.map(f => ({
            name: f.name,
            label: f.label,
            type: f.type,
            description: `Campo obrigatório ${f.label} (${f.name}) do tipo ${f.type}`
          })),
          summary: `Campos obrigatórios: ${requiredFields.map(f => f.label).join(', ')}`
        }
      });
    }

    // CHUNK 3-N: Cada campo vira um chunk
    metadata.fields.forEach(field => {
      if (!field.createable) return; // ignora campos não criáveis

      const fieldChunk = {
        id: `${objectName}_field_${field.name}`,
        type: 'field',
        objectName,
        fieldName: field.name,
        content: {
          name: field.name,
          label: field.label,
          type: field.type,
          required: !field.nillable && !field.defaultedOnCreate,
          createable: field.createable,
          updateable: field.updateable,
          description: this.generateFieldDescription(field)
        }
      };

      // Adiciona informações específicas do tipo
      if (field.length) fieldChunk.content.maxLength = field.length;
      if (field.precision) fieldChunk.content.precision = field.precision;
      if (field.scale) fieldChunk.content.scale = field.scale;
      
      if (field.picklistValues && field.picklistValues.length > 0) {
        fieldChunk.content.picklistValues = field.picklistValues.map(pv => ({
          label: pv.label,
          value: pv.value,
          active: pv.active
        }));
      }

      if (field.referenceTo && field.referenceTo.length > 0) {
        fieldChunk.content.referenceTo = field.referenceTo;
        fieldChunk.content.isLookup = true;
      }

      chunks.push(fieldChunk);
    });

    // CHUNK N+1: Regras de validação comuns
    chunks.push({
      id: `${objectName}_rules`,
      type: 'validation_rules',
      objectName,
      content: {
        rules: this.extractCommonRules(metadata),
        summary: 'Regras de validação e comportamentos especiais do objeto'
      }
    });

    this.chunks.set(objectName, chunks);
    return chunks;
  }

  /**
   * Gera descrição contextual do campo
   */
  generateFieldDescription(field) {
    let desc = `${field.label} (${field.name})`;
    
    if (!field.nillable && !field.defaultedOnCreate) {
      desc += ' - OBRIGATÓRIO';
    }

    desc += ` - Tipo: ${field.type}`;

    if (field.length) desc += `, Máx: ${field.length} caracteres`;
    if (field.picklistValues?.length > 0) {
      desc += `, Valores: ${field.picklistValues.slice(0, 5).map(pv => pv.label).join(', ')}`;
      if (field.picklistValues.length > 5) desc += ` e mais ${field.picklistValues.length - 5}`;
    }
    if (field.referenceTo?.length > 0) {
      desc += `, Referência a: ${field.referenceTo.join(', ')}`;
    }

    return desc;
  }

  /**
   * Extrai regras comuns baseadas nos metadados
   */
  extractCommonRules(metadata) {
    const rules = [];

    // Regra para campos Name/FirstName/LastName
    const hasFirstName = metadata.fields.find(f => f.name === 'FirstName');
    const hasLastName = metadata.fields.find(f => f.name === 'LastName');
    const hasName = metadata.fields.find(f => f.name === 'Name');

    if (hasFirstName && hasLastName && hasName) {
      rules.push({
        type: 'name_composition',
        description: 'O campo Name é composto automaticamente de FirstName + LastName. Use FirstName e LastName separadamente, nunca preencha Name diretamente.',
        fields: ['FirstName', 'LastName', 'Name']
      });
    }

    // Regra para campos de email
    const emailFields = metadata.fields.filter(f => f.type === 'email');
    if (emailFields.length > 0) {
      rules.push({
        type: 'email_validation',
        description: 'Emails devem estar em formato válido (usuario@dominio.com)',
        fields: emailFields.map(f => f.name)
      });
    }

    // Regra para campos de URL
    const urlFields = metadata.fields.filter(f => f.type === 'url');
    if (urlFields.length > 0) {
      rules.push({
        type: 'url_validation',
        description: 'URLs devem começar com http:// ou https://',
        fields: urlFields.map(f => f.name)
      });
    }

    return rules;
  }

  /**
   * Busca chunks relevantes para uma query
   */
  searchRelevantChunks(objectName, query) {
    const chunks = this.chunks.get(objectName);
    if (!chunks) return [];

    const queryLower = query.toLowerCase();
    const scored = [];

    chunks.forEach(chunk => {
      let score = 0;

      // Sempre inclui info básica e campos obrigatórios
      if (chunk.type === 'object_info' || chunk.type === 'required_fields') {
        score = 100;
      }
      // Prioriza campos mencionados na query
      else if (chunk.type === 'field') {
        const fieldLabel = chunk.content.label.toLowerCase();
        const fieldName = chunk.content.name.toLowerCase();
        
        if (queryLower.includes(fieldLabel) || queryLower.includes(fieldName)) {
          score = 80;
        } else if (chunk.content.required) {
          score = 60; // campos obrigatórios sempre relevantes
        } else {
          score = 20; // outros campos com menor prioridade
        }
      }
      // Regras de validação sempre relevantes
      else if (chunk.type === 'validation_rules') {
        score = 90;
      }

      scored.push({ chunk, score });
    });

    // Ordena por score e retorna top chunks
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 15) // limita a 15 chunks mais relevantes
      .map(s => s.chunk);
  }

  /**
   * Gera contexto compacto para o GPT
   */
  generateCompactContext(objectName, relevantChunks) {
    const context = {
      object: objectName,
      objectLabel: '',
      requiredFields: [],
      availableFields: {},
      validationRules: [],
      picklistFields: {},
      lookupFields: {}
    };

    relevantChunks.forEach(chunk => {
      switch (chunk.type) {
        case 'object_info':
          context.objectLabel = chunk.content.label;
          break;

        case 'required_fields':
          context.requiredFields = chunk.content.fields.map(f => ({
            name: f.name,
            label: f.label,
            type: f.type
          }));
          break;

        case 'field':
          context.availableFields[chunk.fieldName] = {
            label: chunk.content.label,
            type: chunk.content.type,
            required: chunk.content.required,
            maxLength: chunk.content.maxLength,
            isLookup: chunk.content.isLookup
          };

          // Campos picklist
          if (chunk.content.picklistValues) {
            context.picklistFields[chunk.fieldName] = {
              label: chunk.content.label,
              values: chunk.content.picklistValues.map(pv => pv.label)
            };
          }

          // Campos lookup
          if (chunk.content.isLookup) {
            context.lookupFields[chunk.fieldName] = {
              label: chunk.content.label,
              referenceTo: chunk.content.referenceTo
            };
          }
          break;

        case 'validation_rules':
          context.validationRules = chunk.content.rules;
          break;
      }
    });

    return context;
  }

  /**
   * Limpa chunks de um objeto
   */
  clearChunks(objectName) {
    this.chunks.delete(objectName);
  }

  /**
   * Limpa todos os chunks
   */
  clearAll() {
    this.chunks.clear();
    this.embeddings.clear();
  }
}

// Exporta instância única
if (typeof window !== 'undefined') {
  window.metadataChunker = new MetadataChunker();
  console.log('✅ Metadata Chunker criado');
}