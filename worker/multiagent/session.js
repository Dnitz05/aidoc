/**
 * Multi-Agent System Session State v8.3
 *
 * Gestió de l'estat de sessió incloent:
 * - Historial de conversa (últims N torns)
 * - Pending intents (clarificacions pendents)
 * - Rewrite previews pendents de confirmació
 * - Referències a paràgrafs mencionats
 */

import { createSessionState, Mode } from './types.js';
import { CACHE } from './config.js';
import { logDebug, logInfo } from './telemetry.js';

// ═══════════════════════════════════════════════════════════════
// SESSION STORAGE
// ═══════════════════════════════════════════════════════════════

/**
 * Emmagatzematge de sessions in-memory.
 * En producció, això podria ser Cloudflare Durable Objects o KV.
 * @type {Map<string, SessionState>}
 */
const sessionStore = new Map();

/**
 * Màxim de torns a mantenir a l'historial
 */
const MAX_CONVERSATION_TURNS = 5;

/**
 * Màxim de paràgrafs mencionats a recordar
 */
const MAX_MENTIONED_PARAGRAPHS = 10;

// ═══════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Obté o crea una sessió
 * @param {string} sessionId - ID de la sessió
 * @returns {SessionState}
 */
function getSession(sessionId) {
  if (!sessionId) {
    return createSessionState();
  }

  if (!sessionStore.has(sessionId)) {
    sessionStore.set(sessionId, createSessionState());
    logDebug('New session created', { sessionId });
  }

  return sessionStore.get(sessionId);
}

/**
 * Guarda una sessió
 * @param {string} sessionId - ID de la sessió
 * @param {SessionState} session - Estat de sessió
 */
function saveSession(sessionId, session) {
  if (!sessionId) return;
  sessionStore.set(sessionId, session);
}

/**
 * Elimina una sessió
 * @param {string} sessionId - ID de la sessió
 */
function deleteSession(sessionId) {
  if (sessionId) {
    sessionStore.delete(sessionId);
    logDebug('Session deleted', { sessionId });
  }
}

/**
 * Neteja sessions expirades (garbage collection)
 * Cridar periòdicament per evitar memory leaks
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, session] of sessionStore.entries()) {
    // Si la sessió no té activitat recent (30 min)
    const lastActivity = session.lastActivity || 0;
    if (now - lastActivity > 30 * 60 * 1000) {
      sessionStore.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logInfo('Sessions cleaned up', { count: cleaned });
  }
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATION HISTORY
// ═══════════════════════════════════════════════════════════════

/**
 * Afegeix un torn a l'historial de conversa
 * @param {SessionState} session - Estat de sessió
 * @param {string} role - 'user' o 'assistant'
 * @param {string} content - Contingut del missatge
 * @param {string} [mode] - Mode utilitzat (només per assistant)
 * @returns {SessionState} - Sessió actualitzada
 */
function addConversationTurn(session, role, content, mode = null) {
  const turn = {
    role,
    content,
    mode,
    timestamp: Date.now(),
  };

  // Afegir a l'historial
  session.conversation.turns.push(turn);

  // Mantenir només els últims N torns
  if (session.conversation.turns.length > MAX_CONVERSATION_TURNS) {
    session.conversation.turns = session.conversation.turns.slice(-MAX_CONVERSATION_TURNS);
  }

  // Actualitzar últim mode usat (si és assistant)
  if (role === 'assistant' && mode) {
    session.conversation.last_mode_used = mode;
  }

  // Actualitzar última activitat
  session.lastActivity = Date.now();

  return session;
}

/**
 * Obté els últims N torns de conversa
 * @param {SessionState} session - Estat de sessió
 * @param {number} [n=2] - Nombre de torns a retornar
 * @returns {Array<Turn>}
 */
function getLastTurns(session, n = 2) {
  if (!session || !session.conversation || !session.conversation.turns) {
    return [];
  }
  return session.conversation.turns.slice(-n);
}

/**
 * Obté el context de conversa per al classifier
 * @param {SessionState} session - Estat de sessió
 * @returns {ConversationContext}
 */
function getConversationContext(session) {
  if (!session) {
    return {
      turns: [],
      mentioned_paragraphs: [],
      last_mode_used: null,
      last_highlights: [],
    };
  }

  return {
    turns: session.conversation.turns.slice(-2),
    mentioned_paragraphs: session.conversation.mentioned_paragraphs || [],
    last_mode_used: session.conversation.last_mode_used,
    last_highlights: session.conversation.last_highlights || [],
  };
}

