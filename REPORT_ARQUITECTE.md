# REPORT TÈCNIC - SideCar Google Docs Add-on
**Data:** 2024-11-29
**Problema:** El sidebar no es renderitza correctament a Google Apps Script

---

## 1. ARQUITECTURA DEL SISTEMA

```
┌─────────────────────────────────────────────────────────────────┐
│                      GOOGLE DOCS                                │
│  ┌─────────────────┐    ┌─────────────────────────────────┐    │
│  │    Code.gs      │───▶│        Sidebar.html             │    │
│  │  (Server-side)  │    │  (Client-side HTML/CSS/JS)      │    │
│  └────────┬────────┘    └─────────────────────────────────┘    │
└───────────┼─────────────────────────────────────────────────────┘
            │ UrlFetchApp.fetch()
            ▼
┌─────────────────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKER                                  │
│         https://sidecar-api.conteucontes.workers.dev            │
│                                                                 │
│  Endpoints:                                                     │
│  - POST (default) → handleChat() → Gemini AI                   │
│  - action: upload_file → handleFileUpload() → Google File API  │
│  - action: get_receipts → handleGetReceipts() → Supabase       │
│  - action: save_receipt → handleSaveReceipt() → Supabase       │
│  - action: delete_receipt → handleDeleteReceipt() → Supabase   │
└────────────┬────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE                                 │
│           https://qlvurumbindbykymryim.supabase.co              │
│                                                                 │
│  Taules:                                                        │
│  - licenses (llicències d'usuari)                              │
│  - user_receipts (macros personalitzades)                      │
│                                                                 │
│  RPC:                                                           │
│  - use_license_credits(hash, cost, operation, metadata)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. FITXERS DEL PROJECTE

### 2.1 Google Apps Script (docs-addon/)

**IMPORTANT:** Google Apps Script requereix **DOS FITXERS SEPARATS**:

| Fitxer | Tipus | Funció |
|--------|-------|--------|
| `Code.gs` | Script | Codi servidor (Google Apps Script) |
| `Sidebar.html` | HTML | Interfície d'usuari (HTML/CSS/JS client) |

### 2.2 Cloudflare Worker (worker/)

| Fitxer | Funció |
|--------|--------|
| `worker.js` | API principal desplegada a Cloudflare |
| `wrangler.toml` | Configuració del worker |

### 2.3 Supabase (supabase/)

| Fitxer | Funció |
|--------|--------|
| `schema_receipts.sql` | Esquema de la taula user_receipts |

---

## 3. PROBLEMA ACTUAL

### 3.1 Símptoma Reportat
L'usuari indica que el sidebar mostra contingut incorrecte (possiblement codi en lloc de la UI).

### 3.2 Causa Probable
Google Apps Script no està trobant el fitxer `Sidebar.html` o el contingut no s'ha copiat correctament.

La funció crítica és:
```javascript
function showSidebar() {
  const html = HtmlService.createTemplateFromFile('Sidebar').evaluate().setTitle('SideCar AI');
  DocumentApp.getUi().showSidebar(html);
}
```

`createTemplateFromFile('Sidebar')` busca un fitxer HTML anomenat exactament **"Sidebar"** (sense extensió).

### 3.3 Possibles Errors

1. **No existeix el fitxer Sidebar.html** com a fitxer separat a Apps Script
2. **El fitxer té un nom diferent** (ex: "Sidebar.html.html", "sidebar", etc.)
3. **El contingut HTML s'ha enganxat dins de Code.gs** en lloc d'un fitxer HTML separat
4. **Cache del navegador** mostra versió antiga

---

## 4. CODI ACTUAL

### 4.1 Code.gs (357 línies)

```javascript
// --- CONFIGURACIÓ ---
const API_URL = 'https://sidecar-api.conteucontes.workers.dev';

function onOpen() {
  showSidebar();
}

function showSidebar() {
  const html = HtmlService.createTemplateFromFile('Sidebar').evaluate().setTitle('SideCar AI');
  DocumentApp.getUi().showSidebar(html);
}

