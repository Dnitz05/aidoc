/**
 * Multi-Agent System Executors v14.0
 *
 * v14.0: Sistema Unificat - Un sol executor per a tot
 *
 * L'executor unificat genera:
 * - response: SEMPRE present (text pel chat)
 * - highlights: OPCIONAL (si cal senyalar)
 * - changes: OPCIONAL (si cal modificar)
 *
 * Punt d'entrada per a tots els executors del sistema.
 */

// v14.0: Export principal - executor unificat
export { executeUnified } from './unified.js';

// Legacy exports (per compatibilitat durant migració)
export { executeChatOnly } from './chat.js';
export { executeReferenceHighlight } from './highlight.js';
export { executeUpdateById } from './update.js';
export { executeRewrite } from './rewrite.js';

// ═══════════════════════════════════════════════════════════════
// UNIFIED EXECUTOR (v14.0)
// ═══════════════════════════════════════════════════════════════

import { executeUnified } from './unified.js';
import { logInfo, logWarn } from '../telemetry.js';

// Legacy imports (per fallback si cal)
import { executeChatOnly } from './chat.js';
import { executeReferenceHighlight } from './highlight.js';
import { executeUpdateById } from './update.js';
import { executeRewrite } from './rewrite.js';
import { Mode } from '../types.js';

/**
 * Feature flag per activar/desactivar el sistema unificat
 * TRUE = tot passa per executeUnified
 * FALSE = sistema antic amb routing per mode
 */
const USE_UNIFIED_EXECUTOR = false;

/**
 * Registre d'executors per mode (legacy, per fallback)
 * @type {Map<string, Function>}
 */
const executorRegistry = new Map([
  [Mode.CHAT_ONLY, executeChatOnly],
  [Mode.REFERENCE_HIGHLIGHT, executeReferenceHighlight],
  [Mode.UPDATE_BY_ID, executeUpdateById],
  [Mode.REWRITE, executeRewrite],
]);

/**
 * Obté l'executor per a un mode específic (legacy)
 * @param {string} mode - Mode de l'intent
 * @returns {Function|null} - Funció executor o null
 */
function getExecutor(mode) {
  return executorRegistry.get(mode) || null;
}

/**
 * Executa l'intent amb l'executor apropiat
 *
 * v14.0: Sempre usa executeUnified (un sol format de sortida)
 *
 * @param {Object} intent - Intent classificat
 * @param {Object} documentContext - Context del document
 * @param {Object} conversationContext - Context de conversa
 * @param {Object} options - Opcions d'execució (apiKey, signal, etc.)
 * @returns {Promise<Object>} - Resultat de l'executor
 */
async function executeIntent(intent, documentContext, conversationContext, options = {}) {
  // v14.0: Sistema Unificat
  if (USE_UNIFIED_EXECUTOR) {
    logInfo('Using UNIFIED executor v14', {
      intent_mode: intent?.mode,
      instruction_preview: intent?.original_instruction?.slice(0, 50),
    });

    const result = await executeUnified(intent, documentContext, conversationContext, options);

    // v14.0: Convertir format unificat al format esperat pel pipeline
    // Passar documentContext per poder convertir changes → updates
    return convertUnifiedToLegacyFormat(result, intent, documentContext);
  }

  // Legacy: Routing per mode
  const executor = getExecutor(intent.mode);

  if (!executor) {
    console.warn(`No executor found for mode: ${intent.mode}, falling back to CHAT_ONLY`);
    return executeChatOnly(intent, documentContext, conversationContext, options);
  }

  return executor(intent, documentContext, conversationContext, options);
}

/**
 * Converteix el format unificat al format legacy esperat pel pipeline/frontend
 *
 * Unificat:
 * { response, highlights?, changes?, _meta }
 *
 * Legacy:
 * { mode, chat_response?, ai_response?, updates?, highlights?, _meta }
 *
 * @param {Object} unifiedResult - Resultat de l'executor unificat
 * @param {Object} intent - Intent original (per mode)
 * @param {Object} documentContext - Context del document (per convertir changes → updates)
 * @returns {Object} - Resultat en format legacy
 */
function convertUnifiedToLegacyFormat(unifiedResult, intent, documentContext = null) {
  const { response, highlights, changes, _meta } = unifiedResult;

  // Determinar el mode segons el contingut de la resposta
  let mode = Mode.CHAT_ONLY;
  if (changes && changes.length > 0) {
    mode = Mode.UPDATE_BY_ID;
  } else if (highlights && highlights.length > 0) {
    mode = Mode.REFERENCE_HIGHLIGHT;
  }

  // Construir resposta legacy
  const legacyResult = {
    mode,
    chat_response: response,
    _meta: {
      ..._meta,
      unified_v14: true,
      original_intent_mode: intent?.mode,
    },
  };

  // Afegir highlights si n'hi ha
  if (highlights && highlights.length > 0) {
    legacyResult.highlights = highlights;
    // El frontend espera ai_response per REFERENCE_HIGHLIGHT
    legacyResult.ai_response = response;
  }

  // Convertir changes → updates (format que espera Code.gs)
  if (changes && changes.length > 0) {
    logInfo('Converting changes to updates', {
      changes_count: changes.length,
      has_paragraphs: !!documentContext?.paragraphs,
      paragraphs_count: documentContext?.paragraphs?.length,
      changes_preview: JSON.stringify(changes.slice(0, 2)),
    });

    if (documentContext?.paragraphs) {
      const updates = convertChangesToUpdates(changes, documentContext.paragraphs);
      const updatesCount = Object.keys(updates).length;

      logInfo('Changes converted', {
        changes_input: changes.length,
        updates_output: updatesCount,
        updates_keys: Object.keys(updates),
      });

      if (updatesCount > 0) {
        legacyResult.updates = updates;
        legacyResult.change_summary = response;
        legacyResult.ai_response = response;
      } else {
        logWarn('No updates generated from changes', {
          changes: JSON.stringify(changes),
        });
      }
    } else {
      logWarn('Cannot convert changes: missing paragraphs', {
        documentContext_keys: documentContext ? Object.keys(documentContext) : null,
      });
    }
  }

  return legacyResult;
}

/**
 * Converteix array de changes a objecte updates (format Code.gs)
 *
 * Input: [{ para_id: 4, original: "te", replacement: "té" }]
 * Output: { "4": "text complet del paràgraf amb correccions aplicades" }
 */
function convertChangesToUpdates(changes, paragraphs) {
  const updates = {};

  // Agrupar canvis per para_id
  const changesByPara = {};
  for (const change of changes) {
    const id = change.para_id;
    if (!changesByPara[id]) {
      changesByPara[id] = [];
    }
    changesByPara[id].push(change);
  }

  // Per cada paràgraf amb canvis, aplicar tots els reemplaçaments
  for (const [paraId, paraChanges] of Object.entries(changesByPara)) {
    const idx = parseInt(paraId, 10);
    if (idx < 0 || idx >= paragraphs.length) continue;

    // Obtenir text original del paràgraf
    let text = paragraphs[idx]?.text || paragraphs[idx];
    if (typeof text !== 'string') continue;

    // Aplicar cada canvi
    for (const change of paraChanges) {
      if (change.original && change.replacement) {
        // Reemplaçar totes les ocurrències
        text = text.split(change.original).join(change.replacement);
      }
    }

    // Guardar amb ID (0-indexed, com espera Code.gs)
    updates[paraId] = text;
  }

  return updates;
}

export { getExecutor, executeIntent, convertUnifiedToLegacyFormat };
