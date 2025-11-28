/**
 * SideCar API Worker - RAG Express / Gem Config
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
      const { license_key, text, user_instruction, doc_metadata, style_guide, knowledge_base, strict_mode } = body;

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
          p_operation: 'rag_express',
          p_metadata: doc_metadata || {}
        })
      });
      const supabaseData = await supabaseResp.json();

      // 2. Construcció del Prompt Modular (The Mixer)
      let systemInstruction = `Ets SideCar, un editor professional d'IA.

FORMAT DE RESPOSTA (ESTRICTE JSON):
Retorna ÚNICAMENT un objecte JSON amb aquesta estructura. NO usis Markdown fora del JSON.
{
  "change_summary": "Explicació breu (1 frase)",
  "blocks": [
    {
      "type": "HEADING_1" | "HEADING_2" | "HEADING_3" | "PARAGRAPH" | "BULLET_LIST" | "NUMBERED_LIST",
      "text": "Contingut",
      "formatting": [{ "style": "BOLD" | "ITALIC", "start": 0, "length": 5 }]
    }
  ]
}`;

      // Injecció de Personalitat (Estil)
      if (style_guide && style_guide.trim()) {
        systemInstruction += `\n\nGUIA D'ESTIL DE L'USUARI (Personalitat):\n${style_guide}\nSegueix aquestes preferències de to i format.`;
      }

      // Injecció de Coneixement (RAG)
      if (knowledge_base && knowledge_base.trim()) {
        systemInstruction += `\n\nBASE DE CONEIXEMENT (Context Prioritari):\n${knowledge_base}\nUsa aquesta informació com a veritat absoluta.`;
      }

      // Lògica de Control (Mode Estricte)
      if (strict_mode) {
        systemInstruction += `\n\nMODE ESTRICTE ACTIVAT:
1. Respon ÚNICAMENT basant-te en la 'BASE DE CONEIXEMENT' proporcionada.
2. Si la resposta no es troba explícitament al text del coneixement, has de respondre (al change_summary): "No tinc informació suficient al context per respondre".
3. Està PROHIBIT utilitzar el teu coneixement general per inventar dades.`;
      } else {
        systemInstruction += `\n\nMODE OBERT:
Prioritza la 'BASE DE CONEIXEMENT', però pots utilitzar el teu coneixement general i sentit comú per complementar la resposta o omplir buits.`;
      }

      const userPrompt = `TEXT ORIGINAL: "${text}"\n\nINSTRUCCIÓ: "${user_instruction || "Processa el text"}"`;

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
            change_summary: "Error de format JSON.",
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