// ═══════════════════════════════════════════════════════════════
// MENTIONED PARAGRAPHS
// ═══════════════════════════════════════════════════════════════

/**
 * Afegeix paràgrafs mencionats a la sessió
 * @param {SessionState} session - Estat de sessió
 * @param {Array<number>} paraIds - IDs de paràgrafs
 * @returns {SessionState}
 */
function addMentionedParagraphs(session, paraIds) {
  if (!Array.isArray(paraIds) || paraIds.length === 0) {
    return session;
  }

  // Afegir nous paràgrafs (evitant duplicats)
  const existing = new Set(session.conversation.mentioned_paragraphs || []);
  for (const id of paraIds) {
    if (typeof id === 'number') {
      existing.add(id);
    }
  }

  // Convertir a array i limitar
  session.conversation.mentioned_paragraphs = Array.from(existing).slice(-MAX_MENTIONED_PARAGRAPHS);

  return session;
}

/**
 * Actualitza els últims highlights mostrats
 * @param {SessionState} session - Estat de sessió
 * @param {Array<number>} highlightParaIds - IDs de paràgrafs destacats
 * @returns {SessionState}
 */
function updateLastHighlights(session, highlightParaIds) {
  if (!Array.isArray(highlightParaIds)) {
    return session;
  }

  session.conversation.last_highlights = highlightParaIds.slice(0, 20);
  return session;
}

// ═══════════════════════════════════════════════════════════════
// PENDING INTENT
// ═══════════════════════════════════════════════════════════════

/**
 * Estableix un pending intent (esperant clarificació)
 * @param {SessionState} session - Estat de sessió
 * @param {Object} originalIntent - Intent original
 * @param {string} missingParam - Paràmetre que falta ('tone', 'target', 'action', etc.)
 * @param {Array<string>} options - Opcions ofertes a l'usuari
 * @returns {SessionState}
 */
function setPendingIntent(session, originalIntent, missingParam, options) {
  session.pending_intent = {
    state: 'waiting_clarification',
    original_intent: originalIntent,
    missing_param: missingParam,
    options_offered: options,
    created_at: Date.now(),
    expires_at: Date.now() + CACHE.pending_intent_ttl,
  };

  logInfo('Pending intent set', {
    mode: originalIntent.mode,
    missing_param: missingParam,
    options_count: options.length,
  });

  return session;
}

/**
 * Estableix un pending intent per confirmació (REWRITE preview)
 * @param {SessionState} session - Estat de sessió
 * @param {Object} originalIntent - Intent original
 * @param {Object} preview - Preview generat
 * @returns {SessionState}
 */
function setPendingConfirmation(session, originalIntent, preview) {
  session.pending_intent = {
    state: 'waiting_confirmation',
    original_intent: originalIntent,
    missing_param: 'confirmation',
    options_offered: ['Sí, aplica els canvis', 'No, cancel·la'],
    created_at: Date.now(),
    expires_at: Date.now() + CACHE.pending_intent_ttl,
  };

  // Guardar preview per si es confirma
  session.rewrite_preview = preview;

  logInfo('Pending confirmation set', {
    mode: originalIntent.mode,
    preview_changes: preview?.changes?.length,
  });

  return session;
}

/**
 * Neteja el pending intent
 * @param {SessionState} session - Estat de sessió
 * @returns {SessionState}
 */
function clearPendingIntent(session) {
  if (session.pending_intent) {
    logDebug('Pending intent cleared', {
      was_state: session.pending_intent.state,
    });
  }
  session.pending_intent = null;
  return session;
}

/**
 * Neteja el rewrite preview
 * @param {SessionState} session - Estat de sessió
 * @returns {SessionState}
 */
function clearRewritePreview(session) {
  session.rewrite_preview = null;
  return session;
}

/**
 * Comprova si hi ha un pending intent actiu (no expirat)
 * @param {SessionState} session - Estat de sessió
 * @returns {boolean}
 */
function hasPendingIntent(session) {
  if (!session || !session.pending_intent) {
    return false;
  }

  // Comprovar expiració
  if (session.pending_intent.expires_at && Date.now() > session.pending_intent.expires_at) {
    // Netejar si ha expirat
    clearPendingIntent(session);
    return false;
  }

  return true;
}

/**
 * Obté el rewrite preview guardat (per aplicar després de confirmació)
 * @param {SessionState} session - Estat de sessió
 * @returns {Object|null}
 */
function getRewritePreview(session) {
  return session?.rewrite_preview || null;
}

