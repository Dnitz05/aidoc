/**
 * Provider Factory - Creates AI providers based on configuration
 *
 * Exports:
 * - PROVIDERS: Enum of provider IDs
 * - createProvider: Create provider by ID and API key
 * - createProviderFromAuth: Create provider from auth object
 * - getProvidersInfo: Get info about all available providers
 * - validateApiKey: Validate API key format
 */

import { BaseProvider } from './base.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { ClaudeProvider } from './claude.js';
import { MistralProvider } from './mistral.js';
import { GroqProvider } from './groq.js';

// Provider ID constants
export const PROVIDERS = {
  GEMINI: 'gemini',
  OPENAI: 'openai',
  CLAUDE: 'claude',
  MISTRAL: 'mistral',
  GROQ: 'groq',
};

// Provider class registry
const PROVIDER_CLASSES = {
  [PROVIDERS.GEMINI]: GeminiProvider,
  [PROVIDERS.OPENAI]: OpenAIProvider,
  [PROVIDERS.CLAUDE]: ClaudeProvider,
  [PROVIDERS.MISTRAL]: MistralProvider,
  [PROVIDERS.GROQ]: GroqProvider,
};

// Provider metadata
const PROVIDER_INFO = {
  [PROVIDERS.GEMINI]: {
    name: 'Google Gemini',
    defaultModel: GeminiProvider.DEFAULT_MODEL,
    models: {
      'gemini-3-flash-preview': 'Gemini 3 Flash (Recomanat)',
      'gemini-3-pro': 'Gemini 3 Pro (Més potent)',
      'gemini-2.5-flash': 'Gemini 2.5 Flash',
      'gemini-2.0-flash': 'Gemini 2.0 Flash',
    },
    keyPrefix: null,
  },
  [PROVIDERS.OPENAI]: {
    name: 'OpenAI',
    defaultModel: OpenAIProvider.DEFAULT_MODEL,
    models: {
      'chatgpt-5.1': 'ChatGPT 5.1 (Més potent)',
      'gpt-4o': 'GPT-4o (Recomanat)',
      'gpt-4o-mini': 'GPT-4o Mini (Ràpid)',
      'o1': 'o1 (Raonament avançat)',
      'o1-mini': 'o1 Mini (Raonament ràpid)',
    },
    keyPrefix: 'sk-',
  },
  [PROVIDERS.CLAUDE]: {
    name: 'Anthropic Claude',
    defaultModel: ClaudeProvider.DEFAULT_MODEL,
    models: {
      'claude-opus-4-5-20251101': 'Claude Opus 4.5 (Més potent)',
      'claude-sonnet-4-5-20251101': 'Claude Sonnet 4.5 (Recomanat)',
      'claude-sonnet-4-20250514': 'Claude Sonnet 4',
      'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku (Ràpid)',
    },
    keyPrefix: 'sk-ant-',
  },
  [PROVIDERS.MISTRAL]: {
    name: 'Mistral AI',
    defaultModel: MistralProvider.DEFAULT_MODEL,
    models: {
      'mistral-large-latest': 'Mistral Large 2',
      'mistral-small-latest': 'Mistral Small (Recomanat)',
      'codestral-latest': 'Codestral (Codi)',
      'pixtral-large-latest': 'Pixtral Large (Multimodal)',
    },
    keyPrefix: null,
  },
  [PROVIDERS.GROQ]: {
    name: 'Groq',
    defaultModel: GroqProvider.DEFAULT_MODEL,
    models: {
      'llama-3.3-70b-versatile': 'Llama 3.3 70B (Recomanat)',
      'llama-3.2-90b-vision-preview': 'Llama 3.2 90B Vision',
      'llama-3.1-8b-instant': 'Llama 3.1 8B (Ultraràpid)',
      'mixtral-8x7b-32768': 'Mixtral 8x7B',
    },
    keyPrefix: 'gsk_',
  },
};

/**
 * Create a provider instance by ID
 *
 * @param {string} providerId - Provider ID (gemini, openai, etc.)
 * @param {string} apiKey - API key for the provider
 * @param {string} [model] - Specific model to use (optional)
 * @returns {BaseProvider} - Provider instance
 */
export function createProvider(providerId, apiKey, model = null) {
  const ProviderClass = PROVIDER_CLASSES[providerId];

  if (!ProviderClass) {
    throw new Error(`Unknown provider: ${providerId}. Available: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  if (!apiKey) {
    throw new Error(`API key required for provider: ${providerId}`);
  }

  return new ProviderClass({
    apiKey,
    model: model || ProviderClass.DEFAULT_MODEL,
  });
}

/**
 * Create a provider from an auth object (as sent by GAS)
 *
 * @param {Object} auth - Auth object from payload
 * @param {string} auth.mode - 'byok' or 'subscription'
 * @param {string} auth.provider - Provider ID
 * @param {string} auth.api_key - API key
 * @param {string} auth.model - Model ID
 * @param {Object} env - Environment variables (for fallback)
 * @returns {BaseProvider|null} - Provider instance or null
 */
export function createProviderFromAuth(auth, env = {}) {
  // No auth = use central Gemini (legacy mode)
  if (!auth) {
    if (env.GEMINI_API_KEY) {
      return createProvider(PROVIDERS.GEMINI, env.GEMINI_API_KEY);
    }
    return null;
  }

  // BYOK mode
  if (auth.mode === 'byok') {
    if (!auth.provider || !auth.api_key) {
      throw new Error('BYOK auth requires provider and api_key');
    }
    return createProvider(auth.provider, auth.api_key, auth.model);
  }

  // Subscription mode (future)
  if (auth.mode === 'subscription') {
    // For now, use Gemini central for subscription users
    if (env.GEMINI_API_KEY) {
      return createProvider(PROVIDERS.GEMINI, env.GEMINI_API_KEY);
    }
    throw new Error('Subscription mode not yet implemented');
  }

  throw new Error(`Unknown auth mode: ${auth.mode}`);
}

/**
 * Get information about all available providers
 *
 * @returns {Object} - Provider info keyed by ID
 */
export function getProvidersInfo() {
  return PROVIDER_INFO;
}

/**
 * Validate an API key format for a specific provider
 *
 * @param {string} providerId - Provider ID
 * @param {string} apiKey - API key to validate
 * @returns {{valid: boolean, error?: string}}
 */
export function validateApiKey(providerId, apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return { valid: false, error: 'API key is required' };
  }

  const trimmed = apiKey.trim();
  if (trimmed.length < 10) {
    return { valid: false, error: 'API key too short' };
  }

  const info = PROVIDER_INFO[providerId];
  if (!info) {
    return { valid: false, error: `Unknown provider: ${providerId}` };
  }

  // Check prefix if applicable
  if (info.keyPrefix && !trimmed.startsWith(info.keyPrefix)) {
    return {
      valid: false,
      error: `${info.name} API keys should start with "${info.keyPrefix}"`,
    };
  }

  return { valid: true };
}

// Export classes for direct use if needed
export {
  BaseProvider,
  GeminiProvider,
  OpenAIProvider,
  ClaudeProvider,
  MistralProvider,
  GroqProvider,
};
