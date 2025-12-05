# PLA ULTRADETALLAT: Sincronització d'IDs Document v1.0

## RESUM EXECUTIU

**Problema**: Desincronització fatal entre IDs generats per `captureFullDocument()` i `buildElementMap()` quan el document conté taules, imatges o altres elements no editables.

**Solució**: Unificar la lògica de comptatge d'IDs en una única funció compartida.

**Impacte**: CRÍTIC - Afecta totes les operacions d'edició i undo en documents amb taules/imatges.

---

## 1. ANÀLISI DEL PROBLEMA

### 1.1 Flux Actual (BUGGY)

```
captureFullDocument() → processElement()
├─ PARAGRAPH    → ID 0, afegeix al mapa ✓
├─ TABLE        → ID 1, NO afegeix al mapa (però incrementa!)
├─ PARAGRAPH    → ID 2, afegeix al mapa ✓
└─ Mapa final: { 0: P1, 2: P2 }

buildElementMap() (cridat al commit/undo)
├─ PARAGRAPH    → ID 0, afegeix al mapa
├─ TABLE        → (ignorat completament)
├─ PARAGRAPH    → ID 1, afegeix al mapa  ← ERROR!
└─ Mapa final: { 0: P1, 1: P2 }

Resultat: AI demana ID 2, però el mapa té ID 1 → FALLADA
```

### 1.2 Funcions Afectades

| Funció | Línia | Usa buildElementMap | Risc |
|--------|-------|---------------------|------|
| `revertLastEdit()` | 610 | ✓ | ALT |
| `restoreText()` | 652 | ✓ | ALT |
| `applyInDocumentPreview()` | 1767 | ✓ (amb fallback) | MIG |
| `commitInDocumentPreview()` | 1865 | ✓ | ALT |
| `cancelInDocumentPreview()` | 1961 | ✓ | ALT |

### 1.3 Per què bodyIndex no és suficient

El codi actual intenta usar `bodyIndex` com a fallback, però:
1. Només funciona si `parent.getType() === BODY_SECTION`
2. No funciona per elements dins de taules o altres contenidors
3. Si l'usuari modifica el document entre preview i commit, els índexs canvien
4. Les funcions d'undo (`revertLastEdit`, `restoreText`) NO tenen bodyIndex guardat

---

## 2. SOLUCIÓ PROPOSADA

### 2.1 Estratègia: Unificació de Lògica

Crear una **única funció** que compti IDs de manera consistent i usar-la a tot arreu.

```
ABANS:
- captureFullDocument() → processElement() → compta tot
- buildElementMap() → compta només P/LI

DESPRÉS:
- captureFullDocument() → processElement() → compta tot
- buildElementMap() → compta tot (igual que processElement)
```

### 2.2 Opció Escollida: Modificar buildElementMap

**Per què aquesta opció:**
- Mínim canvi de codi
- No afecta el format que rep l'AI ({{0}}, {{T:1}}, {{2}}...)
- Manté compatibilitat amb previews existents
- Fàcil de testejar

---

## 3. CANVIS DETALLATS

### 3.1 Fitxer: `Code.gs`

#### CANVI 1: Refactoritzar `buildElementMap()` (línia 2024-2042)

**CODI ACTUAL:**
```javascript
function buildElementMap(body) {
  const mapIdToElement = {};
  const numChildren = body.getNumChildren();
  let currentIndex = 0;

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
        child.getType() === DocumentApp.ElementType.LIST_ITEM) {
      const text = child.asText().getText();
      if (text.trim().length > 0) {
        mapIdToElement[currentIndex] = child;
        currentIndex++;
      }
    }
  }

  return mapIdToElement;
}
```

