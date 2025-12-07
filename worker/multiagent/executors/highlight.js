/**
 * REFERENCE_HIGHLIGHT Executor v8.3
 *
 * Executor per destacar text al document sense modificar-lo.
 * Genera highlights amb comentaris per a:
 * - Errors ortogràfics/gramaticals
 * - Suggeriments de millora
 * - Referències a conceptes
 * - Estructures o patrons
 */

import { Mode, HighlightStrategy, createErrorResult } from '../types.js';
import { GEMINI, TIMEOUTS } from '../config.js';
import { logInfo, logDebug, logError, logWarn } from '../telemetry.js';
import { formatContextForPrompt, formatContextForExecutor } from '../context.js';

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPTS PER ESTRATÈGIA
// ═══════════════════════════════════════════════════════════════

const HIGHLIGHT_PROMPTS = {
  errors: `Ets un corrector lingüístic expert en català, castellà i anglès.
La teva tasca és identificar ERRORS ortogràfics, gramaticals i de puntuació.

## Què buscar
- Faltes d'ortografia
- Errors gramaticals (concordança, temps verbals, etc.)
- Puntuació incorrecta
- Errors de majúscules/minúscules
- Paraules mal escrites o confoses (ex: "a" vs "ha")

## Què NO marcar
- Estil (això no és un error)
- Preferències personals
- Formes alternatives vàlides

## Format de sortida
Retorna un JSON array amb els errors trobats:
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<text exacte a destacar>",
      "comment": "<explicació de l'error i correcció>",
      "severity": "error"
    }
  ],
  "summary": "<resum breu del que s'ha trobat>"
}
\`\`\`

IMPORTANT: El "text_to_highlight" ha de ser text EXACTE que existeix al paràgraf.`,

  suggestions: `Ets un editor professional expert en millorar textos.
La teva tasca és identificar OPORTUNITATS DE MILLORA (no errors).

## Què buscar
- Frases massa llargues o confuses
- Repeticions de paraules
- Expressions que es podrien simplificar
- Oportunitats per millorar la claredat
- To inconsistent

## Què NO marcar
- Errors ortogràfics (això és altra categoria)
- Coses que ja estan bé

## Format de sortida
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<text exacte a destacar>",
      "comment": "<suggeriment de millora>",
      "severity": "suggestion"
    }
  ],
  "summary": "<resum breu>"
}
\`\`\``,

  references: `Ets un assistent que identifica referències a conceptes específics.
L'usuari t'indicarà què buscar i tu has de trobar-ho al document.

## Format de sortida
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<text exacte trobat>",
      "comment": "<context o explicació>",
      "severity": "info"
    }
  ],
  "summary": "<resum del que s'ha trobat>"
}
\`\`\``,

  structure: `Ets un analista d'estructura de documents.
La teva tasca és identificar elements estructurals:
- Títols i subtítols
- Llistes
- Definicions
- Conclusions
- Arguments principals

## Format de sortida
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<text exacte>",
      "comment": "<tipus d'element estructural>",
      "severity": "info"
    }
  ],
  "summary": "<resum de l'estructura>"
}
\`\`\``,

  all: `Ets un revisor complet de documents.
Fes una revisió completa identificant:
1. Errors ortogràfics i gramaticals (severity: "error")
2. Suggeriments de millora (severity: "suggestion")
3. Elements estructurals importants (severity: "info")

## Format de sortida
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<text exacte>",
      "comment": "<comentari>",
      "severity": "error|suggestion|info"
    }
  ],
  "summary": "<resum general>"
}
\`\`\``,
};

// ═══════════════════════════════════════════════════════════════
// EXECUTOR IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Executa una petició REFERENCE_HIGHLIGHT
 *
 * @param {Object} intent - Intent classificat
 * @param {Object} documentContext - Context del document
 * @param {Object} conversationContext - Context de conversa
 * @param {Object} options - Opcions d'execució
 * @returns {Promise<Object>} - Resultat amb highlights
 */
