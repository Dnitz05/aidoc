# Pla d'Implementació: Sistema Unificat d'Anotacions

## Objectiu
Crear una UI unificada que gestioni tant highlights (informatiu) com changes (accionable amb Accept/Reject individual).

---

## Fase 1: Apps Script - Backend per canvis individuals

### 1.1 Nova funció `applySingleChange()`
**Fitxer:** `Code.gs`

```javascript
function applySingleChange(change) {
  // Aplica un sol canvi: {targetId, originalText, proposedText}
  // Retorna: {ok, undoSnapshot, error}
}
```

**Punt d'inserció:** Després de `applyPendingChanges()` (línia ~2100)

**Lògica:**
- Validar que el paràgraf existeix i el text original coincideix
- Aplicar el canvi
- Retornar snapshot per undo individual

---

## Fase 2: Frontend - Model de dades unificat

### 2.1 Estructura d'anotació
```javascript
{
  id: string,              // Identificador únic per tracking
  type: 'highlight' | 'change',
  para_id: number,

  // Per highlights
  color: string,           // yellow, orange, blue, purple
  snippet: string,         // Text destacat
  reason: string,          // Comentari

  // Per changes
  originalText: string,
  proposedText: string,
  diffHtml: string,        // HTML pre-renderitzat del diff
  status: 'pending' | 'accepted' | 'rejected',

  // Comú
  reason: string           // Explicació del canvi
}
```

### 2.2 Estat global
**Afegir a Sidebar.html (secció de variables globals):**
```javascript
let pendingAnnotations = [];  // Array d'anotacions actives
```

---

## Fase 3: Frontend - Nova funció de renderització

### 3.1 `addBubbleWithAnnotations()`
**Punt d'inserció:** Després de `addBubbleWithReferences()` (~línia 3060)

```javascript
function addBubbleWithAnnotations(aiResponse, annotations, docSnapshot) {
  // 1. Crear bombolla AI amb resposta
  // 2. Renderitzar llista d'anotacions
  //    - Si type='highlight': mostrar com ara (sense botons)
  //    - Si type='change': mostrar diff + botons Accept/Reject
  // 3. Si hi ha changes: afegir barra "Acceptar tots / Descartar"
  // 4. Guardar pendingAnnotations i docSnapshot
}
```

### 3.2 HTML generat per ítem de canvi
```html
<div class="annotation-item change-item" data-id="{{id}}" data-status="pending">
  <div class="annotation-header">
    <span class="annotation-location">§{{para_id + 1}}</span>
    <span class="annotation-reason">{{reason}}</span>
  </div>
  <div class="annotation-diff">{{diffHtml}}</div>
  <div class="annotation-actions">
    <button class="btn-accept" onclick="acceptSingleChange('{{id}}')">
      ✓ Acceptar
    </button>
    <button class="btn-reject" onclick="rejectSingleChange('{{id}}')">
      ✗ Rebutjar
    </button>
  </div>
</div>
```

### 3.3 HTML generat per ítem de highlight (sense canvis)
```html
<div class="annotation-item highlight-item ref-{{color}}"
     onclick="scrollToDocReference({{para_id}}, '{{color}}')">
  <span class="ref-snippet">"{{snippet}}"</span>
  <span class="ref-reason">{{reason}}</span>
  <span class="ref-arrow">→</span>
</div>
```

---

## Fase 4: Frontend - Funcions d'acció

### 4.1 `acceptSingleChange(annotationId)`
```javascript
function acceptSingleChange(annotationId) {
  // 1. Trobar anotació a pendingAnnotations
  // 2. Cridar google.script.run.applySingleChange()
  // 3. Actualitzar status a 'accepted'
  // 4. Actualitzar UI (grayed out, mostrar ✓)
  // 5. Comprovar si tots els canvis estan resolts
}
```

### 4.2 `rejectSingleChange(annotationId)`
```javascript
function rejectSingleChange(annotationId) {
  // 1. Actualitzar status a 'rejected'
  // 2. Actualitzar UI (gray out, crossed out)
  // 3. NO cridar Apps Script (no apliquem res)
}
```

### 4.3 `acceptAllPendingChanges()`
```javascript
function acceptAllPendingChanges() {
  // Aplicar tots els pendents d'un cop (optimitzat)
  // Usa l'existent applyPendingChanges() amb només els pendents
}
```

### 4.4 `discardAllPendingChanges()`
```javascript
function discardAllPendingChanges() {
  // Marcar tots com rejected i netejar UI
}
```

---

## Fase 5: CSS - Estils per anotacions

