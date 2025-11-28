/**
 * SideCar API Worker
 * Zero dependencies - uses native fetch for Supabase and Gemini
 * Multi-mode support + Custom instruction mode (Chat-to-Edit)
 */

// System instructions per mode predefinit
const MODE_INSTRUCTIONS = {
  formalize: "Actua com un editor professional. Reescriu el text proporcionat en un registre formal i professional, mantenint l'idioma original. NO afegeixis explicacions, només el text resultant.",
  improve: "Actua com un corrector expert. Corregeix gramàtica i ortografia, millora la claredat i l'estil, però mantén el to i l'idioma original. NO afegeixis explicacions, només el text resultant.",
  summarize: "Actua com un redactor expert. Fes un resum concís del text proporcionat en el mateix idioma. NO afegeixis explicacions, només el resum.",
  translate_en: "You are a professional translator. Translate the following text to English. Do NOT add explanations, only the translated text.",
  translate_es: "Eres un traductor profesional. Traduce el siguiente texto al español (castellano). NO añadas explicaciones, solo el texto traducido."
};

// Prompt per al mode custom (Chat-to-Edit)
const CUSTOM_SYSTEM_PROMPT = `Ets un editor de text expert. La teva tasca és modificar un text segons les instruccions de l'usuari.

IMPORTANT: Has de respondre SEMPRE en format JSON pur (sense blocs de codi markdown).
Estructura del JSON de resposta:
{
  "result_text": "El text modificat complet",
  "change_summary": "Una explicació molt breu (màxim 15 paraules) del que has fet, en català"
}

Exemple de resposta correcta:
{"result_text": "El text ja modificat aquí...", "change_summary": "He formalitzat el to i corregit errors ortogràfics."}`;

export default {
  async fetch(request, env) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only accept POST
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    try {
      // Step 1: Validate input
      const body = await request.json();
      const { license_key, mode, text, doc_metadata, user_instruction } = body;

      if (!license_key || !mode || !text) {
        return jsonResponse(
          { error: 'Missing required fields: license_key, mode, text' },
          400,
          corsHeaders
        );
      }

      // Validate mode
      const isCustomMode = mode === 'custom';
      if (!isCustomMode && !MODE_INSTRUCTIONS[mode]) {
        return jsonResponse(
          { error: `Invalid mode. Supported modes: ${Object.keys(MODE_INSTRUCTIONS).join(', ')}, custom` },
          400,
          corsHeaders
        );
      }

      // Custom mode requires user_instruction
      if (isCustomMode && !user_instruction) {
        return jsonResponse(
          { error: 'Custom mode requires user_instruction' },
          400,
          corsHeaders
        );
      }

      // Step 2: Hash the license key (SHA-256)
      const licenseKeyHash = await hashLicenseKey(license_key);

      // Step 3: Deduct credits via Supabase RPC
      const creditsResult = await deductCredits(env, licenseKeyHash, mode);

      if (!creditsResult.ok) {
        const statusCode = creditsResult.error === 'LICENSE_NOT_FOUND' ? 403 :
                          creditsResult.error === 'LICENSE_INACTIVE' ? 403 :
                          creditsResult.error === 'INSUFFICIENT_CREDITS' ? 402 : 500;
        return jsonResponse(
          {
            error: creditsResult.error,
            credits_remaining: creditsResult.credits_remaining
          },
          statusCode,
          corsHeaders
        );
      }

      // Step 4: Call Gemini API
      let result;
      if (isCustomMode) {
        // Custom mode: expects JSON response with result_text and change_summary
        result = await callGeminiCustom(env, text, user_instruction);
      } else {
        // Predefined modes: simple text response
        const processedText = await callGemini(env, text, MODE_INSTRUCTIONS[mode]);
        result = {
          result_text: processedText,
          change_summary: null
        };
      }

      // Step 5: Return success response
      return jsonResponse(
        {
          status: 'ok',
          result_text: result.result_text,
          change_summary: result.change_summary,
          credits_remaining: creditsResult.credits_remaining,
          mode: mode
        },
        200,
        corsHeaders
      );

    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse(
        { error: 'Internal server error', details: error.message },
        500,
        corsHeaders
      );
    }
  },
};

/**
 * Hash license key using SHA-256
 */
async function hashLicenseKey(licenseKey) {
  const encoder = new TextEncoder();
  const data = encoder.encode(licenseKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deduct credits via Supabase RPC
 */
async function deductCredits(env, licenseKeyHash, operation) {
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/use_license_credits`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        p_license_key_hash: licenseKeyHash,
        p_cost: 1,
        p_operation: operation,
        p_metadata: {},
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Supabase RPC error:', errorText);
    return { ok: false, error: 'SUPABASE_ERROR' };
  }

  return await response.json();
}

/**
 * Call Gemini API with predefined system instruction (simple text response)
 */
async function callGemini(env, text, systemInstruction) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          {
            parts: [{ text: text }]
          }
        ],
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error('Gemini API request failed');
  }

  const data = await response.json();
  const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!resultText) {
    throw new Error('No text in Gemini response');
  }

  return resultText;
}

/**
 * Call Gemini API for custom mode (JSON response with result_text and change_summary)
 */
async function callGeminiCustom(env, text, userInstruction) {
  const userPrompt = `Text original:\n"${text}"\n\nInstrucció de l'usuari:\n"${userInstruction}"`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: CUSTOM_SYSTEM_PROMPT }]
        },
        contents: [
          {
            parts: [{ text: userPrompt }]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini API error:', errorText);
    throw new Error('Gemini API request failed');
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('No text in Gemini response');
  }

  // Parse JSON response from Gemini
  try {
    // Clean up potential markdown code blocks
    const cleanJson = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    return {
      result_text: parsed.result_text || rawText,
      change_summary: parsed.change_summary || 'Canvis aplicats.'
    };
  } catch (e) {
    // Fallback if JSON parsing fails
    console.error('JSON parse error:', e, 'Raw:', rawText);
    return {
      result_text: rawText,
      change_summary: 'Canvis aplicats.'
    };
  }
}

/**
 * Helper to create JSON responses
 */
function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
