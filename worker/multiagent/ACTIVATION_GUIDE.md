# Multi-Agent System v8.3 - Guia d'Activació

## Visió General

El sistema multi-agent v8.3 és una nova arquitectura per a la classificació d'intents que substitueix el sistema regex anterior. Proporciona:

- Classificació semàntica amb IA (Gemini 2.0 Flash)
- Cache de dos nivells (L1 sessió + L2 semàntic)
- Circuit breaker per protecció d'errors
- Sessions amb historial de conversa
- Fast paths per casos trivials
- Executors especialitzats per mode

## Fases d'Activació

### Fase 1: Shadow Mode (Recomanat primer)

Executa el nou pipeline en paral·lel sense afectar els usuaris:

```javascript
// A worker/multiagent/config.js
const SHADOW_MODE = true;
const USE_NEW_PIPELINE = false;
```

Això logejarà comparacions entre el pipeline legacy i el nou:
```
[Shadow Mode] {"legacy_mode":"CHAT_ONLY","new_mode":"CHAT_ONLY","modes_match":true}
```

### Fase 2: Rollout Gradual

Activa per un percentatge de peticions:

```javascript
// A worker/multiagent/config.js
const FEATURE_FLAGS = {
  enable_new_pipeline_gradual: true,
  gradual_rollout_percentage: 10,  // 10% de peticions
  // ...
};
```

### Fase 3: Activació Completa

```javascript
// A worker/multiagent/config.js
const USE_NEW_PIPELINE = true;
```

## Integració amb worker.js

### Opció A: Integració Mínima (Recomanada)

Afegir al principi de `handleChat`:

```javascript
import { tryNewPipeline, executeShadowMode } from './multiagent/index.js';

async function handleChat(body, env, corsHeaders) {
  // === NOU: Provar pipeline multi-agent ===
  const newPipelineResult = await tryNewPipeline(body, env);
  if (newPipelineResult) {
    // El nou pipeline ha processat la petició
    return new Response(JSON.stringify({
      status: "ok",
      data: newPipelineResult,
      credits_remaining: 0, // TODO: integrar crèdits
      _multiagent: newPipelineResult._multiagent,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
  // === FI NOU ===

  // ... resta del codi legacy ...
}
```

### Opció B: Shadow Mode Només

Per comparar sense canviar comportament:

```javascript
import { executeShadowMode } from './multiagent/index.js';

async function handleChat(body, env, corsHeaders) {
  // ... codi legacy existent ...

  // Al final, abans de retornar:
  const parsedResponse = /* ... resultat legacy ... */;

  // Executar shadow mode en background (no bloqueja)
  executeShadowMode(body, env, parsedResponse);

  return new Response(/* ... */);
}
```

## Configuració

### Feature Flags Disponibles

| Flag | Descripció | Default |
|------|------------|---------|
| `USE_NEW_PIPELINE` | Activa el pipeline nou | `false` |
| `SHADOW_MODE` | Executa en paral·lel per comparar | `false` |
| `enable_semantic_cache` | Cache L2 semàntic | `true` |
| `enable_circuit_breaker` | Protecció d'errors | `true` |
| `enable_gate0_fast_paths` | Fast paths per salutacions | `true` |

### Timeouts

| Operació | Timeout | Configurable a |
|----------|---------|----------------|
| Classifier | 5s | `TIMEOUTS.classifier` |
| Executor | 8s | `TIMEOUTS.executor` |
| Pipeline total | 12s | `TIMEOUTS.total_pipeline` |

### Thresholds de Confiança

| Mode | Threshold |
|------|-----------|
| CHAT_ONLY | 0.60 |
| REFERENCE_HIGHLIGHT | 0.70 |
| UPDATE_BY_ID | 0.80 |
| REWRITE | 0.85 |

## Estructura de Fitxers

```
worker/multiagent/
├── config.js           # Configuració centralitzada
├── types.js            # Enums i tipus JSDoc
├── telemetry.js        # Logging i mètriques
├── sanitizer.js        # Normalització d'input
├── classifier.js       # Classificació IA
├── gate0.js            # Fast paths
├── session.js          # Estat de sessió
├── cache.js            # Cache L1/L2
├── context.js          # Windowing de document
├── validator.js        # Validació de sortides
├── circuitbreaker.js   # Protecció d'errors
├── router.js           # Routing d'intents
├── pipeline.js         # Pipeline principal
├── integration.js      # Integració amb worker.js
├── index.js            # Exports
└── executors/
    ├── chat.js         # CHAT_ONLY executor
    ├── highlight.js    # REFERENCE_HIGHLIGHT executor
    ├── update.js       # UPDATE_BY_ID executor
    ├── rewrite.js      # REWRITE executor
    └── index.js        # Exports executors
```

## Monitorització

### Telemetria

Cada resposta inclou `_telemetry` amb:

```json
{
  "checkpoints": {
    "sanitize_start": 0,
    "sanitize_end": 5,
    "classify_start": 10,
    "classify_end": 150,
    "execute_start": 155,
    "execute_end": 500
  },
  "total_time_ms": 505
}
```

### Circuit Breaker

Monitoritzar l'estat via:

```javascript
import { getState } from './multiagent/circuitbreaker.js';
console.log(getState());
// { status: 'CLOSED', failure_count: 0, last_failure_time: null }
```

## Rollback

Si cal tornar al sistema legacy:

```javascript
// A config.js
const USE_NEW_PIPELINE = false;
const SHADOW_MODE = false;
```

Sense necessitat de canviar codi a worker.js.

## Troubleshooting

### El classifier no respon

1. Verificar `GEMINI_API_KEY` al worker
2. Comprovar logs de circuit breaker
3. Mirar telemetria per timeouts

### Modes incorrectes

1. Revisar dataset de test: `test/dataset.json`
2. Ajustar thresholds a `config.js`
3. Revisar CLASSIFIER_SYSTEM_PROMPT a `classifier.js`

### Cache no funciona

1. Verificar `CACHE.l1.enabled` i `CACHE.l2.enabled`
2. Comprovar que el `documentId` es passa correctament
3. Mirar logs de cache hits/misses

## Pròxims Passos

1. Activar shadow mode i monitoritzar logs
2. Analitzar discrepàncies entre pipelines
3. Ajustar thresholds si cal
4. Activar rollout gradual (10%, 25%, 50%, 100%)
5. Desactivar pipeline legacy un cop estable
