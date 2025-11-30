# Arquitectura Tècnica - SideCar

## Visió General

SideCar és un **Motor d'Enginyeria Documental** que opera com a sidebar dins de Google Docs, permetent edicions intel·ligents de documents mitjançant instruccions en llenguatge natural.

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
│  │                    CLOUDFLARE WORKER                              │   │
│  │                         worker.js                                 │   │
│  │  ┌─────────────────┐      ┌─────────────────────────────────┐    │   │
│  │  │  System Prompt  │      │      Business Logic             │    │   │
│  │  │  (v3 Engine)    │      │  • Retry Loop                   │    │   │
│  │  └─────────────────┘      │  • Mode Enforcement             │    │   │
│  │                           │  • JSON Validation              │    │   │
│  │                           └──────────────┬──────────────────┘    │   │
│  └──────────────────────────────────────────┼───────────────────────┘   │
│                              ┌──────────────┴──────────────┐             │
│                              ▼                              ▼             │
│                   ┌─────────────────┐          ┌─────────────────┐       │
│                   │  GEMINI 2.0     │          │   SUPABASE      │       │
│                   │  Flash API      │          │   PostgreSQL    │       │
│                   └─────────────────┘          └─────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Sidebar.html (Frontend)

**Ubicació:** `docs-addon/Sidebar.html`

El frontend és una pàgina HTML injectada com a sidebar a Google Docs.

#### Responsabilitats:
- UI de xat (missatges, input, botons)
- Mode Selector (Auto/Edit/Xat)
- Gestió de Receipts (macros)
- Configuració (tema, preferències)
- Comunicació amb Code.gs via `google.script.run`

#### Estructura:
```
Sidebar.html
├── <style> - CSS (temes, components, animacions)
├── <div id="app">
│   ├── #header - Logo + Tabs
│   ├── #chat-panel - Xat principal
│   │   ├── #messages - Historial
│   │   └── #input-area - Input + Mode Selector
│   ├── #tools-panel - Receipts grid
│   └── #config-panel - Settings
└── <script> - Lògica JS
    ├── Mode management
    ├── sendMessage()
    ├── addBubble()
    ├── revertLastEdit()
    └── Receipts CRUD
```

#### Comunicació amb Backend:
```javascript
google.script.run
  .withSuccessHandler(callback)
  .withFailureHandler(errorHandler)
  .processUserCommand(instruction, chatHistory, userMode);
```

---

### 2. Code.gs (Apps Script Backend)

**Ubicació:** `docs-addon/Code.gs`

Pont entre el frontend i el worker extern. Opera dins del context de Google Docs.

#### Responsabilitats:
- Extracció de contingut del document
- Aplicació de canvis (UPDATE_BY_ID, REWRITE)
- Gestió de lastEdit memory
- Comunicació amb Cloudflare Worker
- Persistència local (DocumentProperties)

#### Funcions Principals:

| Funció | Descripció |
|--------|------------|
| `onOpen()` | Crea menú "SideCar" |
| `showSidebar()` | Obre el sidebar |
| `processUserCommand()` | Processa instrucció de l'usuari |
| `getDocumentContent()` | Extreu contingut amb IDs de paràgraf |
| `applyEdit()` | Aplica canvis al document |
| `revertLastEdit()` | Desfà l'últim canvi |
| `loadLastEdit() / saveLastEdit()` | Gestió memòria d'edició |

#### Format de Document amb IDs:
```
{{0}} Primer paràgraf del document...
{{1}} Segon paràgraf amb més text...
{{2}} Tercer paràgraf que continua...
```

Cada `{{n}}` és un identificador únic per paràgraf que permet operacions atòmiques.

---

### 3. Worker.js (Cloudflare Worker)

**Ubicació:** `worker/worker.js`

Backend serverless que processa les peticions i comunica amb Gemini.

