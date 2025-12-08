/**
 * BaseProvider - Abstract base class for AI providers
 *
 * All providers must extend this class and implement the chat() method.
 */

export class BaseProvider {
  static PROVIDER_ID = 'base';
  static DEFAULT_MODEL = 'default';

  constructor(config = {}) {
    this.apiKey = config.apiKey;
    this.model = config.model || this.constructor.DEFAULT_MODEL;
    this.name = this.constructor.PROVIDER_ID;
  }

  /**
   * Send a chat request to the AI provider
   *
   * @param {Array<{role: string, content: string}>} messages - Chat messages
   * @param {Object} options - Options
   * @param {string} options.systemPrompt - System prompt
   * @param {number} options.temperature - Temperature (0-1)
   * @param {number} options.maxTokens - Max output tokens
   * @param {AbortSignal} options.signal - Abort signal
   * @returns {Promise<{content: string, usage: {input: number, output: number}}>}
   */
  async chat(messages, options = {}) {
    throw new Error('chat() must be implemented by subclass');
  }

  /**
   * Format the response in a standard way
   *
   * @param {string} content - Response content
   * @param {Object} usage - Token usage
   * @returns {Object}
   */
  formatResponse(content, usage = {}) {
    return {
      content,
      usage: {
        input: usage.inputTokens || usage.input || 0,
        output: usage.outputTokens || usage.output || 0,
        total: (usage.inputTokens || usage.input || 0) + (usage.outputTokens || usage.output || 0),
      },
      model: this.model,
      provider: this.name,
    };
  }

  /**
   * Handle API errors in a consistent way
   *
   * @param {Response} response - Fetch response
   * @param {string} provider - Provider name
   */
  async handleError(response, provider) {
    let errorMessage;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error?.message || errorData.message || JSON.stringify(errorData);
    } catch {
      errorMessage = await response.text();
    }
    throw new Error(`${provider} API error (${response.status}): ${errorMessage}`);
  }
}