### 5.1 Nous estils a Styles.html
```css
/* Base d'anotació (compartit) */
.annotation-item {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  margin-bottom: 6px;
  transition: all 0.2s ease;
}

/* Canvi pendent */
.annotation-item.change-item[data-status="pending"] {
  background: rgba(59, 130, 246, 0.08);
  border-left: 3px solid var(--accent);
}

/* Canvi acceptat */
.annotation-item.change-item[data-status="accepted"] {
  background: rgba(34, 197, 94, 0.08);
  border-left: 3px solid #22c55e;
  opacity: 0.7;
}

.annotation-item.change-item[data-status="accepted"] .annotation-actions {
  display: none;
}

.annotation-item.change-item[data-status="accepted"]::after {
  content: "✓ Aplicat";
  color: #22c55e;
  font-size: 11px;
  margin-top: 6px;
}

/* Canvi rebutjat */
.annotation-item.change-item[data-status="rejected"] {
  background: rgba(239, 68, 68, 0.05);
  opacity: 0.5;
  text-decoration: line-through;
}

/* Accions */
.annotation-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.btn-accept, .btn-reject {
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
  border: none;
}

.btn-accept {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
}

.btn-accept:hover {
  background: rgba(34, 197, 94, 0.25);
}

.btn-reject {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
}

.btn-reject:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* Barra d'accions bulk */
.annotation-bulk-actions {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  border-top: 1px solid var(--border);
  margin-top: 8px;
}
```

---

## Fase 6: Integració - Modificar flux de resposta

### 6.1 Modificar processament de resposta UPDATE_BY_ID
**Fitxer:** Sidebar.html, secció de processament de resposta (~línia 2105)

**Actual:**
```javascript
if (res.status === 'preview' && res.changes) {
  showPreviewPanel(res.changes, res.ai_response, res.doc_snapshot);
}
```

**Nou:**
```javascript
if (res.status === 'preview' && res.changes) {
  // Convertir changes a annotations
  const annotations = res.changes.map((c, i) => ({
    id: 'change-' + i,
    type: 'change',
    para_id: parseInt(c.targetId),
    originalText: c.originalText,
    proposedText: c.proposedText,
    diffHtml: computeDiffHtml(c.originalText, c.proposedText),
    reason: c.reason || 'Canvi proposat',
    status: 'pending'
  }));

  addBubbleWithAnnotations(res.ai_response, annotations, res.doc_snapshot);
}
```

### 6.2 Mantenir compatibilitat amb highlights
El processament de `reference_highlight` pot continuar usant `addBubbleWithReferences()` inicialment, o migrar a `addBubbleWithAnnotations()` amb `type: 'highlight'`.

---

## Fase 7: Testing

### 7.1 Casos de prova
1. **Canvis múltiples:** Verificar que cada canvi es pot acceptar/rebutjar independentment
2. **Acceptar un, rebutjar altre:** Verificar que només s'aplica el que s'accepta
3. **Acceptar tots:** Verificar que el botó bulk funciona
4. **Estat persistent:** Reobrir sidebar i verificar estat dels canvis
5. **Navegació:** Click en canvi navega al paràgraf correcte
6. **Undo:** Verificar que es pot desfer cada canvi individualment

### 7.2 Edge cases
- Document modificat mentre es revisen canvis (race condition)
- Canvi ja aplicat per altra via
- Paràgraf eliminat

---

## Ordre d'Implementació

| Pas | Tasca | Fitxer | Dependència |
|-----|-------|--------|-------------|
| 1 | `applySingleChange()` | Code.gs | - |
| 2 | Estils CSS anotacions | Styles.html | - |
| 3 | Estructura dades i variables | Sidebar.html | - |
| 4 | `addBubbleWithAnnotations()` | Sidebar.html | 2, 3 |
| 5 | `acceptSingleChange()` | Sidebar.html | 1, 4 |
| 6 | `rejectSingleChange()` | Sidebar.html | 4 |
| 7 | Accions bulk | Sidebar.html | 5, 6 |
| 8 | Integració resposta UPDATE | Sidebar.html | 4 |
| 9 | Testing | - | Tot |
| 10 | Clasp push | - | 9 |

---

## Estimació de Complexitat

| Component | Línies codi estimades |
|-----------|----------------------|
| Code.gs (applySingleChange) | ~40 |
| Styles.html (CSS) | ~80 |
| Sidebar.html (JS) | ~150 |
| **Total** | ~270 línies |

---

## Riscos i Mitigacions

| Risc | Mitigació |
|------|-----------|
| Race condition document canviat | Verificar snapshot abans d'aplicar cada canvi |
| Overhead múltiples crides Apps Script | Optimitzar amb batch si l'usuari clica "Acceptar tots" |
| Confusió UI amb massa botons | Disseny minimalista, botons petits, estat visual clar |

---

## Aprovació

- [ ] Arquitectura validada
- [ ] Ordre d'implementació acordat
- [ ] Puc començar?
