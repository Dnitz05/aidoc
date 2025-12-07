# Docmile

**"Lovable for Google Docs"** - Motor d'Enginyeria Documental amb IA

[![Version](https://img.shields.io/badge/version-6.9-blue.svg)]()
[![Platform](https://img.shields.io/badge/platform-Google%20Docs-green.svg)]()
[![AI](https://img.shields.io/badge/AI-Gemini%202.0-orange.svg)]()

---

## Què és Docmile?

Docmile és un assistent d'escriptura intel·ligent integrat a Google Docs que transforma instruccions en llenguatge natural en **operacions atòmiques sobre documents**.

No és un xatbot passiu. És un **Motor d'Enginyeria Documental** inspirat en eines com Cursor, Aider i Lovable.

### Filosofia

```
Cursor/Aider    →  Codi      →  Diffs/AST
Docmile         →  Documents →  Operacions Atòmiques (UPDATE_BY_ID)
```

---

## Features

### Core (v6.9)

| Feature | Descripció |
|---------|------------|
| **Smart Selection** (v5.4) | Context expandit ±3 paràgrafs amb marcador ⟦SEL⟧ |
| **Document References** (v6.7) | Referències vives que enllacen mencions al xat amb seccions del document |
| **Reference Highlighting** (v6.7) | Ressaltat de seccions amb colors (groc, taronja, blau, lila) |
| **Prompts Professionals** (v6.9) | Receptes amb instruccions detallades i específiques |
| **Table Support** (v6.0) | Lectura i visualització de taules en format Markdown |
| **Multimodal AI** (v6.0) | Suport per anàlisi d'imatges amb Gemini |
| **Knowledge Library** | Biblioteca de fitxers compartida entre documents |
| **Chat History** | Historial de converses persistent amb auto-save i debounce |
| **Shadow Validator** | Sistema immunitari: valida i auto-corregeix respostes |
| **Context Engine** | Entén l'estructura del document (headings, seccions, entitats) |
| **Event Sourcing** | Historial complet d'edicions, revert qualsevol canvi |
| **Auto-Structure** | Converteix títols visuals (negreta) a H2 reals |
| **Banned Expressions** | Paraules/frases que la IA mai usarà |
| **Mode Selector** | Edit / Xat - control total sobre el comportament |
| **Chain of Thought** | La IA raona abans d'actuar (`thought` obligatori) |
| **Atomic Operations** | `UPDATE_BY_ID` - edita paràgrafs específics |
| **Time Budget** | Safety cutoff de 25s per evitar timeouts |
| **Receipts** | Macros personalitzades amb 5 carpetes predefinides |
| **File Upload** (v6.5) | Validació de MIME type, extensió i mida |

### Modes d'Operació

| Mode | Descripció | Output |
|------|------------|--------|
| **CHAT_ONLY** | Preguntes, opinions, anàlisi | Resposta al xat |
| **UPDATE_BY_ID** | Edició quirúrgica de paràgrafs | Canvis atòmics |
| **REWRITE** | Crear contingut nou | Blocs estructurats |
| **REFERENCE_HIGHLIGHT** | Anàlisi visual del document | Ressaltats de colors |

### UI/UX

- Sidebar integrat a Google Docs
- Temes Light/Dark
- Skeleton Preview amb badges de color
- Historial d'edicions navegable (Timeline)
- Indicador de "pensant"
- **Drawer de converses** amb agrupació per data
- Cerca de converses anteriors
- **Indicador de selecció activa** amb preview i comptador de paraules
- **Referències clicables** amb icona 👁️
- Pestanyes: Xat | Edicions | Receptes | Ajustos

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                      GOOGLE DOCS                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   SIDEBAR (HTML)                     │    │
│  │  • Chat UI          • Mode Selector                  │    │
│  │  • Skeleton Preview • Edit History (Timeline)        │    │
│  │  • Receipts         • Settings                       │    │
│  │  • Selection Badge  • Document References            │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │              CODE.GS + DOCSCANNER.GS                 │    │
│  │  • processUserCommand()   • getDocSkeleton()         │    │
│  │  • Event Sourcing         • applyAutoStructure()     │    │
│  │  • Smart Selection (v5.4) • Reference Highlight      │    │
│  └──────────────────────┬──────────────────────────────┘    │
└─────────────────────────┼───────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 CLOUDFLARE WORKER (v6.8)                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           INTELLIGENT CONTEXT ENGINE                  │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │           SHADOW VALIDATOR                   │    │    │
│  │  │  • validateResponse()  • Time Budget (25s)   │    │    │
│  │  │  • buildRetryFeedback() • Graceful Degrad.   │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  │  • System Prompt v6.8 ("Motor d'Enginyeria")        │    │
│  │  • Smart Selection Handling (⟦SEL⟧ markers)         │    │
│  │  • Document References Generator                     │    │
│  │  • Multimodal Support (images)                      │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│            ┌────────────┴────────────┐                      │
│            ▼                         ▼                      │
│     ┌─────────────┐          ┌─────────────┐                │
│     │   GEMINI    │          │  SUPABASE   │                │
│     │   2.0 Flash │          │  PostgreSQL │                │
│     └─────────────┘          └─────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

---

## Stack Tècnic

| Component | Tecnologia |
|-----------|------------|
| Frontend | Google Apps Script (HTML/CSS/JS) |
| Backend | Cloudflare Workers (ES Modules) |
| Database | Supabase (PostgreSQL + RLS) |
| AI Model | Google Gemini 2.0 Flash (Multimodal) |
| Storage | DocumentProperties / UserProperties |
| Deploy | Clasp (GAS) + Wrangler (CF) |

---

## Smart Selection (v5.4)

Quan l'usuari té text seleccionat, Docmile:

1. **Expandeix el context** ±3 paràgrafs al voltant de la selecció
2. **Marca la selecció** amb `⟦SEL⟧` per identificar-la
3. **Interpreta intel·ligentment** la pregunta:
   - Pregunta d'edició → Opera sobre ⟦SEL⟧
   - Pregunta sobre document → Usa tot el context
   - Pregunta sobre selecció → Respon basant-se en ⟦SEL⟧

**Exemple de context enviat:**
```
{{0}} # Títol del Document
{{1}} Introducció...
{{2}} ⟦SEL⟧ Text que l'usuari ha seleccionat
{{3}} Context posterior...
```

---

## Document References (v6.7)

Les **Referències Vives** enllacen mencions al xat amb seccions del document:

- Icona 👁️ clicable al costat de referències
- Clic → Ressalta la secció al document en blau
- Auto-neteja després de 3 segons
- Permet navegació ràpida pel document des del xat

---

## Instal·lació

### 1. Google Apps Script

1. Obre Google Docs
2. Extensions → Apps Script
3. Copia els fitxers de `docs-addon/`:
   - `Code.gs`
   - `DocScanner.gs`
   - `Sidebar.html`
   - `Styles.html`
   - `appsscript.json`
4. Refresca el document
5. Menú "Docmile" → "Obrir Docmile"

### 2. Cloudflare Worker

```bash
cd worker
npm install
npx wrangler deploy
```

### 3. Variables d'entorn (Worker)

```
GEMINI_API_KEY=your_key
SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```

---

## Ús Bàsic

### Modes

| Mode | Icona | Comportament |
|------|-------|--------------|
| Edit | ✏️ | Edita el document (selecció o complet) |
| Xat | 💬 | Mai edita, només conversa |

### Exemples

```
"Tradueix aquest paràgraf al castellà"     → UPDATE_BY_ID
"Què opines d'aquest text?"                → CHAT_ONLY
"Escriu un email formal de reclamació"     → REWRITE
"Analitza la coherència del document"      → REFERENCE_HIGHLIGHT
"Una altra" (després d'un canvi)           → Nova alternativa
```

---

## Documentació

- [CHANGELOG.md](./CHANGELOG.md) - Historial de versions
- [ROADMAP.md](./ROADMAP.md) - Plans futurs
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Arquitectura detallada
- [docs/AI_DEV_GUIDE.md](./docs/AI_DEV_GUIDE.md) - Guia per desenvolupadors

---

## Publicació

Docmile està preparat per publicar a Google Workspace Marketplace:

- ✅ `appsscript.json` amb OAuth scopes i manifest complet
- ✅ Política de privacitat (`docs/legal/privacy.html`)
- ✅ Termes de servei (`docs/legal/terms.html`)
- ✅ Pàgina de suport (`docs/support.html`)
- ✅ Logos optimitzats (128px, 96px, 32px)

---

## Contribuir

1. Fork el repositori
2. Crea una branca (`git checkout -b feature/nova-feature`)
3. Commit (`git commit -m "Feat: descripció"`)
4. Push (`git push origin feature/nova-feature`)
5. Pull Request

---

## Llicència

Propietari - Tots els drets reservats

---

## Crèdits

Desenvolupat amb Claude Code (Anthropic)
