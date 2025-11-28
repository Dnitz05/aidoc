/**
 * SideCar API Worker - RAG Express + File Upload
 * Fase 8.2: Suport per fitxers PDF/TXT via Google File API
 */
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

      // ═══════════════════════════════════════════════════════════
      // ACCIÓ: UPLOAD_FILE (Proxy per pujar fitxers a Google)
      // ═══════════════════════════════════════════════════════════
      if (body.action === 'upload_file') {
        return await handleFileUpload(body, env, corsHeaders);
      }

      // ═══════════════════════════════════════════════════════════
      // ACCIÓ: GET_RECEIPTS (Obtenir receptes d'usuari)
      // ═══════════════════════════════════════════════════════════
      if (body.action === 'get_receipts') {
        return await handleGetReceipts(body, env, corsHeaders);
      }

      // ═══════════════════════════════════════════════════════════
      // ACCIÓ: SAVE_RECEIPT (Guardar nova recepta)
      // ═══════════════════════════════════════════════════════════
      if (body.action === 'save_receipt') {
        return await handleSaveReceipt(body, env, corsHeaders);
      }

      // ═══════════════════════════════════════════════════════════
      // ACCIÓ: DELETE_RECEIPT (Eliminar recepta)
      // ═══════════════════════════════════════════════════════════
      if (body.action === 'delete_receipt') {
        return await handleDeleteReceipt(body, env, corsHeaders);
      }

      // ═══════════════════════════════════════════════════════════
      // ACCIÓ: CHAT (Flux principal de processament)
      // ═══════════════════════════════════════════════════════════
      return await handleChat(body, env, corsHeaders);

    } catch (err) {
      return new Response(JSON.stringify({ status: "error", error_code: err.message }),
        { status: 500, headers: corsHeaders });
    }
  }
};

/**
 * Handler per pujar fitxers a Google File API
 */
