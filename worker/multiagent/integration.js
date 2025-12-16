/**
 * Multi-Agent System Integration Layer v8.3
 *
 * Pont d'integració entre el worker.js existent i el nou pipeline multi-agent.
 * Proporciona:
 * - Conversió de formats (legacy ↔ nou)
 * - Feature flag per activar/desactivar
 * - Shadow mode per comparar resultats
 * - Backward compatibility total
 */

import { processInstruction, runShadowMode, getPipelineStatus } from './pipeline.js';
import { Mode } from './types.js';
import { USE_NEW_PIPELINE, FEATURE_FLAGS } from './config.js';
import { logInfo, logWarn, logDebug } from './telemetry.js';
import { createProviderFromAuth, getProvidersInfo, validateApiKey, PROVIDERS } from './providers/index.js';

// ═══════════════════════════════════════════════════════════════
// REQUEST CONVERSION (Legacy → New Format)
// ═══════════════════════════════════════════════════════════════

/**
 * Converteix el format de petició del worker.js al format del nou pipeline
 *
 * @param {Object} legacyBody - Body de la petició original
 * @returns {Object} - Request en format del nou pipeline
 */
function convertLegacyRequest(legacyBody) {
  const {
    text,
    user_instruction,
    doc_metadata,
    has_selection,
    chat_history,
    last_edit,
    user_mode,
    doc_skeleton,
    doc_stats,
  } = legacyBody;

  // Parsejar paràgrafs del text marcat
  const paragraphs = parseParagraphsFromText(text);

  // Extreure paràgrafs seleccionats
  const selectedParagraphIds = extractSelectedParagraphIds(text, has_selection);

  // Extreure text seleccionat
  const selectedText = extractSelectedText(text);

  // Construir historial de conversa
  const conversationHistory = convertChatHistory(chat_history);

  return {
    instruction: user_instruction || '',
    paragraphs,
    selectedParagraphIds,
    selectedText,
    sessionId: doc_metadata?.doc_id || null,
    documentId: doc_metadata?.doc_id || null,
    // Metadata addicional
    _legacy: {
      has_selection,
      user_mode,
      last_edit,
      doc_skeleton,
      doc_stats,
    },
    _conversation: conversationHistory,
  };
}

/**
 * Parseja els paràgrafs del text marcat amb {{N}}
 */
