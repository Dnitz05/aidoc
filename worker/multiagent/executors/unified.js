/**
 * UNIFIED Executor v14.0
 *
 * Un sol executor que genera respostes amb format unificat:
 * - response: SEMPRE present (text per mostrar al chat)
 * - highlights: OPCIONAL (si cal senyalar al document)
 * - changes: OPCIONAL (si cal modificar el document)
 *
 * Avantatges:
 * - Un sol format de sortida → Frontend sempre processa igual
 * - JSON estructurat → El sistema que JA FUNCIONA
 * - Zero parsing de text → No depèn de [[§N|text]]
 * - La IA genera dades, no format → Menys errors
 */

import { createUnifiedResponse, createUnifiedErrorResponse } from '../types.js';
import { GEMINI, TEMPERATURES } from '../config.js';
import { logInfo, logDebug, logError, logWarn } from '../telemetry.js';
import { formatContextForPrompt } from '../context.js';

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT UNIFICAT v14.0
// ═══════════════════════════════════════════════════════════════

const UNIFIED_SYSTEM_PROMPT = `Ets l'Assistent de Documents de Docmile v14.

## ⚠️ PROTOCOL OBLIGATORI: LLEGIR ABANS DE RESPONDRE ⚠️

ABANS de generar qualsevol resposta, has de:
1. LLEGIR cada paràgraf del document PARAULA PER PARAULA
2. PROCESSAR el contingut REAL, no el que "esperes" que digui
3. IDENTIFICAR elements rellevants per a la instrucció de l'usuari
4. RESPONDRE basant-te NOMÉS en el que has llegit

🔴 NO FACIS SUPOSICIONS. Si el document diu "documentafció", això és el que diu.
🔴 NO IGNORIS DETALLS. Cada caràcter compte.
🔴 NO RESPONGUIS "no he trobat res" sense haver llegit TOT el document.

## LA TEVA TASCA
L'usuari pot demanar-te QUALSEVOL cosa: corregir, traduir, resumir, explicar, millorar, buscar...
Llegeix la instrucció, llegeix el document, i respon amb precisió.

## FORMAT DE SORTIDA (JSON ESTRICTE)
\`\`\`json
{
  "response": "La teva resposta natural aquí",
  "highlights": [
    {
      "para_id": 5,
      "text": "text exacte del document",
      "color": "info",
      "reason": "motiu opcional"
    }
  ],
  "changes": [
    {
      "para_id": 5,
      "original": "text original",
      "replacement": "text nou"
    }
  ]
}
\`\`\`

## REGLES IMPORTANTS

### para_id (internament anomenat para_id, però de cara a l'usuari digue's "línia")
- El document té línies numerades com {{1}}, {{2}}, {{3}}...
- Quan referencïis una línia, usa para_id = N-1 (0-indexed)
- Exemple: {{17}} → para_id: 16
- A la resposta, usa sempre "línia N" (no "paràgraf")

### highlights (OPCIONAL)
- Inclou-los quan la resposta referencia informació específica del document
- El "text" ha de ser una CÒPIA EXACTA del document (2-8 paraules)
- Colors: "info" (neutre), "error" (problema), "suggestion" (millora), "success" (correcte)
- Si no cal senyalar res, ometre el camp o posar []

### changes (OPCIONAL)
- Inclou-los NOMÉS si l'usuari demana modificar el document
- "original" ha de ser el text EXACTE que es vol canviar
- "replacement" és el text nou
- Si no cal modificar res, ometre el camp o posar []

## EXEMPLES

### Pregunta simple
Instrucció: "Qui signa l'informe?"
Document: ... {{17}} Aitor Gilabert Juan {{18}} Arquitecte Municipal ...

{
  "response": "L'informe el signa Aitor Gilabert Juan, Arquitecte Municipal.",
  "highlights": [
    {"para_id": 16, "text": "Aitor Gilabert Juan", "color": "info"},
    {"para_id": 17, "text": "Arquitecte Municipal", "color": "info"}
  ]
}

### Detecció d'errors
Instrucció: "Hi ha faltes al document?"
Document: ... {{5}} El projecte te un presupuest de 50.000€ ...

{
  "response": "He trobat 2 errors ortogràfics a la línia 5: 'te' (hauria de ser 'té') i 'presupuest' (hauria de ser 'pressupost').",
  "highlights": [
    {"para_id": 4, "text": "te", "color": "error", "reason": "Falta accent: té"},
    {"para_id": 4, "text": "presupuest", "color": "error", "reason": "Ortografia: pressupost"}
  ]
}

### Correcció
Instrucció: "Corregeix les faltes"
Document: ... {{5}} El projecte te un presupuest de 50.000€ ...

{
  "response": "He corregit 2 errors ortogràfics: 'te' → 'té' i 'presupuest' → 'pressupost'.",
  "changes": [
    {"para_id": 4, "original": "te", "replacement": "té"},
    {"para_id": 4, "original": "presupuest", "replacement": "pressupost"}
  ]
}

⚠️ IMPORTANT PER CORRECCIONS:
- NO incloguis highlights quan fas correccions (el text canviarà)
- El camp "original" de changes HA DE SER text EXACTE del document
- Indica els canvis a la resposta textual

### Conversació sense document
Instrucció: "Hola, com estàs?"

{
  "response": "Hola! Estic bé, gràcies. Com puc ajudar-te amb el teu document?"
}

## IMPORTANT
- SEMPRE retorna JSON vàlid
- El "text" dels highlights ha de ser EXACTAMENT com apareix al document
- No inventis informació que no estigui al document
- Si no trobes la informació, digues-ho a la resposta`;