// ═══════════════════════════════════════════════════════════════
// CLARIFICATION GENERATOR
// ═══════════════════════════════════════════════════════════════

/**
 * Genera una clarificació per un intent ambigu
 * @param {Object} intent - Intent amb baixa confiança
 * @param {string} language - Idioma
 * @returns {Object} - { question, options, missingParam }
 */
function generateClarification(intent, language = 'ca') {
  const clarifications = {
    // Ambigu entre corregir errors i millorar
    ambiguous_correction: {
      ca: {
        question: "Què vols dir amb 'corregeix'?",
        options: [
          "Corregir errors ortogràfics i gramaticals",
          "Millorar el contingut i l'estil",
        ],
        missingParam: 'action',
      },
      es: {
        question: "¿Qué quieres decir con 'corrige'?",
        options: [
          "Corregir errores ortográficos y gramaticales",
          "Mejorar el contenido y el estilo",
        ],
        missingParam: 'action',
      },
      en: {
        question: "What do you mean by 'correct'?",
        options: [
          "Fix spelling and grammar errors",
          "Improve content and style",
        ],
        missingParam: 'action',
      },
    },

    // Ambigu sobre el target
    ambiguous_target: {
      ca: {
        question: "A quin paràgraf et refereixes?",
        options: [], // S'omplirà dinàmicament
        missingParam: 'target',
      },
      es: {
        question: "¿A qué párrafo te refieres?",
        options: [],
        missingParam: 'target',
      },
      en: {
        question: "Which paragraph are you referring to?",
        options: [],
        missingParam: 'target',
      },
    },

    // Ambigu sobre el to (per REWRITE)
    ambiguous_tone: {
      ca: {
        question: "Quin estil o to prefereixes?",
        options: [
          "Més formal i professional",
          "Més informal i proper",
          "Més tècnic i precís",
          "Més simple i clar",
        ],
        missingParam: 'tone',
      },
      es: {
        question: "¿Qué estilo o tono prefieres?",
        options: [
          "Más formal y profesional",
          "Más informal y cercano",
          "Más técnico y preciso",
          "Más simple y claro",
        ],
        missingParam: 'tone',
      },
      en: {
        question: "What style or tone do you prefer?",
        options: [
          "More formal and professional",
          "More informal and friendly",
          "More technical and precise",
          "Simpler and clearer",
        ],
        missingParam: 'tone',
      },
    },

    // Intent massa genèric
    too_generic: {
      ca: {
        question: "Pots ser més específic? Què vols que faci exactament?",
        options: [
          "Revisar errors i marcar-los",
          "Millorar el text",
          "Resumir el contingut",
          "Respondre una pregunta",
        ],
        missingParam: 'action',
      },
      es: {
        question: "¿Puedes ser más específico? ¿Qué quieres que haga exactamente?",
        options: [
          "Revisar errores y marcarlos",
          "Mejorar el texto",
          "Resumir el contenido",
          "Responder una pregunta",
        ],
        missingParam: 'action',
      },
      en: {
        question: "Can you be more specific? What exactly do you want me to do?",
        options: [
          "Review and highlight errors",
          "Improve the text",
          "Summarize the content",
          "Answer a question",
        ],
        missingParam: 'action',
      },
    },
  };

  // Determinar quin tipus de clarificació necessitem
  let clarificationType = 'too_generic';

  if (intent.mode === Mode.UPDATE_BY_ID) {
    if (!intent.target_paragraphs || intent.target_paragraphs.length === 0) {
      clarificationType = 'ambiguous_target';
    } else if (intent.reasoning?.includes('ambigu') ||
               intent.secondary_mode === Mode.REFERENCE_HIGHLIGHT) {
      clarificationType = 'ambiguous_correction';
    }
  } else if (intent.mode === Mode.REWRITE) {
    if (!intent.requested_tone && intent.reasoning?.includes('estil')) {
      clarificationType = 'ambiguous_tone';
    }
  }

  const clarification = clarifications[clarificationType][language] ||
                        clarifications[clarificationType].ca;

  return {
    question: clarification.question,
    options: clarification.options,
    missingParam: clarification.missingParam,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // Session management
  getSession,
  saveSession,
  deleteSession,
  cleanupExpiredSessions,

  // Conversation
  addConversationTurn,
  getLastTurns,
  getConversationContext,
  addMentionedParagraphs,
  updateLastHighlights,

  // Pending intent
  setPendingIntent,
  setPendingConfirmation,
  clearPendingIntent,
  clearRewritePreview,
  hasPendingIntent,
  getRewritePreview,

  // Clarification
  generateClarification,
};
