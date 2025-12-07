/**
 * REWRITE Executor v8.3
 *
 * Executor per reescriure seccions completes del document.
 * Opera en dos passos:
 * 1. Genera preview del canvi
 * 2. Aplica després de confirmació de l'usuari
 *
 * Tipus de reescriptura:
 * - tone: Canviar el to (formal, informal, etc.)
 * - style: Canviar l'estil d'escriptura
 * - audience: Adaptar a una audiència diferent
 * - format: Canviar el format (llista, narratiu, etc.)
 * - complete: Reescriptura total
 */

import { Mode, RiskLevel } from '../types.js';
import { GEMINI, TIMEOUTS, CONFIDENCE_THRESHOLDS } from '../config.js';
import { logInfo, logDebug, logError, logWarn } from '../telemetry.js';

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════

const REWRITE_PROMPTS = {
  tone: `Ets un escriptor expert en adaptar textos a diferents tons.

## Tons disponibles
- formal: Professional, respectuós, sense contraccions
- informal: Proper, conversacional, amigable
- academic: Rigorós, amb terminologia específica
- persuasive: Convincent, amb arguments forts
- neutral: Objectiu, sense emocions

## Regles
- Manté TOTA la informació del text original
- Canvia NOMÉS l'estil, no el contingut
- El text resultant ha de ser natural`,

  style: `Ets un editor expert en estils d'escriptura.

## Estils disponibles
- concise: Breu i directe
- detailed: Amb més explicacions i exemples
- narrative: Com una història
- technical: Precís amb termes tècnics
- simple: Fàcil d'entendre per tothom`,

  audience: `Ets un expert en adaptar contingut per a diferents audiències.

## Audiències
- experts: Professionals del camp
- beginners: Persones sense coneixement previ
- children: Nens (simplificar molt)
- executives: Directius (resum executiu)
- general: Públic general`,

  format: `Ets un expert en reformatar contingut.

## Formats
- bullets: Convertir a llista amb punts
- numbered: Llista numerada
- prose: Text narratiu corrent
- qa: Format pregunta-resposta
- summary: Resum dels punts clau`,

  complete: `Ets un escriptor professional.
Reescriu el text seguint les instruccions de l'usuari.
Manté la informació essencial però pots canviar completament l'estructura i estil.`,
};

const BASE_PROMPT = `
## Format de sortida
\`\`\`json
{
  "preview": {
    "original_paragraphs": [<ids dels paràgrafs originals>],
    "rewritten_text": "<text reescrit complet>",
    "changes_summary": "<resum dels canvis fets>",
    "word_count_before": <nombre>,
    "word_count_after": <nombre>
  }
}
\`\`\`

IMPORTANT: Genera NOMÉS el preview. L'aplicació real es farà després de confirmació.`;

// ═══════════════════════════════════════════════════════════════
// EXECUTOR IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Executa una petició REWRITE
 *
 * @param {Object} intent - Intent classificat
 * @param {Object} documentContext - Context del document
 * @param {Object} conversationContext - Context de conversa
 * @param {Object} options - Opcions d'execució
 * @returns {Promise<Object>} - Resultat amb preview o aplicació
 */
