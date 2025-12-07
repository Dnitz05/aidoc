/**
 * Multi-Agent System Telemetry v8.3
 *
 * Sistema de logging i telemetria pel pipeline multi-agent.
 * Dissenyat per ser async i no bloquejant.
 */

import { createRequestLog, CircuitBreakerState } from './types.js';

// ═══════════════════════════════════════════════════════════════
// TELEMETRY COLLECTOR
// ═══════════════════════════════════════════════════════════════

/**
 * Classe que gestiona la col·lecció de telemetria durant una request.
 * Acumula dades i les envia al final de la request.
 */
class TelemetryCollector {
  constructor(request_id) {
    this.log = createRequestLog(request_id || crypto.randomUUID());
    this.startTime = Date.now();
    this.checkpoints = [];
  }

  /**
   * Afegeix un checkpoint amb timestamp
   * @param {string} name - Nom del checkpoint
   * @param {Object} [data] - Dades addicionals
   */
  checkpoint(name, data = {}) {
    this.checkpoints.push({
      name,
      elapsed_ms: Date.now() - this.startTime,
      ...data,
    });
  }

  /**
   * Actualitza les dades de l'input
   * @param {Object} sanitizedInput
   * @param {Object} documentContext
   * @param {boolean} hasConversation
   */
  setInput(sanitizedInput, documentContext, hasConversation) {
    this.log.instruction_length = sanitizedInput.original?.length || 0;
    this.log.instruction_language = sanitizedInput.language || 'ca';
    this.log.doc_paragraph_count = documentContext?.paragraphs?.length || 0;
    this.log.doc_hash = documentContext?.hash || '';
    this.log.has_conversation_context = hasConversation;
    this.checkpoint('input_processed');
  }

  /**
   * Registra un fast path hit
   * @param {string} type - Tipus de fast path ('greeting', 'help', etc.)
   */
  setFastPathHit(type) {
    this.log.fast_path_matched = true;
    this.log.fast_path_type = type;
    this.checkpoint('fast_path_hit', { type });
  }

  /**
   * Registra un cache hit
   * @param {string} layer - Layer del cache ('L1' o 'L2')
   */
  setCacheHit(layer) {
    this.log.cache_hit = true;
    this.log.cache_layer = layer;
    this.checkpoint('cache_hit', { layer });
  }

  /**
   * Registra la classificació
   * @param {string} model - Model utilitzat
   * @param {number} latency_ms - Latència en ms
   * @param {Object} intent - IntentPayload
   */
  setClassification(model, latency_ms, intent) {
    this.log.classifier_model = model;
    this.log.classifier_latency_ms = latency_ms;
    this.log.classified_mode = intent?.mode || '';
    this.log.classified_confidence = intent?.confidence || 0;
    this.checkpoint('classification_done', { mode: intent?.mode, confidence: intent?.confidence });
  }

  /**
   * Registra el routing
   * @param {boolean} confidenceSufficient
   * @param {boolean} clarificationRequested
   */
  setRouting(confidenceSufficient, clarificationRequested) {
    this.log.confidence_sufficient = confidenceSufficient;
    this.log.clarification_requested = clarificationRequested;
    this.checkpoint('routing_done');
  }

  /**
   * Registra l'execució
   * @param {string} executor - Nom de l'executor
   * @param {number} latency_ms - Latència en ms
   * @param {number} context_tokens - Tokens de context enviats
   */
  setExecution(executor, latency_ms, context_tokens) {
    this.log.executor_used = executor;
    this.log.executor_latency_ms = latency_ms;
    this.log.context_tokens_sent = context_tokens;
    this.checkpoint('execution_done', { executor, latency_ms });
  }

  /**
   * Registra la validació
   * @param {boolean} passed
   * @param {Array<string>} errors
   */
  setValidation(passed, errors = []) {
    this.log.validation_passed = passed;
    this.log.validation_errors = errors;
    this.checkpoint('validation_done', { passed, error_count: errors.length });
  }

  /**
   * Registra el resultat final
   * @param {string} mode
   * @param {number|null} highlights_count
   * @param {number|null} paragraphs_modified
   * @param {boolean} fallback_triggered
   */
  setResult(mode, highlights_count, paragraphs_modified, fallback_triggered) {
    this.log.final_mode = mode;
    this.log.highlights_count = highlights_count;
    this.log.paragraphs_modified = paragraphs_modified;
    this.log.fallback_triggered = fallback_triggered;
    this.checkpoint('result_set');
  }

