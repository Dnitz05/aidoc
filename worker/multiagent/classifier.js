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
import { API, TIMEOUTS, CONFIDENCE_THRESHOLDS } from './config.js';
import { logInfo, logError, logDebug } from './telemetry.js';

// ═══════════════════════════════════════════════════════════════
// CLASSIFIER SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════

const CLASSIFIER_SYSTEM_PROMPT = `Ets un classificador d'intents per a un assistent de documents.
La teva ÚNICA tasca és analitzar la instrucció i retornar un JSON estructurat.

## MODES DISPONIBLES

1. **CHAT_ONLY**: Respondre preguntes, explicar, conversar sense modificar el document.
   - "Què diu l'article 3?"
   - "Explica'm el document"
   - "Quin és el tema principal?"

2. **REFERENCE_HIGHLIGHT**: Marcar/destacar parts del document SENSE modificar-lo.
   - "Veus errors?" → Marcar errors trobats
   - "On parla de pressupost?" → Marcar mencions
   - "Revisa si es cita X" → Marcar on apareix X
   - "Assenyala les inconsistències" → Marcar problemes

3. **UPDATE_BY_ID**: Modificar paràgrafs específics identificats.
   - "Corregeix l'article 5"
   - "Millora el tercer paràgraf"
   - "Canvia X per Y al paràgraf 3"

4. **REWRITE**: Reescriure parts substancials o tot el document.
   - "Fes el document més formal"
   - "Reescriu la introducció"
   - "Resumeix tot el document"

## REGLES CRÍTIQUES

### Preguntes vs Accions
- Si la instrucció és una PREGUNTA PURA sense intent d'edició → CHAT_ONLY o REFERENCE_HIGHLIGHT
- Una pregunta que demana LOCALITZAR/TROBAR/REVISAR → REFERENCE_HIGHLIGHT
- "Veus X?" / "Hi ha X?" / "Trobes X?" → REFERENCE_HIGHLIGHT (mostrar al document)
- EXCEPCIÓ IMPORTANT: "Pots corregir/arreglar/millorar X?" = intent d'ACCIÓ → UPDATE_BY_ID o REWRITE
- Verbs d'ACCIÓ (corregir, arreglar, esmenar, millorar, canviar) → UPDATE_BY_ID encara que sigui pregunta
- "Pots corregir les faltes?" → UPDATE_BY_ID (no REFERENCE_HIGHLIGHT!)

### Quan triar REFERENCE_HIGHLIGHT
- Qualsevol instrucció que demani LOCALITZAR, TROBAR, IDENTIFICAR, REVISAR, COMPROVAR
- Preguntes sobre existència/ubicació de contingut
- Anàlisi que requereix mostrar ON al document
- "Revisa si..." / "Comprova que..." → REFERENCE_HIGHLIGHT
- Detecció d'errors, problemes, inconsistències

### Quan triar CHAT_ONLY
- Preguntes que demanen EXPLICACIÓ sense mostrar ubicació
- "Què significa...?", "Explica...", "Resumeix..." (sense modificar)
- Preguntes sobre el contingut general
- Conversa i interacció sense acció sobre el document

### Granularitat de Highlights
- SEMPRE prefereix marcar text específic sobre paràgrafs sencers
- scope: "word" > "phrase" > "sentence" > "paragraph"
- Proporciona keywords per facilitar la cerca

### Anàfores (referències a context previ)
- "això", "l'anterior", "el següent" → Resol amb conversation_context
- "el 4" després de parlar d'articles → "article 4"
- "marca-ho" → Refereix al que s'acaba de discutir

### Confirmació i Risc
- REWRITE sempre requereix confirmació (risk_level: "high")
- UPDATE_BY_ID que afecta >50% del paràgraf → risk_level: "medium"
- Accions destructives (eliminar, esborrar tot) → requires_confirmation: true

## OUTPUT FORMAT

Retorna NOMÉS un objecte JSON vàlid amb aquests camps:

{
  "mode": "REFERENCE_HIGHLIGHT",
  "confidence": 0.92,
  "reasoning": "Demana revisar mencions, necessita localitzar",
  "secondary_mode": null,
  "secondary_confidence": null,
  "action_type": "locate",
  "scope": "phrase",
  "target_paragraphs": [],
  "keywords": ["serveis de cultura"],
  "highlight_strategy": "mentions",
  "expected_count": "few",
  "color_scheme": null,
  "modification_type": null,
  "preserve_structure": true,
  "preserve_tone": true,
  "requires_confirmation": false,
  "risk_level": "low",
  "is_question": true,
  "resolved_references": []
}

## EXEMPLES

### Exemple 1: Pregunta sobre errors
Instrucció: "Veus faltes al document?"
{
  "mode": "REFERENCE_HIGHLIGHT",
  "confidence": 0.95,
  "reasoning": "Pregunta sobre errors, cal mostrar-los al document",
  "action_type": "analyze",
  "scope": "word",
  "keywords": [],
  "highlight_strategy": "errors",
  "expected_count": "few",
  "is_question": true,
  "risk_level": "low"
}

### Exemple 2: Localització de mencions
Instrucció: "Pots revisar si es citen els serveis de cultura?"
{
  "mode": "REFERENCE_HIGHLIGHT",
  "confidence": 0.93,
  "reasoning": "Revisar si es cita = localitzar mencions",
  "action_type": "locate",
  "scope": "phrase",
  "keywords": ["serveis de cultura", "servei de cultura", "departament cultural"],
  "highlight_strategy": "mentions",
  "expected_count": "few",
  "is_question": true,
  "risk_level": "low"
}

### Exemple 3: Pregunta de contingut
Instrucció: "Què diu l'article 3?"
{
  "mode": "CHAT_ONLY",
  "confidence": 0.90,
  "reasoning": "Pregunta sobre contingut, no cal marcar",
  "action_type": "explain",
  "scope": "paragraph",
  "target_paragraphs": [3],
  "is_question": true,
  "risk_level": "none"
}

### Exemple 4: Correcció específica
Instrucció: "Corregeix les faltes del paràgraf 5"
{
  "mode": "UPDATE_BY_ID",
  "confidence": 0.88,
  "reasoning": "Ordre de correcció a paràgraf específic",
  "action_type": "modify",
  "scope": "word",
  "target_paragraphs": [5],
  "modification_type": "fix",
  "is_question": false,
  "risk_level": "medium"
}

### Exemple 5: Reescriptura global
Instrucció: "Fes el document més formal"
{
  "mode": "REWRITE",
  "confidence": 0.91,
  "reasoning": "Canvi d'estil global requereix reescriptura",
  "action_type": "modify",
  "scope": "document",
  "modification_type": "improve",
  "preserve_structure": true,
  "requires_confirmation": true,
  "risk_level": "high",
  "is_question": false
}

### Exemple 6: Instrucció ambigua
Instrucció: "Corregeix l'article 5"
{
  "mode": "UPDATE_BY_ID",
  "confidence": 0.68,
  "reasoning": "Ambigu: corregir errors o millorar contingut?",
  "secondary_mode": "REFERENCE_HIGHLIGHT",
  "secondary_confidence": 0.55,
  "action_type": "modify",
  "target_paragraphs": [5],
  "is_question": false,
  "risk_level": "medium"
}

### Exemple 7: Petició d'acció en forma de pregunta (IMPORTANT!)
Instrucció: "Pots corregir les faltes del document?"
{
  "mode": "UPDATE_BY_ID",
  "confidence": 0.90,
  "reasoning": "CORREGIR és verb d'ACCIÓ, no pregunta d'observació. Intent clar de modificar tot el document.",
  "action_type": "modify",
  "scope": "document",
  "target_paragraphs": [],
  "modification_type": "fix",
  "is_question": false,
  "risk_level": "medium"
}`;

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
      prompt += `- Estructura: ${documentContext.structure.map(h => `${h.text} (para ${h.para_id})`).join(', ')}
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
          temperature: 0.1,  // Baixa temperatura per consistència
          maxOutputTokens: 4096,  // Augmentat per gemini-2.5-flash amb thinking (~1000 tokens)
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
    reasoning: intent.reasoning || defaults.reasoning,
    secondary_mode: intent.secondary_mode || null,
    secondary_confidence: typeof intent.secondary_confidence === 'number' ? intent.secondary_confidence : null,
    action_type: intent.action_type || defaults.action_type,
    scope: intent.scope || defaults.scope,
    target_paragraphs: Array.isArray(intent.target_paragraphs) ? intent.target_paragraphs : [],
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
