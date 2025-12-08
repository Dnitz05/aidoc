/**
 * UPDATE_BY_ID Executor v8.3
 *
 * Executor per modificar paràgrafs específics del document.
 * Suporta diferents tipus de modificació:
 * - fix: Corregir errors mantenint el significat
 * - improve: Millorar estil i claredat
 * - expand: Expandir el contingut
 * - simplify: Simplificar el text
 * - translate: Traduir a un altre idioma
 */

import { Mode, ActionType } from '../types.js';
import { GEMINI, TIMEOUTS } from '../config.js';
import { logInfo, logDebug, logError, logWarn } from '../telemetry.js';
import { formatContextForExecutor } from '../context.js';

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPTS PER TIPUS
// ═══════════════════════════════════════════════════════════════

const UPDATE_PROMPTS = {
  fix: `Ets un corrector lingüístic expert. La teva tasca és CORREGIR ERRORS sense canviar el significat.

## Regles
- Corregeix NOMÉS errors ortogràfics, gramaticals i de puntuació
- NO canviïs l'estil ni el to
- NO afegeixis ni eliminis informació
- Manté la mateixa llargada aproximada

## Format de sortida
\`\`\`json
{
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<text original>",
      "new_text": "<text corregit>",
      "explanation": "<què s'ha corregit>"
    }
  ]
}
\`\`\``,

  improve: `Ets un editor professional. La teva tasca és MILLORAR el text mantenint el significat.

## Objectius
- Millorar claredat i llegibilitat
- Eliminar repeticions innecessàries
- Millorar el flux del text
- Mantenir el to original

## Restriccions
- NO canviïs el significat
- NO afegeixis informació nova
- Canvis moderats (no reescriptura total)

## Format de sortida
\`\`\`json
{
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<text original>",
      "new_text": "<text millorat>",
      "explanation": "<què s'ha millorat>"
    }
  ]
}
\`\`\``,

  expand: `Ets un escriptor expert. La teva tasca és EXPANDIR el contingut.

## Objectius
- Afegir detalls o exemples rellevants
- Desenvolupar idees existents
- Mantenir coherència amb el context

## Restriccions
- NO contradiguis el contingut original
- Manté el mateix estil i to
- Expansió moderada (2-3x màxim)

## Format de sortida
\`\`\`json
{
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<text original>",
      "new_text": "<text expandit>",
      "explanation": "<què s'ha afegit>"
    }
  ]
}
\`\`\``,

  simplify: `Ets un expert en comunicació clara. La teva tasca és SIMPLIFICAR el text.

## Objectius
- Fer el text més accessible
- Eliminar jargó innecessari
- Frases més curtes i directes
- Mantenir la informació essencial

## Format de sortida
\`\`\`json
{
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<text original>",
      "new_text": "<text simplificat>",
      "explanation": "<què s'ha simplificat>"
    }
  ]
}
\`\`\``,

  translate: `Ets un traductor professional. La teva tasca és TRADUIR el text.

## Objectius
- Traducció natural, no literal
- Mantenir el to i estil
- Adaptar expressions idiomàtiques

## Format de sortida
\`\`\`json
{
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<text original>",
      "new_text": "<text traduït>",
      "target_language": "<idioma destí>"
    }
  ]
}
\`\`\``,
};

// ═══════════════════════════════════════════════════════════════
// EXECUTOR IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Executa una petició UPDATE_BY_ID
 *
 * @param {Object} intent - Intent classificat
 * @param {Object} documentContext - Context del document
 * @param {Object} conversationContext - Context de conversa
 * @param {Object} options - Opcions d'execució
 * @returns {Promise<Object>} - Resultat amb canvis
 */
