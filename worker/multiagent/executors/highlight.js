/**
 * REFERENCE_HIGHLIGHT Executor v12.1
 *
 * v12.1: Detecció de diacrítics catalans + temperatura optimitzada 0.1
 * v8.4: Word boundary multilingüe per precisió total en detecció de paraules
 *       (evita "el" dins "del", funciona amb accents: és, àrea, ç, ñ)
 *
 * Executor per destacar text al document sense modificar-lo.
 * Genera highlights amb comentaris per a:
 * - Errors ortogràfics/gramaticals
 * - Suggeriments de millora
 * - Referències a conceptes
 * - Estructures o patrons
 */

import { Mode, HighlightStrategy, createErrorResult } from '../types.js';
import { GEMINI, TIMEOUTS, TEMPERATURES } from '../config.js';
import { logInfo, logDebug, logError, logWarn } from '../telemetry.js';
import { formatContextForPrompt, formatContextForExecutor } from '../context.js';
import { isLikelyProperNoun } from '../validator.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS PER WORD BOUNDARY MULTILINGÜE
// ═══════════════════════════════════════════════════════════════

/**
 * Caràcters considerats "part de paraula" per català, castellà i anglès.
 * Inclou lletres (amb accents), números i caràcters especials comuns.
 * IMPORTANT: \b de JavaScript NO reconeix accents com a word chars!
 */
const WORD_CHARS = 'a-zA-Z0-9àèéíòóúüïçñÀÈÉÍÒÓÚÜÏÇÑáéíóúÁÉÍÓÚ';

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPTS PER ESTRATÈGIA
// ═══════════════════════════════════════════════════════════════

