# Arquitectura Tècnica - Docmile v14.8

## Visió General

Docmile és un **Motor d'Enginyeria Documental** que opera com a sidebar dins de Google Docs, permetent edicions intel·ligents de documents mitjançant instruccions en llenguatge natural.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USUARI                                         │
│                             │                                            │
│                             ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    GOOGLE DOCS + SIDEBAR                          │   │
│  │  ┌─────────────────┐      ┌─────────────────────────────────┐    │   │
│  │  │   Sidebar.html  │◄────►│         Code.gs                 │    │   │
│  │  │   (UI/UX)       │      │   (Apps Script Backend)         │    │   │
│  │  └─────────────────┘      └──────────────┬──────────────────┘    │   │
│  └──────────────────────────────────────────┼───────────────────────┘   │
│                                              │ HTTPS                     │
│                                              ▼                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │              CLOUDFLARE WORKER (Multi-Agent v14.8)                │   │
│  │  ┌────────────────────────────────────────────────────────────┐  │   │
│  │  │                  PIPELINE MULTI-AGENT                       │  │   │
│  │  │                                                             │  │   │
│  │  │  ┌────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │  │   │
│  │  │  │Sanitize│→│  Gate0   │→│Classify│→│ Router │→│Execute │ │  │   │
│  │  │  └────────┘ └──────────┘ └────────┘ └────────┘ └────────┘ │  │   │
│  │  │                                                    ↓        │  │   │
│  │  │  ┌──────────────────────────────────────────────────────┐  │  │   │
│  │  │  │            EXECUTORS ESPECIALITZATS                   │  │  │   │
│  │  │  │  ChatExecutor │ HighlightExecutor │ UpdateExecutor   │  │  │   │
│  │  │  │  RewriteExecutor │ UnifiedExecutor                   │  │  │   │
│  │  │  └──────────────────────────────────────────────────────┘  │  │   │
│  │  └────────────────────────────────────────────────────────────┘  │   │
│  │                                                                   │   │
│  │          ┌──────────────┬──────────────┬──────────────┐          │   │
│  │          ▼              ▼              ▼              ▼          │   │
│  │   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────┐    │   │
│  │   │   GEMINI    │ │  SUPABASE   │ │ CLOUDFLARE  │ │ CACHE  │    │   │
│  │   │  3 Flash    │ │  PostgreSQL │ │     KV      │ │ L1+L2  │    │   │
│  │   └─────────────┘ └─────────────┘ └─────────────┘ └────────┘    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Sidebar.html (Frontend)

**Ubicació:** `docs-addon/Sidebar.html` (~8600 línies)

El frontend és una pàgina HTML injectada com a sidebar a Google Docs.

#### Responsabilitats:
- UI de xat amb historial de converses
- Mode Selector (Edit/Xat)
- **Anotacions de canvis** amb Accept/Reject (v14.0)
- **Vista col·lapsada** per canvis grans (v14.4)
- Document References (icones 👁️ clicables)
- Gestió de Receipts (macros)
- Timeline d'edicions
- Indicador de selecció activa amb preview
- Comunicació amb Code.gs via `google.script.run`

#### Estructura:
```
Sidebar.html + Styles.html
├── <style> - CSS (temes, components, animacions)
├── <div id="app">
│   ├── #header - Logo + Chat Header
│   ├── #conversations-drawer - Historial converses
│   ├── #chat-panel - Xat principal
│   │   ├── #chatHistory - Missatges + Anotacions
│   │   ├── #selection-indicator - Preview selecció
│   │   └── #input-area - Input + Mode Selector
│   ├── #timeline-panel - Historial edicions
│   ├── #recipes-panel - Receptes/Macros
│   └── #settings-panel - Configuració
└── <script> - Lògica JS
    ├── renderChangeAnnotation() - Anotacions de canvis
    ├── computeChangeStats() - Estadístiques de canvis
    ├── toggleAnnotationExpand() - Vista col·lapsada
    ├── acceptAnnotation() / rejectAnnotation()
    ├── sendMessage()
    └── Document References handler
```

---

### 2. Code.gs (Apps Script Backend)

**Ubicació:** `docs-addon/Code.gs` (~7200 línies)

Pont entre el frontend i el worker extern. Opera dins del context de Google Docs.

#### Funcions Principals:

| Funció | Descripció |
|--------|------------|
| `onOpen()` | Crea menú "Docmile" |
| `showSidebar()` | Obre el sidebar |
| `processUserCommand()` | Processa instrucció de l'usuari |
| `captureFullDocument()` | Extreu contingut amb context expandit (v5.4) |
| `processElement()` | Processa element amb marcador ⟦SEL⟧ |
| `applyEdit()` | Aplica canvis al document |
| `highlightParagraph()` | Ressalta paràgraf (Document References) |
| `getEditHistory()` | Obté timeline d'edicions |

#### Smart Selection (v5.4):

