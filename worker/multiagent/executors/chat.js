/**
 * CHAT_ONLY Executor v13.4
 *
 * Executor per respondre preguntes i conversar sense modificar el document.
 * Utilitza el context del document per donar respostes contextualitzades.
 *
 * v13.4: Prompt militar amb format {{N}} coherent amb context
 * v12.3: Consistència obligatòria en format de llistes
 * v12.2: Format markdown millorat
 * v12.1: Format de cita [[§ID]] clicable + response_style templates
 */

import { Mode, createErrorResult } from '../types.js';
import { GEMINI, TIMEOUTS, TEMPERATURES } from '../config.js';
import { logInfo, logDebug, logError } from '../telemetry.js';
import { formatContextForPrompt } from '../context.js';

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT v13.4 - MILITAR AMB FORMAT {{N}}
// ═══════════════════════════════════════════════════════════════

/**
 * Response Style Templates v12.1
 * Defineixen l'extensió i format segons el tipus de pregunta
 */
const RESPONSE_STYLES = {
  // Pregunta directa → Resposta minimal
  direct: {
    maxSentences: 2,
    format: 'inline',
    example: '[[§15|Joan Garcia]]',
  },
  // Pregunta d'ubicació → Referència amb snippet
  location: {
    maxSentences: 3,
    format: 'quote',
    example: 'Es menciona a [[§7|12 mesos]]',
  },
  // Pregunta de resum → Punts principals
  summary: {
    maxPoints: 5,
    format: 'bullets',
    example: '- Objectiu: [[§2|rehabilitació]]\n- Termini: [[§7|12 mesos]]',
  },
  // Pregunta exploratòria → Explicació breu
  exploratory: {
    maxSentences: 4,
    format: 'paragraph',
    example: 'El document estableix [[§3|...]] i desenvolupa [[§8|...]].',
  },
};

const CHAT_SYSTEM_PROMPT = `Ets l'assistent de Docmile. Respon les preguntes de l'usuari basant-te en el document.

## COM RESPONDRE

### Format de resposta
- Usa **markdown** per estructurar: negretes, llistes, títols
- Organitza la informació de forma clara i visual
- Destaca els punts clau amb **negreta**
- Usa llistes amb guions (-) per enumerar elements
- Si hi ha molts punts, agrupa'ls per categories

### Estil
- Respostes concises però completes
- Llenguatge professional i amable
- Adapta la longitud a la complexitat de la pregunta
- Respon en el mateix idioma que l'usuari

### ⚠️ PROHIBIT
- NO usis barres verticals | per ressaltar
- NO usis claudàtors dobles [[ ]]
- NO usis símbols § ni altres marques estranyes
- NO posis |text| per destacar (usa **text** en lloc)

## EXEMPLES DE FORMAT

**Pregunta simple:**
El responsable del projecte és **Joan Pérez**, segons consta a l'inici del document.

**Resum curt:**
Aquest document és un **informe tècnic** que avalua les condicions d'un projecte. Conclou que és **viable** amb certes condicions.

**Resum estructurat:**
El document tracta els següents punts:

- **Objectiu:** Descripció del que es vol aconseguir
- **Situació actual:** Estat de les coses avui
- **Proposta:** Accions recomanades
- **Conclusions:** Valoració final

**Llista d'elements:**
Els participants són:
- **Nom 1** - Càrrec o rol
- **Nom 2** - Càrrec o rol
- **Nom 3** - Càrrec o rol

**Explicació:**
El document estableix que **X** és necessari per aconseguir **Y**. Això implica que cal fer **Z** com a primer pas.`;

// ═══════════════════════════════════════════════════════════════
// EXECUTOR IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Executa una petició CHAT_ONLY
 *
 * @param {Object} intent - Intent classificat
 * @param {Object} documentContext - Context del document
 * @param {Object} conversationContext - Context de conversa
 * @param {Object} options - Opcions d'execució
 * @param {string} options.apiKey - API key de Gemini (fallback)
 * @param {Object} [options.provider] - Provider d'IA (BYOK)
 * @param {AbortSignal} options.signal - Signal per cancel·lar
 * @returns {Promise<Object>} - Resultat de l'executor
 */
