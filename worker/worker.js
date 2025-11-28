/**
 * SideCar API Worker - Chat Mode (Fase 6)
 * Gestiona peticions, descompta crèdits i retorna text + explicació (change_summary).
 */
export default {
  async fetch(request, env) {
    // 1. CORS Headers (Permetre accés des de Google Docs)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    try {
      // 2. Llegir cos de la petició
      const body = await request.json();
      const { license_key, mode, text, doc_metadata, user_instruction } = body;

      if (!license_key) throw new Error("missing_license");
      if (!text) throw new Error("missing_text");

      // 3. Validació de Llicència i Crèdits (Supabase RPC)
      // Generem el hash SHA-256 de la llicència
      const msgBuffer = new TextEncoder().encode(license_key);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const licenseHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Cridem a la base de dades
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
          p_operation: mode || 'custom',
          p_metadata: doc_metadata || {}
        })
      });

      if (!supabaseResp.ok) throw new Error("supabase_error");
      const supabaseData = await supabaseResp.json();

      // Control de crèdits (opcional: si RPC retorna error lògic)
      // Per ara assumim que si la DB respon 200, l'operació s'ha fet o s'ha gestionat l'error allà.

      // 4. Preparar Prompt per a Gemini (Mode XAT)
      // Forcem que Gemini respongui SEMPRE en JSON per poder separar el text de l'explicació.
      const systemInstruction = `Ets SideCar, un assistent editorial expert.
      La teva tasca és editar el text proporcionat seguint les instruccions de l'usuari.

      INSTRUCCIONS DE FORMAT (CRÍTIC):
      1. Respon ÚNICAMENT amb un objecte JSON vàlid.
      2. NO facis servir blocs de codi markdown (\`\`\`json).
      3. El JSON ha de tenir exactament aquests camps:
         - "result_text": El text completament reescrit/modificat.
         - "change_summary": Una explicació molt breu (màxim 1 frase, to amable) del català.`;

      const userPrompt = `TEXT ORIGINAL: "${text}"\n\nINSTRUCCIÓ DE L'USUARI: "${user_instruction || "Millora aquest text"}"`;

      // 5. Crida a Gemini API
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`;
      const geminiResp = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: userPrompt }] }],
          system_instruction: { parts: [{ text: systemInstruction }] }
        })
      });

      if (!geminiResp.ok) {
        const errText = await geminiResp.text();
        throw new Error("gemini_error: " + errText);
      }

      const geminiData = await geminiResp.json();
      const rawContent = geminiData.candidates[0].content.parts[0].text;

      // 6. Neteja i Parsing de la resposta (JSON segur)
      let parsedResponse;
      try {
        const cleanJson = rawContent.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedResponse = JSON.parse(cleanJson);
      } catch (e) {
        // Fallback si la IA falla el format JSON
        parsedResponse = {
          result_text: rawContent,
          change_summary: "He processat el text, però no he pogut generar el resum."
        };
      }

      // 7. Retornar al Client
      return new Response(JSON.stringify({
        status: "ok",
        result_text: parsedResponse.result_text,
        change_summary: parsedResponse.change_summary,
        credits_remaining: supabaseData.credits_remaining || 0
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response(JSON.stringify({
        status: "error",
        error_code: err.message
      }), { status: 500, headers: corsHeaders });
    }
  }
};
