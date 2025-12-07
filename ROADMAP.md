# Roadmap

Pla de desenvolupament de Docmile - "Lovable for Google Docs"

---

## Visió

Construir el **motor d'enginyeria documental** més potent, aplicant els mateixos patrons arquitectònics que fan únics a Cursor, Aider i Lovable.

### Els 3 Pilars

```
1. CONTEXT ENGINE     →  Entendre el document (estructura, entitats, selecció)
2. RUNTIME            →  Aplicar canvis (atomic ops, preview, undo)
3. FEEDBACK LOOP      →  Validar i corregir (retry, user confirm, references)
```

---

## Estat Actual: v6.9

```
████████████████████████████████████████ 100%

✅ Motor d'Enginyeria Documental (System Prompt v6.9)
✅ Chain of Thought obligatori
✅ Shadow Validator amb Retry Loop
✅ Mode Selector (Edit/Xat)
✅ Atomic Operations (UPDATE_BY_ID)
✅ Smart Selection Context (v5.4) - ⟦SEL⟧ markers
✅ Document References (v6.7) - icones 👁️ clicables
✅ Reference Highlighting (v6.7) - ressaltat de colors
✅ Prompts Professionals (v6.9) - receptes millorades
✅ Multimodal AI (v6.0) - anàlisi d'imatges
✅ Table Support (v6.0) - lectura Markdown
✅ Knowledge Library (v5.1) - fitxers compartits
✅ Chat History (v5.0) - converses persistents
✅ Receipts/Macros (v5.3) - 5 carpetes, 17 receptes
✅ Timeline d'edicions (v6.6)
✅ Event Sourcing (edit_events)
✅ Context Engine (DocScanner + Skeleton)
✅ Auto-Structure (Visual → H2)
✅ Banned Expressions
✅ Dark/Light Theme
✅ File Upload amb validació (v6.5)
✅ Navegació Receptes (v6.9) - botó tornar enrere
```

---

## Versions Completades

### v6.9 - Professional Prompts & UX (2024-12-07)

- **Prompts Professionals**: Totes les receptes millorades amb instruccions específiques
- **Nova recepta "Clarificar"**: Reorganitza idees, explicita connexions, elimina ambigüitats
- **Navegació Receptes**: Botó tornar enrere a l'esquerra del camp de cerca
- **Fix icones receptes**: `addBubbleHtml` per renderitzar correctament
- **Fix landing receptes**: S'amaga quan s'executa una recepta
- **Política privacitat actualitzada**: Conversation History i Knowledge Library documentats

### v6.8 - UI Refinements (2024-12-06)

- Sticky bottom bar amb botons "Añadir" i "Borrar" al panel de Receptes
- Millores d'interfície i consistència

### v6.7 - Document References (2024-12-05)

- **References Vives**: mencions al xat enllaçen a seccions del document
- **Reference Highlighting**: ressaltat de seccions amb colors (groc, taronja, blau, lila)
- Mode REFERENCE_HIGHLIGHT per anàlisi visual
- Icones 👁️ clicables per navegar al document

### v6.6 - Timeline & Drawer (2024-12-04)

- Timeline visual d'edicions amb preview
- Drawer de converses amb agrupació per data
- Cerca de converses anteriors

### v6.5 - File Upload Security (2024-12-03)

- Validació triple: MIME type, extensió, mida
- Gestió d'errors millorada
- Suport PDFs i imatges

### v6.0 - Multimodal & Tables (2024-12-02)

- Suport Gemini 2.0 Flash (multimodal)
- Anàlisi d'imatges integrada
- Lectura de taules en format Markdown

### v5.4 - Smart Selection (2024-12-01)

- Context expandit ±3 paràgrafs al voltant de selecció
- Marcador ⟦SEL⟧ per identificar text seleccionat
- IA interpreta intel·ligentment pregunta vs edició

### v5.3 - Receipts Panel (2024-11-30)

- Panel dedicat per receptes/macros
- Gestió de custom actions

### v5.1 - Knowledge Library (2024-11-28)

- Biblioteca de fitxers compartida entre documents
- Gestió via Gemini File API

### v5.0 - Conversations (2024-11-25)

- Historial de converses persistent
- Auto-save amb debounce
- Pinning de converses

### v3.1 - Shadow Validator (2024-11-20)

- Time Budget (25s safety cutoff)
- Graceful Degradation amb `_meta`
- Retry Feedback específic per error