async function executeUpdateById(intent, documentContext, conversationContext, options = {}) {
  const { apiKey, signal } = options;
  const language = intent.language || 'ca';
  const modificationType = intent.modification_type || 'improve';

  logInfo('Executing UPDATE_BY_ID', {
    modification_type: modificationType,
    target_paragraphs: intent.target_paragraphs,
    scope: intent.scope,
  });

  // Validar que tenim paràgrafs target
  if (!intent.target_paragraphs || intent.target_paragraphs.length === 0) {
    return createNoTargetResponse(language);
  }

  // Validar que els paràgrafs existeixen
  const validTargets = intent.target_paragraphs.filter(
    id => id >= 0 && id < documentContext.paragraphs.length
  );

  if (validTargets.length === 0) {
    return createInvalidTargetResponse(language);
  }

  try {
    // Construir prompt
    const { systemPrompt, userPrompt } = buildUpdatePrompt(
      modificationType,
      intent,
      documentContext,
      validTargets
    );

    // Cridar Gemini
    const response = await callGeminiUpdate(systemPrompt, userPrompt, apiKey, signal);

    // Parsejar resposta
    const parsedResponse = parseUpdateResponse(response);

    // Validar canvis
    const validatedChanges = validateChanges(parsedResponse.changes, documentContext, validTargets);

    if (validatedChanges.length === 0) {
      return createNoChangesResponse(language, modificationType);
    }

    logDebug('UPDATE_BY_ID completed', {
      changes_count: validatedChanges.length,
      modification_type: modificationType,
    });

    // Construir resposta
    const chatResponse = buildUpdateChatResponse(validatedChanges, modificationType, language);

    return {
      mode: Mode.UPDATE_BY_ID,
      changes: validatedChanges,
      chat_response: chatResponse,
      _meta: {
        executor: 'update',
        modification_type: modificationType,
        paragraphs_modified: validatedChanges.length,
      },
    };

  } catch (error) {
    logError('UPDATE_BY_ID executor failed', { error: error.message });
    return createErrorResponse(error, language);
  }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix els prompts per a l'update
 */
function buildUpdatePrompt(modificationType, intent, documentContext, targetParagraphs) {
  const systemPrompt = UPDATE_PROMPTS[modificationType] || UPDATE_PROMPTS.improve;

  const parts = [];

  // Instrucció de l'usuari
  parts.push('## Instrucció de l\'usuari');
  parts.push(intent.original_instruction || `${modificationType} el text`);
  parts.push('');

  // To/estil demanat (si n'hi ha)
  if (intent.requested_tone) {
    parts.push('## Estil demanat');
    parts.push(intent.requested_tone);
    parts.push('');
  }

  // Idioma destí (per translate)
  if (modificationType === 'translate' && intent.target_language) {
    parts.push('## Idioma destí');
    parts.push(intent.target_language);
    parts.push('');
  }

  // Paràgrafs a modificar
  parts.push('## Paràgrafs a modificar');
  for (const id of targetParagraphs) {
    const para = documentContext.paragraphs[id];
    const text = para.text || para;
    parts.push(`§${id}: ${text}`);
  }
  parts.push('');

  // Context addicional (paràgrafs adjacents)
  const contextIds = new Set();
  for (const id of targetParagraphs) {
    if (id > 0) contextIds.add(id - 1);
    if (id < documentContext.paragraphs.length - 1) contextIds.add(id + 1);
  }
  // Eliminar els que ja són targets
  targetParagraphs.forEach(id => contextIds.delete(id));

  if (contextIds.size > 0) {
    parts.push('## Context (paràgrafs adjacents, NO modificar)');
    for (const id of Array.from(contextIds).sort((a, b) => a - b)) {
      const para = documentContext.paragraphs[id];
      const text = (para.text || para).slice(0, 200);
      parts.push(`§${id}: ${text}${text.length >= 200 ? '...' : ''}`);
    }
  }

  return {
    systemPrompt,
    userPrompt: parts.join('\n'),
  };
}

// ═══════════════════════════════════════════════════════════════
// GEMINI API CALL
// ═══════════════════════════════════════════════════════════════

/**
 * Crida Gemini per generar actualitzacions
 */
async function callGeminiUpdate(systemPrompt, userPrompt, apiKey, signal) {
  const url = `${GEMINI.base_url}/models/${GEMINI.model_update}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: systemPrompt },
          { text: userPrompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.4, // Balanceig entre creativitat i consistència
      topP: 0.85,
      maxOutputTokens: 8192,  // Augmentat: 20 paràgrafs + thinking necessiten més espai
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE PARSING
// ═══════════════════════════════════════════════════════════════

/**
 * Parseja la resposta de Gemini
 */
function parseUpdateResponse(responseText) {
  // Buscar JSON
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  let jsonStr = jsonMatch ? jsonMatch[1] : responseText;

  if (!jsonMatch) {
    const startIdx = responseText.indexOf('{');
    const endIdx = responseText.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1) {
      jsonStr = responseText.slice(startIdx, endIdx + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      changes: parsed.changes || [],
    };
  } catch (error) {
    logWarn('Failed to parse update response as JSON', { error: error.message });
    return { changes: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Valida els canvis proposats
 */
function validateChanges(changes, documentContext, validTargets) {
  if (!Array.isArray(changes)) return [];

  const targetSet = new Set(validTargets);
  const validated = [];

  for (const change of changes) {
    // Validar paragraph_id
    if (typeof change.paragraph_id !== 'number' || !targetSet.has(change.paragraph_id)) {
      logWarn('Change for non-target paragraph', { id: change.paragraph_id });
      continue;
    }

    // Validar que hi ha new_text
    if (!change.new_text || typeof change.new_text !== 'string') {
      logWarn('Change without new_text', { id: change.paragraph_id });
      continue;
    }

    // Verificar que el canvi és diferent de l'original
    const original = documentContext.paragraphs[change.paragraph_id];
    const originalText = original.text || original;

    if (change.new_text.trim() === originalText.trim()) {
      logDebug('Change identical to original, skipping', { id: change.paragraph_id });
      continue;
    }

    // Guardar text original si no estava
    if (!change.original_text) {
      change.original_text = originalText;
    }

    validated.push({
      paragraph_id: change.paragraph_id,
      original_text: change.original_text,
      new_text: change.new_text,
      explanation: change.explanation || null,
    });
  }

  return validated;
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix la resposta de chat
 */
function buildUpdateChatResponse(changes, modificationType, language) {
  const count = changes.length;

  const templates = {
    ca: {
      fix: `He corregit ${count} paràgraf${count !== 1 ? 's' : ''}.`,
      improve: `He millorat ${count} paràgraf${count !== 1 ? 's' : ''}.`,
      expand: `He expandit ${count} paràgraf${count !== 1 ? 's' : ''}.`,
      simplify: `He simplificat ${count} paràgraf${count !== 1 ? 's' : ''}.`,
      translate: `He traduït ${count} paràgraf${count !== 1 ? 's' : ''}.`,
    },
    es: {
      fix: `He corregido ${count} párrafo${count !== 1 ? 's' : ''}.`,
      improve: `He mejorado ${count} párrafo${count !== 1 ? 's' : ''}.`,
      expand: `He expandido ${count} párrafo${count !== 1 ? 's' : ''}.`,
      simplify: `He simplificado ${count} párrafo${count !== 1 ? 's' : ''}.`,
      translate: `He traducido ${count} párrafo${count !== 1 ? 's' : ''}.`,
    },
    en: {
      fix: `I've corrected ${count} paragraph${count !== 1 ? 's' : ''}.`,
      improve: `I've improved ${count} paragraph${count !== 1 ? 's' : ''}.`,
      expand: `I've expanded ${count} paragraph${count !== 1 ? 's' : ''}.`,
      simplify: `I've simplified ${count} paragraph${count !== 1 ? 's' : ''}.`,
      translate: `I've translated ${count} paragraph${count !== 1 ? 's' : ''}.`,
    },
  };

  const t = templates[language] || templates.ca;
  let response = t[modificationType] || t.improve;

  // Afegir detalls dels canvis
  if (changes.length <= 3) {
    const details = changes.map(c => {
      if (c.explanation) return `\n• §${c.paragraph_id}: ${c.explanation}`;
      return '';
    }).filter(Boolean);
    if (details.length > 0) {
      response += details.join('');
    }
  }

  return response;
}

