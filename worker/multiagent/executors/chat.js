/**
 * CHAT_ONLY Executor v12.3
 *
 * Executor per respondre preguntes i conversar sense modificar el document.
 * Utilitza el context del document per donar respostes contextualitzades.
 *
 * v12.3: Consistència obligatòria en format de llistes
 * v12.2: Format markdown millorat
 * v12.1: Format de cita [[§ID]] clicable + response_style templates
 */

import { Mode, createErrorResult } from '../types.js';
import { GEMINI, TIMEOUTS, TEMPERATURES } from '../config.js';
import { logInfo, logDebug, logError } from '../telemetry.js';
import { formatContextForPrompt } from '../context.js';

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT
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
    example: '[[§15]] Aitor Gilabert Juan, Arquitecte Municipal.',
  },
  // Pregunta d'ubicació → Referència amb snippet
  location: {
    maxSentences: 3,
    format: 'quote',
    example: 'Es menciona a [[§7]]: «El termini d\'execució serà de 12 mesos».',
  },
  // Pregunta de resum → Punts principals
  summary: {
    maxPoints: 5,
    format: 'bullets',
    example: '• Objectiu: rehabilitació [[§2]]\n• Termini: 12 mesos [[§7]]',
  },
  // Pregunta exploratòria → Explicació breu
  exploratory: {
    maxSentences: 4,
    format: 'paragraph',
    example: 'El document estableix... [[§3]] i desenvolupa... [[§8]].',
  },
};

const CHAT_SYSTEM_PROMPT = `ASSISTENT DOCUMENTAL v12.3
Objectiu: Respondre de forma clara i ben estructurada, amb cites clicables.

## ⚠️ FORMAT DE CITA CRÍTIC: [[§ID]]
Utilitza SEMPRE el format [[§ID]] per citar paràgrafs.
Exemple: "Segons [[§15]], el signant és Aitor Gilabert."
El número ID comença a 1 (§1 = primer paràgraf).

## 📝 FORMAT MARKDOWN
USA format markdown per millorar la llegibilitat:
- **Negreta** per conceptes clau, noms importants, xifres destacades
- *Cursiva* per termes tècnics o èmfasi suau
- Llistes amb • o - quan hi ha múltiples elements
- > Citacions per text literal del document
- Paràgrafs separats per temes diferents

## RESPONSE STYLES

### Pregunta Directa (qui, quin, quina, quan)
Format: Resposta clara amb [[§ID]] i negreta al element clau
Exemple: "Segons [[§15]], el signant és **Aitor Gilabert Juan**, Arquitecte Municipal."

### Pregunta d'Ubicació (on, a quin paràgraf)
Format: Indicació + citació
Exemple:
"Es menciona a [[§7]]:
> «El termini d'execució serà de **12 mesos**»"

### Pregunta de Resum / Múltiples elements
Format: Llista estructurada amb [[§ID]]
⚠️ CONSISTÈNCIA OBLIGATÒRIA: Tots els ítems d'una llista han de seguir el MATEIX format.
Patró: "- **Element en negreta** [[§ID]]"
Exemple:
S'ha de sol·licitar informe a:
- **Servei Territorial de Cultura** [[§12]]
- **Agència Catalana de l'Aigua** [[§13]]
- **Institut Cartogràfic i Geològic** [[§14]]

### Pregunta Exploratòria (explica, per què, com)
Format: Explicació estructurada amb paràgrafs i [[§ID]]
Exemple:
"El document estableix les **condicions generals** [[§3]] per a l'execució del projecte.

Desenvolupa els **requisits tècnics** [[§8]], incloent-hi les especificacions de materials i els terminis d'execució."

### Pregunta sobre errors/faltes
Format: Llista clara amb ubicació i explicació
Exemple:
**Errors detectats:**
- [[§3]]: *"connexió"* hauria de ser *"connexió"* (accent)
- [[§7]]: Falta el punt final

## REGLES DE FORMAT
1. Usa **negreta** per destacar la informació més rellevant
2. Usa llistes quan hi ha 2+ elements relacionats
3. **CONSISTÈNCIA**: Tots els ítems d'una llista han de tenir el MATEIX format (tots amb negreta o cap)
4. Separa idees diferents en paràgrafs
5. Inclou sempre [[§ID]] per cada referència al document
6. No abuses del format - usa'l per clarificar, no per decorar

## RESTRICCIONS
- PROHIBIT inventar informació
- PROHIBIT ometre [[§ID]] en les cites
- PROHIBIT usar format §X en lloc de [[§X]]

RECORDA: Cada referència ha de ser [[§ID]] per ser clicable.`;

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

    logDebug('CHAT_ONLY completed', {
      response_length: response.length,
      provider: provider?.name || 'gemini-legacy',
    });

    return {
      mode: Mode.CHAT_ONLY,
      chat_response: response,
      _meta: {
        executor: 'chat',
        provider: provider?.name || 'gemini',
        model: provider?.model || GEMINI.model_chat,
        tokens_input: usage?.input,
        tokens_output: usage?.output,
        tokens_estimated: usage ? (usage.input + usage.output) : Math.ceil(response.length / 4),
      },
    };

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

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: CHAT_SYSTEM_PROMPT },
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
