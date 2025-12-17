/**
 * Multi-Agent System Classifier v8.3
 *
 * Agent classificador que determina l'intent de l'usuari a partir
 * de la instrucció i el context del document/conversa.
 *
 * Utilitza Gemini 2.0 Flash com a model principal amb fallback a Claude Haiku.
 */

import {
  Mode,
  ActionType,
  Scope,
  HighlightStrategy,
  RiskLevel,
  createDefaultIntent,
  validateIntentPayload,
} from './types.js';
import { API, TIMEOUTS, CONFIDENCE_THRESHOLDS, TEMPERATURES } from './config.js';
import { logInfo, logError, logDebug } from './telemetry.js';

// ═══════════════════════════════════════════════════════════════
// CLASSIFIER SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════

const CLASSIFIER_SYSTEM_PROMPT = `Ets el Router d'Intencions de Docmile v15.0. Retorna JSON estricte.

## ⚠️ CONCEPTE CLAU: OUTPUT_TARGET (On vol la resposta?) ⚠️

ABANS de decidir el mode, pregunta't: "ON vol l'usuari el resultat?"

| output_target | Significat | Quan usar |
|---------------|------------|-----------|
| chat | Resposta al sidebar | Preguntes, explicacions, resums informatius |
| document | Acció al document | Ressaltar, corregir, modificar |
| auto | Incert, demanar clarificació | Ambigüitat genuïna |

### INDICADORS LINGÜÍSTICS (la IA ha d'inferir-los)

**→ output_target: "chat" (vol RESPOSTA al xat):**
- Preguntes corteses: "Pots...?", "Podries...?", "Em pots dir...?"
- Demandes d'informació: "Fes-me un resum", "Explica'm", "Què diu?"
- Forma interrogativa: "Quin és...?", "Com funciona...?", "De què va...?"
- "Resumeix" (vol resum INFORMATIU, no modificar)

**→ output_target: "document" (vol ACCIÓ al document):**
- Imperatius directes: "Corregeix", "Escurça", "Tradueix", "Millora"
- Verbs de transformació: "Canvia", "Modifica", "Redueix a la meitat"
- "Revisa l'ortografia" (vol que es MARQUIN els errors)

**→ output_target: "auto" (EVITAR - usar només si impossibilitat real):**
- Quasi mai necessari - sempre intenta decidir 'chat' o 'document'
- Si tens el document i la instrucció, POTS decidir

### EXEMPLES CRÍTICS output_target:
| Instrucció | output_target | mode | Per què |
|------------|---------------|------|---------|
| "Pots resumir el text?" | chat | CHAT_ONLY | Pregunta cortesa, vol RESPOSTA |
| "Resumeix el document" | chat | CHAT_ONLY | Vol resum INFORMATIU |
| "Escurça el text a la meitat" | document | UPDATE_BY_ID | Vol MODIFICAR |
| "Fes-me un resum" | chat | CHAT_ONLY | "Fes-me" = donar-li algo |
| "Corregeix les faltes" | document | UPDATE_BY_ID | Imperatiu de modificació |
| "Revisa l'ortografia" | document | REFERENCE_HIGHLIGHT | Vol RESSALTAR errors |
| "Hi ha errors/faltes?" | document | REFERENCE_HIGHLIGHT | Vol VEURE errors al document |
| "De què parla el document?" | chat | CHAT_ONLY | Pregunta informativa |
| "Qui signa l'informe?" | document | REFERENCE_HIGHLIGHT | Vol LOCALITZAR |
| "Hola, com estàs?" | chat | CHAT_ONLY | Conversa social |

## COHERÈNCIA output_target ↔ mode
- output_target: "chat" → mode HA DE SER "CHAT_ONLY"
- output_target: "document" → mode pot ser REFERENCE_HIGHLIGHT, UPDATE_BY_ID, REWRITE
- output_target: "auto" → usar el mode classificat (rarament necessari)

## MATRIU DE DECISIÓ (ORDRE DE PRIORITAT ESTRICTE)

### PRIORITAT 0: CHAT_ONLY (Només preguntes SENSE relació amb el document)
Usar NOMÉS quan:
- Conversa social: "hola", "gràcies", "adéu"
- Preguntes generals de coneixement NO relacionades amb el document
- L'usuari demana ajuda sobre l'eina
response_style:
- Si conté "resumeix/resum/sintetitza" → "bullet_points"
- Si conté "explica/analitza/detalla" → "detailed"
- Resta → "concise"

### PRIORITAT 1: REFERENCE_HIGHLIGHT (Qualsevol consulta sobre el document)
| Patró | highlight_strategy | Exemple |
|-------|-------------------|---------|
| "veus/hi ha/detecta" + "error/falta" | errors | "Veus faltes?" |
| "revisa" + "ortografia/gramàtica" | errors | "Revisa l'ortografia" |
| "busca/troba" + terme | mentions | "Busca 'PAE'" |
| "on apareix/surt/parla de" | mentions | "On parla de pressupost?" |
| "suggeriments/què puc millorar" | suggestions | "Què puc millorar?" |
| "estructura/apartats" | structure | "Quina estructura té?" |
| "revisa tot/revisió completa" | all | "Fes una revisió completa" |

### PRIORITAT 2: UPDATE_BY_ID (Modificació Activa)
| Patró | modification_type | Exemple |
|-------|-------------------|---------|
| "corregeix/arregla/esmena" | fix | "Corregeix les faltes" |
| "millora/poleix/refina" (sense to) | improve | "Millora el text" |
| "amplia/desenvolupa/elabora" | expand | "Amplia el punt 3" |
| "simplifica/escurça/condensa" | simplify | "Simplifica el text" |
| "tradueix/passa a" + idioma | translate | "Tradueix a anglès" |

### PRIORITAT 3: REWRITE (Transformació Global)
| Patró | requires_confirmation |
|-------|-----------------------|
| "fes més formal/informal" | true |
| "canvia el to/estil" | true |
| "reescriu/reformula" (tot) | true |
| "escriu un/genera/crea" (nou) | true |

## REGLES ESPECIALS

### "Pots/Podries + verb" → DEPÈN DEL CONTEXT (v15.0)
La forma "Pots...?" és cortesa però l'output_target depèn del verb:
- "Pots resumir?" → output_target: chat (vol RESPOSTA informativa)
- "Pots corregir les faltes?" → output_target: document (vol ACCIÓ)
- "Pots explicar què diu?" → output_target: chat (vol RESPOSTA)

### Diferència REVISA vs CORREGEIX
- "Revisa X" → REFERENCE_HIGHLIGHT (només marca, no modifica)
- "Corregeix X" → UPDATE_BY_ID (modifica el document)

### Diferència RESUMEIX vs ESCURÇA
- "Resumeix" / "Fes un resum" → output_target: chat (vol resposta informativa)
- "Escurça" / "Condensa" / "Redueix" → output_target: document (vol modificar)

### ⚠️ SELECCIÓ ACTIVA (v14.6) - REGLA CRÍTICA ⚠️
Si "Selecció: PARCIAL" (l'usuari ha seleccionat text específic):
- Verbs de transformació (resumeix, tradueix, reformula, simplifica, millora) → output_target: document, mode: UPDATE_BY_ID
- L'usuari vol TRANSFORMAR el text seleccionat, NO rebre resposta al xat
- "Resumeix el text" + selecció activa → EDITAR (substituir selecció pel resum)
- "Resumeix el text" + sense selecció → CHAT (resum informatiu)

Exemples amb selecció PARCIAL activa:
| Instrucció | output_target | mode | Per què |
|------------|---------------|------|---------|
| "Resumeix" | document | UPDATE_BY_ID | Vol substituir selecció pel resum |
| "Tradueix a anglès" | document | UPDATE_BY_ID | Vol traduir la selecció |
| "Millora el text" | document | UPDATE_BY_ID | Vol millorar la selecció |
| "De què parla?" | chat | CHAT_ONLY | Pregunta sobre la selecció |

### Extracció de keywords
- Entre cometes → terme EXACTE: "busca 'la'" → ["la"]
- Sense cometes → últim substantiu: "on apareix PAE" → ["PAE"]

## OUTPUT JSON
{
  "thought": "<raonament breu 1 frase>",
  "output_target": "chat|document|auto",
  "mode": "CHAT_ONLY|REFERENCE_HIGHLIGHT|UPDATE_BY_ID|REWRITE",
  "confidence": 0.0-1.0,
  "response_style": "concise|bullet_points|detailed|null",
  "highlight_strategy": "errors|mentions|suggestions|structure|all|null",
  "modification_type": "fix|improve|expand|simplify|translate|null",
  "keywords": [],
  "target_paragraphs": [],
  "scope": "selection|paragraph|document",
  "requires_confirmation": false,
  "risk_level": "none|low|medium|high",
  "is_question": true|false,
  "suggested_followup": "<text del botó> | null"
}

## REGLA DE COHERÈNCIA AUTOMÀTICA
Si output_target="chat" però has posat mode≠CHAT_ONLY → CANVIA mode a CHAT_ONLY
(El router valida i corregeix automàticament)

## EXEMPLES (tots amb output_target)

### Pregunta cortesa "Pots resumir?" → CHAT (vol resposta)
Instrucció: "Pots resumir el text?"
{"thought":"Pregunta cortesa, vol resposta informativa al xat","output_target":"chat","mode":"CHAT_ONLY","confidence":0.95,"response_style":"bullet_points","is_question":true,"risk_level":"none"}

### "Resumeix el document" → CHAT (vol resum informatiu)
Instrucció: "Resumeix el document"
{"thought":"Vol resum informatiu al xat, no modificar","output_target":"chat","mode":"CHAT_ONLY","confidence":0.95,"response_style":"bullet_points","is_question":false,"risk_level":"none","suggested_followup":"Vols que escurci el document?"}

### "Fes-me un resum" → CHAT ("fes-me" = donar-li algo)
Instrucció: "Fes-me un resum dels punts principals"
{"thought":"'Fes-me' indica que vol rebre algo, no modificar","output_target":"chat","mode":"CHAT_ONLY","confidence":0.95,"response_style":"bullet_points","is_question":false,"risk_level":"none"}

### "Escurça el text" → DOCUMENT (vol modificar)
Instrucció: "Escurça el text a la meitat"
{"thought":"Imperatiu de transformació, vol modificar el document","output_target":"document","mode":"UPDATE_BY_ID","confidence":0.95,"modification_type":"simplify","scope":"document","is_question":false,"risk_level":"medium"}

### "Corregeix les faltes" → DOCUMENT (vol modificar)
Instrucció: "Corregeix les faltes"
{"thought":"Imperatiu directe de correcció","output_target":"document","mode":"UPDATE_BY_ID","confidence":0.95,"modification_type":"fix","scope":"document","is_question":false,"risk_level":"medium"}

### "Revisa l'ortografia" → DOCUMENT (vol ressaltar)
Instrucció: "Revisa l'ortografia"
{"thought":"Revisa = marcar errors, no modificar","output_target":"document","mode":"REFERENCE_HIGHLIGHT","confidence":0.95,"highlight_strategy":"errors","is_question":false,"risk_level":"low"}

### "Hi ha errors/faltes?" → DOCUMENT (vol VEURE els errors)
Instrucció: "Hi ha faltes?"
{"thought":"Vol veure si hi ha errors, cal revisar i ressaltar-los","output_target":"document","mode":"REFERENCE_HIGHLIGHT","confidence":0.95,"highlight_strategy":"errors","is_question":true,"risk_level":"low"}

### "Qui signa?" → DOCUMENT (vol localitzar)
Instrucció: "Qui signa l'informe?"
{"thought":"Vol localitzar ON apareix la informació","output_target":"document","mode":"REFERENCE_HIGHLIGHT","confidence":0.95,"highlight_strategy":"mentions","is_question":true,"risk_level":"none"}

### "Explica el contingut" → CHAT (vol explicació)
Instrucció: "Explica el contingut d'aquest text"
{"thought":"Demana explicació, resposta al xat","output_target":"chat","mode":"CHAT_ONLY","confidence":0.95,"response_style":"detailed","is_question":false,"risk_level":"none"}

### Pregunta general → CHAT
Instrucció: "Què és un blockchain?"
{"thought":"Pregunta general de coneixement","output_target":"chat","mode":"CHAT_ONLY","confidence":0.95,"response_style":"concise","is_question":true,"risk_level":"none"}`;

