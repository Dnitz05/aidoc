/**
 * Multi-Agent System Router v8.3
 *
 * Router intel·ligent que decideix com processar cada intent:
 * - Routing directe a executors (alta confiança)
 * - Sol·licitar clarificació (baixa confiança)
 * - Degradació a mode segur (errors)
 * - Gestió del flux de confirmació (REWRITE)
 */

import { Mode, RiskLevel } from './types.js';
import { CONFIDENCE_THRESHOLDS, FEATURE_FLAGS } from './config.js';
import { logInfo, logDebug, logWarn } from './telemetry.js';
import {
  hasPendingIntent,
  setPendingIntent,
  setPendingConfirmation,
  clearPendingIntent,
  clearRewritePreview,
  generateClarification,
  getRewritePreview,
} from './session.js';
import { executeIntent } from './executors/index.js';
import { validateIntent, applyFallbackCascade } from './validator.js';

// ═══════════════════════════════════════════════════════════════
// ROUTING DECISION
// ═══════════════════════════════════════════════════════════════

/**
 * Resultat de la decisió de routing
 * @typedef {Object} RoutingDecision
 * @property {string} action - 'execute', 'clarify', 'confirm', 'fallback'
 * @property {Object} intent - Intent (possiblement modificat)
 * @property {Object|null} clarification - Dades de clarificació si action='clarify'
 * @property {string} reason - Raó de la decisió
 */

/**
 * Decideix com enrutar un intent
 *
 * @param {Object} intent - Intent classificat
 * @param {Object} session - Estat de sessió
 * @param {Object} documentContext - Context del document
 * @returns {RoutingDecision}
 */
function decideRouting(intent, session, documentContext) {
  const mode = intent.mode;
  const confidence = intent.confidence || 0;
  const threshold = CONFIDENCE_THRESHOLDS[mode] || 0.70;

  logDebug('Router evaluating intent', {
    mode,
    confidence,
    threshold,
    has_pending: hasPendingIntent(session),
  });

  // 1. Si ve d'una clarificació, executar directament
  if (intent._meta?.from_clarification) {
    logInfo('Routing clarified intent directly to executor');
    return {
      action: 'execute',
      intent,
      clarification: null,
      reason: 'from_clarification',
    };
  }

  // 2. Si és CHAT_ONLY, sempre executar (baix risc)
  if (mode === Mode.CHAT_ONLY) {
    return {
      action: 'execute',
      intent,
      clarification: null,
      reason: 'chat_only_always_execute',
    };
  }

  // 3. Si la confiança és massa baixa, demanar clarificació
  if (confidence < threshold) {
    logInfo('Low confidence, requesting clarification', {
      confidence,
      threshold,
      gap: threshold - confidence,
    });

    const clarification = generateClarification(intent, intent.language);

    return {
      action: 'clarify',
      intent,
      clarification,
      reason: 'low_confidence',
    };
  }

  // 4. Per REWRITE amb alt risc, demanar confirmació
  if (mode === Mode.REWRITE && shouldRequireConfirmation(intent, documentContext)) {
    logInfo('High-risk REWRITE, will generate preview for confirmation');
    return {
      action: 'execute_with_confirmation',
      intent,
      clarification: null,
      reason: 'rewrite_requires_confirmation',
    };
  }

  // 5. Per UPDATE_BY_ID, verificar que tenim targets
  if (mode === Mode.UPDATE_BY_ID) {
    if (!intent.target_paragraphs || intent.target_paragraphs.length === 0) {
      // Si no hi ha targets però hi ha selecció, usar-la
      if (documentContext?.selectedParagraphIds?.length > 0) {
        intent.target_paragraphs = documentContext.selectedParagraphIds;
        logDebug('Using selection as target paragraphs', {
          targets: intent.target_paragraphs,
        });
      } else {
        // Demanar clarificació sobre el target
        return {
          action: 'clarify',
          intent,
          clarification: {
            question: getNoTargetQuestion(intent.language),
            options: buildParagraphOptions(documentContext, intent.language),
            missingParam: 'target',
          },
          reason: 'missing_target',
        };
      }
    }
  }

  // 6. Executar normalment
  return {
    action: 'execute',
    intent,
    clarification: null,
    reason: 'confidence_ok',
  };
}

// ═══════════════════════════════════════════════════════════════
// ROUTING HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Determina si REWRITE requereix confirmació
 */
function shouldRequireConfirmation(intent, documentContext) {
  // Sempre confirmació si és tot el document
  if (intent.scope === 'document') return true;

  // Confirmació si afecta molts paràgrafs
  const targetCount = intent.target_paragraphs?.length || 0;
  const totalCount = documentContext?.paragraphs?.length || 1;

  if (targetCount === 0) {
    // Si no hi ha targets, assumir document complet
    return true;
  }

  const ratio = targetCount / totalCount;
  if (ratio > 0.5) return true;  // Més de la meitat del document

  // Confirmació si el risc és alt
  if (intent.risk_level === RiskLevel.HIGH) return true;

  return false;
}

/**
 * Obté la pregunta per quan falta target
 */
function getNoTargetQuestion(language) {
  const questions = {
    ca: "Quin paràgraf vols modificar?",
    es: "¿Qué párrafo quieres modificar?",
    en: "Which paragraph do you want to modify?",
  };
  return questions[language] || questions.ca;
}

/**
 * Construeix opcions de paràgrafs per clarificació
 */
