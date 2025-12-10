/**
 * Multi-Agent System Gate 0 - Fast Paths v8.3
 *
 * Primera línia de processament que intercepta casos trivials
 * sense necessitat de cridar el classifier IA.
 *
 * Inclou:
 * - Salutacions
 * - Peticions d'ajuda
 * - Agraïments
 * - Document buit
 * - Respostes a pending_intent (clarificacions)
 */

import { Mode, createDefaultIntent } from './types.js';
import { FAST_PATH_PATTERNS } from './config.js';
import { logInfo, logDebug } from './telemetry.js';

// ═══════════════════════════════════════════════════════════════
// FAST PATH TYPES
// ═══════════════════════════════════════════════════════════════

/**
 * Resultat d'un fast path
 * @typedef {Object} FastPathResult
 * @property {boolean} matched - Si ha fet match amb algun fast path
 * @property {string|null} type - Tipus de fast path ('greeting', 'help', etc.)
 * @property {Object|null} response - Resposta directa si matched
 * @property {Object|null} mergedIntent - Intent merged si era pending_intent response
 */

// ═══════════════════════════════════════════════════════════════
// FAST PATH CHECKERS
// ═══════════════════════════════════════════════════════════════

/**
 * Comprova si la instrucció és una salutació
 * @param {string} normalized - Instrucció normalitzada
 * @param {string} language - Idioma detectat
 * @returns {FastPathResult}
 */
function checkGreeting(normalized, language) {
  const patterns = FAST_PATH_PATTERNS.greetings.patterns;

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      const response = FAST_PATH_PATTERNS.greetings.response[language] ||
                       FAST_PATH_PATTERNS.greetings.response.ca;
      return {
        matched: true,
        type: 'greeting',
        response: {
          mode: Mode.CHAT_ONLY,
          chat_response: response,
          _meta: { fast_path: 'greeting' },
        },
        mergedIntent: null,
      };
    }
  }

  return { matched: false, type: null, response: null, mergedIntent: null };
}

/**
 * Comprova si la instrucció és una petició d'ajuda
 * @param {string} normalized - Instrucció normalitzada
 * @param {string} language - Idioma detectat
 * @returns {FastPathResult}
 */
function checkHelp(normalized, language) {
  const patterns = FAST_PATH_PATTERNS.help.patterns;

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      const response = FAST_PATH_PATTERNS.help.response[language] ||
                       FAST_PATH_PATTERNS.help.response.ca;
      return {
        matched: true,
        type: 'help',
        response: {
          mode: Mode.CHAT_ONLY,
          chat_response: response,
          _meta: { fast_path: 'help' },
        },
        mergedIntent: null,
      };
    }
  }

  return { matched: false, type: null, response: null, mergedIntent: null };
}

/**
 * Comprova si la instrucció és un agraïment
 * @param {string} normalized - Instrucció normalitzada
 * @param {string} language - Idioma detectat
 * @returns {FastPathResult}
 */
function checkThanks(normalized, language) {
  const patterns = FAST_PATH_PATTERNS.thanks.patterns;

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      const response = FAST_PATH_PATTERNS.thanks.response[language] ||
                       FAST_PATH_PATTERNS.thanks.response.ca;
      return {
        matched: true,
        type: 'thanks',
        response: {
          mode: Mode.CHAT_ONLY,
          chat_response: response,
          _meta: { fast_path: 'thanks' },
        },
        mergedIntent: null,
      };
    }
  }

  return { matched: false, type: null, response: null, mergedIntent: null };
}

/**
 * Comprova si la instrucció és un comiat
 * @param {string} normalized - Instrucció normalitzada
 * @param {string} language - Idioma detectat
 * @returns {FastPathResult}
 */
function checkFarewell(normalized, language) {
  const patterns = FAST_PATH_PATTERNS.farewell.patterns;

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      const response = FAST_PATH_PATTERNS.farewell.response[language] ||
                       FAST_PATH_PATTERNS.farewell.response.ca;
      return {
        matched: true,
        type: 'farewell',
        response: {
          mode: Mode.CHAT_ONLY,
          chat_response: response,
          _meta: { fast_path: 'farewell' },
        },
        mergedIntent: null,
      };
    }
  }

  return { matched: false, type: null, response: null, mergedIntent: null };
}

/**
 * v13.1: Fast path per peticions de revisió d'errors/faltes
 * Va directament a REFERENCE_HIGHLIGHT sense passar pel classifier
 * @param {string} normalized - Instrucció normalitzada
 * @param {string} language - Idioma detectat
 * @param {string} original - Instrucció original
 * @returns {FastPathResult}
 */