const HIGHLIGHT_PROMPTS = {
  errors: `DETECTOR D'ERRORS ORTOGRÀFICS
Objectiu: Trobar paraules MAL ESCRITES al document.

## QUÈ ÉS UN ERROR (la paraula ACTUAL al document està malament)
| Error real | Per què | Correcció |
|------------|---------|-----------|
| "dde" | Lletra repetida per error | "de" |
| "documentacio" | Falta accent (NO existeix sense) | "documentació" |
| "area" | Falta accent obligatori | "àrea" |
| "els casa" | Discordança de nombre | "les cases" |

## CRÍTIC: COM VERIFICAR
1. Llegir la paraula TAL COM APAREIX al document
2. Aquesta paraula EXACTA, existeix al diccionari?
   - "documentació" (amb accent) → SÍ existeix → NO és error
   - "documentacio" (sense accent) → NO existeix → SÍ és error
3. NOMÉS marcar si la paraula ACTUAL no existeix o està mal escrita

## ERRORS COMUNS A BUSCAR
- Lletres repetides: "dde", "eel", "laa"
- Accents oblidats: "area", "documentacio", "especifica"
- Faltes de tecleig: "porjecte", "documetnació"

## NO MARCAR
- Paraules que JA estan correctes (encara que tinguin accent)
- Noms propis, sigles, abreviatures
- Variants ortogràfiques vàlides

## OUTPUT
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<PARAULA EXACTA mal escrita al document>",
      "comment": "'<error>' → '<correcció>'",
      "severity": "error"
    }
  ],
  "summary": "<N errors>" | "Cap error"
}
\`\`\`

REGLA D'OR: Si la paraula al document JA és correcta, NO la marquis.`,

  suggestions: `EDITOR DE MILLORES MESURABLES
Objectiu: Identificar oportunitats de millora CONCRETES i ACCIONABLES (no errors ortogràfics).

## CRITERIS OBJECTIUS PER MARCAR
| Problema | Llindar mesurable | Exemple |
|----------|-------------------|---------|
| Frase llarga | >40 paraules sense puntuació | "La reunió que vam fer..." (45 paraules) |
| Repetició | Mateixa paraula 3+ cops en 2 frases | "important...important...important" |
| Veu passiva encadenada | 2+ passives consecutives | "va ser aprovat...fou revisat" |
| Subordinació excessiva | 3+ nivells de "que" | "que diu que creu que..." |
| Ambigüitat pronominal | "això/ho" sense referent clar | "Ho van fer però això no..." |

## QUÈ NO MARCAR
- Errors ortogràfics → usa mode "errors"
- Estil de l'autor que és coherent
- Preferències personals sense justificació objectiva
- Text tècnic que requereix precisió

## FORMAT DEL SUGGERIMENT
Cada suggeriment ha d'incloure:
1. El problema específic detectat
2. Per què és millorable (criteri objectiu)
3. Direcció de millora (sense reescriure)

## OUTPUT
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<fragment problemàtic EXACTE>",
      "comment": "[Tipus]: <descripció> → <direcció millora>",
      "severity": "suggestion"
    }
  ],
  "summary": "X oportunitats de millora identificades"
}
\`\`\`

IMPORTANT: Millor pocs suggeriments de qualitat que molts de dubtosos.`,

  references: `CERCADOR DE REFERÈNCIES CONCEPTUALS
Objectiu: Localitzar totes les mencions d'un concepte o tema al document.

## PROTOCOL
1. Identificar el concepte clau de la instrucció
2. Buscar mencions DIRECTES (la paraula exacta)
3. Buscar mencions INDIRECTES (sinònims, pronoms referents)
4. Ordenar per ordre d'aparició

## TIPUS DE COINCIDÈNCIES
- EXACTA: El terme tal qual apareix
- VARIANT: Formes flexionades (singular/plural, masculí/femení)
- SINÒNIM: Paraules equivalents en context
- REFERÈNCIA: Pronoms que clarament es refereixen al terme

## OUTPUT
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<text EXACTE al document>",
      "comment": "[Exacta|Variant|Sinònim|Referència]: <breu context>",
      "severity": "info"
    }
  ],
  "summary": "X mencions de '<concepte>' trobades"
}
\`\`\``,

  structure: `ANALISTA D'ESTRUCTURA DOCUMENTAL
Objectiu: Identificar i categoritzar elements estructurals del document.

## TAXONOMIA D'ELEMENTS
| Element | Indicadors | Color suggerit |
|---------|------------|----------------|
| Títol/Heading | Línia curta, sense punt final, majúscules | purple |
| Introducció | Primer paràgraf, presenta tema | blue |
| Tesi/Argument | "considero que", "l'objectiu és" | purple |
| Evidència | Dades, cites, "segons" | blue |
| Transició | "per altra banda", "en canvi" | info |
| Conclusió | "en conclusió", "per tant", últim paràgraf | purple |
| Llista | Numeració, guions, punts | info |

## PROTOCOL
1. Llegir tot el document primer
2. Identificar estructura macro (intro/cos/conclusió)
3. Marcar elements micro dins de cada secció
4. Verificar coherència estructural

## OUTPUT
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<element estructural EXACTE>",
      "comment": "[Tipus]: <funció en el document>",
      "severity": "info"
    }
  ],
  "summary": "Estructura: [tipus de document]. Seccions: [llista]"
}
\`\`\``,

  mentions: `Ets un cercador de text. La teva ÚNICA tasca és trobar mencions d'una paraula o frase específica.

## INSTRUCCIONS CRÍTIQUES
1. PRIMER: Identifica el terme exacte que l'usuari vol buscar (normalment entre cometes: "terme" o 'terme')
2. SEGON: Busca TOTES les ocurrències EXACTES d'aquest terme al document
3. TERCER: Retorna cada ocurrència com un highlight

## EXEMPLES D'EXTRACCIÓ DEL TERME
- "buscar la paraula 'la'" → terme a buscar: "la"
- "on apareix "projecte"" → terme a buscar: "projecte"
- "buscar 'PAE'" → terme a buscar: "PAE"
- "trobar mencions de Tortosa" → terme a buscar: "Tortosa"

## MOLT IMPORTANT
- El terme a buscar és el que l'usuari escriu ENTRE COMETES
- Si l'usuari diu "buscar la paraula 'la'", has de buscar "la", NO "paraula"
- Busca el terme TAL QUAL, case-sensitive si és possible
- NO facis anàlisi d'errors, correccions ni suggeriments
- NO substitueixis el terme per un altre

## Format de sortida
\`\`\`json
{
  "search_term": "<el terme exacte que s'ha buscat>",
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<el terme exacte que apareix al paràgraf>",
      "comment": "Ocurrència trobada",
      "severity": "info"
    }
  ],
  "summary": "S'han trobat X ocurrències de 'terme'"
}
\`\`\``,

  all: `REVISOR INTEGRAL CONSERVADOR
Objectiu: Revisió completa prioritzant precisió sobre exhaustivitat.

## JERARQUIA DE SEVERITATS (usar correctament)
| Severity | Criteri | Exemples |
|----------|---------|----------|
| error | Paraula inexistent al diccionari, discordança gramatical | "increiblement", "els casa" |
| suggestion | Problema mesurable de claredat | Frase >40 paraules, repetició 3+ cops |
| info | Element estructural o informatiu | Títols, conclusions, referències |

## LÍMITS MÀXIMS
- Errors: Només els INEQUÍVOCS (màxim ~5 per document típic)
- Suggeriments: Només els més impactants (màxim ~5)
- Info: Estructura principal (màxim ~3)

## PROTOCOL DE REVISIÓ
1. PRIMERA PASSADA: Errors ortogràfics evidents (paraules inexistents)
2. SEGONA PASSADA: Problemes de claredat mesurables
3. TERCERA PASSADA: Estructura i organització

## LLISTA DE FALSOS POSITIUS (NO MARCAR)
- Noms propis, sigles, abreviatures
- Majúscules en càrrecs/institucions
- Estil coherent de l'autor
- Coses que JA ESTAN CORRECTES

## OUTPUT
\`\`\`json
{
  "highlights": [
    {
      "paragraph_id": <número>,
      "text_to_highlight": "<text EXACTE>",
      "comment": "<problema específic>",
      "severity": "error|suggestion|info"
    }
  ],
  "summary": "Revisió: X errors, Y suggeriments, Z elements estructurals"
}
\`\`\`

IMPORTANT: Preferir qualitat sobre quantitat. Si el document està bé, dir-ho.`,
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

    // v12.1: Filtrar noms propis per reduir falsos positius
    const filteredHighlights = filterProperNounHighlights(validatedHighlights, documentContext);

    logDebug('REFERENCE_HIGHLIGHT completed', {
      total_highlights: filteredHighlights.length,
      filtered_proper_nouns: validatedHighlights.length - filteredHighlights.length,
      by_severity: countBySeverity(filteredHighlights),
    });

    // Construir resposta de chat
    const chatResponse = buildHighlightChatResponse(
      filteredHighlights,
      parsedResponse.summary,
      strategy,
      language
    );

    return {
      mode: Mode.REFERENCE_HIGHLIGHT,
      highlights: filteredHighlights,
      chat_response: chatResponse,
      _meta: {
        executor: 'highlight',
        strategy,
        total_found: filteredHighlights.length,
        paragraphs_analyzed: targetParagraphs.length,
        proper_nouns_filtered: validatedHighlights.length - filteredHighlights.length,
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
    .map(p => `§${p.id + 1}: ${p.text}`)  // v12.1: 1-indexed per consistència UI
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
  const url = `${GEMINI.base_url}/models/${GEMINI.model_highlight}:generateContent?key=${apiKey}`;

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
      temperature: TEMPERATURES.highlight,  // v12.1: 0.1 per reduir falsos positius
      topP: 0.8,
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
 * Parseja la resposta de Gemini
 */
function parseHighlightResponse(responseText, documentContext) {
  logInfo('🔍 [DEBUG] parseHighlightResponse ENTRADA', {
    responseText_length: responseText?.length,
    responseText_preview: responseText?.slice(0, 300)
  });

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

    logInfo('🔍 [DEBUG] parseHighlightResponse ÈXIT', {
      highlights_count: parsed.highlights?.length || 0,
      highlights_detail: parsed.highlights?.map(h => ({
        text: h.text_to_highlight,
        para_id: h.paragraph_id,
        severity: h.severity
      })),
      summary: parsed.summary?.slice(0, 100)
    });

    return {
      highlights: parsed.highlights || [],
      summary: parsed.summary || '',
    };
  } catch (error) {
    logWarn('🔍 [DEBUG] parseHighlightResponse ERROR JSON', {
      error: error.message,
      jsonStr_preview: jsonStr?.slice(0, 200)
    });
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
      const paraId = parseInt(idMatch[1], 10);  // 1-indexed from LLM (§1, §2...)
      // v12.1: Check 1-indexed bounds (1 to length inclusive)
      if (paraId > 0 && paraId <= documentContext.paragraphs.length) {
        highlights.push({
          paragraph_id: paraId,  // Keep 1-indexed, validateHighlights will convert
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
 * Valida, filtra i calcula posicions exactes per als highlights
 * Gestiona múltiples ocurrències de la mateixa paraula al mateix paràgraf
 * @param {Array} highlights - Highlights retornats per l'AI
 * @param {Object} documentContext - Context del document
 * @returns {Array} - Highlights validats amb start/end exactes
 */
function validateHighlights(highlights, documentContext) {
  // DEBUG: Log entrada
  logInfo('🔍 [DEBUG] validateHighlights ENTRADA', {
    highlights_rebuts: highlights?.length || 0,
    es_array: Array.isArray(highlights),
    primers_highlights: highlights?.slice(0, 3).map(h => ({
      text: h.text_to_highlight,
      para: h.paragraph_id
    }))
  });

  if (!Array.isArray(highlights)) {
    logWarn('🔍 [DEBUG] highlights NO és array!', { tipus: typeof highlights });
    return [];
  }

  const validated = [];

  // Seguiment de posicions ja usades per paràgraf: { paraId: [usedRanges] }
  const usedPositions = new Map();

  let index = 0;
  for (const h of highlights) {
    index++;
    logInfo(`🔍 [DEBUG] Processant highlight ${index}/${highlights.length}`, {
      text_to_highlight: h.text_to_highlight,
      paragraph_id: h.paragraph_id,
      comment: h.comment?.slice(0, 50)
    });

    // Validar paragraph_id (v12.1: LLM retorna 1-indexed, convertim a 0-indexed)
    const rawParaId = h.paragraph_id ?? h.para_id;
    const paraId = rawParaId - 1;  // v12.1: 1-indexed → 0-indexed
    if (typeof paraId !== 'number' ||
        paraId < 0 ||
        paraId >= documentContext.paragraphs.length) {
      logWarn(`🔍 [DEBUG] ❌ Highlight ${index}: paragraph_id INVÀLID`, {
        id: paraId,
        total_paragraphs: documentContext.paragraphs.length
      });
      continue;
    }

    // Obtenir text del paràgraf
    const paragraph = documentContext.paragraphs[paraId];
    const paraText = paragraph.text || paragraph;

    logDebug(`🔍 [DEBUG] Highlight ${index}: paràgraf obtingut`, {
      paraText_length: paraText?.length,
      paraText_preview: paraText?.slice(0, 80)
    });

    // Obtenir posicions ja usades per aquest paràgraf
    if (!usedPositions.has(paraId)) {
      usedPositions.set(paraId, []);
    }
    const usedRanges = usedPositions.get(paraId);

    // Calcular posicions exactes, evitant posicions ja usades
    const position = findExactPositionAvoidingUsed(h.text_to_highlight, paraText, usedRanges);

    if (!position) {
      logWarn(`🔍 [DEBUG] ❌ Highlight ${index}: TEXT NO TROBAT`, {
        paragraph_id: paraId,
        searched: h.text_to_highlight,
        paragraph_text: paraText?.slice(0, 150),
        usedRanges_count: usedRanges.length,
        usedRanges: usedRanges
      });
      continue;
    }

    logInfo(`🔍 [DEBUG] ✅ Highlight ${index}: TROBAT`, {
      text: h.text_to_highlight,
      position: position,
      match_type: position._meta?.match_type
    });

    // Marcar aquesta posició com a usada
    usedRanges.push({ start: position.start, end: position.end });

    // Validar severity
    const severity = ['error', 'suggestion', 'info'].includes(h.severity)
      ? h.severity
      : 'info';

    // Construir highlight amb format correcte (para_id, start, end)
    validated.push({
      para_id: paraId,
      start: position.start,
      end: position.end,
      color: severityToColor(severity),
      reason: h.comment || '',
      severity,
      matched_text: position.matched_text,
      _meta: position._meta || {},
    });
  }

  // DEBUG: Log sortida
  logInfo('🔍 [DEBUG] validateHighlights SORTIDA', {
    highlights_entrada: highlights.length,
    highlights_validats: validated.length,
    highlights_descartats: highlights.length - validated.length,
    validated_preview: validated.slice(0, 3).map(v => ({
      text: v.matched_text,
      start: v.start,
      end: v.end,
      para: v.para_id
    }))
  });

  return validated;
}

/**
 * Comprova si un rang es solapa amb algun dels rangs usats
 */
function rangeOverlapsUsed(start, end, usedRanges) {
  for (const used of usedRanges) {
    // Solapament: no (end <= used.start || start >= used.end)
    if (!(end <= used.start || start >= used.end)) {
      return true;
    }
  }
  return false;
}

/**
 * Troba la posició exacta evitant posicions ja usades
 */
function findExactPositionAvoidingUsed(searchText, paragraphText, usedRanges) {
  if (!searchText || !paragraphText) {
    logDebug('🔍 [DEBUG] findExactPositionAvoidingUsed: input buit', {
      hasSearch: !!searchText,
      hasPara: !!paragraphText
    });
    return null;
  }

  // Buscar TOTES les ocurrències i retornar la primera no usada
  const allPositions = findAllPositions(searchText, paragraphText);

  logDebug('🔍 [DEBUG] findExactPositionAvoidingUsed', {
    searchText: searchText,
    allPositions_count: allPositions.length,
    allPositions: allPositions.map(p => ({ start: p.start, end: p.end, type: p._meta?.match_type })),
    usedRanges: usedRanges
  });

  for (const pos of allPositions) {
    const overlaps = rangeOverlapsUsed(pos.start, pos.end, usedRanges);
    logDebug('🔍 [DEBUG] Checking position', {
      pos_start: pos.start,
      pos_end: pos.end,
      overlaps: overlaps
    });
    if (!overlaps) {
      return pos;
    }
  }

  return null;
}

/**
 * Troba TOTES les posicions d'un text dins d'un paràgraf
 *
 * LÒGICA v8.4: Per paraules úniques, usa word boundary PRIMER per evitar
 * falsos positius (ex: "el" dins "del"). Fallback a substring si no troba.
 *
 * @param {string} searchText - Text a buscar
 * @param {string} paragraphText - Text del paràgraf
 * @returns {Array} - Array de { start, end, matched_text, _meta }
 */
function findAllPositions(searchText, paragraphText) {
  const positions = [];
  if (!searchText || !paragraphText) return positions;

  // Determinar si és una paraula única (sense espais)
  const isSingleWord = !/\s/.test(searchText.trim());

  // ═══════════════════════════════════════════════════════════════
  // ESTRATÈGIA 1: WORD BOUNDARY MULTILINGÜE (prioritària per paraules)
  // Evita trobar "el" dins "del", "cel", etc.
  // Funciona amb accents: és, àrea, ñ, ç
  // ═══════════════════════════════════════════════════════════════
  if (isSingleWord) {
    try {
      const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Lookbehind/lookahead negatius per caràcters de paraula multilingües
      const pattern = `(?<![${WORD_CHARS}])${escaped}(?![${WORD_CHARS}])`;
      const regex = new RegExp(pattern, 'gi');
      let match;
      while ((match = regex.exec(paragraphText)) !== null) {
        positions.push({
          start: match.index,
          end: match.index + match[0].length,
          matched_text: match[0],
          _meta: { match_type: 'word_boundary_multilingual' }
        });
      }
      // Si trobem amb word boundary, retornar (és el resultat més precís)
      if (positions.length > 0) {
        logDebug('findAllPositions: word boundary match', {
          search: searchText,
          found: positions.length
        });
        return positions;
      }
    } catch (e) {
      // Si el regex falla (navegadors antics sense lookbehind), continuar
      logDebug('findAllPositions: lookbehind not supported, using fallback');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ESTRATÈGIA 2: SUBSTRING EXACTE (per frases o fallback)
  // ═══════════════════════════════════════════════════════════════
  let idx = 0;
  while ((idx = paragraphText.indexOf(searchText, idx)) !== -1) {
    positions.push({
      start: idx,
      end: idx + searchText.length,
      matched_text: searchText,
      _meta: { match_type: 'exact_substring' }
    });
    idx += 1;
  }

  if (positions.length > 0) return positions;

  // ═══════════════════════════════════════════════════════════════
  // ESTRATÈGIA 3: CASE-INSENSITIVE (últim recurs)
  // ═══════════════════════════════════════════════════════════════
  const lowerSearch = searchText.toLowerCase();
  const lowerPara = paragraphText.toLowerCase();
  idx = 0;
  while ((idx = lowerPara.indexOf(lowerSearch, idx)) !== -1) {
    const matched = paragraphText.slice(idx, idx + searchText.length);
    positions.push({
      start: idx,
      end: idx + searchText.length,
      matched_text: matched,
      _meta: { match_type: 'case_insensitive' }
    });
    idx += 1;
  }

  return positions;
}

/**
 * Converteix severity a nom de color (compatible amb REFERENCE_COLORS del frontend)
 * Frontend colors: yellow (atenció), orange (problemes), blue (recomanacions), purple (clarificacions)
 */
function severityToColor(severity) {
  const colors = {
    error: 'orange',       // Problemes/errors → taronja
    suggestion: 'blue',    // Recomanacions → blau
    info: 'purple',        // Informació/clarificacions → lila
  };
  return colors[severity] || 'yellow';
}

// ═══════════════════════════════════════════════════════════════
// v12.1: DETECCIÓ DE DIACRÍTICS CATALANS I NOMS PROPIS
// ═══════════════════════════════════════════════════════════════

/**
 * Paraules amb diacrítics que sovint són falsos positius
 * Format: paraula sense accent → paraula correcta amb accent
 * Si la paraula apareix amb accent JA és correcta, no marcar
 */
const CATALAN_DIACRITIC_WORDS = {
  // Accent diacrític (no canvia significat, només marca tònica)
  'area': 'àrea',
  'telefon': 'telèfon',
  'pagina': 'pàgina',
  'musica': 'música',
  'numero': 'número',
  'ultim': 'últim',
  'public': 'públic',
  'unic': 'únic',
  'interes': 'interès',
  'frances': 'francès',
  'angles': 'anglès',
  // Sovint confosos
  'projecte': null,  // JA és correcte, no té accent
  'document': null,  // JA és correcte
  'periode': 'període',
  'caracter': 'caràcter',
  'dificil': 'difícil',
  'facil': 'fàcil',
  'util': 'útil',
};

/**
 * Filtra highlights que són falsos positius de noms propis
 * Un nom propi NO s'ha de marcar com a error de diacrítics
 *
 * @param {Array} highlights - Highlights validats
 * @param {Object} documentContext - Context del document
 * @returns {Array} - Highlights filtrats
 */
function filterProperNounHighlights(highlights, documentContext) {
  if (!highlights || !highlights.length) return [];

  const fullDocText = documentContext.paragraphs
    .map(p => p.text || p)
    .join(' ');

  return highlights.filter(h => {
    // Només filtrar errors de diacrítics/accents
    if (h.severity !== 'error') return true;

    // Comprovar si el comentari parla de diacrítics o accents
    const comment = (h.reason || '').toLowerCase();
    const isDiacriticError = comment.includes('accent') ||
                             comment.includes('diacrític') ||
                             comment.includes('diacrit') ||
                             comment.includes('majúscula') ||
                             comment.includes('→');

    if (!isDiacriticError) return true;

    // Obtenir el text marcat
    const matchedText = h.matched_text || '';
    if (!matchedText) return true;

    // Obtenir el text del paràgraf
    const paragraph = documentContext.paragraphs[h.para_id];
    const paraText = paragraph?.text || paragraph || '';

    // Comprovar si és un nom propi
    const words = matchedText.split(/\s+/);
    for (const word of words) {
      if (/^[A-ZÁÉÍÓÚÀÈÒÙÏÜÇ]/.test(word)) {
        // Paraula amb majúscula - potser és nom propi
        if (isLikelyProperNoun(word, paraText, fullDocText)) {
          logDebug('Highlight filtrat: possible nom propi', {
            word,
            para_id: h.para_id,
            reason: h.reason,
          });
          return false;  // Filtrar aquest highlight
        }
      }
    }

    return true;  // Mantenir el highlight
  });
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
