# Arquitectura Multi-Agent v8.3 - Document Aprovat

**Data aprovació**: 2025-12-07
**Revisor**: Gemini (Lead Architect)
**Veredicte**: GO (APROVAT)

## ESTAT D'IMPLEMENTACIÓ: ✅ ACTIU

Totes les fases (0-6) han estat implementades i el sistema està **ACTIU** en producció.

| Fase | Estat | Components |
|------|-------|------------|
| 0 | ✅ Completat | config, types, telemetry, dataset |
| 1 | ✅ Completat | sanitizer, classifier |
| 2 | ✅ Completat | gate0, session, cache |
| 3 | ✅ Completat | validator, context, executors |
| 4 | ✅ Completat | router, pipeline, circuit breaker |
| 5 | ✅ Completat | integration layer, shadow mode |
| 6 | ✅ **ACTIVAT** | Integrat a `worker.js` linia 1967-2034 |

**Estat actual**: Pipeline multi-agent **ACTIU** (`USE_NEW_PIPELINE = true`)

---

## Resum Executiu

Substitució del sistema de classificació d'intents basat en **regex** per una arquitectura **multi-agent amb IA** que permet:

1. Comprensió semàntica de les instruccions dels usuaris
2. Selecció automàtica del mode correcte (CHAT_ONLY, REFERENCE_HIGHLIGHT, UPDATE_BY_ID, REWRITE)
3. Proactivitat en l'ús de REFERENCE_HIGHLIGHT per visualització
4. Safety gates per evitar edicions no desitjades
5. Sistema robust amb fallbacks i circuit breaker

---

## Decisions Tècniques Definitives

| Decisió | Opció Triada | Raó |
|---------|--------------|-----|
| Model Embeddings | Gemini text-embedding-004 | Un sol proveïdor, excel·lent multilingüe (CA/ES) |
| Storage Cache L2 | Cloudflare Vectorize + KV | Natiu CF, cerca vectorial ràpida |
| Streaming vs Buffer | Buffering (v1) | Simplicitat, timeouts protegeixen |
| Fine-tuning | No, Prompt Engineering | Menys manteniment, més flexible |
| SDK Gemini | fetch directe (REST) | Control total timeouts, bundle size mínim |

---

## Mètriques d'Èxit

| Mètrica | Valor Actual | Target v8.3 |
|---------|--------------|-------------|
| Accuracy classificació | ~75% (regex) | >95% |
| Latència P50 | ~600ms | <800ms |
| Latència P99 | ~2000ms | <2500ms |
| Falsos positius edició | ~5% | <1% |
| Cost per 1K requests | $0 (regex) | <$0.10 |

---

## Arquitectura de Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SISTEMA COMPLET v8.3                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 0: INPUT                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │   Sanitizer  │  │   Session    │  │   Document   │                      │
│  │              │  │    State     │  │   Context    │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
│                                                                             │
│  LAYER 1: ROUTING                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │   Gate 0     │  │    Cache     │  │  Classifier  │                      │
│  │  Fast Paths  │  │   (3-tier)   │  │    Agent     │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
│                                                                             │
│  LAYER 2: ORCHESTRATION                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │  Confidence  │  │   Context    │  │   Circuit    │                      │
│  │   Router     │  │  Windowing   │  │   Breaker    │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
│                                                                             │
│  LAYER 3: EXECUTION                                                         │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │ CHAT_ONLY  │ │ REFERENCE_ │ │ UPDATE_BY  │ │  REWRITE   │               │
│  │  Executor  │ │ HIGHLIGHT  │ │ ID Executor│ │  Executor  │               │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘               │
│                                                                             │
│  LAYER 4: OUTPUT                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │  Validator   │  │  Formatter   │  │  Telemetry   │                      │
│  │ Safety Gate  │  │              │  │              │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Fases d'Implementació

### FASE 0: Preparació
- T0.1: Configuració API Gemini
- T0.2: Dataset de test (200 casos)
- T0.3: Infraestructura de logging
- T0.4: Feature flag
- T0.5: Backup sistema actual

### FASE 1: Core Classifier
- T1.1: Definició de tipus
- T1.2: Input Sanitizer
- T1.3: Prompt del Classifier
- T1.4: Classifier Agent
- T1.5: Benchmark inicial

### FASE 2: Cache + Fast Paths
- T2.1: Gate 0 Fast Paths
- T2.2: Session State (pending_intent)
- T2.3: Cache L1 (Session)
- T2.4: Cache L2 (Semantic) + Cloudflare Vectorize
- T2.5: Cache Integration

### FASE 3: Executors
- T3.1: Context Windowing
- T3.2: CHAT_ONLY Executor
- T3.3: REFERENCE_HIGHLIGHT Executor
- T3.4: UPDATE_BY_ID Executor
- T3.5: REWRITE Executor
- T3.6: Clarification Generator

### FASE 4: Orchestration
- T4.1: Confidence Router
- T4.2: Timeout Guards
- T4.3: Circuit Breaker
- T4.4: Output Validator
- T4.5: Telemetry
- T4.6: Main Pipeline

### FASE 5: Integration & Testing
- T5.1: Integració al Worker
- T5.2: Shadow Mode
- T5.3: Regression Testing
- T5.4: Frontend Updates (+ Loading state)
- T5.5: Documentation

### FASE 6: Rollout
- Setmana 1: 10% usuaris
- Setmana 2: 25% usuaris
- Setmana 3: 50% usuaris
- Setmana 4: 100% usuaris

---

## Configuració de Timeouts

```javascript
const TIMEOUTS = {
  classifier: 5000,      // 5s màxim per classificar
  executor: 8000,        // 8s màxim per executar
  total_pipeline: 12000, // 12s màxim total
  api_call: 10000        // 10s timeout al fetch
};
```

---

## Confidence Thresholds

| Mode | Threshold Mínim |
|------|-----------------|
| CHAT_ONLY | 0.60 |
| REFERENCE_HIGHLIGHT | 0.70 |
| UPDATE_BY_ID | 0.80 |
| REWRITE | 0.85 |

---

## Safety Gates

1. **Preguntes no poden editar**: Si `is_question=true` → bloquejar UPDATE/REWRITE
2. **Preview obligatori**: REWRITE sempre mostra preview abans d'aplicar
3. **Snapshot per Undo**: UPDATE sempre retorna `before` per permetre desfer
4. **Circuit Breaker**: 3 errors consecutius → Mode Segur (CHAT_ONLY)
5. **Validator**: Verificació de para_ids, bounds, hallucinations

---

## Riscos i Mitigacions

| Risc | Mitigació |
|------|-----------|
| Prompt quality baixa | Iteració, few-shot, dataset test |
| Latència inacceptable | Cache agressiu, timeouts, fast paths |
| Edicions no desitjades | Safety gates, preview, Undo |
| API externa falla | Circuit breaker, fallback Haiku |
| Regressió funcional | Shadow mode, rollback ràpid |

---

## Checklist Pre-Implementació

- [x] Pla revisat per Gemini
- [x] Decisions tècniques resoltes
- [x] Riscos acceptats
- [ ] API key Gemini disponible
- [ ] Dataset de test creat
- [ ] Logging infrastructure ready
- [ ] Rollback procedure documented

---

## Notes Addicionals de Gemini

1. **Loading State UI**: Afegir estat visual "Analitzant..." al frontend per gestionar la latència IA (600ms-2s) i evitar doble submit.

2. **Cloudflare Vectorize**: Configurar índex abans de codificar T2.4.

---

*Document generat automàticament - Arquitectura Multi-Agent v8.3*
