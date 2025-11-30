# Roadmap

Pla de desenvolupament de SideCar - "Lovable for Google Docs"

---

## Visió

Construir el **motor d'enginyeria documental** més potent, aplicant els mateixos patrons arquitectònics que fan únics a Cursor, Aider i Lovable.

### Els 3 Pilars (de l'anàlisi Lovable)

```
1. CONTEXT ENGINE     →  Entendre el document (estructura, entitats)
2. RUNTIME            →  Aplicar canvis (atomic ops, preview, undo)
3. FEEDBACK LOOP      →  Validar i corregir (retry, user confirm)
```

---

## Estat Actual: v3.1

```
████████████████████████████████████████ 100%

✅ Motor d'Enginyeria (System Prompt v3)
✅ Chain of Thought obligatori
✅ Retry Loop per JSON invàlid
✅ Mode Selector (Auto/Edit/Xat)
✅ lastEdit Memory + Revert Button
✅ Atomic Operations (UPDATE_BY_ID)
✅ Receipts (Custom Macros)
✅ Dark/Light Theme
✅ Banned Expressions (Memòria Negativa)
✅ Hybrid Validator (Local + LLM)
✅ Context Engine (DocScanner + Skeleton)
✅ Auto-Structure (Visual → H2)
✅ Event Sourcing (edit_events)
✅ Shadow Validator (Time Budget + Graceful Degradation)
```

---

## Pròximes Versions

### v2.9 - Context Engine (Document Map) ✅ COMPLETAT

**Objectiu:** Entendre l'ESTRUCTURA del document, no només el text.

**Inspiració:** Aider Repository Map (AST → Graph → PageRank)

```
Prioritat: 🔴 ALTA
Complexitat: Mitjana
Impacte: Alt (docs llargs, context efficiency)
Estat: ✅ COMPLETAT (2024-11-30)
```

#### Features

| Feature | Descripció | Estat |
|---------|------------|-------|
| Document Structure Extraction | Extreure H1, H2, H3, paràgrafs | ✅ Fet |
| Section Hierarchy | Arbre de seccions amb fills | ✅ Fet |
| Entity Extraction | Dates, imports (€/$), percentatges | ✅ Fet |
| Visual Heading Detection | Negreta, majúscules, numeració | ✅ Fet |
| Auto-Structure | Convertir BOLD_H → H2 | ✅ Fet |

#### Format proposat

```javascript
// En lloc de text pla:
"{{0}} Capítol 1\n{{1}} Lorem ipsum..."

// Enviar estructura:
{
  "document_map": {
    "title": "Informe Anual 2024",
    "sections": [
      { "id": 0, "level": 1, "text": "Introducció", "word_count": 450 },
      { "id": 3, "level": 2, "text": "1.1 Context", "word_count": 200 }
    ],
    "entities": ["Barcelona", "Q3 2024", "Maria García"],
    "total_words": 12500
  },
  "active_section": {
    "id": 3,
    "full_content": "El context actual del mercat..."
  }
}
```

#### Beneficis

- Docs de 50 pàgines → ~500 tokens de context
- IA entén estructura jeràrquica
- Evita "Context Rot" en docs llargs

---

### v3.0 - Event Sourcing (Edit History) ✅ COMPLETAT

**Objectiu:** Historial complet de canvis, no només l'últim.

**Inspiració:** OpenHands Event-Sourced State

```
Prioritat: 🟡 MITJANA
Complexitat: Mitjana
Impacte: Alt (undo chain, analytics, debug)
Estat: ✅ COMPLETAT (2024-11-30)
```

#### Features

| Feature | Descripció | Estat |
|---------|------------|-------|
| Edit Events Table | `edit_events` a Supabase | ✅ Fet |
| Full History | Guardar tots els canvis, no només lastEdit | ✅ Fet |
| Undo Any Change | Desfer qualsevol canvi de l'historial | ✅ Fet |
| Replay/Debug | Reproduir seqüència de canvis | ⏳ Futur |
| Analytics | Estadístiques d'ús per usuari/doc | ⏳ Futur |

#### Schema proposat

```sql
CREATE TABLE edit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id TEXT NOT NULL,
  license_key_hash TEXT NOT NULL,

  -- Event data
  event_type TEXT NOT NULL, -- 'UPDATE_BY_ID', 'REWRITE', 'REVERT'
  target_id INTEGER,
  before_text TEXT,
  after_text TEXT,

  -- AI context
  user_instruction TEXT,
  thought TEXT,
  mode TEXT,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reverted_at TIMESTAMPTZ
);
```

#### UI

```
┌─────────────────────────────────────────┐
│  Historial de Canvis                    │
├─────────────────────────────────────────┤
│  🕐 10:32 - "Traduir al castellà"       │
│     llegendes → leyendas                │
│     [Desfer]                            │
│                                         │
│  🕐 10:30 - "Millorar redacció"         │
│     El text era... → El text resultava..│
│     [Desfer]                            │
│                                         │
│  🕐 10:28 - "Corregir ortografia"       │
│     [Ja desfet]                         │
└─────────────────────────────────────────┘
```