async function executeChatOnly(intent, documentContext, conversationContext, options = {}) {
  const { apiKey, signal, provider } = options;
  const language = intent.language || 'ca';

  logInfo('Executing CHAT_ONLY', {
    instruction_length: intent.original_instruction?.length,
    has_document: !!documentContext?.paragraphs?.length,
    provider: provider?.name || 'gemini-legacy',
  });

  try {
    // Construir el prompt
    const userPrompt = buildChatPrompt(intent, documentContext, conversationContext);

    let response;
    let usage = null;

    // BYOK: Usar provider si disponible
    if (provider) {
      const result = await provider.chat(
        [{ role: 'user', content: userPrompt }],
        {
          systemPrompt: CHAT_SYSTEM_PROMPT,
          temperature: TEMPERATURES.chat,
          maxTokens: 4096,
          signal,
        }
      );
      response = result.content;
      usage = result.usage;
    } else {
      // Fallback a crida directa Gemini (compatibilitat enrere)
      response = await callGeminiChat(userPrompt, apiKey, signal);
    }

    // v13.6: Netejar barres verticals i altres marques que el model pugui afegir
    const cleanedResponse = cleanChatResponse(response);

    logDebug('CHAT_ONLY completed', {
      response_length: cleanedResponse.length,
      provider: provider?.name || 'gemini-legacy',
      had_pipes: response !== cleanedResponse,
    });

    // v14.3: Construir resposta amb suggested_followup si existeix
    const result = {
      mode: Mode.CHAT_ONLY,
      chat_response: cleanedResponse,
      _meta: {
        executor: 'chat',
        provider: provider?.name || 'gemini',
        model: provider?.model || GEMINI.model_chat,
        tokens_input: usage?.input,
        tokens_output: usage?.output,
        tokens_estimated: usage ? (usage.input + usage.output) : Math.ceil(response.length / 4),
      },
    };

    // v14.3: Passar suggested_followup de l'intent si existeix
    if (intent.suggested_followup) {
      result.suggested_followup = {
        available: true,
        prompt: intent.suggested_followup,
        would_become_mode: 'REWRITE',  // Aplicar el resum seria un rewrite
      };
    }

    return result;

  } catch (error) {
    logError('CHAT_ONLY executor failed', { error: error.message });

    // Fallback response
    const fallbackMessages = {
      ca: "Ho sento, he tingut un problema processant la teva pregunta. Pots tornar a provar?",
      es: "Lo siento, he tenido un problema procesando tu pregunta. ¿Puedes volver a intentarlo?",
      en: "Sorry, I had a problem processing your question. Can you try again?",
    };

    return {
      mode: Mode.CHAT_ONLY,
      chat_response: error.localizedMessage || fallbackMessages[language] || fallbackMessages.ca,
      _meta: {
        executor: 'chat',
        error: error.message,
        error_code: error.code,
        fallback: true,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE CLEANING v13.6
// ═══════════════════════════════════════════════════════════════

/**
 * Neteja la resposta del model eliminant marques no desitjades
 * v13.6: Elimina barres verticals i altres símbols que el model afegeix
 *
 * @param {string} response - Resposta del model
 * @returns {string} - Resposta netejada
 */
function cleanChatResponse(response) {
  if (!response) return '';

  let cleaned = response;

  // Eliminar barres verticals usades com a marcadors (|text|)
  // Però mantenir barres en taules markdown (| col1 | col2 |)
  // Patró: | seguit/precedit de text sense espais (marcador) vs amb espais (taula)
  cleaned = cleaned.replace(/\|([^|\s][^|]*[^|\s])\|/g, '$1');

  // Eliminar barres soltes al principi de paraula
  cleaned = cleaned.replace(/\|(\w)/g, '$1');

  // Eliminar referències [[§N|text]] que puguin quedar
  cleaned = cleaned.replace(/\[\[§?\d+\|([^\]]+)\]\]/g, '$1');

  // Eliminar [[§N]] buits
  cleaned = cleaned.replace(/\[\[§?\d+\]\]/g, '');

  // Eliminar claudàtors dobles buits
  cleaned = cleaned.replace(/\[\[\]\]/g, '');

  // Netejar espais dobles
  cleaned = cleaned.replace(/  +/g, ' ');

  return cleaned.trim();
}

// ═══════════════════════════════════════════════════════════════
// PROMPT BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix el prompt per al chat
 * @param {Object} intent - Intent
 * @param {Object} documentContext - Context del document
 * @param {Object} conversationContext - Context de conversa
 * @returns {string}
 */
function buildChatPrompt(intent, documentContext, conversationContext) {
  const parts = [];

  // Historial de conversa (si n'hi ha)
  if (conversationContext?.turns?.length > 0) {
    parts.push('## Historial recent de conversa');
    for (const turn of conversationContext.turns) {
      const role = turn.role === 'user' ? 'Usuari' : 'Assistent';
      parts.push(`${role}: ${turn.content}`);
    }
    parts.push('');
  }

  // Context del document
  if (documentContext?.paragraphs?.length > 0) {
    parts.push('## Document de l\'usuari');
    parts.push(formatContextForPrompt(documentContext));
    parts.push('');
  }

  // Pregunta/instrucció actual
  parts.push('## Pregunta actual');
  parts.push(intent.original_instruction || intent.reasoning || '');

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// GEMINI API CALL
// ═══════════════════════════════════════════════════════════════

/**
 * Crida a l'API de Gemini per chat
 * @param {string} userPrompt - Prompt de l'usuari
 * @param {string} apiKey - API key
 * @param {AbortSignal} signal - Signal per cancel·lar
 * @returns {Promise<string>}
 */
async function callGeminiChat(userPrompt, apiKey, signal) {
  const url = `${GEMINI.base_url}/models/${GEMINI.model_chat}:generateContent?key=${apiKey}`;

  // v13.5: CRÍTIC - Usar system_instruction per Gemini (NO dins de contents!)
  // Posar el prompt dins de contents el tracta com a pregunta, no com instruccions
  const requestBody = {
    system_instruction: {
      parts: [{ text: CHAT_SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: userPrompt },
        ],
      },
    ],
    generationConfig: {
      temperature: TEMPERATURES.chat,  // v12.1: 0.3 per no inventar
      topP: 0.9,
      maxOutputTokens: 4096,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
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

  // Extreure text de la resposta
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('No response text from Gemini');
  }

  return text.trim();
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export { executeChatOnly };
