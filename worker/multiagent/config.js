/**
 * Multi-Agent System Configuration v8.3
 *
 * Configuració centralitzada pel sistema multi-agent de classificació d'intents.
 *
 * IMPORTANT: Les API keys s'han de configurar com a secrets del worker.
 * No hardcodejar mai claus aquí.
 */

// ═══════════════════════════════════════════════════════════════
// FEATURE FLAGS
// ═══════════════════════════════════════════════════════════════

/**
 * Feature flag principal pel nou pipeline multi-agent.
 * Quan és false, s'utilitza el sistema regex antic.
 *
 * Per activar:
 * - En desenvolupament: canviar a true
 * - En producció: controlar via variable d'entorn USE_NEW_PIPELINE
 */
const USE_NEW_PIPELINE = true;  // ACTIVAT: Pipeline multi-agent actiu

/**
 * Mode shadow: executa ambdós pipelines i compara resultats.
 * Útil per validar el nou sistema sense afectar usuaris.
 */
const SHADOW_MODE = false;  // FASE 5: Per testing

/**
 * Feature flags granulars per control de funcionalitats
 */
const FEATURE_FLAGS = {
  // Pipeline principal
  enable_new_pipeline: USE_NEW_PIPELINE,
  enable_shadow_mode: SHADOW_MODE,

  // Rollout gradual
  enable_new_pipeline_gradual: false,  // Activar per % de peticions
  gradual_rollout_percentage: 0,       // 0-100%

  // Components individuals
  enable_semantic_cache: true,
  enable_circuit_breaker: true,
  enable_session_state: true,
  enable_gate0_fast_paths: true,

  // Logging detallat
  enable_telemetry: true,
  log_level: 'info',  // 'debug', 'info', 'warn', 'error'
};

// ═══════════════════════════════════════════════════════════════
// TIMEOUTS (Segons especificació v8.3)
// ═══════════════════════════════════════════════════════════════

const TIMEOUTS = {
  classifier: 5000,        // 5s màxim per classificar
  executor: 8000,          // 8s màxim per executar
  total_pipeline: 12000,   // 12s màxim total
  api_call: 10000,         // 10s timeout al fetch
  cache_computing: 30000,  // 30s timeout per cache COMPUTING state
};

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE THRESHOLDS (Segons especificació v8.3)
// ═══════════════════════════════════════════════════════════════

const CONFIDENCE_THRESHOLDS = {
  CHAT_ONLY: 0.60,
  REFERENCE_HIGHLIGHT: 0.70,
  UPDATE_BY_ID: 0.80,
  REWRITE: 0.85,
  VERY_LOW: 0.50,  // Per sota d'això → fallback directe a CHAT_ONLY
};

// ═══════════════════════════════════════════════════════════════
// CIRCUIT BREAKER (Segons especificació v8.3)
// ═══════════════════════════════════════════════════════════════

const CIRCUIT_BREAKER = {
  failure_threshold: 3,    // Errors consecutius per obrir el circuit
  recovery_timeout: 60000, // 60s abans de provar half-open
  half_open_max_calls: 2,  // Crides màximes en half-open
};

// ═══════════════════════════════════════════════════════════════
// CACHE CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CACHE = {
  l1: {
    enabled: true,
    // L1 és in-memory, es perd al reiniciar el worker
  },
  l2: {
    enabled: true,
    ttl_days: 7,
    similarity_threshold: 0.92,
    // Storage: Cloudflare KV (configurat al wrangler.toml)
  },
  pending_intent_ttl: 5 * 60 * 1000,  // 5 minuts TTL per pending_intent
};

// ═══════════════════════════════════════════════════════════════
// API CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const API = {
  gemini: {
    // Model pel classifier (ràpid, econòmic)
    classifier_model: 'gemini-2.5-flash',
    // Model pels executors (mateix model)
    executor_model: 'gemini-2.5-flash',
    // Model per embeddings (cache semàntic)
    embedding_model: 'text-embedding-004',
    // Base URL
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
    // Max retries
    max_retries: 1,
  },
  // Fallback a Claude Haiku si Gemini falla
  claude: {
    model: 'claude-3-5-haiku-20241022',
    base_url: 'https://api.anthropic.com/v1',
  },
};

// Shortcut per accedir a la config de Gemini directament
const GEMINI = {
  model_classifier: API.gemini.classifier_model,
  model_executor: API.gemini.executor_model,
  model_embedding: API.gemini.embedding_model,
  base_url: API.gemini.base_url,
  max_retries: API.gemini.max_retries,
};

// ═══════════════════════════════════════════════════════════════
// HIGHLIGHT COLORS (Segons especificació v8.3)
// ═══════════════════════════════════════════════════════════════

