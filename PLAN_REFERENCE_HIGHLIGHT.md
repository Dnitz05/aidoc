# PLA D'IMPLEMENTACIÓ: Subratllat de Referència Interactiu v7.0

## VISIÓ GENERAL

Implementar un sistema on la IA pot respondre **marcant parts del document** i l'usuari pot **fer clic a les referències al xat** per navegar automàticament a la secció destacada.

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   DOCUMENT                          SIDEBAR (XAT)               │
│   ════════                          ═══════════════             │
│                                                                 │
│   Lorem ipsum dolor sit amet,       👤 Detecta repeticions      │
│   consectetur adipiscing elit.                                  │
│                                     🤖 He trobat 3 zones:       │
│   ████████████████████████ ←───────── 🟡 [Paràgraf 5]          │
│   Sed do eiusmod tempor              "important" x4            │
│   incididunt ut labore.               ↳ clic per veure         │
│                                                                 │
│   Ut enim ad minim veniam,          🟠 [Paràgraf 12]           │
│   quis nostrud exercitation.         "clarament" x3            │
│                                                                 │
│   ████████████████████████ ←───────── 🔵 [Paràgraf 18]          │
│   Duis aute irure dolor in           suggeriment millora       │
│   reprehenderit in voluptate.                                   │
│                                     [Netejar Marks]             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## ARQUITECTURA TÈCNICA

### Flux de Dades

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   USUARI     │───▶│   SIDEBAR    │───▶│   WORKER     │───▶│   GEMINI     │
│  "Detecta    │    │   (HTML)     │    │   (CF)       │    │   AI         │
│ repeticions" │    │              │    │              │    │              │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                           │                   │                   │
                           │                   │                   │
                           ▼                   ▼                   ▼
                    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
                    │   CODE.GS    │◀───│   RESPONSE   │◀───│   JSON amb   │
                    │  Aplica      │    │   mode:      │    │   highlights │
                    │  Highlights  │    │   REFERENCE  │    │   + reasons  │
                    └──────────────┘    └──────────────┘    └──────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  GOOGLE DOC  │
                    │  Paràgrafs   │
                    │  colorejats  │
                    └──────────────┘
