/**
 * Multi-Agent System Circuit Breaker v8.3
 *
 * Patró Circuit Breaker per protegir el sistema d'errors en cascada.
 * Quan es detecten múltiples errors consecutius, el sistema entra en
 * "mode segur" (només CHAT_ONLY) fins que es recupera.
 *
 * Estats:
 * - CLOSED: Funcionament normal
 * - OPEN: Errors detectats, sistema en mode segur
 * - HALF_OPEN: Provant recuperació
 */

import { CircuitBreakerState, Mode } from './types.js';
import { CIRCUIT_BREAKER } from './config.js';
import { logInfo, logWarn, logError } from './telemetry.js';

// ═══════════════════════════════════════════════════════════════
// CIRCUIT BREAKER STATE
// ═══════════════════════════════════════════════════════════════

/**
 * Estat global del circuit breaker
 * En producció, això podria ser persistent (KV, Durable Objects)
 */
const state = {
  status: CircuitBreakerState.CLOSED,
  failure_count: 0,
  success_count: 0,
  last_failure_time: null,
  last_success_time: null,
  last_failure_reason: null,
  half_open_calls: 0,
};

// ═══════════════════════════════════════════════════════════════
// CIRCUIT BREAKER OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Obté l'estat actual del circuit breaker
 * @returns {Object}
 */
function getState() {
  return {
    status: state.status,
    failure_count: state.failure_count,
    last_failure_time: state.last_failure_time,
    last_failure_reason: state.last_failure_reason,
  };
}

/**
 * Comprova si el circuit permet executar operacions
 * @returns {boolean}
 */
function isAllowed() {
  // Si està CLOSED, sempre permetre
  if (state.status === CircuitBreakerState.CLOSED) {
    return true;
  }

  // Si està OPEN, comprovar si hem de passar a HALF_OPEN
  if (state.status === CircuitBreakerState.OPEN) {
    const timeSinceFailure = Date.now() - (state.last_failure_time || 0);

    if (timeSinceFailure >= CIRCUIT_BREAKER.recovery_timeout) {
      // Passar a HALF_OPEN
      state.status = CircuitBreakerState.HALF_OPEN;
      state.half_open_calls = 0;
      logInfo('Circuit breaker entering HALF_OPEN state');
      return true;
    }

    // Encara en OPEN, no permetre
    return false;
  }

  // Si està HALF_OPEN, permetre un nombre limitat de crides
  if (state.status === CircuitBreakerState.HALF_OPEN) {
    if (state.half_open_calls < CIRCUIT_BREAKER.half_open_max_calls) {
      state.half_open_calls++;
      return true;
    }
    return false;
  }

  return true;
}

/**
 * Registra un èxit
 */
function recordSuccess() {
  state.success_count++;
  state.last_success_time = Date.now();

  // Si estem en HALF_OPEN i hem tingut èxit, tornar a CLOSED
  if (state.status === CircuitBreakerState.HALF_OPEN) {
    state.status = CircuitBreakerState.CLOSED;
    state.failure_count = 0;
    state.half_open_calls = 0;
    logInfo('Circuit breaker recovered, entering CLOSED state');
  }

  // Si estem en CLOSED, reduir el comptador de fallades (decay)
  if (state.status === CircuitBreakerState.CLOSED && state.failure_count > 0) {
    state.failure_count = Math.max(0, state.failure_count - 1);
  }
}

/**
 * Registra una fallada
 * @param {string} reason - Motiu de la fallada
 */
function recordFailure(reason) {
  state.failure_count++;
  state.last_failure_time = Date.now();
  state.last_failure_reason = reason;

  logWarn('Circuit breaker failure recorded', {
    count: state.failure_count,
    reason,
    current_state: state.status,
  });

  // Si estem en HALF_OPEN i falla, tornar a OPEN
  if (state.status === CircuitBreakerState.HALF_OPEN) {
    state.status = CircuitBreakerState.OPEN;
    state.half_open_calls = 0;
    logError('Circuit breaker returning to OPEN state after HALF_OPEN failure');
    return;
  }

  // Si hem arribat al threshold, obrir el circuit
  if (state.failure_count >= CIRCUIT_BREAKER.failure_threshold) {
    state.status = CircuitBreakerState.OPEN;
    logError('Circuit breaker OPEN', {
      failures: state.failure_count,
      threshold: CIRCUIT_BREAKER.failure_threshold,
      reason,
    });
  }
}

/**
 * Reinicia el circuit breaker (per testing o recuperació manual)
 */
function reset() {
  state.status = CircuitBreakerState.CLOSED;
  state.failure_count = 0;
  state.success_count = 0;
  state.last_failure_time = null;
  state.last_failure_reason = null;
  state.half_open_calls = 0;
  logInfo('Circuit breaker manually reset');
}

