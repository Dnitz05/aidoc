/**
 * GroqProvider - Groq AI provider (ultra-fast inference)
 */

import { BaseProvider } from './base.js';

export class GroqProvider extends BaseProvider {
  static PROVIDER_ID = 'groq';
  static DEFAULT_MODEL = 'llama-3.3-70b-versatile';
  static BASE_URL = 'https://api.groq.com/openai/v1';

  /**
   * Send a chat request to Groq
   * Groq uses OpenAI-compatible API format
   */
  async chat(messages, options = {}) {
    const { systemPrompt, temperature = 0.3, maxTokens = 4096, signal } = options;

    const url = `${GroqProvider.BASE_URL}/chat/completions`;

    // Build messages array with system prompt
    const allMessages = [];
    if (systemPrompt) {
      allMessages.push({ role: 'system', content: systemPrompt });
    }
    allMessages.push(...messages);

    const requestBody = {
      model: this.model,
      messages: allMessages,
      temperature,
      max_tokens: maxTokens,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      await this.handleError(response, 'Groq');
    }

    const data = await response.json();

    // Extract content
    const content = data.choices?.[0]?.message?.content || '';

    // Extract usage
    const usage = {
      input: data.usage?.prompt_tokens || 0,
      output: data.usage?.completion_tokens || 0,
    };

    return this.formatResponse(content, usage);
  }
}