---

### v3.1 - Shadow Validator ✅ COMPLETAT

**Objectiu:** Sistema immunitari que valida i auto-corregeix respostes.

**Inspiració:** "Mai preguntis a una IA el que puguis saber amb un `if`"

```
Prioritat: 🔴 ALTA
Complexitat: Mitjana
Impacte: Alt (qualitat, robustesa, timeouts)
Estat: ✅ COMPLETAT (2024-11-30)
```

#### Features

| Feature | Descripció | Estat |
|---------|------------|-------|
| Unified Validation | `validateResponse()` centralitzada | ✅ Fet |
| Time Budget | 25s safety cutoff (GAS timeout = 30s) | ✅ Fet |
| Graceful Degradation | `_meta` amb warnings/errors | ✅ Fet |
| Retry Feedback | `buildRetryFeedback()` específic per error | ✅ Fet |
| Deterministic First | Regex abans de gastar tokens | ✅ Fet |

---

### v3.2 - Preview Mode (Shadow State) ⏳ PENDENT

**Objectiu:** Mostrar canvis abans d'aplicar.

**Inspiració:** Cursor Shadow Workspace

```
Prioritat: 🟡 MITJANA
Complexitat: Mitjana-Alta
Impacte: Alt (user confidence, control)
```

#### Features

| Feature | Descripció | Estat |
|---------|------------|-------|
| Shadow State | Guardar canvis proposats sense aplicar | ⏳ Pendent |
| Visual Diff | Mostrar - (vermell) / + (verd) | ⏳ Pendent |
| Approve/Reject | Botons per acceptar o rebutjar | ⏳ Pendent |
| Modify Before Apply | Editar proposta abans d'aplicar | ⏳ Pendent |
| Batch Preview | Múltiples canvis en una preview | ⏳ Pendent |

#### UI

```
┌─────────────────────────────────────────┐
│  📝 Canvis Proposats                    │
├─────────────────────────────────────────┤
│                                         │
│  Paràgraf 3:                           │
│  ─────────────────────────────────────  │
│  - les llegendes del món antic          │
│  + les faules ancestrals del món antic  │
│                                         │
│  Paràgraf 7:                           │
│  ─────────────────────────────────────  │
│  - El resultat va ser positiu.          │
│  + El resultat va superar expectatives. │
│                                         │
│  ┌─────────┐ ┌─────────┐ ┌───────────┐ │
│  │ Aplicar │ │Rebutjar │ │ Modificar │ │
│  └─────────┘ └─────────┘ └───────────┘ │
└─────────────────────────────────────────┘
```

---

### v3.3+ - Futures Direccions

#### Synonym Memory (Enhanced)
```
Prioritat: 🟡 MITJANA
Descripció: Recordar paraules rebutjades per no tornar-les a proposar
```

#### Multi-Document Support
```
Prioritat: 🟢 BAIXA
Descripció: Treballar amb múltiples docs (referències creuades)
```

#### MCP Integration
```
Prioritat: 🟢 BAIXA
Descripció: Model Context Protocol per extensibilitat
```

#### Voice Input
```
Prioritat: 🟢 BAIXA
Descripció: Instruccions per veu
```

#### Collaboration Mode
```
Prioritat: 🟢 BAIXA
Descripció: Múltiples usuaris editant amb IA simultàniament
```

---

## Timeline

```
2024-Q4 (Nov-Dec)
├── v2.7  ✅ Document Engineering Engine
├── v2.8  ✅ Banned Expressions + Hybrid Validator
├── v2.9  ✅ Context Engine (DocScanner + Skeleton)
├── v3.0  ✅ Event Sourcing (edit_events)
└── v3.1  ✅ Shadow Validator (Time Budget + Graceful Degradation)

2025-Q1 (Jan-Mar)
├── v3.2  ⏳ Preview Mode (Visual Diff)
└── v4.0  ⏳ GCP Productization (OAuth, Marketplace)

2025-Q2+
└── v4.x  ⏳ Advanced features (MCP, Voice, Collab)
```

---

## Mètriques d'Èxit

| Mètrica | Target v3.0 |
|---------|-------------|
| Temps resposta | < 3s |
| Taxa d'èxit JSON | > 98% |
| Undo success rate | > 99% |
| User satisfaction | > 4.5/5 |
| Docs > 10 pàgines | Funciona sense degradació |

---

## Contribuir al Roadmap

Si tens idees o prioritats diferents:

1. Obre un Issue amb etiqueta `roadmap`
2. Descriu el problema que resol
3. Proposa solució (si en tens)
4. El mantindrem prioritzat segons impacte/esforç

---

*Última actualització: 2024-11-30 (v3.1)*