// ═══════════════════════════════════════════════════════════════
// API CALL FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix el prompt d'usuari per al classifier
 */
function buildUserPrompt(sanitizedInput, documentContext, conversationContext) {
  // v14.6: Determinar selecció amb més detall
  let selectionInfo = 'CAP (sense selecció)';
  let selectionHint = '';

  if (documentContext?.hasSelection) {
    if (documentContext?.isPartialSelection) {
      const selectedIds = documentContext?.selectedParagraphIds || [];
      selectionInfo = `PARCIAL (${selectedIds.length} paràgraf${selectedIds.length !== 1 ? 's' : ''} seleccionat${selectedIds.length !== 1 ? 's' : ''})`;
      selectionHint = '\n⚠️ ATENCIÓ: Amb selecció parcial, verbs de transformació (resumeix, tradueix, simplifica) → UPDATE_BY_ID, NO CHAT_ONLY';
    } else {
      selectionInfo = 'TOT EL DOCUMENT o molt extensa';
    }
  }

  let prompt = `## INSTRUCCIÓ DE L'USUARI
"${sanitizedInput.original}"

## IDIOMA DETECTAT
${sanitizedInput.language}

## MODE DE L'USUARI
- Mode: ${documentContext?.userMode === 'chat' ? 'CHAT (l\'usuari NO vol modificacions)' : 'EDIT (l\'usuari permet modificacions)'}
- Selecció: ${selectionInfo}${selectionHint}
`;

  // Afegir context del document si disponible
  if (documentContext) {
    prompt += `
## DOCUMENT
- Total paràgrafs: ${documentContext.paragraphs?.length || 0}
- Resum: ${documentContext.summary || 'No disponible'}
`;

    // Afegir estructura de headings si existeix
    if (documentContext.structure && documentContext.structure.length > 0) {
      // v12.1: Mostrar amb §N (1-indexed per consistència UI)
      prompt += `- Estructura: ${documentContext.structure.map(h => `${h.text} (§${h.id + 1})`).join(', ')}
`;
    }
  }

  // Afegir context de conversa si disponible
  if (conversationContext && conversationContext.turns && conversationContext.turns.length > 0) {
    const lastTurns = conversationContext.turns.slice(-2);
    prompt += `
## CONTEXT DE CONVERSA (últims 2 torns)
`;
    for (const turn of lastTurns) {
      prompt += `- ${turn.role}: "${turn.content.substring(0, 200)}${turn.content.length > 200 ? '...' : ''}"
`;
      if (turn.mode) {
        prompt += `  (mode: ${turn.mode})
`;
      }
    }

    if (conversationContext.mentioned_paragraphs?.length > 0) {
      prompt += `- Paràgrafs mencionats recentment: ${conversationContext.mentioned_paragraphs.join(', ')}
`;
    }
  }

  // Afegir referències detectades
  if (sanitizedInput.ref_hints && sanitizedInput.ref_hints.length > 0) {
    prompt += `
## REFERÈNCIES DETECTADES
`;
    for (const ref of sanitizedInput.ref_hints) {
      prompt += `- ${ref.type}: ${ref.value} ("${ref.raw_match}")
`;
    }
  }

  prompt += `
## TASCA
Analitza la instrucció i retorna un JSON amb l'intent classificat.
Retorna NOMÉS el JSON, sense explicacions addicionals.`;

  return prompt;
}

