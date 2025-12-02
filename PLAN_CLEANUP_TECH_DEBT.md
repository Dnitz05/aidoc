# PLA: Neteja Completa de Deute Tècnic v3.10

## Objectiu
Eliminar codi mort, duplicacions i CSS obsolet per reduir ~350 línies i millorar mantenibilitat.

---

## FASE 1: Codi Mort (Immediat)

### 1.1 Eliminar `client_intent` a worker.js
**Fitxer:** `worker/worker.js`
**Línies a eliminar:** 1179-1207 (~28 línies)

```javascript
// ELIMINAR: Tot el bloc else if amb client_intent
} else if (effectiveMode === 'auto' && client_intent) {
  // v3.7: Enhanced AUTO mode with client intent classification
  // ... tot fins línia 1207
}
```

**Raó:** El paràmetre `client_intent` ja no s'envia des del frontend (eliminat a v3.10).

---

### 1.2 Eliminar funció deprecated `captureDocumentComplete()`
**Fitxer:** `docs-addon/Code.gs`
**Línies a eliminar:** 1848-1858 (~11 línies)

```javascript
// ELIMINAR: Tot el bloc
// ═══════════════════════════════════════════════════════════════
// LEGACY WRAPPER - Mantenir compatibilitat
// ═══════════════════════════════════════════════════════════════

/**
 * Wrapper per compatibilitat amb codi existent
 * @deprecated Usar captureFullDocument() directament
 */
function captureDocumentComplete(body, isSelection, selectedElements) {
  const doc = DocumentApp.getActiveDocument();
  return captureFullDocument(doc, body, isSelection, selectedElements);
}
```

**Raó:** Funció definida però mai cridada. Només és un wrapper innecessari.

---

### 1.3 Eliminar codi de migració SIDECAR
**Fitxer:** `docs-addon/Code.gs`
**Línies a eliminar:** 78-95 (~18 línies)

```javascript
// ELIMINAR: Tot el bloc de migració
// v3.3: Migració automàtica de SIDECAR a DOCMILE (per usuaris existents)
const oldJson = props.getProperty('SIDECAR_SETTINGS');
if (oldJson && !props.getProperty('DOCMILE_SETTINGS')) {
  // ... tot el bloc de migració
}
```

**Raó:** El projecte ja porta 12+ versions. Qualsevol usuari actiu ja ha migrat.

---

### 1.4 Eliminar funcions de test a DocScanner.gs
**Fitxer:** `docs-addon/DocScanner.gs`
**Línies a eliminar:** 258-325 i 448-509 (~126 línies)

```javascript
// ELIMINAR: Bloc de test 1
// ═══════════════════════════════════════════════════════════════
// TEST
// ═══════════════════════════════════════════════════════════════
function testSkeleton() { ... }

// ELIMINAR: Bloc de test 2
function testAutoStructure() { ... }
```

**Raó:** Codi de debug que no hauria d'estar en producció.

---

## FASE 2: Refactorització de Duplicacions

### 2.1 Crear funció `getEditableElements(body)`
**Fitxer:** `docs-addon/Code.gs`
**Nova funció a afegir a la secció d'utilitats (~línia 130):**

```javascript
/**
 * Obté els elements editables (paràgrafs i llistes) del document
 * @param {Body} body - El body del document
 * @returns {Array} Array d'elements editables
 */
function getEditableElements(body) {
  const elements = [];
  const numChildren = body.getNumChildren();
  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
        child.getType() === DocumentApp.ElementType.LIST_ITEM) {
      elements.push(child);
    }
  }
  return elements;
}
```

**Després, substituir les 4 ocurrències duplicades:**

| Ubicació | Línia aprox. | Acció |
|----------|--------------|-------|
| `revertLastEdit()` | 180-188 | Substituir per `getEditableElements(body)` |
| `restoreText()` | 244-252 | Substituir per `getEditableElements(body)` |
| `applyPendingChanges()` | 882-890 | Substituir per `getEditableElements(body)` |

**Estalvi net:** ~18 línies (24 duplicades - 6 nova funció)

---

### 2.2 Crear funció `findElementByIndex(elements, targetIndex)`
**Fitxer:** `docs-addon/Code.gs`
**Nova funció:**

```javascript
/**
 * Troba un element pel seu índex (comptant només elements amb text)
 * @param {Array} elements - Array d'elements del document
 * @param {number} targetIndex - Índex a trobar
 * @returns {Element|null} L'element trobat o null
 */
function findElementByIndex(elements, targetIndex) {
  let currentIndex = 0;
  for (const el of elements) {
    const text = el.asText().getText();
    if (text.trim().length > 0) {
      if (currentIndex === targetIndex) {
        return el;
      }
      currentIndex++;
    }
  }
  return null;
}
```

**Després, substituir les 3 ocurrències:**

