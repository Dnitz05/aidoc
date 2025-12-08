/**
 * MistralProvider - Mistral AI provider
 */

import { BaseProvider } from './base.js';

export class MistralProvider extends BaseProvider {
  static PROVIDER_ID = 'mistral';
  static DEFAULT_MODEL = 'mistral-small-latest';
  static BASE_URL = 'https://api.mistral.ai/v1';

  /**
   * Send a chat request to Mistral
   * Mistral uses OpenAI-compatible API format
   */
  async chat(messages, options = {}) {
    const { systemPrompt, temperature = 0.3, maxTokens = 4096, signal } = options;

    const url = `${MistralProvider.BASE_URL}/chat/completions`;

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
      await this.handleError(response, 'Mistral');
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
