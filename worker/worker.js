/**
 * SideCar API Worker - Phase 8: RAG Express / Gem Config
 * Suporta: Smart Markers + Style Guide + Knowledge Base + Strict Mode
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
      const {
        license_key,
        text,
        user_instruction,
        doc_metadata,
        style_guide,
        knowledge_base,
        strict_mode
      } = body;

      if (!license_key) throw new Error("missing_license");

      // 1. Supabase (Crèdits)
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
          p_operation: 'gem_config',
          p_metadata: doc_metadata || {}
        })
      });

      if (!supabaseResp.ok) throw new Error("supabase_error");
      const supabaseData = await supabaseResp.json();

      // 2. PROMPT MIXER - Construcció modular del System Instruction
      const systemInstruction = buildSystemInstruction(style_guide, knowledge_base, strict_mode);
      const userPrompt = `TEXT AMB MARCADORS:\n${text}\n\nINSTRUCCIÓ: "${user_instruction || "Millora el text"}"`;

      // 3. Crida a Gemini
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;
      const geminiResp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userPrompt }] }],
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
        parsedResponse = {
          mode: "REWRITE_FULL",
          change_summary: "He processat el text (format de resposta ajustat).",
          blocks: [{ type: "PARAGRAPH", text: geminiData.candidates[0].content.parts[0].text, formatting: [] }]
        };
      }

      return new Response(JSON.stringify({
        status: "ok",
        data: parsedResponse,
        credits_remaining: supabaseData.credits_remaining || 0
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (err) {
      return new Response(JSON.stringify({ status: "error", error_code: err.message }),
        { status: 500, headers: corsHeaders });
    }
  }
};

/**
 * PROMPT MIXER - Construeix el System Instruction dinàmicament
 */
function buildSystemInstruction(styleGuide, knowledgeBase, strictMode) {
  // CAPA 0: Base tècnica (sempre present)
  let instruction = `Ets SideCar, un editor expert que preserva el format del document.

INPUT: Rebràs un text on cada paràgraf comença amb un marcador ID, ex: "{{12}} El text...".

INSTRUCCIONS DE FORMAT (CRÍTIC):
Tens dos modes de funcionament segons què demani l'usuari:

MODE A: CORRECCIÓ / MILLORA / TRADUCCIÓ (Preservar Estructura)
Si l'usuari vol millorar, corregir, traduir o modificar el text existent SENSE canviar l'estructura:
- Retorna JSON: { "mode": "UPDATE_BY_ID", "updates": { "0": "Text corregit...", "2": "Text traduït..." }, "change_summary": "Explicació breu en català" }
- Només inclou els IDs que han canviat. Si un paràgraf no necessita canvis, NO l'incloguis.
- Dins del text, pots usar **negreta** i *cursiva* per formatar paraules importants.
- IMPORTANT: Els IDs han de ser strings, no números.

MODE B: RESUM / REESCRIPTURA TOTAL (Canviar Estructura)
Si l'usuari demana un resum, esquema, reorganització o canvi radical que fa impossible mantenir la correspondència 1 a 1:
- Retorna JSON: { "mode": "REWRITE_FULL", "blocks": [...], "change_summary": "Explicació breu en català" }
- Estructura de blocks: [{ "type": "HEADING_1|HEADING_2|HEADING_3|PARAGRAPH|BULLET_LIST|NUMBERED_LIST", "text": "contingut", "formatting": [{"style": "BOLD|ITALIC", "start": 0, "length": 5}] }]

REGLA D'OR: Prioritza SEMPRE el MODE A (UPDATE_BY_ID) si és possible. Només usa MODE B si l'usuari explícitament demana canviar l'estructura.`;

  // CAPA 1: Guia d'Estil (si existeix)
  if (styleGuide && styleGuide.trim()) {
    instruction += `

═══════════════════════════════════════════════════════════
GUIA D'ESTIL DE L'USUARI (segueix aquestes preferències):
═══════════════════════════════════════════════════════════
${styleGuide.trim()}`;
  }

  // CAPA 2: Base de Coneixement (si existeix)
  if (knowledgeBase && knowledgeBase.trim()) {
    instruction += `

═══════════════════════════════════════════════════════════
BASE DE CONEIXEMENT / CONTEXT DE REFERÈNCIA:
═══════════════════════════════════════════════════════════
${knowledgeBase.trim()}`;
  }

  // CAPA 3: Mode Estricte vs Obert
  if (knowledgeBase && knowledgeBase.trim()) {
    if (strictMode === true) {
      instruction += `

⚠️ MODE ESTRICTE ACTIVAT ⚠️
CRÍTIC: Respon ÚNICAMENT basant-te en la 'BASE DE CONEIXEMENT' proporcionada.
- Si la informació no hi és, digues explícitament: "No tinc aquesta informació al context proporcionat."
- NO usis el teu coneixement general del món.
- NO inventis ni infereixis dades que no estiguin explícitament al context.`;
    } else {
      instruction += `

MODE OBERT: Prioritza la 'BASE DE CONEIXEMENT' com a font de veritat.
- Si hi ha contradicció, el context proporcionat guanya sobre el teu coneixement general.
- Pots usar el teu coneixement general per omplir buits o complementar.`;
    }
  }

  return instruction;
}
