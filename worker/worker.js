/**
 * SIDECAR CORE API v3.1 - Shadow Validator (Surgical Refactor)
 *
 * v3.1 features:
 * - NEW: Time Budget (25s safety cutoff)
 * - NEW: Unified validateResponse() function
 * - NEW: Graceful degradation with _meta warnings
 * - IMPROVED: processWithRetry() pattern
 *
 * v3.0 features (preserved):
 * - Event Sourcing (edit_events table)
 * - Edit history per document
 * - Revert any edit (not just last one)
 *
 * v2.9 features (preserved):
 * - Document Skeleton (doc_skeleton) - estructura + entitats
 * - Context-aware prompting with document structure
 *
 * v2.8 features (preserved):
 * - Banned Expressions (negative_constraints)
 * - Hybrid Validator (local regex + LLM retry)
 *
 * v2.7 features (preserved):
 * - "Motor d'Enginyeria" system prompt (Lovable-style)
 * - Mandatory "thought" field (Chain of Thought)
 *
 * v2.6.x features (preserved):
 * - Mode selector (auto | edit | chat)
 * - lastEdit memory, revert button, pinned_prefs
 */

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
  return supabaseResp.json();
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

function buildSystemPrompt(hasSelection, hasFile, styleGuide, strictMode, negativeConstraints, docSkeleton, docStats) {
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
    if (docStats.has_images) parts.push(`Imatges: SÍ (no visibles)`);
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
- Selecció activa: ${hasSelection ? 'SÍ (l\'usuari ha seleccionat text específic)' : 'NO'}
- Fitxer de coneixement: ${hasFile ? 'SÍ (usa\'l com a font)' : 'NO'}${docStatsStr}

═══════════════════════════════════════════════════════════════
FORMAT DEL TEXT D'ENTRADA (v3.7)
═══════════════════════════════════════════════════════════════
El text del document ve marcat amb IDs:
- {{0}}, {{1}}, {{2}}... → Paràgrafs i llistes (editables via UPDATE_BY_ID)
- {{T:0}}, {{T:1}}... → Taules (NOMÉS LECTURA - no editables directament)

Les taules apareixen així:
{{T:X}} [TAULA]
| Col1 | Col2 |
|---|---|
| val1 | val2 |
[/TAULA]

IMPORTANT: Les taules es mostren com a referència. NO pots editar-les directament.
Si l'usuari demana canvis a una taula, explica-li que ha d'editar-la manualment.

═══════════════════════════════════════════════════════════════
MODES D'OPERACIÓ
═══════════════════════════════════════════════════════════════

[MODE CONSULTOR] → "CHAT_ONLY"
Quan: Preguntes, opinions, anàlisi, explicacions, resums informatius.
Acció: Respon al xat. NO toques el document.

[MODE ENGINYER] → "UPDATE_BY_ID"
Quan: L'usuari demana CANVIS (millora, tradueix, corregeix, canvia, escurça, amplia).
Acció: Edita NOMÉS els paràgrafs afectats via {{ID}}. Cirurgia, no reemplaçament.

[MODE ARQUITECTE] → "REWRITE"
Quan: L'usuari demana CREAR contingut NOU (escriu un email, genera una llista, crea des de zero).
Acció: Genera estructura nova amb blocks tipats.

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
- Si tens dubtes → PREGUNTA abans d'editar

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

Tipus de blocks: HEADING_1, HEADING_2, HEADING_3, PARAGRAPH, BULLET_LIST, NUMBERED_LIST
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
    'GENERATE': 'REWRITE'
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
      'REWRITE': 'Intenció: creació. Estratègia: generar contingut nou.'
    };
    parsed.thought = modeThoughts[parsed.mode] || 'Processant petició.';
  }

  return parsed;
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
    word_count     // v4.0: Timeline - word count for delta tracking
  } = body;

  if (!license_key) throw new Error("missing_license");
  if (!text) throw new Error("missing_text");

  // v4.0: Detect NL ban patterns (Sprint 3)
  const autoBanWords = detectNLBanPatterns(user_instruction);

  // 1. License validation and credit usage
  const licenseHash = await hashKey(license_key);
  const creditsResult = await useCredits(env, licenseHash, doc_metadata);

  // v4.0: Timeline Gap Detection - detect manual edits before AI processing
  const docId = doc_metadata?.doc_id || 'unknown';
  let gapResult = null;
  if (client_hash && docId !== 'unknown') {
    try {
      gapResult = await detectAndRecordGap(env, licenseHash, docId, client_hash, word_count || 0);
    } catch (gapError) {
      console.error('Gap detection failed:', gapError.message);
      // Non-blocking: continue even if gap detection fails
    }
  }

  // 2. Build system prompt (context-driven)
  // v3.7: Afegim doc_stats per UNIVERSAL DOC READER
  const systemPrompt = buildSystemPrompt(
    has_selection || false,
    !!knowledge_file_uri,
    style_guide,
    strict_mode,
    negative_constraints,  // v2.8: Banned words
    doc_skeleton,          // v2.9: Document structure
    doc_stats              // v3.7: Universal Doc Reader stats
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
  let currentMessage = `CONTEXT FÍSIC:
- Text Seleccionat: ${has_selection ? 'SÍ' : 'NO'}
- Document ID: ${doc_metadata?.doc_id || 'unknown'}

TEXT ACTUAL DEL DOCUMENT:
${text}

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

  userParts.push({ text: currentMessage });
  contents.push({ role: 'user', parts: userParts });

  // ═══════════════════════════════════════════════════════════════
  // 4. SHADOW VALIDATOR LOOP (v3.1 - Unified Validation + Time Budget)
  // ═══════════════════════════════════════════════════════════════
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;

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

  // 5.1 Mode enforcement (v3.10: Simplified - only edit/chat)
  const effectiveMode = user_mode || 'edit';

  if (effectiveMode === 'chat') {
    // Force CHAT_ONLY: Never edit, convert any edit response to chat
    if (parsedResponse.mode !== 'CHAT_ONLY') {
      parsedResponse = {
        mode: 'CHAT_ONLY',
        chat_response: parsedResponse.change_summary || parsedResponse.chat_response || "Entesos.",
        change_summary: "Mode xat actiu - no s'ha editat el document"
      };
    }
  } else if (effectiveMode === 'edit') {
    // Force EDIT: If AI chose CHAT_ONLY but user wants edit, keep as-is but flag it
    // (We can't force an edit if AI didn't provide one, so we just note it)
    if (parsedResponse.mode === 'CHAT_ONLY' && has_selection) {
      // AI chose chat but user has selection and wants edit - add hint
      parsedResponse.chat_response = (parsedResponse.chat_response || "") +
        "\n\n💡 Tip: Si vols que editi el text seleccionat, reformula la instrucció.";
    }
  }
  // v3.10: Mode is now either 'edit' or 'chat' - no 'auto' mode

  // 5.2 Save edit event (v3.0 Event Sourcing)
  let savedEventId = null;
  if (parsedResponse.mode === 'UPDATE_BY_ID' && parsedResponse.updates) {
    // Save each update as an event (for now, save only the first one to keep it simple)
    const updateEntries = Object.entries(parsedResponse.updates);
    if (updateEntries.length > 0) {
      const [targetId, afterText] = updateEntries[0];
      // Note: We need before_text from the original document, which we'll get from last_edit or text
      const beforeText = last_edit?.targetId === targetId ? last_edit.originalText : null;

      const eventData = {
        license_key_hash: licenseHash,
        doc_id: doc_metadata?.doc_id || 'unknown',
        event_type: 'UPDATE_BY_ID',
        target_id: parseInt(targetId, 10),
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

  // 6. Return response with _meta for quality tracking (v3.1)
  return new Response(JSON.stringify({
    status: "ok",
    data: parsedResponse,
    credits_remaining: creditsResult.credits_remaining || 0,
    event_id: savedEventId,  // v3.0: Include event ID for tracking
    auto_ban: autoBanWords,  // v4.0: Words to auto-ban from NL detection
    _meta: _meta,  // v3.1: Shadow Validator metadata
    _debug: {
      version: "3.1.1",
      has_selection: has_selection,
      history_length: chat_history?.length || 0,
      has_last_edit: !!last_edit,
      user_mode: effectiveMode,
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

  return new Response(JSON.stringify({
    status: "ok",
    revert_event: revertEvent ? { id: revertEvent.id } : null,
    restore_text: originalEvent.before_text,  // The text to restore in the document
    target_id: originalEvent.target_id
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
    `${env.SUPABASE_URL}/rest/v1/conversations?id=eq.${conversation_id}&license_key_hash=eq.${licenseHash}&select=messages,title,metadata`,
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
    throw new Error("supabase_error");
  }

  const conversations = await getResponse.json();
  if (conversations.length === 0) {
    throw new Error("conversation_not_found");
  }

  const conv = conversations[0];

  // Skip if already has AI-generated title
  if (conv.metadata?.ai_title_generated) {
    return new Response(JSON.stringify({
      status: "ok",
      title: conv.title,
      skipped: true
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Get first few messages for context
  const msgs = (conv.messages || []).slice(0, 4);
  if (msgs.length < 2) {
    return new Response(JSON.stringify({
      status: "ok",
      title: conv.title,
      skipped: true,
      reason: "not_enough_messages"
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Generate title with Gemini
  const prompt = `Genera un títol curt (3-6 paraules) per aquesta conversa. Només respon amb el títol, sense cometes ni explicacions.

Conversa:
${msgs.map(m => `${m.role === 'user' ? 'Usuari' : 'Assistent'}: ${m.content.substring(0, 200)}`).join('\n')}

Títol:`;

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 30
        }
      })
    }
  );

  if (!geminiResponse.ok) {
    throw new Error("gemini_error");
  }

  const geminiResult = await geminiResponse.json();
  let title = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || conv.title;

  // Clean up title
  title = title.replace(/^["']|["']$/g, '').trim();
  if (title.length > 60) title = title.substring(0, 57) + '...';

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
    generated: true
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
 * Get all knowledge files for the user (v6.0 - with folders)
 */
async function handleGetKnowledgeLibrary(body, env, corsHeaders) {
  const { license_key } = body;
  if (!license_key) throw new Error("missing_license");

  const licenseHash = await hashKey(license_key);

  const response = await fetch(
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

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  const files = await response.json();

  // Extract unique folders from files
  const folders = [...new Set(files.map(f => f.folder).filter(f => f))].sort();

  return new Response(JSON.stringify({
    status: "ok",
    folders: folders,
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
 * Delete a folder (moves all files to root) (v6.0)
 */
async function handleDeleteFolder(body, env, corsHeaders) {
  const { license_key, folder_name } = body;
  if (!license_key) throw new Error("missing_license");
  if (!folder_name) throw new Error("missing_folder_name");

  const licenseHash = await hashKey(license_key);

  // Move all files from this folder to root (folder = null)
  const response = await fetch(
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

  if (!response.ok) {
    throw new Error("supabase_error: " + await response.text());
  }

  return new Response(JSON.stringify({
    status: "ok"
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
