# Arquitectura Tècnica - Docmile v6.8

## Visió General

Docmile és un **Motor d'Enginyeria Documental** que opera com a sidebar dins de Google Docs, permetent edicions intel·ligents de documents mitjançant instruccions en llenguatge natural.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USUARI                                         │
│                             │                                            │
│                             ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│                    GOOGLE DOCS + SIDEBAR                          │   │
│  │  ┌─────────────────┐      ┌─────────────────────────────────┐    │   │
│  │  │   Sidebar.html  │◄────►│         Code.gs                 │    │   │
│  │  │   (UI/UX)       │      │   (Apps Script Backend)         │    │   │
│  │  └─────────────────┘      └──────────────┬──────────────────┘    │   │
│  └──────────────────────────────────────────┼───────────────────────┘   │
│                                              │ HTTPS                     │
│                                              ▼                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    CLOUDFLARE WORKER (v6.8)                       │   │
│  │                         worker.js                                 │   │
│  │  ┌─────────────────┐      ┌─────────────────────────────────┐    │   │
│  │  │  System Prompt  │      │      Business Logic             │    │   │
│  │  │  (v6.8 Engine)  │      │  • Shadow Validator             │    │   │
│  │  │                 │      │  • Smart Selection Handler      │    │   │
│  │  │                 │      │  • Document References          │    │   │
│  │  └─────────────────┘      │  • Multimodal Support           │    │   │
│  │                           └──────────────┬──────────────────┘    │   │
│  └──────────────────────────────────────────┼───────────────────────┘   │
│                              ┌──────────────┴──────────────┐             │
│                              ▼                              ▼             │
│                   ┌─────────────────┐          ┌─────────────────┐       │
│                   │  GEMINI 2.0     │          │   SUPABASE      │       │
│                   │  Flash API      │          │   PostgreSQL    │       │
│                   │  (Multimodal)   │          │                 │       │
│                   └─────────────────┘          └─────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Sidebar.html (Frontend)

**Ubicació:** `docs-addon/Sidebar.html`

El frontend és una pàgina HTML injectada com a sidebar a Google Docs.

#### Responsabilitats:
- UI de xat amb historial de converses
- Mode Selector (Edit/Xat)
- Gestió de Receipts (macros)
- Configuració (tema, preferències)
- Indicador de selecció activa amb preview
- Document References (icones 👁️ clicables)
- Timeline d'edicions
- Comunicació amb Code.gs via `google.script.run`

#### Estructura:
```
Sidebar.html + Styles.html
├── <style> - CSS (temes, components, animacions)
├── <div id="app">
│   ├── #header - Logo + Chat Header
│   ├── #conversations-drawer - Historial converses
│   ├── #chat-panel - Xat principal
│   │   ├── #chatHistory - Missatges
│   │   ├── #selection-indicator - Preview selecció
│   │   └── #input-area - Input + Mode Selector
│   ├── #timeline-panel - Historial edicions
│   ├── #recipes-panel - Receptes/Macros
│   └── #settings-panel - Configuració
└── <script> - Lògica JS
    ├── Mode management
    ├── Selection polling (400ms)
    ├── sendMessage()
    ├── Document References handler
    └── Conversation management
```

---

### 2. Code.gs (Apps Script Backend)

**Ubicació:** `docs-addon/Code.gs`

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

### 3. Worker.js (Cloudflare Worker v6.8)

**Ubicació:** `worker/worker.js`

Backend serverless que processa les peticions i comunica amb Gemini.

#### Responsabilitats:
- System Prompt v6.8 amb Smart Selection Handling
- Validació de llicències (via Supabase)
- Crida a Gemini API (incloent multimodal)
- Shadow Validator amb retry loop
- Mode Enforcement (edit/chat)
- Document References generator
- Reference Highlighting support

#### Modes de Resposta:

| Mode | Descripció | Quan s'usa |
|------|------------|------------|
| `UPDATE_BY_ID` | Edita paràgraf específic | Modificacions puntuals |
| `REWRITE` | Reescriu text complet | Generació nova |
| `CHAT_ONLY` | Només conversa | Consultes, opinions |
| `REFERENCE_HIGHLIGHT` | Ressalta seccions | Anàlisi visual (v6.7) |

#### Smart Selection Handling (v5.4):

El system prompt inclou instruccions per gestionar seleccions:

```
GESTIÓ DE SELECCIÓ INTEL·LIGENT (v5.4)
═══════════════════════════════════════
Quan vegis ⟦SEL⟧:

1. EDICIÓ → Opera sobre ⟦SEL⟧
2. PREGUNTA DOCUMENT → Usa tot el context
3. PREGUNTA SELECCIÓ → Respon basant-se en ⟦SEL⟧
4. AMBIGU → Prioritza context complet
```

---

### 4. Supabase (Database)

#### Taules Principals:

```sql
-- Llicències
licenses (
  id UUID PRIMARY KEY,
  license_key_hash TEXT UNIQUE,
  credits_remaining INTEGER,
  is_active BOOLEAN,
  ...
)

-- Converses (v5.0)
conversations (
  id UUID PRIMARY KEY,
  license_key_hash TEXT,
  doc_id TEXT,
  title TEXT,
  messages JSONB,
  is_pinned BOOLEAN,
  ...
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
  ...
)

-- Knowledge Library (v5.1)
knowledge_library (
  id UUID PRIMARY KEY,
  license_key_hash TEXT,
  file_data TEXT,  -- base64
  gemini_file_uri TEXT,
  gemini_expires_at TIMESTAMPTZ,
  ...
)
```

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
processElement(element, index, ..., isSelected) → {
  content: "{{n}} ⟦SEL⟧ text..." (si seleccionat)
}
     │
     ▼