| Ubicació | Línia aprox. | Codi actual |
|----------|--------------|-------------|
| `revertLastEdit()` | 190-203 | Loop find-by-ID |
| `restoreText()` | 255-268 | Loop find-by-ID |
| `revertEditById()` | (cerca) | Loop find-by-ID |

**Estalvi net:** ~12 línies (18 duplicades - 6 nova funció)

---

### 2.3 Crear funció `cleanMarkdown(text)`
**Fitxer:** `docs-addon/Code.gs`
**Nova funció:**

```javascript
/**
 * Neteja el markdown inline (bold/italic) del text
 * @param {string} text - Text amb possible markdown
 * @returns {string} Text net sense markdown
 */
function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')  // bold
    .replace(/\*(.*?)\*/g, '$1');     // italic
}
```

**Substituir les 4 ocurrències a línies ~603, 725, 1018, 1291**

**Estalvi net:** ~4 línies

---

## FASE 3: CSS Duplicat

### 3.1 Eliminar definició duplicada `.recipes-no-results`
**Fitxer:** `docs-addon/Styles.html`
**Acció:** Eliminar la segona definició (línies 1895-1905)

```css
/* ELIMINAR: Segona definició duplicada */
.recipes-no-results {
  text-align: center;
  padding: var(--space-xl);
  color: var(--text-secondary);
}

.recipes-no-results-icon {
  font-size: 32px;
  margin-bottom: var(--space-sm);
  opacity: 0.5;
}
```

**Mantenir:** Primera definició (línies 1745-1761) que és més completa.

**Estalvi:** ~11 línies

---

## FASE 4: Optimització de Performance (Opcional)

### 4.1 Millorar cerca O(n²) a O(n)
**Fitxer:** `docs-addon/Code.gs`
**Línies:** ~753-760

**Abans (O(n²)):**
```javascript
const oldWords = preservedOriginal.toLowerCase().split(/\s+/);
const newWords = cleanNewText.toLowerCase().split(/\s+/);
for (let i = 0; i < newWords.length; i++) {
  if (!oldWords.includes(newWords[i]) && newWords[i].length > 3) {
    lastEditWord = newWords[i];
    break;
  }
}
```

**Després (O(n)):**
```javascript
const oldWordsSet = new Set(preservedOriginal.toLowerCase().split(/\s+/));
const newWords = cleanNewText.toLowerCase().split(/\s+/);
for (const word of newWords) {
  if (!oldWordsSet.has(word) && word.length > 3) {
    lastEditWord = word;
    break;
  }
}
```

**Estalvi:** 0 línies, però millora performance en documents grans.

---

## RESUM D'ESTALVI

| Fase | Descripció | Línies eliminades | Línies afegides | Net |
|------|------------|-------------------|-----------------|-----|
| 1.1 | client_intent | 28 | 0 | -28 |
| 1.2 | captureDocumentComplete | 11 | 0 | -11 |
| 1.3 | SIDECAR migration | 18 | 0 | -18 |
| 1.4 | Test functions | 126 | 0 | -126 |
| 2.1 | getEditableElements | 24 | 6 | -18 |
| 2.2 | findElementByIndex | 18 | 6 | -12 |
| 2.3 | cleanMarkdown | 8 | 4 | -4 |
| 3.1 | CSS duplicat | 11 | 0 | -11 |
| 4.1 | O(n²) optimization | 0 | 0 | 0 |
| **TOTAL** | | **244** | **16** | **-228** |

---

## ORDRE D'EXECUCIÓ

1. **Fase 1** - Eliminar codi mort (menys risc)
   - 1.1 worker.js client_intent
   - 1.2 captureDocumentComplete
   - 1.3 SIDECAR migration
   - 1.4 Test functions

2. **Fase 2** - Refactorització (risc mitjà)
   - 2.1 Crear + substituir getEditableElements
   - 2.2 Crear + substituir findElementByIndex
   - 2.3 Crear + substituir cleanMarkdown

3. **Fase 3** - CSS (baix risc)
   - 3.1 Eliminar CSS duplicat

4. **Fase 4** - Opcional
   - 4.1 Optimització performance

---

## TESTING REQUERIT

Després de cada fase:
1. Verificar que el sidebar carrega
2. Provar enviar missatge en mode Edit
3. Provar enviar missatge en mode Xat
4. Provar revertir una edició
5. Provar la pestanya Structure
6. Verificar que el deploy al Worker funciona

---

## RISCOS I MITIGACIONS

| Risc | Probabilitat | Mitigació |
|------|--------------|-----------|
| Trencar revert | Baixa | Test manual després de Fase 2 |
| Trencar preview | Baixa | Mantenim tot el CSS preview-panel |
| Trencar migració | Molt baixa | Usuaris ja migrats fa 12 versions |
| Errors worker | Baixa | Deploy i test immediat |

---

**Temps estimat:** 1-2 hores
**Risc global:** Baix
**Benefici:** Codi més net i mantenible

---

## APROVAT PER IMPLEMENTAR?

Esperant confirmació de l'usuari.
