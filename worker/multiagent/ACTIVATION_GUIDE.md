# Multi-Agent System v14.8 - Documentació Tècnica

## Visió General

El sistema multi-agent és l'arquitectura central de Docmile per a la classificació d'intents i execució de tasques. Proporciona:

- **Classificació semàntica** amb Gemini 3 Flash Preview
- **Cache de dos nivells** (L1 sessió + L2 semàntic)
- **Circuit breaker** per protecció d'errors
- **Sessions** amb historial de conversa (Cloudflare KV)
- **Fast paths** per casos trivials (Gate0)
- **Executors especialitzats** per cada mode

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                     PIPELINE MULTI-AGENT                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  INPUT                                                           │
│    │                                                             │
│    ▼                                                             │
│  ┌────────────┐                                                  │
│  │ SANITIZER  │  Normalitza input, detecta idioma                │
│  └─────┬──────┘                                                  │
│        ▼                                                         │
│  ┌────────────┐                                                  │
│  │   GATE0    │  Fast paths: "hola", "gràcies" (< 50ms)         │
│  └─────┬──────┘                                                  │
│        ▼                                                         │
│  ┌────────────┐                                                  │
│  │   CACHE    │  L1 (exact) + L2 (semàntic via embeddings)      │
│  └─────┬──────┘                                                  │
│        ▼                                                         │
│  ┌────────────┐                                                  │
│  │ CLASSIFIER │  Gemini 3 Flash → output_target + mode          │
│  └─────┬──────┘                                                  │
│        ▼                                                         │
│  ┌────────────┐                                                  │
│  │   ROUTER   │  Decideix executor o clarificació               │
│  └─────┬──────┘                                                  │
│        ▼                                                         │
│  ┌────────────┐                                                  │
│  │  EXECUTOR  │  Chat / Highlight / Update / Rewrite            │
│  └─────┬──────┘                                                  │
│        ▼                                                         │
│  OUTPUT { response, highlights?, changes?, _meta }               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Estructura de Fitxers

```
worker/multiagent/
├── index.js           # Exports principals
├── pipeline.js        # Pipeline orquestrador
├── classifier.js      # Classificador IA (Gemini)
├── router.js          # Router d'intents
├── config.js          # Configuració centralitzada
├── types.js           # Enums i tipus JSDoc
├── sanitizer.js       # Normalització d'input
├── gate0.js           # Fast paths
├── session.js         # Sessions (Cloudflare KV)
├── cache.js           # Cache L1+L2
├── context.js         # Windowing de document
├── validator.js       # Validació de sortides
├── circuitbreaker.js  # Protecció d'errors
├── telemetry.js       # Logging i mètriques
├── integration.js     # Integració amb worker.js
├── executors/
│   ├── index.js       # Registry d'executors
│   ├── unified.js     # Executor unificat (v14.0)
│   ├── chat.js        # CHAT_ONLY
│   ├── highlight.js   # REFERENCE_HIGHLIGHT
│   ├── update.js      # UPDATE_BY_ID
│   └── rewrite.js     # REWRITE
└── providers/
    ├── index.js       # Factory de proveïdors
    ├── base.js        # Classe base
    ├── gemini.js      # Google Gemini
    ├── openai.js      # OpenAI
    ├── claude.js      # Anthropic Claude
    ├── mistral.js     # Mistral
    └── groq.js        # Groq
```

---

## Configuració (config.js)

### Models d'IA

```javascript
const API = {
  gemini: {
    classifier_model: 'gemini-3-flash-preview',
    model_highlight: 'gemini-3-flash-preview',
    model_update: 'gemini-3-flash-preview',
    model_rewrite: 'gemini-3-flash-preview',
    model_chat: 'gemini-3-flash-preview',
    embedding_model: 'text-embedding-004',
    base_url: 'https://generativelanguage.googleapis.com/v1beta',
  }
};
```

### Thresholds de Confiança

| Mode | Threshold |
|------|-----------|
| CHAT_ONLY | 0.60 |
| REFERENCE_HIGHLIGHT | 0.70 |
| UPDATE_BY_ID | 0.80 |
| REWRITE | 0.85 |