function checkErrorsRequest(normalized, language, original) {
  // Patrons que indiquen petició de revisió d'errors
  const patterns = [
    /\b(hi ha|tens?|troba|busca|detecta)\s*(faltes?|errors?)\b/i,
    /\b(faltes?|errors?)\s*(ortogr[aà]fi[cq]u?e?s?|gramaticals?)?\s*(al|del|en el)?\s*document\b/i,
    /\b(revisa|corregeix|comprova)\s*(les?\s*)?(faltes?|errors?|ortografia)\b/i,
    /\brevisió\s*(ortogr[aà]fica|d.?errors?)\b/i,
    /\b(errors?|faltes?)\s*\?/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(normalized)) {
      logInfo('Fast path matched: errors_request', { pattern: pattern.toString() });

      // Retornar mergedIntent per executar REFERENCE_HIGHLIGHT directament
      return {
        matched: true,
        type: 'errors_request',
        response: null,  // No resposta directa, anem a l'executor
        mergedIntent: {
          mode: Mode.REFERENCE_HIGHLIGHT,
          confidence: 0.95,
          strategy: 'errors',
          scope: 'document',
          target_paragraphs: [],  // Tot el document
          original_instruction: original,
          language: language,
          _meta: {
            fast_path: 'errors_request',
            from_clarification: true,  // Per saltar validacions
          },
        },
      };
    }
  }

  return { matched: false, type: null, response: null, mergedIntent: null };
}

/**
 * Comprova si el document està buit
 * @param {Object} documentContext - Context del document
 * @param {string} language - Idioma detectat
 * @returns {FastPathResult}
 */
function checkEmptyDocument(documentContext, language) {
  if (!documentContext ||
      !documentContext.paragraphs ||
      documentContext.paragraphs.length === 0) {

    const messages = {
      ca: "No tinc cap document carregat. Si us plau, obre un document i torna a provar.",
      es: "No tengo ningún documento cargado. Por favor, abre un documento e inténtalo de nuevo.",
      en: "I don't have any document loaded. Please open a document and try again.",
    };

    return {
      matched: true,
      type: 'empty_document',
      response: {
        mode: Mode.CHAT_ONLY,
        chat_response: messages[language] || messages.ca,
        _meta: { fast_path: 'empty_document' },
      },
      mergedIntent: null,
    };
  }

  return { matched: false, type: null, response: null, mergedIntent: null };
}

// ═══════════════════════════════════════════════════════════════
// PENDING INTENT HANDLER
// ═══════════════════════════════════════════════════════════════

/**
 * Comprova si la instrucció és una resposta a un pending_intent
 * @param {string} normalized - Instrucció normalitzada
 * @param {Object} sessionState - Estat de sessió amb pending_intent
 * @returns {FastPathResult}
 */
