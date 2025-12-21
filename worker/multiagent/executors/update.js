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
  // v17.21: Prompt FIX amb anti-al·lucinació
  fix: `CORRECTOR ORTOGRÀFIC v17.52
Objectiu: Trobar i corregir TOTS els errors ortogràfics del text.

## 🔍 MENTALITAT: BUSCA ACTIVAMENT ERRORS
L'usuari t'ha demanat revisar el text perquè SOSPITA que hi ha errors.
La teva feina és TROBAR-LOS. Busca amb atenció:
- Accents oblidats o incorrectes
- Lletres duplicades o que falten
- Errors de concordança
- Typos comuns

Si no trobes res després de revisar bé, retorna changes: []

## ⚠️⚠️⚠️ REGLA #2: ANTI-AL·LUCINACIÓ ⚠️⚠️⚠️

EL TEXT "find" HA D'EXISTIR **EXACTAMENT** AL TEXT INDICAT.
- Copia el text EXACTE, no l'inventis
- Si no trobes errors, retorna changes: [] - NO inventis errors
- És MOLT MILLOR no trobar res que inventar errors falsos
- MAI retornis un "find" que no existeixi literalment al text

VERIFICACIÓ OBLIGATÒRIA abans de cada canvi:
1. Busca el text "find" dins del paràgraf original
2. Si NO el trobes EXACTAMENT → NO incloguis aquest canvi
3. En cas de dubte → NO incloguis el canvi

## 🚫🚫🚫 REGLA #3: MAI CANVIS IDÈNTICS 🚫🚫🚫

ABANS de retornar CADA canvi, compara "find" i "replace":
- Si find === replace → NO incloguis aquest canvi!
- Si l'únic canvi és majúscules/minúscules i NO és inici de frase → NO incloguis!
- Si l'únic canvi són espais → NO incloguis!

EXEMPLES DE CANVIS QUE NO HAURIES DE RETORNAR:
❌ {"find": "projecte", "replace": "projecte"} → IDÈNTIC!
❌ {"find": "Barcelona", "replace": "barcelona"} → NO canviar majúscula de nom propi
❌ {"find": "de  la", "replace": "de la"} → Només espais, no és error

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
4. El "find" existeix LITERALMENT al text? → Si no, NO retornis aquest canvi!

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
      "reason": "<explicació clara i natural del canvi, ex: 'Falta l'accent obert a la e' o 'Error tipogràfic: lletra duplicada'>"
    }
  ]
}
\`\`\`

IMPORTANT per "reason": Ha de ser una frase natural i clara que expliqui la naturalesa del canvi.
Exemples bons: "Falta l'accent a la paraula 'àrea'", "Lletra duplicada 'docummentació'", "Concordança de gènere incorrecta"
Exemples dolents: "typo", "accent", "grammar" (massa curt, no informatiu)

## RESPOSTA CONTEXTUAL (IMPORTANT)
El camp "response" ha de:
1. Fer referència directa a la INSTRUCCIÓ de l'usuari (no respostes genèriques)
2. Usar TO PROPOSITIU (l'usuari decideix si accepta) - NO dir "he corregit/he canviat"
3. Ser breu i natural (1-2 frases)

Exemples segons instrucció:
- "Corregeix les faltes" → "He trobat 3 faltes d'ortografia: 'area' → 'àrea', 'documentacio' → 'documentació'. Proposo corregir-les."
- "Revisa l'ortografia del paràgraf 2" → "Al paràgraf 2 he detectat 2 errors d'accent. Vols que els corregeixi?"
- "Arregla els errors" → "He detectat 4 errors: 2 accents i 2 typos. Proposo les correccions."

Si no hi ha errors: {"response": "He revisat el text i no he trobat cap error a corregir.", "changes": []}`,

  improve: `DETECTOR DE PROBLEMES v17.52
Objectiu: Trobar i corregir problemes semàntics, d'estil i coherència.

## 🔍 MENTALITAT: L'USUARI SOSPITA QUE ALGO NO ESTÀ BÉ
L'usuari t'ha demanat revisar el text. BUSCA ACTIVAMENT:
- Paraules FORA DE CONTEXT (que no encaixen amb el tema)
- Frases INCOHERENTS o que no tenen sentit
- Expressions ESTRANYES o forçades
- Paraules REPETIDES innecessàriament
- Frases CONFUSES o ambigües

Revisa cada paràgraf i pregunta't: "Hi ha alguna cosa que sona malament?"

Si no trobes res després de revisar bé, retorna changes: []

## ⚠️ FORMAT DE SORTIDA CRÍTIC ⚠️
PER CANVIS PETITS (1-3 paraules): Usa find/replace, NO el paràgraf complet!
PER CANVIS GRANS (frases senceres): Usa original_text/new_text

## PROBLEMES A DETECTAR (PRIORITAT ALTA)
| Tipus | Què buscar | Acció |
|-------|------------|-------|
| **FORA DE CONTEXT** | Paraules que no encaixen amb el tema | Substituir per sinònim adequat |
| **INCOHERÈNCIA** | Frases que no tenen sentit | Reescriure amb sentit |
| **ESTRANYESA** | Expressions rares o forçades | Naturalitzar |
| **REPETICIÓ** | Paraules repetides | Usar sinònim |
| **AMBIGÜITAT** | Frases confuses | Clarificar |
| **FRASE LLARGA** | >40 paraules | Dividir |

## EXEMPLE CLAU: "FORA DE CONTEXT"
Si l'usuari pregunta "Hi ha paraules fora de context?" busca:
- Paraules que NO pertanyen al camp semàntic del document
- Termes tècnics usats incorrectament
- Paraules que semblen errors de copiar-enganxar
- Qualsevol cosa que "no encaixi" amb el text

## RESTRICCIONS
- PRESERVAR: to, registre, terminologia correcta
- LÍMIT: màxim 30% de canvi per paràgraf

## PROTOCOL
1. Identificar problemes MESURABLES (no preferències)
2. Aplicar canvis MÍNIMS necessaris
3. Verificar que el significat és IDÈNTIC
4. Si dubtes, NO canviar

## OUTPUT - IMPORTANT: ESCULL EL FORMAT CORRECTE

### Per canvis PETITS (1-3 paraules): usa find/replace
\`\`\`json
{
  "response": "<resposta breu>",
  "changes": [
    {
      "paragraph_id": <número>,
      "find": "<text EXACTE a trobar, inclou context si cal>",
      "replace": "<text de reemplaçament>",
      "reason": "<explicació clara i natural: què era el problema i com es millora>"
    }
  ]
}
\`\`\`

### Per canvis GRANS (frases senceres o reescriptura): usa original_text/new_text
\`\`\`json
{
  "response": "<resposta breu>",
  "changes": [
    {
      "paragraph_id": <número>,
      "original_text": "<paràgraf original>",
      "new_text": "<paràgraf millorat>",
      "reason": "<explicació clara i natural: què era el problema i com es millora>"
    }
  ]
}
\`\`\`

IMPORTANT per "reason": Ha de ser una frase natural que expliqui clarament:
- Quin era el problema original
- Per què la nova versió és millor
Exemples: "La paraula 'cosa' era massa genèrica, 'element' és més precís en aquest context",
"La frase era massa llarga i confusa, ara està dividida en dues frases clares"

## REGLA D'OR: Si canvies menys de 5 paraules, USA find/replace!

## RESPOSTA CONTEXTUAL (IMPORTANT)
El camp "response" ha de:
1. Fer referència directa a la INSTRUCCIÓ de l'usuari
2. Usar TO PROPOSITIU (l'usuari decideix si accepta) - MAI dir "he fet/he canviat"
3. Explicar breument què es proposa i per què

Si el text ja és clar: {"response": "He revisat el text i no he trobat problemes. No proposo canvis.", "changes": []}`,

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

