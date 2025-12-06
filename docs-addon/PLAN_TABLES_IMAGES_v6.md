# PLA ULTRATHINK: Implementació Completa de Taules i Imatges
## Docmile v6.0 - Multimodal

**Data:** 2024-12
**Versió:** 1.0
**Estat:** ✅ IMPLEMENTAT

---

## VISIÓ GENERAL DEL PROJECTE

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DOCMILE v6.0 - MULTIMODAL                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   FASE 1          FASE 2              FASE 3              FASE 4            │
│   ────────        ────────            ────────            ────────          │
│   Generació   →   Descripció      →   Edició          →   Integració       │
│   Taules          Imatges             Taules              & Polish          │
│                                                                             │
│   [2-3 dies]      [5-7 dies]          [7-10 dies]         [3-5 dies]       │
│                                                                             │
│   Risc: BAIX      Risc: MITJÀ         Risc: MITJÀ-ALT     Risc: BAIX       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

# FASE 1: GENERACIÓ DE TAULES (REWRITE MODE)

## 1.1 Modificar System Prompt per Taules

### Tasca 1.1.1: Afegir Documentació de Taules al Prompt
**Fitxer:** `worker/worker.js`
**Funció:** `buildSystemPrompt()`

```javascript
const TABLE_BLOCK_DOCS = `
═══ BLOC TIPUS TABLE ═══
Quan necessitis crear una taula, usa aquest format:
{
  "type": "TABLE",
  "headers": ["Cap1", "Cap2", "Cap3"],
  "rows": [
    ["Fila1Col1", "Fila1Col2", "Fila1Col3"],
    ["Fila2Col1", "Fila2Col2", "Fila2Col3"]
  ]
}

REGLES:
- headers: Array de strings (capçaleres de columna)
- rows: Array d'arrays (cada array intern és una fila)
- Totes les files han de tenir el MATEIX nombre d'elements que headers
- Usa strings sempre, fins i tot per números
- Màxim recomanat: 10 columnes, 50 files
`;
```

**Subtasques:**
- [ ] 1.1.1.a - Localitzar funció `buildSystemPrompt()` al worker.js
- [ ] 1.1.1.b - Identificar secció de documentació REWRITE mode
- [ ] 1.1.1.c - Afegir `TABLE_BLOCK_DOCS` constant
- [ ] 1.1.1.d - Incloure al prompt final

### Tasca 1.1.2: Afegir TABLE a la Llista de Tipus Vàlids
**Fitxer:** `worker/worker.js`
**Funció:** `validateResponse()`

```javascript
const VALID_BLOCK_TYPES = [
  'HEADING_1', 'HEADING_2', 'HEADING_3',
  'PARAGRAPH', 'BULLET_LIST', 'NUMBERED_LIST',
  'TABLE'  // ← AFEGIR
];
```

**Subtasques:**
- [ ] 1.1.2.a - Localitzar validació de tipus de blocs
- [ ] 1.1.2.b - Afegir 'TABLE' a la llista

---

## 1.2 Validació de Blocs TABLE

### Tasca 1.2.1: Crear Funció de Validació de Taula
**Fitxer:** `worker/worker.js`

```javascript
function validateTableBlock(tableBlock) {
  const errors = [];

  if (!tableBlock.headers) {
    errors.push('TABLE: Falta camp "headers"');
  } else if (!Array.isArray(tableBlock.headers)) {
    errors.push('TABLE: "headers" ha de ser un array');
  } else if (tableBlock.headers.length === 0) {
    errors.push('TABLE: "headers" no pot estar buit');
  } else if (tableBlock.headers.length > 10) {
    errors.push('TABLE: Màxim 10 columnes permeses');
  }

  if (!tableBlock.rows) {
    errors.push('TABLE: Falta camp "rows"');
  } else if (!Array.isArray(tableBlock.rows)) {
    errors.push('TABLE: "rows" ha de ser un array');
  } else if (tableBlock.rows.length > 50) {
    errors.push('TABLE: Màxim 50 files permeses');
  }

  if (tableBlock.headers && tableBlock.rows &&
      Array.isArray(tableBlock.headers) && Array.isArray(tableBlock.rows)) {
    const numCols = tableBlock.headers.length;
    for (let i = 0; i < tableBlock.rows.length; i++) {
      const row = tableBlock.rows[i];
      if (!Array.isArray(row)) {
        errors.push(`TABLE: Fila ${i} no és un array`);
      } else if (row.length !== numCols) {
        errors.push(`TABLE: Fila ${i} té ${row.length} columnes, esperades ${numCols}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
