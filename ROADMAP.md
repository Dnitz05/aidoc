# Roadmap

Pla de desenvolupament de Docmile - "Lovable for Google Docs"

---

## Visió

Construir el **motor d'enginyeria documental** més potent, aplicant els mateixos patrons arquitectònics que fan únics a Cursor, Aider i Lovable.

### Els 3 Pilars

```
1. CONTEXT ENGINE     →  Entendre el document (estructura, entitats, selecció)
2. RUNTIME            →  Aplicar canvis (atomic ops, anotacions, undo)
3. FEEDBACK LOOP      →  Validar i corregir (accept/reject, references)
```

---

## Estat Actual: v14.8

```
████████████████████████████████████████ 100%

✅ Motor d'Enginyeria Documental
✅ Sistema Multi-Agent (v8.3+) - Classifier + Executors
✅ Gemini 3 Flash Preview
✅ Anotacions de Canvis (v14.0) - Accept/Reject
✅ Vista Col·lapsada (v14.4) - Canvis grans compactats
✅ Validació d'Abast (v14.6) - Només modifica seleccionats
✅ UI Anotacions Millorada (v14.8) - Fons gris, sense hover
✅ Smart Selection Context (v5.4) - ⟦SEL⟧ markers
✅ Document References (v6.7) - icones 👁️ clicables
✅ Reference Highlighting (v6.7) - ressaltat de colors
✅ Cache Semàntic L1+L2 - 40-60% menys crides
✅ Sessions KV - Estat persistent
✅ BYOK - Multi-proveïdor (Gemini, OpenAI, Claude, Mistral, Groq)
✅ Multimodal AI (v6.0) - anàlisi d'imatges
✅ Table Support (v6.0) - lectura Markdown
✅ Knowledge Library (v5.1) - fitxers compartits
✅ Chat History (v5.0) - converses persistents
✅ Receipts/Macros (v5.3) - 5 carpetes, 17 receptes
✅ Timeline d'edicions (v6.6)
✅ Event Sourcing (edit_events)
✅ Context Engine (DocScanner + Skeleton)
✅ Shadow Validator amb Retry Loop
✅ Dark/Light Theme
```

---

## Versions Completades

### v14.x - Anotacions i UX (2025-12)

- **v14.8**: UI anotacions millorada, botó desfer sempre visible, espaiat xat
- **v14.7**: Gemini 3 Flash Preview, etiquetes "Canvi proposat:", espai en diffs
- **v14.6**: Fix validació d'abast de selecció (⟦SEL⟧)
- **v14.5**: Botons d'anotació només icones
- **v14.4**: Vista col·lapsada per canvis grans
- **v14.2**: Auto-clear highlights, respostes netes
- **v14.0**: Sistema d'anotacions Accept/Reject

### v8.3 - Multi-Agent System (2025-08)

- Pipeline complet: Sanitizer → Gate0 → Classifier → Router → Executor
- Executors especialitzats
- Cache L1+L2 semàntic
- Sessions amb Cloudflare KV
- Circuit breaker

### v6.x - References i UX (2024-12)

- **v6.9**: Prompts professionals
- **v6.8**: UI refinements
- **v6.7**: Document References, Reference Highlighting
- **v6.5**: File Upload Security
- **v6.0**: Multimodal, Tables

### v5.x - Persistència (2024-11/12)

- **v5.4**: Smart Selection Context
- **v5.1**: Knowledge Library
- **v5.0**: Chat History persistent

### v3.x - Validació (2024-11)

- **v3.1**: Shadow Validator
- **v3.0**: Event Sourcing

---

## Pròximes Versions

### v15.0 - Streaming Responses

**Objectiu:** Respostes en temps real amb streaming.

```
Prioritat: 🔴 ALTA
Complexitat: Mitjana
Impacte: Alt (UX, perceived performance)
```

| Feature | Descripció |
|---------|------------|
| SSE Streaming | Server-Sent Events per respostes |
| Token-by-token | Mostrar text a mesura que es genera |
| Cancel·lació | Poder aturar generació |
| Progress indicators | Mostrar progrés real |

### v15.1 - Google Workspace Marketplace

**Objectiu:** Publicació oficial al Marketplace.

```
Prioritat: 🔴 ALTA
Complexitat: Mitjana
Impacte: Alt (distribució, visibilitat)
```

| Feature | Descripció |
|---------|------------|
| OAuth Consent | Configuració GCP |
| Screenshots | 5 captures 1280x800 |
| Store Listing | Descripció, icones |
| Review Process | Aprovació Google |

### v16.0 - Advanced Collaboration

**Objectiu:** Suport multi-usuari.

```
Prioritat: 🟡 MITJANA
Complexitat: Alta
Impacte: Mitjà-Alt
```

| Feature | Descripció |
|---------|------------|
| Conflict Detection | Detectar edicions simultànies |
| Edit Locking | Bloqueig temporal |
| Team Library | Biblioteca compartida |
| Shared Recipes | Receptes d'equip |

---

## Futures Direccions (v17.x+)

### Voice Input
```
Prioritat: 🟡 MITJANA
Descripció: Instruccions per veu (Web Speech API)
```

### Templates Library
```
Prioritat: 🟡 MITJANA
Descripció: Plantilles predefinides per tipus de document
```

### AI Suggestions
```
Prioritat: 🟡 MITJANA
Descripció: Suggeriments proactius sense instrucció
```

### MCP Integration
```
Prioritat: 🟢 BAIXA
Descripció: Model Context Protocol per extensibilitat
```

### Multi-Document Support
```
Prioritat: 🟢 BAIXA
Descripció: Treballar amb múltiples docs (referències creuades)
```

---

## Timeline

```
2024-Q4 (Nov-Dec)
├── v2.9  ✅ Context Engine
├── v3.0  ✅ Event Sourcing
├── v3.1  ✅ Shadow Validator
├── v5.0  ✅ Conversations
├── v5.4  ✅ Smart Selection
├── v6.0  ✅ Multimodal & Tables
├── v6.7  ✅ Document References
└── v6.9  ✅ Professional Prompts

2025-Q1-Q3
├── v7.x  ✅ Preparació multi-agent
├── v8.3  ✅ Multi-Agent System complet
├── v9-13 ✅ Refinaments i optimitzacions
└── v14.0 ✅ Anotacions Accept/Reject

2025-Q4 (Actual)
├── v14.4 ✅ Vista col·lapsada
├── v14.6 ✅ Validació scope
├── v14.7 ✅ Gemini 3 Flash Preview
├── v15.0 ⏳ Streaming Responses
└── v15.1 ⏳ Google Marketplace

2026-Q1+
├── v16.0 ⏳ Collaboration
└── v17.x ⏳ Future features
```

---

## Mètriques d'Èxit

| Mètrica | Target |
|---------|--------|
| Temps resposta | < 3s |
| Taxa d'èxit JSON | > 98% |
| Cache hit rate | > 40% |
| Undo success rate | > 99% |
| Selection accuracy | > 95% |
| User satisfaction | > 4.5/5 |

---

## Contribuir al Roadmap

Si tens idees o prioritats diferents:

1. Obre un Issue amb etiqueta `roadmap`
2. Descriu el problema que resol
3. Proposa solució (si en tens)
4. El mantindrem prioritzat segons impacte/esforç

---

*Última actualització: 2025-12-21 (v14.8)*
