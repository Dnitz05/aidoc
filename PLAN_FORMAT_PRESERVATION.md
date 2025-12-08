# Pla de Preservació de Format - Docmile v12

## Objectiu
Garantir que **CAP** operació de l'add-on perdi el format original del document (font, mida, colors, bold, italic, etc.).

---

## 1. Anàlisi del Problema Actual

### 1.1 Mètodes que DESTRUEIXEN format
```javascript
// MALAMENT - Perd TOT el format
element.asText().setText(newText);
textObj.setText(cleanText);
```

### 1.2 Mètodes que PRESERVEN format
```javascript
// BÉ - Preserva format del text circumdant
textObj.replaceText("error", "correcció");

// BÉ - Operacions quirúrgiques
textObj.deleteText(start, end);
textObj.insertText(position, text);
```

### 1.3 Llocs afectats al codi actual
| Línia | Funció | Risc |
|-------|--------|------|
| 639 | undoLastEdit | ALT - usa setText |
| 711 | undoLastEdit (altra branca) | ALT |
| 1218 | handleSuggestion | ALT |
| 1849 | processUserCommand (REWRITE) | ALT |
| 1879 | processUserCommand (REWRITE) | ALT |
| 2838 | updateParagraphPreservingAttributes | ALT - irònicament! |
| 3226 | handleTableOperation | MITJÀ |
| 4706 | handleAssistantResult | ALT |
| 5120 | handleSuggestionAction | ALT |

---

## 2. Arquitectura de la Solució

### 2.1 Nou mòdul: FormatPreserver

```javascript
/**
 * FORMAT PRESERVER MODULE v12.0
 *
 * Garanteix preservació de format en totes les operacions de text.
 */

// Captura tots els atributs de format d'un rang
function captureFormatAttributes(textObj, startIndex, endIndex) {
  const attrs = [];
  for (let i = startIndex; i <= endIndex; i++) {
    attrs.push({
      position: i,
      bold: textObj.isBold(i),
      italic: textObj.isItalic(i),
      underline: textObj.isUnderline(i),
      strikethrough: textObj.isStrikethrough(i),
      fontSize: textObj.getFontSize(i),
      fontFamily: textObj.getFontFamily(i),
      foregroundColor: textObj.getForegroundColor(i),
      backgroundColor: textObj.getBackgroundColor(i),
      linkUrl: textObj.getLinkUrl(i)
    });
  }
  return attrs;
}

// Aplica atributs capturats a un rang
function applyFormatAttributes(textObj, startIndex, attrs) {
  attrs.forEach((attr, offset) => {
    const i = startIndex + offset;
    if (i >= textObj.getText().length) return;

    try {
      if (attr.bold !== null) textObj.setBold(i, i, attr.bold);
      if (attr.italic !== null) textObj.setItalic(i, i, attr.italic);
      if (attr.underline !== null) textObj.setUnderline(i, i, attr.underline);
      if (attr.strikethrough !== null) textObj.setStrikethrough(i, i, attr.strikethrough);
      if (attr.fontSize) textObj.setFontSize(i, i, attr.fontSize);
      if (attr.fontFamily) textObj.setFontFamily(i, i, attr.fontFamily);
      if (attr.foregroundColor) textObj.setForegroundColor(i, i, attr.foregroundColor);
      if (attr.backgroundColor) textObj.setBackgroundColor(i, i, attr.backgroundColor);
      if (attr.linkUrl) textObj.setLinkUrl(i, i, attr.linkUrl);
    } catch (e) {
      // Ignorar errors per caràcters especials
    }
  });
}
```

### 2.2 Estratègies per Tipus de Canvi

#### ESTRATÈGIA A: Substitució Simple (fix: "dde" → "de")
```javascript
function replaceWordPreservingFormat(element, oldWord, newWord) {
  const textObj = element.editAsText();
  const fullText = textObj.getText();
  const index = fullText.indexOf(oldWord);

  if (index === -1) return false;

  // Capturar format del primer caràcter de la paraula
  const formatRef = captureFormatAttributes(textObj, index, index)[0];

  // Usar replaceText natiu (preserva format circumdant)
  // PERÒ si la longitud canvia, el nou text hereta format
  textObj.replaceText(escapeRegex(oldWord), newWord);

  return true;
}
```

#### ESTRATÈGIA B: Modificació de Fragment (improve: frase)
```javascript
function replaceRangePreservingFormat(element, startIdx, endIdx, newText) {
  const textObj = element.editAsText();

  // 1. Capturar format dominant del rang
  const formatRef = captureFormatAttributes(textObj, startIdx, startIdx)[0];

  // 2. Eliminar text antic
  textObj.deleteText(startIdx, endIdx);

  // 3. Inserir text nou
  textObj.insertText(startIdx, newText);

  // 4. Aplicar format capturat al text nou
  const newEndIdx = startIdx + newText.length - 1;
  applyUniformFormat(textObj, startIdx, newEndIdx, formatRef);

  return true;
}
```

