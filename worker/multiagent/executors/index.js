/**
 * Multi-Agent System Executors v8.3
 *
 * Punt d'entrada per a tots els executors del sistema.
 * Cada executor és responsable d'una categoria d'accions específica.
 */

export { executeChatOnly } from './chat.js';
export { executeReferenceHighlight } from './highlight.js';
export { executeUpdateById } from './update.js';
export { executeRewrite } from './rewrite.js';

// ═══════════════════════════════════════════════════════════════
// EXECUTOR REGISTRY
// ═══════════════════════════════════════════════════════════════

import { executeChatOnly } from './chat.js';
import { executeReferenceHighlight } from './highlight.js';
import { executeUpdateById } from './update.js';
import { executeRewrite } from './rewrite.js';
import { Mode } from '../types.js';

/**
 * Registre d'executors per mode
 * @type {Map<string, Function>}
 */
const executorRegistry = new Map([
  [Mode.CHAT_ONLY, executeChatOnly],
  [Mode.REFERENCE_HIGHLIGHT, executeReferenceHighlight],
  [Mode.UPDATE_BY_ID, executeUpdateById],
  [Mode.REWRITE, executeRewrite],
]);

/**
 * Obté l'executor per a un mode específic
 * @param {string} mode - Mode de l'intent
 * @returns {Function|null} - Funció executor o null
 */
function getExecutor(mode) {
  return executorRegistry.get(mode) || null;
}

/**
 * Executa l'intent amb l'executor apropiat
 *
 * @param {Object} intent - Intent classificat
 * @param {Object} documentContext - Context del document
 * @param {Object} conversationContext - Context de conversa
 * @param {Object} options - Opcions d'execució (apiKey, signal, etc.)
 * @returns {Promise<Object>} - Resultat de l'executor
 */
async function executeIntent(intent, documentContext, conversationContext, options = {}) {
  const executor = getExecutor(intent.mode);

  if (!executor) {
    // Fallback a CHAT_ONLY si no hi ha executor
    console.warn(`No executor found for mode: ${intent.mode}, falling back to CHAT_ONLY`);
    return executeChatOnly(intent, documentContext, conversationContext, options);
  }

  return executor(intent, documentContext, conversationContext, options);
}

export { getExecutor, executeIntent };
