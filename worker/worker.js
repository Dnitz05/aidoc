/**
 * SIDECAR CORE API v8.3 - Multi-Agent Pipeline
 *
 * v8.3 features (NEW):
 * - Multi-Agent Pipeline amb classificació IA (Gemini)
 * - Cache semàntic de dos nivells (L1 sessió + L2 embeddings)
 * - Circuit Breaker per protecció d'errors
 * - Fast paths per salutacions i casos trivials
 * - Executors especialitzats per mode (CHAT, HIGHLIGHT, UPDATE, REWRITE)
 *
 * v3.1 features (preserved):
 * - Time Budget (25s safety cutoff)
 * - Unified validateResponse() function
 * - Graceful degradation with _meta warnings
 *
 * v3.0 features (preserved):
 * - Event Sourcing (edit_events table)
 * - Edit history per document
 * - Revert any edit (not just last one)
 *
 * v2.9 features (preserved):
 * - Document Skeleton (doc_skeleton) - estructura + entitats
 * - Context-aware prompting with document structure
 */

// ═══════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════
import { tryNewPipeline } from './multiagent/index.js';

// ═══════════════════════════════════════════════════════════════
// SHADOW VALIDATOR CONSTANTS (v3.1)
// ═══════════════════════════════════════════════════════════════

const TIMEOUT_CUTOFF = 25000;  // 25s safety margin (GAS timeout is 30s)
const MAX_RETRIES = 2;         // Initial attempt + 2 retries max

// ═══════════════════════════════════════════════════════════════
// FILE VALIDATION CONSTANTS (v6.5)
// ═══════════════════════════════════════════════════════════════

const ALLOWED_FILE_TYPES = {
  'application/pdf': { ext: '.pdf', maxSize: 10 * 1024 * 1024 },
  'text/plain': { ext: '.txt', maxSize: 10 * 1024 * 1024 },
  'text/csv': { ext: '.csv', maxSize: 10 * 1024 * 1024 },
  'text/markdown': { ext: '.md', maxSize: 10 * 1024 * 1024 },
  'text/x-markdown': { ext: '.md', maxSize: 10 * 1024 * 1024 }
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB absolute max

/**
 * v6.5: Validate uploaded file for security
 * @param {string} fileData - Base64 encoded file data
 * @param {string} mimeType - MIME type of the file
 * @param {string} fileName - Original file name
 * @returns {object} - { valid: true, sanitizedName } or throws Error
 */
function validateUploadedFile(fileData, mimeType, fileName) {
  // 1. Validate MIME type against whitelist
  const normalizedType = (mimeType || '').toLowerCase();
  const typeConfig = ALLOWED_FILE_TYPES[normalizedType];

  if (!typeConfig) {
    throw new Error("invalid_file_type: Only PDF, TXT, CSV, MD allowed");
  }

  // 2. Validate file extension matches MIME type
  const fileExt = (fileName || '').toLowerCase().slice(-4);
  const allowedExts = normalizedType.includes('markdown') ? ['.md'] : [typeConfig.ext];

  if (!allowedExts.some(ext => fileName.toLowerCase().endsWith(ext))) {
    throw new Error("file_extension_mismatch: Extension doesn't match type");
  }

  // 3. Validate file size (base64 is ~33% larger than binary)
  if (!fileData || typeof fileData !== 'string') {
    throw new Error("invalid_file_data");
  }

  const estimatedSize = Math.ceil(fileData.length * 0.75);
  if (estimatedSize > typeConfig.maxSize) {
    throw new Error("file_too_large: Max " + (typeConfig.maxSize / 1024 / 1024) + "MB");
  }

  // 4. Validate magic bytes for PDFs
  if (normalizedType === 'application/pdf') {
    try {
      const decoded = atob(fileData.substring(0, 20));
      if (!decoded.startsWith('%PDF')) {
        throw new Error("invalid_pdf_content: Not a valid PDF file");
      }
    } catch (e) {
      if (e.message.includes('invalid_pdf')) throw e;
      throw new Error("invalid_base64_data");
    }
  }

  // 5. Sanitize file name (remove path traversal, special chars)
  const sanitizedName = fileName
    .replace(/\.\./g, '')           // Remove path traversal
    .replace(/[\/\\]/g, '')         // Remove slashes
    .replace(/[^a-zA-Z0-9._\-\s]/g, '_')  // Keep only safe chars
    .substring(0, 100);             // Limit length

  return { valid: true, sanitizedName };
}

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * v2.8: Check if text contains any banned words
 * Returns array of found banned words, or empty array if clean
 */
function findBannedWords(text, bannedWords) {
  if (!bannedWords || !Array.isArray(bannedWords) || bannedWords.length === 0) {
    return [];
  }

  const found = [];
  const lowerText = text.toLowerCase();

  for (const word of bannedWords) {
    if (!word) continue;
    const lowerWord = word.toLowerCase();
    // Use word boundary matching to avoid partial matches
    const regex = new RegExp('\\b' + escapeRegex(lowerWord) + '\\b', 'i');
    if (regex.test(lowerText)) {
      found.push(word);
    }
  }

  return found;
}

/**
 * Escape special regex characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * v4.0: Detect NL ban patterns in user message
 * Patterns like: "no usis X", "no facis servir X", "sense la paraula X"
 * Returns array of words to auto-ban
 */
function detectNLBanPatterns(userMessage) {
  if (!userMessage) return [];

  const patterns = [
    // Catalan patterns
    /no\s+(?:usis|facis\s+servir|utilitzis|posis)\s+(?:la\s+paraula\s+)?["']?([a-zA-ZàèéíòóúüïçÀÈÉÍÒÓÚÜÏÇ]+)["']?/gi,
    /sense\s+(?:la\s+paraula\s+)?["']?([a-zA-ZàèéíòóúüïçÀÈÉÍÒÓÚÜÏÇ]+)["']?/gi,
    /evita\s+(?:la\s+paraula\s+)?["']?([a-zA-ZàèéíòóúüïçÀÈÉÍÒÓÚÜÏÇ]+)["']?/gi,
    /elimina\s+["']?([a-zA-ZàèéíòóúüïçÀÈÉÍÒÓÚÜÏÇ]+)["']?/gi,
    // Spanish patterns
    /no\s+(?:uses|utilices|pongas)\s+(?:la\s+palabra\s+)?["']?([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+)["']?/gi,
    /sin\s+(?:la\s+palabra\s+)?["']?([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ]+)["']?/gi,
    // English patterns
    /don'?t\s+use\s+(?:the\s+word\s+)?["']?([a-zA-Z]+)["']?/gi,
    /avoid\s+(?:the\s+word\s+)?["']?([a-zA-Z]+)["']?/gi,
    /without\s+(?:the\s+word\s+)?["']?([a-zA-Z]+)["']?/gi,
  ];

  const foundWords = new Set();

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(userMessage)) !== null) {
      const word = match[1].toLowerCase().trim();
      // Filter out common false positives and very short words
      if (word.length >= 3 && !['que', 'the', 'and', 'una', 'els', 'les', 'amb'].includes(word)) {
        foundWords.add(word);
      }
    }
  }

  return Array.from(foundWords);
}

/**
 * v2.8: Extract all text from a parsed response for validation
 */
function getOutputText(parsedResponse) {
  if (!parsedResponse) return '';

  let text = '';

  // Chat response
  if (parsedResponse.chat_response) {
    text += ' ' + parsedResponse.chat_response;
  }

  // Change summary
  if (parsedResponse.change_summary) {
    text += ' ' + parsedResponse.change_summary;
  }

  // Updates (UPDATE_BY_ID mode)
  if (parsedResponse.updates && typeof parsedResponse.updates === 'object') {
    for (const value of Object.values(parsedResponse.updates)) {
      if (typeof value === 'string') {
        text += ' ' + value;
      }
    }
  }

  // Blocks (REWRITE mode)
  if (parsedResponse.blocks && Array.isArray(parsedResponse.blocks)) {
    for (const block of parsedResponse.blocks) {
      if (block.text) {
        text += ' ' + block.text;
      }
    }
  }

  return text;
}

async function hashKey(licenseKey) {
  const msgBuffer = new TextEncoder().encode(licenseKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function useCredits(env, licenseHash, docMetadata) {
  const supabaseResp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/use_license_credits`, {
    method: 'POST',
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      p_license_key_hash: licenseHash,
      p_cost: 1,
      p_operation: 'chat_v24',
      p_metadata: docMetadata || {}
    })
  });

  // v8.2: Proper error handling
  if (!supabaseResp.ok) {
    console.error('useCredits failed:', supabaseResp.status);
    return { credits_remaining: 0, error: `HTTP ${supabaseResp.status}` };
  }

  const data = await supabaseResp.json();

  // Validate response structure
  if (data.credits_remaining === undefined && data.remaining === undefined) {
    console.error('useCredits invalid response:', JSON.stringify(data).substring(0, 200));
    return { credits_remaining: 0, error: 'invalid_response' };
  }

  // Normalize field name (handle both possible field names)
  return {
    credits_remaining: data.credits_remaining ?? data.remaining ?? 0,
    ...data
  };
}

// ═══════════════════════════════════════════════════════════════
// EVENT SOURCING (v3.0)
// ═══════════════════════════════════════════════════════════════

/**
 * Save an edit event to the database
 */
async function saveEditEvent(env, eventData) {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/edit_events`,
      {
        method: 'POST',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(eventData)
      }
    );

    if (!response.ok) {
      console.error('Failed to save edit event:', await response.text());
      return null;
    }

    const [savedEvent] = await response.json();
    return savedEvent;
  } catch (e) {
    console.error('Error saving edit event:', e);
    return null;
  }
}

/**
 * Get edit history for a document
 */
async function getEditHistory(env, licenseHash, docId, limit = 20) {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/edit_events?` +
      `license_key_hash=eq.${licenseHash}&` +
      `doc_id=eq.${docId}&` +
      `order=created_at.desc&` +
      `limit=${limit}`,
      {
        method: 'GET',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      return [];
    }

    return await response.json();
  } catch (e) {
    console.error('Error getting edit history:', e);
    return [];
  }
}

/**
 * Mark an event as reverted
 */
async function markEventReverted(env, eventId, revertedByEventId) {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/edit_events?id=eq.${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          reverted_at: new Date().toISOString(),
          reverted_by: revertedByEventId
        })
      }
    );

    return response.ok;
  } catch (e) {
    console.error('Error marking event reverted:', e);
    return false;
  }
}

/**
 * v4.3: Invalidate all events that occurred AFTER a specific event
 * Used when reverting to mark future events as no longer valid
 */
async function invalidateEventsAfter(env, licenseHash, docId, afterTimestamp) {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/edit_events?` +
      `license_key_hash=eq.${licenseHash}&` +
      `doc_id=eq.${docId}&` +
      `created_at=gt.${afterTimestamp}&` +
      `invalidated_at=is.null`,
      {
        method: 'PATCH',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          invalidated_at: new Date().toISOString()
        })
      }
    );

    if (!response.ok) {
      console.error('Failed to invalidate events:', await response.text());
      return 0;
    }

    const invalidated = await response.json();
    return invalidated.length;
  } catch (e) {
    console.error('Error invalidating events:', e);
    return 0;
  }
}

/**
 * v4.2: Get the last event for a specific target_id
 * Used to find before_text from previous edits to the same paragraph
 */
async function getLastEventForTarget(env, licenseHash, docId, targetId) {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/edit_events?` +
      `license_key_hash=eq.${licenseHash}&` +
      `doc_id=eq.${docId}&` +
      `target_id=eq.${targetId}&` +
      `event_type=neq.baseline&` +
      `event_type=neq.manual_gap&` +
      `order=created_at.desc&` +
      `limit=1`,
      {
        method: 'GET',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) return null;
    const events = await response.json();
    return events.length > 0 ? events[0] : null;
  } catch (e) {
    console.error('Error getting last event for target:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// TIMELINE GAP DETECTION (v4.0)
// ═══════════════════════════════════════════════════════════════

/**
 * v4.0: Get last confirmed event for gap detection
 */
async function getLastConfirmedEvent(env, licenseHash, docId) {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/edit_events?` +
      `license_key_hash=eq.${licenseHash}&` +
      `doc_id=eq.${docId}&` +
      `hash_confirmed=eq.true&` +
      `order=created_at.desc&` +
      `limit=1`,
      {
        method: 'GET',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) return null;
    const events = await response.json();
    return events.length > 0 ? events[0] : null;
  } catch (e) {
    console.error('Error getting last confirmed event:', e);
    return null;
  }
}

/**
 * v4.0: Update event with confirmed hash
 */
async function confirmEventHash(env, eventId, finalHash, wordCount, prevWordCount) {
  try {
    const wordsChanged = prevWordCount != null ? (wordCount - prevWordCount) : null;

    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/edit_events?id=eq.${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          doc_hash: finalHash,
          hash_confirmed: true,
          word_count: wordCount,
          words_changed: wordsChanged
        })
      }
    );

    return response.ok;
  } catch (e) {
    console.error('Error confirming hash:', e);
    return false;
  }
}

/**
 * v4.0: Detect and record manual gaps
 */