#### ESTRATÈGIA C: Reescriptura Completa (rewrite)
```javascript
function rewriteParagraphPreservingFormat(element, newText) {
  const textObj = element.editAsText();
  const oldText = textObj.getText();

  // 1. Capturar format COMPLET del paràgraf
  const fullFormat = captureFormatAttributes(textObj, 0, oldText.length - 1);

  // 2. Capturar atributs de paràgraf
  const paragraphAttrs = {
    heading: element.getHeading ? element.getHeading() : null,
    alignment: element.getAlignment ? element.getAlignment() : null,
    lineSpacing: element.getLineSpacing ? element.getLineSpacing() : null,
    spaceBefore: element.getSpacingBefore ? element.getSpacingBefore() : null,
    spaceAfter: element.getSpacingAfter ? element.getSpacingAfter() : null,
    indentStart: element.getIndentStart ? element.getIndentStart() : null,
    indentEnd: element.getIndentEnd ? element.getIndentEnd() : null,
    indentFirstLine: element.getIndentFirstLine ? element.getIndentFirstLine() : null
  };

  // 3. Determinar format dominant (el més freqüent)
  const dominantFormat = getDominantFormat(fullFormat);

  // 4. Reemplaçar text
  textObj.setText(newText);

  // 5. Aplicar format dominant a tot el text nou
  if (newText.length > 0) {
    applyUniformFormat(textObj, 0, newText.length - 1, dominantFormat);
  }

  // 6. Restaurar atributs de paràgraf
  restoreParagraphAttributes(element, paragraphAttrs);

  return true;
}
```

#### ESTRATÈGIA D: Diff Intel·ligent (canvis parcials)
```javascript
function applyDiffPreservingFormat(element, oldText, newText) {
  // Usar diff per trobar canvis mínims
  const diffs = computeTextDiff(oldText, newText);

  const textObj = element.editAsText();

  // Processar diffs en ordre INVERS (per no desplaçar índexs)
  for (let i = diffs.length - 1; i >= 0; i--) {
    const diff = diffs[i];

    switch (diff.type) {
      case 'equal':
        // No fer res
        break;

      case 'delete':
        textObj.deleteText(diff.startOld, diff.endOld);
        break;

      case 'insert':
        // Capturar format del punt d'inserció
        const insertFormat = captureFormatAttributes(textObj, diff.position, diff.position)[0];
        textObj.insertText(diff.position, diff.text);
        applyUniformFormat(textObj, diff.position, diff.position + diff.text.length - 1, insertFormat);
        break;

      case 'replace':
        // Capturar format abans d'eliminar
        const replaceFormat = captureFormatAttributes(textObj, diff.startOld, diff.startOld)[0];
        textObj.deleteText(diff.startOld, diff.endOld);
        textObj.insertText(diff.startOld, diff.newText);
        applyUniformFormat(textObj, diff.startOld, diff.startOld + diff.newText.length - 1, replaceFormat);
        break;
    }
  }

  return true;
}
```

---

## 3. Implementació per Mode

### 3.1 Mode FIX (correccions ortogràfiques)
```
ENTRADA: { paragraph_id: 7, original: "paràgraf amb dde", new: "paràgraf amb de" }

PROCÉS:
1. Detectar que és substitució simple (diff = "dde" → "de")
2. Usar ESTRATÈGIA A: replaceWordPreservingFormat()
3. Format 100% preservat

RESULTAT: Només "dde" canvia a "de", resta intacta
```

### 3.2 Mode IMPROVE (millores d'estil)
```
ENTRADA: { paragraph_id: 3, original: "frase molt llarga...", new: "frase curta..." }

PROCÉS:
1. Calcular diff entre original i nou
2. Si canvis < 30% del text → ESTRATÈGIA D (diff)
3. Si canvis > 30% → ESTRATÈGIA C (rewrite amb format dominant)

RESULTAT: Format preservat en la mesura del possible
```

### 3.3 Mode EXPAND (expansió)
```
ENTRADA: { paragraph_id: 5, original: "text curt", new: "text curt amb més detalls" }

PROCÉS:
1. Detectar que és ADDICIÓ (nou conté original)
2. Trobar punt d'inserció
3. Capturar format del punt d'inserció
4. Inserir text nou amb format capturat

RESULTAT: Text afegit hereta format del context
```