```

### Components a Modificar

| Component | Fitxer | Responsabilitat |
|-----------|--------|-----------------|
| System Prompt | worker.js | Nou mode REFERENCE_HIGHLIGHT |
| Response Parser | worker.js | Validar array highlights |
| Highlight Handler | Code.gs | Aplicar/netejar colors |
| Scroll Handler | Code.gs | scrollToParagraph() [existent] |
| Chat Renderer | Sidebar.html | Renderitzar refs clicables |
| UI Components | Sidebar.html | Botó netejar, badges colors |
| Styles | Styles.html | CSS per refs i badges |

---

## FASE 1: BACKEND - Nou Mode de Resposta (8h)

### 1.1 System Prompt (worker.js)

**Ubicació:** `buildSystemPrompt()` (~línia 590)

```javascript
// Afegir nou mode al system prompt
const REFERENCE_MODE_PROMPT = `
[MODE REFERÈNCIA] → 'REFERENCE_HIGHLIGHT'
Quan usar: L'usuari demana anàlisi, revisió, o identificar parts del document.
Exemples: "detecta repeticions", "quines parts clarificar", "on estan els arguments"

Acció: Retorna JSON amb:
- mode: "REFERENCE_HIGHLIGHT"
- ai_response: Explicació en llenguatge natural
- highlights: Array de referències amb:
  - para_id: Índex del paràgraf ({{0}}, {{1}}, etc.)
  - color: "yellow" | "orange" | "blue" | "purple"
  - reason: Motiu breu (màx 50 chars)
  - snippet: Fragment del text (màx 30 chars)

IMPORTANT:
- Màxim 5 highlights per resposta
- Usa para_id exactes del document
- NO editis el document, només marca

Exemple resposta:
{
  "thought": "L'usuari vol detectar repeticions...",
  "mode": "REFERENCE_HIGHLIGHT",
  "ai_response": "He trobat 3 zones amb repeticions de paraules:",
  "highlights": [
    {"para_id": 5, "color": "yellow", "reason": "'important' x4", "snippet": "Això és important..."},
    {"para_id": 12, "color": "orange", "reason": "'evident' x3", "snippet": "Resulta evident que..."}
  ]
}
`;
```

### 1.2 Response Validation (worker.js)

**Ubicació:** `validateResponse()` (~línia 823)

```javascript
// Afegir validació pel nou mode
function validateReferenceHighlightResponse(parsed) {
  if (parsed.mode !== 'REFERENCE_HIGHLIGHT') return parsed;

  // Validar estructura
  if (!parsed.highlights || !Array.isArray(parsed.highlights)) {
    parsed.highlights = [];
  }

  // Filtrar highlights invàlids
  parsed.highlights = parsed.highlights
    .filter(h => typeof h.para_id === 'number' && h.para_id >= 0)
    .slice(0, 5)  // Màxim 5
    .map(h => ({
      para_id: h.para_id,
      color: ['yellow', 'orange', 'blue', 'purple'].includes(h.color) ? h.color : 'yellow',
      reason: String(h.reason || '').substring(0, 50),
      snippet: String(h.snippet || '').substring(0, 30)
    }));

  // Si no hi ha highlights vàlids, convertir a CHAT_ONLY
  if (parsed.highlights.length === 0) {
    parsed.mode = 'CHAT_ONLY';
  }

  return parsed;
}
```

### 1.3 Mode Normalization (worker.js)

**Ubicació:** `normalizeMode()` (~línia 998)

```javascript
const modeMap = {
  // Existents...
  'CHAT_ONLY': 'CHAT_ONLY',
  'UPDATE_BY_ID': 'UPDATE_BY_ID',

  // Nous
  'REFERENCE_HIGHLIGHT': 'REFERENCE_HIGHLIGHT',
  'HIGHLIGHT': 'REFERENCE_HIGHLIGHT',
  'REFERENCE': 'REFERENCE_HIGHLIGHT',
  'MARK': 'REFERENCE_HIGHLIGHT',
  'ANALYZE': 'REFERENCE_HIGHLIGHT'
};
```

---

## FASE 2: BACKEND - Handler a Code.gs (12h)

### 2.1 Constants de Colors

**Ubicació:** Després de `PREVIEW_COLORS` (~línia 1679)

```javascript
// Colors per Reference Highlighting
const REFERENCE_COLORS = {
  yellow: '#FFF59D',   // Atenció / Repeticions
  orange: '#FFCC80',   // Problemes d'estil
  blue: '#90CAF9',     // Recomanacions
  purple: '#CE93D8',   // Preguntes / Clarificacions
  clear: null          // Per netejar
};
```

### 2.2 Aplicar Highlights

**Nova funció:**

```javascript
/**
 * Aplica highlights de referència al document
 * @param {Array} highlights - Array de {para_id, color, reason}
 * @param {Object} elementMap - Mapa d'elements {{id} → element}
 * @returns {Object} - {success, applied, errors}
 */
function applyReferenceHighlights(highlights, elementMap) {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const results = { applied: 0, errors: [] };

  // Guardar índexs per poder netejar després
  const highlightedIndices = [];

  for (const hl of highlights) {
    try {
      const element = elementMap[hl.para_id];

      if (!element) {
        results.errors.push(`Paràgraf ${hl.para_id} no trobat`);
        continue;
      }

      // Obtenir objecte text editable
      const textObj = element.editAsText();
      const textLength = textObj.getText().length;

      if (textLength === 0) continue;

      // Aplicar color de fons
      const color = REFERENCE_COLORS[hl.color] || REFERENCE_COLORS.yellow;
      textObj.setBackgroundColor(0, textLength - 1, color);

      highlightedIndices.push(hl.para_id);
      results.applied++;

    } catch (e) {
      results.errors.push(`Error a paràgraf ${hl.para_id}: ${e.message}`);
    }
  }

  // Guardar índexs per netejar
  if (highlightedIndices.length > 0) {
    const props = PropertiesService.getDocumentProperties();
    props.setProperty('referenceHighlights', JSON.stringify(highlightedIndices));
  }

  results.success = results.applied > 0;
  return results;
}
```

### 2.3 Netejar Highlights

```javascript
/**
 * Neteja tots els highlights de referència
 * @returns {Object} - {success, cleared}
 */
