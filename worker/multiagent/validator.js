/**
 * Multi-Agent System Validator v8.3
 *
 * Validació de sortides del classifier i executors:
 * - Verificació d'estructura JSON
 * - Detecció d'al·lucinacions (paràgrafs inexistents)
 * - Validació de referències creuades
 * - Fallback cascade quan la validació falla
 */

import { Mode, RiskLevel, createDefaultIntent, validateIntentPayload } from './types.js';
import { CONFIDENCE_THRESHOLDS, LENGTH_THRESHOLDS } from './config.js';
import { logWarn, logError, logDebug, logInfo as logInfoTelemetry } from './telemetry.js';

// ═══════════════════════════════════════════════════════════════
// VALIDATION RESULT TYPES
// ═══════════════════════════════════════════════════════════════

/**
 * Resultat de validació
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Si la validació ha passat
 * @property {Array<string>} errors - Llista d'errors trobats
 * @property {Array<string>} warnings - Llista d'avisos
 * @property {Object|null} correctedPayload - Payload corregit si s'ha pogut reparar
 * @property {boolean} shouldFallback - Si cal fer fallback a mode segur
 */

// ═══════════════════════════════════════════════════════════════
// STRUCTURE VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Valida l'estructura bàsica d'un intent payload
 * @param {Object} payload - Payload a validar
 * @returns {ValidationResult}
 */
