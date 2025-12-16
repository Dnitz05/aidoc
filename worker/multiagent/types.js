/**
 * Multi-Agent System Types v14.0
 *
 * Definició de tots els tipus, enums i estructures de dades
 * pel sistema multi-agent de classificació d'intents.
 *
 * v14.0: Sistema Unificat - Un sol format de resposta amb capacitats additives
 *        - response: SEMPRE present (text per mostrar)
 *        - highlights: OPCIONAL (si cal senyalar)
 *        - changes: OPCIONAL (si cal modificar)
 *
 * Nota: Com que és JavaScript (no TypeScript), utilitzem JSDoc
 * per documentació i validació en temps de desenvolupament.
 */

// ═══════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════

/**
 * Modes de resposta disponibles
 * @enum {string}
 */
const Mode = {
  CHAT_ONLY: 'CHAT_ONLY',
  REFERENCE_HIGHLIGHT: 'REFERENCE_HIGHLIGHT',
  UPDATE_BY_ID: 'UPDATE_BY_ID',
  REWRITE: 'REWRITE',
};

/**
 * Tipus d'acció detectada a la instrucció
 * @enum {string}
 */
const ActionType = {
  ANALYZE: 'analyze',   // Revisar, avaluar, comprovar
  LOCATE: 'locate',     // Trobar, buscar, on parla
  MODIFY: 'modify',     // Canviar, corregir, millorar
  CREATE: 'create',     // Afegir, inserir, escriure nou
  DELETE: 'delete',     // Eliminar, treure, esborrar
  EXPLAIN: 'explain',   // Explicar, aclarir, resumir
};

/**
 * Abast de l'acció (granularitat)
 * @enum {string}
 */
const Scope = {
  WORD: 'word',           // Paraula específica
  PHRASE: 'phrase',       // Frase o fragment
  SENTENCE: 'sentence',   // Oració completa
  PARAGRAPH: 'paragraph', // Paràgraf sencer
  SECTION: 'section',     // Secció (múltiples paràgrafs)
  DOCUMENT: 'document',   // Document complet
};

/**
 * Estratègia de highlighting
 * @enum {string}
 */
const HighlightStrategy = {
  ERRORS: 'errors',           // Errors ortogràfics/gramaticals
  SUGGESTIONS: 'suggestions', // Suggeriments de millora
  REFERENCES: 'references',   // Referències a conceptes
  MENTIONS: 'mentions',       // Mencions d'un terme
  STRUCTURE: 'structure',     // Estructura del document
  COMPARISON: 'comparison',   // Comparació abans/després
  ISSUES: 'issues',           // Problemes generals
  CUSTOM: 'custom',           // Basat en keywords
  ALL: 'all',                 // Revisió completa
};

/**
 * Nivell de risc de l'acció
 * @enum {string}
 */
const RiskLevel = {
  NONE: 'none',       // CHAT_ONLY
  LOW: 'low',         // REFERENCE_HIGHLIGHT
  MEDIUM: 'medium',   // UPDATE_BY_ID petit
  HIGH: 'high',       // REWRITE o UPDATE gran
};

/**
 * Estat del cache
 * @enum {string}
 */
const CacheState = {
  AVAILABLE: 'available',
  COMPUTING: 'computing',
  STALE: 'stale',
};

/**
 * Estat del circuit breaker
 * @enum {string}
 */
const CircuitBreakerState = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open',
};

// ═══════════════════════════════════════════════════════════════
// v14.1: VALIDATION STATUS ENUMS
// ═══════════════════════════════════════════════════════════════

/**
 * Estat de validació d'un canvi o highlight
 * @enum {string}
 */
const ChangeStatus = {
  OK: 'OK',           // Vàlid, es pot aplicar
  BLOCK: 'BLOCK',     // Invàlid, NO aplicar mai
  WARN: 'WARN',       // Vàlid però amb precaució, no auto-aplicar
  STALE: 'STALE',     // El document ha canviat, cal recalcular
};

/**
 * Motius de BLOCK
 * @enum {string}
 */
const BlockReason = {
  PARAGRAPH_NOT_FOUND: 'paragraph_not_found',
  PARAGRAPH_OUT_OF_RANGE: 'paragraph_out_of_range',
  FIND_NOT_FOUND: 'find_not_found',
  BEFORE_MISMATCH: 'before_mismatch',
  EDIT_DISTANCE_EXCEEDED: 'edit_distance_exceeded_for_mode',
  INVALID_CHANGE: 'invalid_change',
};