function parseParagraphsFromText(text) {
  if (!text) return [];

  const paragraphs = [];
  // Patró per trobar {{N}} text {{N+1}} o {{N}} text [FI]
  const regex = /\{\{(\d+)\}\}\s*([\s\S]*?)(?=\{\{(?:\d+|T:\d+|TOC:\d+)\}\}|\[CAPÇALERA|\[PEU|$)/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    const id = parseInt(match[1], 10);
    const content = match[2].trim();

    paragraphs.push({
      id,
      text: content,
    });
  }

  // Ordenar per ID
  paragraphs.sort((a, b) => a.id - b.id);

  return paragraphs;
}

/**
 * Extreu els IDs de paràgrafs seleccionats
 */
function extractSelectedParagraphIds(text, hasSelection) {
  if (!hasSelection || !text) return [];

  // Buscar paràgrafs marcats amb [SELECCIÓ] o similars
  const selectedIds = [];

  // Patró 1: Buscar {{N}} seguit de [SELECCIÓ]
  const selectionPattern = /\{\{(\d+)\}\}[^{]*\[SELECCIÓ\]/gi;
  let match;
  while ((match = selectionPattern.exec(text)) !== null) {
    selectedIds.push(parseInt(match[1], 10));
  }

  // Patró 2: Si no hi ha marca explícita però has_selection és true,
  // assumir que tot el document està seleccionat (cas legacy)
  if (selectedIds.length === 0 && hasSelection) {
    // Retornar el primer paràgraf com a seleccionat (heurística)
    const firstPara = text.match(/\{\{(\d+)\}\}/);
    if (firstPara) {
      selectedIds.push(parseInt(firstPara[1], 10));
    }
  }

  return selectedIds;
}

/**
 * Extreu el text seleccionat
 */
function extractSelectedText(text) {
  if (!text) return null;

  // Buscar marcadors de selecció
  const selectionMatch = text.match(/\[SELECCIÓ:?\s*"?([^"\]]+)"?\]/i);
  if (selectionMatch) {
    return selectionMatch[1].trim();
  }

  return null;
}

/**
 * Converteix l'historial de xat al format del nou pipeline
 */
function convertChatHistory(chatHistory) {
  if (!chatHistory || !Array.isArray(chatHistory)) return [];

  return chatHistory.map(msg => ({
    role: msg.role === 'model' ? 'assistant' : msg.role,
    content: msg.text || msg.content || '',
    timestamp: msg.timestamp || Date.now(),
  }));
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE CONVERSION (New → Legacy Format)
// ═══════════════════════════════════════════════════════════════

/**
 * Converteix la resposta del nou pipeline al format legacy
 *
 * @param {Object} newResponse - Resposta del nou pipeline
 * @returns {Object} - Resposta en format legacy
 */
function convertToLegacyResponse(newResponse) {
  const mode = newResponse.mode;

  // Base de la resposta legacy
  const legacyResponse = {
    mode: convertModeToLegacy(mode),
    thought: newResponse._meta?.reasoning || newResponse.reasoning || '',
  };

  // Conversió segons el mode
  switch (mode) {
    case Mode.CHAT_ONLY:
      legacyResponse.chat_response = newResponse.chat_response || '';
      legacyResponse.change_summary = 'Resposta de xat';
      break;

    case Mode.REFERENCE_HIGHLIGHT:
      legacyResponse.ai_response = newResponse.chat_response || '';
      legacyResponse.highlights = convertHighlightsToLegacy(newResponse.highlights);
      break;

    case Mode.UPDATE_BY_ID:
      legacyResponse.updates = convertChangesToUpdates(newResponse.changes);
      legacyResponse.change_summary = buildChangeSummary(newResponse.changes, 'ca');
      // v14.1: Passar també l'array changes complet per processChangesV14 a Code.gs
      legacyResponse.changes = newResponse.changes;
      legacyResponse.modification_type = newResponse.modification_type || newResponse._meta?.modification_type;
      // v14.2: Passar highlights per ressaltar els fragments a modificar al document
      if (newResponse.highlights && newResponse.highlights.length > 0) {
        legacyResponse.highlights = convertHighlightsToLegacy(newResponse.highlights);
      }
      break;

    case Mode.REWRITE:
      if (newResponse.needs_confirmation) {
        // Preview pendent de confirmació
        legacyResponse.mode = 'CHAT_ONLY';  // Temporalment xat per mostrar preview
        legacyResponse.chat_response = newResponse.chat_response || '';
        legacyResponse._preview = newResponse.preview;
      } else if (newResponse.applied) {
        legacyResponse.blocks = convertChangesToBlocks(newResponse.changes);
        legacyResponse.change_summary = 'Document reescrit';
      }
      break;

    default:
      legacyResponse.chat_response = newResponse.chat_response || 'Operació completada.';
      legacyResponse.change_summary = 'Operació processada';
  }

  return legacyResponse;
}

/**
 * Converteix el mode al format legacy
 */
function convertModeToLegacy(mode) {
  // Els modes són iguals, però per si de cas
  const modeMap = {
    [Mode.CHAT_ONLY]: 'CHAT_ONLY',
    [Mode.REFERENCE_HIGHLIGHT]: 'REFERENCE_HIGHLIGHT',
    [Mode.UPDATE_BY_ID]: 'UPDATE_BY_ID',
    [Mode.REWRITE]: 'REWRITE',
  };
  return modeMap[mode] || mode;
}

/**
 * Converteix highlights al format legacy
 * Suporta tant el format antic com el nou format de l'executor v8.3
 */
function convertHighlightsToLegacy(highlights) {
  if (!highlights || !Array.isArray(highlights)) return [];

  return highlights.map(h => ({
    // para_id: acceptar ambdós formats
    para_id: h.para_id ?? h.paragraph_id,
    // color: usar directament si ja és string, sinó convertir des de severity
    color: (typeof h.color === 'string' && !h.color.startsWith('#'))
      ? h.color
      : severityToColor(h.severity),
    // reason: acceptar múltiples camps
    reason: h.reason || h.comment || '',
    // snippet: acceptar matched_text o text_to_highlight
    snippet: h.matched_text || h.text_to_highlight || '',
    // start/end: acceptar formats nous i antics
    start: h.start ?? h.start_offset,
    end: h.end ?? h.end_offset,
  }));
}

/**
 * Mapeja severity a color
 */
function severityToColor(severity) {
  const colorMap = {
    error: 'orange',
    suggestion: 'blue',
    info: 'yellow',
  };
  return colorMap[severity] || 'yellow';
}

/**
 * Converteix changes a updates (format legacy)
 * v14.1: Afegit fallback a 'replacement' per compatibilitat amb format v14
 */
function convertChangesToUpdates(changes) {
  if (!changes || !Array.isArray(changes)) return {};

  const updates = {};
  for (const change of changes) {
    if (change.paragraph_id !== undefined) {
      // v14.1: Prioritat: new_text > replacement > proposedText
      const newText = change.new_text || change.replacement || change.proposedText;
      if (newText) {
        updates[change.paragraph_id] = newText;
      }
    }
  }
  return updates;
}

/**
 * Converteix changes a blocks (format REWRITE legacy)
 */
function convertChangesToBlocks(changes) {
  if (!changes || !Array.isArray(changes)) return [];

  return changes.map(change => ({
    paragraph_ids: change.paragraph_ids || [change.paragraph_id],
    new_text: change.new_text,
    is_replacement: change.is_replacement || true,
  }));
}

/**
 * Construeix un resum dels canvis
 */
function buildChangeSummary(changes, language) {
  if (!changes || changes.length === 0) return 'Cap canvi';

  const count = changes.length;
  const summaries = {
    ca: `${count} paràgraf${count !== 1 ? 's' : ''} modificat${count !== 1 ? 's' : ''}`,
    es: `${count} párrafo${count !== 1 ? 's' : ''} modificado${count !== 1 ? 's' : ''}`,
    en: `${count} paragraph${count !== 1 ? 's' : ''} modified`,
  };
  return summaries[language] || summaries.ca;
}

// ═══════════════════════════════════════════════════════════════
// MAIN INTEGRATION FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Processa una petició utilitzant el nou pipeline si està activat
 *
 * @param {Object} legacyBody - Body de la petició original
 * @param {Object} env - Variables d'entorn
 * @param {Object} options - Opcions addicionals
 * @returns {Promise<Object>} - Resposta en format legacy
 */
async function processWithNewPipeline(legacyBody, env, options = {}) {
  // Comprovar si el nou pipeline està activat
  if (!USE_NEW_PIPELINE && !options.forcePipeline) {
    return null;  // Indicar que cal usar el pipeline legacy
  }

  // Crear provider segons auth del body
  let provider;
  try {
    provider = createProviderFromAuth(legacyBody.auth, env);
  } catch (authError) {
    logWarn('Failed to create provider from auth, using Gemini fallback', {
      error: authError.message,
    });
    // Fallback a Gemini si no hi ha auth vàlid
    if (env.GEMINI_API_KEY) {
      const { createProvider } = await import('./providers/index.js');
      provider = createProvider(PROVIDERS.GEMINI, env.GEMINI_API_KEY);
    } else {
      return null; // No hi ha provider disponible
    }
  }

  logInfo('Using new multi-agent pipeline', {
    instruction_length: legacyBody.user_instruction?.length,
    provider: provider?.name,
    model: provider?.model,
  });

  try {
    // Convertir request
    const newRequest = convertLegacyRequest(legacyBody);

    // Executar pipeline amb provider
    const newResponse = await processInstruction(newRequest, env, provider);

    // Convertir resposta
    const legacyResponse = convertToLegacyResponse(newResponse);

    // Afegir metadades del nou pipeline
    legacyResponse._multiagent = {
      version: '8.4.0',  // Versió amb BYOK
      pipeline: 'new',
      provider: provider?.name,
      model: provider?.model,
      telemetry: newResponse._telemetry,
    };

    logDebug('New pipeline completed', {
      mode: legacyResponse.mode,
      elapsed_ms: newResponse._telemetry?.total_time_ms,
    });

    return legacyResponse;

  } catch (error) {
    logWarn('New pipeline failed, caller should fallback to legacy', {
      error: error.message,
    });
    return null;  // Indicar fallback a legacy
  }
}

// ═══════════════════════════════════════════════════════════════
// SHADOW MODE
// ═══════════════════════════════════════════════════════════════

/**
 * Executa shadow mode: corre el nou pipeline en paral·lel i compara
 *
 * @param {Object} legacyBody - Body de la petició
 * @param {Object} env - Variables d'entorn
 * @param {Object} legacyResult - Resultat del pipeline legacy
 * @returns {Promise<Object>} - Comparació de resultats
 */
async function executeShadowMode(legacyBody, env, legacyResult) {
  if (!FEATURE_FLAGS.enable_shadow_mode) {
    return null;
  }

  logInfo('Executing shadow mode comparison');

  try {
    const newRequest = convertLegacyRequest(legacyBody);
    const comparison = await runShadowMode(newRequest, env, legacyResult);

    // Analitzar discrepàncies
    if (comparison && !comparison.modes_match) {
      logWarn('Shadow mode: Mode mismatch detected', {
        legacy_mode: comparison.legacy_mode,
        new_mode: comparison.new_mode,
        instruction: legacyBody.user_instruction?.substring(0, 100),
      });
    }

    return comparison;

  } catch (error) {
    logWarn('Shadow mode failed', { error: error.message });
    return null;
  }
}

/**
 * Wrapper per integrar amb handleChat existent
 *
 * Ús:
 * ```
 * // Al principi de handleChat:
 * const newPipelineResult = await tryNewPipeline(body, env);
 * if (newPipelineResult) {
 *   return formatResponse(newPipelineResult, corsHeaders);
 * }
 * // ... continuar amb pipeline legacy
 * ```
 */
async function tryNewPipeline(legacyBody, env) {
  // Si el pipeline nou està activat, usar-lo
  if (USE_NEW_PIPELINE) {
    return processWithNewPipeline(legacyBody, env);
  }

  // Si shadow mode està activat, executar en background
  if (FEATURE_FLAGS.enable_shadow_mode) {
    // No esperem el resultat, només log
    executeShadowMode(legacyBody, env, null)
      .then(comparison => {
        if (comparison) {
          console.log('[Shadow Mode]', JSON.stringify(comparison));
        }
      })
      .catch(() => { /* Ignorar errors en shadow mode */ });
  }

  return null;  // Usar pipeline legacy
}

// ═══════════════════════════════════════════════════════════════
// HYBRID MODE (Gradual Rollout)
// ═══════════════════════════════════════════════════════════════

/**
 * Decideix si usar el nou pipeline basat en criteris
 *
 * @param {Object} legacyBody - Body de la petició
 * @returns {boolean}
 */
function shouldUseNewPipeline(legacyBody) {
  // Si està desactivat globalment, no
  if (!FEATURE_FLAGS.enable_new_pipeline_gradual) {
    return false;
  }

  // Criteris per activar gradualment:

  // 1. Només per instruccions de xat (menys risc)
  const instruction = (legacyBody.user_instruction || '').toLowerCase();
  const isChatLikely = /^(qu[eéè]|com|per\s*qu[eéè]|explica|digue|what|how|why)/.test(instruction);

  if (isChatLikely) {
    return true;
  }

  // 2. Només si no hi ha selecció (menys risc d'edició)
  if (!legacyBody.has_selection) {
    return Math.random() < 0.1;  // 10% de peticions sense selecció
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // Main integration
  processWithNewPipeline,
  tryNewPipeline,

  // Shadow mode
  executeShadowMode,

  // Conversions
  convertLegacyRequest,
  convertToLegacyResponse,

  // Utilities
  parseParagraphsFromText,
  shouldUseNewPipeline,

  // Status
  getPipelineStatus,
};