// Funcions principals:
// - saveSettings(jsonSettings)
// - getSettings()
// - saveFileUri(uri, name, mime)
// - getKnowledgeFileInfo()
// - clearKnowledgeFile()
// - uploadFileToWorker(base64Data, mimeType, fileName)
// - processUserCommand(instruction)
// - updateParagraphPreservingAttributes(element, newMarkdownText)
// - applyInlineMarkdown(element, originalMarkdown)
// - renderFullDocument(body, blocks)
// - getReceiptsFromWorker()
// - saveReceiptToWorker(label, instruction, icon)
// - deleteReceiptFromWorker(receiptId)
```

### 4.2 Sidebar.html (497 línies)

```html
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <link rel="stylesheet" href="https://ssl.gstatic.com/docs/script/css/add-ons1.css">
    <style>
      /* CSS complet amb 3 pestanyes: Xat, Eines, Cervell */
      /* Inclou estils per: tabs, chat bubbles, thinking indicator, receipts grid */
    </style>
  </head>
  <body>
    <div class="tabs">
      <div class="tab active" onclick="switchTab('chat')">Xat</div>
      <div class="tab" onclick="switchTab('tools')">Eines</div>
      <div class="tab" onclick="switchTab('brain')">Cervell</div>
    </div>

    <!-- Panel Xat -->
    <!-- Panel Eines (Receipts) -->
    <!-- Panel Cervell (Configuració) -->
    <!-- Footer amb input -->

    <script>
      // JavaScript client-side
      // Funcions: switchTab, sendMessage, addBubble, showThinking, hideThinking
      // Receipts: loadReceipts, saveNewReceipt, deleteReceipt, runReceipt
    </script>
  </body>
</html>
```

---

## 5. INSTRUCCIONS DE CONFIGURACIÓ A GOOGLE APPS SCRIPT

### Pas 1: Accedir a l'Editor
1. Obre el document de Google Docs
2. Extensions → Apps Script

### Pas 2: Crear l'Estructura de Fitxers
```
📁 Projecte Apps Script
├── Code.gs          ← Fitxer per defecte (tipus: Script)
└── Sidebar.html     ← CREAR NOU (tipus: HTML)
```

### Pas 3: Crear el Fitxer HTML
1. Clica el botó **`+`** al costat de "Fitxers"
2. Selecciona **"HTML"**
3. Escriu el nom: **Sidebar** (EXACTAMENT, sense extensió)
4. Apps Script afegirà automàticament l'extensió .html

### Pas 4: Copiar el Contingut
1. **Code.gs**: Esborra tot i enganxa el codi JavaScript
2. **Sidebar.html**: Esborra tot i enganxa el codi HTML complet

### Pas 5: Guardar i Executar
1. Ctrl+S per guardar
2. Tanca i reobre el document de Google Docs
3. El sidebar hauria d'aparèixer automàticament

---

## 6. VERIFICACIÓ

### 6.1 A Google Apps Script
- [ ] Existeixen exactament 2 fitxers: `Code.gs` i `Sidebar.html`
- [ ] `Sidebar.html` és de tipus HTML (icona diferent de Code.gs)
- [ ] El nom és exactament "Sidebar" (no "sidebar", no "Sidebar.html.html")

### 6.2 Test Manual
Executar a l'editor d'Apps Script:
1. Seleccionar funció: `showSidebar`
2. Clicar "Executar"
3. Revisar el log d'execució per errors

### 6.3 Depuració
Si hi ha error, afegir logging temporal:
```javascript
function showSidebar() {
  try {
    const html = HtmlService.createTemplateFromFile('Sidebar').evaluate().setTitle('SideCar AI');
    DocumentApp.getUi().showSidebar(html);
    Logger.log('Sidebar obert correctament');
  } catch (e) {
    Logger.log('ERROR: ' + e.message);
    DocumentApp.getUi().alert('Error: ' + e.message);
  }
}
```

---

## 7. ENDPOINTS DEL WORKER (Verificats)

```bash
# Test bàsic
curl -X POST https://sidecar-api.conteucontes.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"license_key":"TEST","text":"Hola","user_instruction":"test"}'

# Test receipts
curl -X POST https://sidecar-api.conteucontes.workers.dev \
  -H "Content-Type: application/json" \
  -d '{"action":"get_receipts","license_key":"SIDECAR-TEST-1234"}'
```

---

## 8. VARIABLES D'ENTORN (Cloudflare Worker)

| Variable | Valor |
|----------|-------|
| `SUPABASE_URL` | https://qlvurumbindbykymryim.supabase.co |
| `SUPABASE_SERVICE_ROLE_KEY` | [SECRET] |
| `GEMINI_API_KEY` | [SECRET] |

---

## 9. CHECKLIST FINAL

- [x] Worker desplegat a Cloudflare
- [x] Taula user_receipts creada a Supabase
- [x] Code.gs amb totes les funcions
- [x] Sidebar.html amb UI completa
- [ ] **PENDENT: Verificar configuració a Google Apps Script de l'usuari**

---

## 10. CONTACTE

Per més informació o suport:
- Repositori local: `C:\aidoc\`
- Worker URL: https://sidecar-api.conteucontes.workers.dev
