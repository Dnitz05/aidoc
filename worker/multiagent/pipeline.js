/**
 * Multi-Agent System Pipeline v8.4
 *
 * Pipeline principal que orquestra tot el flux de processament:
 *
 * 1. Sanitització d'input
 * 2. Gate 0 (fast paths)
 * 3. Cache lookup
 * 4. Classificació IA
 * 5. Validació
 * 6. Routing
 * 7. Execució
 * 8. Post-processament
 *
 * Amb protecció de circuit breaker i timeouts.
 */

import { Mode, createErrorResult } from './types.js';
import { TIMEOUTS, FEATURE_FLAGS, USE_NEW_PIPELINE } from './config.js';
import { TelemetryCollector, logInfo, logWarn, logError, logDebug } from './telemetry.js';
import { sanitizeInput } from './sanitizer.js';
import { checkFastPaths } from './gate0.js';
import { getSession, saveSession, addConversationTurn, getConversationContext } from './session.js';
import { getCachedOrClassify, hashDocument } from './cache.js';
import { executeWithCircuitBreakerAndTimeout, getState as getCircuitBreakerState } from './circuitbreaker.js';
import { routeAndExecute, processConfirmation } from './router.js';
import { buildWindowedContext } from './context.js';
import { classifyInstruction } from './classifier.js';

// ═══════════════════════════════════════════════════════════════
// MAIN PIPELINE FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Processa una instrucció d'usuari a través del pipeline complet
 *
 * @param {Object} request - Petició d'entrada
 * @param {string} request.instruction - Instrucció de l'usuari
 * @param {Array<Object>} request.paragraphs - Paràgrafs del document
 * @param {Array<number>} request.selectedParagraphIds - IDs de paràgrafs seleccionats
 * @param {string} request.selectedText - Text seleccionat
 * @param {string} request.sessionId - ID de sessió
 * @param {string} request.documentId - ID del document (per cache)
 * @param {Object} env - Variables d'entorn (GEMINI_API_KEY, etc.)
 * @param {Object} [provider] - Provider d'IA (BYOK). Si no s'especifica, usa Gemini central.
 * @returns {Promise<Object>} - Resultat del processament
 */