async function executeReferenceHighlight(intent, documentContext, conversationContext, options = {}) {
  const { apiKey, signal } = options;
  const language = intent.language || 'ca';
  const strategy = intent.highlight_strategy || HighlightStrategy.ALL;

  logInfo('Executing REFERENCE_HIGHLIGHT', {
    strategy,
    target_paragraphs: intent.target_paragraphs?.length || 'all',
    has_entities: !!intent.entities?.length,
  });

  // Validar que tenim document
  if (!documentContext?.paragraphs?.length) {
    return createNoDocumentResponse(language);
  }

  try {
    // Determinar paràgrafs a analitzar
    const targetParagraphs = intent.target_paragraphs?.length > 0
      ? intent.target_paragraphs
      : documentContext.paragraphs.map((_, i) => i);

    // Construir prompt segons estratègia
    const { systemPrompt, userPrompt } = buildHighlightPrompt(
      strategy,
      intent,
      documentContext,
      targetParagraphs
    );

    // Cridar Gemini
    const response = await callGeminiHighlight(systemPrompt, userPrompt, apiKey, signal);

    // Parsejar i validar resposta
    const parsedResponse = parseHighlightResponse(response, documentContext);

    // Verificar highlights
    const validatedHighlights = validateHighlights(parsedResponse.highlights, documentContext);

    logDebug('REFERENCE_HIGHLIGHT completed', {
      total_highlights: validatedHighlights.length,
      by_severity: countBySeverity(validatedHighlights),
    });

    // Construir resposta de chat
    const chatResponse = buildHighlightChatResponse(
      validatedHighlights,
      parsedResponse.summary,
      strategy,
      language
    );

    return {
      mode: Mode.REFERENCE_HIGHLIGHT,
      highlights: validatedHighlights,
      chat_response: chatResponse,
      _meta: {
        executor: 'highlight',
        strategy,
        total_found: validatedHighlights.length,
        paragraphs_analyzed: targetParagraphs.length,
      },
    };

  } catch (error) {
    logError('REFERENCE_HIGHLIGHT executor failed', { error: error.message });
    return createErrorResponse(error, language);
  }
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix els prompts per a l'highlight
 */
function buildHighlightPrompt(strategy, intent, documentContext, targetParagraphs) {
  const systemPrompt = HIGHLIGHT_PROMPTS[strategy] || HIGHLIGHT_PROMPTS.all;

  const parts = [];

  // Instrucció original de l'usuari
  parts.push('## Instrucció de l\'usuari');
  parts.push(intent.original_instruction || 'Revisa el document');
  parts.push('');

  // Entitats a buscar (per strategy=references)
  if (intent.entities?.length > 0) {
    parts.push('## Conceptes a buscar');
    parts.push(intent.entities.join(', '));
    parts.push('');
  }

  // Document (només paràgrafs target)
  parts.push('## Document a analitzar');
  const filteredParagraphs = documentContext.paragraphs
    .filter(p => targetParagraphs.includes(p.id))
    .map(p => `§${p.id}: ${p.text}`)
    .join('\n');
  parts.push(filteredParagraphs);

  return {
    systemPrompt,
    userPrompt: parts.join('\n'),
  };
}

// ═══════════════════════════════════════════════════════════════
// GEMINI API CALL
// ═══════════════════════════════════════════════════════════════

/**
 * Crida Gemini per generar highlights
 */
async function callGeminiHighlight(systemPrompt, userPrompt, apiKey, signal) {
  const url = `${GEMINI.base_url}/${GEMINI.model_executor}:generateContent?key=${apiKey}`;

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
      temperature: 0.3, // Més determinístic per a detecció d'errors
      topP: 0.8,
      maxOutputTokens: 2048,
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
function parseHighlightResponse(responseText, documentContext) {
  // Buscar JSON a la resposta
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  let jsonStr = jsonMatch ? jsonMatch[1] : responseText;

  // Intentar parsejar directament si no hi ha markdown
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
      highlights: parsed.highlights || [],
      summary: parsed.summary || '',
    };
  } catch (error) {
    logWarn('Failed to parse highlight response as JSON', { error: error.message });
    // Intentar extreure highlights manualment
    return extractHighlightsFromText(responseText, documentContext);
  }
}

/**
 * Extreu highlights del text si el JSON falla
 */
