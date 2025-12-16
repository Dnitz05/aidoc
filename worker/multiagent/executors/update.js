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

import { Mode, ActionType, generateItemId } from '../types.js';
import { GEMINI, TIMEOUTS, TEMPERATURES } from '../config.js';
import { logInfo, logDebug, logError, logWarn } from '../telemetry.js';
import { formatContextForExecutor } from '../context.js';
import { sha256Sync, validateChangesV14 } from '../validator.js';

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPTS PER TIPUS
// ═══════════════════════════════════════════════════════════════

const UPDATE_PROMPTS = {
  // v12.1: Prompt FIX amb Context Anchors per Find/Replace natiu
  fix: `CORRECTOR QUIRÚRGIC (Mode Find/Replace v12.1)
Objectiu: Corregir errors ortogràfics amb canvis MÍNIMS i ATÒMICS.

## ⚠️ FORMAT DE SORTIDA CRÍTIC
Retorna parells find/replace, NO el text complet del paràgraf.
El camp "find" HA DE SER ÚNIC dins del paràgraf.

## REGLES FIND/REPLACE

### Regla 1: Context Anchors (Ancoratge)
Si l'error és una paraula comuna, INCLOU 2-3 paraules de context per assegurar unicitat:
❌ find: "projecte" (pot aparèixer múltiples vegades)
✅ find: "del projecte PAE" → "del Projecte PAE" (únic)

❌ find: "mes" (ambigu)
✅ find: "vull mes temps" → "vull més temps" (únic amb context)

### Regla 2: Agrupació d'Errors Adjacents (Chunking)
Si hi ha errors separats per menys de 3 paraules, AGRUPA'LS en un sol canvi:
Text: "La documentacio dde l'area metropolitana"
❌ 3 canvis separats (risc de conflicte d'índexs)
✅ find: "documentacio dde l'area", replace: "documentació de l'àrea"

### Regla 3: Verificació Pre-Output
Abans de retornar cada canvi, VERIFICA MENTALMENT:
1. El "find" apareix EXACTAMENT UNA vegada al paràgraf? → Si no, afegir context
2. El "replace" té la mateixa longitud ±10%? → Si no, potser és "improve"
3. L'error és OBJECTIU (no estilístic)? → Si no, no corregir

## ERRORS A CORREGIR
- Lletres repetides: "dde" → "de", "laa" → "la", "quee" → "que"
- Accents oblidats: "area" → "àrea", "documentacio" → "documentació"
- Concordança evident: "els casa" → "les cases"
- Typos comuns: "tembé" → "també", "peró" → "però"

## NO CORREGIR
- Noms propis (majúscula a mig de frase): Joan, Barcelona, PAE
- Sigles i acrònims: PAE, DOGC, API, URL
- Estil o preferències (això és "improve", no "fix")
- Paraules tècniques desconegudes

## ACCENTS DIACRÍTICS CATALANS (ATENCIÓ ESPECIAL)
Parells ambigus on ambdues formes existeixen:
| Sense | Amb | Exemple sense | Exemple amb |
|-------|-----|---------------|-------------|
| te | té | "te verd" (planta) | "ell té raó" (verb) |
| mes | més | "fa uns mesos" | "vull més" |
| dona | dóna | "una dona" (femella) | "li dóna" (verb) |
| sol | sòl | "el sol" (astre) | "el sòl" (terra) |

PROTOCOL:
- Si el context és 100% CLAR → Corregir
- Si hi ha QUALSEVOL DUBTE → NO corregir (millor no tocar que equivocar-se)

## OUTPUT JSON
\`\`\`json
{
  "response": "<resposta breu i natural a l'usuari sobre què has fet/trobat>",
  "changes": [
    {
      "paragraph_id": <número>,
      "find": "<text únic amb context si cal>",
      "replace": "<text corregit>",
      "reason": "typo|accent|grammar|diacritic"
    }
  ]
}
\`\`\`

El camp "response" ha de ser una frase natural i breu (1-2 frases) que respongui a la petició de l'usuari.
Exemples: "He revisat el text i he trobat 3 errors ortogràfics.", "Tot correcte! No he detectat cap error."

Si no hi ha errors: {"response": "He revisat el text i no he trobat cap error.", "changes": []}`,

  improve: `EDITOR DE MILLORES CONSERVATIVES
Objectiu: Millorar claredat i fluïdesa SENSE canviar significat ni to.

## MILLORES PERMESES (amb criteri mesurable)
| Tipus | Criteri | Acció |
|-------|---------|-------|
| Frase llarga | >40 paraules | Dividir en 2 frases |
| Repetició | Paraula 3+ cops proper | Usar sinònim |
| Veu passiva | Encadenament 2+ passives | Convertir a activa |
| Subordinació | 3+ nivells de "que" | Simplificar estructura |
| Connector feble | "i" repetit 4+ cops | Variar connectors |

## RESTRICCIONS ESTRICTES
- PRESERVAR: significat, to, registre, terminologia tècnica
- PROHIBIT: afegir idees noves, eliminar informació, canviar conclusions
- LÍMIT: màxim 30% de canvi per paràgraf (si cal més, és "rewrite")

## PROTOCOL
1. Identificar problemes MESURABLES (no preferències)
2. Aplicar canvis MÍNIMS necessaris
3. Verificar que el significat és IDÈNTIC
4. Si dubtes, NO canviar

## OUTPUT
\`\`\`json
{
  "response": "<resposta breu i natural a l'usuari>",
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<paràgraf original>",
      "new_text": "<paràgraf millorat>",
      "explanation": "[Tipus]: què s'ha millorat i per què"
    }
  ]
}
\`\`\`

El camp "response" ha de ser natural i contextualitzat a la petició de l'usuari.
Exemples: "He simplificat algunes frases massa llargues.", "Proposo millorar la fluïdesa d'un paràgraf."

Si el text ja és clar: {"response": "El text ja està ben escrit, no cal fer canvis.", "changes": []}`,

  expand: `DESENVOLUPADOR DE CONTINGUT
Objectiu: Expandir text afegint detalls, exemples o explicacions rellevants.

## TIPUS D'EXPANSIÓ
| Tipus | Quan usar | Resultat esperat |
|-------|-----------|------------------|
| Detall | Afirmació genèrica | Afegir dades concretes |
| Exemple | Concepte abstracte | Il·lustrar amb cas pràctic |
| Explicació | Terme tècnic | Clarificar per audiència general |
| Context | Referència implícita | Fer explícit el rerefons |

## RESTRICCIONS
- COHERÈNCIA: No contradir el text original
- PROPORCIÓ: Expansió 1.5x-2x (no més del doble)
- ESTIL: Mantenir to i registre originals
- FONT: Només afegir informació que es pugui inferir del context

## PROTOCOL
1. Identificar què necessita expansió
2. Determinar tipus d'expansió adequat
3. Afegir contingut COHERENT amb l'existent
4. Verificar que no hi ha contradiccions

## OUTPUT
\`\`\`json
{
  "response": "<resposta breu i natural a l'usuari>",
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<text original>",
      "new_text": "<text expandit>",
      "explanation": "[Tipus]: què s'ha afegit"
    }
  ]
}
\`\`\`

El camp "response" ha de ser natural. Exemple: "He desenvolupat el paràgraf afegint més detalls sobre el tema."`,

  simplify: `SIMPLIFICADOR DE TEXT
Objectiu: Fer el text més accessible mantenint la informació essencial.

## TÈCNIQUES DE SIMPLIFICACIÓ
| Tècnica | Abans | Després |
|---------|-------|---------|
| Frases curtes | 40+ paraules | 15-20 paraules |
| Veu activa | "va ser aprovat" | "van aprovar" |
| Paraules senzilles | "implementar" | "fer" |
| Eliminar redundància | "cada un i tots" | "tots" |

## PRESERVAR OBLIGATÒRIAMENT
- Informació factual completa
- Termes tècnics necessaris (amb explicació si cal)
- Matisos importants
- Conclusions i arguments

## PROHIBIT ELIMINAR
- Dades numèriques
- Noms propis i referències
- Condicions o excepcions legals
- Advertències o precaucions

## OUTPUT
\`\`\`json
{
  "response": "<resposta breu i natural a l'usuari>",
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<text original>",
      "new_text": "<text simplificat>",
      "explanation": "Simplificat: [tècniques aplicades]"
    }
  ]
}
\`\`\`

El camp "response" ha de ser natural. Exemple: "He simplificat el text usant frases més curtes i directes."`,

  translate: `TRADUCTOR PROFESSIONAL
Objectiu: Traduir preservant significat, to i estil.

## PRINCIPIS DE TRADUCCIÓ
1. SENTIT sobre literalitat
2. Adaptar expressions idiomàtiques
3. Mantenir registre (formal/informal)
4. Preservar estructura argumentativa

## ELEMENTS A PRESERVAR
- Noms propis: NO traduir (excepte si tenen versió oficial)
- Sigles: Mantenir original + equivalent local si existeix
- Termes tècnics: Usar terminologia estàndard del sector
- Cites textuals: Indicar que és traducció

## ELEMENTS A ADAPTAR
- Expressions idiomàtiques → Equivalent funcional
- Formats de data/hora → Convenció local
- Unitats de mesura → Si s'indica a la instrucció

## OUTPUT
\`\`\`json
{
  "response": "<resposta breu i natural a l'usuari>",
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<text original>",
      "new_text": "<text traduït>",
      "target_language": "<idioma destí>",
      "explanation": "Traducció natural, [notes si escau]"
    }
  ]
}
\`\`\`

El camp "response" ha de ser natural. Exemple: "Aquí tens el text traduït al castellà."`,
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
  const { apiKey, signal, provider } = options;
  const language = intent.language || 'ca';
  const modificationType = intent.modification_type || 'improve';

  logInfo('Executing UPDATE_BY_ID', {
    modification_type: modificationType,
    target_paragraphs: intent.target_paragraphs,
    scope: intent.scope,
    provider: provider?.name || 'gemini-legacy',
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

    // Cridar IA (BYOK o Gemini)
    let response;
    let usage = null;

    // v12.1: Seleccionar temperatura segons el mode
    const temperature = TEMPERATURES[modificationType] || TEMPERATURES.improve;

    if (provider) {
      const result = await provider.chat(
        [{ role: 'user', content: userPrompt }],
        {
          systemPrompt,
          temperature,
          maxTokens: 8192,
          signal,
        }
      );
      response = result.content;
      usage = result.usage;
    } else {
      // Fallback a crida directa Gemini (compatibilitat enrere)
      response = await callGeminiUpdate(systemPrompt, userPrompt, apiKey, signal, modificationType);
    }

    // Parsejar resposta (v12.1: suporta format find/replace per FIX)
    const parsedResponse = parseUpdateResponse(response, modificationType);

    // Validar canvis (v12.1: validació específica per mode)
    const validatedChanges = validateChanges(parsedResponse.changes, documentContext, validTargets, modificationType);

    if (validatedChanges.length === 0) {
      return createNoChangesResponse(language, modificationType);
    }

    logDebug('UPDATE_BY_ID completed', {
      changes_count: validatedChanges.length,
      modification_type: modificationType,
      has_ai_response: !!parsedResponse.response,
    });

    // v14.4: Usar resposta de la IA si existeix, fallback a missatge genèric
    const chatResponse = parsedResponse.response || buildUpdateChatResponse(validatedChanges, modificationType, language);

    // v14.2: Generar highlights per mostrar on són els canvis al document
    const highlights = generateHighlightsFromChanges(validatedChanges, documentContext);

    return {
      mode: Mode.UPDATE_BY_ID,
      changes: validatedChanges,
      highlights: highlights,  // v14.2: Ressaltar fragments a modificar
      chat_response: chatResponse,
      // v12.1: modification_type a nivell superior per router híbrid del frontend
      modification_type: modificationType,
      _meta: {
        executor: 'update',
        modification_type: modificationType,
        provider: provider?.name || 'gemini',
        model: provider?.model || GEMINI.model_update,
        paragraphs_modified: validatedChanges.length,
        highlights_count: highlights.length,
        tokens_input: usage?.input,
        tokens_output: usage?.output,
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
    parts.push(`§${id + 1}: ${text}`);  // v12.1: 1-indexed per consistència UI
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
      parts.push(`§${id + 1}: ${text}${text.length >= 200 ? '...' : ''}`);  // v12.1: 1-indexed
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
 * v12.1: Temperatura específica per mode
 */
async function callGeminiUpdate(systemPrompt, userPrompt, apiKey, signal, modificationType = 'improve') {
  const url = `${GEMINI.base_url}/models/${GEMINI.model_update}:generateContent?key=${apiKey}`;

  // v12.1: Seleccionar temperatura segons el mode
  const temperature = TEMPERATURES[modificationType] || TEMPERATURES.improve;

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
      temperature: temperature,
      topP: 0.85,
      maxOutputTokens: 8192,
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
 * v12.1: Suporta format find/replace per mode FIX
 * v14.4: Extreu camp "response" per resposta natural de la IA
 */
function parseUpdateResponse(responseText, modificationType = 'improve') {
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
    const changes = parsed.changes || [];
    // v14.4: Extreure resposta natural de la IA
    const aiResponse = parsed.response || null;

    // v12.1: Per mode FIX, assegurar format find/replace
    // IMPORTANT: LLM retorna 1-indexed (§1, §2...), convertir a 0-indexed
    if (modificationType === 'fix') {
      return {
        response: aiResponse,
        changes: changes.map(c => ({
          paragraph_id: c.paragraph_id - 1,  // v12.1: 1-indexed → 0-indexed
          find: c.find || c.original_text,  // Fallback a format antic
          replace: c.replace || c.new_text,
          reason: c.reason || c.explanation || 'fix',
          // Preservar camps originals si existeixen
          original_text: c.original_text,
          new_text: c.new_text,
        })),
      };
    }

    // v12.1: Convertir paragraph_id a 0-indexed per modes no-FIX
    return {
      response: aiResponse,
      changes: changes.map(c => ({
        ...c,
        paragraph_id: c.paragraph_id - 1,  // v12.1: 1-indexed → 0-indexed
      })),
    };
  } catch (error) {
    logWarn('Failed to parse update response as JSON', { error: error.message });
    return { changes: [], response: null };
  }
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Valida els canvis proposats
 * v14.1: Format unificat amb before_text, before_hash, _status
 */
function validateChanges(changes, documentContext, validTargets, modificationType = 'improve') {
  if (!Array.isArray(changes)) return [];

  const targetSet = new Set(validTargets);
  const validated = [];
  let changeIndex = 0;

  for (const change of changes) {
    // Validar paragraph_id
    if (typeof change.paragraph_id !== 'number' || !targetSet.has(change.paragraph_id)) {
      logWarn('Change for non-target paragraph', { id: change.paragraph_id });
      continue;
    }

    const original = documentContext.paragraphs[change.paragraph_id];
    const originalText = original.text || original;

    // v14.1: before_text és el text complet del paràgraf
    const before_text = originalText;
    const before_hash = sha256Sync(before_text);

    // v12.1: Validació específica per mode FIX (find/replace)
    if (modificationType === 'fix') {
      // Validar que hi ha find i replace
      if (!change.find || !change.replace) {
        logWarn('FIX change without find/replace', { id: change.paragraph_id });
        continue;
      }

      // HALLUCINATION CHECK: El text "find" ha d'existir al paràgraf
      if (!originalText.includes(change.find)) {
        logWarn('HALLUCINATION: find text not found in paragraph', {
          paragraph_id: change.paragraph_id,
          find: change.find,
          paragraph_preview: originalText.substring(0, 100),
        });
        continue;
      }

      // Verificar que find !== replace
      if (change.find === change.replace) {
        logDebug('FIX change identical, skipping', { find: change.find });
        continue;
      }

      // v14.1: Format unificat amb original/replacement (find/replace → original/replacement)
      validated.push({
        id: generateItemId('c', changeIndex++),
        paragraph_id: change.paragraph_id,
        original: change.find,           // v14: 'original' en lloc de 'find'
        replacement: change.replace,     // v14: 'replacement' en lloc de 'replace'
        before_text,                     // v14: text complet del paràgraf
        before_hash,                     // v14: hash per detecció STALE
        reason: change.reason || 'fix',
        explanation: `"${change.find}" → "${change.replace}" (${change.reason || 'fix'})`,
        // Camps legacy per compatibilitat frontend
        find: change.find,
        replace: change.replace,
        original_text: originalText,
        new_text: originalText.replace(change.find, change.replace),
      });
      continue;
    }

    // Validació per altres modes (original_text/new_text)
    if (!change.new_text || typeof change.new_text !== 'string') {
      logWarn('Change without new_text', { id: change.paragraph_id });
      continue;
    }

    // Verificar que el canvi és diferent de l'original
    if (change.new_text.trim() === originalText.trim()) {
      logDebug('Change identical to original, skipping', { id: change.paragraph_id });
      continue;
    }

    // v14.1: Format unificat per modes non-FIX (improve, expand, simplify, translate)
    validated.push({
      id: generateItemId('c', changeIndex++),
      paragraph_id: change.paragraph_id,
      original: originalText,            // v14: text original complet
      replacement: change.new_text,      // v14: text nou complet
      before_text,                       // v14: igual que original per full-replace
      before_hash,                       // v14: hash per detecció STALE
      explanation: change.explanation || null,
      // Camps legacy per compatibilitat frontend
      original_text: originalText,
      new_text: change.new_text,
    });
  }

  // v14.1: Aplicar validació v14 per obtenir _status
  if (validated.length > 0) {
    // Construir mapa de hashes actuals per validació STALE
    const currentHashes = {};
    for (const change of validated) {
      currentHashes[change.paragraph_id] = change.before_hash;
    }

    // Validar i obtenir _status per cada canvi
    const result = validateChangesV14(validated, documentContext, modificationType, currentHashes);
    return result.validatedChanges;
  }

  return validated;
}

// ═══════════════════════════════════════════════════════════════
// HIGHLIGHT GENERATION v14.4
// ═══════════════════════════════════════════════════════════════

/**
 * Genera highlights per mostrar al document els fragments que es modificaran
 * v14.2: L'usuari veu ressaltat el text ABANS d'acceptar els canvis
 * v14.4: Ressalta només el text específic que canvia, no tot el paràgraf
 *
 * @param {Array} changes - Canvis validats
 * @param {Object} documentContext - Context del document
 * @returns {Array} - Highlights per al frontend
 */
function generateHighlightsFromChanges(changes, documentContext) {
  const highlights = [];

  for (const change of changes) {
    const paraId = change.paragraph_id;
    const para = documentContext.paragraphs[paraId];
    const paraText = para?.text || para || '';

    // v14.4: Determinar el text específic a ressaltar
    let textToHighlight;
    let start = 0;
    let end = paraText.length;

    // Mode FIX: ressaltar el fragment "find"
    if (change.find) {
      textToHighlight = change.find;
      const pos = paraText.indexOf(textToHighlight);
      if (pos !== -1) {
        start = pos;
        end = pos + textToHighlight.length;
      }
    }
    // Altres modes: trobar la diferència entre original i new
    else if (change.original_text && change.new_text) {
      const diff = findTextDifference(change.original_text, change.new_text);
      if (diff) {
        textToHighlight = diff.originalFragment;
        start = diff.start;
        end = diff.end;
      } else {
        // Si no es pot determinar la diferència, ressaltar tot
        textToHighlight = paraText;
      }
    }
    // Fallback
    else {
      textToHighlight = change.original || paraText;
      if (textToHighlight !== paraText) {
        const pos = paraText.indexOf(textToHighlight);
        if (pos !== -1) {
          start = pos;
          end = pos + textToHighlight.length;
        }
      }
    }

    // Determinar color segons el tipus de canvi
    let color = 'warning';  // Groc per defecte (canvi proposat)
    if (change.reason === 'typo' || change.reason === 'accent') {
      color = 'error';  // Taronja per errors ortogràfics
    } else if (change.reason === 'grammar') {
      color = 'warning';  // Groc per gramàtica
    }

    highlights.push({
      para_id: paraId,
      paragraph_id: paraId,  // Compatibilitat amb dos formats
      start: start,
      end: end,
      text: textToHighlight,
      matched_text: textToHighlight,  // Compatibilitat
      color: color,
      reason: change.explanation || change.reason || 'Canvi proposat',
      change_id: change.id,  // v14.2: Vincular highlight amb el canvi
    });
  }

  return highlights;
}

/**
 * v14.4: Troba la diferència entre dos textos
 * Retorna el fragment del text original que ha canviat
 */
function findTextDifference(original, modified) {
  if (!original || !modified) return null;
  if (original === modified) return null;

  // Trobar prefix comú
  let prefixLen = 0;
  const minLen = Math.min(original.length, modified.length);
  while (prefixLen < minLen && original[prefixLen] === modified[prefixLen]) {
    prefixLen++;
  }

  // Trobar suffix comú (des del final)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    original[original.length - 1 - suffixLen] === modified[modified.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // Calcular el fragment que canvia
  const start = prefixLen;
  const end = original.length - suffixLen;

  // Si el canvi és massa gran (>80% del text), no ressaltar fragment específic
  const changeLen = end - start;
  if (changeLen > original.length * 0.8) {
    return null;
  }

  const originalFragment = original.substring(start, end);

  // Si el fragment és molt curt, expandir una mica per donar context
  if (originalFragment.length < 5 && original.length > 10) {
    const expandStart = Math.max(0, start - 10);
    const expandEnd = Math.min(original.length, end + 10);
    return {
      start: expandStart,
      end: expandEnd,
      originalFragment: original.substring(expandStart, expandEnd),
    };
  }

  return {
    start,
    end,
    originalFragment,
  };
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix la resposta de chat
 * v14.4: Missatges més naturals - propostes pendents d'aprovació
 */
function buildUpdateChatResponse(changes, modificationType, language) {
  const count = changes.length;

  // v14.4: Missatges que indiquen proposta (no acció completada)
  const templates = {
    ca: {
      fix: count === 1
        ? 'He trobat una correcció a fer:'
        : `He trobat ${count} correccions a fer:`,
      improve: count === 1
        ? 'Proposo una millora:'
        : `Proposo ${count} millores:`,
      expand: count === 1
        ? 'Proposo expandir aquest fragment:'
        : `Proposo expandir ${count} fragments:`,
      simplify: count === 1
        ? 'Proposo simplificar aquest fragment:'
        : `Proposo simplificar ${count} fragments:`,
      translate: count === 1
        ? 'Aquí tens la traducció:'
        : `Aquí tens ${count} traduccions:`,
    },
    es: {
      fix: count === 1
        ? 'He encontrado una corrección:'
        : `He encontrado ${count} correcciones:`,
      improve: count === 1
        ? 'Propongo una mejora:'
        : `Propongo ${count} mejoras:`,
      expand: count === 1
        ? 'Propongo expandir este fragmento:'
        : `Propongo expandir ${count} fragmentos:`,
      simplify: count === 1
        ? 'Propongo simplificar este fragmento:'
        : `Propongo simplificar ${count} fragmentos:`,
      translate: count === 1
        ? 'Aquí tienes la traducción:'
        : `Aquí tienes ${count} traducciones:`,
    },
    en: {
      fix: count === 1
        ? 'I found one correction:'
        : `I found ${count} corrections:`,
      improve: count === 1
        ? 'I suggest an improvement:'
        : `I suggest ${count} improvements:`,
      expand: count === 1
        ? 'I suggest expanding this section:'
        : `I suggest expanding ${count} sections:`,
      simplify: count === 1
        ? 'I suggest simplifying this section:'
        : `I suggest simplifying ${count} sections:`,
      translate: count === 1
        ? 'Here\'s the translation:'
        : `Here are ${count} translations:`,
    },
  };

  const t = templates[language] || templates.ca;
  let response = t[modificationType] || t.improve;

  // v14.4: Afegir explicacions dels canvis si n'hi ha
  if (changes.length <= 3) {
    const details = changes.map(c => {
      if (c.explanation) return `\n• ${c.explanation}`;
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