### v3.0 - Event Sourcing (2024-11-18)

- Taula `edit_events` a Supabase
- Historial complet de canvis
- Undo de qualsevol edició

### v2.9 - Context Engine (2024-11-15)

- DocScanner amb extracció d'estructura
- Document Skeleton
- Entity Extraction

---

## Pròximes Versions

### v7.0 - Preview Mode (Shadow State)

**Objectiu:** Mostrar canvis abans d'aplicar.

**Inspiració:** Cursor Shadow Workspace

```
Prioritat: 🔴 ALTA
Complexitat: Mitjana-Alta
Impacte: Alt (user confidence, control)
```

| Feature | Descripció |
|---------|------------|
| Shadow State | Guardar canvis proposats sense aplicar |
| Visual Diff | Mostrar - (vermell) / + (verd) |
| Approve/Reject | Botons per acceptar o rebutjar |
| Modify Before Apply | Editar proposta abans d'aplicar |
| Batch Preview | Múltiples canvis en una preview |

### v7.1 - Google Workspace Marketplace

**Objectiu:** Publicació oficial al Marketplace.

```
Prioritat: 🔴 ALTA
Complexitat: Mitjana
Impacte: Alt (distribució, visibilitat)
```

| Feature | Descripció |
|---------|------------|
| OAuth Consent Screen | Configuració GCP |
| Screenshots | 5 captures 1280x800 |
| Store Listing | Descripció, icones, categories |
| Review Process | Aprovació Google |

### v7.2 - Advanced Collaboration

**Objectiu:** Suport multi-usuari.

```
Prioritat: 🟡 MITJANA
Complexitat: Alta
Impacte: Mitjà-Alt
```

| Feature | Descripció |
|---------|------------|
| Conflict Detection | Detectar edicions simultànies |
| Edit Locking | Bloqueig temporal de seccions |
| Team Library | Biblioteca compartida per equip |

---

## Futures Direccions (v8.x+)

### Synonym Memory
```
Prioritat: 🟡 MITJANA
Descripció: Recordar paraules rebutjades per no tornar-les a proposar
```

### Multi-Document Support
```
Prioritat: 🟢 BAIXA
Descripció: Treballar amb múltiples docs (referències creuades)
```

### MCP Integration
```
Prioritat: 🟢 BAIXA
Descripció: Model Context Protocol per extensibilitat
```

### Voice Input
```
Prioritat: 🟢 BAIXA
Descripció: Instruccions per veu (Web Speech API)
```

### Templates Library
```
Prioritat: 🟡 MITJANA
Descripció: Biblioteca de plantilles predefinides per tipus de document
```

### AI Suggestions
```
Prioritat: 🟡 MITJANA
Descripció: Suggeriments proactius de millora sense instrucció explícita
```

---

## Timeline

```
2024-Q4 (Nov-Dec)
├── v2.9  ✅ Context Engine (DocScanner + Skeleton)
├── v3.0  ✅ Event Sourcing (edit_events)
├── v3.1  ✅ Shadow Validator
├── v5.0  ✅ Conversations
├── v5.1  ✅ Knowledge Library
├── v5.3  ✅ Receipts Panel
├── v5.4  ✅ Smart Selection Context
├── v6.0  ✅ Multimodal & Tables
├── v6.5  ✅ File Upload Security
├── v6.6  ✅ Timeline & Drawer
├── v6.7  ✅ Document References
└── v6.8  ✅ UI Refinements

2025-Q1 (Jan-Mar)
├── v7.0  ⏳ Preview Mode (Visual Diff)
└── v7.1  ⏳ Google Workspace Marketplace

2025-Q2+
├── v7.2  ⏳ Advanced Collaboration
└── v8.x  ⏳ Future features
```

---

## Mètriques d'Èxit

| Mètrica | Target v7.0 |
|---------|-------------|
| Temps resposta | < 3s |
| Taxa d'èxit JSON | > 98% |
| Undo success rate | > 99% |
| User satisfaction | > 4.5/5 |
| Docs > 10 pàgines | Funciona sense degradació |
| Selection accuracy | > 95% (amb Smart Selection) |

---

## Contribuir al Roadmap

Si tens idees o prioritats diferents:

1. Obre un Issue amb etiqueta `roadmap`
2. Descriu el problema que resol
3. Proposa solució (si en tens)
4. El mantindrem prioritzat segons impacte/esforç

---

*Última actualització: 2024-12-06 (v6.8)*