/**
 * Crida a l'API de Gemini per classificar
 * @param {string} userPrompt - Prompt de l'usuari
 * @param {string} apiKey - API key de Gemini
 * @param {AbortSignal} [signal] - Signal per cancel·lar
 * @returns {Promise<Object|null>} - IntentPayload o null si falla
 */
async function callGeminiClassifier(userPrompt, apiKey, signal) {
  const startTime = Date.now();

  try {
    const url = `${API.gemini.base_url}/models/${API.gemini.classifier_model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: CLASSIFIER_SYSTEM_PROMPT + '\n\n' + userPrompt }],
          },
        ],
        generationConfig: {
          temperature: TEMPERATURES.classifier,  // v12.1: 0.0 per determinisme absolut
          maxOutputTokens: 4096,
          topP: 0.8,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
      signal,
    });

    const latency = Date.now() - startTime;
    logDebug('Gemini classifier response', { status: response.status, latency });

    if (!response.ok) {
      const errorText = await response.text();
      logError('Gemini API error', { status: response.status, error: errorText });
      return null;
    }

    const data = await response.json();

    // Extreure el text de la resposta
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      logError('Gemini empty response', { data });
      return null;
    }

    // Parsejar el JSON de la resposta
    const intent = parseClassifierResponse(text);

    if (intent) {
      intent._meta = {
        model: API.gemini.classifier_model,
        latency_ms: latency,
      };
    }

    return intent;

  } catch (error) {
    if (error.name === 'AbortError') {
      logInfo('Classifier call aborted (timeout)');
    } else {
      logError('Gemini classifier error', { error: error.message });
    }
    return null;
  }
}

/**
 * Parseja la resposta del classifier i extreu el JSON
 */
function parseClassifierResponse(text) {
  try {
    // Intentar parsejar directament
    let jsonStr = text.trim();

    // Si la resposta està envoltada de ```json ... ```
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Parsejar el JSON
    const parsed = JSON.parse(jsonStr);

    // Validar camps requerits
    const validation = validateIntentPayload(parsed);
    if (!validation.valid) {
      logError('Invalid intent payload', { errors: validation.errors });
      // Intentar reparar els camps faltants
      return repairIntent(parsed);
    }

    return normalizeIntent(parsed);

  } catch (error) {
    logError('Failed to parse classifier response', { error: error.message, text: text.substring(0, 500) });
    return null;
  }
}

/**
 * Normalitza l'intent per assegurar consistència
 */
function normalizeIntent(intent) {
  const defaults = createDefaultIntent();

  return {
    mode: intent.mode || defaults.mode,
    confidence: typeof intent.confidence === 'number' ? Math.max(0, Math.min(1, intent.confidence)) : defaults.confidence,
    // v12.1: thought field per chain-of-thought del classifier
    thought: intent.thought || '',
    reasoning: intent.reasoning || defaults.reasoning,
    // v12.1: response_style per CHAT_ONLY (concise|bullet_points|detailed)
    response_style: intent.response_style || null,
    secondary_mode: intent.secondary_mode || null,
    secondary_confidence: typeof intent.secondary_confidence === 'number' ? intent.secondary_confidence : null,
    action_type: intent.action_type || defaults.action_type,
    scope: intent.scope || defaults.scope,
    // v12.1: Convertir de 1-indexed (usuari/LLM) a 0-indexed (intern)
    target_paragraphs: Array.isArray(intent.target_paragraphs)
      ? intent.target_paragraphs.map(id => id - 1).filter(id => id >= 0)
      : [],
    keywords: Array.isArray(intent.keywords) ? intent.keywords : [],
    highlight_strategy: intent.highlight_strategy || null,
    expected_count: intent.expected_count || null,
    color_scheme: intent.color_scheme || null,
    modification_type: intent.modification_type || null,
    preserve_structure: intent.preserve_structure !== false,
    preserve_tone: intent.preserve_tone !== false,
    requires_confirmation: intent.requires_confirmation || false,
    risk_level: intent.risk_level || defaults.risk_level,
    is_question: intent.is_question || false,
    resolved_references: Array.isArray(intent.resolved_references) ? intent.resolved_references : [],
    // v15.0: On vol l'usuari el resultat (Intel·ligent Output Routing)
    output_target: intent.output_target || 'auto',
  };
}

/**
 * Intenta reparar un intent amb camps faltants
 */
function repairIntent(partial) {
  const defaults = createDefaultIntent();

  // Si no hi ha mode, intentar inferir-lo
  if (!partial.mode) {
    if (partial.highlight_strategy || partial.keywords?.length > 0) {
      partial.mode = Mode.REFERENCE_HIGHLIGHT;
    } else if (partial.modification_type || partial.target_paragraphs?.length > 0) {
      partial.mode = Mode.UPDATE_BY_ID;
    } else {
      partial.mode = Mode.CHAT_ONLY;
    }
  }

  // Si no hi ha confidence, usar 0.5 (baixa per seguretat)
  if (typeof partial.confidence !== 'number') {
    partial.confidence = 0.5;
  }

  // v15.0: Coherència output_target ↔ mode
  // Si output_target='chat' però mode≠CHAT_ONLY, forçar coherència
  if (partial.output_target === 'chat' && partial.mode !== Mode.CHAT_ONLY) {
    logDebug('repairIntent: Forcing CHAT_ONLY due to output_target=chat', {
      original_mode: partial.mode,
    });
    partial.mode = Mode.CHAT_ONLY;
  }

  // Completar amb defaults
  return normalizeIntent({ ...defaults, ...partial });
}

// ═══════════════════════════════════════════════════════════════
// MAIN CLASSIFIER FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Classifica una instrucció i retorna l'intent
 *
 * @param {SanitizedInput} sanitizedInput - Input sanititzat
 * @param {DocumentContext} documentContext - Context del document
 * @param {ConversationContext} conversationContext - Context de conversa
 * @param {string} apiKey - API key de Gemini
 * @returns {Promise<IntentPayload>} - Intent classificat
 */
async function classifyInstruction(sanitizedInput, documentContext, conversationContext, apiKey) {
  // Construir el prompt
  const userPrompt = buildUserPrompt(sanitizedInput, documentContext, conversationContext);

  logDebug('Classifying instruction', {
    instruction_length: sanitizedInput.original?.length,
    has_document: !!documentContext,
    has_conversation: !!conversationContext,
  });

  // Crear abort controller per timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.classifier);

  try {
    // Cridar Gemini
    const intent = await callGeminiClassifier(userPrompt, apiKey, controller.signal);

    if (intent) {
      logInfo('Classification successful', {
        mode: intent.mode,
        confidence: intent.confidence,
        latency: intent._meta?.latency_ms,
      });
      return intent;
    }

    // Si Gemini falla, tornar default
    logError('Classification failed, returning default');
    return createDefaultIntent();

  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Comprova si la confiança és suficient per al mode
 */
function isConfidenceSufficient(intent) {
  const threshold = CONFIDENCE_THRESHOLDS[intent.mode] || CONFIDENCE_THRESHOLDS.CHAT_ONLY;
  return intent.confidence >= threshold;
}

/**
 * Comprova si la confiança és molt baixa (necessita clarificació)
 */
function needsClarification(intent) {
  return intent.confidence < CONFIDENCE_THRESHOLDS.VERY_LOW;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  classifyInstruction,
  callGeminiClassifier,
  buildUserPrompt,
  parseClassifierResponse,
  normalizeIntent,
  isConfidenceSufficient,
  needsClarification,
  CLASSIFIER_SYSTEM_PROMPT,
};