/**
 * Motius de WARN
 * @enum {string}
 */
const WarnReason = {
  BIG_CHANGE: 'big_change_requires_confirm',
  MULTIPLE_SUBSTITUTIONS: 'multiple_substitutions',
  STYLE_CHANGE_NOT_REQUESTED: 'style_change_not_requested',
  MEDIUM_RISK: 'medium_risk',
  HIGH_RISK: 'high_risk',
};

/**
 * Colors per highlights
 * @enum {string}
 */
const HighlightColor = {
  ERROR_CRITICAL: '#FF6B6B',
  ERROR_MINOR: '#FFB347',
  WARNING: '#FFE66D',
  INFO: '#4ECDC4',
  FOUND: '#95E1D3',
  STRUCTURE: '#A8D8EA',
  COMPARE_OLD: '#FFB3BA',
  COMPARE_NEW: '#BAFFC9',
};

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS (JSDoc)
// ═══════════════════════════════════════════════════════════════

/**
 * Input sanititzat
 * @typedef {Object} SanitizedInput
 * @property {string} original - Instrucció original
 * @property {string} normalized - Instrucció normalitzada (lowercase, trim, accents)
 * @property {string} language - Idioma detectat ('ca' | 'es' | 'en')
 * @property {Array<RefHint>} ref_hints - Referències detectades (§3, article 5, etc.)
 * @property {number} token_count - Estimació de tokens
 * @property {Array<Entity>} entities - Entitats detectades
 */

/**
 * Referència detectada a la instrucció
 * @typedef {Object} RefHint
 * @property {string} type - Tipus ('paragraph' | 'article' | 'section' | 'page')
 * @property {number|string} value - Valor (número o text)
 * @property {string} raw_match - Text original que ha fet match
 */

/**
 * Entitat detectada
 * @typedef {Object} Entity
 * @property {string} type - Tipus ('person' | 'organization' | 'location' | 'concept')
 * @property {string} value - Valor de l'entitat
 * @property {number} start - Posició inicial
 * @property {number} end - Posició final
 */

/**
 * Context del document
 * @typedef {Object} DocumentContext
 * @property {string} full_text - Text complet del document
 * @property {Array<Paragraph>} paragraphs - Array de paràgrafs
 * @property {string} hash - SHA256 del document complet
 * @property {string} summary - Resum o primers 500 chars
 * @property {Array<HeadingNode>} structure - Arbre de headings
 * @property {Array<Definition>} definitions - Termes definits al document
 * @property {Object} metadata - Metadades del document
 */

/**
 * Paràgraf del document
 * @typedef {Object} Paragraph
 * @property {number} id - ID del paràgraf (0-indexed)
 * @property {string} text - Text del paràgraf
 * @property {string} hash - SHA256 del paràgraf
 * @property {string|null} heading_context - Heading pare
 * @property {string} type - Tipus ('heading' | 'body' | 'list' | 'table')
 */

/**
 * Node de heading (estructura del document)
 * @typedef {Object} HeadingNode
 * @property {number} level - Nivell del heading (1-6)
 * @property {string} text - Text del heading
 * @property {number} para_id - ID del paràgraf
 * @property {Array<HeadingNode>} children - Subheadings
 */

/**
 * Definició trobada al document
 * @typedef {Object} Definition
 * @property {string} term - Terme definit
 * @property {string} definition - Definició
 * @property {number} para_id - ID del paràgraf on es defineix
 */

/**
 * Context de conversa
 * @typedef {Object} ConversationContext
 * @property {Array<Turn>} turns - Últims torns de conversa
 * @property {Array<number>} mentioned_paragraphs - Paràgrafs mencionats recentment
 * @property {string|null} last_mode_used - Últim mode utilitzat
 * @property {Array<number>} last_highlights - Para IDs destacats recentment
 */

/**
 * Torn de conversa
 * @typedef {Object} Turn
 * @property {string} role - 'user' o 'assistant'
 * @property {string} content - Contingut del missatge
 * @property {string|null} mode - Mode utilitzat (si és assistant)
 * @property {number} timestamp - Timestamp del torn
 */