function clearReferenceHighlights() {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const props = PropertiesService.getDocumentProperties();

    const savedIndices = props.getProperty('referenceHighlights');
    if (!savedIndices) return { success: true, cleared: 0 };

    const indices = JSON.parse(savedIndices);
    let cleared = 0;

    for (const idx of indices) {
      try {
        if (idx >= 0 && idx < body.getNumChildren()) {
          const element = body.getChild(idx);
          if (element.editAsText) {
            const textObj = element.editAsText();
            const len = textObj.getText().length;
            if (len > 0) {
              textObj.setBackgroundColor(0, len - 1, null);
              cleared++;
            }
          }
        }
      } catch (e) {
        // Ignorar errors individuals
      }
    }

    props.deleteProperty('referenceHighlights');
    return { success: true, cleared };

  } catch (e) {
    return { success: false, error: e.message };
  }
}
```

### 2.4 Scroll a Referència amb Highlight Temporal

```javascript
/**
 * Scroll a un paràgraf i highlight temporal
 * @param {number} paragraphIndex - Índex del paràgraf
 * @param {string} color - Color del highlight
 * @returns {Object} - {success}
 */
function scrollToReference(paragraphIndex, color) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    if (paragraphIndex < 0 || paragraphIndex >= body.getNumChildren()) {
      return { success: false, error: 'Índex fora de rang' };
    }

    const element = body.getChild(paragraphIndex);

    // Aplicar highlight amb color específic
    if (element.editAsText) {
      const textObj = element.editAsText();
      const len = textObj.getText().length;
      if (len > 0) {
        const bgColor = REFERENCE_COLORS[color] || '#FFF59D';
        textObj.setBackgroundColor(0, len - 1, bgColor);
      }
    }

    // Seleccionar per forçar scroll
    const rangeBuilder = doc.newRange();
    rangeBuilder.addElement(element);
    doc.setSelection(rangeBuilder.build());

    return { success: true };

  } catch (e) {
    return { success: false, error: e.message };
  }
}
```

### 2.5 Integració amb processUserCommand

**Modificar `processUserCommand()` per gestionar el nou mode:**

```javascript
// Dins processUserCommand(), després de processar la resposta de l'API
if (aiData.mode === 'REFERENCE_HIGHLIGHT' && aiData.highlights) {
  // Construir mapa d'elements
  const elementMap = buildElementMap(doc.getBody());

  // Aplicar highlights
  const highlightResult = applyReferenceHighlights(aiData.highlights, elementMap);

  return {
    status: 'reference_highlight',
    ai_response: aiData.ai_response,
    highlights: aiData.highlights,
    applied: highlightResult.applied,
    mode: 'reference'
  };
}
```

---

## FASE 3: FRONTEND - Renderització Interactiva (10h)

### 3.1 Nova Funció per Renderitzar Highlights al Xat

**Ubicació:** Sidebar.html, després de `addBubble()`

```javascript
/**
 * Renderitza una resposta amb referències clicables
 * @param {string} aiResponse - Text de resposta
 * @param {Array} highlights - Array de highlights
 */
function addBubbleWithReferences(aiResponse, highlights) {
  const container = document.getElementById('chatHistory');
  const bubble = document.createElement('div');
  bubble.className = 'msg ai';

  // Renderitzar resposta principal amb markdown
  let html = '<div class="md-content">' + renderMarkdown(aiResponse) + '</div>';

  // Afegir secció de referències
  if (highlights && highlights.length > 0) {
    html += '<div class="reference-list">';

    for (const hl of highlights) {
      const colorClass = 'ref-' + (hl.color || 'yellow');
      html += `
        <div class="reference-item ${colorClass}"
             onclick="scrollToDocReference(${hl.para_id}, '${hl.color}')"
             title="Clic per veure al document">
          <span class="ref-badge">${getColorIcon(hl.color)}</span>
          <span class="ref-content">
            <span class="ref-snippet">"${escapeHtml(hl.snippet || '...')}"</span>
            <span class="ref-reason">${escapeHtml(hl.reason)}</span>
          </span>
          <span class="ref-arrow">${icon('chevronRight', 'i--sm')}</span>
        </div>
      `;
    }

    html += '</div>';

    // Botó per netejar tots els highlights
    html += `
      <button class="clear-highlights-btn" onclick="clearAllHighlights()">
        ${icon('x', 'i--sm')} Netejar marcatges
      </button>
    `;
  }

  bubble.innerHTML = html;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

/**
 * Retorna icona segons el color
 */
function getColorIcon(color) {
  const icons = {
    yellow: '🟡',
    orange: '🟠',
    blue: '🔵',
    purple: '🟣'
  };
  return icons[color] || '🟡';
}

/**
 * Escapa HTML per evitar XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
```

### 3.2 Funcions de Scroll i Neteja

```javascript
/**
 * Scroll al document i destacar referència
 * @param {number} paraId - Índex del paràgraf
 * @param {string} color - Color del highlight
 */
function scrollToDocReference(paraId, color) {
  // Feedback visual immediat
  showToast('Navegant al paràgraf...', 'info');

  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast('Paràgraf destacat', 'success');
        // Actualitzar UI per mostrar quin ref està actiu
        updateActiveReference(paraId);
      } else {
        showToast('No s\'ha pogut navegar', 'error');
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error: ' + err.message, 'error');
    })
    .scrollToReference(paraId, color);
}