async function handleFileUpload(body, env, corsHeaders) {
  const { file_data, mime_type, filename, license_key } = body;

  if (!license_key) throw new Error("missing_license");
  if (!file_data) throw new Error("missing_file_data");
  if (!mime_type) throw new Error("missing_mime_type");

  // Decodificar Base64 a bytes
  const binaryString = atob(file_data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const numBytes = bytes.length;
  const displayName = filename || `sidecar_file_${Date.now()}`;

  // ─── STEP 1: Iniciar upload resumable ───
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

  // Obtenir la URL d'upload
  const uploadUrl = startResp.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error("file_api_no_upload_url");
  }

  // ─── STEP 2: Pujar els bytes ───
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

  // El fitxer pot trigar a estar "ACTIVE", però la URI ja és vàlida
  return new Response(JSON.stringify({
    status: "ok",
    file_uri: fileInfo.file?.uri || null,
    file_name: fileInfo.file?.displayName || displayName,
    file_state: fileInfo.file?.state || "PROCESSING",
    mime_type: fileInfo.file?.mimeType || mime_type
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * Handler principal de xat amb RAG i Router d'Intenció
 */
async function handleChat(body, env, corsHeaders) {
  const {
    license_key,
    text,
    user_instruction,
    doc_metadata,
    style_guide,
    knowledge_base,
    strict_mode,
    knowledge_file_uri,
    knowledge_file_mime
  } = body;

  if (!license_key) throw new Error("missing_license");
  if (!text) throw new Error("missing_text");

  // 1. Validació de Llicència
  const msgBuffer = new TextEncoder().encode(license_key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const licenseHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

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
      p_operation: 'rag_file',
      p_metadata: doc_metadata || {}
    })
  });
  const supabaseData = await supabaseResp.json();

  // 2. Construcció del Prompt amb ROUTER D'INTENCIÓ
  let systemInstruction = `Ets SideCar, un editor professional d'IA amb capacitat de conversa.

═══════════════════════════════════════════════════════════════
ROUTER D'INTENCIÓ - DECIDEIX EL MODE ABANS DE RESPONDRE:
═══════════════════════════════════════════════════════════════

ANALITZA la instrucció de l'usuari i decideix:

**MODE A: CHAT_ONLY** (Consultes i preguntes)
- Usar quan: L'usuari PREGUNTA sobre el document, el fitxer PDF, o vol informació.
- Exemples: "Què diu el PDF?", "Quin és l'import?", "Resume el document", "Explica'm..."
- Format de resposta:
{
  "mode": "CHAT_ONLY",
  "chat_response": "La teva resposta conversacional aquí",
  "change_summary": "Consulta resolta sense modificar el document"
}

**MODE B: UPDATE_BY_ID** (Edició quirúrgica amb Smart Markers)
- Usar quan: L'usuari vol MODIFICAR paràgrafs específics del document.
- El text ve amb marcadors {{ID}} per identificar cada paràgraf.
- Exemples: "Millora el paràgraf 2", "Corregeix errors", "Fes més formal el text"
- Format de resposta:
{
  "mode": "UPDATE_BY_ID",
  "updates": {
    "0": "Text nou pel paràgraf 0 amb **negreta** si cal",
    "2": "Text nou pel paràgraf 2"
  },
  "change_summary": "Explicació dels canvis"
}

**MODE C: REWRITE** (Reescriptura completa)
- Usar quan: L'usuari vol GENERAR contingut nou o reescriure TOT.
- Exemples: "Escriu un email sobre...", "Crea una llista de...", "Redacta..."
- Format de resposta:
{
  "mode": "REWRITE",
  "change_summary": "Explicació breu",
  "blocks": [
    { "type": "PARAGRAPH", "text": "Contingut" }
  ]
}

IMPORTANT:
- Si l'usuari fa una PREGUNTA → sempre CHAT_ONLY
- Si l'usuari vol MODIFICAR text existent → UPDATE_BY_ID
- Si l'usuari vol CREAR contingut nou → REWRITE
- Els tipus de block són: HEADING_1, HEADING_2, HEADING_3, PARAGRAPH, BULLET_LIST, NUMBERED_LIST
═══════════════════════════════════════════════════════════════`;

  // Injecció de Personalitat
  if (style_guide && style_guide.trim()) {
    systemInstruction += `\n\nGUIA D'ESTIL:\n${style_guide}`;
  }

  // Injecció de Coneixement (Text)
  if (knowledge_base && knowledge_base.trim()) {
    systemInstruction += `\n\nBASE DE CONEIXEMENT:\n${knowledge_base}`;
  }

  // Nota sobre fitxer adjunt
  if (knowledge_file_uri) {
    systemInstruction += `\n\nFITXER ADJUNT: S'ha proporcionat un fitxer. Usa'l com a font principal per respondre preguntes.`;
  }

  // Mode Estricte
  if (strict_mode) {
    systemInstruction += `\n\nMODE ESTRICTE: Respon NOMÉS amb informació del context/fitxer proporcionat.`;
  }

  // 3. Construir parts del missatge
  const userParts = [];

  if (knowledge_file_uri) {
    userParts.push({
      fileData: {
        fileUri: knowledge_file_uri,
        mimeType: knowledge_file_mime || "application/pdf"
      }
    });
  }

  userParts.push({
    text: `DOCUMENT ACTUAL:\n${text}\n\nINSTRUCCIÓ DE L'USUARI: "${user_instruction || "Processa el text"}"`
  });

  // 4. Crida a Gemini
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  const geminiResp = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: userParts }],
      system_instruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!geminiResp.ok) throw new Error("gemini_error: " + await geminiResp.text());
  const geminiData = await geminiResp.json();

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(geminiData.candidates[0].content.parts[0].text);
  } catch (e) {
    // Fallback: tractar com a resposta de xat
    parsedResponse = {
      mode: "CHAT_ONLY",
      chat_response: geminiData.candidates[0].content.parts[0].text,
      change_summary: "Resposta processada"
    };
  }

  return new Response(JSON.stringify({
    status: "ok",
    data: parsedResponse,
    credits_remaining: supabaseData.credits_remaining || 0
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ═══════════════════════════════════════════════════════════════
// RECEIPTS HANDLERS (Custom Macros)
// ═══════════════════════════════════════════════════════════════

/**
 * Hash license key using SHA-256
 */
async function hashLicenseKey(licenseKey) {
  const msgBuffer = new TextEncoder().encode(licenseKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Handler per obtenir les receptes de l'usuari
 */
async function handleGetReceipts(body, env, corsHeaders) {
  const { license_key } = body;

  if (!license_key) throw new Error("missing_license");

  const licenseHash = await hashLicenseKey(license_key);

  // Consultar Supabase
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

/**
 * Handler per guardar una nova recepta
 */
async function handleSaveReceipt(body, env, corsHeaders) {
  const { license_key, label, instruction, icon } = body;

  if (!license_key) throw new Error("missing_license");
  if (!label || !label.trim()) throw new Error("missing_label");
  if (!instruction || !instruction.trim()) throw new Error("missing_instruction");

  const licenseHash = await hashLicenseKey(license_key);

  // Inserir a Supabase
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

/**
 * Handler per eliminar una recepta
 */
async function handleDeleteReceipt(body, env, corsHeaders) {
  const { license_key, receipt_id } = body;

  if (!license_key) throw new Error("missing_license");
  if (!receipt_id) throw new Error("missing_receipt_id");

  const licenseHash = await hashLicenseKey(license_key);

  // Eliminar de Supabase (només si pertany a l'usuari)
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
