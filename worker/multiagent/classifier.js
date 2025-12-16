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

const CLASSIFIER_SYSTEM_PROMPT = `Ets el Router d'Intencions de Docmile v13.6. Retorna JSON estricte.

## ⚠️ REGLA SUPREMA: VISUAL-FIRST (RESSALTAR SEMPRE QUE SIGUI POSSIBLE) ⚠️

PRINCIPI CLAU: Si la resposta pot senyalar parts del document → REFERENCE_HIGHLIGHT
CHAT_ONLY només per preguntes SENSE relació amb el document.

### DECISIÓ RÀPIDA:
1. La resposta pot apuntar a parts específiques del document? → REFERENCE_HIGHLIGHT
2. És una pregunta general sense relació amb el document? → CHAT_ONLY
3. Vol modificar el document? → UPDATE_BY_ID o REWRITE

### EXEMPLES CRÍTICS:
| Instrucció | Mode | Per què |
|------------|------|---------|
| "Qui signa l'informe?" | REFERENCE_HIGHLIGHT | Localitzar ON apareix el signant |
| "On apareix el pressupost?" | REFERENCE_HIGHLIGHT | Explícitament vol localitzar |
| "Busca 'PAE'" | REFERENCE_HIGHLIGHT | Buscar un terme específic |
| "Revisa l'ortografia" | REFERENCE_HIGHLIGHT | Detectar i marcar errors |
| "De què parla el document?" | CHAT_ONLY | Explicació general, resposta al xat |
| "Resumeix el document" | CHAT_ONLY | Resum textual, resposta al xat |
| "Explica el contingut" | CHAT_ONLY | Explicació, resposta al xat |
| "Què és un framework?" | CHAT_ONLY | Pregunta general, no relacionada amb el doc |
| "Hola, com estàs?" | CHAT_ONLY | Conversa social |

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

### "Pots/Podries + verb" = ACCIÓ (no pregunta)
- "Pots corregir?" → UPDATE_BY_ID (fix)
- "Podries millorar?" → UPDATE_BY_ID (improve)

### Diferència REVISA vs CORREGEIX
- "Revisa X" → REFERENCE_HIGHLIGHT (només marca, no modifica)
- "Corregeix X" → UPDATE_BY_ID (modifica el document)

### Extracció de keywords
- Entre cometes → terme EXACTE: "busca 'la'" → ["la"]
- Sense cometes → últim substantiu: "on apareix PAE" → ["PAE"]

## OUTPUT JSON
{
  "thought": "<raonament breu 1 frase>",
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
  "is_question": true|false
}

## EXEMPLES

### Pregunta general sobre el document → CHAT_ONLY (resposta al xat)
Instrucció: "De què va el document?"
{"thought":"Pregunta general sobre el contingut, requereix resposta textual sense ressaltar","mode":"CHAT_ONLY","confidence":0.95,"response_style":"concise","is_question":true,"risk_level":"none"}

### Pregunta general sobre el contingut → CHAT_ONLY
Instrucció: "Què diu aquest text?"
{"thought":"Demana explicació del contingut, resposta al xat","mode":"CHAT_ONLY","confidence":0.95,"response_style":"concise","is_question":true,"risk_level":"none"}

### Pregunta específica que requereix LOCALITZAR text → REFERENCE_HIGHLIGHT
Instrucció: "Qui signa l'informe?"
{"thought":"Pregunta específica que requereix trobar i ressaltar ON apareix la informació","mode":"REFERENCE_HIGHLIGHT","confidence":0.95,"highlight_strategy":"mentions","is_question":true,"risk_level":"none"}

### On apareix X → REFERENCE_HIGHLIGHT (localitzar)
Instrucció: "On parla de pressupost?"
{"thought":"Demana localitzar on apareix un tema, cal ressaltar","mode":"REFERENCE_HIGHLIGHT","confidence":0.95,"highlight_strategy":"mentions","keywords":["pressupost"],"is_question":true,"risk_level":"none"}

### Resumeix → CHAT_ONLY (resposta al xat, NO ressaltar)
Instrucció: "Resumeix el document"
{"thought":"Demana resum, és una pregunta/consulta que requereix resposta textual al xat, NO modificar ni ressaltar","mode":"CHAT_ONLY","confidence":0.95,"response_style":"bullet_points","is_question":true,"risk_level":"none"}

### Fes un resum → CHAT_ONLY
Instrucció: "Fes un resum del text"
{"thought":"Demana resum, resposta al xat sense tocar el document","mode":"CHAT_ONLY","confidence":0.95,"response_style":"bullet_points","is_question":true,"risk_level":"none"}

### Explica el contingut → CHAT_ONLY
Instrucció: "Explica el contingut d'aquest text"
{"thought":"Demana explicació del contingut, resposta textual al xat","mode":"CHAT_ONLY","confidence":0.95,"response_style":"detailed","is_question":true,"risk_level":"none"}

### Explica destacant idees → CHAT_ONLY (NO ressaltar)
Instrucció: "Explica el contingut d'aquest text de forma clara, destacant les idees principals"
{"thought":"'Destacant' aquí significa 'emfatitzant' en l'explicació, NO ressaltar al document. Resposta al xat.","mode":"CHAT_ONLY","confidence":0.95,"response_style":"detailed","is_question":true,"risk_level":"none"}

### Pregunta general (NO relacionada amb el document) → CHAT_ONLY
Instrucció: "Què és un blockchain?"
{"thought":"Pregunta general de coneixement, no relacionada amb el document","mode":"CHAT_ONLY","confidence":0.95,"response_style":"concise","is_question":true,"risk_level":"none"}

### Revisa vs Corregeix
Instrucció: "Revisa l'ortografia"
{"thought":"Revisa = marcar errors, no modificar","mode":"REFERENCE_HIGHLIGHT","confidence":0.95,"highlight_strategy":"errors","is_question":false,"risk_level":"low"}

Instrucció: "Corregeix les faltes"
{"thought":"Corregeix = modificar document","mode":"UPDATE_BY_ID","confidence":0.95,"modification_type":"fix","scope":"document","is_question":false,"risk_level":"medium"}`;

// ═══════════════════════════════════════════════════════════════
// API CALL FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix el prompt d'usuari per al classifier
 */
function buildUserPrompt(sanitizedInput, documentContext, conversationContext) {
  let prompt = `## INSTRUCCIÓ DE L'USUARI
"${sanitizedInput.original}"

## IDIOMA DETECTAT
${sanitizedInput.language}
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
