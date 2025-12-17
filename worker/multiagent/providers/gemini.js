/**
 * GeminiProvider - Google Gemini AI provider
 */

import { BaseProvider } from './base.js';

export class GeminiProvider extends BaseProvider {
  static PROVIDER_ID = 'gemini';
  static DEFAULT_MODEL = 'gemini-3-flash-preview';
  static BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

  /**
   * Send a chat request to Gemini
   */
  async chat(messages, options = {}) {
    const { systemPrompt, temperature = 0.3, maxTokens = 4096, signal } = options;

    const url = `${GeminiProvider.BASE_URL}/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Convert messages to Gemini format
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const requestBody = {
      contents,
      generationConfig: {
        temperature,
        topP: 0.8,
        maxOutputTokens: maxTokens,
      },
    };

    // Add system instruction if provided
    // IMPORTANT: Gemini API uses snake_case "system_instruction", NOT camelCase!
    if (systemPrompt) {
      requestBody.system_instruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      await this.handleError(response, 'Gemini');
    }

    const data = await response.json();

    // Extract content
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract usage
    const usage = {
      input: data.usageMetadata?.promptTokenCount || 0,
      output: data.usageMetadata?.candidatesTokenCount || 0,
    };

    return this.formatResponse(content, usage);
  }
}
