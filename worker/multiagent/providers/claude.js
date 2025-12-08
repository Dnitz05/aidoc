/**
 * ClaudeProvider - Anthropic Claude provider
 */

import { BaseProvider } from './base.js';

export class ClaudeProvider extends BaseProvider {
  static PROVIDER_ID = 'claude';
  static DEFAULT_MODEL = 'claude-sonnet-4-5-20251101';
  static BASE_URL = 'https://api.anthropic.com/v1';

  /**
   * Send a chat request to Claude
   */
  async chat(messages, options = {}) {
    const { systemPrompt, temperature = 0.3, maxTokens = 4096, signal } = options;

    const url = `${ClaudeProvider.BASE_URL}/messages`;

    // Claude uses a separate system field
    const requestBody = {
      model: this.model,
      max_tokens: maxTokens,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
    };

    // Add system prompt if provided
    if (systemPrompt) {
      requestBody.system = systemPrompt;
    }

    // Only add temperature if not using default
    if (temperature !== undefined) {
      requestBody.temperature = temperature;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
      signal,
    });

    if (!response.ok) {
      await this.handleError(response, 'Claude');
    }

    const data = await response.json();

    // Extract content (Claude returns array of content blocks)
    const content = data.content
      ?.filter(block => block.type === 'text')
      .map(block => block.text)
      .join('') || '';

    // Extract usage
    const usage = {
      input: data.usage?.input_tokens || 0,
      output: data.usage?.output_tokens || 0,
    };

    return this.formatResponse(content, usage);
  }
}