#### Responsabilitats:
- System Prompt v3 (Motor d'Enginyeria)
- Validació de llicències (via Supabase)
- Crida a Gemini API
- Retry Loop per JSON invàlid
- Mode Enforcement (auto/edit/chat)
- Parsing i validació de respostes

#### Flux de Petició:

```
1. Rebre petició POST
       │
       ▼
2. Validar llicència (Supabase)
       │
       ▼
3. Construir System Prompt
   • Mode (auto/edit/chat)
   • Selecció activa?
   • Fitxer adjunt?
   • LastEdit context
       │
       ▼
4. Cridar Gemini API
       │
       ▼
5. Validar JSON response
   ├── OK → Retornar resposta
   └── Error → Retry amb feedback (màx 1)
       │
       ▼
6. Retornar resultat al client
```

#### Modes de Resposta:

| Mode | Descripció | Quan s'usa |
|------|------------|------------|
| `UPDATE_BY_ID` | Edita paràgraf específic | Modificacions puntuals |
| `REWRITE` | Reescriu text complet | Generació nova |
| `CHAT_ONLY` | Només conversa | Consultes, opinions |

---

### 4. Supabase (Database)

#### Taules:

```sql
-- Llicències
license_keys (
  key_hash TEXT PRIMARY KEY,
  email TEXT,
  credits INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ,
  valid_until TIMESTAMPTZ
)

-- Receptes d'usuari
user_receipts (
  id UUID PRIMARY KEY,
  license_key_hash TEXT,
  emoji TEXT,
  name TEXT,
  instruction TEXT,
  created_at TIMESTAMPTZ
)

-- [Futur v2.9] Historial d'events
edit_events (
  id UUID PRIMARY KEY,
  doc_id TEXT,
  license_key_hash TEXT,
  event_type TEXT,
  target_id INTEGER,
  before_text TEXT,
  after_text TEXT,
  user_instruction TEXT,
  thought TEXT,
  created_at TIMESTAMPTZ
)
```

---

## Flux de Dades

### Flux: Instrucció d'Edició

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. USUARI escriu: "Tradueix el paràgraf 3 al castellà"                  │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. SIDEBAR                                                               │
│    • Captura instrucció                                                  │
│    • Afegeix mode (auto/edit/chat)                                       │
│    • Crida: google.script.run.processUserCommand(...)                    │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. CODE.GS                                                               │
│    • Extreu document: "{{0}} text... {{1}} text... {{2}} text..."        │
│    • Extreu selecció activa (si n'hi ha)                                │
│    • Carrega lastEdit memory                                            │
│    • Envia payload al Worker                                            │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. WORKER                                                                │
│    • Valida llicència                                                    │
│    • Construeix prompt amb context                                       │
│    • Crida Gemini API                                                    │
│    • Valida JSON (retry si cal)                                          │
│    • Retorna resposta estructurada                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. GEMINI retorna:                                                       │
│    {                                                                     │
│      "thought": "L'usuari vol traduir. Paràgraf 3 identificat...",      │
│      "mode": "UPDATE_BY_ID",                                             │
│      "id": 3,                                                            │
│      "text": "Las leyendas del mundo antiguo...",                        │
│      "message": "He traduït el paràgraf al castellà."                    │
│    }                                                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. CODE.GS                                                               │
│    • Aplica UPDATE_BY_ID al document real                                │
│    • Guarda lastEdit: {targetId: 3, originalText, currentText}          │
│    • Retorna resultat al Sidebar                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 7. SIDEBAR                                                               │
│    • Mostra missatge: "He traduït el paràgraf al castellà."             │
│    • Mostra badge: "Document modificat" + botó [Desfer]                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Seguretat

### Autenticació
- Llicències validades via hash (no es guarda clau en clar)
- Crèdits limitats per llicència
- Validació a cada petició

### Secrets
| Secret | Ubicació |
|--------|----------|
| `GEMINI_API_KEY` | Cloudflare Worker Secrets |
| `SUPABASE_URL` | Cloudflare Worker Secrets |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloudflare Worker Secrets |
| Llicència usuari | UserProperties (Google) |

### RLS (Row Level Security)
```sql
-- Usuaris només veuen les seves receptes
CREATE POLICY "Users see own receipts"
ON user_receipts FOR SELECT
USING (license_key_hash = current_user_hash());
```

---

## Estructura de Fitxers

```
sidecar/
├── docs-addon/
│   ├── Code.gs              # Backend Apps Script
│   ├── Sidebar.html         # Frontend HTML/CSS/JS
│   └── appsscript.json      # Manifest
│
├── worker/
│   ├── worker.js            # Cloudflare Worker
│   ├── package.json         # Dependencies
│   └── wrangler.toml        # Config deployment
│
├── docs/
│   ├── ARCHITECTURE.md      # Aquest fitxer
│   ├── AI_DEV_GUIDE.md      # Guia per devs
│   └── WORKFLOW.md          # Workflow de treball
│
├── README.md                # Documentació principal
├── CHANGELOG.md             # Historial de versions
└── ROADMAP.md               # Plans futurs
```

---

## APIs

### Worker API

**Endpoint:** `POST /`

**Request:**
```json
{
  "instruction": "Tradueix al castellà",
  "doc_content": "{{0}} Text del document...",
  "license_key": "xxxxx-xxxxx-xxxxx",
  "selection": "text seleccionat (opcional)",
  "chat_history": [...],
  "user_mode": "auto|edit|chat",
  "last_edit": {
    "targetId": 3,
    "originalText": "...",
    "currentText": "..."
  }
}
```

**Response (èxit):**
```json
{
  "mode": "UPDATE_BY_ID",
  "id": 3,
  "text": "Texto traducido...",
  "message": "He traduït el paràgraf.",
  "thought": "Raonament de la IA...",
  "_debug": {
    "retries": 0,
    "thought": "..."
  }
}
```

**Response (error):**
```json
{
  "error": "Invalid license"
}
```

---

## Patrons Arquitectònics

### 1. Atomic Operations
Inspirat en Cursor/Aider. En lloc de reescriure documents sencers, s'utilitzen operacions atòmiques (`UPDATE_BY_ID`) que editen elements específics.

### 2. Chain of Thought
Camp `thought` obligatori en cada resposta. La IA raona abans d'actuar, seguint el protocol:
1. Intenció → Què vol l'usuari?
2. Localització → On afecta?
3. Estratègia → Mínima operació necessària?

### 3. Retry Loop
Auto-correcció per respostes JSON invàlides:
```
Petició → Gemini → JSON invàlid? → Feedback → Retry (1x) → Resposta
```

### 4. Mode Enforcement
El mode seleccionat per l'usuari s'aplica al prompt:
- `auto`: IA decideix
- `edit`: Força edició
- `chat`: Prohibeix edició

---

## Consideracions de Rendiment

| Aspecte | Implementació |
|---------|---------------|
| Latència | Worker edge (Cloudflare) + Gemini Flash (ràpid) |
| Tokens | IDs curts (`{{n}}`) redueixen context |
| Caché | No implementat (cada petició és única) |
| Retry | Màxim 1 retry (evita loops infinits) |

---

## Limitacions Conegudes

1. **Documents molt llargs**: >10.000 paraules poden excedir límits de tokens
2. **Taules complexes**: Suport limitat per estructures tabulars
3. **Imatges**: No s'analitzen imatges incrustades
4. **Concurrent editing**: No hi ha gestió de conflictes multi-usuari

---

## Evolució Futura

Veure [ROADMAP.md](../ROADMAP.md) per plans de:
- v2.8: Document Map (context engine)
- v2.9: Event Sourcing (historial complet)
- v3.0: Preview Mode (shadow state)

---

*Última actualització: 2024-11-30*
