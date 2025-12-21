# Docmile

**"Lovable for Google Docs"** - Motor d'Enginyeria Documental amb IA

[![Version](https://img.shields.io/badge/version-14.8-blue.svg)]()
[![Platform](https://img.shields.io/badge/platform-Google%20Docs-green.svg)]()
[![AI](https://img.shields.io/badge/AI-Gemini%203%20Flash-orange.svg)]()

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

### Core (v14.8)

| Feature | Descripció |
|---------|------------|
| **Multi-Agent System** (v8.3+) | Pipeline amb Classifier + Executors especialitzats |
| **Gemini 3 Flash** | Model d'IA més recent amb capacitats avançades |
| **Smart Selection** (v5.4) | Context expandit ±3 paràgrafs amb marcador ⟦SEL⟧ |
| **Anotacions de Canvis** (v14.0) | Accept/Reject per cada canvi proposat |
| **Vista Col·lapsada** (v14.4) | Canvis grans es mostren compactats |
| **Document References** (v6.7) | Referències vives amb icona 👁️ clicable |
| **Reference Highlighting** (v6.7) | Ressaltat de seccions amb colors |
| **Validació d'Abast** (v14.6) | Només modifica paràgrafs seleccionats |
| **Cache Semàntic** (v8.3) | L1 (sessió) + L2 (embeddings) |
| **Sessions KV** | Estat persistent amb Cloudflare KV |
| **Table Support** (v6.0) | Lectura de taules en format Markdown |
| **Multimodal AI** (v6.0) | Suport per anàlisi d'imatges |
| **Knowledge Library** | Biblioteca de fitxers compartida |
| **Chat History** | Historial de converses persistent |
| **Shadow Validator** | Valida i auto-corregeix respostes |
| **Context Engine** | Entén l'estructura del document |
| **Event Sourcing** | Historial complet d'edicions, revert qualsevol canvi |
| **BYOK** | Bring Your Own Key (multi-proveïdor) |
| **Mode Selector** | Edit / Xat - control total |

### Modes d'Operació

| Mode | Confiança | Descripció | Output |
|------|-----------|------------|--------|
| **CHAT_ONLY** | 0.60+ | Preguntes, opinions, anàlisi | Resposta al xat |
| **REFERENCE_HIGHLIGHT** | 0.70+ | Anàlisi visual del document | Ressaltats de colors |
| **UPDATE_BY_ID** | 0.80+ | Edició quirúrgica de paràgrafs | Canvis atòmics |
| **REWRITE** | 0.85+ | Crear contingut nou | Blocs estructurats |

### UI/UX

- Sidebar integrat a Google Docs
- Temes Light/Dark
- Anotacions amb botons Accept/Reject
- Vista col·lapsada per canvis grans
- Timeline d'edicions navegable
- Indicador de selecció activa
- Referències clicables amb icona 👁️
- Drawer de converses amb agrupació per data
- Pestanyes: Xat | Edicions | Receptes | Ajustos

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           GOOGLE DOCS                                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    SIDEBAR (HTML/CSS/JS)                         │    │
│  │  • Chat UI           • Anotacions Accept/Reject                  │    │
│  │  • Mode Selector     • Vista col·lapsada canvis                  │    │
│  │  • Selection Badge   • Document References 👁️                    │    │
│  └──────────────────────────┬──────────────────────────────────────┘    │
│                              │                                           │
│  ┌──────────────────────────▼──────────────────────────────────────┐    │
│  │              CODE.GS + DOCSCANNER.GS                             │    │
│  │  • processUserCommand()   • Smart Selection (⟦SEL⟧)              │    │
│  │  • Event Sourcing         • Validació d'Abast                    │    │
│  └──────────────────────────┬──────────────────────────────────────┘    │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                 CLOUDFLARE WORKER (Multi-Agent v14.8)                    │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    PIPELINE MULTI-AGENT                          │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │    │
│  │  │ Gate0    │→ │Classifier│→ │  Router  │→ │ Executor │        │    │
│  │  │Fast Path │  │ Semàntic │  │          │  │          │        │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │    │
│  │                                               ↓                  │    │
│  │  ┌──────────────────────────────────────────────────────────┐   │    │
│  │  │  EXECUTORS ESPECIALITZATS                                 │   │    │
│  │  │  • ChatExecutor      • HighlightExecutor                  │   │    │
│  │  │  • UpdateExecutor    • RewriteExecutor                    │   │    │
│  │  │  • UnifiedExecutor                                        │   │    │
│  │  └──────────────────────────────────────────────────────────┘   │    │
│  └──────────────────────────┬──────────────────────────────────────┘    │
│                              │                                           │
│            ┌─────────────────┼─────────────────┐                        │
│            ▼                 ▼                 ▼                        │
│     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│     │   GEMINI    │  │  SUPABASE   │  │ CLOUDFLARE  │                  │
│     │   3 Flash   │  │  PostgreSQL │  │     KV      │                  │
│     └─────────────┘  └─────────────┘  └─────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Stack Tècnic

| Component | Tecnologia |
|-----------|------------|
| Frontend | Google Apps Script (HTML/CSS/JS) |
| Backend | Cloudflare Workers (ES Modules) |
| Database | Supabase (PostgreSQL + RLS) |
| AI Model | Google Gemini 3 Flash Preview |
| Sessions | Cloudflare KV |
| Cache | L1 (memòria) + L2 (embeddings) |
| Deploy | Clasp (GAS) + Wrangler (CF) |

---

## Sistema Multi-Agent (v8.3+)

### Pipeline

```
Input → Sanitizer → Gate0 → Classifier → Router → Executor → Output
           │          │         │           │          │
           ▼          ▼         ▼           ▼          ▼
        Normalitza  Fast     Gemini      Decideix   Genera
        input      paths    classifica   executor   resposta
```

### Executors

| Executor | Mode | Funció |
|----------|------|--------|
| **ChatExecutor** | CHAT_ONLY | Respostes conversacionals |
| **HighlightExecutor** | REFERENCE_HIGHLIGHT | Marca seccions |
| **UpdateExecutor** | UPDATE_BY_ID | Edita paràgrafs |
| **RewriteExecutor** | REWRITE | Genera contingut nou |
| **UnifiedExecutor** | Tots | Executor unificat |

### Proveïdors d'IA (BYOK)

| Proveïdor | Models |
|-----------|--------|
| **Gemini** | gemini-3-flash-preview, gemini-3-pro |
| **OpenAI** | gpt-4o, o1, gpt-4o-mini |
| **Claude** | claude-sonnet-4-5, claude-opus-4-5 |
| **Mistral** | mistral-small, mistral-large |
| **Groq** | llama-3.3-70b |

---

## Smart Selection (v5.4)

Quan l'usuari té text seleccionat, Docmile:

1. **Expandeix el context** ±3 paràgrafs al voltant de la selecció
2. **Marca la selecció** amb `⟦SEL⟧` per identificar-la
3. **Valida l'abast** (v14.6) - Només modifica paràgrafs seleccionats

**Exemple de context enviat:**
```
{{0}} # Títol del Document
{{1}} Introducció...
{{2}} ⟦SEL⟧ Text que l'usuari ha seleccionat
{{3}} Context posterior...
```

---

## Anotacions de Canvis (v14.0+)

### Característiques

- **Accept/Reject individual** per cada canvi
- **Bulk actions** quan hi ha múltiples canvis
- **Vista col·lapsada** (v14.4) per canvis grans
- **Diff visual**: ~~eliminat~~ afegit
- **Estadístiques**: paraules afegides/eliminades

### Format

```
Canvi proposat:
[Vista diff amb colors]
[Botons: 👁️ Veure | ✓ Acceptar | ✗ Rebutjar]
```

---

## Instal·lació

### 1. Google Apps Script

```bash
cd docs-addon
npx clasp push --force
```

### 2. Cloudflare Worker

```bash
cd worker
CLOUDFLARE_API_TOKEN=xxx npx wrangler deploy
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
```

---

## Documentació

- [CHANGELOG.md](./CHANGELOG.md) - Historial de versions
- [ROADMAP.md](./ROADMAP.md) - Plans futurs
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Arquitectura detallada
- [docs/AI_DEV_GUIDE.md](./docs/AI_DEV_GUIDE.md) - Guia per desenvolupadors

---

## Llicència

Propietari - Tots els drets reservats

---

## Crèdits

Desenvolupat amb Claude Code (Anthropic)

---

*Última actualització: 2025-12-20 (v14.7)*