async function detectAndRecordGap(env, licenseHash, docId, clientHash, wordCount) {
  if (!clientHash) return null;

  const lastEvent = await getLastConfirmedEvent(env, licenseHash, docId);

  // First time? Create baseline
  if (!lastEvent) {
    const baseline = await saveEditEvent(env, {
      license_key_hash: licenseHash,
      doc_id: docId,
      event_type: 'baseline',
      source: 'baseline',
      doc_hash: clientHash,
      hash_confirmed: true,
      word_count: wordCount,
      after_text: '[baseline]'
    });
    console.log(`[Timeline] Baseline created for doc ${docId}`);
    return { type: 'baseline', event: baseline };
  }

  // Gap detected?
  if (lastEvent.doc_hash && lastEvent.doc_hash !== clientHash) {
    const wordsChanged = wordCount - (lastEvent.word_count || 0);
    const gapEvent = await saveEditEvent(env, {
      license_key_hash: licenseHash,
      doc_id: docId,
      event_type: 'manual_gap',
      source: 'manual',
      doc_hash: clientHash,
      hash_confirmed: true,
      word_count: wordCount,
      words_changed: wordsChanged,
      after_text: '[edició manual]'
    });
    console.log(`[Timeline] Gap detected: ${wordsChanged > 0 ? '+' : ''}${wordsChanged} words`);
    return { type: 'gap', event: gapEvent, wordsChanged };
  }

  return { type: 'no_change', lastEvent };
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC LOGGING (v3.7)
// ═══════════════════════════════════════════════════════════════

/**
 * Save a diagnostic event to the database
 * Used to analyze patterns and improve the system
 */
async function saveDiagnosticEvent(env, eventData) {
  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/diagnostic_events`,
      {
        method: 'POST',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(eventData)
      }
    );

    if (!response.ok) {
      console.error('Failed to save diagnostic event:', await response.text());
      return false;
    }

    return true;
  } catch (e) {
    console.error('Error saving diagnostic event:', e);
    return false;
  }
}

/**
 * Handler for log_diagnostic action
 */
async function handleLogDiagnostic(body, env, corsHeaders) {
  const { license_key, diagnostic } = body;

  if (!license_key) {
    return new Response(
      JSON.stringify({ status: 'error', error_code: 'missing_license' }),
      { status: 400, headers: corsHeaders }
    );
  }

  if (!diagnostic) {
    return new Response(
      JSON.stringify({ status: 'error', error_code: 'missing_diagnostic' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const licenseHash = await hashKey(license_key);

  // Detect intent mismatch (user wanted edit but got chat, or vice versa)
  const intentMismatch = diagnostic.request?.user_mode === 'edit' &&
                         diagnostic.response?.mode === 'CHAT_ONLY';

  // Detect "empty document problem" (doc appeared empty when user wanted to edit)
  const docWasEmptyProblem = diagnostic.request?.content_payload_is_empty &&
                             diagnostic.request?.user_mode !== 'chat';

  const eventData = {
    license_key_hash: licenseHash,
    doc_id: diagnostic.doc_id || null,
    session_id: diagnostic.session_id || null,

    // Timing
    total_ms: diagnostic.timing?.total_ms || null,
    doc_analysis_ms: diagnostic.timing?.doc_analysis_ms || null,
    api_call_ms: diagnostic.timing?.api_call_ms || null,

    // Document stats
    doc_total_elements: diagnostic.document?.total_children || null,
    doc_captured_elements: (diagnostic.document?.captured?.paragraph || 0) +
                          (diagnostic.document?.captured?.list_item || 0),
    doc_total_chars: diagnostic.document?.captured?.total_chars || null,
    doc_is_empty: diagnostic.request?.content_payload_is_empty || false,
    doc_invisible_tables: diagnostic.document?.invisible?.table || 0,
    doc_invisible_images: diagnostic.document?.invisible?.inline_image || 0,
    doc_invisible_other: (diagnostic.document?.invisible?.footnote || 0) +
                        (diagnostic.document?.invisible?.other || 0),

    // Request info
    instruction_length: diagnostic.request?.instruction_length || null,
    instruction_preview: diagnostic.request?.instruction_preview || null,
    has_selection: diagnostic.request?.has_selection || false,
    user_mode: diagnostic.request?.user_mode || 'edit',
    preview_mode: diagnostic.request?.preview_mode || false,

    // Response info
    ai_mode: diagnostic.response?.mode || null,
    response_sub_mode: diagnostic.response?.sub_mode || null,
    updates_count: diagnostic.response?.updates_applied || diagnostic.response?.changes_count || null,
    response_length: diagnostic.response?.response_length || null,

    // Analysis
    intent_mismatch: intentMismatch,
    doc_was_empty_problem: docWasEmptyProblem,

    // Errors
    error_message: diagnostic.errors?.length > 0 ? diagnostic.errors[0].error : null,

    // Extra metadata
    extra: {
      by_type: diagnostic.document?.by_type || null,
      element_details_count: diagnostic.document?.element_details?.length || 0
    }
  };

  const success = await saveDiagnosticEvent(env, eventData);

  return new Response(
    JSON.stringify({
      status: success ? 'ok' : 'error',
      logged: success,
      analysis: {
        intent_mismatch: intentMismatch,
        doc_was_empty_problem: docWasEmptyProblem
      }
    }),
    { headers: corsHeaders }
  );
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT v3 - "Document Engineering Engine" (Lovable-style)
// ═══════════════════════════════════════════════════════════════

function buildSystemPrompt(hasSelection, hasFile, styleGuide, strictMode, negativeConstraints, docSkeleton, docStats, userMode) {
  // v3.7: UNIVERSAL DOC READER - Build complete document stats string
  let docStatsStr = '';
  if (docStats) {
    const parts = [];
    parts.push(`Paràgrafs: ${docStats.paragraphs || 0}`);
    parts.push(`Llistes: ${docStats.lists || 0}`);
    if (docStats.tables > 0) parts.push(`Taules: ${docStats.tables} (només lectura)`);
    if (docStats.has_header) parts.push(`Capçalera: SÍ`);
    if (docStats.has_footer) parts.push(`Peu de pàgina: SÍ`);
    if (docStats.footnotes > 0) parts.push(`Notes al peu: ${docStats.footnotes}`);
    if (docStats.has_images) parts.push(`Imatges: SÍ (analitzables si s'envien)`);
    if (docStats.has_drawings) parts.push(`Dibuixos: SÍ (no visibles)`);
    parts.push(`Total caràcters: ${docStats.total_chars || 0}`);
    parts.push(`Document buit: ${docStats.is_empty ? 'SÍ ⚠️' : 'NO'}`);

    docStatsStr = '\n- ' + parts.join('\n- ');
  }

  let prompt = `
═══════════════════════════════════════════════════════════════
IDENTITAT
═══════════════════════════════════════════════════════════════
Ets Docmile, un MOTOR D'ENGINYERIA DOCUMENTAL.
NO ets un xatbot passiu. Ets un AGENT D'EXECUCIÓ que transforma intencions en operacions atòmiques.

═══════════════════════════════════════════════════════════════
PROTOCOL D'EXECUCIÓ (Chain of Thought - OBLIGATORI)
═══════════════════════════════════════════════════════════════
ABANS de generar el JSON, ANALITZA internament i escriu el teu raonament al camp "thought":

1. INTENCIÓ → Què vol l'usuari? (Editar | Crear | Consultar)
2. LOCALITZACIÓ → On afecta? (Selecció activa: ${hasSelection ? 'SÍ - apunta a text específic' : 'NO - document complet'})
3. ESTRATÈGIA → Quina és la MÍNIMA operació necessària?

El camp "thought" és OBLIGATORI en TOTES les respostes.

═══════════════════════════════════════════════════════════════
CONTEXT ACTUAL
═══════════════════════════════════════════════════════════════
- Mode usuari: ${userMode === 'chat' ? 'XAT (NO pots editar el document)' : 'EDICIÓ (pots editar el document)'}
- Selecció activa: ${hasSelection ? 'SÍ (l\'usuari ha seleccionat text específic)' : 'NO'}
- Fitxer de coneixement: ${hasFile ? 'SÍ (usa\'l com a font)' : 'NO'}${docStatsStr}
${userMode === 'chat' ? `
⚠️ IMPORTANT - MODE XAT ACTIU:
Estàs en mode XAT, no pots fer canvis al document.
Si l'usuari demana una TRANSFORMACIÓ del text (verb que implica canviar-lo),
respon amb la teva resposta normal però AFEGEIX al final:

💡 Per aplicar aquest canvi al document, canvia a mode **Edit** (botó superior esquerre).

Exemples de transformacions: "resumeix", "tradueix", "corregeix", "millora", "escurça", "amplia", "reformula", "simplifica", "formalitza", "canvia X per Y"
` : ''}
═══════════════════════════════════════════════════════════════
FORMAT DEL TEXT D'ENTRADA (v5.4)
═══════════════════════════════════════════════════════════════
El text del document ve marcat amb IDs:
- {{0}}, {{1}}, {{2}}... → Paràgrafs i llistes (editables via UPDATE_BY_ID)
- {{T:0}}, {{T:1}}... → Taules (NOMÉS LECTURA - no editables directament)
- ⟦SEL⟧ → Marcador de SELECCIÓ ACTIVA (v5.4)

Les taules apareixen així:
{{T:X}} [TAULA]
| Col1 | Col2 |
|---|---|
| val1 | val2 |
[/TAULA]

IMPORTANT: Les taules es mostren com a referència. NO pots editar-les directament.
Si l'usuari demana canvis a una taula, explica-li que ha d'editar-la manualment.

═══════════════════════════════════════════════════════════════
GESTIÓ DE SELECCIÓ INTEL·LIGENT (v6.7)
═══════════════════════════════════════════════════════════════
El marcador ⟦SEL⟧ indica text SELECCIONAT per l'usuari. Reps context (±3 paràgrafs).

QUAN HI HA SELECCIÓ (⟦SEL⟧ present):

1. TRANSFORMACIÓ SOBRE SELECCIÓ
   Verbs: resumeix, tradueix, millora, corregeix, escurça, amplia, reformula, simplifica...
   → MODE: UPDATE_BY_ID
   → Transforma NOMÉS els paràgrafs marcats amb ⟦SEL⟧
   → Exemple: "resumeix" amb {{3}} ⟦SEL⟧ → Retorna {"updates": {"3": "text resumit"}}

2. EXTRACCIÓ SOBRE SELECCIÓ
   Verbs: explica, descriu, analitza, què significa, què vol dir...
   → MODE: CHAT_ONLY
   → Respon basant-te en el text marcat amb ⟦SEL⟧
   → Exemple: "explica això" → Resposta al xat sobre el fragment

3. PREGUNTA GENERAL (ignora selecció)
   Patrons: quin és el títol, de què parla, qui és l'autor, quantes pàgines...
   → MODE: CHAT_ONLY
   → Usa TOT el context disponible, no només la selecció

REGLA D'OR: Mode EDIT + Selecció + Verb de Transformació = SEMPRE UPDATE_BY_ID

MAI inventis informació que no apareix al text proporcionat.
⚠️ PERÒ pots i HAURIES d'analitzar to, sentiment, connotacions, estil i qualitat del text.
Preguntes com "quina paraula és més positiva/negativa?", "quin to té?", "és formal?"
→ RESPON amb la teva anàlisi basada en el text. Això NO és inventar, és ANALITZAR.

═══════════════════════════════════════════════════════════════
CLASSIFICACIÓ D'INSTRUCCIONS (v6.7)
═══════════════════════════════════════════════════════════════

PAS 1: IDENTIFICA EL TIPUS D'INSTRUCCIÓ

▸ VERBS DE TRANSFORMACIÓ (el resultat REEMPLAÇA el text original):
  Compressió: resumeix, sintetitza, condensa, escurça
  Expansió: amplia, desenvolupa, elabora, detalla
  Traducció: tradueix, passa a [idioma]
  Correcció: corregeix, esmena, revisa, arregla
  Millora: millora, poleix, refina, optimitza
  Reformulació: reformula, parafraseja, reescriu, redacta de nou
  Formalitat: formalitza, fes-ho més formal/informal
  Simplificació: simplifica, clarifica, fes-ho més clar/entenedor

▸ VERBS D'EXTRACCIÓ (el resultat és INFORMACIÓ sobre el text):
  Explicació: explica, descriu, aclareix, què vol dir, què significa
  Anàlisi: analitza, examina, estudia, revisa críticament
  Avaluació: avalua, valora, opina sobre, què en penses
  Pregunta: què és, quin és, com és, per què, quants, qui

▸ VERBS DE VISUALITZACIÓ (v7.1) (el resultat és MARCAR parts del document):
  Detecció: detecta, troba, busca, localitza, identifica errors/faltes/problemes
  Revisió: revisa gramàtica/ortografia/estil, comprova, verifica
  Assenyalar: marca, assenyala, indica, mostra, ressalta, destaca, subratlla
  Localització: on puc millorar, quines parts, on hi ha errors
  Qualitat: inconsistències, ambigüitats, repeticions, punts febles
  Preguntes: hi ha errors?, què està malament?, què puc millorar?

PAS 2: APLICA LA REGLA DE CONTEXT

| MODE USUARI     | TIPUS INSTRUCCIÓ | ACCIÓ JSON          |
|-----------------|------------------|---------------------|
| QUALSEVOL       | Visualització    | REFERENCE_HIGHLIGHT |  ← PRIORITAT MÀXIMA
| EDIT + Selecció | Transformació    | UPDATE_BY_ID        |
| EDIT + Selecció | Extracció        | CHAT_ONLY           |
| EDIT + No sel.  | Transformació    | REWRITE             |
| EDIT + No sel.  | Extracció        | CHAT_ONLY           |
| CHAT            | Qualsevol        | CHAT_ONLY           |

IMPORTANT: Visualització té PRIORITAT sobre les altres regles. Si l'usuari demana detectar, trobar, revisar o marcar problemes → SEMPRE usa REFERENCE_HIGHLIGHT independentment del mode.

═══════════════════════════════════════════════════════════════
MODES DE RESPOSTA JSON
═══════════════════════════════════════════════════════════════

[CHAT_ONLY] → Resposta conversacional
Quan: Instrucció d'EXTRACCIÓ, o mode CHAT actiu.
Acció: Respon al xat. NO toques el document.

[UPDATE_BY_ID] → Edició quirúrgica
Quan: Instrucció de TRANSFORMACIÓ amb selecció activa.
Acció: Edita NOMÉS els paràgrafs afectats via {{ID}}. Cirurgia, no reemplaçament.

[REWRITE] → Generació de contingut nou
Quan: L'usuari demana CREAR contingut NOU (escriu un email, genera una llista, crea des de zero).
Acció: Genera estructura nova amb blocks tipats.

[REFERENCE_HIGHLIGHT] → Marcar i explicar (v7.1 - OBLIGATORI per detecció)

⚠️ REGLA CRÍTICA: Si l'usuari pregunta per errors, faltes, problemes, repeticions, o qualsevol cosa que requereixi LOCALITZAR parts del document → USA REFERENCE_HIGHLIGHT, MAI CHAT_ONLY.

Triggers OBLIGATORIS (usa SEMPRE REFERENCE_HIGHLIGHT):
- "Hi ha errors?" / "Veus errors?" / "Detecta errors" → REFERENCE_HIGHLIGHT
- "Revisa gramàtica/ortografia" → REFERENCE_HIGHLIGHT
- "On puc millorar?" / "Què està malament?" → REFERENCE_HIGHLIGHT
- "Troba repeticions/inconsistències" → REFERENCE_HIGHLIGHT
- "Quines parts són febles/confuses?" → REFERENCE_HIGHLIGHT
- Qualsevol pregunta que impliqui LOCALITZAR problemes → REFERENCE_HIGHLIGHT

⛔ ERROR COMÚ: Respondre amb CHAT_ONLY llistant {{4}}, {{6}}, etc. en text pla.
✅ CORRECTE: Usar mode REFERENCE_HIGHLIGHT amb array "highlights".

Acció: Marca parts del document amb colors i explica. NO edites res.

⚠️ REGLES PER ai_response:
- Frase CURTA i NETA: "He trobat X errors." o "He detectat els següents problemes:"
- MAI repeteixis el text dels errors a ai_response (ja surt als highlights!)
- MAI repeteixis els snippets ni les correccions a ai_response
- Usa singular/plural correcte: "1 error" (NO "1 errors")

Format:
{
  "thought": "[Anàlisi: quines parts destaco i per què]",
  "mode": "REFERENCE_HIGHLIGHT",
  "ai_response": "He trobat 2 errors ortogràfics.",
  "highlights": [
    {"para_id": 5, "color": "orange", "reason": "'increiblement' → 'increïblement'", "snippet": "...és increiblement...", "start": 15, "end": 28},
    {"para_id": 12, "color": "orange", "reason": "'inportant' → 'important'", "snippet": "...molt inportant...", "start": 8, "end": 16}
  ]
}

⛔ ai_response INCORRECTE: "He trobat 1 error: 'documentafció' hauria de ser 'documentació'" ← REPETEIX INFO!
✅ ai_response CORRECTE: "He trobat 1 error ortogràfic." ← NET!

Camps dels highlights:
- para_id: Índex del paràgraf ({{0}}, {{1}}, etc.) - OBLIGATORI
- color: "yellow" (atenció/repetició), "orange" (error/problema), "blue" (recomanació), "purple" (ambigüitat/pregunta) - OBLIGATORI
- reason: Motiu breu del marcatge - OBLIGATORI
- snippet: Fragment de text afectat (màx 50 chars) - OBLIGATORI
- start: Posició inicial DINS el paràgraf - MOLT RECOMANAT per granularitat
- end: Posició final DINS el paràgraf - MOLT RECOMANAT per granularitat

⚠️ GRANULARITAT OBLIGATÒRIA (v7.4):
- SEMPRE proporciona start/end quan l'error és en una paraula o frase concreta
- NO marquis paràgrafs sencers si l'error és puntual
- start = posició del PRIMER caràcter del problema (0-indexed)
- end = posició DESPRÉS de l'últim caràcter

Exemple: Si el paràgraf és "El document tramet informació" i l'error és "tramet":
- start: 13 (posició de 't' de 'tramet')
- end: 19 (posició després de 't' final)

Usa para_id exactes del document ({{0}}, {{1}}, etc.). Marca TOTS els problemes que trobis, sense límit.

EXEMPLE COMPLET AMB GRANULARITAT - Usuari pregunta "veus errors ortogràfics?":
{
  "thought": "L'usuari demana detectar errors. Trobo 'tramet' ({{4}} posició 13-19), 'edn' ({{6}} posició 8-11). Uso REFERENCE_HIGHLIGHT amb posicions exactes.",
  "mode": "REFERENCE_HIGHLIGHT",
  "ai_response": "He trobat 2 errors ortogràfics.",
  "highlights": [
    {"para_id": 4, "color": "orange", "reason": "'tramet' → 'trametre'", "snippet": "...tramet...", "start": 13, "end": 19},
    {"para_id": 6, "color": "orange", "reason": "'edn' → 'en'", "snippet": "...edn el...", "start": 8, "end": 11}
  ]
}

⚠️ EXEMPLE INCORRECTE (sense granularitat):
{"para_id": 4, "color": "orange", "reason": "error", "snippet": "..."} ← Marca TOT el paràgraf!

✅ EXEMPLE CORRECTE (amb granularitat):
{"para_id": 4, "color": "orange", "reason": "'tramet'→'trametre'", "snippet": "tramet", "start": 13, "end": 19} ← Marca NOMÉS la paraula!

⛔ INCORRECTE (NO fer això):
{
  "mode": "CHAT_ONLY",
  "chat_response": "He detectat errors: {{4}} tramet, {{6}} edn..."
}

═══════════════════════════════════════════════════════════════
DISTINCIÓ CRÍTICA: PREGUNTES vs ORDRES (v7.3)
═══════════════════════════════════════════════════════════════

⚠️ REGLA D'OR: Una PREGUNTA sobre problemes → MARCAR, no editar.
⚠️ Una ORDRE de correcció → EDITAR.

| INSTRUCCIÓ                        | MODE               | RAONAMENT                      |
|-----------------------------------|--------------------|---------------------------------|
| "Veus errors ortogràfics?"        | REFERENCE_HIGHLIGHT | Pregunta d'anàlisi → marcar    |
| "Hi ha faltes de gramàtica?"      | REFERENCE_HIGHLIGHT | Pregunta d'anàlisi → marcar    |
| "Detecta inconsistències"         | REFERENCE_HIGHLIGHT | Detecció → marcar              |
| "Corregeix els errors"            | UPDATE_BY_ID       | Ordre explícita → editar       |
| "Arregla l'ortografia"            | UPDATE_BY_ID       | Ordre explícita → editar       |
| "Pots simplificar el text?"       | UPDATE_BY_ID       | Pregunta AMB intenció edició   |
| "Podries millorar-ho?"            | UPDATE_BY_ID       | Pregunta AMB intenció edició   |

PATRÓ PREGUNTA AMB INTENCIÓ D'EDICIÓ:
- "Pots/Podries/Sabries + [verb d'edició]?" → SÍ editar
- Exemples: "Pots simplificar?", "Podries resumir?", "Pots fer-ho més curt?"

⛔ ERROR GREU: "Veus errors?" → Corregir directament sense permís
✅ CORRECTE: "Veus errors?" → REFERENCE_HIGHLIGHT amb els errors marcats

═══════════════════════════════════════════════════════════════
GESTIÓ DE CONTINUÏTAT (CRÍTIC)
═══════════════════════════════════════════════════════════════
Si l'usuari diu "una altra", "aquesta no m'agrada", "canvia-la", "no", "diferent":
→ Es refereix al CANVI ANTERIOR. Proposa una alternativa DIFERENT.
→ MAI tornis a una versió ja rebutjada.
→ MAI preguntis "un altre què?" si tens context d'un canvi recent.

Exemples:
- "canvia X per Y" → ho fas → "una altra" = alternativa a Y, diferent de X i Y
- "millora-ho" → ho fas → "no m'agrada" = nova versió, diferent de l'anterior

═══════════════════════════════════════════════════════════════
DIRECTIVES D'ESTIL
═══════════════════════════════════════════════════════════════
- Sigues AUDAÇ: "millora-ho" = millores substancials, no cosmètiques
- Preserva format Markdown (**negreta**, *cursiva*) en edicions
- Respon en l'IDIOMA de l'usuari
- En mode EDIT amb selecció: si és verb de transformació → EDITA sense dubtar
- En mode CHAT: mai editis, sempre respon al xat

═══════════════════════════════════════════════════════════════
FORMAT JSON (OBLIGATORI - SENSE TEXT EXTRA)
═══════════════════════════════════════════════════════════════

**CHAT_ONLY:**
{
  "thought": "[Anàlisi: intenció + localització + estratègia]",
  "mode": "CHAT_ONLY",
  "chat_response": "Resposta al xat",
  "change_summary": "Consulta resolta"
}

**UPDATE_BY_ID:** (el text ve marcat amb {{ID}})
{
  "thought": "[Anàlisi: intenció + localització + estratègia]",
  "mode": "UPDATE_BY_ID",
  "updates": {
    "0": "Text nou pel paràgraf 0",
    "3": "Text nou pel paràgraf 3"
  },
  "change_summary": "Descripció breu dels canvis"
}

**REWRITE:**
{
  "thought": "[Anàlisi: intenció + localització + estratègia]",
  "mode": "REWRITE",
  "blocks": [
    { "type": "HEADING_1", "text": "Títol" },
    { "type": "PARAGRAPH", "text": "Contingut" },
    { "type": "BULLET_LIST", "text": "Element de llista" }
  ],
  "change_summary": "Descripció del contingut generat"
}

Tipus de blocks: HEADING_1, HEADING_2, HEADING_3, PARAGRAPH, BULLET_LIST, NUMBERED_LIST, TABLE

**TABLE (v6.0):**
Quan necessitis crear una TAULA nova:
{
  "type": "TABLE",
  "headers": ["Capçalera1", "Capçalera2", "Capçalera3"],
  "rows": [
    ["Fila1Col1", "Fila1Col2", "Fila1Col3"],
    ["Fila2Col1", "Fila2Col2", "Fila2Col3"]
  ]
}
Regles TABLE:
- headers: Array de strings (capçaleres obligatòries)
- rows: Array d'arrays (cada fila té el MATEIX nombre d'elements que headers)
- Usa strings sempre, fins i tot per números ("10", no 10)
- Màxim: 10 columnes, 50 files

**TABLE_UPDATE (v6.0):**
Quan l'usuari demani MODIFICAR una taula existent:
{
  "thought": "[Anàlisi de l'edició de taula]",
  "mode": "TABLE_UPDATE",
  "table_id": 0,
  "operations": [
    {"action": "update_cell", "row": 1, "col": 2, "value": "Nou valor"},
    {"action": "add_row", "after_row": 3, "values": ["A", "B", "C"]},
    {"action": "delete_row", "row": 5},
    {"action": "update_row", "row": 2, "values": ["X", "Y", "Z"]}
  ],
  "change_summary": "Descripció dels canvis"
}
Operacions disponibles:
- update_cell: Canvia una cel·la (row, col, value)
- add_row: Afegeix fila després de after_row (values = array)
- delete_row: Esborra fila (row)
- update_row: Reescriu fila sencera (row, values)
Índexs comencen a 0. Fila 0 = capçaleres.

═══════════════════════════════════════════════════════════════
RESSALTAT PROACTIU (v9.0 - Columna Central del Projecte)
═══════════════════════════════════════════════════════════════

⚠️ REGLA CRÍTICA: Quan parlis sobre el document, SEMPRE marca els fragments que referencis.

QUAN MARCAR TEXT:
- Quan citis o referencïs parts específiques del document
- Quan expliquis o comentes sobre fragments concrets
- Quan responguis preguntes sobre el contingut del document
- Quan identifiquis elements rellevants (encara que no siguin errors)

FORMAT DE MARCATGE: [[text exacte del document]]
- Usa doble claudàtor per marcar el text a ressaltar
- El text DINS els claudàtors ha de ser EXACTE al document (case-sensitive)
- Màxim 10-15 paraules per marcatge (prefereix granularitat fina)

GRANULARITAT ADAPTATIVA:
- Error ortogràfic → Marca només la PARAULA: [[increiblement]]
- Frase problemàtica → Marca la FRASE: [[Es va decidir per raons diverses]]
- Concepte clau → Marca el FRAGMENT: [[la teoria de la relativitat]]
- Secció referenciada → Marca NOMÉS l'inici: [[Capítol 3: Metodologia]]

EXEMPLES D'ÚS CORRECTE:

Usuari: "De què parla el document?"
Resposta: "El document tracta sobre [[el canvi climàtic i els seus efectes]] a la Mediterrània. A la introducció menciona [[l'augment de temperatures de 1.5°C]] com a punt crític."

Usuari: "Qui és l'autor?"
Resposta: "L'autor és [[Dr. Maria Garcia]], tal com indica la capçalera del document."

Usuari: "Què significa aquesta part?"  (amb selecció)
Resposta: "El fragment [[la paradoxa del gat de Schrödinger]] fa referència a un experiment mental de física quàntica..."

Usuari: "Hi ha algun problema amb el text?"
Resposta: "Sí, detecta algunes qüestions:
- [[increiblement]] hauria de ser 'increïblement'
- [[la la casa]] té una repetició
- [[Es va decidir per raons diverses que no podem explicar aquí]] és una frase massa vaga"

⛔ ERRORS A EVITAR:
- NO marquis text que NO existeix al document
- NO marquis la teva pròpia resposta, només text DEL document
- NO usis marcatge per èmfasi genèric ([[important!]]) - només per text del document
- NO marquis paràgrafs sencers si pots ser més específic
- ⚠️ MAI usis símbols de secció (§) ni numeració de paràgrafs (§1, §2). SEMPRE usa el TEXT EXACTE dins [[]]

✅ FORMAT CORRECTE: [[text exacte copiat del document]]
⛔ FORMAT INCORRECTE: §1, §2, [1], [§1], (paràgraf 1) - NO USAR MAI

✅ PRIORITAT: Sempre que parlis d'una part concreta del document → MARCA-LA amb [[]]
`;

  // Style guide
  if (styleGuide && styleGuide.trim()) {
    prompt += `
═══════════════════════════════════════════════════════════════
GUIA D'ESTIL PERSONALITZADA
═══════════════════════════════════════════════════════════════
${styleGuide}
`;
  }

  // Strict mode
  if (strictMode) {
    prompt += `
⚠️ MODE ESTRICTE ACTIU: Respon NOMÉS amb informació verificable del context/fitxer. NO inventis dades.
(L'anàlisi de to, sentiment i estil SÍ està permesa - això és interpretar, no inventar.)
`;
  }

  // v2.9: Document skeleton (structure awareness)
  if (docSkeleton && docSkeleton.structure && docSkeleton.structure.length > 0) {
    prompt += `
═══════════════════════════════════════════════════════════════
📊 ESTRUCTURA DEL DOCUMENT (Context Engine v2.9)
═══════════════════════════════════════════════════════════════
Aquest és un MAPA de l'estructura del document. Usa-ho per entendre el context:

`;
    // Add document stats
    if (docSkeleton.stats) {
      prompt += `📄 ${docSkeleton.doc_name || 'Document'} | ${docSkeleton.stats.total_chars} chars | ${docSkeleton.stats.paragraph_count} paràgrafs\n\n`;
    }

    // Add structure items
    prompt += `ESTRUCTURA:\n`;
    docSkeleton.structure.forEach((item, idx) => {
      if (item.type === 'SECTION') {
        prompt += `  [${idx}] 📄 ${item.preview.substring(0, 60)}...\n`;
        if (item.entities && item.entities.length > 0) {
          prompt += `       └─ Entitats: ${item.entities.slice(0, 5).join(', ')}\n`;
        }
      } else if (item.type !== 'WARNING') {
        // It's a heading (H1, H2, VISUAL_H, BOLD_H, etc.)
        prompt += `  [${idx}] 📌 ${item.type}: "${item.text}"\n`;
      }
    });

    prompt += `
Usa aquest mapa per:
- Entendre l'organització jeràrquica del document
- Identificar on fer canvis sense trencar l'estructura
- Detectar entitats rellevants (dates, imports, percentatges)
`;
  }

  // v2.8: Negative constraints (banned words)
  if (negativeConstraints && Array.isArray(negativeConstraints) && negativeConstraints.length > 0) {
    prompt += `
═══════════════════════════════════════════════════════════════
⛔ PARAULES PROHIBIDES (CRÍTIC - MAI USAR)
═══════════════════════════════════════════════════════════════
L'usuari ha prohibit EXPRESSAMENT les següents paraules/frases.
NO les utilitzis MAI en cap circumstància, ni en edicions ni en respostes.
Si el text original les conté, substitueix-les per sinònims adequats.

LLISTA NEGRA: ${negativeConstraints.join(', ')}

Si alguna d'aquestes paraules apareix al text que estàs editant, REEMPLAÇA-LA automàticament.
`;
  }

  // v6.7: Document References - Referències vives
  if (docStats || docSkeleton) {
    prompt += `
═══════════════════════════════════════════════════════════════
📍 REFERÈNCIES AL DOCUMENT (v6.7)
═══════════════════════════════════════════════════════════════
Quan responguis preguntes sobre el CONTINGUT del document, CITA la font
amb el text exacte entre [[dobles claudàtors]].

FORMAT: [[text exacte del document]]

EXEMPLES:
- "La clau urbanística és 10b [[clau urbanística aplicable és 10b]]"
- "L'import total és [[45.320,00€ IVA inclòs]]"
- "Segons [[l'article 5.2 del reglament]], el termini és..."
- "El projecte té 3 fases: [[Fase 1: Disseny]], [[Fase 2: Implementació]]..."

REGLES:
1. Usa text EXACTE del document (permet localitzar-lo automàticament)
2. Prou llarg per ser únic (no [[10b]] sol, sinó [[clau urbanística 10b]])
3. NO inventis text - només cita el que existeix al document
4. Múltiples cites en una resposta = múltiples [[...]]

QUAN USAR:
✅ "Quin és l'import?" → cita l'import amb context
✅ "On parla de X?" → cita la frase on apareix X
✅ "Quines dates hi ha?" → cita cada data trobada
❌ "Millora el text" → NO cal citar (és edició, no consulta)
❌ Preguntes generals sense document → NO cal citar

Això permet a l'usuari fer CLIC i veure exactament d'on treus la informació.
`;
  }

  return prompt;
}

// ═══════════════════════════════════════════════════════════════
// SAFE JSON PARSER - Never crashes, always returns something
// ═══════════════════════════════════════════════════════════════

function safeParseJSON(rawText) {
  // Step 1: Try direct parse
  try {
    return JSON.parse(rawText);
  } catch (e) {
    // Continue to extraction
  }

  // Step 2: Try to extract first {...} block (model sometimes adds text around JSON)
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {
    // Continue to fallback
  }

  // Step 3: Return null to signal failure
  return null;
}

// ═══════════════════════════════════════════════════════════════
// UNIFIED RESPONSE VALIDATOR (v3.1 - Shadow Validator)
// ═══════════════════════════════════════════════════════════════

/**
 * Unified validation function - single source of truth for response quality
 * @param {string} rawText - Raw response from Gemini
 * @param {Object} constraints - Validation constraints
 * @param {string[]} constraints.bannedWords - Words that must not appear
 * @param {number} constraints.maxLength - Maximum output length (optional)
 * @returns {Object} Validation result
 */
function validateResponse(rawText, constraints = {}) {
  const result = {
    isValid: true,
    json: null,
    parsed: null,
    errors: [],
    warnings: [],
    blocker: null  // 'JSON' | 'BANNED' | 'EMPTY' | null
  };

  // ─── CHECK 1: Empty Response ───
  if (!rawText || rawText.trim().length < 5) {
    result.isValid = false;
    result.errors.push('Empty or too short response');
    result.blocker = 'EMPTY';
    return result;
  }

  // ─── CHECK 2: JSON Validity ───
  const jsonResult = safeParseJSON(rawText);
  if (jsonResult === null) {
    result.isValid = false;
    result.errors.push('Invalid JSON structure');
    result.blocker = 'JSON';
    return result;
  }
  result.json = jsonResult;

  // ─── CHECK 3: Parse and Normalize ───
  result.parsed = parseAndValidate(rawText);

  // ─── CHECK 4: Banned Words ───
  if (constraints.bannedWords && constraints.bannedWords.length > 0) {
    const outputText = getOutputText(result.parsed);
    const foundBanned = findBannedWords(outputText, constraints.bannedWords);

    if (foundBanned.length > 0) {
      result.isValid = false;
      result.errors.push(`Banned words detected: ${foundBanned.join(', ')}`);
      result.blocker = 'BANNED';
      result.bannedWordsFound = foundBanned;
    }
  }

  // ─── CHECK 5: Length Sanity (Warning only) ───
  if (constraints.maxLength) {
    const outputText = getOutputText(result.parsed);
    if (outputText.length > constraints.maxLength) {
      result.warnings.push(`Output length (${outputText.length}) exceeds recommended max (${constraints.maxLength})`);
    }
  }

  // ─── CHECK 6: Required Fields ───
  if (!result.parsed.mode) {
    result.warnings.push('Missing mode field, defaulted to CHAT_ONLY');
  }
  if (!result.parsed.thought) {
    result.warnings.push('Missing thought field (Chain of Thought)');
  }

  return result;
}

/**
 * La Guillotina Suau - Final sanitization to forcibly remove banned words
 * Replaces banned words with generic synonyms when all retries are exhausted
 * @param {Object} parsedResponse - The parsed AI response
 * @param {string[]} bannedWords - List of words that must not appear
 * @returns {Object} Sanitized response with banned words replaced
 */
function sanitizeBannedWords(parsedResponse, bannedWords) {
  if (!bannedWords || bannedWords.length === 0) {
    return parsedResponse;
  }

  const genericReplacements = {
    // Default: replace with "document" or context-appropriate synonym
    default: 'document'
  };

  // Create regex for all banned words (case-insensitive, word boundaries)
  const bannedPattern = new RegExp(
    `\\b(${bannedWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
    'gi'
  );

  // Function to sanitize a single string
  const sanitizeText = (text) => {
    if (!text || typeof text !== 'string') return text;
    return text.replace(bannedPattern, genericReplacements.default);
  };

  // Deep clone to avoid mutation
  const sanitized = JSON.parse(JSON.stringify(parsedResponse));

  // Sanitize all text fields
  if (sanitized.updates && typeof sanitized.updates === 'object') {
    for (const key of Object.keys(sanitized.updates)) {
      sanitized.updates[key] = sanitizeText(sanitized.updates[key]);
    }
  }

  if (sanitized.blocks && Array.isArray(sanitized.blocks)) {
    sanitized.blocks = sanitized.blocks.map(block => ({
      ...block,
      content: sanitizeText(block.content)
    }));
  }

  if (sanitized.chat_response) {
    sanitized.chat_response = sanitizeText(sanitized.chat_response);
  }

  if (sanitized.change_summary) {
    sanitized.change_summary = sanitizeText(sanitized.change_summary);
  }

  return sanitized;
}

/**
 * Build error feedback message for retry prompt
 * @param {Object} validation - Result from validateResponse()
 * @returns {string} Feedback message for Gemini
 */
function buildRetryFeedback(validation) {
  if (validation.blocker === 'JSON') {
    return `ERROR: La teva resposta no era JSON vàlid.
Torna a intentar-ho amb NOMÉS el JSON, sense text extra abans ni després.
Format requerit: { "thought": "...", "mode": "...", ... }`;
  }

  if (validation.blocker === 'BANNED') {
    return `ERROR: La teva resposta conté paraules PROHIBIDES: "${validation.bannedWordsFound.join('", "')}".
Aquestes paraules estan a la LLISTA NEGRA de l'usuari i MAI s'han d'usar.
REESCRIU la resposta substituint aquestes paraules per sinònims acceptables.`;
  }

  if (validation.blocker === 'EMPTY') {
    return `ERROR: La teva resposta estava buida o era massa curta.
Genera una resposta completa seguint el format JSON especificat.`;
  }

  return `ERROR: La resposta no ha passat la validació. Errors: ${validation.errors.join('; ')}`;
}

// ═══════════════════════════════════════════════════════════════
// v6.7: INSTRUCTION CLASSIFIER - Detect transform vs extract verbs
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta si una instrucció és de transformació (hauria de fer UPDATE_BY_ID)
 * @param {string} instruction - La instrucció de l'usuari
 * @returns {boolean} true si és transformació, false si és extracció
 */
function isTransformVerb(instruction) {
  if (!instruction) return false;

  const normalized = instruction.toLowerCase().trim();

  // Verbs de transformació (el resultat reemplaça el text original)
  const transformPatterns = [
    /^resum/i,           // resumeix, resumir, resum
    /^sintetitz/i,       // sintetitza, sintetitzar
    /^condens/i,         // condensa, condensar
    /^escurça/i,         // escurça, escurçar
    /^tradueix/i,        // tradueix, traduir
    /^tradui/i,          // traduir
    /^passa.*a\s+(castellà|anglès|francès)/i,  // passa a castellà
    /^corregeix/i,       // corregeix, corregir
    /^esmena/i,          // esmena
    /^arregla/i,         // arregla
    /^millora/i,         // millora, millorar
    /^poleix/i,          // poleix
    /^refina/i,          // refina
    /^optimitza/i,       // optimitza
    /^reformula/i,       // reformula, reformular
    /^parafraseja/i,     // parafraseja
    /^reescriu/i,        // reescriu, reescriure
    /^amplia/i,          // amplia, ampliar
    /^desenvolupa/i,     // desenvolupa
    /^elabora/i,         // elabora
    /^detalla/i,         // detalla
    /^formalitza/i,      // formalitza
    /^simplifica/i,      // simplifica, simplificar
    /^clarifica/i,       // clarifica
    /^fes[- ]?ho.*clar/i,   // fes-ho més clar
    /^fes[- ]?ho.*formal/i, // fes-ho més formal
    /^fes[- ]?ho.*curt/i,   // fes-ho més curt
    /^fes[- ]?ho.*llarg/i,  // fes-ho més llarg
    /^canvia/i,          // canvia
    /^substitueix/i,     // substitueix
    /^elimina/i,         // elimina
    /^afegeix/i,         // afegeix
    /^estructura/i,      // estructura
    /^organitza/i,       // organitza
    /^reordena/i,        // reordena
  ];

  return transformPatterns.some(pattern => pattern.test(normalized));
}

/**
 * v7.1: Detecta si una instrucció és de VISUALITZACIÓ (hauria de fer REFERENCE_HIGHLIGHT)
 * @param {string} instruction - La instrucció de l'usuari
 * @returns {boolean} true si és visualització/anàlisi que requereix marcar el document
 */
function isVisualizationVerb(instruction) {
  if (!instruction) return false;

  const normalized = instruction.toLowerCase().trim();

  // Patrons que indiquen que l'usuari vol VEURE/LOCALITZAR coses al document
  const visualizationPatterns = [
    // Detecció d'errors
    /\b(detecta|troba|busca|localitza|identifica)\b.{0,30}\b(error|falta|problema|incorrecci)/i,
    /\b(hi ha|tens?|veus?|existeix)\b.{0,30}\b(error|falta|problema|repetici)/i,
    /\berrors?\s+(ortogràfic|gramatical|de\s+puntuaci)/i,
    /\bfaltes?\s+(d'ortografia|de\s+gramàtica)/i,

    // Revisió i anàlisi
    /\b(revisa|analitza|examina|comprova|verifica)\b.{0,20}\b(gramàtica|ortografia|estil|coherència|puntuaci)/i,
    /\b(revisa|analitza|examina)\b.{0,10}(el\s+text|el\s+document|això)/i,

    // Marcar/assenyalar explícit
    /\b(marca|assenyala|indica|mostra|ressalta|destaca|subratlla)\b/i,

    // Localització de problemes
    /\b(on|a on|quines?\s+parts?|quins?\s+llocs?|què)\b.{0,20}\b(millorar|corregir|revisar|canviar|arreglar)/i,
    /\bon\s+(hi\s+ha|estan?|trobo?|puc)/i,

    // Problemes específics
    /\b(inconsistènci|ambigü|confús|confusi|feble|repetit|redundan)/i,
    /\bpunts?\s+(forts?|febles?|clau|crítics?|millorables?)/i,
    /\bparts?\s+(confus|febl|problemàti|millorabl)/i,

    // Preguntes sobre qualitat
    /\bquè\s+(està\s+malament|falla|no\s+funciona|puc\s+millorar)/i,
    /\b(com\s+puc|què\s+hauria)\b.{0,15}millorar/i,

    // Repeticions i redundàncies
    /\b(repetici|redundànci|reiteraci)/i,
    /\b(paraules?|frases?|expressions?)\s+(repetid|redundant)/i,

    // Estructura i coherència
    /\b(estructura|organitzaci|flux|coherència|cohesi)/i,
    /\bsalts?\s+(lògics?|argumentals?)/i,

    // Cites i referències
    /\b(cites?|referències?|fonts?)\s+(sense|incorrect|problemàti)/i,

    // Estil
    /\bproblemes?\s+(d'estil|estilístic)/i,
    /\bestil\s+(inconsistent|problemàtic|millorable)/i,

    // v7.4: Preguntes sobre contingut (proactiu)
    /\b(què|que)\s+diu\b.{0,30}\b(sobre|de|del|respecte)/i,
    /\b(hi ha|existeix|apareix|es menciona|parla)\b.{0,20}(referènci|menció|sobre)/i,
    /\bon\s+(parla|tracta|menciona|apareix|diu)\b/i,
    /\b(quin|quina|quins|quines)\s+(argument|conclusi|punt|idea|part)/i,
    /\b(quines?\s+parts?|quins?\s+fragments?)\b.{0,20}(parlen?|tracten?|mencionen?)/i,

    // v7.4: Preguntes d'anàlisi qualitativa (proactiu)
    /\b(és|està)\s+(coherent|consistent|adequat|correcte|clar|ben\s+escrit)/i,
    /\b(el\s+to|l'estil|el\s+registre)\s+(és|sembla|està)/i,
    /\b(quines?\s+conclusions?|què\s+conclou)/i,
    /\b(està\s+ben|és\s+correcte|és\s+adequat)/i,
    /\b(és\s+massa|està\s+massa)\s+(llarg|curt|formal|informal|tècnic)/i,
    /\b(entén|s'entén|queda\s+clar)/i,

    // v7.4: Localització de conceptes
    /\b(on|a\s+on)\s+(es\s+)?parla\s+de\b/i,
    /\b(localitza|troba|busca)\b.{0,15}\b(on|a\s+on|lloc)/i,
    /\b(en\s+quin|quins?)\s+(paràgraf|part|secció|lloc)/i,
  ];

  return visualizationPatterns.some(pattern => pattern.test(normalized));
}

/**
 * v7.2: Detecta si una instrucció és una PREGUNTA (acaba amb ?)
 * Les preguntes MAI haurien de modificar el document directament.
 * @param {string} instruction - La instrucció de l'usuari
 * @returns {boolean} true si és una pregunta
 */
function isQuestion(instruction) {
  if (!instruction) return false;

  const trimmed = instruction.trim();

  // Pregunta directa (acaba amb ?)
  if (trimmed.endsWith('?')) return true;

  // Patrons interrogatius implícits (sense ? però clarament preguntes)
  const questionPatterns = [
    /^(hi ha|tens?|veus?|trobes?|detectes?|existeix)/i,
    /^(quin|quina|quins|quines|què|com|on|per què|quan)\b/i,
    /\b(pots? dir-me|em pots? dir|saps?|coneixes?)\b/i,
  ];

  return questionPatterns.some(p => p.test(trimmed));
}

/**
 * v7.3: Detecta si una PREGUNTA té intenció d'edició
 * Exemples: "Pots simplificar el text?", "Podries corregir les faltes?"
 * Aquestes preguntes SÍ haurien de poder modificar el document.
 * @param {string} instruction - La instrucció de l'usuari
 * @returns {boolean} true si és una pregunta amb intenció d'edició
 */
function isQuestionWithEditIntent(instruction) {
  if (!instruction) return false;

  const trimmed = instruction.trim().toLowerCase();

  // Ha de ser una pregunta
  if (!isQuestion(instruction)) return false;

  // Patrons de petició d'edició en forma de pregunta
  const editIntentPatterns = [
    // "Pots/Podries + verb d'edició"
    /\b(pots?|podries?|sabries?|series capaç)\s+(de\s+)?(corregir|millorar|simplificar|resumir|ampliar|traduir|reescriure|reformular|parafrasej|arreglar|esmenar|polir|refinar|optimitzar|sintetitzar|condensar|escurçar|desenvolupar|elaborar|detallar|clarificar|formalitzar|canviar|substituir|eliminar|afegir|estructurar|organitzar|reordenar)/i,
    // "Em pots + verb d'edició"
    /\bem\s+pots?\s+(corregir|millorar|simplificar|resumir|traduir|arreglar)/i,
    // "Pots fer + més curt/llarg/formal/etc."
    // v7.3.1: Canviat [^?]* per .* per evitar que el ? final interfereixi
    /\bpots?\s+(fer|posar).*(més\s+(curt|llarg|formal|informal|simple|clar|concís|breu))/i,
  ];

  // v7.3.1: Treure el ? final abans de testejar per evitar interferències amb regex
  const trimmedNoQuestion = trimmed.replace(/\?+$/, '');
  return editIntentPatterns.some(p => p.test(trimmedNoQuestion));
}

/**
 * v7.2: Detecta si una instrucció és una ORDRE EXPLÍCITA de modificació
 * Només retorna true per ordres imperatives clares com "corregeix", "millora", etc.
 * @param {string} instruction - La instrucció de l'usuari
 * @returns {boolean} true si és una ordre explícita de modificació
 */
function isExplicitEditOrder(instruction) {
  if (!instruction) return false;

  const trimmed = instruction.trim().toLowerCase();

  // Si és pregunta, NO és ordre explícita
  if (isQuestion(instruction)) return false;

  // Ordres imperatives clares (verb a l'inici, sense interrogant)
  const editOrderPatterns = [
    /^(corregeix|corregir|esmena|arregla)\b/i,
    /^(millora|millorar|poleix|refina|optimitza)\b/i,
    /^(reescriu|reescriure|reformula|parafraseja)\b/i,
    /^(tradueix|traduir|passa\s+a)\b/i,
    /^(resumeix|resumir|sintetitza|condensa|escurça)\b/i,
    /^(amplia|ampliar|desenvolupa|elabora|detalla)\b/i,
    /^(simplifica|clarifica|formalitza)\b/i,
    /^(canvia|substitueix|elimina|afegeix)\b/i,
    /^(estructura|organitza|reordena)\b/i,
  ];

  return editOrderPatterns.some(p => p.test(trimmed));
}

/**
 * Extreu l'ID del paràgraf seleccionat del text amb marcadors
 * @param {string} text - Text del document amb marcadors {{ID}} i ⟦SEL⟧
 * @returns {string|null} - ID del paràgraf seleccionat o null
 */
function extractSelectedParaId(text) {
  if (!text) return null;

  // Buscar patró: {{ID}} seguit de ⟦SEL⟧ (amb possible espai/text entremig)
  const match = text.match(/\{\{(\d+)\}\}[^{]*⟦SEL⟧/);
  if (match) {
    return match[1];
  }

  // Alternativa: ⟦SEL⟧ precedit per {{ID}}
  const altMatch = text.match(/\{\{(\d+)\}\}.*?⟦SEL⟧/s);
  if (altMatch) {
    return altMatch[1];
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE PARSER AND VALIDATOR - Robust normalization
// ═══════════════════════════════════════════════════════════════

function parseAndValidate(rawText) {
  // Try to parse JSON safely
  let parsed = safeParseJSON(rawText);

  // If JSON fails completely, treat as chat response
  if (!parsed || typeof parsed !== 'object') {
    return {
      mode: "CHAT_ONLY",
      chat_response: rawText || "No he pogut processar la resposta.",
      change_summary: "Resposta de text lliure"
    };
  }

  // ─── NORMALIZE MODE ───
  // Accept various formats and normalize to our 3 valid modes
  const rawMode = (parsed.mode || parsed.operation || '').toString().toUpperCase().trim();

  // Map all possible values to our valid modes
  const modeMap = {
    // Valid modes
    'CHAT_ONLY': 'CHAT_ONLY',
    'UPDATE_BY_ID': 'UPDATE_BY_ID',
    'REWRITE': 'REWRITE',
    // Common variations → CHAT_ONLY
    'CHAT': 'CHAT_ONLY',
    'NO_OP': 'CHAT_ONLY',
    'NOOP': 'CHAT_ONLY',
    'EXPLAIN': 'CHAT_ONLY',
    'ANSWER': 'CHAT_ONLY',
    'RESPONSE': 'CHAT_ONLY',
    // Common variations → UPDATE_BY_ID
    'UPDATE': 'UPDATE_BY_ID',
    'EDIT': 'UPDATE_BY_ID',
    'MODIFY': 'UPDATE_BY_ID',
    'CHANGE': 'UPDATE_BY_ID',
    // Common variations → REWRITE
    'INSERT': 'REWRITE',
    'INSERT_AFTER': 'REWRITE',
    'INSERT_BEFORE': 'REWRITE',
    'CREATE': 'REWRITE',
    'GENERATE': 'REWRITE',
    // v7.0: Reference Highlight mode
    'REFERENCE_HIGHLIGHT': 'REFERENCE_HIGHLIGHT',
    'REFERENCE': 'REFERENCE_HIGHLIGHT',
    'HIGHLIGHT': 'REFERENCE_HIGHLIGHT',
    'ANALYZE': 'REFERENCE_HIGHLIGHT',
    'MARK': 'REFERENCE_HIGHLIGHT',
    // v6.0: Table Update mode
    'TABLE_UPDATE': 'TABLE_UPDATE',
    'TABLE_EDIT': 'TABLE_UPDATE',
    'EDIT_TABLE': 'TABLE_UPDATE',
    'MODIFY_TABLE': 'TABLE_UPDATE'
  };

  parsed.mode = modeMap[rawMode] || 'CHAT_ONLY';  // DEFAULT: CHAT_ONLY (safe)

  // ─── VALIDATE UPDATE_BY_ID ───
  if (parsed.mode === 'UPDATE_BY_ID') {
    if (!parsed.updates || typeof parsed.updates !== 'object' || Object.keys(parsed.updates).length === 0) {
      // No valid updates → convert to CHAT
      parsed.mode = 'CHAT_ONLY';
      parsed.chat_response = parsed.change_summary || parsed.userMessage || "No s'han trobat canvis a aplicar.";
    }
  }

  // ─── VALIDATE REWRITE ───
  if (parsed.mode === 'REWRITE') {
    if (!parsed.blocks || !Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
      // No valid blocks → convert to CHAT
      parsed.mode = 'CHAT_ONLY';
      parsed.chat_response = parsed.change_summary || parsed.userMessage || "No s'ha pogut generar contingut nou.";
    } else {
      // v6.0: Validate TABLE blocks
      for (let i = 0; i < parsed.blocks.length; i++) {
        const block = parsed.blocks[i];
        if (block.type === 'TABLE') {
          // Validate TABLE structure
          if (!block.headers || !Array.isArray(block.headers) || block.headers.length === 0) {
            block._error = 'TABLE: Falta headers';
            continue;
          }
          if (!block.rows || !Array.isArray(block.rows)) {
            block.rows = []; // Allow empty tables
          }
          // Ensure all rows have correct column count
          const numCols = block.headers.length;
          block.rows = block.rows.filter(row => Array.isArray(row)).map(row => {
            // Pad or truncate to match headers
            while (row.length < numCols) row.push('');
            return row.slice(0, numCols).map(cell => String(cell));
          });
          // Convert headers to strings
          block.headers = block.headers.map(h => String(h));
        }
      }
    }
  }

  // ─── VALIDATE TABLE_UPDATE (v6.0) ───
  if (parsed.mode === 'TABLE_UPDATE') {
    if (typeof parsed.table_id !== 'number' || parsed.table_id < 0) {
      parsed.mode = 'CHAT_ONLY';
      parsed.chat_response = parsed.change_summary || "No s'ha pogut identificar la taula a modificar.";
    } else if (!parsed.operations || !Array.isArray(parsed.operations) || parsed.operations.length === 0) {
      parsed.mode = 'CHAT_ONLY';
      parsed.chat_response = parsed.change_summary || "No s'han especificat operacions per la taula.";
    } else {
      // Validate each operation
      const validActions = ['update_cell', 'add_row', 'delete_row', 'update_row'];
      parsed.operations = parsed.operations.filter(op => {
        if (!op.action || !validActions.includes(op.action)) return false;
        switch (op.action) {
          case 'update_cell':
            return typeof op.row === 'number' && typeof op.col === 'number' && op.value !== undefined;
          case 'add_row':
            return typeof op.after_row === 'number' && Array.isArray(op.values);
          case 'delete_row':
            return typeof op.row === 'number';
          case 'update_row':
            return typeof op.row === 'number' && Array.isArray(op.values);
          default:
            return false;
        }
      });
      if (parsed.operations.length === 0) {
        parsed.mode = 'CHAT_ONLY';
        parsed.chat_response = parsed.change_summary || "Les operacions de taula no són vàlides.";
      }
    }
  }

  // ─── VALIDATE REFERENCE_HIGHLIGHT (v7.1 - Ampliat) ───
  if (parsed.mode === 'REFERENCE_HIGHLIGHT') {
    if (!parsed.highlights || !Array.isArray(parsed.highlights)) {
      parsed.highlights = [];
    }
    // v7.1: Filter invalid highlights - NO LIMIT (era màx 5)
    const validColors = ['yellow', 'orange', 'blue', 'purple'];
    parsed.highlights = parsed.highlights
      .filter(h => typeof h.para_id === 'number' && h.para_id >= 0)
      .map(h => {
        const highlight = {
          para_id: h.para_id,
          color: validColors.includes(h.color) ? h.color : 'yellow',
          reason: String(h.reason || '').substring(0, 100),  // v7.1: Ampliat de 50 a 100
          snippet: String(h.snippet || '').substring(0, 60)  // v7.1: Ampliat de 30 a 60
        };
        // v7.1: Suport per highlights parcials (start/end)
        if (typeof h.start === 'number' && h.start >= 0) {
          highlight.start = h.start;
        }
        if (typeof h.end === 'number' && h.end > 0) {
          highlight.end = h.end;
        }
        // Validar que end > start si tots dos existeixen
        if (highlight.start !== undefined && highlight.end !== undefined && highlight.end <= highlight.start) {
          delete highlight.start;
          delete highlight.end;
        }
        return highlight;
      });
    // If no valid highlights, convert to CHAT_ONLY
    if (parsed.highlights.length === 0) {
      parsed.mode = 'CHAT_ONLY';
      parsed.chat_response = parsed.ai_response || parsed.change_summary || "No he trobat seccions específiques a destacar.";
    } else {
      // Ensure ai_response exists
      parsed.ai_response = parsed.ai_response || parsed.chat_response || "He identificat les següents seccions:";

      // v9.5 FIX: Clean ai_response - remove duplicated content from highlights
      // AI often repeats snippets/reasons in ai_response which causes ugly duplication
      const escapeRx = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let cleanedAiResponse = parsed.ai_response;

      // Remove snippets and reasons that appear in highlights
      for (const hl of parsed.highlights) {
        if (hl.snippet) {
          // Remove quoted snippets like "documentafció" or 'documentafció'
          const snippetClean = hl.snippet.replace(/\.\.\./g, '').trim();
          if (snippetClean.length > 2) {
            cleanedAiResponse = cleanedAiResponse.replace(new RegExp('["\']?' + escapeRx(snippetClean) + '["\']?', 'gi'), '');
          }
        }
        if (hl.reason) {
          // Remove reason patterns like 'word' → 'correction'
          cleanedAiResponse = cleanedAiResponse.replace(new RegExp(escapeRx(hl.reason), 'gi'), '');
        }
      }

      // Remove orphan "X errors" patterns (duplicated count)
      // Only remove when after period/newline (not "He trobat 1 error" which is valid)
      cleanedAiResponse = cleanedAiResponse.replace(/[.\n]\s*\d+\s+errors?\b/gi, '.');

      // Remove newlines that might separate duplicated content
      cleanedAiResponse = cleanedAiResponse.replace(/\n+/g, ' ');

      // Clean up multiple spaces, orphan punctuation, trailing dots
      cleanedAiResponse = cleanedAiResponse
        .replace(/\s*[,;:]\s*[,;:]\s*/g, ' ')  // Multiple punctuation
        .replace(/\s{2,}/g, ' ')                // Multiple spaces
        .replace(/\s+\./g, '.')                 // Space before dot
        .replace(/\.{2,}/g, '.')                // Multiple dots
        .replace(/\.\s*$/g, '.')                // Ensure ends with single dot
        .trim();

      // If cleaned to almost nothing, use a default
      if (cleanedAiResponse.length < 10) {
        const count = parsed.highlights.length;
        cleanedAiResponse = count === 1
          ? "He trobat 1 error."
          : `He trobat ${count} errors.`;
      }

      parsed.ai_response = cleanedAiResponse;
    }
  }

  // ─── GUARANTEE chat_response FOR CHAT_ONLY ───
  if (parsed.mode === 'CHAT_ONLY') {
    // Try multiple fields to find a response
    parsed.chat_response = parsed.chat_response
      || parsed.userMessage
      || parsed.message
      || parsed.response
      || parsed.change_summary
      || parsed.explanation
      || parsed.newText  // Sometimes model puts chat in wrong field
      || "Entesos. Què més puc fer per tu?";  // Ultimate fallback
  }

  // ─── GUARANTEE change_summary ───
  if (!parsed.change_summary) {
    parsed.change_summary = parsed.userMessage || parsed.reason || "Operació completada.";
  }

  // ─── GUARANTEE thought (v2.7 - Chain of Thought) ───
  if (!parsed.thought) {
    // Generate a default thought based on the mode
    const modeThoughts = {
      'CHAT_ONLY': 'Intenció: consulta. Estratègia: respondre sense editar.',
      'UPDATE_BY_ID': 'Intenció: edició. Estratègia: modificar paràgrafs específics.',
      'REWRITE': 'Intenció: creació. Estratègia: generar contingut nou.',
      'REFERENCE_HIGHLIGHT': 'Intenció: anàlisi. Estratègia: marcar seccions rellevants sense editar.',
      'TABLE_UPDATE': 'Intenció: edició de taula. Estratègia: modificar cel·les o files específiques.'
    };
    parsed.thought = modeThoughts[parsed.mode] || 'Processant petició.';
  }

  return parsed;
}

// ═══════════════════════════════════════════════════════════════
// v9.0: PROACTIVE HIGHLIGHT PARSER
// ═══════════════════════════════════════════════════════════════
// Extracts [[text]] markers from AI response for document highlighting

function parseProactiveHighlights(response, documentText) {
  // Extract text field from response (can be chat_response, ai_response, etc.)
  const responseText = response.chat_response || response.ai_response || '';

  if (!responseText || !documentText) {
    return { cleanedResponse: responseText, highlights: [] };
  }

  // Regex to find all [[text]] markers
  const markerRegex = /\[\[([^\]]+)\]\]/g;
  const highlights = [];
  const seenTexts = new Set();
  let match;

  while ((match = markerRegex.exec(responseText)) !== null) {
    const markedText = match[1].trim();

    // Skip if empty or already seen (avoid duplicates)
    if (!markedText || seenTexts.has(markedText.toLowerCase())) {
      continue;
    }
    seenTexts.add(markedText.toLowerCase());

    // Try to find this text in the document
    // First, try exact match
    let foundInDoc = documentText.includes(markedText);

    // If not found, try case-insensitive
    if (!foundInDoc) {
      foundInDoc = documentText.toLowerCase().includes(markedText.toLowerCase());
    }

    if (foundInDoc) {
      // Find which paragraph contains this text
      const paraMatch = findParagraphForText(documentText, markedText);

      highlights.push({
        text: markedText,
        para_id: paraMatch.para_id,
        start: paraMatch.start,
        end: paraMatch.end,
        confidence: paraMatch.confidence,
        // v9.2 FIX: Propagate normalized_text for fuzzy match fallback in Code.gs
        normalized_text: paraMatch.normalized_text || null
      });
    } else {
      // Text not found in document - might be AI hallucination or paraphrasing
      // Still include but mark as low confidence
      highlights.push({
        text: markedText,
        para_id: null,
        start: null,
        end: null,
        confidence: 'low'
      });
    }
  }

  // Clean the response by removing [[ ]] markers but keeping the text
  let cleanedResponse = responseText.replace(/\[\[([^\]]+)\]\]/g, '$1');

  // v9.3 FIX: Remove raw §ID references that AI might generate despite instructions
  // Pattern: §1, §12, §123 (section symbols with numbers) - these should NOT appear
  cleanedResponse = cleanedResponse.replace(/§\d+/g, '');
  // Also clean up orphaned punctuation after removal (e.g., ", ," or "  ")
  cleanedResponse = cleanedResponse.replace(/\s+,/g, ',').replace(/\s{2,}/g, ' ').trim();

  return {
    cleanedResponse,
    highlights: highlights.filter(h => h.para_id !== null) // Only return found highlights
  };
}

// Helper: Find paragraph ID and position for a text snippet
function findParagraphForText(documentText, searchText) {
  // Document format: {{0}} text {{1}} text {{2}} text...
  // Parse paragraphs
  const paraRegex = /\{\{(\d+)\}\}\s*([\s\S]*?)(?=\{\{(?:\d+|T:\d+|TOC:\d+)\}\}|$)/g;
  let paraMatch;

  while ((paraMatch = paraRegex.exec(documentText)) !== null) {
    const paraId = parseInt(paraMatch[1], 10);
    const paraText = paraMatch[2];

    // Try exact match first
    let pos = paraText.indexOf(searchText);
    if (pos !== -1) {
      return {
        para_id: paraId,
        start: pos,
        end: pos + searchText.length,
        confidence: 'exact'
      };
    }

    // Try case-insensitive match
    pos = paraText.toLowerCase().indexOf(searchText.toLowerCase());
    if (pos !== -1) {
      return {
        para_id: paraId,
        start: pos,
        end: pos + searchText.length,
        confidence: 'case_insensitive'
      };
    }
  }

  // Not found in any paragraph with exact boundaries
  // Try fuzzy match with normalized whitespace
  // v9.1 FIX: Keep original case for normalized_text (body.findText is case-sensitive!)
  const cleanSearchLower = searchText.replace(/\s+/g, ' ').trim().toLowerCase();
  const cleanSearchOriginal = searchText.replace(/\s+/g, ' ').trim();  // Keep case!

  // Re-scan paragraphs with normalized whitespace
  paraRegex.lastIndex = 0;  // Reset regex
  while ((paraMatch = paraRegex.exec(documentText)) !== null) {
    const paraId = parseInt(paraMatch[1], 10);
    const originalParaText = paraMatch[2];
    const normalizedParaText = originalParaText.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalizedParaText.includes(cleanSearchLower)) {
      // Found with normalized whitespace
      // v9.0 FIX: Don't return positions for fuzzy matches - let Code.gs search by text
      // The positions would be wrong because they're based on normalized text
      return {
        para_id: paraId,
        start: null,  // Force fallback to text search in Code.gs
        end: null,
        confidence: 'fuzzy',
        // v9.1 FIX: Store with ORIGINAL case for body.findText() compatibility
        normalized_text: cleanSearchOriginal
      };
    }
  }

  // Truly not found
  return {
    para_id: null,
    start: null,
    end: null,
    confidence: 'not_found'
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

    try {
      const body = await request.json();

      // Route to appropriate handler
      if (body.action === 'upload_file') {
        return await handleFileUpload(body, env, corsHeaders);
      }
      // v5.1: Get credits info
      if (body.action === 'get_credits') {
        return await handleGetCredits(body, env, corsHeaders);
      }
      if (body.action === 'get_receipts') {
        return await handleGetReceipts(body, env, corsHeaders);
      }
      if (body.action === 'save_receipt') {
        return await handleSaveReceipt(body, env, corsHeaders);
      }
      if (body.action === 'delete_receipt') {
        return await handleDeleteReceipt(body, env, corsHeaders);
      }
      // v3.0: Event Sourcing endpoints
      if (body.action === 'get_edit_history') {
        return await handleGetEditHistory(body, env, corsHeaders);
      }
      if (body.action === 'revert_edit') {
        return await handleRevertEdit(body, env, corsHeaders);
      }
      // v3.7: Diagnostic logging endpoint
      if (body.action === 'log_diagnostic') {
        return await handleLogDiagnostic(body, env, corsHeaders);
      }
      // v4.0: Timeline endpoints
      if (body.action === 'confirm_edit') {
        return await handleConfirmEdit(body, env, corsHeaders);
      }
      if (body.action === 'get_timeline') {
        return await handleGetTimeline(body, env, corsHeaders);
      }

      // v5.0: Conversations endpoints
      if (body.action === 'list_conversations') {
        return await handleListConversations(body, env, corsHeaders);
      }
      if (body.action === 'get_conversation') {
        return await handleGetConversation(body, env, corsHeaders);
      }
      // v6.5: Paginated message retrieval
      if (body.action === 'get_conversation_messages') {
        return await handleGetConversationMessages(body, env, corsHeaders);
      }
      if (body.action === 'create_conversation') {
        return await handleCreateConversation(body, env, corsHeaders);
      }
      if (body.action === 'append_messages') {
        return await handleAppendMessages(body, env, corsHeaders);
      }
      if (body.action === 'update_conversation') {
        return await handleUpdateConversation(body, env, corsHeaders);
      }
      if (body.action === 'delete_conversation') {
        return await handleDeleteConversation(body, env, corsHeaders);
      }
      if (body.action === 'generate_title') {
        return await handleGenerateTitle(body, env, corsHeaders);
      }
      // v8.1: Generate recipe summary
      if (body.action === 'generate_recipe_summary') {
        return await handleGenerateRecipeSummary(body, env, corsHeaders);
      }

      // v5.1: Knowledge Library endpoints
      if (body.action === 'get_knowledge_library') {
        return await handleGetKnowledgeLibrary(body, env, corsHeaders);
      }
      if (body.action === 'upload_to_library') {
        return await handleUploadToLibrary(body, env, corsHeaders);
      }
      if (body.action === 'link_knowledge') {
        return await handleLinkKnowledge(body, env, corsHeaders);
      }
      if (body.action === 'unlink_knowledge') {
        return await handleUnlinkKnowledge(body, env, corsHeaders);
      }
      if (body.action === 'delete_from_library') {
        return await handleDeleteFromLibrary(body, env, corsHeaders);
      }
      // v6.0: Folder management endpoints
      if (body.action === 'move_to_folder') {
        return await handleMoveToFolder(body, env, corsHeaders);
      }
      if (body.action === 'rename_folder') {
        return await handleRenameFolder(body, env, corsHeaders);
      }
      if (body.action === 'delete_folder') {
        return await handleDeleteFolder(body, env, corsHeaders);
      }
      if (body.action === 'create_folder') {
        return await handleCreateFolder(body, env, corsHeaders);
      }

      // Default: Chat handler
      return await handleChat(body, env, corsHeaders);

    } catch (err) {
      return new Response(JSON.stringify({ status: "error", error_code: err.message }),
        { status: 500, headers: corsHeaders });
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// CHAT HANDLER - v2.4 with Conversational Memory
// ═══════════════════════════════════════════════════════════════

async function handleChat(body, env, corsHeaders) {
  // ═══ v3.1: Start time tracking for Time Budget ═══
  const startTime = Date.now();

  const {
    license_key,
    text,
    user_instruction,
    doc_metadata,
    style_guide,
    strict_mode,
    knowledge_file_uri,
    knowledge_file_mime,
    has_selection,
    chat_history,  // Conversational memory
    last_edit,     // v2.6: Last edit memory for "una altra" cases
    user_mode,     // v3.10: User-selected mode (edit | chat)
    negative_constraints,  // v2.8: Banned words/phrases
    doc_skeleton,  // v2.9: Document structure (headings, sections, entities)
    doc_stats,     // v3.7: Universal Doc Reader stats
    client_hash,   // v4.0: Timeline - document hash before action
    word_count,    // v4.0: Timeline - word count for delta tracking
    chat_attachments,  // v8.0: Temporary file attachments from chat
    images         // v6.0: Document images as base64 for multimodal analysis
  } = body;

  if (!license_key) throw new Error("missing_license");
  if (!text) throw new Error("missing_text");

  // ═══════════════════════════════════════════════════════════════
  // v7.0: FAST PATH - Resposta immediata per salutacions simples
  // ═══════════════════════════════════════════════════════════════
  const greetingPatterns = /^(hola|bon dia|bona tarda|bona nit|hey|hi|hello|ei|bones|què tal|com estàs|com va)[\s!?.]*$/i;
  const userMsg = (user_instruction || '').trim();

  if (greetingPatterns.test(userMsg)) {
    // Validar llicència ràpidament
    const licenseHash = await hashKey(license_key);
    const creditsResult = await useCredits(env, licenseHash, doc_metadata);

    const greetings = [
      "Hola! 👋 Què puc fer pel teu document?",
      "Bon dia! En què et puc ajudar?",
      "Hola! Estic preparat per ajudar-te amb el document.",
      "Hey! Digue'm què necessites."
    ];
    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];

    return new Response(JSON.stringify({
      status: 'ok',
      data: {
        mode: 'CHAT_ONLY',
        chat_response: randomGreeting,
        change_summary: 'Salutació',
        thought: 'Salutació detectada, resposta ràpida.'
      },
      credits_remaining: creditsResult.remaining
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // v8.3: MULTI-AGENT PIPELINE (Nova arquitectura de classificació IA)
  // ═══════════════════════════════════════════════════════════════
  try {
    const newPipelineResult = await tryNewPipeline(body, env);

    if (newPipelineResult) {
      // Pipeline ha processat la petició - validar crèdits
      const licenseHash = await hashKey(license_key);
      const creditsResult = await useCredits(env, licenseHash, doc_metadata);

      // Event sourcing per edicions (mantenim compatibilitat amb timeline)
      let savedEventId = null;
      const docId = doc_metadata?.doc_id || 'unknown';

      if (newPipelineResult.mode === 'UPDATE_BY_ID' && newPipelineResult.updates) {
        const updateEntries = Object.entries(newPipelineResult.updates);
        if (updateEntries.length > 0) {
          const [targetId, afterText] = updateEntries[0];
          const eventData = {
            license_hash: licenseHash,
            doc_id: docId,
            event_type: 'ai_edit',
            target_id: parseInt(targetId, 10),
            before_text: text.match(new RegExp(`\\{\\{${targetId}\\}\\}\\s*([\\s\\S]*?)(?=\\{\\{|$)`))?.[1]?.trim() || '',
            after_text: afterText,
            instruction: user_instruction,
            ai_reasoning: newPipelineResult.thought || ''
          };
          const savedEvent = await saveEditEvent(env, eventData);
          if (savedEvent) savedEventId = savedEvent.id;
        }
      } else if (newPipelineResult.mode === 'REWRITE' && newPipelineResult.blocks) {
        const eventData = {
          license_hash: licenseHash,
          doc_id: docId,
          event_type: 'ai_rewrite',
          target_id: -1,
          before_text: JSON.stringify({ blocks_affected: newPipelineResult.blocks.length }),
          after_text: JSON.stringify(newPipelineResult.blocks),
          instruction: user_instruction,
          ai_reasoning: newPipelineResult.thought || ''
        };
        const savedEvent = await saveEditEvent(env, eventData);
        if (savedEvent) savedEventId = savedEvent.id;
      }

      console.log(`[Multi-Agent v8.3] ✅ Pipeline completed: ${newPipelineResult.mode}`);

      // v9.0: Proactive highlighting for multi-agent pipeline
      let pipelineHighlights = [];
      if (newPipelineResult.mode === 'CHAT_ONLY' || newPipelineResult.mode === 'REFERENCE_HIGHLIGHT') {
        const highlightResult = parseProactiveHighlights(newPipelineResult, text);
        if (highlightResult.cleanedResponse) {
          if (newPipelineResult.chat_response) {
            newPipelineResult.chat_response = highlightResult.cleanedResponse;
          } else if (newPipelineResult.ai_response) {
            newPipelineResult.ai_response = highlightResult.cleanedResponse;
          }
        }
        pipelineHighlights = highlightResult.highlights;
      }

      return new Response(JSON.stringify({
        status: "ok",
        data: newPipelineResult,
        proactive_highlights: pipelineHighlights,  // v9.0
        credits_remaining: creditsResult.credits_remaining || 0,
        event_id: savedEventId,
        _multiagent: newPipelineResult._multiagent,
        _debug: {
          version: "8.3.0-multiagent",
          pipeline: "new",
          has_selection: has_selection,
          elapsed_ms: Date.now() - startTime
        }
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (pipelineError) {
    console.error('[Multi-Agent v8.3] Pipeline error, falling back to legacy:', pipelineError.message);
    // Continuar amb pipeline legacy
  }
  // ═══════════════════════════════════════════════════════════════

  // v4.0: Detect NL ban patterns (Sprint 3)
  const autoBanWords = detectNLBanPatterns(user_instruction);

  // 1. License validation and credit usage
  const licenseHash = await hashKey(license_key);
  const docId = doc_metadata?.doc_id || 'unknown';
  const shouldDetectGap = client_hash && docId !== 'unknown';

  // v8.2: PARALLELIZED - Run useCredits and detectAndRecordGap simultaneously
  const [creditsResult, gapResult] = await Promise.all([
    // Credit usage (always runs) - with error handling for network failures
    useCredits(env, licenseHash, doc_metadata)
      .catch(creditError => {
        console.error('Credit check failed:', creditError.message);
        return { credits_remaining: 0, error: creditError.message };
      }),

    // Gap detection (conditional, returns null if skipped)
    shouldDetectGap
      ? detectAndRecordGap(env, licenseHash, docId, client_hash, word_count || 0)
          .catch(gapError => {
            console.error('Gap detection failed:', gapError.message);
            return null; // Non-blocking: continue even if gap detection fails
          })
      : Promise.resolve(null)
  ]);

  // 2. Build system prompt (context-driven)
  // v3.7: Afegim doc_stats per UNIVERSAL DOC READER
  // v6.6: Afegim user_mode per detectar intents d'edició en mode xat
  const systemPrompt = buildSystemPrompt(
    has_selection || false,
    !!knowledge_file_uri,
    style_guide,
    strict_mode,
    negative_constraints,  // v2.8: Banned words
    doc_skeleton,          // v2.9: Document structure
    doc_stats,             // v3.7: Universal Doc Reader stats
    user_mode              // v6.6: User-selected mode (edit | chat)
  );

  // 3. Build contents array with chat history (MEMORY)
  const contents = [];

  // Add user preferences FIRST (before history, so model has context)
  if (body.pinned_prefs) {
    contents.push({
      role: 'user',
      parts: [{
        text: `Preferències de l'usuari per aquest document:\n${JSON.stringify(body.pinned_prefs, null, 2)}`
      }]
    });
    // Model acknowledges preferences
    contents.push({
      role: 'model',
      parts: [{
        text: 'Entès, tindré en compte aquestes preferències.'
      }]
    });
  }

  // v2.6: Add last edit memory (for "una altra", "canvia-la", etc.)
  if (last_edit && last_edit.targetId !== undefined) {
    contents.push({
      role: 'user',
      parts: [{
        text: `ÚLTIM CANVI FET (memòria per si l'usuari demana alternatives):
- ID del paràgraf: {{${last_edit.targetId}}}
- Text ORIGINAL (abans del canvi): "${last_edit.originalText}"
- Text ACTUAL (després del canvi): "${last_edit.currentText}"`
      }]
    });
    contents.push({
      role: 'model',
      parts: [{
        text: 'Entès, recordo aquest canvi. Si l\'usuari diu "una altra", "canvia-la", "no m\'agrada", etc., proposaré una alternativa per al mateix fragment.'
      }]
    });
  }

  // Add previous conversation history
  if (chat_history && Array.isArray(chat_history)) {
    chat_history.forEach(msg => {
      if (msg.role && msg.text) {
        contents.push({
          role: msg.role,  // 'user' or 'model'
          parts: [{ text: msg.text }]
        });
      }
    });
  }

  // Build current context message
  const instruction = user_instruction || "Processa el text";

  // v8.0: Build chat attachments context
  let attachmentsContext = '';
  if (chat_attachments && chat_attachments.length > 0) {
    attachmentsContext = '\n\n═══ FITXERS ADJUNTS AL XAT (temporals) ═══\n';
    chat_attachments.forEach((att, i) => {
      const sizeKb = att.size ? (att.size / 1024).toFixed(1) + ' KB' : 'desconegut';
      attachmentsContext += `\n--- Fitxer ${i + 1}: ${att.name} (${sizeKb}) ---\n`;
      if (att.text) {
        attachmentsContext += att.text;
      } else if (att.content) {
        // Try to decode base64 for text-based files
        try {
          attachmentsContext += atob(att.content);
        } catch (e) {
          attachmentsContext += '[Contingut binari - no es pot mostrar com a text]';
        }
      } else {
        attachmentsContext += '[No s\'ha pogut extreure el contingut]';
      }
      attachmentsContext += '\n--- Fi del fitxer ---\n';
    });
  }

  let currentMessage = `CONTEXT FÍSIC:
- Text Seleccionat: ${has_selection ? 'SÍ' : 'NO'}
- Document ID: ${doc_metadata?.doc_id || 'unknown'}

TEXT ACTUAL DEL DOCUMENT:
${text}
${attachmentsContext}
INSTRUCCIÓ DE L'USUARI:
"${instruction}"`;

  // Add current message with optional file
  const userParts = [];

  if (knowledge_file_uri) {
    userParts.push({
      fileData: {
        fileUri: knowledge_file_uri,
        mimeType: knowledge_file_mime || "application/pdf"
      }
    });
  }

  // v6.0: Add document images as inlineData for multimodal analysis
  if (images && Array.isArray(images) && images.length > 0) {
    let imageCount = 0;
    for (const img of images) {
      if (img.data && img.mimeType && imageCount < 3) {
        userParts.push({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data  // base64 without "data:..." header
          }
        });
        imageCount++;
      }
    }
    if (imageCount > 0) {
      console.log(`[Multimodal v6.0] Added ${imageCount} images to Gemini request`);
    }
  }

  userParts.push({ text: currentMessage });
  contents.push({ role: 'user', parts: userParts });

  // ═══════════════════════════════════════════════════════════════
  // 4. SHADOW VALIDATOR LOOP (v3.1 - Unified Validation + Time Budget)
  // ═══════════════════════════════════════════════════════════════
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;

  let parsedResponse = null;
  let retryCount = 0;
  let currentContents = [...contents];
  let lastValidation = null;
  let timeoutAborted = false;

  // Validation constraints
  const validationConstraints = {
    bannedWords: negative_constraints || [],
    maxLength: 10000  // Sanity check for hallucinations
  };

  while (retryCount <= MAX_RETRIES) {
    // ─── TIME BUDGET CHECK (v3.1) ───
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > TIMEOUT_CUTOFF) {
      console.warn(`[Shadow Validator] Time budget exceeded: ${elapsedTime}ms > ${TIMEOUT_CUTOFF}ms. Aborting retries.`);
      timeoutAborted = true;
      break;
    }

    // ─── CALL GEMINI ───
    const geminiResp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: currentContents,
        system_instruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          responseMimeType: "application/json",
          temperature: retryCount === 0 ? 0.4 : 0.2  // Lower temp on retry
        }
      })
    });

    if (!geminiResp.ok) {
      const errorText = await geminiResp.text();
      // Handle expired/deleted knowledge file
      if (errorText.includes('PERMISSION_DENIED') && errorText.includes('File')) {
        throw new Error("KNOWLEDGE_FILE_EXPIRED: El fitxer de coneixement ha expirat o no existeix. Esborra'l a Configuració.");
      }
      throw new Error("gemini_error: " + errorText);
    }
    const geminiData = await geminiResp.json();
    const rawResponse = geminiData.candidates[0].content.parts[0].text;

    // ─── UNIFIED VALIDATION (v3.1) ───
    lastValidation = validateResponse(rawResponse, validationConstraints);

    if (lastValidation.isValid) {
      // ✅ All validations passed
      parsedResponse = lastValidation.parsed;
      break;
    }

    // ❌ Validation failed - decide if we retry
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`[Shadow Validator] Retry ${retryCount}/${MAX_RETRIES}. Blocker: ${lastValidation.blocker}`);

      // Build retry prompt with specific feedback
      currentContents = [...contents];
      currentContents.push({
        role: 'model',
        parts: [{ text: rawResponse }]
      });
      currentContents.push({
        role: 'user',
        parts: [{ text: buildRetryFeedback(lastValidation) }]
      });
    } else {
      // Max retries exhausted - use best effort
      console.warn(`[Shadow Validator] Max retries exhausted. Using best effort response.`);
      parsedResponse = lastValidation.parsed || parseAndValidate(rawResponse);
      break;
    }
  }

  // ─── GRACEFUL DEGRADATION (v3.1) ───
  // If we exited abnormally, ensure we have a parsedResponse
  if (!parsedResponse && lastValidation) {
    parsedResponse = lastValidation.parsed || {
      mode: 'CHAT_ONLY',
      chat_response: 'Ho sento, hi ha hagut un problema processant la resposta.',
      change_summary: 'Error de validació'
    };
  }

  // ─── LA GUILLOTINA SUAU (v3.1 Hotfix) ───
  // Final sanitization: ALWAYS remove banned words before returning
  // This is the last line of defense when retries are exhausted
  let sanitizationApplied = false;
  if (negative_constraints && negative_constraints.length > 0) {
    const beforeSanitize = JSON.stringify(parsedResponse);
    parsedResponse = sanitizeBannedWords(parsedResponse, negative_constraints);
    sanitizationApplied = JSON.stringify(parsedResponse) !== beforeSanitize;

    if (sanitizationApplied) {
      console.log(`[La Guillotina] Banned words forcibly removed from output`);
    }
  }

  // Build _meta for response quality tracking
  const _meta = {
    validation_passed: lastValidation?.isValid ?? false,
    retries: retryCount,
    timeout_aborted: timeoutAborted,
    sanitization_applied: sanitizationApplied,
    elapsed_ms: Date.now() - startTime
  };

  if (lastValidation && !lastValidation.isValid) {
    _meta.warning = "Low confidence response";
    _meta.errors = lastValidation.errors;
    _meta.blocker = lastValidation.blocker;
  }

  if (lastValidation?.warnings?.length > 0) {
    _meta.warnings = lastValidation.warnings;
  }

  // 5.1 Mode enforcement (v7.2: Safety-first - block edits for questions/visualization)
  const effectiveMode = user_mode || 'edit';
  const instructionIsTransform = isTransformVerb(user_instruction);
  const instructionIsVisualization = isVisualizationVerb(user_instruction);
  const instructionIsAQuestion = isQuestion(user_instruction);  // v7.2
  const instructionIsExplicitEdit = isExplicitEditOrder(user_instruction);  // v7.2
  const instructionIsQuestionWithEdit = isQuestionWithEditIntent(user_instruction);  // v7.3

  // ═══════════════════════════════════════════════════════════════
  // v7.3: SAFETY GATE - PREGUNTES MAI MODIFIQUEN EL DOCUMENT
  // ═══════════════════════════════════════════════════════════════
  // Regla de seguretat: Si és una pregunta (?) i la IA vol modificar,
  // BLOQUEGEM i convertim a CHAT_ONLY o REFERENCE_HIGHLIGHT
  // EXCEPCIÓ v7.3: Preguntes amb intenció d'edició ("Pots simplificar?") SÍ poden modificar
  if (instructionIsAQuestion && !instructionIsQuestionWithEdit && (parsedResponse.mode === 'REWRITE' || parsedResponse.mode === 'UPDATE_BY_ID')) {
    // v7.3.1: Guardar mode original ABANS de sobreescriure
    const blockedMode = parsedResponse.mode;
    console.warn(`[Mode Enforcement v7.3] ⛔ BLOCKED: Question "${user_instruction}" tried to trigger ${blockedMode}`);

    // Si és visualització, convertim a CHAT_ONLY amb hint
    // (REFERENCE_HIGHLIGHT requereix que la IA generi highlights, no podem inventar-los)
    const originalResponse = parsedResponse.change_summary || parsedResponse.chat_response || '';
    const originalThought = parsedResponse.thought || '';
    parsedResponse = {
      mode: 'CHAT_ONLY',
      chat_response: originalResponse || 'He analitzat el document.',
      change_summary: 'Consulta processada sense modificar el document',
      thought: originalThought + ' [v7.3: Bloqueig de seguretat - pregunta no pot editar]'
    };

    _meta.safety_block = {
      reason: 'question_blocked_edit',
      original_mode: blockedMode,  // v7.3.1: Ara guarda el mode original correctament
      instruction: user_instruction.substring(0, 100)
    };
    console.log(`[Mode Enforcement v7.3] Converted ${blockedMode} to CHAT_ONLY for safety`);
  }

  // ═══════════════════════════════════════════════════════════════
  // v7.2: SAFETY GATE - VISUALITZACIÓ MAI MODIFICA (sense ordre explícita)
  // ═══════════════════════════════════════════════════════════════
  // Si és visualització i NO és ordre explícita, bloquegem edicions
  if (instructionIsVisualization && !instructionIsExplicitEdit &&
      (parsedResponse.mode === 'REWRITE' || parsedResponse.mode === 'UPDATE_BY_ID')) {
    // v7.3.1: Guardar mode original ABANS de sobreescriure
    const blockedMode = parsedResponse.mode;
    console.warn(`[Mode Enforcement v7.3] ⛔ BLOCKED: Visualization "${user_instruction}" tried to trigger ${blockedMode}`);

    const originalResponse = parsedResponse.change_summary || parsedResponse.chat_response || '';
    const originalThought = parsedResponse.thought || '';
    parsedResponse = {
      mode: 'CHAT_ONLY',
      chat_response: originalResponse || 'He revisat el document.',
      change_summary: 'Anàlisi completada sense modificar el document',
      thought: originalThought + ' [v7.3: Bloqueig - visualització sense ordre explícita]'
    };

    _meta.safety_block = {
      reason: 'visualization_blocked_edit',
      original_mode: blockedMode,  // v7.3.1: Ara guarda el mode original correctament
      instruction: user_instruction.substring(0, 100)
    };
    console.log(`[Mode Enforcement v7.3] Visualization converted ${blockedMode} to CHAT_ONLY`);
  }

  // ═══════════════════════════════════════════════════════════════
  // v7.4: PROACTIVE REFERENCE_HIGHLIGHT - Retry i Auto-Parsing
  // ═══════════════════════════════════════════════════════════════
  if (instructionIsVisualization && parsedResponse.mode === 'CHAT_ONLY') {
    console.warn(`[Mode Enforcement v7.4] Visualization verb detected but AI returned CHAT_ONLY: "${user_instruction}"`);

    const responseText = parsedResponse.chat_response || '';

    // Detectar si la resposta menciona paràgrafs {{N}} o problemes
    const mentionsParas = /\{\{(\d+)\}\}/.test(responseText);
    const mentionsIssues = /\b(error|falta|problema|repetici|inconsist|ambig|incorrec|millorar|corregir|errada|tramet|ortogràfic|gramatical)\b/i.test(responseText);

    if (mentionsParas || mentionsIssues) {
      console.log(`[Mode Enforcement v7.4] Response mentions paras: ${mentionsParas}, issues: ${mentionsIssues}`);

      // P2: INTENT 1 - Auto-parsejar {{N}} de la resposta per construir highlights
      const autoHighlights = [];

      // Patró: {{N}} seguit de text explicatiu (fins a punt, coma, o següent {{)
      const paraPattern = /\{\{(\d+)\}\}\s*[""'«]?([^""'»\n{]+?)(?:[""'»]?\s*[:：\-–—]?\s*)?([^{.\n]*?)(?=[.،,;]|\{\{|$)/gi;
      let match;
      const seenParas = new Set();

      while ((match = paraPattern.exec(responseText)) !== null) {
        const paraId = parseInt(match[1], 10);
        if (seenParas.has(paraId)) continue;
        seenParas.add(paraId);

        const snippet = (match[2] || '').trim().substring(0, 50);
        const reason = (match[3] || match[2] || '').trim().substring(0, 100);

        // Determinar color basat en contingut
        let color = 'yellow';
        if (/error|falta|incorrec|errada/i.test(reason)) color = 'orange';
        if (/ambig|confús/i.test(reason)) color = 'purple';
        if (/recoman|sugger|millor/i.test(reason)) color = 'blue';

        autoHighlights.push({
          para_id: paraId,
          color: color,
          reason: reason || `Problema detectat al paràgraf ${paraId}`,
          snippet: snippet || '...'
        });
      }

      if (autoHighlights.length > 0) {
        // Èxit! Convertim a REFERENCE_HIGHLIGHT amb els highlights auto-generats
        console.log(`[Mode Enforcement v7.4] ✅ Auto-parsed ${autoHighlights.length} highlights from CHAT_ONLY response`);

        parsedResponse = {
          mode: 'REFERENCE_HIGHLIGHT',
          ai_response: responseText,
          highlights: autoHighlights,
          thought: (parsedResponse.thought || '') + ' [v7.4: Auto-converted from CHAT_ONLY]'
        };
        _meta.auto_highlight = {
          source: 'chat_parsing',
          count: autoHighlights.length
        };
      } else if (mentionsIssues && !_meta.reference_highlight_retry_done) {
        // P0: INTENT 2 - Retry amb prompt explícit si no hem pogut parsejar
        console.log(`[Mode Enforcement v7.4] 🔄 Attempting REFERENCE_HIGHLIGHT retry...`);

        const elapsedTime = Date.now() - startTime;
        if (elapsedTime < TIMEOUT_CUTOFF - 5000) {  // Només si tenim temps
          try {
            const retryPrompt = `
⚠️ CORRECCIÓ OBLIGATÒRIA: Has retornat CHAT_ONLY però havies d'usar REFERENCE_HIGHLIGHT.

La teva resposta anterior va ser:
"${responseText.substring(0, 500)}"

TORNA A RESPONDRE amb aquest format JSON EXACTE:
{
  "mode": "REFERENCE_HIGHLIGHT",
  "ai_response": "[la mateixa explicació]",
  "highlights": [
    {"para_id": N, "color": "orange|yellow|blue|purple", "reason": "explicació breu", "snippet": "fragment afectat", "start": X, "end": Y}
  ]
}

IMPORTANT:
- para_id: número del paràgraf (0, 1, 2...)
- start/end: posicions DINS del paràgraf per marcar EXACTAMENT el fragment problemàtic
- Marca TOTS els problemes que has detectat
`;

            // Afegir al context i fer retry
            const retryContents = [...currentContents,
              { role: 'model', parts: [{ text: JSON.stringify(parsedResponse) }] },
              { role: 'user', parts: [{ text: retryPrompt }] }
            ];

            const retryResp = await fetch(geminiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: retryContents,
                system_instruction: { parts: [{ text: systemPrompt }] },
                generationConfig: {
                  responseMimeType: "application/json",
                  temperature: 0.1  // Molt baixa per forçar format
                }
              })
            });

            if (retryResp.ok) {
              const retryJson = await retryResp.json();
              const retryText = retryJson?.candidates?.[0]?.content?.parts?.[0]?.text;

              if (retryText) {
                const retryParsed = parseAndValidate(retryText);

                if (retryParsed.mode === 'REFERENCE_HIGHLIGHT' && retryParsed.highlights?.length > 0) {
                  console.log(`[Mode Enforcement v7.4] ✅ Retry successful! Got ${retryParsed.highlights.length} highlights`);
                  parsedResponse = retryParsed;
                  _meta.reference_highlight_retry_done = true;
                  _meta.auto_highlight = {
                    source: 'retry',
                    count: retryParsed.highlights.length
                  };
                } else {
                  console.warn(`[Mode Enforcement v7.4] Retry returned ${retryParsed.mode}, keeping original`);
                  _meta.reference_highlight_retry_done = true;
                }
              }
            }
          } catch (retryErr) {
            console.error(`[Mode Enforcement v7.4] Retry error:`, retryErr);
          }
        } else {
          console.warn(`[Mode Enforcement v7.4] Not enough time for retry (${elapsedTime}ms elapsed)`);
        }
      }

      // Si encara som CHAT_ONLY, afegir hint
      if (parsedResponse.mode === 'CHAT_ONLY') {
        _meta.visualization_hint = true;
        _meta.misclassification = {
          instruction: user_instruction,
          ai_mode: 'CHAT_ONLY',
          expected_mode: 'REFERENCE_HIGHLIGHT',
          reason: 'Could not auto-convert or retry'
        };
      }
    }
  }

  if (effectiveMode === 'chat') {
    // Force CHAT_ONLY: Never edit, convert any edit response to chat
    // PERÒ: v7.1 - Si és visualització, permetem REFERENCE_HIGHLIGHT (no edita el document)
    if (parsedResponse.mode !== 'CHAT_ONLY' && parsedResponse.mode !== 'REFERENCE_HIGHLIGHT') {
      parsedResponse = {
        mode: 'CHAT_ONLY',
        chat_response: parsedResponse.change_summary || parsedResponse.chat_response || "Entesos.",
        change_summary: "Mode xat actiu - no s'ha editat el document"
      };
    }
  } else if (effectiveMode === 'edit') {
    // v6.7: Detect misclassification - AI returned CHAT_ONLY for transform verb
    if (parsedResponse.mode === 'CHAT_ONLY' && has_selection && instructionIsTransform && !instructionIsVisualization) {
      // AI misclassified a transform instruction as chat (only if not visualization)
      console.warn(`[Mode Enforcement v6.7] AI misclassified transform verb as CHAT_ONLY: "${user_instruction}"`);

      // Try to convert chat_response to UPDATE_BY_ID
      const selectedParaId = extractSelectedParaId(text);
      if (selectedParaId && parsedResponse.chat_response) {
        console.log(`[Mode Enforcement v6.7] Converting CHAT_ONLY to UPDATE_BY_ID for para ${selectedParaId}`);
        parsedResponse = {
          mode: 'UPDATE_BY_ID',
          updates: { [selectedParaId]: parsedResponse.chat_response.trim() },
          change_summary: parsedResponse.change_summary || 'Transformació aplicada',
          thought: (parsedResponse.thought || '') + ' [Conversió automàtica v6.7]'
        };
        _meta.auto_converted = true;
      } else {
        // Can't convert - log for analysis but don't add tip
        console.warn(`[Mode Enforcement v6.7] Could not convert - no selectedParaId found`);
        _meta.misclassification = {
          instruction: user_instruction,
          ai_mode: 'CHAT_ONLY',
          expected_mode: 'UPDATE_BY_ID'
        };
      }
    }
    // v6.7: If AI returned CHAT_ONLY for extraction verb, that's correct - no action needed
  }
  // v7.1: Mode classification now includes visualization detection

  // 5.2 Save edit event (v3.0 Event Sourcing)
  let savedEventId = null;
  if (parsedResponse.mode === 'UPDATE_BY_ID' && parsedResponse.updates) {
    // Save each update as an event (for now, save only the first one to keep it simple)
    const updateEntries = Object.entries(parsedResponse.updates);
    if (updateEntries.length > 0) {
      const [targetId, afterText] = updateEntries[0];
      const targetIdNum = parseInt(targetId, 10);

      // v4.2: Extreure before_text amb 3 fallbacks
      let beforeText = null;

      // Intent 1: Extreure del document marcat amb regex millorat
      if (text) {
        const regex = new RegExp(`\\{\\{${targetId}\\}\\}\\s*([\\s\\S]*?)(?=\\{\\{(?:\\d+|T:\\d+|TOC:\\d+)\\}\\}|\\[CAPÇALERA|\\[PEU|$)`);
        const match = text.match(regex);
        if (match && match[1]) {
          beforeText = match[1].trim();
        }
      }

      // Intent 2: Fallback a last_edit si existeix i coincideix
      if (!beforeText && last_edit && parseInt(last_edit.targetId, 10) === targetIdNum) {
        beforeText = last_edit.originalText;
      }

      // Intent 3: Buscar a l'historial d'events anteriors del mateix paràgraf
      if (!beforeText && doc_metadata?.doc_id) {
        try {
          const prevEvent = await getLastEventForTarget(env, licenseHash, doc_metadata.doc_id, targetIdNum);
          if (prevEvent && prevEvent.after_text && !prevEvent.after_text.startsWith('[')) {
            beforeText = prevEvent.after_text;
            console.log(`[Timeline] before_text recovered from history for target ${targetIdNum}`);
          }
        } catch (histErr) {
          console.warn('[Timeline] History lookup failed:', histErr.message);
        }
      }

      const eventData = {
        license_key_hash: licenseHash,
        doc_id: doc_metadata?.doc_id || 'unknown',
        event_type: 'UPDATE_BY_ID',
        target_id: targetIdNum,
        before_text: beforeText,
        after_text: afterText,
        user_instruction: user_instruction,
        thought: parsedResponse.thought,
        ai_mode: effectiveMode,
        // v4.0: Timeline fields
        source: 'ai',
        hash_confirmed: false,
        word_count: word_count || null
      };

      const savedEvent = await saveEditEvent(env, eventData);
      if (savedEvent) {
        savedEventId = savedEvent.id;
      }
    }
  } else if (parsedResponse.mode === 'REWRITE' && parsedResponse.blocks) {
    // Save REWRITE as a single event with blocks as JSON
    const eventData = {
      license_key_hash: licenseHash,
      doc_id: doc_metadata?.doc_id || 'unknown',
      event_type: 'REWRITE',
      target_id: null,
      before_text: null,  // Full rewrite doesn't have a "before"
      after_text: JSON.stringify(parsedResponse.blocks),
      user_instruction: user_instruction,
      thought: parsedResponse.thought,
      ai_mode: effectiveMode,
      // v4.0: Timeline fields
      source: 'ai',
      hash_confirmed: false,
      word_count: word_count || null
    };

    const savedEvent = await saveEditEvent(env, eventData);
    if (savedEvent) {
      savedEventId = savedEvent.id;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // v9.0: PROACTIVE HIGHLIGHTING - Parse [[text]] markers
  // ═══════════════════════════════════════════════════════════════
  let proactiveHighlights = [];
  if (parsedResponse.mode === 'CHAT_ONLY' || parsedResponse.mode === 'REFERENCE_HIGHLIGHT') {
    const highlightResult = parseProactiveHighlights(parsedResponse, text);

    // Update response text (remove [[ ]] markers)
    if (highlightResult.cleanedResponse) {
      if (parsedResponse.chat_response) {
        parsedResponse.chat_response = highlightResult.cleanedResponse;
      } else if (parsedResponse.ai_response) {
        parsedResponse.ai_response = highlightResult.cleanedResponse;
      }
    }

    // Store highlights for frontend
    proactiveHighlights = highlightResult.highlights;

    if (proactiveHighlights.length > 0) {
      console.log(`[Proactive Highlight v9.0] Found ${proactiveHighlights.length} markers in response`);
    }
  }

  // 6. Return response with _meta for quality tracking (v3.1)
  return new Response(JSON.stringify({
    status: "ok",
    data: parsedResponse,
    proactive_highlights: proactiveHighlights,  // v9.0: Text to highlight in document
    credits_remaining: creditsResult.credits_remaining || 0,
    event_id: savedEventId,  // v3.0: Include event ID for tracking
    auto_ban: autoBanWords,  // v4.0: Words to auto-ban from NL detection
    _meta: _meta,  // v3.1: Shadow Validator metadata
    _debug: {
      version: "7.1.0",
      has_selection: has_selection,
      history_length: chat_history?.length || 0,
      has_last_edit: !!last_edit,
      user_mode: effectiveMode,
      ai_mode: parsedResponse.mode,
      instruction_is_transform: instructionIsTransform,
      instruction_is_visualization: instructionIsVisualization,  // v7.1
      auto_converted: _meta.auto_converted || false,
      visualization_hint: _meta.visualization_hint || false,  // v7.1
      retries: retryCount,
      timeout_aborted: timeoutAborted,
      validation_passed: lastValidation?.isValid ?? false,
      negative_constraints_count: negative_constraints?.length || 0,
      sanitization_applied: sanitizationApplied,
      has_skeleton: !!doc_skeleton,
      skeleton_items: doc_skeleton?.structure?.length || 0,
      thought: parsedResponse.thought,
      event_saved: !!savedEventId,
      elapsed_ms: Date.now() - startTime
    }
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// FILE UPLOAD HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleFileUpload(body, env, corsHeaders) {
  const { file_data, mime_type, file_name, filename, license_key } = body;
  const finalFileName = file_name || filename;

  if (!license_key) throw new Error("missing_license");
  if (!file_data) throw new Error("missing_file_data");
  if (!mime_type) throw new Error("missing_mime_type");

  // Decode Base64 to bytes
  const binaryString = atob(file_data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const numBytes = bytes.length;
  const displayName = finalFileName || `sidecar_file_${Date.now()}`;

  // Step 1: Start resumable upload
  const startUploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${env.GEMINI_API_KEY}`;

  const startResp = await fetch(startUploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': numBytes.toString(),
      'X-Goog-Upload-Header-Content-Type': mime_type,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file: { displayName: displayName }
    })
  });

  if (!startResp.ok) {
    const errText = await startResp.text();
    throw new Error("file_api_start_error: " + errText);
  }

  const uploadUrl = startResp.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error("file_api_no_upload_url");
  }

  // Step 2: Upload bytes
  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': numBytes.toString()
    },
    body: bytes
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error("file_api_upload_error: " + errText);
  }

  const fileInfo = await uploadResp.json();

  return new Response(JSON.stringify({
    status: "ok",
    file_uri: fileInfo.file?.uri || null,
    file_name: fileInfo.file?.displayName || displayName,
    file_state: fileInfo.file?.state || "PROCESSING",
    mime_type: fileInfo.file?.mimeType || mime_type
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// CREDITS HANDLER (v5.1)
// ═══════════════════════════════════════════════════════════════

async function handleGetCredits(body, env, corsHeaders) {
  const { license_key } = body;

  if (!license_key) throw new Error("missing_license");

  const licenseHash = await hashKey(license_key);

  // Query license_keys table for credits info
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/license_keys?key_hash=eq.${licenseHash}&select=credits_remaining,credits_total,is_active`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const data = await response.json();

  if (!data || data.length === 0) {
    return new Response(JSON.stringify({
      status: "error",
      error_code: "invalid_license"
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const license = data[0];

  return new Response(JSON.stringify({
    status: "ok",
    credits_remaining: license.credits_remaining || 0,
    credits_total: license.credits_total || 100,
    is_active: license.is_active
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// RECEIPTS HANDLERS
// ═══════════════════════════════════════════════════════════════

async function handleGetReceipts(body, env, corsHeaders) {
  const { license_key } = body;

  if (!license_key) throw new Error("missing_license");

  const licenseHash = await hashKey(license_key);

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_receipts?license_key_hash=eq.${licenseHash}&order=created_at.desc`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const receipts = await response.json();

  return new Response(JSON.stringify({
    status: "ok",
    receipts: receipts.map(r => ({
      id: r.id,
      label: r.label,
      instruction: r.instruction,
      icon: r.icon
    }))
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleSaveReceipt(body, env, corsHeaders) {
  const { license_key, label, instruction, icon } = body;

  if (!license_key) throw new Error("missing_license");
  if (!label || !label.trim()) throw new Error("missing_label");
  if (!instruction || !instruction.trim()) throw new Error("missing_instruction");

  const licenseHash = await hashKey(license_key);

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_receipts`,
    {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        license_key_hash: licenseHash,
        label: label.trim(),
        instruction: instruction.trim(),
        icon: icon || '⚡'
      })
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const [newReceipt] = await response.json();

  return new Response(JSON.stringify({
    status: "ok",
    receipt: {
      id: newReceipt.id,
      label: newReceipt.label,
      instruction: newReceipt.instruction,
      icon: newReceipt.icon
    }
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleDeleteReceipt(body, env, corsHeaders) {
  const { license_key, receipt_id } = body;

  if (!license_key) throw new Error("missing_license");
  if (!receipt_id) throw new Error("missing_receipt_id");

  const licenseHash = await hashKey(license_key);

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_receipts?id=eq.${receipt_id}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  return new Response(JSON.stringify({
    status: "ok",
    deleted: true
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// EVENT SOURCING HANDLERS (v3.0)
// ═══════════════════════════════════════════════════════════════

async function handleGetEditHistory(body, env, corsHeaders) {
  const { license_key, doc_id, limit } = body;

  if (!license_key) throw new Error("missing_license");
  if (!doc_id) throw new Error("missing_doc_id");

  const licenseHash = await hashKey(license_key);
  const events = await getEditHistory(env, licenseHash, doc_id, limit || 20);

  // Format events for UI
  const formattedEvents = events.map(event => ({
    id: event.id,
    event_type: event.event_type,
    target_id: event.target_id,
    before_text: event.before_text ? event.before_text.substring(0, 100) + (event.before_text.length > 100 ? '...' : '') : null,
    after_text: event.after_text ? event.after_text.substring(0, 100) + (event.after_text.length > 100 ? '...' : '') : null,
    user_instruction: event.user_instruction,
    thought: event.thought,
    created_at: event.created_at,
    is_reverted: !!event.reverted_at
  }));

  return new Response(JSON.stringify({
    status: "ok",
    events: formattedEvents,
    count: formattedEvents.length
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handleRevertEdit(body, env, corsHeaders) {
  const { license_key, doc_id, event_id } = body;

  if (!license_key) throw new Error("missing_license");
  if (!doc_id) throw new Error("missing_doc_id");
  if (!event_id) throw new Error("missing_event_id");

  const licenseHash = await hashKey(license_key);

  // 1. Get the original event
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/edit_events?id=eq.${event_id}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error("event_not_found");
  }

  const events = await response.json();
  if (events.length === 0) {
    throw new Error("event_not_found");
  }

  const originalEvent = events[0];

  // Check if already reverted
  if (originalEvent.reverted_at) {
    throw new Error("event_already_reverted");
  }

  // 2. Create a REVERT event
  const revertEvent = await saveEditEvent(env, {
    license_key_hash: licenseHash,
    doc_id: doc_id,
    event_type: 'REVERT',
    target_id: originalEvent.target_id,
    before_text: originalEvent.after_text,  // What we're reverting FROM
    after_text: originalEvent.before_text,   // What we're reverting TO
    user_instruction: `Revert: ${originalEvent.user_instruction || 'previous edit'}`,
    thought: `Reverting edit from ${originalEvent.created_at}`,
    ai_mode: 'edit'
  });

  // 3. Mark original event as reverted
  if (revertEvent) {
    await markEventReverted(env, event_id, revertEvent.id);
  }

  // 4. v4.3: Invalidate all events that occurred AFTER the original event
  // This marks future events as no longer valid since we reverted to this point
  const invalidatedCount = await invalidateEventsAfter(
    env,
    licenseHash,
    doc_id,
    originalEvent.created_at
  );

  return new Response(JSON.stringify({
    status: "ok",
    revert_event: revertEvent ? { id: revertEvent.id } : null,
    restore_text: originalEvent.before_text,  // The text to restore in the document
    target_id: originalEvent.target_id,
    invalidated_count: invalidatedCount
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// TIMELINE HANDLERS (v4.0 - Forensic Timeline)
// ═══════════════════════════════════════════════════════════════

/**
 * Confirms that an AI edit was successfully applied by storing the final hash
 */
async function handleConfirmEdit(body, env, corsHeaders) {
  const { license_key, event_id, final_hash, word_count } = body;

  if (!license_key) throw new Error("missing_license");
  if (!event_id) throw new Error("missing_event_id");

  const licenseHash = await hashKey(license_key);

  // Get previous word count for delta calculation
  const prevEvent = await getLastConfirmedEvent(env, licenseHash, null);
  const prevWordCount = prevEvent?.word_count || 0;

  // Confirm the hash
  const success = await confirmEventHash(env, event_id, final_hash, word_count, prevWordCount);

  return new Response(JSON.stringify({
    status: success ? "ok" : "error",
    confirmed: success
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Gets the timeline of edits for a document (both AI and manual gaps)
 */
async function handleGetTimeline(body, env, corsHeaders) {
  const { license_key, doc_id, client_hash, word_count, limit = 50 } = body;

  if (!license_key) throw new Error("missing_license");
  if (!doc_id) throw new Error("missing_doc_id");

  const licenseHash = await hashKey(license_key);

  // v4.0: Detect gaps BEFORE fetching timeline (creates baseline or detects manual edits)
  if (client_hash) {
    try {
      await detectAndRecordGap(env, licenseHash, doc_id, client_hash, word_count || 0);
    } catch (gapError) {
      console.error('Gap detection in timeline failed:', gapError.message);
      // Non-blocking: continue even if gap detection fails
    }
  }

  // Fetch events ordered by created_at DESC
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/edit_events?license_key_hash=eq.${licenseHash}&doc_id=eq.${doc_id}&order=created_at.desc&limit=${limit}`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error("timeline_fetch_failed");
  }

  const events = await response.json();

  // Transform events for timeline display
  const timeline = events.map(e => ({
    id: e.id,
    type: e.event_type,
    source: e.source || (e.event_type === 'manual_gap' ? 'manual' : 'ai'),
    operation: e.event_type === 'manual_gap' ? 'manual_gap' : e.event_type,
    instruction: e.user_instruction,
    thought: e.thought,
    words_changed: e.words_changed,
    word_count: e.word_count,
    hash_confirmed: e.hash_confirmed,
    created_at: e.created_at,
    reverted_at: e.reverted_at,
    invalidated_at: e.invalidated_at,  // v4.3: Track invalidated events
    // v4.0: Include text for diff display
    before_text: e.before_text,
    after_text: e.after_text,
    target_id: e.target_id
  }));

  return new Response(JSON.stringify({
    status: "ok",
    timeline: timeline,
    total: events.length
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// CONVERSATIONS HANDLERS (v5.0 - Chat History)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate conversation title from first message
 */
function generateConversationTitle(content) {
  if (!content) return 'Nova conversa';
  const trimmed = content.trim();
  if (trimmed.length > 50) {
    return trimmed.substring(0, 47) + '...';
  }
  return trimmed;
}

/**
 * Generate unique message ID
 */
function generateMessageId() {
  return 'msg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
}

/**
 * LIST conversations for a user
 * body: { license_key, limit?, offset?, doc_id?, include_archived? }
 */
async function handleListConversations(body, env, corsHeaders) {
  const { license_key, license_key_hash, limit = 20, offset = 0, doc_id = null, include_archived = false } = body;

  // Support both license_key and license_key_hash
  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");

  // Build query
  let url = `${env.SUPABASE_URL}/rest/v1/conversations?license_key_hash=eq.${licenseHash}&order=pinned.desc,updated_at.desc&limit=${limit}&offset=${offset}`;

  if (!include_archived) {
    url += '&archived=eq.false';
  }
  if (doc_id) {
    url += `&doc_id=eq.${doc_id}`;
  }

  // Select only needed fields (not full messages array)
  url += '&select=id,title,message_count,pinned,doc_id,created_at,updated_at,messages->0->content';

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const conversations = await response.json();

  // Get total count for pagination
  const countResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/conversations?license_key_hash=eq.${licenseHash}${!include_archived ? '&archived=eq.false' : ''}&select=count`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'count=exact'
      }
    }
  );

  const totalCount = parseInt(countResponse.headers.get('content-range')?.split('/')[1] || '0', 10);

  return new Response(JSON.stringify({
    status: "ok",
    conversations: conversations.map(c => ({
      id: c.id,
      title: c.title,
      preview: c.content ? (c.content.length > 80 ? c.content.substring(0, 77) + '...' : c.content) : '',
      message_count: c.message_count,
      pinned: c.pinned,
      doc_id: c.doc_id,
      created_at: c.created_at,
      updated_at: c.updated_at
    })),
    total: totalCount,
    has_more: offset + limit < totalCount
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * GET a single conversation with all messages
 * body: { license_key, conversation_id }
 */
async function handleGetConversation(body, env, corsHeaders) {
  const { license_key, license_key_hash, conversation_id } = body;

  // Support both license_key and license_key_hash
  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");
  if (!conversation_id) throw new Error("missing_conversation_id");

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/conversations?id=eq.${conversation_id}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const conversations = await response.json();

  if (conversations.length === 0) {
    throw new Error("conversation_not_found");
  }

  const conv = conversations[0];

  return new Response(JSON.stringify({
    status: "ok",
    conversation: {
      id: conv.id,
      title: conv.title,
      doc_id: conv.doc_id,
      messages: conv.messages || [],
      message_count: conv.message_count,
      pinned: conv.pinned,
      created_at: conv.created_at,
      updated_at: conv.updated_at
    }
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * GET paginated messages from a conversation (v6.5)
 * body: { license_key, conversation_id, offset?, limit? }
 */
async function handleGetConversationMessages(body, env, corsHeaders) {
  const { license_key, license_key_hash, conversation_id, offset = 0, limit = 50 } = body;

  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");
  if (!conversation_id) throw new Error("missing_conversation_id");

  // Use SQL function for efficient pagination
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/get_conversation_messages`,
    {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_conversation_id: conversation_id,
        p_license_hash: licenseHash,
        p_offset: parseInt(offset) || 0,
        p_limit: Math.min(parseInt(limit) || 50, 100)  // Max 100 per request
      })
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const result = await response.json();

  if (result.status === 'error') {
    throw new Error(result.error || 'fetch_messages_failed');
  }

  const totalCount = result.total_count || 0;
  const messages = result.messages || [];

  return new Response(JSON.stringify({
    status: "ok",
    messages: messages,
    total: totalCount,
    has_more: (parseInt(offset) || 0) + messages.length < totalCount
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * CREATE a new conversation
 * body: { license_key, doc_id?, title?, first_message? }
 */
async function handleCreateConversation(body, env, corsHeaders) {
  const { license_key, license_key_hash, doc_id = null, title = null, first_message = null, messages: inputMessages = null } = body;

  // Support both license_key and license_key_hash
  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");

  // Build initial messages array - support both single and array format
  let messages = [];
  if (inputMessages && Array.isArray(inputMessages)) {
    // v5.0: Accept messages array directly
    messages = inputMessages;
  } else if (first_message && first_message.content) {
    messages.push({
      id: generateMessageId(),
      role: first_message.role || 'user',
      content: first_message.content,
      timestamp: new Date().toISOString()
    });
  }

  // Generate title from first message or use provided
  const conversationTitle = title || (messages[0]?.content ? generateConversationTitle(messages[0].content) : 'Nova conversa');

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/conversations`,
    {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        license_key_hash: licenseHash,
        doc_id: doc_id,
        title: conversationTitle,
        messages: messages,
        message_count: messages.length
      })
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const [newConversation] = await response.json();

  return new Response(JSON.stringify({
    status: "ok",
    conversation_id: newConversation.id,  // v5.0: For frontend compatibility
    conversation: {
      id: newConversation.id,
      title: newConversation.title,
      doc_id: newConversation.doc_id,
      message_count: newConversation.message_count,
      created_at: newConversation.created_at
    }
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * APPEND messages to a conversation (v5.2 - Atomic version)
 * Uses stored procedure to avoid race conditions
 * body: { license_key, conversation_id, messages: [{role, content, metadata?}] }
 */
async function handleAppendMessages(body, env, corsHeaders) {
  const { license_key, license_key_hash, conversation_id, messages } = body;

  // Support both license_key and license_key_hash
  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");
  if (!conversation_id) throw new Error("missing_conversation_id");
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error("missing_messages");
  }

  // Format messages with IDs and timestamps
  const formattedMessages = messages.map(msg => ({
    id: msg.id || generateMessageId(),
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp || new Date().toISOString(),
    ...(msg.metadata && { metadata: msg.metadata })
  }));

  // v5.2: Use atomic stored procedure to avoid race conditions
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/append_conversation_messages`,
    {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_conversation_id: conversation_id,
        p_license_hash: licenseHash,
        p_messages: formattedMessages
      })
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const result = await response.json();

  if (result.status === 'error') {
    throw new Error(result.error || 'append_failed');
  }

  return new Response(JSON.stringify({
    status: "ok",
    message_ids: formattedMessages.map(m => m.id),
    message_count: result.message_count,
    appended: result.appended
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * GENERATE auto-title for a conversation using AI (v5.2)
 * body: { license_key, conversation_id }
 */
async function handleGenerateTitle(body, env, corsHeaders) {
  const { license_key, license_key_hash, conversation_id } = body;

  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");
  if (!conversation_id) throw new Error("missing_conversation_id");

  // Get conversation messages
  const getResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/conversations?id=eq.${conversation_id}&license_key_hash=eq.${licenseHash}&select=messages,title`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!getResponse.ok) {
    const errText = await getResponse.text();
    console.error('[generate_title] Supabase GET error:', getResponse.status, errText);
    throw new Error("supabase_error: " + getResponse.status + " - " + errText.substring(0, 100));
  }

  const conversations = await getResponse.json();
  if (conversations.length === 0) {
    throw new Error("conversation_not_found");
  }

  const conv = conversations[0];

  // v9.5: Simple logic for when to generate title:
  // 1. "Nova conversa" = provisional, needs AI title
  // 2. Title > 50 chars = probably user message saved as title (legacy bug)
  // 3. Anything else (short, non-default) = already AI-generated, skip
  console.log('[generate_title] Current title:', conv.title, 'Length:', conv.title?.length);

  const needsTitle = !conv.title ||
                     conv.title === 'Nova conversa' ||
                     conv.title.length > 50;

  console.log('[generate_title] needsTitle:', needsTitle);

  if (!needsTitle) {
    return new Response(JSON.stringify({
      status: "ok",
      title: conv.title,
      skipped: true,
      debug: { title_length: conv.title?.length }
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Get first few messages for context (up to 6 for better context)
  const msgs = (conv.messages || []).slice(0, 6);
  if (msgs.length < 2) {
    return new Response(JSON.stringify({
      status: "ok",
      title: conv.title,
      skipped: true,
      reason: "not_enough_messages"
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // v10.2: Build conversation summary from all available messages
  // Debug: log message roles
  console.log('[generate_title] Message roles:', msgs.map(m => m.role));

  const userMsgs = msgs.filter(m => m.role === 'user').map(m => m.content.substring(0, 150)).join('\n');
  const aiMsgs = msgs.filter(m => m.role === 'assistant' || m.role === 'model' || m.role === 'ai').map(m => m.content.substring(0, 150)).join('\n');

  console.log('[generate_title] userMsgs:', userMsgs?.substring(0, 50));
  console.log('[generate_title] aiMsgs:', aiMsgs?.substring(0, 50));

  const prompt = `Generate a SHORT and NATURAL title for this conversation.

RULES:
- 2-4 words maximum
- Use the SAME LANGUAGE as the conversation
- Must sound NATURAL with correct grammar and prepositions
- Identify the main topic, don't copy text literally

EXAMPLES BY LANGUAGE:
Català: "Correcció d'ortografia", "Millora d'estil", "Resum del text"
Español: "Corrección de errores", "Mejora del estilo", "Resumen del texto"
English: "Spelling correction", "Style improvement", "Text summary"

AVOID unnatural word order:
- "Errors detection" ❌ → "Error detection" ✓
- "Ortografia correcció" ❌ → "Correcció ortogràfica" ✓

CONVERSATION:
User: ${userMsgs || 'N/A'}
Assistant: ${(aiMsgs || 'N/A').substring(0, 100)}

Write ONLY the title (natural, 2-4 words, same language as conversation):`;

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 20
        }
      })
    }
  );

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text();
    console.error('[generate_title] Gemini error:', geminiResponse.status, errText);
    throw new Error("gemini_error: " + geminiResponse.status);
  }

  const geminiResult = await geminiResponse.json();
  console.log('[generate_title] Gemini result:', JSON.stringify(geminiResult).substring(0, 200));
  let title = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || conv.title;

  // Clean up title (max 40 chars for short titles)
  title = title.replace(/^["']|["']$/g, '').trim();
  if (title.length > 40) title = title.substring(0, 37) + '...';
  console.log('[generate_title] Generated title:', title);

  // Save title using stored procedure
  const updateResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/set_conversation_ai_title`,
    {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_conversation_id: conversation_id,
        p_license_hash: licenseHash,
        p_title: title
      })
    }
  );

  if (!updateResponse.ok) {
    throw new Error("supabase_error: " + await updateResponse.text());
  }

  return new Response(JSON.stringify({
    status: "ok",
    title: title,
    generated: true,
    debug: {
      original_title: conv.title,
      msg_count: msgs.length,
      roles: msgs.map(m => m.role),
      user_preview: userMsgs?.substring(0, 50),
      ai_preview: aiMsgs?.substring(0, 50)
    }
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * GENERATE recipe summary using AI (v8.1)
 * body: { instruction, name }
 * Returns a short description of what the recipe does
 */
async function handleGenerateRecipeSummary(body, env, corsHeaders) {
  const { instruction, name } = body;

  if (!instruction) {
    return new Response(JSON.stringify({
      status: "error",
      error: "missing_instruction"
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Generate summary with Gemini
  const prompt = `Ets un assistent que genera descripcions curtes per receptes/prompts d'edició de documents.

Nom de la recepta: "${name || 'Sense nom'}"
Instrucció completa:
${instruction.substring(0, 500)}

Genera una descripció molt curta (màxim 15 paraules) en català que expliqui què fa aquesta recepta. Ha de ser clara i descriptiva. Només respon amb la descripció, sense cometes ni explicacions addicionals.

Descripció:`;

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.5,
            maxOutputTokens: 50
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      throw new Error("gemini_error");
    }

    const geminiResult = await geminiResponse.json();
    let summary = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    // Clean up summary
    summary = summary.replace(/^["']|["']$/g, '').trim();
    if (summary.length > 120) summary = summary.substring(0, 117) + '...';

    return new Response(JSON.stringify({
      status: "ok",
      summary: summary
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({
      status: "error",
      error: err.message
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
}

/**
 * UPDATE conversation metadata (title, pinned, archived)
 * body: { license_key, conversation_id, title?, pinned?, archived? }
 */
async function handleUpdateConversation(body, env, corsHeaders) {
  const { license_key, license_key_hash, conversation_id, title, pinned, archived } = body;

  // Support both license_key and license_key_hash
  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");
  if (!conversation_id) throw new Error("missing_conversation_id");

  // Build update object with only provided fields
  const updateData = { updated_at: new Date().toISOString() };
  if (title !== undefined) updateData.title = title;
  if (pinned !== undefined) updateData.pinned = pinned;
  if (archived !== undefined) updateData.archived = archived;

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/conversations?id=eq.${conversation_id}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(updateData)
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const [updated] = await response.json();

  return new Response(JSON.stringify({
    status: "ok",
    conversation: {
      id: updated.id,
      title: updated.title,
      pinned: updated.pinned,
      archived: updated.archived,
      updated_at: updated.updated_at
    }
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * DELETE a conversation
 * body: { license_key, conversation_id }
 */
async function handleDeleteConversation(body, env, corsHeaders) {
  const { license_key, license_key_hash, conversation_id } = body;

  // Support both license_key and license_key_hash
  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");
  if (!conversation_id) throw new Error("missing_conversation_id");

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/conversations?id=eq.${conversation_id}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  return new Response(JSON.stringify({
    status: "ok",
    deleted: true
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// KNOWLEDGE LIBRARY HANDLERS (v5.1)
// ═══════════════════════════════════════════════════════════════

/**
 * Get all knowledge files for the user (v7.0 - with persistent folders)
 */
async function handleGetKnowledgeLibrary(body, env, corsHeaders) {
  const { license_key } = body;
  if (!license_key) throw new Error("missing_license");

  const licenseHash = await hashKey(license_key);

  // Get files
  const filesResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library?license_key_hash=eq.${licenseHash}&order=folder.asc.nullsfirst,last_used_at.desc&select=id,file_name,mime_type,file_size,gemini_file_uri,gemini_expires_at,used_in_docs,created_at,folder`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!filesResponse.ok) {
    throw new Error("supabase_error: " + await filesResponse.text());
  }

  const files = await filesResponse.json();

  // Get folders from persistent table (v7.0)
  const foldersResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_folders?license_key_hash=eq.${licenseHash}&order=folder_name.asc&select=folder_name`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  let folders = [];
  if (foldersResponse.ok) {
    const foldersData = await foldersResponse.json();
    folders = foldersData.map(f => f.folder_name);
  }

  // Also include implicit folders from files (for backwards compatibility)
  const implicitFolders = files.map(f => f.folder).filter(f => f);
  const allFolders = [...new Set([...folders, ...implicitFolders])].sort();

  return new Response(JSON.stringify({
    status: "ok",
    folders: allFolders,
    files: files.map(f => ({
      id: f.id,
      name: f.file_name,
      mime_type: f.mime_type,
      size: f.file_size,
      has_valid_uri: f.gemini_file_uri && new Date(f.gemini_expires_at) > new Date(),
      used_in_docs: f.used_in_docs || [],
      created_at: f.created_at,
      folder: f.folder || null
    }))
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Move a file to a folder (v6.0)
 */
async function handleMoveToFolder(body, env, corsHeaders) {
  const { license_key, file_id, folder } = body;
  if (!license_key) throw new Error("missing_license");
  if (!file_id) throw new Error("missing_file_id");

  const licenseHash = await hashKey(license_key);

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library?id=eq.${file_id}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ folder: folder || null })
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  return new Response(JSON.stringify({
    status: "ok"
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Rename a folder (moves all files to new folder name) (v6.0)
 */
async function handleRenameFolder(body, env, corsHeaders) {
  const { license_key, old_name, new_name } = body;
  if (!license_key) throw new Error("missing_license");
  if (!old_name) throw new Error("missing_old_name");
  if (!new_name) throw new Error("missing_new_name");

  const licenseHash = await hashKey(license_key);

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library?folder=eq.${encodeURIComponent(old_name)}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ folder: new_name })
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  return new Response(JSON.stringify({
    status: "ok"
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Delete a folder (moves all files to root) (v7.0 - also deletes from knowledge_folders)
 */
async function handleDeleteFolder(body, env, corsHeaders) {
  const { license_key, folder_name } = body;
  if (!license_key) throw new Error("missing_license");
  if (!folder_name) throw new Error("missing_folder_name");

  const licenseHash = await hashKey(license_key);

  // 1. Move all files from this folder to root (folder = null)
  const filesResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library?folder=eq.${encodeURIComponent(folder_name)}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ folder: null })
    }
  );

  if (!filesResponse.ok) {
    throw new Error("supabase_error: " + await filesResponse.text());
  }

  // 2. Delete folder from knowledge_folders table (v7.0)
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_folders?folder_name=eq.${encodeURIComponent(folder_name)}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return new Response(JSON.stringify({
    status: "ok"
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Create a new folder (v7.0)
 */
async function handleCreateFolder(body, env, corsHeaders) {
  const { license_key, folder_name } = body;
  if (!license_key) throw new Error("missing_license");
  if (!folder_name) throw new Error("missing_folder_name");

  const trimmed = folder_name.trim();
  if (trimmed.length === 0) throw new Error("invalid_folder_name");
  if (trimmed.length > 30) throw new Error("folder_name_too_long");

  const licenseHash = await hashKey(license_key);

  // Insert into knowledge_folders
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_folders`,
    {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        license_key_hash: licenseHash,
        folder_name: trimmed
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    if (error.includes('unique') || error.includes('duplicate')) {
      throw new Error("duplicate_folder");
    }
    throw new Error("supabase_error: " + error);
  }

  return new Response(JSON.stringify({
    status: "ok",
    folder_name: trimmed
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Upload a new file to the library (stores file_data for re-upload)
 */
async function handleUploadToLibrary(body, env, corsHeaders) {
  const { license_key, file_data, mime_type, file_name, doc_id } = body;

  if (!license_key) throw new Error("missing_license");
  if (!file_data) throw new Error("missing_file_data");
  if (!mime_type) throw new Error("missing_mime_type");
  if (!file_name) throw new Error("missing_file_name");

  // v6.5: Validate file before processing (security)
  const validation = validateUploadedFile(file_data, mime_type, file_name);
  const safeFileName = validation.sanitizedName;

  const licenseHash = await hashKey(license_key);

  // 1. Upload to Gemini first (using sanitized name)
  const geminiResult = await uploadToGemini(file_data, mime_type, safeFileName, env);

  // 2. Calculate expiry (47h from now for safety margin)
  const expiresAt = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString();

  // 3. Save to Supabase with file_data for future re-uploads
  const usedInDocs = doc_id ? [doc_id] : [];

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library`,
    {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        license_key_hash: licenseHash,
        file_name: safeFileName,  // v6.5: Use sanitized name
        mime_type: mime_type,
        file_size: file_data.length,
        file_data: file_data,
        gemini_file_uri: geminiResult.file_uri,
        gemini_expires_at: expiresAt,
        used_in_docs: usedInDocs
      })
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const [newFile] = await response.json();

  return new Response(JSON.stringify({
    status: "ok",
    file: {
      id: newFile.id,
      name: newFile.file_name,
      file_uri: geminiResult.file_uri
    }
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Link a library file to a document (and refresh Gemini URI if needed)
 */
async function handleLinkKnowledge(body, env, corsHeaders) {
  const { license_key, file_id, doc_id } = body;

  if (!license_key) throw new Error("missing_license");
  if (!file_id) throw new Error("missing_file_id");
  if (!doc_id) throw new Error("missing_doc_id");

  const licenseHash = await hashKey(license_key);

  // 1. Get the file from library
  const getResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library?id=eq.${file_id}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!getResponse.ok) {
    throw new Error("supabase_error: " + await getResponse.text());
  }

  const files = await getResponse.json();
  if (files.length === 0) {
    throw new Error("file_not_found");
  }

  const file = files[0];
  let fileUri = file.gemini_file_uri;

  // 2. Check if Gemini URI expired - refresh if needed
  const isExpired = !file.gemini_expires_at || new Date(file.gemini_expires_at) < new Date();

  if (isExpired && file.file_data) {
    // Re-upload to Gemini
    const geminiResult = await uploadToGemini(file.file_data, file.mime_type, file.file_name, env);
    fileUri = geminiResult.file_uri;

    // Update the URI in Supabase
    const expiresAt = new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString();
    await fetch(
      `${env.SUPABASE_URL}/rest/v1/knowledge_library?id=eq.${file_id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          gemini_file_uri: fileUri,
          gemini_expires_at: expiresAt
        })
      }
    );
  }

  // 3. Add doc_id to used_in_docs if not already there
  const usedInDocs = file.used_in_docs || [];
  if (!usedInDocs.includes(doc_id)) {
    usedInDocs.push(doc_id);
  }

  // 4. Update used_in_docs and last_used_at
  await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library?id=eq.${file_id}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        used_in_docs: usedInDocs,
        last_used_at: new Date().toISOString()
      })
    }
  );

  return new Response(JSON.stringify({
    status: "ok",
    file_uri: fileUri,
    file_name: file.file_name,
    mime_type: file.mime_type,
    refreshed: isExpired
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Unlink a file from a document
 */
async function handleUnlinkKnowledge(body, env, corsHeaders) {
  const { license_key, file_id, doc_id } = body;

  if (!license_key) throw new Error("missing_license");
  if (!file_id) throw new Error("missing_file_id");
  if (!doc_id) throw new Error("missing_doc_id");

  const licenseHash = await hashKey(license_key);

  // Get current used_in_docs
  const getResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library?id=eq.${file_id}&license_key_hash=eq.${licenseHash}&select=used_in_docs`,
    {
      method: 'GET',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!getResponse.ok) {
    throw new Error("supabase_error: " + await getResponse.text());
  }

  const files = await getResponse.json();
  if (files.length === 0) {
    throw new Error("file_not_found");
  }

  // Remove doc_id from used_in_docs
  const usedInDocs = (files[0].used_in_docs || []).filter(id => id !== doc_id);

  await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library?id=eq.${file_id}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        used_in_docs: usedInDocs
      })
    }
  );

  return new Response(JSON.stringify({
    status: "ok",
    unlinked: true
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Delete a file from the library completely
 */
async function handleDeleteFromLibrary(body, env, corsHeaders) {
  const { license_key, file_id } = body;

  if (!license_key) throw new Error("missing_license");
  if (!file_id) throw new Error("missing_file_id");

  const licenseHash = await hashKey(license_key);

  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/knowledge_library?id=eq.${file_id}&license_key_hash=eq.${licenseHash}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  return new Response(JSON.stringify({
    status: "ok",
    deleted: true
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Helper: Upload file to Gemini File API
 */
async function uploadToGemini(base64Data, mimeType, fileName, env) {
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const numBytes = bytes.length;
  const displayName = fileName || `knowledge_file_${Date.now()}`;

  // Start resumable upload
  const startUploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${env.GEMINI_API_KEY}`;

  const startResp = await fetch(startUploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': numBytes.toString(),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      file: { displayName: displayName }
    })
  });

  if (!startResp.ok) {
    throw new Error("gemini_upload_start_error: " + await startResp.text());
  }

  const uploadUrl = startResp.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error("gemini_no_upload_url");
  }

  // Upload bytes
  const uploadResp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
      'Content-Length': numBytes.toString()
    },
    body: bytes
  });

  if (!uploadResp.ok) {
    throw new Error("gemini_upload_error: " + await uploadResp.text());
  }

  const fileInfo = await uploadResp.json();

  // v5.1: Wait for file to be ACTIVE (poll up to 10 seconds)
  let fileUri = fileInfo.file?.uri || null;
  let fileState = fileInfo.file?.state || "PROCESSING";
  const geminiFileName = fileInfo.file?.name;

  if (fileState === "PROCESSING" && geminiFileName) {
    // Poll for file status
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 1000)); // Wait 1 second

      const checkResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/${geminiFileName}?key=${env.GEMINI_API_KEY}`
      );

      if (checkResp.ok) {
        const checkInfo = await checkResp.json();
        fileState = checkInfo.state;
        fileUri = checkInfo.uri;

        if (fileState === "ACTIVE") {
          break;
        }
      }
    }
  }

  return {
    file_uri: fileUri,
    file_name: fileInfo.file?.displayName || displayName,
    file_state: fileState
  };
}
