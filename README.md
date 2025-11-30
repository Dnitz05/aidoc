# SideCar

**"Lovable for Google Docs"** - Motor d'Enginyeria Documental amb IA

[![Version](https://img.shields.io/badge/version-2.7-blue.svg)]()
[![Platform](https://img.shields.io/badge/platform-Google%20Docs-green.svg)]()
[![AI](https://img.shields.io/badge/AI-Gemini%202.0-orange.svg)]()

---

## Què és SideCar?

SideCar és un assistent d'escriptura intel·ligent integrat a Google Docs que transforma instruccions en llenguatge natural en **operacions atòmiques sobre documents**.

No és un xatbot passiu. És un **Motor d'Enginyeria Documental** inspirat en eines com Cursor, Aider i Lovable.

### Filosofia

```
Cursor/Aider    →  Codi      →  Diffs/AST
SideCar         →  Documents →  Operacions Atòmiques (UPDATE_BY_ID)
```

---

## Features

### Core (v2.7)

| Feature | Descripció |
|---------|------------|
| **Mode Selector** | Auto / Edit / Xat - control total sobre el comportament |
| **Chain of Thought** | La IA raona abans d'actuar (`thought` obligatori) |
| **Atomic Operations** | `UPDATE_BY_ID` - edita paràgrafs específics, no reescriu tot |
| **LastEdit Memory** | Recorda l'últim canvi per "una altra", "no m'agrada" |
| **Revert Button** | Desfer l'últim canvi amb un clic |
| **Retry Loop** | Auto-correcció si el JSON és invàlid |
| **Receipts** | Macros personalitzades (Custom Actions) |
| **Knowledge Files** | Adjunta PDFs/TXT com a context |

### UI/UX

- Sidebar integrat a Google Docs
- Temes Light/Dark
- Indicador de "pensant"
- Historial de xat (12 missatges)

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                      GOOGLE DOCS                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   SIDEBAR (HTML)                     │    │
│  │  • Chat UI          • Mode Selector                  │    │
│  │  • Receipts         • Settings                       │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │                   CODE.GS                            │    │
│  │  • processUserCommand()   • lastEdit Memory          │    │
│  │  • revertLastEdit()       • Receipts CRUD            │    │
│  └──────────────────────┬──────────────────────────────┘    │
└─────────────────────────┼───────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 CLOUDFLARE WORKER                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  • System Prompt v3 ("Motor d'Enginyeria")          │    │
│  │  • Mode Enforcement (auto/edit/chat)                 │    │
│  │  • Retry Loop (JSON validation)                      │    │
│  │  • safeParseJSON + modeMap (robustness)              │    │
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
| AI Model | Google Gemini 2.0 Flash |
| Storage | DocumentProperties / UserProperties |

---

## Instal·lació

### 1. Google Apps Script

1. Obre Google Docs
2. Extensions → Apps Script
3. Copia `docs-addon/Code.gs` i `docs-addon/Sidebar.html`
4. Refresca el document
5. Menú "SideCar" → "Obrir SideCar"

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
| Auto | ✨ | La IA decideix si editar o xatejar |
| Edit | ✏️ | Sempre intenta editar el document |
| Xat | 💬 | Mai edita, només conversa |

### Exemples

```
"Tradueix aquest paràgraf al castellà"     → UPDATE_BY_ID
"Què opines d'aquest text?"                → CHAT_ONLY
"Escriu un email formal de reclamació"     → REWRITE
"Una altra" (després d'un canvi)           → Nova alternativa
```

---

## Documentació

- [CHANGELOG.md](./CHANGELOG.md) - Historial de versions
- [ROADMAP.md](./ROADMAP.md) - Plans futurs
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Arquitectura detallada
- [docs/AI_DEV_GUIDE.md](./docs/AI_DEV_GUIDE.md) - Guia per desenvolupadors

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
