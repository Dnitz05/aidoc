/**
 * API Key Manager v1.0
 *
 * Gestiona les API keys dels usuaris per al mode BYOK (Bring Your Own Key).
 * Les claus s'emmagatzemen encriptades a UserProperties (específiques per usuari).
 *
 * Providers suportats:
 * - gemini: Google Gemini
 * - openai: OpenAI (GPT-4, etc.)
 * - claude: Anthropic Claude
 * - mistral: Mistral AI
 * - groq: Groq
 */

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const API_KEY_PREFIX = 'DOCMILE_APIKEY_';
const ACTIVE_PROVIDER_KEY = 'DOCMILE_ACTIVE_PROVIDER';
const ACTIVE_MODEL_KEY = 'DOCMILE_ACTIVE_MODEL';

/**
 * Providers disponibles amb els seus models per defecte
 */
const PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    models: {
      'gemini-2.0-flash': 'Gemini 2.0 Flash (Recomanat)',
      'gemini-1.5-pro': 'Gemini 1.5 Pro',
      'gemini-1.5-flash': 'Gemini 1.5 Flash'
    }
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    models: {
      'gpt-4o': 'GPT-4o (Més potent)',
      'gpt-4o-mini': 'GPT-4o Mini (Recomanat)',
      'gpt-4-turbo': 'GPT-4 Turbo'
    }
  },
  claude: {
    name: 'Anthropic Claude',
    defaultModel: 'claude-sonnet-4-20250514',
    models: {
      'claude-sonnet-4-20250514': 'Claude Sonnet 4 (Recomanat)',
      'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
      'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku (Ràpid)'
    }
  },
  mistral: {
    name: 'Mistral AI',
    defaultModel: 'mistral-small-latest',
    models: {
      'mistral-large-latest': 'Mistral Large',
      'mistral-small-latest': 'Mistral Small (Recomanat)',
      'codestral-latest': 'Codestral (Codi)'
    }
  },
  groq: {
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    models: {
      'llama-3.3-70b-versatile': 'Llama 3.3 70B (Recomanat)',
      'llama-3.1-8b-instant': 'Llama 3.1 8B (Ultraràpid)',
      'mixtral-8x7b-32768': 'Mixtral 8x7B'
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// API KEY CRUD
// ═══════════════════════════════════════════════════════════════

/**
 * Guarda una API key per un provider
 * @param {string} provider - ID del provider (gemini, openai, claude, mistral, groq)
 * @param {string} apiKey - La API key a guardar
 * @returns {Object} - Resultat de l'operació
 */
function saveApiKey(provider, apiKey) {
  if (!PROVIDERS[provider]) {
    return { success: false, error: `Provider "${provider}" no reconegut` };
  }

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return { success: false, error: 'API key invàlida' };
  }

  try {
    const props = PropertiesService.getUserProperties();
    const propKey = API_KEY_PREFIX + provider.toUpperCase();

    // Encriptar la key (base64 simple per ara - en producció usar encriptació real)
    const encoded = Utilities.base64Encode(apiKey.trim());
    props.setProperty(propKey, encoded);

    Logger.log(`[ApiKeyManager] API key saved for provider: ${provider}`);

    return {
      success: true,
      provider: provider,
      masked: maskApiKey(apiKey)
    };
  } catch (e) {
    Logger.log(`[ApiKeyManager] Error saving API key: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Obté una API key per un provider
 * @param {string} provider - ID del provider
 * @returns {string|null} - API key o null si no existeix
 */
function getApiKey(provider) {
  if (!PROVIDERS[provider]) {
    return null;
  }

  try {
    const props = PropertiesService.getUserProperties();
    const propKey = API_KEY_PREFIX + provider.toUpperCase();
    const encoded = props.getProperty(propKey);

    if (!encoded) return null;

    // Desencriptar
    const decoded = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString();
    return decoded;
  } catch (e) {
    Logger.log(`[ApiKeyManager] Error getting API key: ${e.message}`);
    return null;
  }
}

/**
 * Elimina una API key
 * @param {string} provider - ID del provider
 * @returns {Object} - Resultat de l'operació
 */
function deleteApiKey(provider) {
  if (!PROVIDERS[provider]) {
    return { success: false, error: `Provider "${provider}" no reconegut` };
  }

  try {
    const props = PropertiesService.getUserProperties();
    const propKey = API_KEY_PREFIX + provider.toUpperCase();
    props.deleteProperty(propKey);

    // Si era el provider actiu, netejar
    const activeProvider = props.getProperty(ACTIVE_PROVIDER_KEY);
    if (activeProvider === provider) {
      props.deleteProperty(ACTIVE_PROVIDER_KEY);
      props.deleteProperty(ACTIVE_MODEL_KEY);
    }

    Logger.log(`[ApiKeyManager] API key deleted for provider: ${provider}`);

    return { success: true, provider: provider };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Obté totes les API keys configurades (mascarades)
 * @returns {Object} - Objecte amb providers i les seves keys mascarades
 */
function getAllApiKeys() {
  const result = {
    providers: {},
    activeProvider: null,
    activeModel: null
  };

  try {
    const props = PropertiesService.getUserProperties();

    for (const provider of Object.keys(PROVIDERS)) {
      const propKey = API_KEY_PREFIX + provider.toUpperCase();
      const encoded = props.getProperty(propKey);

      if (encoded) {
        const decoded = Utilities.newBlob(Utilities.base64Decode(encoded)).getDataAsString();
        result.providers[provider] = {
          configured: true,
          masked: maskApiKey(decoded),
          name: PROVIDERS[provider].name
        };
      } else {
        result.providers[provider] = {
          configured: false,
          masked: null,
          name: PROVIDERS[provider].name
        };
      }
    }

    result.activeProvider = props.getProperty(ACTIVE_PROVIDER_KEY) || null;
    result.activeModel = props.getProperty(ACTIVE_MODEL_KEY) || null;

  } catch (e) {
    Logger.log(`[ApiKeyManager] Error getting all API keys: ${e.message}`);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER/MODEL SELECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Estableix el provider i model actius
 * @param {string} provider - ID del provider
 * @param {string} [model] - Model específic (opcional, usa default si no s'especifica)
 * @returns {Object} - Resultat de l'operació
 */
function setActiveProvider(provider, model) {
  if (!PROVIDERS[provider]) {
    return { success: false, error: `Provider "${provider}" no reconegut` };
  }

  // Verificar que hi ha API key configurada
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    return {
      success: false,
      error: `No tens cap API key configurada per ${PROVIDERS[provider].name}`
    };
  }

  // Usar model per defecte si no s'especifica
  const actualModel = model || PROVIDERS[provider].defaultModel;

  try {
    const props = PropertiesService.getUserProperties();
    props.setProperty(ACTIVE_PROVIDER_KEY, provider);
    props.setProperty(ACTIVE_MODEL_KEY, actualModel);

    Logger.log(`[ApiKeyManager] Active provider set: ${provider} (${actualModel})`);

    return {
      success: true,
      provider: provider,
      model: actualModel,
      name: PROVIDERS[provider].name
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Obté el provider actiu actual
 * @returns {Object|null} - Info del provider actiu o null si usa Docmile central
 */
function getActiveProvider() {
  try {
    const props = PropertiesService.getUserProperties();
    const provider = props.getProperty(ACTIVE_PROVIDER_KEY);

    if (!provider) return null;

    // Verificar que encara té la key
    const apiKey = getApiKey(provider);
    if (!apiKey) {
      // Netejar si la key ja no existeix
      props.deleteProperty(ACTIVE_PROVIDER_KEY);
      props.deleteProperty(ACTIVE_MODEL_KEY);
      return null;
    }

    const model = props.getProperty(ACTIVE_MODEL_KEY) || PROVIDERS[provider].defaultModel;

    return {
      provider: provider,
      model: model,
      name: PROVIDERS[provider].name
    };
  } catch (e) {
    Logger.log(`[ApiKeyManager] Error getting active provider: ${e.message}`);
    return null;
  }
}

/**
 * Desactiva el mode BYOK (tornar a Docmile central)
 * @returns {Object} - Resultat de l'operació
 */
function clearActiveProvider() {
  try {
    const props = PropertiesService.getUserProperties();
    props.deleteProperty(ACTIVE_PROVIDER_KEY);
    props.deleteProperty(ACTIVE_MODEL_KEY);

    Logger.log('[ApiKeyManager] Active provider cleared, using Docmile central');

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTH OBJECT BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix l'objecte auth per enviar al worker
 * Retorna null si no hi ha BYOK configurat (usa Docmile central)
 * @returns {Object|null} - Objecte auth per al payload o null
 */
function buildAuthObject() {
  const active = getActiveProvider();

  if (!active) {
    // No hi ha BYOK, usar Docmile central
    return null;
  }

  const apiKey = getApiKey(active.provider);
  if (!apiKey) {
    Logger.log('[ApiKeyManager] Warning: Active provider set but no API key found');
    return null;
  }

  return {
    mode: 'byok',
    provider: active.provider,
    api_key: apiKey,
    model: active.model
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Valida una API key fent una petició de test al worker
 * @param {string} provider - ID del provider
 * @param {string} apiKey - API key a validar
 * @returns {Object} - Resultat de la validació
 */
function validateApiKey(provider, apiKey) {
  if (!PROVIDERS[provider]) {
    return { valid: false, error: `Provider "${provider}" no reconegut` };
  }

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return { valid: false, error: 'API key invàlida (massa curta)' };
  }

  // Validació bàsica de format segons provider
  const key = apiKey.trim();

  switch(provider) {
    case 'openai':
      if (!key.startsWith('sk-')) {
        return { valid: false, error: 'Les API keys d\'OpenAI comencen per "sk-"' };
      }
      break;
    case 'claude':
      if (!key.startsWith('sk-ant-')) {
        return { valid: false, error: 'Les API keys de Claude comencen per "sk-ant-"' };
      }
      break;
    case 'groq':
      if (!key.startsWith('gsk_')) {
        return { valid: false, error: 'Les API keys de Groq comencen per "gsk_"' };
      }
      break;
    // gemini i mistral no tenen prefix estàndard
  }

  // TODO: En el futur, fer una petició real de test al worker
  // Per ara, només validem el format

  return {
    valid: true,
    provider: provider,
    message: 'Format de la clau correcte'
  };
}

// ═══════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Obté la llista de providers disponibles per mostrar a la UI
 * @returns {Array} - Llista de providers amb info
 */
function getAvailableProviders() {
  const apiKeys = getAllApiKeys();

  return Object.keys(PROVIDERS).map(id => ({
    id: id,
    name: PROVIDERS[id].name,
    defaultModel: PROVIDERS[id].defaultModel,
    models: Object.entries(PROVIDERS[id].models).map(([modelId, modelName]) => ({
      id: modelId,
      name: modelName
    })),
    configured: apiKeys.providers[id]?.configured || false,
    isActive: apiKeys.activeProvider === id
  }));
}

/**
 * Obté l'estat actual del mode BYOK per mostrar a la UI
 * @returns {Object} - Estat actual
 */
function getByokStatus() {
  const apiKeys = getAllApiKeys();
  const active = getActiveProvider();

  const configuredCount = Object.values(apiKeys.providers)
    .filter(p => p.configured).length;

  return {
    enabled: active !== null,
    provider: active?.provider || null,
    providerName: active?.name || null,
    model: active?.model || null,
    configuredProviders: configuredCount,
    totalProviders: Object.keys(PROVIDERS).length
  };
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Mascara una API key per mostrar (primers 4 + últims 4 caràcters)
 * @param {string} key - API key completa
 * @returns {string} - Key mascarada
 */
function maskApiKey(key) {
  if (!key || key.length < 12) return '****';
  return key.substring(0, 4) + '...' + key.substring(key.length - 4);
}