async function processInstruction(request, env, provider = null) {
  const telemetry = new TelemetryCollector();
  const startTime = Date.now();

  // Extreure paràmetres
  const {
    instruction,
    paragraphs = [],
    selectedParagraphIds = [],
    selectedText = null,
    sessionId = null,
    documentId = null,
  } = request;

  // BYOK: Usar provider si s'ha proporcionat, sinó fallback a apiKey central
  const apiKey = env?.GEMINI_API_KEY;

  logInfo('Pipeline started', {
    instruction_length: instruction?.length,
    paragraphs_count: paragraphs.length,
    has_selection: selectedParagraphIds.length > 0,
    session_id: sessionId?.slice(0, 8),
    provider: provider?.name || 'gemini-central',
    model: provider?.model || 'default',
  });

  try {
    // ═══════════════════════════════════════════════════════════
    // FASE 1: SANITITZACIÓ
    // ═══════════════════════════════════════════════════════════
    telemetry.checkpoint('sanitize_start');

    const sanitizedInput = sanitizeInput(instruction);

    telemetry.checkpoint('sanitize_end');
    logDebug('Input sanitized', {
      language: sanitizedInput.language,
      has_refs: sanitizedInput.ref_hints?.length > 0,
    });

    // ═══════════════════════════════════════════════════════════
    // FASE 2: SESSION STATE (v8.4: async amb KV persistent)
    // ═══════════════════════════════════════════════════════════
    telemetry.checkpoint('session_start');

    const session = await getSession(sessionId, env);
    const conversationContext = getConversationContext(session);

    telemetry.checkpoint('session_end');

    // ═══════════════════════════════════════════════════════════
    // FASE 3: DOCUMENT CONTEXT
    // ═══════════════════════════════════════════════════════════
    telemetry.checkpoint('context_start');

    const documentContext = buildWindowedContext(paragraphs, {
      selectedParagraphs: selectedParagraphIds,
      cursorPosition: selectedParagraphIds[0] ?? null,
      recentlyMentioned: session.conversation?.mentioned_paragraphs || [],
      selectedText,
    });

    telemetry.checkpoint('context_end');
    logDebug('Document context built', {
      included: documentContext.includedParagraphs,
      total: documentContext.totalParagraphs,
    });

    // ═══════════════════════════════════════════════════════════
    // FASE 4: GATE 0 - FAST PATHS
    // ═══════════════════════════════════════════════════════════
    telemetry.checkpoint('gate0_start');

    const fastPathResult = checkFastPaths(sanitizedInput, documentContext, session);

    telemetry.checkpoint('gate0_end');

    if (fastPathResult.matched) {
      logInfo('Fast path matched', { type: fastPathResult.type });

      // Si és pending_resolved, continuar amb l'intent merged
      if (fastPathResult.type === 'pending_resolved' && fastPathResult.mergedIntent) {
        // v12.1: Propagar instrucció original al merged intent
        fastPathResult.mergedIntent.original_instruction = sanitizedInput.original;
        fastPathResult.mergedIntent.language = sanitizedInput.language;

        // Continuar al routing amb l'intent merged
        const result = await executeWithTimeout(
          async (signal) => routeAndExecute(
            fastPathResult.mergedIntent,
            documentContext,
            conversationContext,
            session,
            { apiKey, signal, sanitizedInput, provider }
          ),
          TIMEOUTS.executor
        );

        return await finalizeResult(result, session, sessionId, telemetry, sanitizedInput, env);
      }

      // Altres fast paths (greeting, help, etc.)
      if (fastPathResult.response) {
        return await finalizeResult(fastPathResult.response, session, sessionId, telemetry, sanitizedInput, env);
      }
    }

    // ═══════════════════════════════════════════════════════════
    // FASE 5: CLASSIFICACIÓ (AMB CACHE)
    // ═══════════════════════════════════════════════════════════
    telemetry.checkpoint('classify_start');

    // Calcular hash del document per cache
    const docHash = await hashDocument(paragraphs);

    // Executar amb circuit breaker i timeout
    const classifyResult = await executeWithCircuitBreakerAndTimeout(
      async (signal) => getCachedOrClassify(
        sanitizedInput.normalized,
        docHash,
        async () => classifyInstruction(sanitizedInput, documentContext, conversationContext, apiKey)
      ),
      TIMEOUTS.classifier,
      sanitizedInput.language
    );

    telemetry.checkpoint('classify_end');

    // Si s'ha activat el mode segur
    if (classifyResult.safeModeUsed) {
      logWarn('Circuit breaker activated, using safe mode');
      return await finalizeResult(classifyResult.result, session, sessionId, telemetry, sanitizedInput, env);
    }

    // Si hi ha hagut timeout
    if (classifyResult.timedOut) {
      logWarn('Classification timed out');
      return await finalizeResult(classifyResult.result, session, sessionId, telemetry, sanitizedInput, env);
    }

    // getCachedOrClassify retorna { intent, cacheHit, cacheLayer }
    const { intent, cacheHit, cacheLayer } = classifyResult.result;

    // v12.1: CRÍTIC - Propagar la instrucció original al intent per als executors
    intent.original_instruction = sanitizedInput.original;
    intent.language = sanitizedInput.language;

    logInfo('Intent classified', {
      mode: intent.mode,
      confidence: intent.confidence,
      from_cache: cacheHit,
      cache_layer: cacheLayer,
    });

    // ═══════════════════════════════════════════════════════════
    // FASE 6: ROUTING I EXECUCIÓ
    // ═══════════════════════════════════════════════════════════
    telemetry.checkpoint('execute_start');

    const executeResult = await executeWithCircuitBreakerAndTimeout(
      async (signal) => routeAndExecute(
        intent,
        documentContext,
        conversationContext,
        session,
        { apiKey, signal, sanitizedInput, provider }
      ),
      TIMEOUTS.executor,
      sanitizedInput.language
    );

    telemetry.checkpoint('execute_end');

    // Gestionar resultat
    if (executeResult.safeModeUsed) {
      return await finalizeResult(executeResult.result, session, sessionId, telemetry, sanitizedInput, env);
    }

    const result = executeResult.result;

    // ═══════════════════════════════════════════════════════════
    // FASE 7: FINALITZACIÓ
    // ═══════════════════════════════════════════════════════════
    return await finalizeResult(result, session, sessionId, telemetry, sanitizedInput, env);

  } catch (error) {
    logError('Pipeline error', {
      error: error.message,
      stack: error.stack?.slice(0, 500),
    });

    telemetry.checkpoint('error');

    // Resposta d'error
    const errorResponse = createErrorResponse(error, request.language || 'ca');
    return {
      ...errorResponse,
      _telemetry: telemetry.finalize(),
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Executa amb timeout
 */
async function executeWithTimeout(operation, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const result = await operation(controller.signal);
    clearTimeout(timeoutId);
    return result;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Finalitza el resultat afegint metadades
 * v8.4: async per suportar KV persistent
 */
async function finalizeResult(result, session, sessionId, telemetry, sanitizedInput, env) {
  // Actualitzar sessió amb el torn de conversa
  if (sessionId && session) {
    // Afegir torn d'usuari
    addConversationTurn(session, 'user', sanitizedInput.original || sanitizedInput.normalized);

    // Afegir torn d'assistent
    if (result.chat_response) {
      addConversationTurn(session, 'assistant', result.chat_response, result.mode);
    }

    // Guardar sessió (async a KV)
    await saveSession(sessionId, session, env);
  }

  // Afegir telemetria
  telemetry.checkpoint('finalize');
  const telemetrySummary = telemetry.finalize();

  logInfo('Pipeline completed', {
    mode: result.mode,
    total_time_ms: telemetrySummary.total_time_ms,
    has_highlights: !!result.highlights?.length,
    has_changes: !!result.changes?.length,
  });

  return {
    ...result,
    _telemetry: telemetrySummary,
  };
}

/**
 * Crea resposta d'error
 */
function createErrorResponse(error, language) {
  const messages = {
    ca: "Ho sento, s'ha produït un error inesperat. Torna a provar.",
    es: "Lo siento, se ha producido un error inesperado. Vuelve a intentarlo.",
    en: "Sorry, an unexpected error occurred. Please try again.",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: {
      error: true,
      error_message: error.message,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// SHADOW MODE
// ═══════════════════════════════════════════════════════════════

/**
 * Executa en mode shadow (nou pipeline en paral·lel sense afectar)
 *
 * @param {Object} request - Petició
 * @param {Object} env - Entorn
 * @param {Object} legacyResult - Resultat del sistema legacy
 * @returns {Promise<Object>} - Comparació
 */
async function runShadowMode(request, env, legacyResult) {
  if (!FEATURE_FLAGS.enable_shadow_mode) {
    return null;
  }

  try {
    const newResult = await processInstruction(request, env);

    // Comparar resultats
    const comparison = {
      legacy_mode: legacyResult?.mode,
      new_mode: newResult?.mode,
      modes_match: legacyResult?.mode === newResult?.mode,
      new_confidence: newResult?._telemetry?.classification_confidence,
      new_time_ms: newResult?._telemetry?.total_time_ms,
    };

    logInfo('Shadow mode comparison', comparison);

    return comparison;

  } catch (error) {
    logWarn('Shadow mode failed', { error: error.message });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE STATUS
// ═══════════════════════════════════════════════════════════════

/**
 * Obté l'estat del pipeline
 */
function getPipelineStatus() {
  const circuitBreaker = getCircuitBreakerState();

  return {
    version: '8.3.0',
    enabled: USE_NEW_PIPELINE,
    shadow_mode: FEATURE_FLAGS.enable_shadow_mode,
    circuit_breaker: circuitBreaker,
    feature_flags: FEATURE_FLAGS,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  processInstruction,
  runShadowMode,
  getPipelineStatus,
};