/**
 * Estat de sessió
 * @typedef {Object} SessionState
 * @property {ConversationContext} conversation - Context de conversa
 * @property {PendingIntent|null} pending_intent - Intent pendent de clarificació
 * @property {Object|null} rewrite_preview - Preview pendent de confirmació
 */

/**
 * Intent pendent de clarificació/confirmació
 * @typedef {Object} PendingIntent
 * @property {string} state - 'waiting_clarification' | 'waiting_confirmation'
 * @property {IntentPayload} original_intent - Intent original
 * @property {string} missing_param - Paràmetre que falta
 * @property {Array<string>} options_offered - Opcions ofertes a l'usuari
 * @property {number} expires_at - Timestamp d'expiració (TTL)
 */

/**
 * Payload d'intent (output del Classifier)
 * @typedef {Object} IntentPayload
 * @property {string} mode - Mode seleccionat (CHAT_ONLY, REFERENCE_HIGHLIGHT, etc.)
 * @property {number} confidence - Confiança de la classificació (0-1)
 * @property {string} thought - v12.1: Chain-of-thought del classifier (1 frase)
 * @property {string} reasoning - Raonament de la classificació (max 150 chars)
 * @property {string|null} response_style - v12.1: Estil de resposta per CHAT_ONLY (concise|bullet_points|detailed)
 * @property {string|null} secondary_mode - Mode secundari per fallback
 * @property {number|null} secondary_confidence - Confiança del mode secundari
 * @property {string} action_type - Tipus d'acció (analyze, locate, modify, etc.)
 * @property {string} scope - Abast (word, phrase, paragraph, etc.)
 * @property {Array<number>} target_paragraphs - IDs de paràgrafs objectiu
 * @property {Array<string>} keywords - Paraules clau a buscar/destacar
 * @property {string|null} highlight_strategy - Estratègia de highlighting
 * @property {string|null} expected_count - Nombre esperat ('single', 'few', 'many')
 * @property {string|null} color_scheme - Esquema de colors
 * @property {string|null} modification_type - Tipus de modificació
 * @property {boolean} preserve_structure - Preservar estructura
 * @property {boolean} preserve_tone - Preservar to
 * @property {boolean} requires_confirmation - Requereix confirmació
 * @property {string} risk_level - Nivell de risc
 * @property {boolean} is_question - És una pregunta
 * @property {Array<ResolvedReference>} resolved_references - Anàfores resoltes
 */

/**
 * Referència resolta (anàfora)
 * @typedef {Object} ResolvedReference
 * @property {string} original - Text original ('això', 'l'anterior', etc.)
 * @property {string} resolved_to - A què es resol
 * @property {number|null} para_id - ID del paràgraf si s'ha resolt
 */

/**
 * Resultat de l'executor
 * @typedef {Object} ExecutorResult
 * @property {boolean} success - Si ha tingut èxit
 * @property {string} mode - Mode executat
 * @property {string} [response] - Resposta (per CHAT_ONLY)
 * @property {SuggestedFollowup} [suggested_followup] - Suggeriment de follow-up
 * @property {Array<Highlight>} [highlights] - Highlights (per REFERENCE_HIGHLIGHT)
 * @property {Array<ParagraphUpdate>} [updates] - Updates (per UPDATE_BY_ID)
 * @property {RewritePreview} [preview] - Preview (per REWRITE)
 * @property {boolean} [confirmed] - Si s'ha confirmat (per REWRITE)
 * @property {string} [new_content] - Nou contingut (per REWRITE confirmat)
 * @property {ExecutorError} [error] - Error si ha fallat
 * @property {boolean} [fallback_used] - Si s'ha usat fallback
 * @property {string} [fallback_reason] - Raó del fallback
 */

/**
 * Highlight individual
 * @typedef {Object} Highlight
 * @property {number} para_id - ID del paràgraf
 * @property {number} start - Posició inicial (0-indexed, dins del paràgraf)
 * @property {number} end - Posició final (exclusiu)
 * @property {string} text - Text destacat (per verificació)
 * @property {string} reason - Explicació del highlight
 * @property {string} color - Color del highlight
 * @property {string} [severity] - Severitat ('critical', 'warning', 'info')
 */