### Timeouts

| Operació | Timeout |
|----------|---------|
| Classifier | 20s |
| Executor (fast) | 10s |
| Executor (thinking) | 25s |
| Pipeline total | 50s |

### Feature Flags

```javascript
const FEATURE_FLAGS = {
  enable_new_pipeline: true,
  enable_semantic_cache: true,
  enable_circuit_breaker: true,
  enable_session_state: true,
  enable_gate0_fast_paths: true,
};
```

---

## Executors

### ChatExecutor (chat.js)
- Mode: `CHAT_ONLY`
- Funció: Respostes conversacionals
- No modifica document

### HighlightExecutor (highlight.js)
- Mode: `REFERENCE_HIGHLIGHT`
- Funció: Trobar i marcar seccions
- Colors: info, error, suggestion, success

### UpdateExecutor (update.js)
- Mode: `UPDATE_BY_ID`
- Funció: Edicions quirúrgiques per paràgraf
- Validació d'abast (v14.6)

### RewriteExecutor (rewrite.js)
- Mode: `REWRITE`
- Funció: Generar contingut nou
- Preview abans d'aplicar

### UnifiedExecutor (unified.js)
- Mode: Tots
- Funció: Executor consolidat (v14.0)
- Format JSON estructurat

---

## Cache

### L1 Cache (In-Memory)

```javascript
{
  key: hash(instruction),
  value: response,
  ttl: 'session'
}
```

### L2 Cache (Semàntic)

```javascript
{
  key: hash(instruction + document),
  embedding: vector[768],
  value: response,
  ttl: '7 days',
  similarity_threshold: 0.92
}
```

---

## Sessions (Cloudflare KV)

```javascript
{
  sessionId: "uuid",
  conversation: {
    turns: [
      { role: "user", content: "...", timestamp: "..." },
      { role: "assistant", content: "...", timestamp: "..." }
    ],
    mentioned_paragraphs: [1, 3, 5],
    last_mode: "edit"
  },
  pending_intent: {
    intent: {...},
    created_at: timestamp,
    clarification_asked: false
  }
}
```

**TTL:**
- Sessió: 30 minuts (sliding window)
- Pending intent: 5 minuts

---

## Integració amb worker.js

```javascript
import { tryNewPipeline } from './multiagent/index.js';

async function handleChat(body, env, corsHeaders) {
  const result = await tryNewPipeline(body, env);

  if (result) {
    return new Response(JSON.stringify({
      status: "ok",
      ...result,
      _multiagent: result._multiagent,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  // Fallback a pipeline legacy si cal
}
```

---

## Telemetria

Cada resposta inclou `_meta`:

```json
{
  "_meta": {
    "classifier_confidence": 0.92,
    "classifier_mode": "UPDATE_BY_ID",
    "execution_time_ms": 2145,
    "cache_hit": false,
    "gate0_matched": false,
    "session_turns": 3
  }
}
```

---

## Validació d'Abast (v14.6)

El sistema valida que només es modifiquen paràgrafs seleccionats:

1. Code.gs marca selecció amb `⟦SEL⟧`
2. integration.js detecta paràgrafs amb marcador
3. Executor valida `para_id` contra llista de seleccionats
4. Rebutja canvis fora de scope

---

## Troubleshooting

### El classifier no respon
1. Verificar `GEMINI_API_KEY`
2. Comprovar circuit breaker
3. Revisar telemetria per timeouts

### Modes incorrectes
1. Revisar thresholds a config.js
2. Ajustar CLASSIFIER_SYSTEM_PROMPT
3. Verificar confidence scores

### Cache no funciona
1. Verificar feature flags
2. Comprovar `documentId`
3. Revisar logs de cache

---

## Monitorització

### Circuit Breaker

```javascript
import { getState } from './circuitbreaker.js';
console.log(getState());
// { status: 'CLOSED', failure_count: 0 }
```

### Mètriques

- Cache hit rate
- Classification accuracy
- Execution time distribution
- Error rates per executor

---

*Última actualització: 2025-12-21 (v14.8)*