```

**Subtasques:**
- [ ] 1.2.1.a - Crear funció `validateTableBlock()`
- [ ] 1.2.1.b - Validar headers
- [ ] 1.2.1.c - Validar rows
- [ ] 1.2.1.d - Validar consistència columnes

### Tasca 1.2.2: Integrar Validació a validateResponse()
**Subtasques:**
- [ ] 1.2.2.a - Localitzar loop de validació de blocks
- [ ] 1.2.2.b - Afegir condicional per tipus TABLE
- [ ] 1.2.2.c - Cridar validateTableBlock()

---

## 1.3 Aplicació de Blocs TABLE a Google Docs

### Tasca 1.3.1: Crear Funció insertTableFromBlock()
**Fitxer:** `docs-addon/Code.gs`

```javascript
function insertTableFromBlock(body, insertIndex, tableData) {
  try {
    const numRows = tableData.rows.length + 1;
    const numCols = tableData.headers.length;
    const cells = [];

    cells.push(tableData.headers.map(h => String(h)));
    for (const row of tableData.rows) {
      cells.push(row.map(cell => String(cell)));
    }

    const table = body.insertTable(insertIndex, cells);

    const headerRow = table.getRow(0);
    for (let c = 0; c < numCols; c++) {
      headerRow.getCell(c).editAsText().setBold(true);
    }

    return { success: true, table, stats: { rows: numRows, cols: numCols } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
```

**Subtasques:**
- [ ] 1.3.1.a - Crear funció `insertTableFromBlock()`
- [ ] 1.3.1.b - Preparar matriu de cel·les
- [ ] 1.3.1.c - Formatar headers amb negreta
- [ ] 1.3.1.d - Gestió d'errors

### Tasca 1.3.2: Modificar applyRewrite() per Suportar TABLE
**Subtasques:**
- [ ] 1.3.2.a - Localitzar funció `applyRewrite()`
- [ ] 1.3.2.b - Afegir case 'TABLE'
- [ ] 1.3.2.c - Cridar `insertTableFromBlock()`
- [ ] 1.3.2.d - Actualitzar estadístiques

---

## 1.4 Tests Fase 1

- [ ] 1.4.1.a - Test: Taula simple des de zero
- [ ] 1.4.1.b - Test: Taula comparativa
- [ ] 1.4.1.c - Test: Conversió llista → taula
- [ ] 1.4.1.d - Test: Taula amb moltes files (20+)
- [ ] 1.4.1.e - Test: Error handling

---

# FASE 2: DESCRIPCIÓ D'IMATGES (MULTIMODAL INPUT)

## 2.1 Extracció d'Imatges a Code.gs

### Tasca 2.1.1: Crear Funció extractImageAsBase64()
**Fitxer:** `docs-addon/Code.gs`

```javascript
const IMAGE_CONFIG = {
  MAX_SIZE_KB: 500,
  MAX_IMAGES: 3,
  MAX_TOTAL_KB: 1500,
  SUPPORTED_TYPES: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  EXTRACTION_TIMEOUT_MS: 5000
};

function extractImageAsBase64(inlineImage, index) {
  try {
    const blob = inlineImage.getBlob();
    const mimeType = blob.getContentType();

    if (!IMAGE_CONFIG.SUPPORTED_TYPES.includes(mimeType)) {
      return { success: false, index, error: `Tipus no suportat: ${mimeType}`, skipped: true };
    }

    const bytes = blob.getBytes();
    const sizeKB = Math.round(bytes.length / 1024);

    if (sizeKB > IMAGE_CONFIG.MAX_SIZE_KB) {
      return { success: false, index, error: `Massa gran: ${sizeKB}KB`, sizeKB, skipped: true };
    }

    const base64 = Utilities.base64Encode(bytes);
    return { success: true, index, data: base64, mimeType, sizeKB };
  } catch (e) {
    return { success: false, index, error: e.message, skipped: true };
  }
}
```

**Subtasques:**
- [ ] 2.1.1.a - Crear constants IMAGE_CONFIG
- [ ] 2.1.1.b - Implementar extractImageAsBase64()
- [ ] 2.1.1.c - Validar tipus MIME
- [ ] 2.1.1.d - Validar mida
- [ ] 2.1.1.e - Gestió d'errors

### Tasca 2.1.2: Crear Funció extractDocumentImages()
**Subtasques:**
- [ ] 2.1.2.a - Crear funció
- [ ] 2.1.2.b - Timeout check
- [ ] 2.1.2.c - Límit d'imatges
- [ ] 2.1.2.d - Buscar imatges dins paràgrafs
- [ ] 2.1.2.e - Generar warnings

### Tasca 2.1.3: Crear Detector d'Instruccions d'Imatge
**Subtasques:**
- [ ] 2.1.3.a - Crear shouldExtractImages()
- [ ] 2.1.3.b - Patrons directes (imatge, foto, gràfic)
- [ ] 2.1.3.c - Patrons d'acció (descriu, què mostra)
- [ ] 2.1.3.d - Suport multilingüe

### Tasca 2.1.4: Integrar a processUserCommand()
**Subtasques:**
- [ ] 2.1.4.a - Cridar shouldExtractImages()
- [ ] 2.1.4.b - Cridar extractDocumentImages()
- [ ] 2.1.4.c - Afegir al payload

---

## 2.2 Modificacions al Worker

### Tasca 2.2.1: Modificar Contents per Imatges
```javascript
if (images && Array.isArray(images) && images.length > 0) {
  for (const img of images) {
    if (img.data && img.mimeType) {
      userParts.push({
        inlineData: { mimeType: img.mimeType, data: img.data }
      });
    }
  }
}
```

**Subtasques:**
- [ ] 2.2.1.a - Extreure images del body
- [ ] 2.2.1.b - Afegir inlineData per cada imatge
- [ ] 2.2.1.c - Logging

### Tasca 2.2.2: Actualitzar System Prompt per Imatges
**Subtasques:**
- [ ] 2.2.2.a - Crear IMAGE_CAPABILITIES_PROMPT
- [ ] 2.2.2.b - Afegir condicionalment al prompt

---

## 2.3 Tests Fase 2

- [ ] 2.3.1.a - Document amb imatge PNG petita
- [ ] 2.3.1.b - Document amb imatge gran (>500KB)
- [ ] 2.3.1.c - Document amb 5+ imatges
- [ ] 2.3.1.d - Test OCR
- [ ] 2.3.1.e - Test correlació text/imatge

---

# FASE 3: EDICIÓ DE TAULES (TABLE_UPDATE MODE)

## 3.1 Infraestructura

### Tasca 3.1.1: Crear tableMap
**Subtasques:**
- [ ] 3.1.1.a - Modificar processElement per taules
- [ ] 3.1.1.b - Guardar referència a element
- [ ] 3.1.1.c - Guardar dimensions

### Tasca 3.1.2: Crear findTableById()
**Subtasques:**
- [ ] 3.1.2.a - Crear funció
- [ ] 3.1.2.b - Iterar body buscant taules

---

## 3.2 Mode TABLE_UPDATE

### Tasca 3.2.1: Esquema de Resposta
```javascript
{
  mode: 'TABLE_UPDATE',
  thought: 'string',
  table_id: 'number',
  operations: [
    { action: 'update_cell', row: 0, col: 0, value: 'text' },
    { action: 'add_row', after_row: 0, values: ['a', 'b'] },
    { action: 'delete_row', row: 0 },
    { action: 'update_row', row: 0, values: ['a', 'b'] }
  ],
  change_summary: 'string'
}
```

### Tasca 3.2.2: Actualitzar System Prompt
**Subtasques:**
- [ ] 3.2.2.a - Crear TABLE_UPDATE_PROMPT
- [ ] 3.2.2.b - Documentar operacions
- [ ] 3.2.2.c - Afegir exemples

### Tasca 3.2.3: Validació TABLE_UPDATE
**Subtasques:**
- [ ] 3.2.3.a - Crear validateTableUpdate()
- [ ] 3.2.3.b - Validar table_id
- [ ] 3.2.3.c - Validar operations
- [ ] 3.2.3.d - Integrar a validateResponse()

---

## 3.3 Aplicació d'Operacions

### Tasca 3.3.1: Crear applyTableOperations()
**Subtasques:**
- [ ] 3.3.1.a - Trobar taula per ID
- [ ] 3.3.1.b - Ordenar operacions
- [ ] 3.3.1.c - Aplicar cada operació
- [ ] 3.3.1.d - Recollir estadístiques

### Tasca 3.3.2: Crear sortTableOperations()
**Subtasques:**
- [ ] 3.3.2.a - Separar deletes
- [ ] 3.3.2.b - Ordenar deletes descendent

### Tasca 3.3.3: Crear funcions d'operació
**Subtasques:**
- [ ] 3.3.3.a - applyUpdateCell()
- [ ] 3.3.3.b - applyAddRow()
- [ ] 3.3.3.c - applyDeleteRow()
- [ ] 3.3.3.d - applyUpdateRow()

### Tasca 3.3.4: Integrar a processUserCommand()
**Subtasques:**
- [ ] 3.3.4.a - Afegir case 'TABLE_UPDATE'
- [ ] 3.3.4.b - Cridar applyTableOperations()

---

## 3.4 Tests Fase 3

- [ ] 3.4.1.a - Test update_cell
- [ ] 3.4.1.b - Test add_row
- [ ] 3.4.1.c - Test delete_row
- [ ] 3.4.1.d - Test múltiples operacions
- [ ] 3.4.1.e - Test errors (fora rang)

---

# FASE 4: INTEGRACIÓ I POLISH

## 4.1 UI/UX
- [ ] 4.1.1 - Preview canvis de taula
- [ ] 4.1.2 - Feedback processament imatges
- [ ] 4.1.3 - Indicadors de progrés

## 4.2 Documentació
- [ ] 4.2.1 - Actualitzar README
- [ ] 4.2.2 - Documentar nous modes
- [ ] 4.2.3 - Exemples d'ús

## 4.3 Performance
- [ ] 4.3.1 - Benchmark extracció imatges
- [ ] 4.3.2 - Benchmark operacions taula
- [ ] 4.3.3 - Optimitzacions

---

# RESUM

| Fase | Tasques | Subtasques | Estimació |
|------|---------|------------|-----------|
| 1. Generació Taules | 6 | 23 | 2-3 dies |
| 2. Descripció Imatges | 11 | 38 | 5-7 dies |
| 3. Edició Taules | 13 | 42 | 7-10 dies |
| 4. Integració | 5 | 15 | 3-5 dies |
| **TOTAL** | **35** | **118** | **17-25 dies** |

---

# PROGRÉS

## Fase 1: Generació de Taules ✅
- [x] 1.1.1 - System Prompt (worker.js:847-884)
- [x] 1.1.2 - Validació tipus (worker.js:1228-1232)
- [x] 1.2.1 - validateTableBlock() (worker.js:1252-1276)
- [x] 1.2.2 - Integrar validació (worker.js:1246-1277)
- [x] 1.3.1 - insertTableFromBlock() (Code.gs:2356-2401)
- [x] 1.3.2 - Modificar renderFullDocument() (Code.gs:2334-2339)
- [ ] 1.4 - Tests (PENDENT - manual)

## Fase 2: Descripció d'Imatges ✅
- [x] 2.1.1 - extractImageAsBase64() (Code.gs:2459-2480)
- [x] 2.1.2 - extractDocumentImages() (Code.gs:2487-2575)
- [x] 2.1.3 - shouldExtractImages() (Code.gs:2420-2451)
- [x] 2.1.4 - Integrar a processUserCommand() (Code.gs:1296-1311)
- [x] 2.2.1 - Worker: inlineData (worker.js:1695-1712)
- [x] 2.2.2 - Worker: Prompt imatges (worker.js:674)
- [ ] 2.3 - Tests (PENDENT - manual)

## Fase 3: Edició de Taules ✅
- [x] 3.1.1 - tableMap (no necessari - usem findTableById)
- [x] 3.1.2 - findTableById() (Code.gs:2587-2601)
- [x] 3.2.1 - Esquema TABLE_UPDATE (worker.js:865-884)
- [x] 3.2.2 - Prompt TABLE_UPDATE (worker.js:865-884)
- [x] 3.2.3 - Validació TABLE_UPDATE (worker.js:1279-1310)
- [x] 3.3.1 - applyTableOperations() (Code.gs:2681-2731)
- [x] 3.3.2 - sortTableOperations() (Code.gs:2607-2623)
- [x] 3.3.3 - Funcions d'operació (Code.gs:2628-2673)
- [x] 3.3.4 - Integrar (Code.gs:1398-1437)
- [ ] 3.4 - Tests (PENDENT - manual)

## Fase 4: Integració
- [ ] 4.1 - UI/UX (PENDENT)
- [x] 4.2 - Documentació (aquest fitxer)
- [ ] 4.3 - Performance (PENDENT)