/**
 * Suggeriment de follow-up
 * @typedef {Object} SuggestedFollowup
 * @property {boolean} available - Si hi ha follow-up disponible
 * @property {string} prompt - Pregunta a mostrar ("Vols que t'ho marqui?")
 * @property {string} would_become_mode - Mode que s'usaria
 * @property {Array<number>} preview_targets - Para IDs que es marcarien
 */

/**
 * Actualització de paràgraf
 * @typedef {Object} ParagraphUpdate
 * @property {number} para_id - ID del paràgraf
 * @property {string} before - Contingut abans (snapshot per Undo)
 * @property {string} after - Contingut després
 * @property {string} change_type - Tipus de canvi ('modify', 'delete', 'insert')
 */

/**
 * Preview de rewrite
 * @typedef {Object} RewritePreview
 * @property {string} summary - Resum dels canvis
 * @property {number} total_paragraphs_affected - Paràgrafs afectats
 * @property {Array<PreviewChange>} changes - Canvis detallats
 * @property {number} impact_score - Impacte (0-1)
 * @property {number} word_count_delta - Canvi en nombre de paraules
 */

/**
 * Canvi individual del preview
 * @typedef {Object} PreviewChange
 * @property {number|null} para_id - ID del paràgraf (null per insercions)
 * @property {string} type - Tipus ('modify', 'delete', 'insert')
 * @property {string} [before] - Contingut abans
 * @property {string} [after] - Contingut després
 * @property {number} [insert_after] - Després de quin para_id inserir
 */

/**
 * Error d'executor
 * @typedef {Object} ExecutorError
 * @property {string} code - Codi d'error
 * @property {string} message - Missatge d'error
 * @property {boolean} recoverable - Si és recuperable
 */

/**
 * Entrada de cache
 * @typedef {Object} CacheEntry
 * @property {CacheKey} key - Clau del cache
 * @property {IntentPayload} value - Valor guardat
 * @property {string} state - Estat ('available', 'computing', 'stale')
 * @property {number} created_at - Timestamp de creació
 * @property {number} expires_at - Timestamp d'expiració
 * @property {number} hit_count - Nombre de hits
 */

/**
 * Clau de cache
 * @typedef {Object} CacheKey
 * @property {string} instruction_hash - Hash de la instrucció
 * @property {Float32Array} [instruction_embedding] - Embedding per L2
 * @property {string} doc_hash - Hash del document complet
 * @property {boolean} has_conversation_context - Si té context de conversa
 */

// ═══════════════════════════════════════════════════════════════
// UNIFIED RESPONSE TYPES (v14.0)
// ═══════════════════════════════════════════════════════════════

/**
 * Resposta Unificada del Sistema v14.0
 * Un sol format amb capacitats additives
 *
 * @typedef {Object} UnifiedResponse
 * @property {string} response - SEMPRE PRESENT - Text per mostrar al chat
 * @property {Array<UnifiedHighlight>} [highlights] - OPCIONAL - Coses a senyalar al document
 * @property {Array<UnifiedChange>} [changes] - OPCIONAL - Modificacions a aplicar
 * @property {UnifiedMeta} _meta - Metadades per telemetria
 */

/**
 * Highlight unificat per senyalar text al document
 * v14.1: Afegit _status per validació
 *
 * @typedef {Object} UnifiedHighlight
 * @property {string} id - ID únic del highlight (h_001, h_002...)
 * @property {number} paragraph_id - ID del paràgraf (0-indexed)
 * @property {string} text - Text exacte a ressaltar
 * @property {number} [start] - Posició inicial dins del paràgraf (calculada si no present)
 * @property {number} [end] - Posició final (calculada si no present)
 * @property {string} color - Color: "info" | "error" | "warning" | "success"
 * @property {string} [reason] - Motiu/comentari opcional
 * @property {string} _status - Estat de validació: OK | BLOCK | WARN
 * @property {string} [_block_reason] - Motiu del BLOCK si aplica
 */