function extractHighlightsFromText(text, documentContext) {
  const highlights = [];

  // Patró simple per trobar mencions de paràgrafs i errors
  const paragraphMentions = text.match(/§(\d+)[:\s]+[^§]+/g) || [];

  for (const mention of paragraphMentions) {
    const idMatch = mention.match(/§(\d+)/);
    if (idMatch) {
      const paraId = parseInt(idMatch[1], 10);
      if (paraId < documentContext.paragraphs.length) {
        highlights.push({
          paragraph_id: paraId,
          text_to_highlight: '',  // No podem extreure sense JSON
          comment: mention.replace(/§\d+[:\s]+/, '').trim(),
          severity: 'info',
        });
      }
    }
  }

  return {
    highlights,
    summary: 'Resposta processada parcialment',
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Valida i filtra highlights
 */
function validateHighlights(highlights, documentContext) {
  if (!Array.isArray(highlights)) return [];

  const validated = [];

  for (const h of highlights) {
    // Validar paragraph_id
    if (typeof h.paragraph_id !== 'number' ||
        h.paragraph_id < 0 ||
        h.paragraph_id >= documentContext.paragraphs.length) {
      logWarn('Invalid highlight paragraph_id', { id: h.paragraph_id });
      continue;
    }

    // Validar text_to_highlight existeix al paràgraf
    const paragraph = documentContext.paragraphs[h.paragraph_id];
    const paraText = paragraph.text || paragraph;

    if (h.text_to_highlight && !paraText.includes(h.text_to_highlight)) {
      // Intentar trobar coincidència parcial
      const correctedText = findPartialMatch(h.text_to_highlight, paraText);
      if (correctedText) {
        h.text_to_highlight = correctedText;
        h._meta = { corrected: true };
      } else {
        logWarn('Highlight text not found in paragraph', {
          paragraph_id: h.paragraph_id,
          text: h.text_to_highlight?.slice(0, 50),
        });
        // Marcar tot el paràgraf si no trobem el text
        h.text_to_highlight = paraText.slice(0, 100);
        h._meta = { full_paragraph: true };
      }
    }

    // Validar severity
    if (!['error', 'suggestion', 'info'].includes(h.severity)) {
      h.severity = 'info';
    }

    validated.push(h);
  }

  return validated;
}

/**
 * Busca coincidència parcial tolerant a espais
 */
function findPartialMatch(searchText, fullText) {
  // Normalitzar espais
  const normalizedSearch = searchText.replace(/\s+/g, ' ').trim();
  const normalizedFull = fullText.replace(/\s+/g, ' ');

  if (normalizedFull.includes(normalizedSearch)) {
    // Trobar la posició al text original
    const idx = normalizedFull.indexOf(normalizedSearch);
    return fullText.slice(idx, idx + normalizedSearch.length);
  }

  // Buscar sense accents
  const noAccentsSearch = removeAccents(normalizedSearch);
  const noAccentsFull = removeAccents(normalizedFull);

  if (noAccentsFull.includes(noAccentsSearch)) {
    const idx = noAccentsFull.indexOf(noAccentsSearch);
    // Retornar el text original amb accents
    let count = 0;
    let start = 0;
    for (let i = 0; i < fullText.length && count < idx; i++) {
      if (!/\s/.test(fullText[i]) || !/\s/.test(fullText[i - 1])) {
        count++;
        start = i;
      }
    }
    return fullText.slice(start, start + searchText.length + 10);
  }

  return null;
}

function removeAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix la resposta de chat pels highlights
 */
function buildHighlightChatResponse(highlights, summary, strategy, language) {
  const count = highlights.length;
  const errorCount = highlights.filter(h => h.severity === 'error').length;
  const suggestionCount = highlights.filter(h => h.severity === 'suggestion').length;

  const templates = {
    ca: {
      none: "No he trobat cap element a destacar.",
      errors_only: `He trobat ${errorCount} error${errorCount !== 1 ? 's' : ''} que he marcat al document.`,
      suggestions_only: `He identificat ${suggestionCount} suggeriment${suggestionCount !== 1 ? 's' : ''} de millora.`,
      mixed: `He revisat el document: ${errorCount} error${errorCount !== 1 ? 's' : ''} i ${suggestionCount} suggeriment${suggestionCount !== 1 ? 's' : ''}.`,
      with_summary: summary ? `\n\n${summary}` : '',
    },
    es: {
      none: "No he encontrado ningún elemento a destacar.",
      errors_only: `He encontrado ${errorCount} error${errorCount !== 1 ? 'es' : ''} que he marcado en el documento.`,
      suggestions_only: `He identificado ${suggestionCount} sugerencia${suggestionCount !== 1 ? 's' : ''} de mejora.`,
      mixed: `He revisado el documento: ${errorCount} error${errorCount !== 1 ? 'es' : ''} y ${suggestionCount} sugerencia${suggestionCount !== 1 ? 's' : ''}.`,
      with_summary: summary ? `\n\n${summary}` : '',
    },
    en: {
      none: "I didn't find any elements to highlight.",
      errors_only: `I found ${errorCount} error${errorCount !== 1 ? 's' : ''} that I've marked in the document.`,
      suggestions_only: `I identified ${suggestionCount} improvement suggestion${suggestionCount !== 1 ? 's' : ''}.`,
      mixed: `I've reviewed the document: ${errorCount} error${errorCount !== 1 ? 's' : ''} and ${suggestionCount} suggestion${suggestionCount !== 1 ? 's' : ''}.`,
      with_summary: summary ? `\n\n${summary}` : '',
    },
  };

  const t = templates[language] || templates.ca;

  if (count === 0) return t.none;
  if (errorCount > 0 && suggestionCount === 0) return t.errors_only + t.with_summary;
  if (suggestionCount > 0 && errorCount === 0) return t.suggestions_only + t.with_summary;
  return t.mixed + t.with_summary;
}

function countBySeverity(highlights) {
  return highlights.reduce((acc, h) => {
    acc[h.severity] = (acc[h.severity] || 0) + 1;
    return acc;
  }, {});
}

// ═══════════════════════════════════════════════════════════════
// ERROR RESPONSES
// ═══════════════════════════════════════════════════════════════

function createNoDocumentResponse(language) {
  const messages = {
    ca: "No tinc cap document carregat per revisar.",
    es: "No tengo ningún documento cargado para revisar.",
    en: "I don't have any document loaded to review.",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: { executor: 'highlight', error: 'no_document' },
  };
}

function createErrorResponse(error, language) {
  const messages = {
    ca: "Ho sento, he tingut un problema revisant el document. Torna a provar.",
    es: "Lo siento, he tenido un problema revisando el documento. Vuelve a intentarlo.",
    en: "Sorry, I had a problem reviewing the document. Please try again.",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: {
      executor: 'highlight',
      error: error.message,
      fallback: true,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export { executeReferenceHighlight };