**CODI NOU:**
```javascript
/**
 * Construeix el mapa ID -> Element del document
 * v6.6: Unificat amb processElement per evitar desincronització d'IDs
 *
 * IMPORTANT: Ha de comptar elements en el MATEIX ordre que processElement()
 * per garantir que els IDs coincideixin.
 */
function buildElementMap(body) {
  const mapIdToElement = {};
  const numChildren = body.getNumChildren();
  let currentIndex = 0;

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    const elementType = child.getType();

    switch (elementType) {
      case DocumentApp.ElementType.PARAGRAPH:
      case DocumentApp.ElementType.LIST_ITEM:
        // Elements editables: afegir al mapa SI tenen contingut
        try {
          const text = child.asText().getText();
          if (text.trim().length > 0) {
            mapIdToElement[currentIndex] = child;
            currentIndex++;
          }
        } catch (e) {
          // Element sense text vàlid, saltar
        }
        break;

      case DocumentApp.ElementType.TABLE:
      case DocumentApp.ElementType.TABLE_OF_CONTENTS:
      case DocumentApp.ElementType.INLINE_IMAGE:
      case DocumentApp.ElementType.INLINE_DRAWING:
        // Elements NO editables: incrementar comptador però NO afegir al mapa
        // Això manté la sincronització amb captureFullDocument/processElement
        currentIndex++;
        break;

      case DocumentApp.ElementType.HORIZONTAL_RULE:
        // Regles horitzontals: NO incrementen el comptador (igual que processElement)
        break;

      default:
        // Altres elements: ignorar completament
        break;
    }
  }

  return mapIdToElement;
}
```

#### CANVI 2: Afegir bodyIndex a lastEdit (millora robustesa)

**Modificar `saveLastEdit` per incloure bodyIndex:**

A la funció on es guarda lastEdit (múltiples llocs), afegir:

```javascript
// Dins de processUserCommand(), quan es guarda lastEdit:
saveLastEdit({
  targetId: targetId,
  originalText: originalText,
  currentText: newText,
  bodyIndex: getBodyIndex(targetElement)  // NOU
});

// Nova funció helper:
function getBodyIndex(element) {
  try {
    const parent = element.getParent();
    if (parent && parent.getType() === DocumentApp.ElementType.BODY_SECTION) {
      return parent.getChildIndex(element);
    }
  } catch (e) {}
  return -1;
}
```

#### CANVI 3: Usar bodyIndex a revertLastEdit i restoreText

**Modificar `revertLastEdit()` (línia 600-629):**

```javascript
function revertLastEdit() {
  try {
    const lastEdit = loadLastEdit();
    if (!lastEdit) {
      return { success: false, error: "No hi ha cap canvi per desfer." };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v6.6: Primer intentar amb bodyIndex (més fiable)
    let targetElement = null;
    if (lastEdit.bodyIndex !== undefined && lastEdit.bodyIndex >= 0) {
      try {
        targetElement = body.getChild(lastEdit.bodyIndex);
      } catch (e) {
        console.log('[Revert] bodyIndex fallback failed:', e.message);
      }
    }

    // Fallback: usar mapa d'IDs
    if (!targetElement) {
      const targetId = parseInt(lastEdit.targetId, 10);
      const mapIdToElement = buildElementMap(body);
      targetElement = mapIdToElement[targetId];
    }

    if (!targetElement) {
      return { success: false, error: "No s'ha trobat el paràgraf original." };
    }

    // Revertir al text original
    targetElement.asText().setText(lastEdit.originalText);

    // Actualitzar currentText = originalText
    lastEdit.currentText = lastEdit.originalText;
    saveLastEdit(lastEdit);

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
```

**Modificar `restoreText()` (línia 639-674) de manera similar.**

---

## 4. TESTS A EXECUTAR

### 4.1 Test Manual 1: Document amb Taula

```
1. Crear document:
   - Paràgraf A: "Hola món"
   - Taula 2x2
   - Paràgraf B: "Adéu món"

2. Seleccionar Paràgraf B
3. Mode Edit: "Canvia 'Adéu' per 'Fins aviat'"
4. Verificar: El canvi s'aplica a Paràgraf B (no a A)
5. Fer Undo
6. Verificar: Torna a "Adéu món"
```

### 4.2 Test Manual 2: Preview Mode

