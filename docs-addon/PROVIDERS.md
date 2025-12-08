# Documentació Tècnica de Proveïdors - Docmile BYOK

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                     Google Apps Script                       │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │ ApiKeyManager.gs│───▶│ buildAuthObject()            │   │
│  │                 │    │ {mode, provider, api_key,    │   │
│  │ - saveApiKey()  │    │  model}                      │   │
│  │ - getApiKey()   │    └──────────────┬───────────────┘   │
│  │ - setActive()   │                   │                    │
│  └─────────────────┘                   ▼                    │
│                              payload.auth                   │
└────────────────────────────────┬────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Worker                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                  pipeline.js                            ││
│  │  options.provider = createProviderFromAuth(auth)        ││
│  └─────────────────────────────────────────────────────────┘│
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              providers/index.js                         ││
│  │                                                         ││
│  │  createProviderFromAuth(auth) {                         ││
│  │    if (auth.mode === 'byok') {                          ││
│  │      return createProvider(auth.provider, {             ││
│  │        apiKey: auth.api_key,                            ││
│  │        model: auth.model                                ││
│  │      });                                                ││
│  │    }                                                    ││
│  │  }                                                      ││
│  └─────────────────────────────────────────────────────────┘│
│                          │                                   │
│                          ▼                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Gemini   │ │ OpenAI   │ │ Claude   │ │ Mistral  │ ...   │
│  │ Provider │ │ Provider │ │ Provider │ │ Provider │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
└───────┼────────────┼────────────┼────────────┼──────────────┘
        │            │            │            │
        ▼            ▼            ▼            ▼
   Gemini API   OpenAI API   Claude API   Mistral API
```

## BaseProvider (Classe Abstracta)

```javascript
// worker/multiagent/providers/base.js

class BaseProvider {
  constructor(config) {
    this.apiKey = config.apiKey;
    this.model = config.model || this.constructor.DEFAULT_MODEL;
  }

  // Mètode principal - ha de ser implementat
  async chat(messages, options = {}) {
    throw new Error('Not implemented');
  }

  // Format de resposta estàndard
  formatResponse(content, usage) {
    return {
      content,
      usage: {
        inputTokens: usage?.inputTokens || 0,
        outputTokens: usage?.outputTokens || 0,
        totalTokens: usage?.totalTokens || 0,
      },
      model: this.model,
      provider: this.constructor.PROVIDER_ID,
    };
  }
}
```

## Proveïdors Implementats

### GeminiProvider

```javascript
// worker/multiagent/providers/gemini.js

PROVIDER_ID = 'gemini'
DEFAULT_MODEL = 'gemini-2.0-flash-001'

// API Endpoint
`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

// Format de missatges
contents: [
  { role: 'user', parts: [{ text: '...' }] },
  { role: 'model', parts: [{ text: '...' }] }
]

// System prompt via systemInstruction
systemInstruction: { parts: [{ text: systemPrompt }] }
```

### OpenAIProvider

```javascript
// worker/multiagent/providers/openai.js

PROVIDER_ID = 'openai'
DEFAULT_MODEL = 'gpt-4o-mini'

// API Endpoint
`https://api.openai.com/v1/chat/completions`

// Headers
Authorization: `Bearer ${apiKey}`

// Format de missatges
messages: [
  { role: 'system', content: '...' },
  { role: 'user', content: '...' },
  { role: 'assistant', content: '...' }
]
```

### ClaudeProvider

```javascript
// worker/multiagent/providers/claude.js

PROVIDER_ID = 'claude'
DEFAULT_MODEL = 'claude-sonnet-4-20250514'

// API Endpoint
`https://api.anthropic.com/v1/messages`

// Headers
x-api-key: apiKey
anthropic-version: '2023-06-01'

// Format de missatges
system: '...',  // System prompt separat
messages: [
  { role: 'user', content: '...' },
  { role: 'assistant', content: '...' }
]
```

### MistralProvider

```javascript
// worker/multiagent/providers/mistral.js

PROVIDER_ID = 'mistral'
DEFAULT_MODEL = 'mistral-small-latest'

// API Endpoint
`https://api.mistral.ai/v1/chat/completions`

// Headers
Authorization: `Bearer ${apiKey}`

// Format (compatible OpenAI)
messages: [
  { role: 'system', content: '...' },
  { role: 'user', content: '...' }
]
```

### GroqProvider

```javascript
// worker/multiagent/providers/groq.js

PROVIDER_ID = 'groq'
DEFAULT_MODEL = 'llama-3.3-70b-versatile'

// API Endpoint
`https://api.groq.com/openai/v1/chat/completions`

// Headers
Authorization: `Bearer ${apiKey}`