/**
 * Canvi unificat per modificar el document
 * v14.1: Afegit before_text, before_hash, _status, _edit_distance
 *
 * @typedef {Object} UnifiedChange
 * @property {string} id - ID únic del canvi (c_001, c_002...)
 * @property {number} paragraph_id - ID del paràgraf (0-indexed)
 * @property {string} original - Text original a reemplaçar (find)
 * @property {string} replacement - Text nou (replace)
 * @property {string} before_text - TEXT COMPLET del paràgraf abans del canvi
 * @property {string} before_hash - SHA256 del before_text
 * @property {number} [start] - Posició inicial (per precisió)
 * @property {number} [end] - Posició final (per precisió)
 * @property {string} [reason] - Motiu del canvi (typo, accent, grammar, improve, etc.)
 * @property {string} _status - Estat de validació: OK | BLOCK | WARN | STALE
 * @property {string} [_block_reason] - Motiu del BLOCK si aplica
 * @property {string} [_warn_reason] - Motiu del WARN si aplica
 * @property {number} [_edit_distance] - Distància d'edició calculada
 */

/**
 * Snapshot del document per validació de race conditions
 * v14.1: Nou tipus per tracking de versions
 *
 * @typedef {Object} DocSnapshot
 * @property {string} doc_id - ID del document
 * @property {string} [revision_id] - Revision ID de Google Docs (opcional, Fase 3)
 * @property {number} paragraph_count - Nombre de paràgrafs
 * @property {number} timestamp - Timestamp de quan es va capturar
 */

/**
 * Resum de validació per la resposta
 * v14.1: Nou tipus per telemetria i UI
 *
 * @typedef {Object} ValidationSummary
 * @property {number} total_changes - Total de canvis proposats
 * @property {number} total_highlights - Total de highlights proposats
 * @property {number} ok_count - Canvis/highlights OK
 * @property {number} blocked_count - Canvis/highlights BLOCK
 * @property {number} warned_count - Canvis/highlights WARN
 * @property {number} stale_count - Canvis STALE
 * @property {number} [ed_min] - Edit distance mínim
 * @property {number} [ed_max] - Edit distance màxim
 * @property {number} [ed_avg] - Edit distance mitjà
 */

/**
 * Metadades de la resposta unificada
 * v14.1: Afegit validation summary
 *
 * @typedef {Object} UnifiedMeta
 * @property {string} executor - Executor utilitzat ('unified')
 * @property {string} provider - Provider d'IA
 * @property {string} model - Model utilitzat
 * @property {number} [tokens_input] - Tokens d'entrada
 * @property {number} [tokens_output] - Tokens de sortida
 * @property {string} [intent_type] - Tipus d'intent detectat (question, detection, modification)
 * @property {number} [latency_ms] - Latència en ms
 * @property {ValidationSummary} [validation] - Resum de validació
 */

/**
 * Log de request (telemetria)
 * @typedef {Object} RequestLog
 * @property {string} request_id - ID únic de la request
 * @property {string} timestamp - Timestamp ISO8601
 * @property {number} instruction_length - Longitud de la instrucció
 * @property {string} instruction_language - Idioma detectat
 * @property {number} doc_paragraph_count - Nombre de paràgrafs del document
 * @property {string} doc_hash - Hash del document
 * @property {boolean} has_conversation_context - Si té context de conversa
 * @property {boolean} fast_path_matched - Si ha fet match amb fast path
 * @property {string|null} fast_path_type - Tipus de fast path
 * @property {boolean} cache_hit - Si ha estat cache hit
 * @property {string|null} cache_layer - Layer del cache ('L1', 'L2', null)
 * @property {string} classifier_model - Model utilitzat pel classifier
 * @property {number} classifier_latency_ms - Latència del classifier
 * @property {string} classified_mode - Mode classificat
 * @property {number} classified_confidence - Confiança de la classificació
 * @property {boolean} confidence_sufficient - Si la confiança és suficient
 * @property {boolean} clarification_requested - Si s'ha demanat clarificació
 * @property {string} executor_used - Executor utilitzat
 * @property {number} executor_latency_ms - Latència de l'executor
 * @property {number} context_tokens_sent - Tokens de context enviats
 * @property {boolean} validation_passed - Si ha passat la validació
 * @property {Array<string>} validation_errors - Errors de validació
 * @property {boolean} fallback_triggered - Si s'ha activat fallback
 * @property {string} final_mode - Mode final
 * @property {number|null} highlights_count - Nombre de highlights
 * @property {number|null} paragraphs_modified - Paràgrafs modificats
 * @property {string} circuit_breaker_state - Estat del circuit breaker
 * @property {number} consecutive_errors - Errors consecutius
 * @property {boolean|null} user_confirmed - Si l'usuari ha confirmat
 * @property {boolean|null} user_rejected - Si l'usuari ha rebutjat
 * @property {boolean|null} user_retry - Si l'usuari ha reintentat
 */