Quan hi ha selecció, `captureFullDocument()`:
1. Obté TOTS els elements del body
2. Troba índexs dels elements seleccionats
3. Expandeix rang ±3 elements (CONTEXT_WINDOW)
4. Marca elements seleccionats amb `⟦SEL⟧`

```
{{0}} # Títol del Document
{{1}} Context anterior...
{{2}} ⟦SEL⟧ Text seleccionat per l'usuari
{{3}} Context posterior...
```

---

### 3. Worker - Sistema Multi-Agent (v14.8)

**Ubicació:** `worker/` (~10.000 línies total)

Backend serverless amb arquitectura multi-agent.

#### Estructura de Fitxers:

```
worker/
├── worker.js              # Handler principal (4600 línies)
├── wrangler.toml          # Config Cloudflare
└── multiagent/            # Sistema multi-agent
    ├── index.js           # Exports
    ├── pipeline.js        # Pipeline principal
    ├── classifier.js      # Classificador IA
    ├── router.js          # Router d'intents
    ├── config.js          # Configuració
    ├── types.js           # Tipus i enums
    ├── sanitizer.js       # Normalització input
    ├── gate0.js           # Fast paths
    ├── session.js         # Sessions (KV)
    ├── cache.js           # Cache L1+L2
    ├── context.js         # Windowing document
    ├── validator.js       # Validació sortides
    ├── circuitbreaker.js  # Protecció errors
    ├── telemetry.js       # Logging
    ├── integration.js     # Integració legacy
    ├── executors/
    │   ├── index.js       # Registry
    │   ├── unified.js     # Executor unificat (v14.0)
    │   ├── chat.js        # CHAT_ONLY
    │   ├── highlight.js   # REFERENCE_HIGHLIGHT
    │   ├── update.js      # UPDATE_BY_ID
    │   └── rewrite.js     # REWRITE
    └── providers/
        ├── index.js       # Factory
        ├── base.js        # Base class
        ├── gemini.js      # Google Gemini
        ├── openai.js      # OpenAI
        ├── claude.js      # Anthropic
        ├── mistral.js     # Mistral
        └── groq.js        # Groq
```

#### Pipeline Multi-Agent:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PIPELINE FLOW                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  INPUT (instruction + document)                                      │
│     │                                                                │
│     ▼                                                                │
│  ┌──────────────┐                                                    │
│  │  SANITIZER   │  Normalitza, detecta idioma, extreu metadata      │
│  └──────┬───────┘                                                    │
│         ▼                                                            │
│  ┌──────────────┐                                                    │
│  │   GATE0      │  Fast paths: salutacions, agraïments (< 50ms)     │
│  └──────┬───────┘                                                    │
│         ▼                                                            │
│  ┌──────────────┐                                                    │
│  │    CACHE     │  L1 (sessió) + L2 (semàntic amb embeddings)       │
│  └──────┬───────┘                                                    │
│         ▼                                                            │
│  ┌──────────────┐                                                    │
│  │  CLASSIFIER  │  Gemini determina output_target + mode            │
│  │              │  Confidence: 0.60 - 0.85 segons mode              │
│  └──────┬───────┘                                                    │
│         ▼                                                            │
│  ┌──────────────┐                                                    │
│  │   ROUTER     │  Decideix executor o demana clarificació          │
│  └──────┬───────┘                                                    │
│         ▼                                                            │
│  ┌──────────────┐                                                    │
│  │  EXECUTOR    │  ChatExecutor / HighlightExecutor /               │
│  │              │  UpdateExecutor / RewriteExecutor                  │
│  └──────┬───────┘                                                    │
│         ▼                                                            │
│  ┌──────────────┐                                                    │
│  │  VALIDATOR   │  Valida JSON, banned words, length                 │
│  └──────┬───────┘                                                    │
│         ▼                                                            │
│  OUTPUT { response, highlights?, changes?, _meta }                   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### Modes i Thresholds:

| Mode | Threshold | Descripció |
|------|-----------|------------|
| CHAT_ONLY | 0.60 | Respostes conversacionals |
| REFERENCE_HIGHLIGHT | 0.70 | Marcar seccions |
| UPDATE_BY_ID | 0.80 | Editar paràgrafs |
| REWRITE | 0.85 | Generar contingut |

#### Timeouts:

| Operació | Timeout |
|----------|---------|
| Classifier | 20s |
| Executor (fast) | 10s |
| Executor (thinking) | 25s |
| Pipeline total | 50s |

#### Models d'IA:

| Agent | Model |
|-------|-------|
| Classifier | gemini-3-flash-preview |
| Highlight | gemini-3-flash-preview |
| Update | gemini-3-flash-preview |
| Rewrite | gemini-3-flash-preview |
| Chat | gemini-3-flash-preview |
| Embeddings | text-embedding-004 |

---

### 4. Supabase (Database)

#### Taules Principals:

