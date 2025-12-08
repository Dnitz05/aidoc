/**
 * OpenAIProvider - OpenAI GPT provider
 */

import { BaseProvider } from './base.js';

export class OpenAIProvider extends BaseProvider {
  static PROVIDER_ID = 'openai';
  static DEFAULT_MODEL = 'gpt-4.1-mini';
  static BASE_URL = 'https://api.openai.com/v1';

  /**
   * Send a chat request to OpenAI
   */
  async chat(messages, options = {}) {
    const { systemPrompt, temperature = 0.3, maxTokens = 4096, signal } = options;

    const url = `${OpenAIProvider.BASE_URL}/chat/completions`;

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
      await this.handleError(response, 'OpenAI');
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