// Format (compatible OpenAI)
messages: [
  { role: 'system', content: '...' },
  { role: 'user', content: '...' }
]
```

## Factory Pattern

```javascript
// worker/multiagent/providers/index.js

const PROVIDERS = {
  gemini: GeminiProvider,
  openai: OpenAIProvider,
  claude: ClaudeProvider,
  mistral: MistralProvider,
  groq: GroqProvider,
};

function createProvider(providerId, config) {
  const Provider = PROVIDERS[providerId];
  if (!Provider) throw new Error(`Unknown provider: ${providerId}`);
  return new Provider(config);
}

function createProviderFromAuth(auth) {
  if (!auth) return null;

  if (auth.mode === 'byok') {
    return createProvider(auth.provider, {
      apiKey: auth.api_key,
      model: auth.model,
    });
  }

  // Future: subscription mode
  return null;
}
```

## Ús als Executors

```javascript
// Pattern comú a tots els executors

async function executeIntent(intent, documentContext, options = {}) {
  const { apiKey, signal, provider } = options;

  let response;
  let usage = null;

  if (provider) {
    // Mode BYOK: usar el provider configurat
    const result = await provider.chat(
      [{ role: 'user', content: userPrompt }],
      {
        systemPrompt,
        temperature: 0.3,
        maxTokens: 4096,
        signal,
      }
    );
    response = result.content;
    usage = result.usage;
  } else {
    // Fallback: Gemini central (legacy)
    response = await callGeminiDirect(systemPrompt, userPrompt, apiKey, signal);
  }

  return {
    // ... resultat
    _meta: {
      provider: provider?.constructor?.PROVIDER_ID || 'gemini',
      model: provider?.model || 'gemini-2.0-flash-001',
      tokens: usage,
    },
  };
}
```

## Models Disponibles per Proveïdor

### Gemini
| Model ID | Descripció | Context | Velocitat |
|----------|------------|---------|-----------|
| gemini-2.0-flash | Flash 2.0 (Recomanat) | 1M | Molt ràpid |
| gemini-1.5-pro | Pro 1.5 | 2M | Mitjà |
| gemini-1.5-flash | Flash 1.5 | 1M | Ràpid |

### OpenAI
| Model ID | Descripció | Context | Velocitat |
|----------|------------|---------|-----------|
| gpt-4o | Més potent | 128K | Mitjà |
| gpt-4o-mini | Recomanat | 128K | Ràpid |
| gpt-4-turbo | Turbo | 128K | Mitjà |

### Claude
| Model ID | Descripció | Context | Velocitat |
|----------|------------|---------|-----------|
| claude-sonnet-4-20250514 | Sonnet 4 (Recomanat) | 200K | Mitjà |
| claude-3-5-sonnet-20241022 | Sonnet 3.5 | 200K | Mitjà |
| claude-3-5-haiku-20241022 | Haiku 3.5 (Ràpid) | 200K | Ràpid |

### Mistral
| Model ID | Descripció | Context | Velocitat |
|----------|------------|---------|-----------|
| mistral-large-latest | Large | 128K | Mitjà |
| mistral-small-latest | Small (Recomanat) | 128K | Ràpid |
| codestral-latest | Per codi | 32K | Ràpid |

### Groq
| Model ID | Descripció | Context | Velocitat |
|----------|------------|---------|-----------|
| llama-3.3-70b-versatile | Llama 3.3 70B | 128K | Molt ràpid |
| llama-3.1-8b-instant | Llama 3.1 8B | 128K | Ultraràpid |
| mixtral-8x7b-32768 | Mixtral | 32K | Molt ràpid |

## Afegir un Nou Proveïdor

1. Crear `worker/multiagent/providers/newprovider.js`:

```javascript
import { BaseProvider } from './base.js';

export class NewProvider extends BaseProvider {
  static PROVIDER_ID = 'newprovider';
  static DEFAULT_MODEL = 'model-name';

  async chat(messages, options = {}) {
    const { systemPrompt, temperature, maxTokens, signal } = options;

    // Implementar crida API
    const response = await fetch('https://api.newprovider.com/...', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: this.formatMessages(messages, systemPrompt),
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    });

    const data = await response.json();
    return this.formatResponse(data.content, data.usage);
  }
}
```

2. Registrar a `providers/index.js`:

```javascript
import { NewProvider } from './newprovider.js';

const PROVIDERS = {
  // ...existents
  newprovider: NewProvider,
};
```

3. Afegir a `ApiKeyManager.gs`:

```javascript
const PROVIDERS = {
  // ...existents
  newprovider: {
    name: 'New Provider',
    defaultModel: 'model-name',
    models: {
      'model-name': 'Model Name (Recomanat)',
    }
  }
};
```