async function executeRewrite(intent, documentContext, conversationContext, options = {}) {
  const { apiKey, signal } = options;
  const language = intent.language || 'ca';

  // Determinar tipus de reescriptura
  const rewriteType = determineRewriteType(intent);

  logInfo('Executing REWRITE', {
    rewrite_type: rewriteType,
    scope: intent.scope,
    target_paragraphs: intent.target_paragraphs?.length || 'all',
    user_confirmed: intent.user_confirmed,
  });

  // Si ja tenim confirmació, aplicar directament
  if (intent.user_confirmed && intent._cached_preview) {
    return applyRewrite(intent._cached_preview, language);
  }

  // Determinar paràgrafs a reescriure
  const targetParagraphs = determineTargetParagraphs(intent, documentContext);

  if (targetParagraphs.length === 0) {
    return createNoTargetResponse(language);
  }

  try {
    // Generar preview
    const preview = await generateRewritePreview(
      rewriteType,
      intent,
      documentContext,
      targetParagraphs,
      apiKey,
      signal
    );

    if (!preview) {
      return createNoPreviewResponse(language);
    }

    logDebug('REWRITE preview generated', {
      paragraphs_affected: preview.original_paragraphs?.length,
      word_count_change: (preview.word_count_after || 0) - (preview.word_count_before || 0),
    });

    // Construir resposta amb preview per confirmació
    const chatResponse = buildPreviewChatResponse(preview, rewriteType, language);

    return {
      mode: Mode.REWRITE,
      preview,
      needs_confirmation: true,
      chat_response: chatResponse,
      _meta: {
        executor: 'rewrite',
        rewrite_type: rewriteType,
        risk_level: determineRiskLevel(targetParagraphs, documentContext),
      },
    };

  } catch (error) {
    logError('REWRITE executor failed', { error: error.message });
    return createErrorResponse(error, language);
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Determina el tipus de reescriptura
 */
function determineRewriteType(intent) {
  // Per to/estil demanat
  if (intent.requested_tone) {
    const toneKeywords = ['formal', 'informal', 'professional', 'casual', 'academic'];
    const styleKeywords = ['concise', 'detailed', 'simple', 'technical'];
    const audienceKeywords = ['expert', 'beginner', 'children', 'executive'];
    const formatKeywords = ['bullet', 'list', 'numbered', 'summary'];

    const tone = intent.requested_tone.toLowerCase();

    if (toneKeywords.some(k => tone.includes(k))) return 'tone';
    if (styleKeywords.some(k => tone.includes(k))) return 'style';
    if (audienceKeywords.some(k => tone.includes(k))) return 'audience';
    if (formatKeywords.some(k => tone.includes(k))) return 'format';
  }

  // Per instrucció
  const instruction = (intent.original_instruction || '').toLowerCase();

  if (/\b(to|ton|tono)\b/.test(instruction)) return 'tone';
  if (/\b(format|llista|bullet|punt)\b/.test(instruction)) return 'format';
  if (/\b(resum|summary)\b/.test(instruction)) return 'format';
  if (/\b(simple|simplifica|fàcil)\b/.test(instruction)) return 'style';

  return 'complete';
}

/**
 * Determina els paràgrafs a reescriure
 */
function determineTargetParagraphs(intent, documentContext) {
  // Si hi ha targets específics
  if (intent.target_paragraphs?.length > 0) {
    return intent.target_paragraphs.filter(
      id => id >= 0 && id < documentContext.paragraphs.length
    );
  }

  // Si l'scope és secció, trobar la secció
  if (intent.scope === 'section' && intent.section_hint) {
    // Implementar lògica de secció (simplificat)
    return documentContext.paragraphs
      .map((_, i) => i)
      .slice(0, Math.min(10, documentContext.paragraphs.length));
  }

  // Per defecte, tot el document (amb límit)
  const maxParagraphs = 20;
  return documentContext.paragraphs
    .map((_, i) => i)
    .slice(0, Math.min(maxParagraphs, documentContext.paragraphs.length));
}

/**
 * Determina el nivell de risc
 */
function determineRiskLevel(targetParagraphs, documentContext) {
  const ratio = targetParagraphs.length / documentContext.paragraphs.length;

  if (ratio > 0.8) return RiskLevel.HIGH;
  if (ratio > 0.3) return RiskLevel.MEDIUM;
  return RiskLevel.LOW;
}

// ═══════════════════════════════════════════════════════════════
// PREVIEW GENERATION
// ═══════════════════════════════════════════════════════════════

/**
 * Genera el preview de la reescriptura
 */
async function generateRewritePreview(rewriteType, intent, documentContext, targetParagraphs, apiKey, signal) {
  // Construir prompt
  const systemPrompt = (REWRITE_PROMPTS[rewriteType] || REWRITE_PROMPTS.complete) + BASE_PROMPT;

  const parts = [];

  // Instrucció de l'usuari
  parts.push('## Instrucció de l\'usuari');
  parts.push(intent.original_instruction || 'Reescriu el text');
  parts.push('');

  // To/estil demanat
  if (intent.requested_tone) {
    parts.push('## Estil/To demanat');
    parts.push(intent.requested_tone);
    parts.push('');
  }

  // Text a reescriure
  parts.push('## Text a reescriure');
  const textToRewrite = targetParagraphs
    .map(id => {
      const para = documentContext.paragraphs[id];
      return `§${id}: ${para.text || para}`;
    })
    .join('\n\n');
  parts.push(textToRewrite);

  const userPrompt = parts.join('\n');

  // Cridar Gemini
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
      temperature: 0.6, // Més creatiu per reescriptura
      topP: 0.9,
      maxOutputTokens: 4096, // Més espai per reescriptures llargues
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
  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // Parsejar resposta
  return parsePreviewResponse(responseText, targetParagraphs);
}

/**
 * Parseja la resposta del preview
 */
function parsePreviewResponse(responseText, targetParagraphs) {
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
    const preview = parsed.preview || parsed;

    return {
      original_paragraphs: preview.original_paragraphs || targetParagraphs,
      rewritten_text: preview.rewritten_text || '',
      changes_summary: preview.changes_summary || '',
      word_count_before: preview.word_count_before || 0,
      word_count_after: preview.word_count_after || 0,
    };
  } catch (error) {
    logWarn('Failed to parse preview response', { error: error.message });

    // Intentar extreure text directament
    const textWithoutJson = responseText.replace(/```[\s\S]*?```/g, '').trim();
    if (textWithoutJson.length > 50) {
      return {
        original_paragraphs: targetParagraphs,
        rewritten_text: textWithoutJson,
        changes_summary: 'Text reescrit',
        word_count_before: 0,
        word_count_after: textWithoutJson.split(/\s+/).length,
      };
    }

    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// APPLY REWRITE
// ═══════════════════════════════════════════════════════════════

/**
 * Aplica la reescriptura després de confirmació
 */
function applyRewrite(preview, language) {
  if (!preview || !preview.rewritten_text) {
    return createNoPreviewResponse(language);
  }

  logInfo('Applying confirmed REWRITE', {
    paragraphs: preview.original_paragraphs?.length,
  });

  // Convertir el text reescrit en canvis per paràgraf
  // (Simplificat: tot en un sol bloc)
  const changes = [{
    paragraph_ids: preview.original_paragraphs,
    new_text: preview.rewritten_text,
    is_replacement: true,
  }];

  const chatMessages = {
    ca: "He aplicat els canvis al document.",
    es: "He aplicado los cambios al documento.",
    en: "I've applied the changes to the document.",
  };

  return {
    mode: Mode.REWRITE,
    changes,
    applied: true,
    chat_response: chatMessages[language] || chatMessages.ca,
    _meta: {
      executor: 'rewrite',
      confirmed: true,
      paragraphs_replaced: preview.original_paragraphs?.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix la resposta amb preview
 */
function buildPreviewChatResponse(preview, rewriteType, language) {
  const templates = {
    ca: {
      intro: "He preparat una proposta de reescriptura:",
      summary: preview.changes_summary || "He reescrit el text segons les teves instruccions.",
      stats: `De ${preview.word_count_before} a ${preview.word_count_after} paraules.`,
      preview_label: "**Preview:**",
      confirm: "\n\n_Confirmes que vols aplicar aquests canvis?_",
    },
    es: {
      intro: "He preparado una propuesta de reescritura:",
      summary: preview.changes_summary || "He reescrito el texto según tus instrucciones.",
      stats: `De ${preview.word_count_before} a ${preview.word_count_after} palabras.`,
      preview_label: "**Vista previa:**",
      confirm: "\n\n_¿Confirmas que quieres aplicar estos cambios?_",
    },
    en: {
      intro: "I've prepared a rewrite proposal:",
      summary: preview.changes_summary || "I've rewritten the text according to your instructions.",
      stats: `From ${preview.word_count_before} to ${preview.word_count_after} words.`,
      preview_label: "**Preview:**",
      confirm: "\n\n_Do you confirm you want to apply these changes?_",
    },
  };

  const t = templates[language] || templates.ca;

  // Truncar preview si és molt llarg
  let previewText = preview.rewritten_text || '';
  if (previewText.length > 500) {
    previewText = previewText.slice(0, 500) + '...';
  }

  return [
    t.intro,
    t.summary,
    t.stats,
    '',
    t.preview_label,
    `> ${previewText.split('\n').join('\n> ')}`,
    t.confirm,
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════
// ERROR RESPONSES
// ═══════════════════════════════════════════════════════════════

function createNoTargetResponse(language) {
  const messages = {
    ca: "No he pogut determinar quina part del document vols reescriure.",
    es: "No he podido determinar qué parte del documento quieres reescribir.",
    en: "I couldn't determine which part of the document you want to rewrite.",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: { executor: 'rewrite', error: 'no_target' },
  };
}

function createNoPreviewResponse(language) {
  const messages = {
    ca: "No he pogut generar una proposta de reescriptura. Pots ser més específic?",
    es: "No he podido generar una propuesta de reescritura. ¿Puedes ser más específico?",
    en: "I couldn't generate a rewrite proposal. Can you be more specific?",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: { executor: 'rewrite', error: 'no_preview' },
  };
}

function createErrorResponse(error, language) {
  const messages = {
    ca: "Ho sento, he tingut un problema preparant la reescriptura. Torna a provar.",
    es: "Lo siento, he tenido un problema preparando la reescritura. Vuelve a intentarlo.",
    en: "Sorry, I had a problem preparing the rewrite. Please try again.",
  };

  return {
    mode: Mode.CHAT_ONLY,
    chat_response: messages[language] || messages.ca,
    _meta: { executor: 'rewrite', error: error.message, fallback: true },
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export { executeRewrite };
