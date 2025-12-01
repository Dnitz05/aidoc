# Pla d'Implementació: Preview Mode (v3.2)

## Anàlisi de la Proposta Gemini

### Punts Forts ✅
1. **Sidebar-First Preview** - Tot el diff es mostra al sidebar, no al document
2. **diff-match-patch** - Algoritme estàndard de Google, eficient
3. **dry_run pattern** - Permet obtenir canvis sense aplicar
4. **Context Anchors** - Mostrar paraules de context al voltant del canvi

### Punts a Refinar 🔧
1. `applyChanges(newText)` és massa simple - necessitem:
   - `targetId` per saber ON aplicar
   - Preservació d'atributs (negreta, cursiva)
   - Actualització de `lastEdit` memory
2. Cal gestionar múltiples canvis (batch)
3. Cal integrar amb el sistema de `undo_snapshot` existent

---

## Arquitectura Proposada

```
┌─────────────────────────────────────────────────────────────────┐
│                         FLUX ACTUAL                             │
├─────────────────────────────────────────────────────────────────┤
│  User → processUserCommand() → Worker → Aplica → undo_snapshot  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         FLUX NOU                                │
├─────────────────────────────────────────────────────────────────┤
│  User → processUserCommand(preview:true) → Worker               │
│       → NO Aplica → Retorna {status:'preview', changes:[...]}   │
│       → Sidebar mostra Diff                                     │
│       → User clica [Aplicar]                                    │
│       → applyPendingChanges(changes) → Aplica                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components a Implementar

### 1. Diff Engine (Sidebar.html)

```javascript
// Versió simplificada de diff-match-patch per Google Apps Script
// ~2KB minificat, suficient per al nostre cas d'ús

function computeDiffHtml(original, proposed) {
  // Retorna HTML amb <del> i <ins> tags
  // Inclou context (paraules abans/després)
}
```

**CSS:**
```css
.diff-del {
  background: rgba(255, 0, 0, 0.15);
  text-decoration: line-through;
  color: var(--error);
}

.diff-ins {
  background: rgba(0, 200, 0, 0.15);
  text-decoration: underline;
  color: var(--success);
}

.diff-context {
  color: var(--text-muted);
}
```

### 2. Backend (Code.gs)

**Modificar `processUserCommand`:**
```javascript
function processUserCommand(instruction, chatHistory, userMode, previewMode) {
  // ... codi existent fins obtenir aiData del worker ...

  if (previewMode && aiData.mode === 'UPDATE_BY_ID') {
    // NO aplicar canvis - retornar preview
    const changes = [];
    for (const [id, newText] of Object.entries(aiData.updates)) {
      const targetElement = mapIdToElement[id];
      if (targetElement) {
        changes.push({
          targetId: id,
          originalText: targetElement.asText().getText(),
          proposedText: newText
        });
      }
    }
    return {
      ok: true,
      status: 'preview',
      changes: changes,
      ai_response: aiData.change_summary,
      thought: aiData.thought
    };
  }

  // ... resta del codi (aplicació directa) ...
}
```

**Nova funció `applyPendingChanges`:**
```javascript
function applyPendingChanges(changes) {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();

  // Reconstruir mapa d'elements
  let elementsToProcess = [];
  // ... mateix codi que processUserCommand ...

  let undoSnapshots = [];

  for (const change of changes) {
    const targetElement = mapIdToElement[change.targetId];
    if (targetElement) {
      undoSnapshots.push({
        targetId: change.targetId,
        originalText: targetElement.asText().getText()
      });
      updateParagraphPreservingAttributes(targetElement, change.proposedText);
    }
  }

  // Guardar lastEdit per continuïtat
  if (changes.length > 0) {
    saveLastEdit({
      targetId: changes[0].targetId,
      originalText: undoSnapshots[0].originalText,
      currentText: changes[0].proposedText
    });
  }

  // Auto-scroll al primer canvi
  // doc.setSelection() - si és possible

  return { ok: true, applied: changes.length, undoSnapshots };
}
```

### 3. UI Preview (Sidebar.html)

**Nou component `PreviewPanel`:**
```html
<div id="previewPanel" class="preview-panel hidden">
  <div class="preview-header">
    <span class="icon">👁️</span>
    <span>Previsualització de Canvis</span>
  </div>
  <div id="previewContent" class="preview-content">
    <!-- Diff HTML generat dinàmicament -->
  </div>
  <div class="preview-actions">
    <button class="btn btn-success" onclick="applyPreviewedChanges()">
      ✅ Aplicar
    </button>
    <button class="btn btn-secondary" onclick="cancelPreview()">
      ❌ Cancel·lar
    </button>
  </div>