function validateStructure(payload) {
  const errors = [];
  const warnings = [];

  // Camp obligatori: mode
  if (!payload.mode) {
    errors.push('Missing required field: mode');
  } else if (!Object.values(Mode).includes(payload.mode)) {
    errors.push(`Invalid mode: ${payload.mode}`);
  }

  // Camp obligatori: confidence
  if (typeof payload.confidence !== 'number') {
    warnings.push('Missing confidence, will use default');
  } else if (payload.confidence < 0 || payload.confidence > 1) {
    warnings.push(`Invalid confidence range: ${payload.confidence}, will clamp`);
  }

  // Validar segons el mode
  if (payload.mode === Mode.UPDATE_BY_ID || payload.mode === Mode.REWRITE) {
    if (!payload.target_paragraphs || !Array.isArray(payload.target_paragraphs)) {
      warnings.push('Editing mode without target_paragraphs');
    }
  }

  if (payload.mode === Mode.REFERENCE_HIGHLIGHT) {
    if (!payload.highlight_strategy) {
      warnings.push('REFERENCE_HIGHLIGHT without highlight_strategy');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    correctedPayload: null,
    shouldFallback: errors.length > 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// HALLUCINATION DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta al·lucinacions de paràgrafs inexistents
 * @param {Object} payload - Intent payload
 * @param {Object} documentContext - Context del document
 * @returns {ValidationResult}
 */
function detectHallucinations(payload, documentContext) {
  const errors = [];
  const warnings = [];
  let correctedPayload = null;

  const maxParaId = documentContext?.paragraphs?.length || 0;

  // Validar target_paragraphs
  if (payload.target_paragraphs && Array.isArray(payload.target_paragraphs)) {
    const invalidIds = payload.target_paragraphs.filter(id => {
      return typeof id !== 'number' || id < 0 || id >= maxParaId;
    });

    if (invalidIds.length > 0) {
      warnings.push(`Invalid paragraph IDs detected: [${invalidIds.join(', ')}]`);

      // Intentar corregir eliminant els IDs invàlids
      const validIds = payload.target_paragraphs.filter(id => {
        return typeof id === 'number' && id >= 0 && id < maxParaId;
      });

      if (validIds.length > 0) {
        correctedPayload = {
          ...payload,
          target_paragraphs: validIds,
          _meta: {
            ...(payload._meta || {}),
            corrected_hallucinations: invalidIds,
          },
        };
      } else {
        // Tots els IDs eren invàlids
        errors.push('All target paragraph IDs are invalid (hallucinated)');
      }
    }
  }

  // Validar highlight_paragraphs si existeix
  if (payload.highlight_paragraphs && Array.isArray(payload.highlight_paragraphs)) {
    const invalidHighlights = payload.highlight_paragraphs.filter(id => {
      return typeof id !== 'number' || id < 0 || id >= maxParaId;
    });

    if (invalidHighlights.length > 0) {
      warnings.push(`Invalid highlight paragraph IDs: [${invalidHighlights.join(', ')}]`);

      // Corregir si ja tenim un correctedPayload o crear-ne un
      const base = correctedPayload || payload;
      const validHighlights = payload.highlight_paragraphs.filter(id => {
        return typeof id === 'number' && id >= 0 && id < maxParaId;
      });

      correctedPayload = {
        ...base,
        highlight_paragraphs: validHighlights,
        _meta: {
          ...(base._meta || {}),
          corrected_highlight_hallucinations: invalidHighlights,
        },
      };
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    correctedPayload,
    shouldFallback: errors.length > 0 && !correctedPayload,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Valida que la confiança sigui apropiada pel mode
 * @param {Object} payload - Intent payload
 * @returns {ValidationResult}
 */
function validateConfidence(payload) {
  const errors = [];
  const warnings = [];
  let correctedPayload = null;

  const mode = payload.mode;
  const confidence = payload.confidence || 0;

  // Obtenir threshold pel mode
  const threshold = CONFIDENCE_THRESHOLDS[mode] || 0.70;

  // Clamp confidence to valid range
  let clampedConfidence = confidence;
  if (confidence < 0) {
    clampedConfidence = 0;
    warnings.push('Confidence was negative, clamped to 0');
  } else if (confidence > 1) {
    clampedConfidence = 1;
    warnings.push('Confidence was > 1, clamped to 1');
  }

  // Per modes d'edició, la confiança ha de superar el threshold
  if (mode === Mode.UPDATE_BY_ID || mode === Mode.REWRITE) {
    if (clampedConfidence < threshold) {
      warnings.push(`Low confidence (${clampedConfidence}) for editing mode ${mode} (threshold: ${threshold})`);
      // No error, però marcar per possible clarificació
    }
  }

  // Detectar confiança sospitosament alta
  if (clampedConfidence > 0.99) {
    warnings.push('Suspiciously high confidence (>0.99), may indicate model overconfidence');
  }

  // Si hem hagut de fer clamp, crear payload corregit
  if (clampedConfidence !== confidence) {
    correctedPayload = {
      ...payload,
      confidence: clampedConfidence,
      _meta: {
        ...(payload._meta || {}),
        original_confidence: confidence,
      },
    };
  }

  return {
    valid: true, // Confidence issues are warnings, not errors
    errors,
    warnings,
    correctedPayload,
    shouldFallback: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// CROSS-REFERENCE VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Valida coherència entre camps relacionats
 * @param {Object} payload - Intent payload
 * @returns {ValidationResult}
 */
function validateCrossReferences(payload) {
  const errors = [];
  const warnings = [];
  let correctedPayload = null;

  // Si és REFERENCE_HIGHLIGHT, no hauria de tenir modification_type
  if (payload.mode === Mode.REFERENCE_HIGHLIGHT && payload.modification_type) {
    warnings.push('REFERENCE_HIGHLIGHT should not have modification_type');
    correctedPayload = { ...payload };
    delete correctedPayload.modification_type;
  }

  // Si és CHAT_ONLY, no hauria de tenir target_paragraphs
  if (payload.mode === Mode.CHAT_ONLY && payload.target_paragraphs?.length > 0) {
    warnings.push('CHAT_ONLY should not have target_paragraphs');
    correctedPayload = { ...(correctedPayload || payload) };
    delete correctedPayload.target_paragraphs;
  }

  // Si és UPDATE_BY_ID, ha de tenir modification_type
  if (payload.mode === Mode.UPDATE_BY_ID && !payload.modification_type) {
    warnings.push('UPDATE_BY_ID should have modification_type');
    correctedPayload = {
      ...(correctedPayload || payload),
      modification_type: 'improve', // Default
    };
  }

  // Si té secondary_mode, ha de ser diferent del mode principal
  if (payload.secondary_mode && payload.secondary_mode === payload.mode) {
    warnings.push('secondary_mode should differ from primary mode');
    correctedPayload = { ...(correctedPayload || payload) };
    delete correctedPayload.secondary_mode;
  }

  return {
    valid: true, // Cross-reference issues are auto-correctable
    errors,
    warnings,
    correctedPayload,
    shouldFallback: false,
  };
}

// ═══════════════════════════════════════════════════════════════
// SAFETY VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Valida aspectes de seguretat del payload
 * @param {Object} payload - Intent payload
 * @param {Object} sanitizedInput - Input sanititzat
 * @returns {ValidationResult}
 */
function validateSafety(payload, sanitizedInput) {
  const errors = [];
  const warnings = [];

  // Safety Gate: Si la instrucció és clarament una pregunta,
  // no permetre modes d'edició
  if (sanitizedInput?.normalized) {
    const isQuestion = /^\s*(?:qu[eéè]|com|per\s*qu[eéè]|quan|on|qui|what|how|why|when|where|who|qué|cómo|por\s*qué|cuándo|dónde|quién)\b/i.test(sanitizedInput.normalized);
    const endsWithQuestion = sanitizedInput.normalized.trim().endsWith('?');

    if ((isQuestion || endsWithQuestion) &&
        (payload.mode === Mode.UPDATE_BY_ID || payload.mode === Mode.REWRITE)) {
      warnings.push('Question detected but editing mode selected - potential safety issue');
      // Marcar per revisió però no bloquejar automàticament
      // El router decidirà basant-se en la confiança
    }
  }

  // Validar que no hi hagi intents d'injecció en el raonament
  if (payload.reasoning) {
    // Detectar intents d'injecció de prompt
    const suspiciousPatterns = [
      /ignore\s+(?:all\s+)?(?:previous|above)/i,
      /disregard\s+(?:all\s+)?instructions/i,
      /new\s+(?:system\s+)?instructions?/i,
      /you\s+are\s+now/i,
      /override\s+(?:your\s+)?(?:programming|rules)/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(payload.reasoning)) {
        errors.push('Potential prompt injection detected in reasoning');
        break;
      }
    }
  }

  // Validar risk_level coherent amb l'acció
  if (payload.risk_level === RiskLevel.HIGH &&
      payload.mode !== Mode.REWRITE &&
      payload.scope !== 'document') {
    warnings.push('HIGH risk level for non-document-wide operation');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    correctedPayload: null,
    shouldFallback: errors.length > 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN VALIDATOR
// ═══════════════════════════════════════════════════════════════

/**
 * Executa totes les validacions sobre un intent payload
 *
 * @param {Object} payload - Intent payload del classifier
 * @param {Object} documentContext - Context del document
 * @param {Object} sanitizedInput - Input sanititzat original
 * @returns {ValidationResult} - Resultat agregat de totes les validacions
 */
function validateIntent(payload, documentContext, sanitizedInput = null) {
  const allErrors = [];
  const allWarnings = [];
  let currentPayload = payload;
  let shouldFallback = false;

  logDebug('Starting intent validation', { mode: payload?.mode });

  // 1. Validació d'estructura
  const structureResult = validateStructure(currentPayload);
  allErrors.push(...structureResult.errors);
  allWarnings.push(...structureResult.warnings);
  if (structureResult.shouldFallback) {
    shouldFallback = true;
  }

  // Si l'estructura és invàlida, no continuar
  if (!structureResult.valid) {
    logError('Intent validation failed: structure invalid', { errors: structureResult.errors });
    return {
      valid: false,
      errors: allErrors,
      warnings: allWarnings,
      correctedPayload: null,
      shouldFallback: true,
    };
  }

  // 2. Detecció d'al·lucinacions
  const hallucinationResult = detectHallucinations(currentPayload, documentContext);
  allErrors.push(...hallucinationResult.errors);
  allWarnings.push(...hallucinationResult.warnings);
  if (hallucinationResult.correctedPayload) {
    currentPayload = hallucinationResult.correctedPayload;
  }
  if (hallucinationResult.shouldFallback) {
    shouldFallback = true;
  }

  // 3. Validació de confiança
  const confidenceResult = validateConfidence(currentPayload);
  allErrors.push(...confidenceResult.errors);
  allWarnings.push(...confidenceResult.warnings);
  if (confidenceResult.correctedPayload) {
    currentPayload = confidenceResult.correctedPayload;
  }

  // 4. Validació de referències creuades
  const crossRefResult = validateCrossReferences(currentPayload);
  allErrors.push(...crossRefResult.errors);
  allWarnings.push(...crossRefResult.warnings);
  if (crossRefResult.correctedPayload) {
    currentPayload = crossRefResult.correctedPayload;
  }

  // 5. Validació de seguretat
  if (sanitizedInput) {
    const safetyResult = validateSafety(currentPayload, sanitizedInput);
    allErrors.push(...safetyResult.errors);
    allWarnings.push(...safetyResult.warnings);
    if (safetyResult.shouldFallback) {
      shouldFallback = true;
    }
  }

  // Logging dels resultats
  if (allErrors.length > 0) {
    logWarn('Intent validation found errors', { errors: allErrors });
  }
  if (allWarnings.length > 0) {
    logDebug('Intent validation warnings', { warnings: allWarnings });
  }

  const valid = allErrors.length === 0;
  const wasModified = currentPayload !== payload;

  return {
    valid,
    errors: allErrors,
    warnings: allWarnings,
    correctedPayload: wasModified ? currentPayload : null,
    shouldFallback: shouldFallback && !wasModified,
  };
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK CASCADE
// ═══════════════════════════════════════════════════════════════

/**
 * Aplica la cascada de fallback quan la validació falla
 *
 * Ordre de fallback:
 * 1. Si es pot corregir → usar payload corregit
 * 2. Si confiança baixa → demanar clarificació
 * 3. Si tot falla → CHAT_ONLY mode segur
 *
 * @param {ValidationResult} validationResult - Resultat de la validació
 * @param {Object} originalPayload - Payload original
 * @param {string} language - Idioma de l'usuari
 * @returns {Object} - Intent final a utilitzar
 */
function applyFallbackCascade(validationResult, originalPayload, language = 'ca') {
  // Cas 1: Validació OK, retornar original o corregit
  if (validationResult.valid) {
    return validationResult.correctedPayload || originalPayload;
  }

  // Cas 2: Tenim payload corregit viable
  if (validationResult.correctedPayload) {
    logInfo('Using corrected payload after validation', {
      warnings: validationResult.warnings.length,
    });
    return validationResult.correctedPayload;
  }

  // Cas 3: Fallback a CHAT_ONLY
  logWarn('Falling back to CHAT_ONLY due to validation failure', {
    errors: validationResult.errors,
  });

  const fallbackMessages = {
    ca: "No he pogut entendre la teva petició amb prou certesa. Podries reformular-la?",
    es: "No he podido entender tu petición con suficiente certeza. ¿Podrías reformularla?",
    en: "I couldn't understand your request with enough certainty. Could you rephrase it?",
  };

  return {
    mode: Mode.CHAT_ONLY,
    confidence: 0.3,
    reasoning: 'Validation failed, fallback to safe mode',
    chat_response: fallbackMessages[language] || fallbackMessages.ca,
    _meta: {
      fallback: true,
      validation_errors: validationResult.errors,
      original_mode: originalPayload?.mode,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// SHADOW VALIDATOR v12.1 - Validació de Respostes Gemini
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta si una paraula és probablement un nom propi
 * Condicions:
 * 1. Comença amb majúscula
 * 2. NO està a l'inici de frase
 * 3. NO existeix en minúscula al document
 *
 * @param {string} word - La paraula a verificar
 * @param {string} paragraphText - Text complet del paràgraf
 * @param {string} fullDocumentText - Text complet del document (opcional)
 * @returns {boolean}
 */
function isLikelyProperNoun(word, paragraphText, fullDocumentText = '') {
  if (!word || word.length < 2) return false;

  // 1. Comença amb majúscula?
  const startsWithCapital = /^[A-ZÁÉÍÓÚÀÈÒÙÏÜÇ]/.test(word);
  if (!startsWithCapital) return false;

  // 2. Està a l'inici de frase? Busquem el context
  const wordIndex = paragraphText.indexOf(word);
  if (wordIndex === -1) return false;

  // Obtenim el text abans de la paraula
  const textBefore = paragraphText.substring(0, wordIndex).trimEnd();

  // Si és l'inici del paràgraf o segueix un punt/interrogació/exclamació
  const isAtSentenceStart = textBefore === '' ||
    /[.!?:]\s*$/.test(textBefore) ||
    /^["'«"']?\s*$/.test(textBefore.slice(-2));

  if (isAtSentenceStart) return false;

  // 3. Existeix versió en minúscula al document?
  const lowerWord = word.toLowerCase();
  const searchText = fullDocumentText || paragraphText;

  // Busquem la paraula en minúscula (no a l'inici de frase)
  const lowerPattern = new RegExp(`[a-záéíóúàèòùïüç]\\s+${lowerWord}\\b`, 'i');
  if (lowerPattern.test(searchText)) {
    return false; // Si existeix en minúscula, no és nom propi
  }

  // Casos especials: articles catalans que sovint es confonen
  const commonWords = ['al', 'del', 'el', 'en', 'es', 'la', 'les', 'els', 'un', 'una'];
  if (commonWords.includes(lowerWord)) return false;

  return true;
}

/**
 * Valida canvis de mode FIX amb LENGTH_THRESHOLDS
 * @param {Array} changes - Canvis proposats
 * @param {Object} documentContext - Context del document
 * @returns {{validChanges: Array, rejectedChanges: Array, warnings: Array}}
 */
function validateFixChanges(changes, documentContext) {
  const validChanges = [];
  const rejectedChanges = [];
  const warnings = [];

  const thresholds = LENGTH_THRESHOLDS.fix;

  for (const change of changes) {
    const paragraph = documentContext?.paragraphs?.[change.paragraph_id];
    if (!paragraph) {
      rejectedChanges.push({ ...change, rejection_reason: 'Paràgraf no trobat' });
      continue;
    }

    const originalText = paragraph.text || paragraph || '';
    const findText = change.find;
    const replaceText = change.replace;

    // Verificar que find existeix al paràgraf
    if (!originalText.includes(findText)) {
      rejectedChanges.push({
        ...change,
        rejection_reason: `HALLUCINATION: "${findText}" no existeix al paràgraf`,
      });
      logWarn('HALLUCINATION detectada en FIX', {
        paragraph_id: change.paragraph_id,
        find: findText,
        actual_text: originalText.substring(0, 100),
      });
      continue;
    }

    // Calcular canvi de longitud del find/replace
    const lengthDelta = (replaceText.length - findText.length) / Math.max(findText.length, 1);

    if (lengthDelta < thresholds.min || lengthDelta > thresholds.max) {
      if (thresholds.action === 'BLOCK') {
        rejectedChanges.push({
          ...change,
          rejection_reason: `Canvi de longitud excessiu: ${(lengthDelta * 100).toFixed(1)}% (límit: ${thresholds.min * 100}% a ${thresholds.max * 100}%)`,
        });
        continue;
      } else if (thresholds.action === 'WARN') {
        warnings.push(`Canvi de longitud notable: ${(lengthDelta * 100).toFixed(1)}% al paràgraf ${change.paragraph_id + 1}`);
      }
    }

    // Detectar si és un fals positiu de nom propi
    if (change.reason === 'diacritic' || change.reason === 'accent') {
      // Verificar si és un nom propi que no s'ha de modificar
      const words = findText.split(/\s+/);
      const firstCapitalWord = words.find(w => /^[A-ZÁÉÍÓÚÀÈÒÙÏÜÇ]/.test(w));

      if (firstCapitalWord) {
        const fullDocText = documentContext.paragraphs.map(p => p.text || p).join(' ');
        if (isLikelyProperNoun(firstCapitalWord, originalText, fullDocText)) {
          rejectedChanges.push({
            ...change,
            rejection_reason: `PROPER_NOUN: "${firstCapitalWord}" sembla un nom propi`,
          });
          logDebug('Possible nom propi detectat', { word: firstCapitalWord, change });
          continue;
        }
      }
    }

    validChanges.push(change);
  }

  return { validChanges, rejectedChanges, warnings };
}

/**
 * Valida canvis genèrics (improve, expand, simplify, etc.)
 * @param {Array} changes - Canvis proposats
 * @param {string} modificationType - Tipus de modificació
 * @param {Object} documentContext - Context del document
 * @returns {{validChanges: Array, rejectedChanges: Array, warnings: Array}}
 */
function validateGenericChanges(changes, modificationType, documentContext) {
  const validChanges = [];
  const rejectedChanges = [];
  const warnings = [];

  const thresholds = LENGTH_THRESHOLDS[modificationType] || LENGTH_THRESHOLDS.improve;

  for (const change of changes) {
    const paragraph = documentContext?.paragraphs?.[change.paragraph_id];
    if (!paragraph) {
      rejectedChanges.push({ ...change, rejection_reason: 'Paràgraf no trobat' });
      continue;
    }

    const originalText = change.original_text || paragraph.text || paragraph || '';
    const newText = change.new_text || '';

    // Calcular canvi de longitud
    const lengthDelta = (newText.length - originalText.length) / Math.max(originalText.length, 1);

    if (lengthDelta < thresholds.min || lengthDelta > thresholds.max) {
      if (thresholds.action === 'BLOCK') {
        rejectedChanges.push({
          ...change,
          rejection_reason: `Canvi de longitud fora de rang: ${(lengthDelta * 100).toFixed(1)}% (permès: ${thresholds.min * 100}% a ${thresholds.max * 100}%)`,
        });
        continue;
      } else if (thresholds.action === 'WARN') {
        warnings.push(`Canvi de longitud ${modificationType}: ${(lengthDelta * 100).toFixed(1)}% al paràgraf ${change.paragraph_id + 1}`);
      }
    }

    // Verificar que el nou text no és idèntic a l'original
    if (newText.trim() === originalText.trim()) {
      warnings.push(`Canvi sense efecte al paràgraf ${change.paragraph_id + 1}`);
      continue; // Saltar canvis que no canvien res
    }

    validChanges.push(change);
  }

  return { validChanges, rejectedChanges, warnings };
}

/**
 * Valida highlights per reduir falsos positius
 * @param {Array} highlights - Highlights proposats
 * @param {Object} documentContext - Context del document
 * @returns {{validHighlights: Array, rejectedHighlights: Array, warnings: Array}}
 */
function validateHighlightResponse(highlights, documentContext) {
  const validHighlights = [];
  const rejectedHighlights = [];
  const warnings = [];

  for (const h of highlights) {
    const paragraph = documentContext?.paragraphs?.[h.paragraph_id];
    if (!paragraph) {
      rejectedHighlights.push({ ...h, rejection_reason: 'Paràgraf no trobat' });
      continue;
    }

    const paragraphText = paragraph.text || paragraph || '';
    const highlightText = h.text_to_highlight || h.snippet || '';

    // Verificar que el text existeix al paràgraf
    if (!paragraphText.includes(highlightText)) {
      // Intentar cerca fuzzy (per diferències de whitespace)
      const normalizedPara = paragraphText.replace(/\s+/g, ' ').trim();
      const normalizedHighlight = highlightText.replace(/\s+/g, ' ').trim();

      if (!normalizedPara.includes(normalizedHighlight)) {
        rejectedHighlights.push({
          ...h,
          rejection_reason: `Text "${highlightText.substring(0, 30)}..." no trobat`,
        });
        continue;
      }
    }

    // Per errors de diacrítics, verificar que no és nom propi
    if (h.color === 'yellow' || h.color === 'orange') {
      const fullDocText = documentContext.paragraphs.map(p => p.text || p).join(' ');
      const wordsToCheck = highlightText.split(/\s+/).filter(w => /^[A-ZÁÉÍÓÚÀÈÒÙÏÜÇ]/.test(w));

      let isProperNoun = false;
      for (const word of wordsToCheck) {
        if (isLikelyProperNoun(word, paragraphText, fullDocText)) {
          isProperNoun = true;
          break;
        }
      }

      if (isProperNoun) {
        rejectedHighlights.push({
          ...h,
          rejection_reason: 'PROPER_NOUN: Sembla un nom propi',
        });
        continue;
      }
    }

    validHighlights.push(h);
  }

  return { validHighlights, rejectedHighlights, warnings };
}

/**
 * Validador principal de resposta Gemini v12.1
 * Aplica Shadow Validation segons el mode i tipus de modificació
 *
 * @param {Object} response - Resposta de l'executor
 * @param {string} mode - Mode de l'operació (UPDATE_BY_ID, REFERENCE_HIGHLIGHT, etc.)
 * @param {string} modificationType - Tipus de modificació (fix, improve, expand, etc.)
 * @param {Object} documentContext - Context del document
 * @returns {Object} - Resposta validada amb canvis filtrats
 */
function validateGeminiResponse(response, mode, modificationType, documentContext) {
  if (!response) {
    return {
      valid: false,
      response: null,
      errors: ['Resposta buida'],
      warnings: [],
    };
  }

  const allWarnings = [];
  const allErrors = [];

  // Validar segons el mode
  if (mode === 'UPDATE_BY_ID' && response.changes) {
    let validationResult;

    if (modificationType === 'fix') {
      validationResult = validateFixChanges(response.changes, documentContext);
    } else {
      validationResult = validateGenericChanges(response.changes, modificationType, documentContext);
    }

    allWarnings.push(...validationResult.warnings);

    if (validationResult.rejectedChanges.length > 0) {
      logWarn('Shadow Validator: Canvis rebutjats', {
        rejected: validationResult.rejectedChanges.length,
        total: response.changes.length,
        details: validationResult.rejectedChanges.map(c => ({
          paragraph_id: c.paragraph_id,
          reason: c.rejection_reason,
        })),
      });
    }

    // Retornar resposta amb canvis filtrats
    return {
      valid: validationResult.validChanges.length > 0,
      response: {
        ...response,
        changes: validationResult.validChanges,
        _validation: {
          rejected_changes: validationResult.rejectedChanges,
          original_count: response.changes.length,
          valid_count: validationResult.validChanges.length,
        },
      },
      errors: validationResult.validChanges.length === 0 ? ['Tots els canvis han estat rebutjats'] : [],
      warnings: allWarnings,
    };
  }

  if (mode === 'REFERENCE_HIGHLIGHT' && response.highlights) {
    const validationResult = validateHighlightResponse(response.highlights, documentContext);

    allWarnings.push(...validationResult.warnings);

    if (validationResult.rejectedHighlights.length > 0) {
      logDebug('Shadow Validator: Highlights rebutjats', {
        rejected: validationResult.rejectedHighlights.length,
        total: response.highlights.length,
      });
    }

    return {
      valid: validationResult.validHighlights.length > 0 || !!response.chat_response,
      response: {
        ...response,
        highlights: validationResult.validHighlights,
        _validation: {
          rejected_highlights: validationResult.rejectedHighlights,
          original_count: response.highlights.length,
          valid_count: validationResult.validHighlights.length,
        },
      },
      errors: [],
      warnings: allWarnings,
    };
  }

  // Per altres modes, retornar sense modificar
  return {
    valid: true,
    response,
    errors: [],
    warnings: allWarnings,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXECUTOR OUTPUT VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Valida la sortida d'un executor abans d'aplicar canvis
 * @param {Object} executorResult - Resultat de l'executor
 * @param {Object} documentContext - Context del document
 * @returns {ValidationResult}
 */
function validateExecutorOutput(executorResult, documentContext) {
  const errors = [];
  const warnings = [];

  // Verificar estructura bàsica
  if (!executorResult) {
    errors.push('Executor returned null result');
    return { valid: false, errors, warnings, correctedPayload: null, shouldFallback: true };
  }

  // Per REFERENCE_HIGHLIGHT, validar highlights
  if (executorResult.highlights && Array.isArray(executorResult.highlights)) {
    const maxParaId = documentContext?.paragraphs?.length || 0;

    for (let i = 0; i < executorResult.highlights.length; i++) {
      const h = executorResult.highlights[i];

      if (typeof h.paragraph_id !== 'number' || h.paragraph_id < 0 || h.paragraph_id >= maxParaId) {
        warnings.push(`Invalid highlight paragraph_id at index ${i}: ${h.paragraph_id}`);
      }

      if (!h.text_to_highlight || typeof h.text_to_highlight !== 'string') {
        warnings.push(`Missing or invalid text_to_highlight at index ${i}`);
      }

      if (!h.comment || typeof h.comment !== 'string') {
        warnings.push(`Missing or invalid comment at index ${i}`);
      }
    }
  }

  // Per UPDATE_BY_ID, validar changes
  if (executorResult.changes && Array.isArray(executorResult.changes)) {
    const maxParaId = documentContext?.paragraphs?.length || 0;

    for (let i = 0; i < executorResult.changes.length; i++) {
      const change = executorResult.changes[i];

      if (typeof change.paragraph_id !== 'number' || change.paragraph_id < 0 || change.paragraph_id >= maxParaId) {
        errors.push(`Invalid change paragraph_id at index ${i}: ${change.paragraph_id}`);
      }

      if (!change.new_text || typeof change.new_text !== 'string') {
        errors.push(`Missing or invalid new_text at index ${i}`);
      }
    }
  }

  // Verificar que chat_response existeixi si és necessari
  if (!executorResult.chat_response && !executorResult.highlights && !executorResult.changes) {
    warnings.push('Executor result has no actionable output');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    correctedPayload: null,
    shouldFallback: errors.length > 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// LOGGING HELPER
// ═══════════════════════════════════════════════════════════════

function logInfo(message, data) {
  // Import circular, so we use a simple version
  console.log(`[INFO] ${message}`, JSON.stringify(data || {}));
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // Main validator
  validateIntent,
  applyFallbackCascade,
  validateExecutorOutput,

  // Shadow Validator v12.1
  validateGeminiResponse,
  validateFixChanges,
  validateGenericChanges,
  validateHighlightResponse,
  isLikelyProperNoun,

  // Individual validators (for testing)
  validateStructure,
  detectHallucinations,
  validateConfidence,
  validateCrossReferences,
  validateSafety,
};
