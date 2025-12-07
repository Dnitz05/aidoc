/**
 * Multi-Agent System v8.3
 *
 * Punt d'entrada principal del sistema multi-agent de classificació d'intents.
 * Exporta tots els mòduls necessaris per integrar amb el worker principal.
 */

// ═══════════════════════════════════════════════════════════════
// CORE EXPORTS
// ═══════════════════════════════════════════════════════════════

// Configuration
export * from './config.js';

// Types
export * from './types.js';

// Telemetry
export * from './telemetry.js';

// ═══════════════════════════════════════════════════════════════
// PIPELINE COMPONENTS
// ═══════════════════════════════════════════════════════════════

// Sanitizer
export * from './sanitizer.js';

// Classifier
export * from './classifier.js';

// Gate 0 (Fast Paths)
export * from './gate0.js';

// Session State
export * from './session.js';

// Cache
export * from './cache.js';

// Context Windowing
export * from './context.js';

// Validator
export * from './validator.js';

// Circuit Breaker
export * from './circuitbreaker.js';

// Router
export * from './router.js';

// ═══════════════════════════════════════════════════════════════
// EXECUTORS
// ═══════════════════════════════════════════════════════════════

export * from './executors/index.js';

// ═══════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════

export { processInstruction, runShadowMode, getPipelineStatus } from './pipeline.js';

// ═══════════════════════════════════════════════════════════════
// INTEGRATION LAYER (for worker.js)
// ═══════════════════════════════════════════════════════════════

export {
  processWithNewPipeline,
  tryNewPipeline,
  executeShadowMode,
  convertLegacyRequest,
  convertToLegacyResponse,
  parseParagraphsFromText,
  shouldUseNewPipeline,
} from './integration.js';

// ═══════════════════════════════════════════════════════════════
// VERSION INFO
// ═══════════════════════════════════════════════════════════════

/**
 * Versió del sistema multi-agent
 */
export const MULTIAGENT_VERSION = '8.3.0';

/**
 * Descripció de les fases implementades
 */
export const IMPLEMENTATION_STATUS = {
  phase_0: 'completed',  // Preparació: config, types, telemetry, dataset
  phase_1: 'completed',  // Core: sanitizer, classifier
  phase_2: 'completed',  // Cache + Fast Paths + Session
  phase_3: 'completed',  // Validator, Context, Executors
  phase_4: 'completed',  // Router, Pipeline, Circuit Breaker
  phase_5: 'completed',  // Integration layer + shadow mode
  phase_6: 'ready',      // Rollout - ready for activation via feature flags
};

/**
 * Mòduls disponibles
 */
export const AVAILABLE_MODULES = [
  'config',
  'types',
  'telemetry',
  'sanitizer',
  'classifier',
  'gate0',
  'session',
  'cache',
  'context',
  'validator',
  'circuitbreaker',
  'router',
  'executors',
  'pipeline',
  'integration',
];