/**
 * Actualitza UI per mostrar ref activa
 */
function updateActiveReference(paraId) {
  // Treure 'active' de tots
  document.querySelectorAll('.reference-item').forEach(el => {
    el.classList.remove('active');
  });

  // Afegir 'active' al clicat
  const activeItem = document.querySelector(`.reference-item[onclick*="${paraId}"]`);
  if (activeItem) {
    activeItem.classList.add('active');
  }
}

/**
 * Netejar tots els highlights del document
 */
function clearAllHighlights() {
  google.script.run
    .withSuccessHandler(function(result) {
      if (result && result.success) {
        showToast('Marcatges netejats (' + result.cleared + ')', 'success');
        // Treure visual de refs
        document.querySelectorAll('.reference-item').forEach(el => {
          el.classList.add('cleared');
        });
      }
    })
    .withFailureHandler(function(err) {
      showToast('Error netejant: ' + err.message, 'error');
    })
    .clearReferenceHighlights();
}
```

### 3.3 Integració amb handleSendSuccess

**Modificar per detectar mode REFERENCE_HIGHLIGHT:**

```javascript
function handleSendSuccess(res) {
  hideThinking();

  if (res.status === 'reference_highlight') {
    // Nou handler per referències
    addBubbleWithReferences(res.ai_response, res.highlights);
    showToast(res.applied + ' paràgrafs marcats', 'success');
    return;
  }

  // ... resta de handlers existents ...
}
```

---

## FASE 4: ESTILS CSS (4h)

### 4.1 Styles.html - Secció Referències

```css
/* ═══════════════════════════════════════════════════════════
   REFERENCE HIGHLIGHTS (v7.0)
   ═══════════════════════════════════════════════════════════ */

/* Container de referències */
.reference-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Item de referència clicable */
.reference-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.reference-item:hover {
  transform: translateX(4px);
}

.reference-item.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-muted);
}

.reference-item.cleared {
  opacity: 0.5;
  pointer-events: none;
}

/* Colors de fons segons tipus */
.reference-item.ref-yellow {
  background: #FFF59D40;
  border-left: 3px solid #FFF59D;
}

.reference-item.ref-orange {
  background: #FFCC8040;
  border-left: 3px solid #FFCC80;
}

.reference-item.ref-blue {
  background: #90CAF940;
  border-left: 3px solid #90CAF9;
}

.reference-item.ref-purple {
  background: #CE93D840;
  border-left: 3px solid #CE93D8;
}

/* Badge amb emoji */
.ref-badge {
  font-size: 14px;
  flex-shrink: 0;
}

/* Contingut */
.ref-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ref-snippet {
  font-size: 11px;
  color: var(--text-secondary);
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ref-reason {
  font-size: 12px;
  color: var(--text-primary);
  font-weight: 500;
}

/* Fletxa */
.ref-arrow {
  flex-shrink: 0;
  opacity: 0.5;
  transition: opacity 0.15s, transform 0.15s;
}

.reference-item:hover .ref-arrow {
  opacity: 1;
  transform: translateX(2px);
}

/* Botó netejar */
.clear-highlights-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s;
}

.clear-highlights-btn:hover {
  color: var(--error);
  border-color: var(--error);
  background: var(--error-muted);
}