Worker rep context expandit amb marcadors
     │
     ▼
IA interpreta intel·ligentment pregunta vs selecció
```

### 2. Document References (v6.7)

```
Resposta IA → Conté referències a paràgrafs
     │
     ▼
Frontend detecta referències (regex)
     │
     ▼
Renderitza amb icona 👁️ clicable
     │
     ▼
Clic → google.script.run.highlightParagraph(id)
     │
     ▼
Document ressalta secció en blau (3s)
```

### 3. Shadow Validator

```
Petició → Gemini → validateResponse() → Vàlid? → Retorna
                         ↓ No
                  buildRetryFeedback() → Retry (màx 2)
                         ↓ Timeout?
                  Graceful Degradation → _meta.warning
```

### 4. Event Sourcing

```
Edit → saveEditEvent() → Supabase → getEditHistory() → Timeline UI
                                  → revertEdit() → Restore
```

### 5. Universal Doc Reader

```
Document → captureFullDocument() → {
  header: "Capçalera...",
  body: [paragraphs, lists, tables (Markdown)],
  footer: "Peu de pàgina...",
  footnotes: ["Nota 1...", "Nota 2..."],
  stats: { paragraphs, tables, total_chars }
}
```

---

## Estructura de Fitxers

```
aidoc/
├── docs-addon/
│   ├── Code.gs              # Backend Apps Script principal
│   ├── DocScanner.gs        # Context Engine
│   ├── Sidebar.html         # Frontend HTML/JS
│   ├── Styles.html          # CSS separat
│   └── appsscript.json      # Manifest (OAuth, addOns)
│
├── worker/
│   ├── worker.js            # Cloudflare Worker (v6.8)
│   ├── package.json         # Dependencies
│   └── wrangler.toml        # Config deployment
│
├── supabase/
│   ├── conversations.sql    # Schema converses
│   ├── edit_events.sql      # Schema edicions
│   └── knowledge_library.sql # Schema fitxers
│
├── docs/
│   ├── ARCHITECTURE.md      # Aquest fitxer
│   ├── legal/
│   │   ├── privacy.html     # Política privacitat
│   │   └── terms.html       # Termes servei
│   ├── support.html         # Pàgina suport
│   └── index.html           # Landing page
│
├── assets/
│   ├── logo.svg             # Logo vectorial
│   ├── logo-128.png         # Logo 128x128
│   ├── logo-96.png          # Logo 96x96
│   └── logo-32.png          # Logo 32x32
│
├── README.md                # Documentació principal
├── CHANGELOG.md             # Historial de versions
└── ROADMAP.md               # Plans futurs
```

---

## APIs

### Worker API

**Endpoint:** `POST https://docmile-api.conteucontes.workers.dev`

**Request:**
```json
{
  "user_instruction": "Tradueix al castellà",
  "text": "{{0}} ⟦SEL⟧ Text seleccionat...\n{{1}} Context...",
  "license_key": "xxxxx-xxxxx-xxxxx",
  "has_selection": true,
  "chat_history": [...],
  "user_mode": "edit|chat",
  "doc_skeleton": {...},
  "chat_attachments": [...]
}
```

**Response:**
```json
{
  "status": "ok",
  "data": {
    "mode": "UPDATE_BY_ID",
    "updates": { "0": "Texto traducido..." },
    "change_summary": "He traduït el paràgraf.",
    "thought": "Raonament de la IA...",
    "doc_references": [
      { "para_id": 0, "snippet": "Texto traducido..." }
    ]
  },
  "credits_remaining": 95,
  "event_id": "uuid",
  "_meta": {
    "validation_passed": true,
    "retries": 0,
    "elapsed_ms": 1234
  }
}
```

---

## Seguretat

### Autenticació
- Llicències validades via hash SHA-256
- Crèdits limitats per llicència
- Validació a cada petició

### OAuth Scopes (v5.4)
```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/documents.currentonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.container.ui"
  ]
}
```

### Secrets
| Secret | Ubicació |
|--------|----------|
| `GEMINI_API_KEY` | Cloudflare Worker Secrets |
| `SUPABASE_URL` | Cloudflare Worker Secrets |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloudflare Worker Secrets |
| Llicència usuari | UserProperties (Google) |

---

## Consideracions de Rendiment

| Aspecte | Implementació |
|---------|---------------|
| Latència | Worker edge (Cloudflare) + Gemini Flash |
| Tokens | IDs curts (`{{n}}`) + context expandit (±3) |
| Selecció | Polling cada 400ms amb debounce |
| Retry | Màxim 2 retries amb timeout 25s |

---

## Limitacions Conegudes

1. **Documents molt llargs**: >10.000 paraules poden excedir límits de tokens
2. **Taules**: Només lectura, no editables directament
3. **Imatges**: Placeholders, no contingut visual
4. **Concurrent editing**: No hi ha gestió de conflictes multi-usuari

---

*Última actualització: 2024-12-06 (v6.8)*