// ═══════════════════════════════════════════════════════════════
// SAFE MODE RESPONSE
// ═══════════════════════════════════════════════════════════════

/**
 * Genera una resposta de mode segur
 * @param {string} language - Idioma de l'usuari
 * @returns {Object}
 */
function getSafeModeResponse(language = 'ca') {
  const messages = {
    ca: `⚠️ **Mode segur activat**

El sistema d'edició està temporalment desactivat per protegir el teu document. Només puc respondre preguntes en aquest moment.

Si us plau, torna a provar d'aquí a uns minuts.`,

    es: `⚠️ **Modo seguro activado**

El sistema de edición está temporalmente desactivado para proteger tu documento. Solo puedo responder preguntas en este momento.

Por favor, vuelve a intentarlo en unos minutos.`,

    en: `⚠️ **Safe mode activated**

The editing system is temporarily disabled to protect your document. I can only answer questions at this moment.

Please try again in a few minutes.`,
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: {
      safe_mode: true,
      circuit_breaker_state: state.status,
      failure_count: state.failure_count,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// EXECUTE WITH CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════════

/**
 * Executa una operació amb protecció del circuit breaker
 *
 * @param {Function} operation - Funció async a executar
 * @param {string} language - Idioma per la resposta de mode segur
 * @returns {Promise<{result: any, safeModeUsed: boolean}>}
 */
async function executeWithCircuitBreaker(operation, language = 'ca') {
  // Comprovar si podem executar
  if (!isAllowed()) {
    logWarn('Circuit breaker blocking operation (OPEN state)');
    return {
      result: getSafeModeResponse(language),
      safeModeUsed: true,
    };
  }

  try {
    // Executar l'operació
    const result = await operation();

    // Registrar èxit
    recordSuccess();

    return {
      result,
      safeModeUsed: false,
    };

  } catch (error) {
    // Registrar fallada
    recordFailure(error.message || 'Unknown error');

    // Si el circuit s'ha obert, retornar mode segur
    if (state.status === CircuitBreakerState.OPEN) {
      return {
        result: getSafeModeResponse(language),
        safeModeUsed: true,
      };
    }

    // Si no, propagar l'error
    throw error;
  }
}

/**
 * Wrapper per executar amb circuit breaker i timeout
 *
 * @param {Function} operation - Funció async a executar
 * @param {number} timeout - Timeout en ms
 * @param {string} language - Idioma
 * @returns {Promise<{result: any, safeModeUsed: boolean, timedOut: boolean}>}
 */
async function executeWithCircuitBreakerAndTimeout(operation, timeout, language = 'ca') {
  // Comprovar circuit breaker primer
  if (!isAllowed()) {
    return {
      result: getSafeModeResponse(language),
      safeModeUsed: true,
      timedOut: false,
    };
  }

  // Crear abort controller per timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Executar amb timeout
    const result = await Promise.race([
      operation(controller.signal),
      new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new Error('Operation timed out'));
        });
      }),
    ]);

    clearTimeout(timeoutId);
    recordSuccess();

    return {
      result,
      safeModeUsed: false,
      timedOut: false,
    };

  } catch (error) {
    clearTimeout(timeoutId);

    const isTimeout = error.message === 'Operation timed out' ||
                      error.name === 'AbortError';

    recordFailure(isTimeout ? 'Timeout' : error.message);

    // Si el circuit s'ha obert, retornar mode segur
    if (state.status === CircuitBreakerState.OPEN) {
      return {
        result: getSafeModeResponse(language),
        safeModeUsed: true,
        timedOut: isTimeout,
      };
    }

    // Si no, propagar l'error amb info de timeout
    if (isTimeout) {
      const timeoutMessages = {
        ca: "⏱️ La petició ha trigat massa. El document pot ser massa complex. Prova de fer la petició paràgraf a paràgraf.",
        es: "⏱️ La petición ha tardado demasiado. El documento puede ser muy complejo. Prueba a hacer la petición párrafo a párrafo.",
        en: "⏱️ The request took too long. The document may be too complex. Try making the request paragraph by paragraph.",
      };

      return {
        result: {
          mode: Mode.CHAT_ONLY,
          chat_response: timeoutMessages[language] || timeoutMessages.ca,
          _meta: { timed_out: true },
        },
        safeModeUsed: false,
        timedOut: true,
      };
    }

    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // State
  getState,
  isAllowed,
  recordSuccess,
  recordFailure,
  reset,

  // Safe mode
  getSafeModeResponse,

  // Execute
  executeWithCircuitBreaker,
  executeWithCircuitBreakerAndTimeout,
};