## RESPOSTA CONTEXTUAL (IMPORTANT)
El camp "response" ha de fer referència a la instrucció de l'usuari i explicar què s'ha afegit.

Exemples:
- "Amplia aquest punt" → "He ampliat el punt afegint exemples concrets i més context."
- "Desenvolupa la idea" → "He desenvolupat la idea amb detalls addicionals sobre els beneficis i implicacions."
- "Afegeix més informació" → "He afegit explicacions sobre el procés i exemples pràctics."`,

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

## RESPOSTA CONTEXTUAL (IMPORTANT)
El camp "response" ha de fer referència a la instrucció de l'usuari.

Exemples:
- "Simplifica el text" → "He simplificat el text: frases més curtes i vocabulari més directe."
- "Fes-ho més senzill" → "He fet el text més accessible eliminant estructures complexes."
- "Escurça això" → "He condensat el contingut mantenint la informació essencial."`,

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

## RESPOSTA CONTEXTUAL (IMPORTANT)
El camp "response" ha de fer referència a la instrucció de l'usuari i l'idioma.

Exemples:
- "Tradueix a anglès" → "He traduït el text a l'anglès mantenint el to formal."
- "Passa-ho al castellà" → "Aquí tens la traducció al castellà, adaptant les expressions idiomàtiques."
- "Tradueix això" → "He traduït el contingut a [idioma], preservant l'estructura original."`,
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
  let validTargets = intent.target_paragraphs.filter(
    id => id >= 0 && id < documentContext.paragraphs.length
  );

  // v14.6: VALIDACIÓ CRÍTICA - Si hi ha selecció parcial, NOMÉS modificar paràgrafs seleccionats
  const selectedIds = documentContext.selectedParagraphIds || [];
  if (selectedIds.length > 0 && documentContext.isPartialSelection) {
    const selectedSet = new Set(selectedIds);
    const originalTargets = validTargets.length;

    // Filtrar només paràgrafs que estan seleccionats
    validTargets = validTargets.filter(id => selectedSet.has(id));

    if (validTargets.length < originalTargets) {
      logWarn('Filtered out-of-selection paragraphs', {
        original_targets: originalTargets,
        after_filter: validTargets.length,
        selected_ids: selectedIds,
      });
    }

    // Si tots els targets estaven fora de selecció, usar només els seleccionats
    if (validTargets.length === 0 && selectedIds.length > 0) {
      validTargets = selectedIds.filter(id => id >= 0 && id < documentContext.paragraphs.length);
      logInfo('Using selected paragraphs as targets', { targets: validTargets });
    }
  }

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
  // v14.5: Buscar per ID, no per índex (documentContext.paragraphs pot estar filtrat)
  parts.push('## Paràgrafs a modificar');
  for (const id of targetParagraphs) {
    const para = documentContext.paragraphs.find(p => p.id === id) || documentContext.paragraphs[id];
    if (!para) continue;
    const text = para.text || para;
    parts.push(`§${id + 1}: ${text}`);  // v12.1: 1-indexed per consistència UI
  }
  parts.push('');

  // Context addicional (paràgrafs adjacents)
  // v14.5: Usar totalParagraphs en lloc de length (pot estar filtrat)
  const contextIds = new Set();
  const totalParagraphs = documentContext.totalParagraphs || documentContext.paragraphs.length;
  for (const id of targetParagraphs) {
    if (id > 0) contextIds.add(id - 1);
    if (id < totalParagraphs - 1) contextIds.add(id + 1);
  }
  // Eliminar els que ja són targets
  targetParagraphs.forEach(id => contextIds.delete(id));

  if (contextIds.size > 0) {
    parts.push('## Context (paràgrafs adjacents, NO modificar)');
    for (const id of Array.from(contextIds).sort((a, b) => a - b)) {
      // v14.5: Buscar per ID, no per índex
      const para = documentContext.paragraphs.find(p => p.id === id) || documentContext.paragraphs[id];
      if (!para) continue;
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
// v14.8: GENERADOR INTEL·LIGENT DE REASONS
// ═══════════════════════════════════════════════════════════════

/**
 * Genera una explicació natural i orgànica del canvi
 * Analitza el tipus de canvi i genera una descripció humana
 *
 * @param {string} find - Text original
 * @param {string} replace - Text nou
 * @param {string} modificationType - Tipus de modificació (fix, improve, etc.)
 * @returns {string} Explicació natural del canvi
 */
function generateSmartReason(find, replace, modificationType = 'fix') {
  if (!find || !replace) return null;

  const findTrim = find.trim();
  const replaceTrim = replace.trim();

  // Si són idèntics, no hi ha canvi real
  if (findTrim === replaceTrim) return null;

  // ═══════════════════════════════════════════════════════════
  // 1. DETECCIÓ D'ACCENTS CATALANS
  // ═══════════════════════════════════════════════════════════

  const accentPairs = {
    'a': ['à', 'á'], 'e': ['è', 'é'], 'i': ['í', 'ï'],
    'o': ['ò', 'ó'], 'u': ['ú', 'ü'], 'c': ['ç']
  };

  // Buscar diferències d'accent
  if (findTrim.length === replaceTrim.length) {
    let accentChanges = [];
    for (let i = 0; i < findTrim.length; i++) {
      if (findTrim[i] !== replaceTrim[i]) {
        const charLower = findTrim[i].toLowerCase();
        const replaceCharLower = replaceTrim[i].toLowerCase();

        // És un canvi d'accent?
        for (const [base, accents] of Object.entries(accentPairs)) {
          if ((charLower === base && accents.includes(replaceCharLower)) ||
              (accents.includes(charLower) && replaceCharLower === base) ||
              (accents.includes(charLower) && accents.includes(replaceCharLower))) {
            accentChanges.push({ from: findTrim[i], to: replaceTrim[i], pos: i });
          }
        }
      }
    }

    if (accentChanges.length > 0 && accentChanges.length <= 2) {
      // Extreure la paraula afectada
      const words = replaceTrim.split(/\s+/);
      if (words.length === 1) {
        const accentType = accentChanges[0].to.match(/[àèò]/) ? 'obert' :
                          accentChanges[0].to.match(/[áéíóú]/) ? 'tancat' : 'diacrític';
        return `Falta l'accent ${accentType} a «${replaceTrim}»`;
      } else {
        return `Correcció d'accent: «${findTrim}» necessita accent a «${replaceTrim}»`;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 2. DETECCIÓ DE LLETRES DUPLICADES O MANCANTS
  // ═══════════════════════════════════════════════════════════

  const lenDiff = findTrim.length - replaceTrim.length;

  if (Math.abs(lenDiff) === 1) {
    const longer = lenDiff > 0 ? findTrim : replaceTrim;
    const shorter = lenDiff > 0 ? replaceTrim : findTrim;

    // Buscar quina lletra és diferent
    for (let i = 0; i < longer.length; i++) {
      const withoutChar = longer.slice(0, i) + longer.slice(i + 1);
      if (withoutChar === shorter) {
        const letter = longer[i];
        if (lenDiff > 0) {
          // Lletra duplicada eliminada
          if (i > 0 && longer[i-1] === letter) {
            return `Lletra duplicada «${letter}${letter}» → s'ha eliminat la repetició`;
          }
          return `S'ha eliminat la lletra «${letter}» sobrant`;
        } else {
          // Lletra mancant afegida
          return `Faltava la lletra «${letter}» a «${shorter}»`;
        }
      }
    }
  }

  // Detectar doble lletra més complexa (ex: "docummentació" → "documentació")
  if (lenDiff > 0 && lenDiff <= 3) {
    const doubleLetterMatch = findTrim.match(/(.)\1{2,}/);
    if (doubleLetterMatch) {
      return `Lletres repetides de més: «${doubleLetterMatch[0]}» corregit`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 3. DETECCIÓ DE TRANSPOSICIONS (lletres intercanviades)
  // ═══════════════════════════════════════════════════════════

  if (findTrim.length === replaceTrim.length && findTrim.length <= 15) {
    let diffs = 0;
    let diffPositions = [];
    for (let i = 0; i < findTrim.length; i++) {
      if (findTrim[i] !== replaceTrim[i]) {
        diffs++;
        diffPositions.push(i);
      }
    }
    if (diffs === 2 && diffPositions[1] - diffPositions[0] === 1) {
      // Transposició de lletres adjacents
      return `Lletres intercanviades: «${findTrim[diffPositions[0]]}${findTrim[diffPositions[1]]}» → «${replaceTrim[diffPositions[0]]}${replaceTrim[diffPositions[1]]}»`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 4. DETECCIÓ DE CANVIS COMUNS
  // ═══════════════════════════════════════════════════════════

  // Apòstrof
  if ((findTrim.includes("l'") && replaceTrim.includes("el ")) ||
      (findTrim.includes("el ") && replaceTrim.includes("l'"))) {
    return `Apostrofació: article «el/l'» ajustat segons la paraula següent`;
  }

  if ((findTrim.includes("d'") && replaceTrim.includes("de ")) ||
      (findTrim.includes("de ") && replaceTrim.includes("d'"))) {
    return `Apostrofació de la preposició «de/d'»`;
  }

  // Guionet
  if (findTrim.includes('-') !== replaceTrim.includes('-')) {
    return findTrim.includes('-')
      ? `S'ha eliminat el guionet innecessari`
      : `S'ha afegit guionet necessari`;
  }

  // Majúscules/minúscules
  if (findTrim.toLowerCase() === replaceTrim.toLowerCase()) {
    if (findTrim[0] !== replaceTrim[0]) {
      return replaceTrim[0] === replaceTrim[0].toUpperCase()
        ? `Cal majúscula inicial: «${replaceTrim}»`
        : `No cal majúscula: «${replaceTrim}»`;
    }
    return `Correcció de majúscules/minúscules`;
  }

  // ═══════════════════════════════════════════════════════════
  // 5. SEGONS TIPUS DE MODIFICACIÓ
  // ═══════════════════════════════════════════════════════════

  // Paraules curtes - mostrar el canvi directe
  if (findTrim.split(/\s+/).length <= 3 && replaceTrim.split(/\s+/).length <= 3) {
    switch (modificationType) {
      case 'fix':
        // Intentar detectar el tipus d'error
        if (findTrim.length < replaceTrim.length) {
          return `Faltaven lletres: «${findTrim}» → «${replaceTrim}»`;
        } else if (findTrim.length > replaceTrim.length) {
          return `Lletres sobrants: «${findTrim}» → «${replaceTrim}»`;
        }
        return `Error ortogràfic corregit: «${findTrim}» → «${replaceTrim}»`;

      case 'improve':
        return `Millora d'expressió: «${findTrim}» → «${replaceTrim}» (més precís)`;

      case 'expand':
        return `Text ampliat per més claredat`;

      case 'simplify':
        return `Simplificat: expressió més directa`;

      case 'translate':
        return `Traducció adaptada al context`;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 6. FRASES MÉS LLARGUES
  // ═══════════════════════════════════════════════════════════

  const findWords = findTrim.split(/\s+/).length;
  const replaceWords = replaceTrim.split(/\s+/).length;

  if (modificationType === 'simplify') {
    if (replaceWords < findWords) {
      return `Simplificat: ${findWords} → ${replaceWords} paraules, més directe`;
    }
    return `Reestructurat per major claredat`;
  }

  if (modificationType === 'expand') {
    if (replaceWords > findWords) {
      return `Ampliat amb detall addicional (+${replaceWords - findWords} paraules)`;
    }
    return `Contingut enriquit amb més context`;
  }

  if (modificationType === 'translate') {
    return `Traducció natural mantenint el to original`;
  }

  if (modificationType === 'improve') {
    if (Math.abs(findWords - replaceWords) <= 2) {
      return `Reformulat per millorar la fluïdesa`;
    }
    return `Reestructurat: expressió més clara i natural`;
  }

  // Fallback final (hauria de ser rar arribar aquí)
  return `Canvi de «${findTrim.substring(0, 25)}${findTrim.length > 25 ? '...' : ''}» per versió millorada`;
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
  // DEBUG: Log raw response
  logDebug('Gemini raw response', { preview: responseText.substring(0, 500) });

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
        changes: changes.map(c => {
          let find = c.find;
          let replace = c.replace;

          // v17.20: Si Gemini retorna original_text/new_text però NO find/replace,
          // calcular el find correcte a partir de la diferència
          if (!find && c.original_text && c.new_text) {
            const diff = findTextDifference(c.original_text, c.new_text);
            if (diff && diff.originalFragment && diff.modifiedFragment) {
              find = diff.originalFragment;
              replace = diff.modifiedFragment;
              logDebug('v17.20: Converted full-text to find/replace', {
                original_len: c.original_text.length,
                find: find,
                replace: replace
              });
            } else {
              // Fallback al format antic (paràgraf sencer)
              find = c.original_text;
              replace = c.new_text;
              logWarn('v17.20: Could not extract diff, using full paragraph', {
                original_preview: c.original_text?.substring(0, 50)
              });
            }
          }

          // v14.8: Generar reason intel·ligent si Gemini no el proporciona
          let reason = c.reason || c.explanation;
          if (!reason || reason.length < 15) {
            // Usar generador intel·ligent en lloc de fallback genèric
            reason = generateSmartReason(find, replace, 'fix') || `Correcció ortogràfica`;
          }
          return {
            paragraph_id: c.paragraph_id - 1,  // v12.1: 1-indexed → 0-indexed
            find: find,
            replace: replace,
            reason: reason,
            // Preservar camps originals si existeixen
            original_text: c.original_text,
            new_text: c.new_text,
          };
        }),
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

    // v14.5: Buscar per ID, no per índex (documentContext.paragraphs pot estar filtrat)
    const original = documentContext.paragraphs.find(p => p.id === change.paragraph_id)
                  || documentContext.paragraphs[change.paragraph_id];
    if (!original) {
      logWarn('Paragraph not found in context', { id: change.paragraph_id });
      continue;
    }
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

      // v16.9: Validació estricta de canvis idèntics
      // 1. Comparació EXACTA primer
      if (change.find === change.replace) {
        logDebug('FIX change identical (exact match), skipping', {
          find: change.find,
          replace: change.replace
        });
        continue;
      }

      // 2. v17.23: Comparació normalitzada SENSE toLowerCase()
      // Les majúscules SÓN correccions vàlides (demà → Demà és un canvi real)
      const normalizeText = (t) => t.trim().replace(/[''`]/g, "'").replace(/\s+/g, ' ');
      if (normalizeText(change.find) === normalizeText(change.replace)) {
        logDebug('FIX change identical (normalized), skipping', {
          find: change.find,
          replace: change.replace
        });
        continue;
      }

      // 3. Comparació sense espais en blanc per detectar diferències només d'espaiat
      const noWhitespace = (t) => t.replace(/\s+/g, '');
      if (noWhitespace(change.find) === noWhitespace(change.replace)) {
        logDebug('FIX change only whitespace difference, skipping', {
          find: change.find,
          replace: change.replace
        });
        continue;
      }

      // v16.3: HALLUCINATION CHECK - detectar repeticions inventades
      // Si el find sembla una repetició (X X) però el text original no la té, és hallucination
      const words = change.find.trim().split(/\s+/);
      if (words.length === 2 && words[0].toLowerCase() === words[1].toLowerCase()) {
        // El find és "paraula paraula" - verificar que realment existeix al text
        const repeatedPattern = words[0] + ' ' + words[1];
        if (!originalText.toLowerCase().includes(repeatedPattern.toLowerCase())) {
          logWarn('HALLUCINATION: invented repetition', {
            paragraph_id: change.paragraph_id,
            find: change.find,
            paragraph_preview: originalText.substring(0, 100),
          });
          continue;
        }
      }

      // v16.3: Verificar que el resultat del reemplaçament és diferent de l'original
      const resultText = originalText.replace(change.find, change.replace);
      if (resultText === originalText) {
        logDebug('FIX result identical to original, skipping', { find: change.find });
        continue;
      }

      // v16.6: Calcular el text exacte a ressaltar (només la part que canvia)
      // Gemini pot retornar context extra per unicitat: "aquest prosjecte se" → "aquest projecte se"
      // Però el highlight ha de ser només "prosjecte"
      // v17.8: Ara findTextDifference retorna modifiedFragment directament
      let highlightFind = change.find;
      let highlightReplace = change.replace;
      const diffResult = findTextDifference(change.find, change.replace);
      // v17.19: DEBUG - log per diagnosticar problema de highlight
      logDebug('v17.19 FIX mode highlight calc', {
        find_len: change.find?.length,
        replace_len: change.replace?.length,
        find_preview: change.find?.substring(0, 60),
        replace_preview: change.replace?.substring(0, 60),
        diffResult: diffResult ? { orig: diffResult.originalFragment, mod: diffResult.modifiedFragment } : null
      });
      if (diffResult) {
        if (diffResult.originalFragment) highlightFind = diffResult.originalFragment;
        if (diffResult.modifiedFragment) highlightReplace = diffResult.modifiedFragment;
      }

      // v14.1: Format unificat amb original/replacement (find/replace → original/replacement)
      // v14.8: Usar generador intel·ligent de reasons
      let finalReason = change.reason;
      if (!finalReason || finalReason.length < 15) {
        finalReason = generateSmartReason(change.find, change.replace, modificationType) || `Correcció aplicada`;
      }
      validated.push({
        id: generateItemId('c', changeIndex++),
        paragraph_id: change.paragraph_id,
        targetId: change.paragraph_id,   // v17.30: Alias per compatibilitat frontend
        original: change.find,           // v14: 'original' en lloc de 'find'
        replacement: change.replace,     // v14: 'replacement' en lloc de 'replace'
        before_text,                     // v14: text complet del paràgraf
        before_hash,                     // v14: hash per detecció STALE
        reason: finalReason,
        // Camps legacy per compatibilitat frontend
        find: change.find,
        replace: change.replace,
        // v16.6: Text exacte per highlight (sense context extra)
        highlight_find: highlightFind,
        highlight_replace: highlightReplace,
        original_text: originalText,
        new_text: originalText.replace(change.find, change.replace),
      });
      continue;
    }

    // v17.9: Per mode improve, PRIORITZAR format find/replace (canvis petits)
    // Si Gemini retorna find/replace, usar-lo encara que també retorni new_text
    if (change.find && change.replace) {
      // Gemini ha retornat find/replace per canvi petit - processar com find/replace

      // HALLUCINATION CHECK: El text "find" ha d'existir al paràgraf
      if (!originalText.includes(change.find)) {
        logWarn('HALLUCINATION (improve): find text not found', {
          paragraph_id: change.paragraph_id,
          find: change.find,
          paragraph_preview: originalText.substring(0, 100),
        });
        continue;
      }

      // Validació de canvis idèntics
      if (change.find === change.replace) {
        logDebug('IMPROVE find/replace identical, skipping', { find: change.find });
        continue;
      }

      const normalizeImprove = (t) => t.trim().toLowerCase().replace(/[''`]/g, "'").replace(/\s+/g, ' ');
      if (normalizeImprove(change.find) === normalizeImprove(change.replace)) {
        logDebug('IMPROVE find/replace identical (normalized), skipping', { find: change.find });
        continue;
      }

      // Construir new_text aplicant el canvi
      const resultText = originalText.replace(change.find, change.replace);

      // v14.8: Usar generador intel·ligent de reasons
      let improveReason = change.reason || change.explanation;
      if (!improveReason || improveReason.length < 15) {
        improveReason = generateSmartReason(change.find, change.replace, 'improve') || `Millora d'estil`;
      }
      validated.push({
        id: generateItemId('c', changeIndex++),
        paragraph_id: change.paragraph_id,
        targetId: change.paragraph_id,   // v17.30: Alias per compatibilitat frontend
        find: change.find,
        replace: change.replace,
        highlight_find: change.find,
        highlight_replace: change.replace,
        original: change.find,
        replacement: change.replace,
        before_text,
        before_hash,
        original_text: originalText,
        new_text: resultText,
        reason: improveReason,
        _status: 'pending',
      });
      continue;
    }

    // Validació per altres modes (original_text/new_text)
    // v15.2: Permetre new_text buit (per eliminar paraules fora de context)
    if (change.new_text === undefined || change.new_text === null || typeof change.new_text !== 'string') {
      logWarn('Change without new_text', { id: change.paragraph_id });
      continue;
    }

    // v15.2: Si Gemini retorna només la paraula/frase a canviar (no el paràgraf complet),
    // convertir a format find/replace i aplicar al paràgraf complet
    if (change.original_text && change.original_text !== originalText && originalText.includes(change.original_text)) {
      // v17.0: Validació de canvis idèntics per conversions parcials
      if (change.original_text === change.new_text) {
        logDebug('Partial change identical (exact), skipping', { original: change.original_text });
        continue;
      }
      // Comparació normalitzada
      const normalizePartial = (t) => t.trim().toLowerCase().replace(/[''`]/g, "'").replace(/\s+/g, ' ');
      if (normalizePartial(change.original_text) === normalizePartial(change.new_text)) {
        logDebug('Partial change identical (normalized), skipping', { original: change.original_text });
        continue;
      }

      logDebug('Converting partial change to find/replace', {
        original_fragment: change.original_text,
        new_fragment: change.new_text
      });
      const newFullText = originalText.replace(change.original_text, change.new_text);

      // v17.8: Calcular el find exacte (només la part que canvia, no tot el fragment)
      let exactFind = change.original_text;
      let exactReplace = change.new_text;
      const diff = findTextDifference(change.original_text, change.new_text);
      if (diff) {
        if (diff.originalFragment) exactFind = diff.originalFragment;
        if (diff.modifiedFragment) exactReplace = diff.modifiedFragment;
      }

      // v17.3: VALIDACIÓ FINAL - assegurar que find i replace són realment diferents
      if (exactFind === exactReplace) {
        logDebug('Partial conversion: exactFind === exactReplace, skipping', { exactFind });
        continue;
      }
      const normPartial = (t) => t.trim().toLowerCase().replace(/[''`]/g, "'").replace(/\s+/g, ' ');
      if (normPartial(exactFind) === normPartial(exactReplace)) {
        logDebug('Partial conversion: normalized find === replace, skipping', { exactFind, exactReplace });
        continue;
      }

      // v17.31: Corregit generateItemId amb arguments correctes
      validated.push({
        id: generateItemId('c', changeIndex++),
        paragraph_id: change.paragraph_id,
        targetId: change.paragraph_id,   // v17.30: Alias per compatibilitat frontend
        before_text: originalText,
        before_hash: before_hash,
        // v16.6: Usar el find exacte per highlight precís
        find: exactFind,
        replace: exactReplace,
        // v17.1: highlight_find/highlight_replace per ressaltar NOMÉS el fragment canviat
        highlight_find: exactFind,
        highlight_replace: exactReplace,
        // v17.31: Camps per compatibilitat - original_text és SEMPRE el paràgraf complet
        original_text: originalText,
        new_text: newFullText,
        reason: change.reason || change.explanation || generateSmartReason(exactFind, exactReplace, 'improve') || `Millora aplicada`,
        _status: 'pending',
      });
      continue;
    }

    // v16.9: Validació estricta que el canvi és diferent de l'original
    // 1. Comparació exacta
    if (change.new_text === originalText) {
      logDebug('Change identical to original (exact), skipping', { id: change.paragraph_id });
      continue;
    }
    // 2. Comparació sense espais extres
    if (change.new_text.trim() === originalText.trim()) {
      logDebug('Change identical to original (trimmed), skipping', { id: change.paragraph_id });
      continue;
    }
    // 3. Comparació normalitzada (sense diferències d'espaiat)
    const normalizeWhitespace = (t) => t.replace(/\s+/g, ' ').trim();
    if (normalizeWhitespace(change.new_text) === normalizeWhitespace(originalText)) {
      logDebug('Change only whitespace difference, skipping', { id: change.paragraph_id });
      continue;
    }

    // v14.1: Format unificat per modes non-FIX (improve, expand, simplify, translate)
    // v17.8: Calcular find/replace exacte - ara amb modifiedFragment directe
    let exactFind = null;
    let exactReplace = null;
    const diff = findTextDifference(originalText, change.new_text);
    if (diff) {
      exactFind = diff.originalFragment || null;
      exactReplace = diff.modifiedFragment || null;
      logDebug('v17.8: Extracted diff', { exactFind, exactReplace });
    }

    // v17.3: VALIDACIÓ FINAL - assegurar que hi ha una diferència real
    if (exactFind && exactReplace) {
      if (exactFind === exactReplace) {
        logDebug('Non-FIX: exactFind === exactReplace, skipping', { exactFind });
        continue;
      }
      const normNonFix = (t) => t.trim().toLowerCase().replace(/[''`]/g, "'").replace(/\s+/g, ' ');
      if (normNonFix(exactFind) === normNonFix(exactReplace)) {
        logDebug('Non-FIX: normalized find === replace, skipping', { exactFind, exactReplace });
        continue;
      }
    }

    // v14.8: Usar generador intel·ligent de reasons per canvis de paràgraf
    let paraReason = change.reason || change.explanation;
    if (!paraReason || paraReason.length < 15) {
      // Usar generador intel·ligent en lloc de fallback genèric
      if (exactFind && exactReplace && exactFind !== exactReplace) {
        paraReason = generateSmartReason(exactFind, exactReplace, modificationType) || `Text reformulat`;
      } else {
        paraReason = `Reestructuració del paràgraf per millorar la claredat`;
      }
    }
    validated.push({
      id: generateItemId('c', changeIndex++),
      paragraph_id: change.paragraph_id,
      targetId: change.paragraph_id,     // v17.30: Alias per compatibilitat frontend
      // v16.6: find/replace per highlight precís
      find: exactFind,
      replace: exactReplace,
      // v17.1: highlight_find/highlight_replace per ressaltar NOMÉS el fragment canviat
      highlight_find: exactFind,
      highlight_replace: exactReplace,
      original: originalText,            // v14: text original complet
      replacement: change.new_text,      // v14: text nou complet
      before_text,                       // v14: igual que original per full-replace
      before_hash,                       // v14: hash per detecció STALE
      reason: paraReason,
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
    // v14.5: Buscar per ID, no per índex
    const para = documentContext.paragraphs.find(p => p.id === paraId) || documentContext.paragraphs[paraId];
    const paraText = para?.text || para || '';

    // v14.4: Determinar el text específic a ressaltar
    let textToHighlight;
    let start = 0;
    let end = paraText.length;

    // v17.11: Detectar si és canvi de paràgraf complet (sense find/replace vàlids)
    const hasValidFind = change.find && change.find.length > 0;
    const hasValidReplace = change.replace && change.replace.length > 0;
    const isFullParagraphChange = !hasValidFind && !hasValidReplace &&
      change.original_text && change.new_text &&
      change.original_text !== change.new_text;

    // v17.11: Per canvis de paràgraf complet, ressaltar TOT el paràgraf
    if (isFullParagraphChange) {
      textToHighlight = paraText;
      start = 0;
      end = paraText.length;
    }
    // v16.6: Prioritzar highlight_find (text exacte sense context) sobre find (amb context)
    // Mode FIX: ressaltar el fragment exacte que canvia
    else if (change.highlight_find) {
      textToHighlight = change.highlight_find;
      const pos = paraText.indexOf(textToHighlight);
      if (pos !== -1) {
        start = pos;
        end = pos + textToHighlight.length;
      }
    }
    // Fallback a find si no hi ha highlight_find
    else if (change.find) {
      textToHighlight = change.find;
      const pos = paraText.indexOf(textToHighlight);
      if (pos !== -1) {
        start = pos;
        end = pos + textToHighlight.length;
      }
    }
    // v16.6: Mode IMPROVE amb fragment original definit
    else if (change.original && typeof change.original === 'string' && change.original.length > 0 && change.original !== change.original_text) {
      textToHighlight = change.original;
      const pos = paraText.indexOf(textToHighlight);
      if (pos !== -1) {
        start = pos;
        end = pos + textToHighlight.length;
      } else {
        // Si no es troba el fragment exacte, primeres 3-4 paraules
        const words = paraText.split(/\s+/).slice(0, 4);
        textToHighlight = words.join(' ');
        start = 0;
        end = textToHighlight.length;
      }
    }
    // Altres modes: trobar la diferència entre original i new
    else if (change.original_text && change.new_text) {
      const diff = findTextDifference(change.original_text, change.new_text);
      if (diff && diff.originalFragment) {
        textToHighlight = diff.originalFragment;
        // v16.6: Buscar posició real dins del paràgraf
        const pos = paraText.indexOf(diff.originalFragment);
        if (pos !== -1) {
          start = pos;
          end = pos + diff.originalFragment.length;
        } else {
          start = diff.start;
          end = diff.end;
        }
      } else {
        // v16.2: Si no es pot determinar la diferència, primeres 3-4 paraules (mai tot)
        const words = paraText.split(/\s+/).slice(0, 4);
        textToHighlight = words.join(' ');
        start = 0;
        end = textToHighlight.length;
      }
    }
    // Fallback: usar original_text si existeix, o primeres paraules del paràgraf
    else {
      // v16.2: Corregit - usar original_text (no 'original' que no existeix)
      const fallbackText = change.original_text || change.original || null;
      if (fallbackText) {
        // Intentar trobar la diferència amb paraText
        const diff = findTextDifference(paraText, fallbackText);
        if (diff && diff.originalFragment) {
          textToHighlight = diff.originalFragment;
          start = diff.start;
          end = diff.end;
        } else {
          // Si no hi ha diferència clara, usar primeres 3-4 paraules
          const words = paraText.split(/\s+/).slice(0, 4);
          textToHighlight = words.join(' ');
          const pos = paraText.indexOf(textToHighlight);
          if (pos !== -1) {
            start = pos;
            end = pos + textToHighlight.length;
          }
        }
      } else {
        // Últim recurs: primeres 3-4 paraules del paràgraf (mai tot el paràgraf)
        const words = paraText.split(/\s+/).slice(0, 4);
        textToHighlight = words.join(' ');
        start = 0;
        end = textToHighlight.length;
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
      snippet: textToHighlight,  // v16.2: Afegir snippet per cerca precisa a Code.gs
      color: color,
      reason: change.reason || 'Canvi proposat',
      change_id: change.id,  // v14.2: Vincular highlight amb el canvi
    });
  }

  return highlights;
}

/**
 * v17.8: Troba la diferència entre dos textos - VERSIÓ MILLORADA
 * Suporta substitucions, insercions i eliminacions
 * Retorna el fragment del text original que ha canviat I el fragment modificat
 */
function findTextDifference(original, modified) {
  if (!original || !modified) return null;
  if (original === modified) return null;

  // Primer intentem amb l'algorisme de paraules (més precís per canvis petits)
  const wordDiff = findWordDifference(original, modified);
  if (wordDiff) {
    return wordDiff;
  }

  // Fallback a algorisme de caràcters
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

  // Calcular el fragment que canvia a l'original
  const startOrig = prefixLen;
  const endOrig = original.length - suffixLen;

  // Calcular el fragment que canvia al modified
  const startMod = prefixLen;
  const endMod = modified.length - suffixLen;

  // Si el canvi és massa gran (>80% del text), no ressaltar fragment específic
  const changeLen = Math.max(endOrig - startOrig, endMod - startMod);
  if (changeLen > original.length * 0.8) {
    return null;
  }

  // Expandir als límits de paraula
  let expandStartOrig = startOrig;
  let expandEndOrig = endOrig;

  // Retrocedir al principi de la paraula
  while (expandStartOrig > 0 && original[expandStartOrig - 1] !== ' ' && original[expandStartOrig - 1] !== '\n') {
    expandStartOrig--;
  }
  // Avançar al final de la paraula
  while (expandEndOrig < original.length && original[expandEndOrig] !== ' ' && original[expandEndOrig] !== '\n') {
    expandEndOrig++;
  }

  const originalFragment = original.substring(expandStartOrig, expandEndOrig).trim();

  // Fer el mateix per modified
  let expandStartMod = startMod;
  let expandEndMod = endMod;
  while (expandStartMod > 0 && modified[expandStartMod - 1] !== ' ' && modified[expandStartMod - 1] !== '\n') {
    expandStartMod--;
  }
  while (expandEndMod < modified.length && modified[expandEndMod] !== ' ' && modified[expandEndMod] !== '\n') {
    expandEndMod++;
  }

  const modifiedFragment = modified.substring(expandStartMod, expandEndMod).trim();

  // Si ambdós fragments són buits, retornar null
  if ((!originalFragment || originalFragment.length === 0) && (!modifiedFragment || modifiedFragment.length === 0)) {
    return null;
  }

  return {
    start: expandStartOrig,
    end: expandEndOrig,
    originalFragment: originalFragment || '',
    modifiedFragment: modifiedFragment || '',
  };
}

/**
 * v17.8: Troba diferències a nivell de paraules
 * Més precís per canvis petits (1-3 paraules)
 */
function findWordDifference(original, modified) {
  const origWords = original.split(/(\s+)/);  // Mantenir espais
  const modWords = modified.split(/(\s+)/);

  // Trobar primer índex diferent des del principi
  let startDiff = 0;
  while (startDiff < origWords.length && startDiff < modWords.length && origWords[startDiff] === modWords[startDiff]) {
    startDiff++;
  }

  // Trobar primer índex diferent des del final
  let endDiffOrig = origWords.length - 1;
  let endDiffMod = modWords.length - 1;
  while (endDiffOrig >= startDiff && endDiffMod >= startDiff && origWords[endDiffOrig] === modWords[endDiffMod]) {
    endDiffOrig--;
    endDiffMod--;
  }

  // Si no hi ha diferència
  if (startDiff > endDiffOrig && startDiff > endDiffMod) {
    return null;
  }

  // Extreure fragments
  const origDiffWords = origWords.slice(startDiff, endDiffOrig + 1);
  const modDiffWords = modWords.slice(startDiff, endDiffMod + 1);

  const originalFragment = origDiffWords.join('').trim();
  const modifiedFragment = modDiffWords.join('').trim();

  // Si el canvi és massa gran (>5 paraules), deixar que l'algorisme de caràcters ho gestioni
  const origWordCount = origDiffWords.filter(w => w.trim()).length;
  const modWordCount = modDiffWords.filter(w => w.trim()).length;
  if (origWordCount > 5 || modWordCount > 5) {
    return null;
  }

  // Calcular posició al text original
  const prefix = origWords.slice(0, startDiff).join('');
  const start = prefix.length;
  const end = start + origDiffWords.join('').length;

  return {
    start,
    end,
    originalFragment,
    modifiedFragment,
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