  /**
   * Registra l'estat del circuit breaker
   * @param {string} state
   * @param {number} consecutiveErrors
   */
  setCircuitBreakerState(state, consecutiveErrors) {
    this.log.circuit_breaker_state = state;
    this.log.consecutive_errors = consecutiveErrors;
  }

  /**
   * Registra feedback de l'usuari
   * @param {boolean|null} confirmed
   * @param {boolean|null} rejected
   * @param {boolean|null} retry
   */
  setUserFeedback(confirmed, rejected, retry) {
    this.log.user_confirmed = confirmed;
    this.log.user_rejected = rejected;
    this.log.user_retry = retry;
  }

  /**
   * Finalitza i retorna el log complet
   * @returns {Object}
   */
  finalize() {
    this.checkpoint('finalized');
    return {
      ...this.log,
      total_latency_ms: Date.now() - this.startTime,
      checkpoints: this.checkpoints,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// LOGGING FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Nivells de log
 */
const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

/**
 * Log estructurat que es pot parsejar
 * @param {string} level - Nivell de log
 * @param {string} message - Missatge
 * @param {Object} [data] - Dades addicionals
 */
function structuredLog(level, message, data = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  // En producció, això podria enviar-se a un servei extern
  // Per ara, usem console.log amb format estructurat
  const logString = JSON.stringify(logEntry);

  switch (level) {
    case LogLevel.ERROR:
      console.error(`[MULTIAGENT] ${logString}`);
      break;
    case LogLevel.WARN:
      console.warn(`[MULTIAGENT] ${logString}`);
      break;
    case LogLevel.DEBUG:
      // En producció, podríem filtrar els debug
      console.log(`[MULTIAGENT] ${logString}`);
      break;
    default:
      console.log(`[MULTIAGENT] ${logString}`);
  }

  return logEntry;
}

/**
 * Log d'informació
 */
function logInfo(message, data) {
  return structuredLog(LogLevel.INFO, message, data);
}

/**
 * Log de warning
 */
function logWarn(message, data) {
  return structuredLog(LogLevel.WARN, message, data);
}

/**
 * Log d'error
 */
function logError(message, data) {
  return structuredLog(LogLevel.ERROR, message, data);
}

/**
 * Log de debug
 */
function logDebug(message, data) {
  return structuredLog(LogLevel.DEBUG, message, data);
}

// ═══════════════════════════════════════════════════════════════
// METRICS & ALERTS
// ═══════════════════════════════════════════════════════════════

/**
 * Comptadors de mètriques (in-memory, es reinicien amb el worker)
 */
const metrics = {
  total_requests: 0,
  requests_by_mode: {},
  cache_hits_l1: 0,
  cache_hits_l2: 0,
  cache_misses: 0,
  fast_path_hits: 0,
  classifier_calls: 0,
  errors: 0,
  fallbacks: 0,
  latency_sum: 0,
  latency_count: 0,
};

/**
 * Actualitza les mètriques amb un log complet
 * @param {Object} finalizedLog
 */
function updateMetrics(finalizedLog) {
  metrics.total_requests++;

  // Mode
  const mode = finalizedLog.final_mode || 'unknown';
  metrics.requests_by_mode[mode] = (metrics.requests_by_mode[mode] || 0) + 1;

  // Cache
  if (finalizedLog.cache_hit) {
    if (finalizedLog.cache_layer === 'L1') {
      metrics.cache_hits_l1++;
    } else {
      metrics.cache_hits_l2++;
    }
  } else if (!finalizedLog.fast_path_matched) {
    metrics.cache_misses++;
  }

  // Fast path
  if (finalizedLog.fast_path_matched) {
    metrics.fast_path_hits++;
  }

  // Classifier
  if (finalizedLog.classifier_model) {
    metrics.classifier_calls++;
  }

  // Errors
  if (!finalizedLog.validation_passed || finalizedLog.validation_errors?.length > 0) {
    metrics.errors++;
  }

  // Fallbacks
  if (finalizedLog.fallback_triggered) {
    metrics.fallbacks++;
  }

  // Latència
  if (finalizedLog.total_latency_ms) {
    metrics.latency_sum += finalizedLog.total_latency_ms;
    metrics.latency_count++;
  }
}

/**
 * Obté les mètriques actuals
 * @returns {Object}
 */
function getMetrics() {
  const avgLatency = metrics.latency_count > 0
    ? Math.round(metrics.latency_sum / metrics.latency_count)
    : 0;

  const cacheHitRate = metrics.total_requests > 0
    ? ((metrics.cache_hits_l1 + metrics.cache_hits_l2) / metrics.total_requests * 100).toFixed(1)
    : 0;

  const errorRate = metrics.total_requests > 0
    ? (metrics.errors / metrics.total_requests * 100).toFixed(2)
    : 0;

  return {
    ...metrics,
    avg_latency_ms: avgLatency,
    cache_hit_rate_percent: parseFloat(cacheHitRate),
    error_rate_percent: parseFloat(errorRate),
  };
}

/**
 * Comprova si cal disparar alertes
 * @param {Object} finalizedLog
 * @returns {Array<Object>} - Alertes disparades
 */
function checkAlerts(finalizedLog) {
  const alerts = [];
  const currentMetrics = getMetrics();

  // Alerta: Error rate > 3%
  if (currentMetrics.error_rate_percent > 3) {
    alerts.push({
      type: 'HIGH_ERROR_RATE',
      severity: 'critical',
      message: `Error rate is ${currentMetrics.error_rate_percent}% (threshold: 3%)`,
      value: currentMetrics.error_rate_percent,
    });
  }

  // Alerta: Latència molt alta
  if (finalizedLog.total_latency_ms > 4000) {
    alerts.push({
      type: 'HIGH_LATENCY',
      severity: 'warning',
      message: `Request latency ${finalizedLog.total_latency_ms}ms exceeds 4000ms`,
      value: finalizedLog.total_latency_ms,
    });
  }

  // Alerta: Circuit breaker obert
  if (finalizedLog.circuit_breaker_state === CircuitBreakerState.OPEN) {
    alerts.push({
      type: 'CIRCUIT_BREAKER_OPEN',
      severity: 'critical',
      message: 'Circuit breaker is OPEN - system in safe mode',
      value: finalizedLog.consecutive_errors,
    });
  }

  // Alerta: Cache hit rate baix
  if (currentMetrics.total_requests > 100 && currentMetrics.cache_hit_rate_percent < 25) {
    alerts.push({
      type: 'LOW_CACHE_HIT_RATE',
      severity: 'warning',
      message: `Cache hit rate is ${currentMetrics.cache_hit_rate_percent}% (threshold: 25%)`,
      value: currentMetrics.cache_hit_rate_percent,
    });
  }

  // Log alertes
  for (const alert of alerts) {
    logWarn(`ALERT: ${alert.type}`, alert);
  }

  return alerts;
}

// ═══════════════════════════════════════════════════════════════
// TELEMETRY SENDER (Async, non-blocking)
// ═══════════════════════════════════════════════════════════════

/**
 * Envia la telemetria de forma async.
 * En producció, això podria enviar a un servei extern.
 * @param {Object} finalizedLog
 */
async function sendTelemetry(finalizedLog) {
  try {
    // Actualitzar mètriques locals
    updateMetrics(finalizedLog);

    // Comprovar alertes
    const alerts = checkAlerts(finalizedLog);

    // Log principal
    logInfo('Request completed', {
      request_id: finalizedLog.request_id,
      mode: finalizedLog.final_mode,
      latency_ms: finalizedLog.total_latency_ms,
      cache_hit: finalizedLog.cache_hit,
      cache_layer: finalizedLog.cache_layer,
      alerts_count: alerts.length,
    });

    // En producció, aquí es podria enviar a un servei extern
    // com Cloudflare Analytics, Datadog, etc.
    // await sendToExternalService(finalizedLog);

  } catch (error) {
    // La telemetria no ha de fallar la request principal
    console.error('[MULTIAGENT] Telemetry send error:', error.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // Classes
  TelemetryCollector,

  // Logging
  LogLevel,
  logInfo,
  logWarn,
  logError,
  logDebug,
  structuredLog,

  // Metrics
  getMetrics,
  updateMetrics,
  checkAlerts,

  // Sender
  sendTelemetry,
};
