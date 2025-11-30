/**
 * SIDECAR CORE API v2.6.1 - LastEdit Memory (Bugfix)
 *
 * v2.6.1 fixes:
 * - FIX: originalText now preserved across alternative chains ("una altra" x3)
 * - FIX: After revert, currentText=originalText (enables "una altra" post-undo)
 *
 * v2.6 features:
 * - last_edit memory - stores {targetId, originalText, currentText}
 * - lastEdit block in prompt for "una altra", "canvia-la", etc.
 * - Revert button in UI
 *
 * v2.5 features (preserved):
 * - pinned_prefs, extended chat history (12 msgs), robustness
 */

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

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
// SYSTEM PROMPT - Context-Driven (No Hardcoded Rules)
// ═══════════════════════════════════════════════════════════════

function buildSystemPrompt(hasSelection, hasFile, styleGuide, strictMode) {
  let prompt = `Ets SideCar, un assistent expert per a Google Docs.

═══════════════════════════════════════════════════════════════
LA TEVA MISSIÓ
═══════════════════════════════════════════════════════════════
Decidir si has de **PARLAR (Chat)** o **EDITAR (Update)** basant-te en el context.

═══════════════════════════════════════════════════════════════
COM DECIDIR (HEURÍSTICA INTEL·LIGENT)
═══════════════════════════════════════════════════════════════

1. **Analitza el context físic:**
   - Selecció activa: ${hasSelection ? 'SÍ (l\'usuari ha seleccionat text específic)' : 'NO (document complet)'}
   - Fitxer adjunt: ${hasFile ? 'SÍ' : 'NO'}

2. **Regles de decisió:**
   - Si l'usuari té text SELECCIONAT i demana una ACCIÓ (millora, tradueix, canvia, corregeix) → **UPDATE_BY_ID**
   - Si l'usuari NO té selecció i fa una PREGUNTA o demana opinió → **CHAT_ONLY**
   - Si l'usuari demana CREAR contingut nou (escriu un email, crea una llista) → **REWRITE**
   - Si l'usuari demana RESUMIR, EXPLICAR, ANALITZAR → **CHAT_ONLY** (informació, no edició)

3. **Analitza l'historial (MOLT IMPORTANT):**
   - Si l'usuari diu "Fes-ho més curt", "Ara tradueix-ho", refereix-se al context anterior.
   - Usa la memòria de la conversa per entendre a què es refereix.
   - IMPORTANT: Si acabes de fer un canvi i l'usuari diu "una altra", "aquesta no m'agrada",
     "canvia-la", etc., ENTÉN que es refereix al CANVI QUE ACABES DE FER.
   - Exemples de continuïtat:
     * "canvia X per Y" → fas el canvi → "una altra" = vol alternativa per Y
     * "millora això" → ho millores → "no m'agrada" = no li agrada la teva versió
     * "tradueix" → tradueixes → "massa literal" = vol traducció menys literal

4. **EN CAS DE DUBTE:**
   - Si no saps si editar o parlar, tria **CHAT_ONLY** i pregunta:
     "Vols que modifiqui el text o que t'ho expliqui?"
   - És MILLOR preguntar que equivocar-se editant sense permís.

═══════════════════════════════════════════════════════════════
FORMATS DE RESPOSTA (JSON ESTRICTE)
═══════════════════════════════════════════════════════════════

**MODE CHAT_ONLY** (Consultes, preguntes, resums, anàlisis)
{
  "mode": "CHAT_ONLY",
  "chat_response": "La teva resposta aquí",
  "change_summary": "Consulta resolta"
}

**MODE UPDATE_BY_ID** (Edició de paràgrafs existents)
El text ve amb marcadors {{ID}} per identificar cada paràgraf.
{
  "mode": "UPDATE_BY_ID",
  "updates": {
    "0": "Text nou pel paràgraf 0",
    "2": "Text nou pel paràgraf 2"
  },
  "change_summary": "Descripció dels canvis"
}

**MODE REWRITE** (Generació de contingut completament nou)
{
  "mode": "REWRITE",
  "change_summary": "Explicació breu",
  "blocks": [
    { "type": "PARAGRAPH", "text": "Contingut" }
  ]
}

Tipus de blocks: HEADING_1, HEADING_2, HEADING_3, PARAGRAPH, BULLET_LIST, NUMBERED_LIST
`;

  // Style guide
  if (styleGuide && styleGuide.trim()) {
    prompt += `
═══════════════════════════════════════════════════════════════
GUIA D'ESTIL
═══════════════════════════════════════════════════════════════
${styleGuide}
`;
  }

  // Strict mode
  if (strictMode) {
    prompt += `
⚠️ MODE ESTRICTE: Respon NOMÉS amb informació del context/fitxer. No inventis dades.
`;
  }

  // File note
  if (hasFile) {
    prompt += `
📎 FITXER ADJUNT: Usa'l com a font principal per respondre preguntes sobre el seu contingut.
`;
  }

  prompt += `
═══════════════════════════════════════════════════════════════
IMPORTANT
═══════════════════════════════════════════════════════════════
- Sigues multilingüe: respon en l'idioma de l'usuari.
- La teva resposta ha de ser NOMÉS el JSON, sense text addicional.
`;

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
    last_edit      // v2.6: Last edit memory for "una altra" cases
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
    strict_mode
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

  // 4. Call Gemini
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  const geminiResp = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: contents,
      system_instruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4  // Slightly higher for natural conversation
      }
    })
  });

  if (!geminiResp.ok) throw new Error("gemini_error: " + await geminiResp.text());
  const geminiData = await geminiResp.json();

  // 5. Parse and validate response
  const rawResponse = geminiData.candidates[0].content.parts[0].text;
  const parsedResponse = parseAndValidate(rawResponse);

  // 6. Return response
  return new Response(JSON.stringify({
    status: "ok",
    data: parsedResponse,
    credits_remaining: creditsResult.credits_remaining || 0,
    _debug: {
      version: "2.6.1",
      has_selection: has_selection,
      history_length: chat_history?.length || 0,
      has_last_edit: !!last_edit
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