/* Animation d'entrada */
@keyframes refSlideIn {
  from {
    opacity: 0;
    transform: translateX(-10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.reference-item {
  animation: refSlideIn 0.2s ease forwards;
}

.reference-item:nth-child(2) { animation-delay: 0.05s; }
.reference-item:nth-child(3) { animation-delay: 0.1s; }
.reference-item:nth-child(4) { animation-delay: 0.15s; }
.reference-item:nth-child(5) { animation-delay: 0.2s; }
```

---

## FASE 5: TESTING I EDGE CASES (8h)

### 5.1 Tests Unitaris

| Test | Input | Expected Output |
|------|-------|-----------------|
| Highlights vàlids | `[{para_id: 5, color: "yellow"}]` | Paràgraf 5 amb fons groc |
| para_id invàlid | `[{para_id: 999}]` | Error silenciós, no crash |
| Color invàlid | `[{para_id: 0, color: "red"}]` | Fallback a yellow |
| Array buit | `[]` | Mode CHAT_ONLY |
| Més de 5 | `[..6 items..]` | Només primers 5 |
| Clic a ref | `scrollToDocReference(5, 'yellow')` | Scroll + highlight |
| Netejar | `clearAllHighlights()` | Tots els colors esborrats |

### 5.2 Edge Cases

| Cas | Comportament Esperat |
|-----|---------------------|
| Document buit | No crash, missatge "document buit" |
| Paràgraf eliminat | Error graceful, skip |
| Taula referenciada | Ignorar, mostrar warning |
| Doc > 500 paràgrafs | Processar en batches |
| Múltiples sessions | Highlights persisteixen fins netejar |
| Offline | Error de xarxa, retry |

### 5.3 Testing Manual

1. **Flux bàsic:**
   - Escriure "detecta repeticions"
   - Verificar que apareixen refs al xat
   - Clic a ref → scroll al document
   - Verificar highlight visible

2. **Flux netejar:**
   - Clic "Netejar marcatges"
   - Verificar que colors s'esborren
   - Verificar que refs es desactiven

3. **Flux error:**
   - Forçar para_id invàlid
   - Verificar error graceful
   - Verificar que altres refs funcionen

---

## CRONOGRAMA D'IMPLEMENTACIÓ

```
Setmana 1:
├── Dia 1-2: Fase 1 (Backend worker.js)
│   ├── System prompt nou mode
│   ├── Validació resposta
│   └── Tests unitaris
│
├── Dia 3-4: Fase 2 (Backend Code.gs)
│   ├── Constants colors
│   ├── applyReferenceHighlights()
│   ├── clearReferenceHighlights()
│   └── scrollToReference()
│
└── Dia 5: Integració backend
    ├── processUserCommand() modificat
    └── Tests integració

Setmana 2:
├── Dia 1-2: Fase 3 (Frontend Sidebar.html)
│   ├── addBubbleWithReferences()
│   ├── scrollToDocReference()
│   ├── clearAllHighlights()
│   └── handleSendSuccess() modificat
│
├── Dia 3: Fase 4 (CSS Styles.html)
│   ├── Estils referències
│   ├── Animacions
│   └── Responsive
│
├── Dia 4-5: Fase 5 (Testing)
│   ├── Tests unitaris
│   ├── Edge cases
│   ├── Testing manual
│   └── Bug fixes
│
└── Deploy final
```

---

## RESUM EXECUTIU

### Què Obtindrem

1. **Nou mode IA: REFERENCE_HIGHLIGHT**
   - La IA pot analitzar i marcar parts del document
   - Respostes amb referències clicables

2. **Interactivitat al Xat**
   - Clic a referència → Scroll al document
   - Highlight visual del paràgraf
   - Feedback immediat

3. **Gestió de Marcatges**
   - Colors semàntics (groc, taronja, blau, lila)
   - Botó per netejar tots els highlights
   - Persistència entre sessions

### Beneficis

| Benefici | Impacte |
|----------|---------|
| **Diferenciació** | Cap competidor ofereix això |
| **UX millorada** | Feedback visual immediat |
| **Productivitat** | Revisió de documents 3x més ràpida |
| **Engagement** | Interactivitat augmenta ús |

### Riscos Mitigats

| Risc | Mitigació |
|------|-----------|
| IA dona refs incorrectes | Validació + fallback a CHAT_ONLY |
| Massa highlights | Límit de 5 per resposta |
| Performance | Batches + timeout |
| Confusió UX | Botó netejar prominent |

---

## FITXERS A MODIFICAR

| Fitxer | Línies Noves | Línies Modificades |
|--------|--------------|-------------------|
| worker/worker.js | ~80 | ~20 |
| docs-addon/Code.gs | ~120 | ~30 |
| docs-addon/Sidebar.html | ~150 | ~20 |
| docs-addon/Styles.html | ~100 | 0 |
| **TOTAL** | **~450** | **~70** |

---

**Estat:** LLEST PER IMPLEMENTAR
**Versió:** v7.0
**Autor:** Claude
**Data:** 2024-12-04