function checkPendingIntent(normalized, sessionState) {
  if (!sessionState || !sessionState.pending_intent) {
    return { matched: false, type: null, response: null, mergedIntent: null };
  }

  const pending = sessionState.pending_intent;

  // Comprovar si ha expirat
  if (pending.expires_at && Date.now() > pending.expires_at) {
    logDebug('Pending intent expired', { original_mode: pending.original_intent?.mode });
    return { matched: false, type: null, response: null, mergedIntent: null };
  }

  // Comprovar si la resposta coincideix amb una de les opcions ofertes
  const options = pending.options_offered || [];
  const normalizedOptions = options.map(o => o.toLowerCase().trim());

  // Buscar coincidència exacta o parcial
  let matchedOption = null;
  let matchedIndex = -1;

  for (let i = 0; i < normalizedOptions.length; i++) {
    const option = normalizedOptions[i];

    // Coincidència exacta
    if (normalized === option) {
      matchedOption = options[i];
      matchedIndex = i;
      break;
    }

    // Coincidència parcial (l'usuari només escriu part de l'opció)
    if (option.includes(normalized) || normalized.includes(option)) {
      matchedOption = options[i];
      matchedIndex = i;
      break;
    }

    // Coincidència per número ("1", "2", etc.)
    if (normalized === String(i + 1)) {
      matchedOption = options[i];
      matchedIndex = i;
      break;
    }
  }

  // També acceptar "sí"/"si"/"yes" per confirmar
  if (!matchedOption && pending.state === 'waiting_confirmation') {
    if (/^(s[íi]|yes|ok|d'acord|vale|confirma?)$/i.test(normalized)) {
      matchedOption = 'confirmed';
      matchedIndex = 0;
    }
  }

  // Acceptar "no" per cancel·lar
  if (!matchedOption) {
    if (/^(no|cancel·?la|cancela?r?)$/i.test(normalized)) {
      logInfo('Pending intent cancelled by user');
      return {
        matched: true,
        type: 'pending_cancelled',
        response: {
          mode: Mode.CHAT_ONLY,
          chat_response: "D'acord, cancel·lat. Què més puc fer per tu?",
          _meta: { fast_path: 'pending_cancelled' },
        },
        mergedIntent: null,
      };
    }
  }

  if (matchedOption) {
    logInfo('Pending intent matched', {
      option: matchedOption,
      original_mode: pending.original_intent?.mode,
      missing_param: pending.missing_param,
    });

    // Merge l'opció seleccionada amb l'intent original
    const mergedIntent = mergePendingIntent(pending, matchedOption, matchedIndex);

    return {
      matched: true,
      type: 'pending_resolved',
      response: null,  // No hi ha resposta directa, cal executar l'intent
      mergedIntent,
    };
  }

  return { matched: false, type: null, response: null, mergedIntent: null };
}

/**
 * Fusiona l'opció seleccionada amb l'intent original
 */
function mergePendingIntent(pending, selectedOption, optionIndex) {
  const originalIntent = { ...pending.original_intent };

  // Segons el paràmetre que faltava, omplir-lo
  switch (pending.missing_param) {
    case 'tone':
      // Per REWRITE amb to
      originalIntent.requested_tone = selectedOption;
      break;

    case 'target':
      // Per UPDATE_BY_ID sense target clar
      if (typeof optionIndex === 'number') {
        originalIntent.target_paragraphs = [optionIndex];
      }
      break;

    case 'action':
      // Acció ambigua (corregir errors vs millorar)
      if (selectedOption.toLowerCase().includes('error') ||
          selectedOption.toLowerCase().includes('ortog') ||
          selectedOption.toLowerCase().includes('correg')) {
        originalIntent.modification_type = 'fix';
        originalIntent.highlight_strategy = 'errors';
      } else {
        originalIntent.modification_type = 'improve';
      }
      break;

    case 'confirmation':
      // Confirmació per REWRITE
      originalIntent.user_confirmed = true;
      break;

    default:
      // Guardar l'opció genèricament
      originalIntent.clarification_response = selectedOption;
  }

  // Augmentar la confiança ja que l'usuari ha clarificat
  originalIntent.confidence = Math.min(0.95, (originalIntent.confidence || 0.5) + 0.2);

  // Marcar que ve d'una clarificació
  originalIntent._meta = originalIntent._meta || {};
  originalIntent._meta.from_clarification = true;
  originalIntent._meta.clarification_option = selectedOption;

  return originalIntent;
}

// ═══════════════════════════════════════════════════════════════
// MAIN GATE 0 FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Executa Gate 0: comprova tots els fast paths
 *
 * @param {SanitizedInput} sanitizedInput - Input sanititzat
 * @param {DocumentContext} documentContext - Context del document
 * @param {SessionState} sessionState - Estat de sessió
 * @returns {FastPathResult} - Resultat del fast path check
 */
function checkFastPaths(sanitizedInput, documentContext, sessionState) {
  const normalized = sanitizedInput.normalized || '';
  const language = sanitizedInput.language || 'ca';

  logDebug('Gate 0 checking fast paths', { instruction_length: normalized.length });

  // 1. Comprovar pending_intent PRIMER (té prioritat)
  const pendingResult = checkPendingIntent(normalized, sessionState);
  if (pendingResult.matched) {
    return pendingResult;
  }

  // 2. Comprovar document buit (important fer-ho aviat)
  const emptyDocResult = checkEmptyDocument(documentContext, language);
  if (emptyDocResult.matched) {
    return emptyDocResult;
  }

  // 3. Comprovar salutacions
  const greetingResult = checkGreeting(normalized, language);
  if (greetingResult.matched) {
    return greetingResult;
  }

  // 4. Comprovar ajuda
  const helpResult = checkHelp(normalized, language);
  if (helpResult.matched) {
    return helpResult;
  }

  // 5. Comprovar agraïments
  const thanksResult = checkThanks(normalized, language);
  if (thanksResult.matched) {
    return thanksResult;
  }

  // 6. Comprovar comiats
  const farewellResult = checkFarewell(normalized, language);
  if (farewellResult.matched) {
    return farewellResult;
  }

  // 7. v13.1: Comprovar peticions d'errors/faltes → directament a REFERENCE_HIGHLIGHT
  const errorsResult = checkErrorsRequest(normalized, language, sanitizedInput.original);
  if (errorsResult.matched) {
    return errorsResult;
  }

  // Cap fast path matched
  logDebug('Gate 0 no match, continuing to classifier');
  return {
    matched: false,
    type: null,
    response: null,
    mergedIntent: null,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  checkFastPaths,
  checkGreeting,
  checkHelp,
  checkThanks,
  checkFarewell,
  checkEmptyDocument,
  checkPendingIntent,
  mergePendingIntent,
};