// ═══════════════════════════════════════════════════════════════
// FACTORY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Crea un SanitizedInput buit
 * @returns {SanitizedInput}
 */
function createSanitizedInput() {
  return {
    original: '',
    normalized: '',
    language: 'ca',
    ref_hints: [],
    token_count: 0,
    entities: [],
  };
}

/**
 * Crea un IntentPayload per defecte (CHAT_ONLY)
 * @returns {IntentPayload}
 */
function createDefaultIntent() {
  return {
    mode: Mode.CHAT_ONLY,
    confidence: 0.5,
    // v12.1: Nous camps
    thought: '',
    reasoning: 'Default fallback',
    response_style: null,
    secondary_mode: null,
    secondary_confidence: null,
    action_type: ActionType.EXPLAIN,
    scope: Scope.DOCUMENT,
    target_paragraphs: [],
    keywords: [],
    highlight_strategy: null,
    expected_count: null,
    color_scheme: null,
    modification_type: null,
    preserve_structure: true,
    preserve_tone: true,
    requires_confirmation: false,
    risk_level: RiskLevel.NONE,
    is_question: false,
    resolved_references: [],
  };
}

/**
 * Crea un SessionState nou
 * @returns {SessionState}
 */
function createSessionState() {
  return {
    conversation: {
      turns: [],
      mentioned_paragraphs: [],
      last_mode_used: null,
      last_highlights: [],
    },
    pending_intent: null,
    rewrite_preview: null,
  };
}

/**
 * Crea un ExecutorResult d'error
 * @param {string} code - Codi d'error
 * @param {string} message - Missatge d'error
 * @returns {ExecutorResult}
 */
function createErrorResult(code, message) {
  return {
    success: false,
    mode: Mode.CHAT_ONLY,
    response: message,
    error: {
      code,
      message,
      recoverable: true,
    },
  };
}

/**
 * Crea una UnifiedResponse buida
 * @param {string} response - Text de resposta
 * @returns {UnifiedResponse}
 */
function createUnifiedResponse(response = '') {
  return {
    response,
    highlights: null,
    changes: null,
    _meta: {
      executor: 'unified',
      provider: 'unknown',
      model: 'unknown',
    },
  };
}

/**
 * Crea un DocSnapshot
 * v14.1: Per tracking de versions del document
 * @param {string} docId - ID del document
 * @param {number} paragraphCount - Nombre de paràgrafs
 * @param {string} [revisionId] - Revision ID opcional
 * @returns {DocSnapshot}
 */
function createDocSnapshot(docId, paragraphCount, revisionId = null) {
  return {
    doc_id: docId,
    revision_id: revisionId,
    paragraph_count: paragraphCount,
    timestamp: Date.now(),
  };
}

/**
 * Crea un ValidationSummary buit
 * v14.1: Per telemetria de validació
 * @returns {ValidationSummary}
 */
function createValidationSummary() {
  return {
    total_changes: 0,
    total_highlights: 0,
    ok_count: 0,
    blocked_count: 0,
    warned_count: 0,
    stale_count: 0,
    ed_min: null,
    ed_max: null,
    ed_avg: null,
  };
}

/**
 * Genera un ID únic per canvis o highlights
 * v14.1: Per identificar cada ítem
 * @param {string} prefix - Prefix ('c' per change, 'h' per highlight)
 * @param {number} index - Índex de l'ítem
 * @returns {string}
 */
function generateItemId(prefix, index) {
  return `${prefix}_${String(index).padStart(3, '0')}`;
}

/**
 * Crea una UnifiedResponse d'error
 * @param {string} message - Missatge d'error
 * @param {string} [language='ca'] - Idioma
 * @returns {UnifiedResponse}
 */
function createUnifiedErrorResponse(message, language = 'ca') {
  const fallbackMessages = {
    ca: "Ho sento, he tingut un problema processant la teva petició. Pots tornar a provar?",
    es: "Lo siento, he tenido un problema procesando tu petición. ¿Puedes volver a intentarlo?",
    en: "Sorry, I had a problem processing your request. Can you try again?",
  };

  return {
    response: message || fallbackMessages[language] || fallbackMessages.ca,
    highlights: null,
    changes: null,
    _meta: {
      executor: 'unified',
      provider: 'error',
      model: 'none',
      error: true,
    },
  };
}

