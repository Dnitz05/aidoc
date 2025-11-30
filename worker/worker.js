/**
 * SIDECAR CORE API v3.0 - Event Sourcing
 *
 * v3.0 features:
 * - NEW: Event Sourcing (edit_events table)
 * - NEW: Edit history per document
 * - NEW: Revert any edit (not just last one)
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
 * - Retry loop for invalid JSON (1 retry with feedback)
 *
 * v2.6.x features (preserved):
 * - Mode selector (auto | edit | chat)
 * - lastEdit memory, revert button, pinned_prefs
 */

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
// SYSTEM PROMPT v3 - "Document Engineering Engine" (Lovable-style)
// ═══════════════════════════════════════════════════════════════

function buildSystemPrompt(hasSelection, hasFile, styleGuide, strictMode, negativeConstraints, docSkeleton) {
  let prompt = `
═══════════════════════════════════════════════════════════════
IDENTITAT
═══════════════════════════════════════════════════════════════
Ets SideCar, un MOTOR D'ENGINYERIA DOCUMENTAL.
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
- Fitxer de coneixement: ${hasFile ? 'SÍ (usa\'l com a font)' : 'NO'}

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
    user_mode,     // v2.6.2: User-selected mode (auto | edit | chat)
    negative_constraints,  // v2.8: Banned words/phrases
    doc_skeleton   // v2.9: Document structure (headings, sections, entities)
  } = body;

  if (!license_key) throw new Error("missing_license");
  if (!text) throw new Error("missing_text");

  // 1. License validation and credit usage
  const licenseHash = await hashKey(license_key);
  const creditsResult = await useCredits(env, licenseHash, doc_metadata);

  // 2. Build system prompt (context-driven)
  const systemPrompt = buildSystemPrompt(
    has_selection || false,
    !!knowledge_file_uri,
    style_guide,
    strict_mode,
    negative_constraints,  // v2.8: Banned words
    doc_skeleton  // v2.9: Document structure
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

  // 4. Call Gemini with retry loop (v2.7 + v2.8 banned word validation)
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;

  let parsedResponse = null;
  let retryCount = 0;
  const MAX_RETRIES = 2;  // v2.8: Increased to allow for banned word retry
  let currentContents = [...contents];
  let bannedWordRetry = false;

  while (retryCount <= MAX_RETRIES) {
    const geminiResp = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: currentContents,
        system_instruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          responseMimeType: "application/json",
          temperature: retryCount === 0 ? 0.4 : 0.2  // Lower temp on retry for more deterministic output
        }
      })
    });

    if (!geminiResp.ok) throw new Error("gemini_error: " + await geminiResp.text());
    const geminiData = await geminiResp.json();

    const rawResponse = geminiData.candidates[0].content.parts[0].text;

    // Try to parse JSON
    const directParse = safeParseJSON(rawResponse);

    if (directParse !== null) {
      // Valid JSON - now check for banned words (v2.8)
      parsedResponse = parseAndValidate(rawResponse);

      // v2.8: Validate output doesn't contain banned words
      if (negative_constraints && negative_constraints.length > 0) {
        const outputText = getOutputText(parsedResponse);
        const foundBanned = findBannedWords(outputText, negative_constraints);

        if (foundBanned.length > 0 && !bannedWordRetry && retryCount < MAX_RETRIES) {
          // Banned words found - retry with specific feedback
          bannedWordRetry = true;
          retryCount++;
          currentContents = [...contents];
          currentContents.push({
            role: 'model',
            parts: [{ text: rawResponse }]
          });
          currentContents.push({
            role: 'user',
            parts: [{
              text: `ERROR: La teva resposta conté paraules PROHIBIDES: "${foundBanned.join('", "')}".
Aquestes paraules estan a la LLISTA NEGRA de l'usuari i MAI s'han d'usar.
REESCRIU la resposta substituint aquestes paraules per sinònims acceptables.`
            }]
          });
          continue;  // Retry
        }
      }

      // All validations passed
      break;
    } else if (retryCount < MAX_RETRIES) {
      // Invalid JSON - retry with error feedback
      retryCount++;
      currentContents = [...contents];
      currentContents.push({
        role: 'model',
        parts: [{ text: rawResponse }]
      });
      currentContents.push({
        role: 'user',
        parts: [{
          text: 'ERROR: La teva resposta no era JSON vàlid. Torna a intentar-ho amb NOMÉS el JSON, sense text extra. Recorda el format: { "thought": "...", "mode": "...", ... }'
        }]
      });
    } else {
      // Max retries reached - use fallback
      parsedResponse = parseAndValidate(rawResponse);
      break;
    }
  }

  // 5.1 Mode enforcement (v2.6.2)
  const effectiveMode = user_mode || 'auto';
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
  // 'auto' mode: no override, AI decides

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
        ai_mode: effectiveMode
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
      ai_mode: effectiveMode
    };

    const savedEvent = await saveEditEvent(env, eventData);
    if (savedEvent) {
      savedEventId = savedEvent.id;
    }
  }

  // 6. Return response
  return new Response(JSON.stringify({
    status: "ok",
    data: parsedResponse,
    credits_remaining: creditsResult.credits_remaining || 0,
    event_id: savedEventId,  // v3.0: Include event ID for tracking
    _debug: {
      version: "3.0",
      has_selection: has_selection,
      history_length: chat_history?.length || 0,
      has_last_edit: !!last_edit,
      user_mode: effectiveMode,
      retries: retryCount,
      banned_word_retry: bannedWordRetry,
      negative_constraints_count: negative_constraints?.length || 0,
      has_skeleton: !!doc_skeleton,
      skeleton_items: doc_skeleton?.structure?.length || 0,
      thought: parsedResponse.thought,
      event_saved: !!savedEventId
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