```
1. Mateix document
2. Activar Preview Mode
3. "Millora l'estil del paràgraf B"
4. Verificar: Preview es mostra correctament
5. Acceptar
6. Verificar: Canvi aplicat al paràgraf correcte
```

### 4.3 Test Manual 3: Document Complex

```
1. Crear document:
   - Paràgraf 1
   - Imatge
   - Paràgraf 2
   - Taula
   - Paràgraf 3
   - Índex (TOC)
   - Paràgraf 4

2. Seleccionar Paràgraf 4
3. Editar
4. Verificar: Canvi correcte
5. Undo
6. Verificar: Revert correcte
```

### 4.4 Test Automatitzat (Console Log)

Afegir temporalment al commit:
```javascript
console.log('[DEBUG] Preview IDs:', previews.map(p => p.targetId));
console.log('[DEBUG] Map IDs:', Object.keys(mapIdToElement));
console.log('[DEBUG] bodyIndices:', previews.map(p => p.bodyIndex));
```

---

## 5. PLA D'IMPLEMENTACIÓ

### Fase 1: Preparació (5 min)
- [ ] Backup de Code.gs
- [ ] Crear branca git: `fix/id-sync-bug`

### Fase 2: Implementació Core (15 min)
- [ ] Modificar `buildElementMap()` amb nova lògica
- [ ] Afegir funció helper `getBodyIndex()`

### Fase 3: Millores de Robustesa (10 min)
- [ ] Actualitzar `revertLastEdit()` amb fallback bodyIndex
- [ ] Actualitzar `restoreText()` amb fallback bodyIndex
- [ ] Afegir bodyIndex a tots els llocs on es guarda lastEdit

### Fase 4: Testing (15 min)
- [ ] Test 1: Document amb taula
- [ ] Test 2: Preview mode
- [ ] Test 3: Document complex
- [ ] Verificar logs de debug

### Fase 5: Cleanup (5 min)
- [ ] Eliminar logs de debug
- [ ] Commit amb missatge descriptiu
- [ ] Deploy

---

## 6. RISCOS I MITIGACIÓ

| Risc | Probabilitat | Impacte | Mitigació |
|------|--------------|---------|-----------|
| Previews existents trenquen | BAIXA | MIG | bodyIndex com a fallback |
| Performance en docs grans | BAIXA | BAIX | Mateix algorisme O(n) |
| Nous tipus d'element no contemplats | BAIXA | BAIX | default case ignora |

---

## 7. ROLLBACK

Si cal tornar enrere:
1. `git revert` del commit
2. Deploy versió anterior
3. Previews pendents poden fallar → usuaris han de re-enviar

---

## 8. CODI COMPLET FINAL

### buildElementMap() - Versió Final

```javascript
/**
 * Construeix el mapa ID -> Element del document
 * v6.6: Unificat amb processElement per evitar desincronització d'IDs
 */
function buildElementMap(body) {
  const mapIdToElement = {};
  const numChildren = body.getNumChildren();
  let currentIndex = 0;

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    const elementType = child.getType();

    switch (elementType) {
      case DocumentApp.ElementType.PARAGRAPH:
      case DocumentApp.ElementType.LIST_ITEM:
        try {
          const text = child.asText().getText();
          if (text.trim().length > 0) {
            mapIdToElement[currentIndex] = child;
            currentIndex++;
          }
        } catch (e) {}
        break;

      case DocumentApp.ElementType.TABLE:
      case DocumentApp.ElementType.TABLE_OF_CONTENTS:
      case DocumentApp.ElementType.INLINE_IMAGE:
      case DocumentApp.ElementType.INLINE_DRAWING:
        // NO editables: incrementar comptador per sincronitzar amb processElement
        currentIndex++;
        break;

      // HORIZONTAL_RULE i altres: no incrementen (igual que processElement)
    }
  }

  return mapIdToElement;
}
```

---

**Autor**: Claude
**Data**: 2025-12-05
**Versió**: 1.0
**Estat**: LLEST PER IMPLEMENTAR