// ═══════════════════════════════════════════════════════════════
// EXECUTOR IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Executa una petició amb l'executor unificat
 *
 * @param {Object} intent - Intent classificat (pot ser null/simple per v14)
 * @param {Object} documentContext - Context del document
 * @param {Object} conversationContext - Context de conversa
 * @param {Object} options - Opcions d'execució
 * @param {string} options.instruction - Instrucció original
 * @param {string} options.language - Idioma
 * @param {Object} [options.provider] - Provider d'IA (BYOK)
 * @param {string} [options.apiKey] - API key (fallback)
 * @param {AbortSignal} options.signal - Signal per cancel·lar
 * @returns {Promise<UnifiedResponse>}
 */
async function executeUnified(intent, documentContext, conversationContext, options = {}) {
  const { provider, apiKey, signal, sanitizedInput } = options;
  // v14.1: Compatible amb el flux actual - usar intent.original_instruction o options.instruction
  const instruction = intent?.original_instruction || options.instruction || sanitizedInput?.original || '';
  const language = intent?.language || sanitizedInput?.language || 'ca';
  const startTime = Date.now();

  logInfo('Executing UNIFIED v14', {
    instruction_length: instruction?.length,
    has_document: !!documentContext?.paragraphs?.length,
    provider: provider?.name || 'gemini-legacy',
    intent_mode: intent?.mode || 'none',
  });

  try {
    // Construir el prompt
    const userPrompt = buildUnifiedPrompt(instruction, documentContext, conversationContext);

    let rawResponse;
    let usage = null;

    // BYOK: Usar provider si disponible
    if (provider) {
      const result = await provider.chat(
        [{ role: 'user', content: userPrompt }],
        {
          systemPrompt: UNIFIED_SYSTEM_PROMPT,
          temperature: TEMPERATURES.chat || 0.3,
          maxTokens: 4096,
          signal,
        }
      );
      rawResponse = result.content;
      usage = result.usage;
    } else {
      // Fallback a crida directa Gemini
      rawResponse = await callGeminiUnified(userPrompt, apiKey, signal);
    }

    // Parsejar la resposta JSON
    const parsed = parseUnifiedResponse(rawResponse, documentContext);

    // Validar i calcular posicions dels highlights
    if (parsed.highlights && parsed.highlights.length > 0) {
      parsed.highlights = validateAndEnrichHighlights(parsed.highlights, documentContext);
    }

    const latency = Date.now() - startTime;

    logDebug('UNIFIED completed', {
      response_length: parsed.response?.length,
      highlights_count: parsed.highlights?.length || 0,
      changes_count: parsed.changes?.length || 0,
      latency_ms: latency,
    });

    return {
      response: parsed.response,
      highlights: parsed.highlights?.length > 0 ? parsed.highlights : null,
      changes: parsed.changes?.length > 0 ? parsed.changes : null,
      _meta: {
        executor: 'unified',
        provider: provider?.name || 'gemini',
        model: provider?.model || GEMINI.model_chat,
        tokens_input: usage?.input,
        tokens_output: usage?.output,
        latency_ms: latency,
      },
    };

  } catch (error) {
    logError('UNIFIED executor failed', { error: error.message });
    return createUnifiedErrorResponse(null, language);
  }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix el prompt per l'executor unificat
 */
function buildUnifiedPrompt(instruction, documentContext, conversationContext) {
  const parts = [];

  // Historial de conversa (si n'hi ha)
  if (conversationContext?.turns?.length > 0) {
    parts.push('## Historial recent');
    for (const turn of conversationContext.turns.slice(-3)) {
      const role = turn.role === 'user' ? 'Usuari' : 'Assistent';
      parts.push(`${role}: ${turn.content}`);
    }
    parts.push('');
  }

  // Document
  if (documentContext?.paragraphs?.length > 0) {
    parts.push('## Document');
    parts.push(formatContextForPrompt(documentContext));
    parts.push('');
  }

  // Instrucció actual
  parts.push('## Instrucció');
  parts.push(instruction || '');

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// GEMINI API CALL
// ═══════════════════════════════════════════════════════════════

/**
 * Crida a l'API de Gemini
 */
async function callGeminiUnified(userPrompt, apiKey, signal) {
  const url = `${GEMINI.base_url}/models/${GEMINI.model_chat}:generateContent?key=${apiKey}`;

  const requestBody = {
    system_instruction: {
      parts: [{ text: UNIFIED_SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: TEMPERATURES.chat || 0.3,
      topP: 0.9,
      maxOutputTokens: 4096,
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
 * Parseja la resposta JSON de la IA
 */
function parseUnifiedResponse(rawResponse, documentContext) {
  logDebug('Parsing unified response', {
    response_length: rawResponse?.length,
    preview: rawResponse?.slice(0, 200),
  });

  // Buscar JSON a la resposta
  let jsonStr = rawResponse;

  // Extreure de markdown code block si present
  const jsonMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else {
    // Buscar JSON directament
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      jsonStr = rawResponse.slice(startIdx, endIdx + 1);
    }
  }

  try {
    const parsed = JSON.parse(jsonStr);

    return {
      response: parsed.response || 'No he pogut processar la resposta.',
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    };

  } catch (error) {
    logWarn('Failed to parse JSON, using raw text', { error: error.message });

    // Fallback: usar el text cru com a resposta
    // Intentar netejar markdown o JSON parcial
    let cleanResponse = rawResponse
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .replace(/^\s*{\s*"response"\s*:\s*"/m, '')
      .replace(/"\s*,?\s*"highlights"[\s\S]*$/m, '')
      .replace(/"\s*}\s*$/m, '')
      .trim();

    // Si encara sembla JSON, agafar només la part "response"
    if (cleanResponse.startsWith('{')) {
      cleanResponse = rawResponse; // Millor mostrar el raw que trencar-ho
    }

    return {
      response: cleanResponse || 'Ho sento, no he pogut processar la resposta.',
      highlights: [],
      changes: [],
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// HIGHLIGHT VALIDATION (reutilitzat del sistema que JA FUNCIONA)
// ═══════════════════════════════════════════════════════════════

/**
 * Caràcters considerats "part de paraula" per català, castellà i anglès.
 */
const WORD_CHARS = 'a-zA-Z0-9àèéíòóúüïçñÀÈÉÍÒÓÚÜÏÇÑáéíóúÁÉÍÓÚ';

/**
 * Valida highlights i calcula posicions exactes
 */
function validateAndEnrichHighlights(highlights, documentContext) {
  if (!Array.isArray(highlights) || !documentContext?.paragraphs) {
    return [];
  }

  const validated = [];
  const usedPositions = new Map(); // per paràgraf: [{ start, end }]

  for (const h of highlights) {
    // Validar para_id
    const paraId = typeof h.para_id === 'number' ? h.para_id : parseInt(h.para_id, 10);
    if (isNaN(paraId) || paraId < 0 || paraId >= documentContext.paragraphs.length) {
      logWarn('Invalid para_id in highlight', { para_id: h.para_id });
      continue;
    }

    // Obtenir text del paràgraf
    const paragraph = documentContext.paragraphs[paraId];
    const paraText = paragraph?.text || paragraph;

    if (!paraText || !h.text) {
      continue;
    }

    // Inicialitzar tracking de posicions usades per aquest paràgraf
    if (!usedPositions.has(paraId)) {
      usedPositions.set(paraId, []);
    }
    const usedRanges = usedPositions.get(paraId);

    // Trobar posició exacta
    const position = findExactPosition(h.text, paraText, usedRanges);

    if (!position) {
      logWarn('Text not found in paragraph', {
        para_id: paraId,
        searched: h.text,
        paragraph_preview: paraText.slice(0, 100),
      });
      continue;
    }

    // Marcar posició com a usada
    usedRanges.push({ start: position.start, end: position.end });

    // Construir highlight validat
    validated.push({
      para_id: paraId,
      text: position.matched_text || h.text,
      start: position.start,
      end: position.end,
      color: h.color || 'info',
      reason: h.reason || '',
    });
  }

  logDebug('Highlights validated', {
    input: highlights.length,
    output: validated.length,
    discarded: highlights.length - validated.length,
  });

  return validated;
}

/**
 * Troba la posició exacta d'un text dins d'un paràgraf, evitant posicions ja usades
 */
function findExactPosition(searchText, paragraphText, usedRanges = []) {
  if (!searchText || !paragraphText) return null;

  const positions = findAllPositions(searchText, paragraphText);

  // Retornar la primera posició no usada
  for (const pos of positions) {
    const overlaps = usedRanges.some(
      used => !(pos.end <= used.start || pos.start >= used.end)
    );
    if (!overlaps) {
      return pos;
    }
  }

  return null;
}

/**
 * Troba TOTES les posicions d'un text dins d'un paràgraf
 */
function findAllPositions(searchText, paragraphText) {
  const positions = [];
  if (!searchText || !paragraphText) return positions;

  const isSingleWord = !/\s/.test(searchText.trim());

  // Estratègia 1: Word boundary multilingüe (per paraules úniques)
  if (isSingleWord) {
    try {
      const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = `(?<![${WORD_CHARS}])${escaped}(?![${WORD_CHARS}])`;
      const regex = new RegExp(pattern, 'gi');
      let match;
      while ((match = regex.exec(paragraphText)) !== null) {
        positions.push({
          start: match.index,
          end: match.index + match[0].length,
          matched_text: match[0],
        });
      }
      if (positions.length > 0) return positions;
    } catch (e) {
      // Lookbehind no suportat, continuar amb fallback
    }
  }

  // Estratègia 2: Substring exacte
  let idx = 0;
  while ((idx = paragraphText.indexOf(searchText, idx)) !== -1) {
    positions.push({
      start: idx,
      end: idx + searchText.length,
      matched_text: searchText,
    });
    idx += 1;
  }

  if (positions.length > 0) return positions;

  // Estratègia 3: Case-insensitive
  const lowerSearch = searchText.toLowerCase();
  const lowerPara = paragraphText.toLowerCase();
  idx = 0;
  while ((idx = lowerPara.indexOf(lowerSearch, idx)) !== -1) {
    positions.push({
      start: idx,
      end: idx + searchText.length,
      matched_text: paragraphText.slice(idx, idx + searchText.length),
    });
    idx += 1;
  }

  return positions;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  executeUnified,
  UNIFIED_SYSTEM_PROMPT,
  parseUnifiedResponse,
  validateAndEnrichHighlights,
};