/**
 * Crea un RequestLog buit
 * @param {string} request_id - ID de la request
 * @returns {RequestLog}
 */
function createRequestLog(request_id) {
  return {
    request_id,
    timestamp: new Date().toISOString(),
    instruction_length: 0,
    instruction_language: 'ca',
    doc_paragraph_count: 0,
    doc_hash: '',
    has_conversation_context: false,
    fast_path_matched: false,
    fast_path_type: null,
    cache_hit: false,
    cache_layer: null,
    classifier_model: '',
    classifier_latency_ms: 0,
    classified_mode: '',
    classified_confidence: 0,
    confidence_sufficient: false,
    clarification_requested: false,
    executor_used: '',
    executor_latency_ms: 0,
    context_tokens_sent: 0,
    validation_passed: false,
    validation_errors: [],
    fallback_triggered: false,
    final_mode: '',
    highlights_count: null,
    paragraphs_modified: null,
    circuit_breaker_state: CircuitBreakerState.CLOSED,
    consecutive_errors: 0,
    user_confirmed: null,
    user_rejected: null,
    user_retry: null,
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Valida que un objecte és un Mode vàlid
 * @param {string} mode
 * @returns {boolean}
 */
function isValidMode(mode) {
  return Object.values(Mode).includes(mode);
}

/**
 * Valida que un IntentPayload té els camps requerits
 * @param {Object} payload
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validateIntentPayload(payload) {
  const errors = [];

  if (!payload) {
    return { valid: false, errors: ['Payload is null'] };
  }

  if (!isValidMode(payload.mode)) {
    errors.push(`Invalid mode: ${payload.mode}`);
  }

  if (typeof payload.confidence !== 'number' || payload.confidence < 0 || payload.confidence > 1) {
    errors.push(`Invalid confidence: ${payload.confidence}`);
  }

  if (!Object.values(ActionType).includes(payload.action_type)) {
    errors.push(`Invalid action_type: ${payload.action_type}`);
  }

  if (!Object.values(Scope).includes(payload.scope)) {
    errors.push(`Invalid scope: ${payload.scope}`);
  }

  if (!Array.isArray(payload.target_paragraphs)) {
    errors.push('target_paragraphs must be an array');
  }

  if (!Array.isArray(payload.keywords)) {
    errors.push('keywords must be an array');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Valida un Highlight
 * @param {Object} highlight
 * @param {Array<Paragraph>} paragraphs
 * @returns {{valid: boolean, errors: Array<string>}}
 */
function validateHighlight(highlight, paragraphs) {
  const errors = [];

  if (typeof highlight.para_id !== 'number') {
    errors.push('para_id must be a number');
  } else if (highlight.para_id < 0 || highlight.para_id >= paragraphs.length) {
    errors.push(`para_id ${highlight.para_id} out of bounds (max: ${paragraphs.length - 1})`);
  }

  if (typeof highlight.start !== 'number' || highlight.start < 0) {
    errors.push('start must be a non-negative number');
  }

  if (typeof highlight.end !== 'number' || highlight.end <= highlight.start) {
    errors.push('end must be greater than start');
  }

  // Verificar que start/end estan dins dels límits del paràgraf
  if (highlight.para_id >= 0 && highlight.para_id < paragraphs.length) {
    const para = paragraphs[highlight.para_id];
    if (highlight.end > para.text.length) {
      errors.push(`end (${highlight.end}) exceeds paragraph length (${para.text.length})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // Enums
  Mode,
  ActionType,
  Scope,
  HighlightStrategy,
  RiskLevel,
  CacheState,
  CircuitBreakerState,
  HighlightColor,
  // v14.1: Validation Status Enums
  ChangeStatus,
  BlockReason,
  WarnReason,

  // Factory functions
  createSanitizedInput,
  createDefaultIntent,
  createSessionState,
  createErrorResult,
  createRequestLog,
  // v14.0: Unified Response
  createUnifiedResponse,
  createUnifiedErrorResponse,
  // v14.1: Validation Support
  createDocSnapshot,
  createValidationSummary,
  generateItemId,

  // Validation functions
  isValidMode,
  validateIntentPayload,
  validateHighlight,
};