function buildParagraphOptions(documentContext, language) {
  if (!documentContext?.paragraphs?.length) {
    return [];
  }

  // Mostrar primers paràgrafs com a opcions
  const maxOptions = 4;
  const paragraphs = documentContext.paragraphs.slice(0, maxOptions);

  return paragraphs.map((para, i) => {
    const text = (para.text || para).slice(0, 50);
    return `§${i}: ${text}${text.length >= 50 ? '...' : ''}`;
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN ROUTER FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Enruta i executa un intent
 *
 * @param {Object} intent - Intent classificat i validat
 * @param {Object} documentContext - Context del document
 * @param {Object} conversationContext - Context de conversa
 * @param {Object} session - Estat de sessió
 * @param {Object} options - Opcions (apiKey, signal, etc.)
 * @returns {Promise<Object>} - Resultat de l'execució
 */
async function routeAndExecute(intent, documentContext, conversationContext, session, options = {}) {
  const language = intent.language || 'ca';

  // Validar intent
  const validationResult = validateIntent(intent, documentContext, options.sanitizedInput);

  // Aplicar fallback si cal
  const validatedIntent = applyFallbackCascade(validationResult, intent, language);

  // Decidir routing
  const decision = decideRouting(validatedIntent, session, documentContext);

  logInfo('Router decision', {
    action: decision.action,
    reason: decision.reason,
    mode: validatedIntent.mode,
  });

  // Executar segons la decisió
  switch (decision.action) {
    case 'execute':
      return await executeIntent(
        decision.intent,
        documentContext,
        conversationContext,
        options
      );

    case 'execute_with_confirmation':
      // Executar per obtenir preview
      const previewResult = await executeIntent(
        decision.intent,
        documentContext,
        conversationContext,
        options
      );

      // Si cal confirmació, guardar pending
      if (previewResult.needs_confirmation) {
        setPendingConfirmation(session, decision.intent, previewResult.preview);
      }

      return previewResult;

    case 'clarify':
      // Guardar pending intent i retornar clarificació
      setPendingIntent(
        session,
        decision.intent,
        decision.clarification.missingParam,
        decision.clarification.options
      );

      return {
        mode: Mode.CHAT_ONLY,
        chat_response: formatClarificationMessage(decision.clarification, language),
        needs_clarification: true,
        _meta: {
          clarification_type: decision.clarification.missingParam,
          options_count: decision.clarification.options.length,
        },
      };

    case 'fallback':
      // Fallback a mode segur
      return createFallbackResponse(decision.reason, language);

    default:
      logWarn('Unknown routing action', { action: decision.action });
      return await executeIntent(
        validatedIntent,
        documentContext,
        conversationContext,
        options
      );
  }
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE FORMATTING
// ═══════════════════════════════════════════════════════════════

/**
 * Formata el missatge de clarificació
 */
function formatClarificationMessage(clarification, language) {
  const { question, options } = clarification;

  const optionsList = options
    .map((opt, i) => `${i + 1}. ${opt}`)
    .join('\n');

  return `${question}\n\n${optionsList}`;
}

/**
 * Crea una resposta de fallback
 */
function createFallbackResponse(reason, language) {
  const messages = {
    ca: "No he pogut processar la teva petició. Pots reformular-la?",
    es: "No he podido procesar tu petición. ¿Puedes reformularla?",
    en: "I couldn't process your request. Can you rephrase it?",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: {
      fallback: true,
      reason,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// CONFIRMATION HANDLING
// ═══════════════════════════════════════════════════════════════

/**
 * Processa una confirmació d'usuari per REWRITE
 *
 * @param {Object} session - Estat de sessió
 * @param {boolean} confirmed - Si l'usuari ha confirmat
 * @param {Object} documentContext - Context del document
 * @param {Object} options - Opcions d'execució
 * @returns {Promise<Object>}
 */
async function processConfirmation(session, confirmed, documentContext, options = {}) {
  const language = session.pending_intent?.original_intent?.language || 'ca';

  if (!confirmed) {
    // Usuari ha cancel·lat
    clearPendingIntent(session);
    clearRewritePreview(session);

    const messages = {
      ca: "D'acord, he cancel·lat els canvis.",
      es: "De acuerdo, he cancelado los cambios.",
      en: "OK, I've cancelled the changes.",
    };

    return {
      mode: Mode.CHAT_ONLY,
      chat_response: messages[language] || messages.ca,
      _meta: { cancelled: true },
    };
  }

  // Usuari ha confirmat
  const preview = getRewritePreview(session);
  const originalIntent = session.pending_intent?.original_intent;

  if (!preview || !originalIntent) {
    clearPendingIntent(session);

    const messages = {
      ca: "Ho sento, el preview ha expirat. Torna a fer la petició.",
      es: "Lo siento, la vista previa ha expirado. Vuelve a hacer la petición.",
      en: "Sorry, the preview has expired. Please make the request again.",
    };

    return {
      mode: Mode.CHAT_ONLY,
      chat_response: messages[language] || messages.ca,
      _meta: { expired: true },
    };
  }

  // Marcar com confirmat i executar
  const confirmedIntent = {
    ...originalIntent,
    user_confirmed: true,
    _cached_preview: preview,
  };

  // Netejar pending
  clearPendingIntent(session);
  clearRewritePreview(session);

  // Executar
  const { executeRewrite } = await import('./executors/rewrite.js');
  return await executeRewrite(confirmedIntent, documentContext, {}, options);
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  decideRouting,
  routeAndExecute,
  processConfirmation,
  shouldRequireConfirmation,
};