```sql
-- Llicències
licenses (
  id UUID PRIMARY KEY,
  license_key_hash TEXT UNIQUE,
  credits_remaining INTEGER,
  is_active BOOLEAN
)

-- Converses (v5.0)
conversations (
  id UUID PRIMARY KEY,
  license_key_hash TEXT,
  doc_id TEXT,
  title TEXT,
  messages JSONB,
  is_pinned BOOLEAN
)

-- Historial d'edicions (v3.0)
edit_events (
  id UUID PRIMARY KEY,
  license_key_hash TEXT,
  doc_id TEXT,
  event_type TEXT,  -- UPDATE_BY_ID, REWRITE, REVERT
  target_id INTEGER,
  before_text TEXT,
  after_text TEXT,
  reverted_at TIMESTAMPTZ
)

-- Knowledge Library (v5.1)
knowledge_library (
  id UUID PRIMARY KEY,
  license_key_hash TEXT,
  file_name TEXT,
  gemini_file_uri TEXT,
  gemini_expires_at TIMESTAMPTZ
)
```

---

### 5. Cloudflare KV (Sessions)

Sessions persistents amb TTL de 30 minuts:

```javascript
{
  sessionId: "string",
  conversation: {
    turns: [{role, content, timestamp}, ...],  // Últims 5 torns
    mentioned_paragraphs: [1, 3, 5],
    last_mode: "edit|chat"
  },
  pending_intent: {
    intent: {...},
    clarification_asked: false
  }
}
```

---

### 6. Cache (L1 + L2)

#### L1 Cache (In-Memory):
- Clau: instruction_hash
- TTL: Sessió
- Hit: Exact match

#### L2 Cache (Semàntic):
- Clau: instruction_hash + doc_hash
- Backend: Cloudflare KV
- Similaritat: Cosine distance (embeddings)
- TTL: 7 dies
- Threshold: 0.92

---

## Patrons Arquitectònics

### 1. Smart Selection Context (v5.4)

```
Selecció → captureFullDocument() → {
  elementsToProcess: [expandedRange],
  selectedIndices: Set<number>,
  marker: "⟦SEL⟧"
}
     │
     ▼
Worker rep context amb marcadors ⟦SEL⟧
     │
     ▼
Classifier detecta selecció parcial
     │
     ▼
Executor valida scope (v14.6) - NOMÉS modifica seleccionats
```

### 2. Anotacions de Canvis (v14.0)

```
Executor genera changes[]
     │
     ▼
Frontend renderitza anotacions
     │
     ▼
Usuari: Accept / Reject
     │
     ▼
Si Accept → applyEdit() al document
Si Reject → descarta canvi
```

### 3. Vista Col·lapsada (v14.4)

```
computeChangeStats(original, proposed)
     │
     ▼
isLarge = charDiff > 80 || totalChars > 120
     │
     ├─ true  → Mostra estadístiques + botó expandir
     └─ false → Mostra diff directament
```

### 4. Document References (v6.7)

```
Resposta IA → Conté {{N}} referències
     │
     ▼
Frontend detecta patró
     │
     ▼
Renderitza amb icona 👁️
     │
     ▼
Clic → highlightParagraph(N)
```

---

## APIs

### Worker API

**Endpoint:** `POST https://docmile-api.conteucontes.workers.dev/chat`

**Request:**
```json
{
  "user_instruction": "Tradueix al castellà",
  "text": "{{0}} ⟦SEL⟧ Text seleccionat...\n{{1}} Context...",
  "license_key_hash": "sha256...",
  "has_selection": true,
  "user_mode": "edit",
  "chat_history": [...],
  "doc_metadata": {...}
}
```

**Response:**
```json
{
  "status": "ok",
  "response": "He traduït el text.",
  "mode": "UPDATE_BY_ID",
  "highlights": [
    {"para_id": 2, "color": "success", "reason": "Traduït"}
  ],
  "changes": [
    {"para_id": 2, "original": "...", "replacement": "..."}
  ],
  "_meta": {
    "classifier_confidence": 0.92,
    "execution_time_ms": 2145,
    "cache_hit": false
  }
}
```

---

## Seguretat

### Autenticació
- Llicències validades via hash SHA-256
- Crèdits limitats per llicència

### Validació d'Abast (v14.6)
- Només modifica paràgrafs amb `⟦SEL⟧`
- Rebutja canvis fora de scope

### Shadow Validator
- Valida JSON, banned words
- Time budget (25s)
- Graceful degradation

---

## Consideracions de Rendiment

| Aspecte | Implementació |
|---------|---------------|
| Latència | Worker edge + Gemini 3 Flash |
| Tokens | IDs curts + context expandit |
| Cache | L1+L2 → 40-60% menys crides |
| Fast paths | Gate0 → 5-10% sense LLM |

---

## Limitacions Conegudes

1. **Documents molt llargs**: >10.000 paraules poden excedir límits
2. **Taules**: Només lectura
3. **Concurrent editing**: No hi ha gestió multi-usuari

---

*Última actualització: 2025-12-21 (v14.8)*