</div>
```

**JavaScript:**
```javascript
let pendingChanges = null; // Canvis pendents d'aprovar

function showPreview(changes, aiResponse) {
  pendingChanges = changes;

  let html = '';
  for (const change of changes) {
    const diffHtml = computeDiffHtml(change.originalText, change.proposedText);
    html += `
      <div class="preview-change">
        <div class="preview-location">Paràgraf ${change.targetId}</div>
        <div class="preview-diff">${diffHtml}</div>
      </div>
    `;
  }

  document.getElementById('previewContent').innerHTML = html;
  document.getElementById('previewPanel').classList.remove('hidden');
}

function applyPreviewedChanges() {
  if (!pendingChanges) return;

  google.script.run
    .withSuccessHandler(function(res) {
      hidePreview();
      addBubble('ai', 'Canvis aplicats correctament', true);
    })
    .withFailureHandler(function(err) {
      addBubble('error', 'Error: ' + err.message);
    })
    .applyPendingChanges(pendingChanges);
}

function cancelPreview() {
  pendingChanges = null;
  hidePreview();
  addBubble('system', 'Canvis cancel·lats');
}
```

---

## Seqüència d'Esdeveniments

```
1. Usuari escriu: "Fes-ho més formal"
   ↓
2. sendMessage() crida processUserCommand(..., previewMode=true)
   ↓
3. Code.gs obté resposta del Worker
   ↓
4. Code.gs NO aplica canvis, retorna:
   {
     status: 'preview',
     changes: [
       { targetId: '3', originalText: '...', proposedText: '...' }
     ],
     ai_response: 'Proposo fer més formal el paràgraf 3'
   }
   ↓
5. Sidebar mostra Preview Panel:
   ┌─────────────────────────────────────┐
   │ 👁️ Previsualització                 │
   ├─────────────────────────────────────┤
   │ Paràgraf 3:                         │
   │ "El contracte ~té~ tindrà una..."   │
   │                                     │
   │ [✅ Aplicar] [❌ Cancel·lar]         │
   └─────────────────────────────────────┘
   ↓
6. Usuari clica [Aplicar]
   ↓
7. applyPendingChanges() aplica els canvis
   ↓
8. Document actualitzat + confirmació al xat
```

---

## Tasques d'Implementació

### Sprint 3.2.1: Diff Engine
- [ ] Implementar `computeDiffHtml()` (diff-match-patch simplificat)
- [ ] CSS per `.diff-del`, `.diff-ins`, `.diff-context`
- [ ] Tests unitaris amb exemples variats

### Sprint 3.2.2: Backend Preview Mode
- [ ] Afegir paràmetre `previewMode` a `processUserCommand`
- [ ] Lògica de retorn preview sense aplicar
- [ ] Nova funció `applyPendingChanges()`
- [ ] Integració amb `lastEdit` memory

### Sprint 3.2.3: UI Preview Panel
- [ ] HTML del Preview Panel
- [ ] JavaScript per mostrar/ocultar
- [ ] Gestió de `pendingChanges`
- [ ] Integració amb flux de xat existent

### Sprint 3.2.4: Polish & Edge Cases
- [ ] Múltiples canvis (batch preview)
- [ ] Auto-scroll al canvi (si és possible)
- [ ] Timeout de preview (auto-cancel després de X segons?)
- [ ] Keyboard shortcuts (Enter=Aplicar, Esc=Cancel·lar)

---

## Consideracions Tècniques

### diff-match-patch
Opcions:
1. **Versió completa** (~15KB) - Molt potent, pot ser overkill
2. **Versió simplificada** (~2KB) - Suficient per paraules/frases
3. **Implementació pròpia** - Màxim control, més feina

**Recomanació:** Versió simplificada basada en LCS (Longest Common Subsequence)

### Limitacions Google Apps Script
- `doc.setSelection()` pot no funcionar en tots els casos
- No podem "pintar" el document sense modificar-lo
- Sidebar és el lloc ideal per preview

### Retrocompatibilitat
- El mode "directe" (sense preview) ha de seguir funcionant
- Potser un toggle a Config: "Previsualitzar canvis abans d'aplicar"

---

## Estimació

| Sprint | Complexitat | Hores Est. |
|--------|-------------|------------|
| 3.2.1  | Mitjana     | 2-3h       |
| 3.2.2  | Mitjana     | 2-3h       |
| 3.2.3  | Mitjana     | 2-3h       |
| 3.2.4  | Baixa       | 1-2h       |
| **Total** |          | **7-11h**  |

---

*Pla creat: 2024-12-01*
*Versió: 1.0*