// ═══════════════════════════════════════════════════════════════
// ERROR RESPONSES
// ═══════════════════════════════════════════════════════════════

function createNoTargetResponse(language) {
  const messages = {
    ca: "No he pogut determinar quin paràgraf vols modificar. Pots seleccionar-lo o indicar-me'l?",
    es: "No he podido determinar qué párrafo quieres modificar. ¿Puedes seleccionarlo o indicármelo?",
    en: "I couldn't determine which paragraph you want to modify. Can you select it or tell me?",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: { executor: 'update', error: 'no_target' },
  };
}

function createInvalidTargetResponse(language) {
  const messages = {
    ca: "Els paràgrafs indicats no existeixen al document.",
    es: "Los párrafos indicados no existen en el documento.",
    en: "The indicated paragraphs don't exist in the document.",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: { executor: 'update', error: 'invalid_target' },
  };
}

function createNoChangesResponse(language, modificationType) {
  const messages = {
    ca: "No he trobat cap canvi necessari als paràgrafs indicats.",
    es: "No he encontrado ningún cambio necesario en los párrafos indicados.",
    en: "I didn't find any necessary changes in the indicated paragraphs.",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: { executor: 'update', no_changes: true, modification_type: modificationType },
  };
}

function createErrorResponse(error, language) {
  const messages = {
    ca: "Ho sento, he tingut un problema modificant el document. Torna a provar.",
    es: "Lo siento, he tenido un problema modificando el documento. Vuelve a intentarlo.",
    en: "Sorry, I had a problem modifying the document. Please try again.",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: { executor: 'update', error: error.message, fallback: true },
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export { executeUpdateById };