const HIGHLIGHT_COLORS = {
  ERROR_CRITICAL: '#FF6B6B',   // Vermell - Errors greus
  ERROR_MINOR: '#FFB347',      // Taronja - Errors menors
  WARNING: '#FFE66D',          // Groc - Advertències
  INFO: '#4ECDC4',             // Turquesa - Informació
  FOUND: '#95E1D3',            // Verd clar - Trobat/Coincidència
  STRUCTURE: '#A8D8EA',        // Blau clar - Estructura
  COMPARE_OLD: '#FFB3BA',      // Rosa - Versió antiga (comparació)
  COMPARE_NEW: '#BAFFC9',      // Verd - Versió nova (comparació)
};

// ═══════════════════════════════════════════════════════════════
// FAST PATH PATTERNS (Gate 0)
// ═══════════════════════════════════════════════════════════════

const FAST_PATH_PATTERNS = {
  greetings: {
    patterns: [
      /^(hola|bon dia|bones|bona tarda|bona nit|ei|hey)[\s!.,]*$/i,
      /^(buenos días|buenas tardes|buenas noches|hola)[\s!.,]*$/i,
      /^(hello|hi|hey|good morning|good afternoon)[\s!.,]*$/i,
    ],
    response: {
      ca: "Hola! Com puc ajudar-te amb el document?",
      es: "¡Hola! ¿Cómo puedo ayudarte con el documento?",
      en: "Hello! How can I help you with the document?",
    },
  },
  thanks: {
    patterns: [
      /^(gràcies|moltes gràcies|merci|mercès)[\s!.,]*$/i,
      /^(gracias|muchas gracias)[\s!.,]*$/i,
      /^(thanks|thank you|thx)[\s!.,]*$/i,
    ],
    response: {
      ca: "De res! Necessites alguna cosa més?",
      es: "¡De nada! ¿Necesitas algo más?",
      en: "You're welcome! Do you need anything else?",
    },
  },
  farewell: {
    patterns: [
      /^(adéu|fins aviat|fins després|a reveure)[\s!.,]*$/i,
      /^(adiós|hasta luego|hasta pronto)[\s!.,]*$/i,
      /^(bye|goodbye|see you)[\s!.,]*$/i,
    ],
    response: {
      ca: "Fins aviat! Bona feina amb el document.",
      es: "¡Hasta luego! Buen trabajo con el documento.",
      en: "Goodbye! Good luck with your document.",
    },
  },
  help: {
    patterns: [
      /^(ajuda|què pots fer|com funciones|quines funcions tens)[\s?!.,]*$/i,
      /^(ayuda|qué puedes hacer|cómo funcionas)[\s?!.,]*$/i,
      /^(help|what can you do|how do you work)[\s?!.,]*$/i,
    ],
    response: {
      ca: `Puc ajudar-te amb el document de diverses maneres:

• **Revisar errors**: "Veus faltes al document?"
• **Buscar contingut**: "On parla de pressupost?"
• **Millorar text**: "Millora el paràgraf 3"
• **Reescriure**: "Fes el document més formal"
• **Respondre preguntes**: "Què diu l'article 5?"

Escriu la teva instrucció i faré el possible per ajudar-te!`,
      es: `Puedo ayudarte con el documento de varias formas:

• **Revisar errores**: "¿Ves faltas en el documento?"
• **Buscar contenido**: "¿Dónde habla del presupuesto?"
• **Mejorar texto**: "Mejora el párrafo 3"
• **Reescribir**: "Haz el documento más formal"
• **Responder preguntas**: "¿Qué dice el artículo 5?"

¡Escribe tu instrucción y haré lo posible por ayudarte!`,
      en: `I can help you with the document in several ways:

• **Review errors**: "Do you see any mistakes?"
• **Find content**: "Where does it talk about budget?"
• **Improve text**: "Improve paragraph 3"
• **Rewrite**: "Make the document more formal"
• **Answer questions**: "What does article 5 say?"

Write your instruction and I'll do my best to help!`,
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// LANGUAGE DETECTION PATTERNS
// ═══════════════════════════════════════════════════════════════

const LANGUAGE_PATTERNS = {
  catalan: [
    /\b(què|això|paràgraf|d'aquest|l'article|perquè|també|però|només|més)\b/i,
    /\b(veus|pots|podries|facis|tinguis|estigui|sigui)\b/i,
    /[àèéíòóú]/i,
  ],
  spanish: [
    /\b(qué|esto|párrafo|artículo|porque|también|pero|solo|más)\b/i,
    /\b(puedes|podrías|hagas|tengas|estés|seas)\b/i,
    /[áéíóúñ¿¡]/i,
  ],
  // Default: Català si no es detecta res
};

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // Feature flags
  USE_NEW_PIPELINE,
  SHADOW_MODE,
  FEATURE_FLAGS,

  // Timeouts and thresholds
  TIMEOUTS,
  CONFIDENCE_THRESHOLDS,
  CIRCUIT_BREAKER,
  CACHE,

  // API config
  API,
  GEMINI,

  // UI config
  HIGHLIGHT_COLORS,

  // Patterns
  FAST_PATH_PATTERNS,
  LANGUAGE_PATTERNS,
};
