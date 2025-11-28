/**
 * SideCar API Worker - Block-Based Architecture (JSON Protocol)
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
      const { license_key, text, user_instruction, doc_metadata } = body;

      if (!license_key) throw new Error("missing_license");
      if (!text) throw new Error("missing_text");

      // 1. Validació de Llicència i Crèdits
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
          p_operation: 'custom_blocks',
          p_metadata: doc_metadata || {}
        })
      });

      if (!supabaseResp.ok) throw new Error("supabase_error");
      const supabaseData = await supabaseResp.json();

      // 2. Prompt "Block-Based" per a Gemini 2.0 Flash
      const systemInstruction = `Ets SideCar, un editor professional d'IA.
      La teva missió és editar, resumir o reescriure el text seguint les instruccions de l'usuari.

      FORMAT DE RESPOSTA (ESTRICTE JSON):
      Retorna ÚNICAMENT un objecte JSON amb aquesta estructura exacta. NO usis Markdown.

      {
        "change_summary": "Explicació molt breu (1 frase) del que has fet, en català",
        "blocks": [
          {
            "type": "HEADING_1" | "HEADING_2" | "HEADING_3" | "PARAGRAPH" | "BULLET_LIST" | "NUMBERED_LIST",
            "text": "El contingut textual del bloc",
            "formatting": [
              { "style": "BOLD" | "ITALIC", "start": 0, "length": 5 }
            ]
          }
        ]
      }

      REGLES:
      1. El camp "formatting" és una llista de rangs per aplicar estils (start és l'índex dins del string "text").
      2. Si l'usuari demana resumir, estructura bé el resultat amb títols i llistes.
      3. Mantén la coherència visual.`;

      const userPrompt = `TEXT ORIGINAL: "${text}"\n\nINSTRUCCIÓ: "${user_instruction || "Millora el text"}"`;

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
      const rawContent = geminiData.candidates[0].content.parts[0].text;

      // Intentem parsejar per assegurar que és JSON vàlid abans d'enviar
      const parsedResponse = JSON.parse(rawContent);

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