### 3.4 Mode REWRITE (reescriptura)
```
ENTRADA: { paragraphs: [1,2,3], new_text: "tot nou" }

PROCÉS:
1. Capturar format dominant de cada paràgraf
2. Capturar atributs de paràgraf (heading, spacing, etc.)
3. Aplicar text nou
4. Restaurar format dominant i atributs

RESULTAT: Estructura i estil visual preservats
```

### 3.5 Mode UNDO (desfer)
```
ENTRADA: { targetId: 7, originalText: "text original", originalFormat: [...] }

PROCÉS:
1. Guardar format quan es fa el canvi (no només text!)
2. Al desfer, restaurar text + format

CANVI NECESSARI: lastEdit ha d'incloure formatSnapshot
```

---

## 4. Canvis al Backend (Worker)

### 4.1 Resposta enriquida per FIX
```javascript
// Actual
{
  "changes": [{
    "paragraph_id": 7,
    "original_text": "paràgraf complet...",
    "new_text": "paràgraf complet corregit...",
    "explanation": "'dde' → 'de'"
  }]
}

// NOU: Afegir detall dels canvis específics
{
  "changes": [{
    "paragraph_id": 7,
    "original_text": "paràgraf complet...",
    "new_text": "paràgraf complet corregit...",
    "explanation": "'dde' → 'de'",
    "word_changes": [
      { "old": "dde", "new": "de", "index": 45 }
    ]
  }]
}
```

### 4.2 Actualitzar prompts per incloure word_changes
El prompt de `fix` ha de retornar també els canvis específics:
```
## OUTPUT AMPLIAT
{
  "changes": [{
    "paragraph_id": <número>,
    "original_text": "<text complet>",
    "new_text": "<text complet corregit>",
    "word_changes": [
      { "old": "<paraula incorrecta>", "new": "<correcció>" }
    ]
  }]
}
```

---

## 5. Ordre d'Implementació

| Fase | Tasca | Fitxer | Prioritat |
|------|-------|--------|-----------|
| 1 | Crear mòdul FormatPreserver | Code.gs | ALTA |
| 2 | Implementar captureFormatAttributes | Code.gs | ALTA |
| 3 | Implementar applyFormatAttributes | Code.gs | ALTA |
| 4 | Actualitzar FIX per usar replaceText | Code.gs | ALTA |
| 5 | Actualitzar UNDO per guardar format | Code.gs | ALTA |
| 6 | Actualitzar prompt FIX per word_changes | update.js | MITJANA |
| 7 | Implementar diff intel·ligent | Code.gs | MITJANA |
| 8 | Actualitzar IMPROVE per usar diff | Code.gs | MITJANA |
| 9 | Actualitzar REWRITE amb format dominant | Code.gs | MITJANA |
| 10 | Testing exhaustiu | - | ALTA |

---

## 6. Casos de Test

### 6.1 Test: Correcció simple preserva format
```
INPUT:  "Text amb **negreta** i dde error"
FIX:    "dde" → "de"
OUTPUT: "Text amb **negreta** i de error"
CHECK:  Negreta intacta ✓
```

### 6.2 Test: Expansió hereta format
```
INPUT:  "Text en Arial 12pt"
EXPAND: Afegir " amb més detalls"
OUTPUT: "Text en Arial 12pt amb més detalls"
CHECK:  "amb més detalls" també en Arial 12pt ✓
```

### 6.3 Test: Rewrite preserva estil dominant
```
INPUT:  "Títol en Arial 14pt Bold\nCos en Times 11pt"
REWRITE: Tot el document
OUTPUT: "Nou títol" (Arial 14pt Bold) + "Nou cos" (Times 11pt)
CHECK:  Estructura font/mida preservada ✓
```

### 6.4 Test: Undo restaura format
```
ORIGINAL: "Text **negreta** i color vermell"
CANVI:    "Text modificat"
UNDO:     → "Text **negreta** i color vermell"
CHECK:    Negreta i color restaurats ✓
```

---

## 7. Riscos i Mitigacions

| Risc | Probabilitat | Impacte | Mitigació |
|------|--------------|---------|-----------|
| Performance amb docs grans | Mitjana | Alt | Cache de format, processament per lots |
| Edge cases amb format mixt | Alta | Mitjà | Usar format dominant, tests exhaustius |
| Incompatibilitat amb headings | Baixa | Alt | Tractar headings separadament |
| Race conditions | Baixa | Alt | Operacions atòmiques, locks |

---

## 8. Aprovació

- [ ] Arquitectura validada
- [ ] Prioritats acordades
- [ ] Puc començar implementació?
