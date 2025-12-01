# Pla de Correcció de Bugs v3.3 - UltraThink Analysis

## Resum Executiu

Anàlisi exhaustiva del codi ha revelat **10 problemes** de diverses severitats. Aquest pla detalla les correccions necessàries, ordenades per prioritat.

---

## Inventari de Problemes

| # | Severitat | Problema | Fitxer | Línies |
|---|-----------|----------|--------|--------|
| 1 | 🚨 CRÍTIC | `runReceipt()` no passa `previewModeEnabled` | Sidebar.html | 2564 |
| 2 | 🚨 CRÍTIC | XSS potencial a `addBubble()` | Sidebar.html | 2365 |
| 3 | 🚨 CRÍTIC | Race condition a `applyPendingChanges` | Code.gs | 565-643 |
| 4 | ⚠️ IMPORTANT | `getRecentHistory()` no neteja badge complet | Sidebar.html | 2251-2254 |
| 5 | ⚠️ IMPORTANT | `escapeHtml` definida dues vegades | Sidebar.html | 2680, 2859 |
| 6 | ⚠️ IMPORTANT | Debug code visible en producció | Sidebar.html + Code.gs | múltiples |
| 7 | ⚠️ IMPORTANT | localStorage keys amb prefix `SIDECAR_` | Code.gs | 61,66,78-80,103,107 |
| 8 | 🔧 MENOR | No timeout visual a `applyPreviewedChanges` | Sidebar.html | 2919-2949 |
| 9 | 🔧 MENOR | `runReceipt` no gestiona preview response | Sidebar.html | 2549-2558 |
| 10 | 🔧 MENOR | Falta validació `res.thought.substring()` | Sidebar.html | 2296 |

---

## Fase 1: Correccions Crítiques

### 1.1 Fix `runReceipt()` - Afegir `previewModeEnabled`

**Problema**: La funció no passa el 4t paràmetre, ignorant el preview mode.

**Solució**:
```javascript
// ABANS (línia 2564):
.processUserCommand(instruction, getRecentHistory(), getCurrentMode());

// DESPRÉS:
.processUserCommand(instruction, getRecentHistory(), getCurrentMode(), previewModeEnabled);
```

**Addicionalment**, cal actualitzar el handler per gestionar respostes de preview:
```javascript
function runReceipt(instruction, label) {
  switchTab('chat');
  addBubble('user', '🎯 ' + label);
  showThinking();

  document.getElementById('sendBtn').disabled = true;

  google.script.run
    .withSuccessHandler(function(res) {
      hideThinking();
      document.getElementById('sendBtn').disabled = false;

      // v3.3: Handle Preview Mode response (same as sendMessage)
      if (res.status === 'preview' && res.changes && res.changes.length > 0) {
        showPreviewPanel(res.changes, res.ai_response);
        if (res.credits !== undefined) {
          document.getElementById('creditsDisplay').innerHTML =
            '<span class="icon">⚡</span> ' + res.credits + ' credits';
        }
        return;
      }

      // Normal response
      addBubble('ai', res.ai_response, res.mode === 'edit', res.last_edit_word);
      if (res.credits !== undefined) {
        document.getElementById('creditsDisplay').innerHTML =
          '<span class="icon">⚡</span> ' + res.credits + ' credits';
      }
      // Show undo bar if edit was made
      if (res.mode === 'edit' && res.undo_snapshot) {
        pendingUndo = res.undo_snapshot;
        showUndoBar();
      }
    })
    .withFailureHandler(function(err) {
      hideThinking();
      document.getElementById('sendBtn').disabled = false;
      addBubble('error', 'Error: ' + err.message);
    })
    .processUserCommand(instruction, getRecentHistory(), getCurrentMode(), previewModeEnabled);
}
```

---

### 1.2 Fix XSS a `addBubble()`

**Problema**: `text` de l'IA s'insereix directament com HTML.

**Solució**:
```javascript
// ABANS (línia 2365):
bubble.innerHTML = badgeHtml + text;

// DESPRÉS:
if (type === 'ai' && isEdit) {
  // Badge HTML és segur (generat internament)
  // Text de l'IA s'ha d'escapar
  const textSpan = document.createElement('span');
  textSpan.innerText = text;
  bubble.innerHTML = badgeHtml;
  bubble.appendChild(textSpan);
} else {
  bubble.innerText = text;
}
```

**Alternativa més simple** (si volem permetre alguns formats):
```javascript
// Escapar el text abans d'inserir
function sanitizeAIResponse(text) {
  // Permet només salts de línia, res més
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// A addBubble:
if (type === 'ai' && isEdit) {
  bubble.innerHTML = badgeHtml + sanitizeAIResponse(text);
} else if (type === 'error') {
  // Errors poden tenir HTML per botons
  bubble.innerHTML = text;
} else {
  bubble.innerText = text;
}
```

---

### 1.3 Fix Race Condition a `applyPendingChanges`

**Problema**: Entre preview i apply, el document pot canviar.

**Solució**: Guardar un "snapshot hash" del document quan es genera el preview, i verificar-lo abans d'aplicar.

**Code.gs - Afegir hash al preview response**:
```javascript
// A processUserCommand, quan retornem preview (línia 477):
return {
  ok: true,
  status: 'preview',
  changes: changes,
  ai_response: aiData.change_summary,
  credits: json.credits_remaining,
  thought: aiData.thought,
  mode: 'edit',
  // v3.3: Afegir snapshot per detectar canvis
  doc_snapshot: contentPayload.substring(0, 500) // Primeres línies com fingerprint
};
```

**Code.gs - Verificar a `applyPendingChanges`**:
```javascript
function applyPendingChanges(changes, expectedSnapshot) {
  // ... reconstruir elementsToProcess i mapIdToElement ...

  // v3.3: Verificar que el document no ha canviat
  let currentSnapshot = '';
  let idx = 0;
  for (let i = 0; i < elementsToProcess.length && idx < 5; i++) {
    const el = elementsToProcess[i];
    const text = el.asText().getText();
    if (text.trim().length > 0) {
      currentSnapshot += `{{${idx}}} ${text}\n`;
      idx++;
    }
  }
  currentSnapshot = currentSnapshot.substring(0, 500);

  if (expectedSnapshot && currentSnapshot !== expectedSnapshot) {
    return {
      ok: false,
      error: "El document ha canviat. Torna a sol·licitar els canvis."
    };
  }

  // ... resta del codi ...
}
```

**Sidebar.html - Passar snapshot a apply**:
```javascript
function applyPreviewedChanges() {
  // ... existing code ...

  google.script.run
    // ...
    .applyPendingChanges(pendingPreviewChanges, pendingDocSnapshot);
}

// Guardar snapshot quan mostrem preview:
let pendingDocSnapshot = null;

function showPreviewPanel(changes, aiResponse, docSnapshot) {
  pendingPreviewChanges = changes;
  pendingDocSnapshot = docSnapshot || null;
  // ... rest ...
}
```

---

## Fase 2: Correccions Importants

### 2.1 Fix `getRecentHistory()` - Netejar badge complet

**Problema**: Només elimina "Document modificat", deixa "Desfer" i "Prohibir".

**Solució**:
```javascript
function getRecentHistory() {
  const messages = document.querySelectorAll('#chatHistory .msg');
  const history = [];

  messages.forEach(function(msg) {
    if (msg.classList.contains('system') ||
        msg.classList.contains('error') ||
        msg.classList.contains('thinking')) {
      return;
    }

    if (msg.classList.contains('user')) {
      let text = msg.innerText.trim();
      if (text.startsWith('🎯 ')) text = text.substring(3);
      history.push({ role: 'user', text: text });
    } else if (msg.classList.contains('ai')) {
      // v3.3: Netejar completament el badge d'edició
      let text = msg.innerText.trim();

      // Detectar si hi ha badge i eliminar-lo completament
      const badgePatterns = [
        /^Document modificat\s*(Desfer)?\s*(🚫 Prohibir)?\s*/,
        /^Document modificat.*?(?=\n|$)/
      ];

      for (const pattern of badgePatterns) {
        text = text.replace(pattern, '').trim();
      }

      // Eliminar línies buides al principi
      text = text.replace(/^\s*\n+/, '');

      if (text) {
        history.push({ role: 'model', text: text });
      }
    }
  });

  return history.slice(-12);
}
```

---

### 2.2 Eliminar duplicat `escapeHtml`

**Solució**: Eliminar la definició a línia 2680-2684 (ja que la de 2859-2863 és idèntica i ve després en el flux).

```javascript
// ELIMINAR (línies 2680-2684):
// function escapeHtml(text) {
//   const div = document.createElement('div');
//   div.textContent = text;
//   return div.innerHTML;
// }
```

---

### 2.3 Eliminar Debug Code

**Sidebar.html** - Eliminar línies 2285-2297:
```javascript
// ELIMINAR TOT AIXÒ:
// // DEBUG: Log response for troubleshooting
// console.log('[Docmile Debug] Response:', JSON.stringify(res, null, 2));
// console.log('[Docmile Debug] previewModeEnabled:', previewModeEnabled);
// console.log('[Docmile Debug] res.status:', res.status);
// console.log('[Docmile Debug] res.mode:', res.mode);
// console.log('[Docmile Debug] res.changes:', res.changes);
//
// // DEBUG: Show debug info visually (temporary - remove after fixing)
// const debugInfo = '🔧 [DEBUG] mode=' + (res.mode || res.status) +
//                   ', changes=' + (res.changes ? res.changes.length : 'N/A') +
//                   ', previewEnabled=' + previewModeEnabled +
//                   (res.thought ? '\n💭 ' + res.thought.substring(0, 100) + '...' : '');
// addBubble('system', debugInfo);
```

**Code.gs** - Eliminar línies 425-428 i 432, 444, 447, 450, 453, 455, 458, 462-463, 465-466, 470, 474:
```javascript
// ELIMINAR tots els console.log amb [Docmile Debug]
```

---

### 2.4 Migrar localStorage keys a `DOCMILE_`

**Code.gs** - Canviar totes les claus:

```javascript
// Línia 61:
PropertiesService.getUserProperties().setProperty('DOCMILE_SETTINGS', jsonSettings);

// Línia 66:
const json = PropertiesService.getUserProperties().getProperty('DOCMILE_SETTINGS');

// Línies 78-80:
props.setProperty('DOCMILE_FILE_URI', uri);
props.setProperty('DOCMILE_FILE_NAME', name);
props.setProperty('DOCMILE_FILE_MIME', mime);

// Línies 86-87:
const uri = props.getProperty('DOCMILE_FILE_URI');
const name = props.getProperty('DOCMILE_FILE_NAME');

// Línies 95-97:
props.deleteProperty('DOCMILE_FILE_URI');
props.deleteProperty('DOCMILE_FILE_NAME');
props.deleteProperty('DOCMILE_FILE_MIME');

// Línia 103:
const LAST_EDIT_KEY = 'DOCMILE_LAST_EDIT';

// Línia 107:
const BANNED_WORDS_KEY = 'DOCMILE_BANNED_WORDS';
```

**NOTA**: Afegir migració automàtica per usuaris existents:
```javascript
// Afegir al principi de getSettings():
function getSettings() {
  const props = PropertiesService.getUserProperties();

  // v3.3: Migració automàtica de SIDECAR a DOCMILE
  const oldJson = props.getProperty('SIDECAR_SETTINGS');
  if (oldJson && !props.getProperty('DOCMILE_SETTINGS')) {
    props.setProperty('DOCMILE_SETTINGS', oldJson);
    props.deleteProperty('SIDECAR_SETTINGS');
  }

  const json = props.getProperty('DOCMILE_SETTINGS');
  // ... rest ...
}
```

---

## Fase 3: Correccions Menors

### 3.1 Timeout visual a `applyPreviewedChanges`

```javascript
function applyPreviewedChanges() {
  if (!pendingPreviewChanges || pendingPreviewChanges.length === 0) {
    showToast('❌ No hi ha canvis pendents');
    return;
  }

  const panel = document.getElementById('previewPanel');
  if (panel) panel.classList.add('applying');

  // v3.3: Timeout de seguretat
  const timeoutId = setTimeout(function() {
    if (panel) panel.classList.remove('applying');
    addBubble('error', '⏱️ Timeout: L\'operació ha trigat massa. Torna-ho a provar.');
  }, 15000); // 15 segons

  google.script.run
    .withSuccessHandler(function(res) {
      clearTimeout(timeoutId);
      hidePreviewPanel();
      pendingPreviewChanges = null;
      pendingDocSnapshot = null;

      if (res.ok) {
        addBubble('system', '✅ ' + res.applied + ' canvi(s) aplicat(s)');
        if (res.undoSnapshots && res.undoSnapshots.length > 0) {
          pendingUndo = res.undoSnapshots[0];
          showUndoBar();
        }
      } else {
        addBubble('error', 'Error: ' + (res.error || 'Error desconegut'));
      }
    })
    .withFailureHandler(function(err) {
      clearTimeout(timeoutId);
      const panel = document.getElementById('previewPanel');
      if (panel) panel.classList.remove('applying');
      addBubble('error', 'Error: ' + err.message);
    })
    .applyPendingChanges(pendingPreviewChanges, pendingDocSnapshot);
}
```

---

### 3.2 Validació `res.thought.substring()`

```javascript
// ABANS:
(res.thought ? res.thought.substring(0, 100) + '...' : '');

// DESPRÉS (si eliminem debug, no cal; però per referència):
(res.thought ? (res.thought.length > 100 ? res.thought.substring(0, 100) + '...' : res.thought) : '');
```

---

## Ordre d'Implementació Recomanat

```
┌─────────────────────────────────────────────────────────────┐
│  SPRINT 3.3.1: Seguretat & Crítics                          │
├─────────────────────────────────────────────────────────────┤
│  [ ] 1.2 Fix XSS a addBubble()                              │
│  [ ] 1.1 Fix runReceipt() + previewModeEnabled              │
│  [ ] 2.3 Eliminar debug code                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  SPRINT 3.3.2: Robustesa                                    │
├─────────────────────────────────────────────────────────────┤
│  [ ] 1.3 Fix race condition (snapshot verification)         │
│  [ ] 2.1 Fix getRecentHistory() badge cleanup               │
│  [ ] 3.1 Timeout visual a applyPreviewedChanges             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  SPRINT 3.3.3: Neteja & Mantenibilitat                      │
├─────────────────────────────────────────────────────────────┤
│  [ ] 2.2 Eliminar duplicat escapeHtml                       │
│  [ ] 2.4 Migrar keys a DOCMILE_ + auto-migració             │
│  [ ] 3.2 Validació thought.substring (si cal)               │
└─────────────────────────────────────────────────────────────┘
```

---

## Tests Post-Implementació

1. **Test Preview Mode amb Recepta**: Crear recepta → Executar → Verificar que apareix preview
2. **Test XSS**: Fer que l'IA retorni `<script>alert(1)</script>` → Verificar que s'escapa
3. **Test Race Condition**: Obrir preview → Editar document manualment → Aplicar → Verificar error
4. **Test Historial Net**: Fer diverses edicions → Verificar que getRecentHistory() no inclou badges
5. **Test Migració**: Simular usuari amb keys `SIDECAR_` → Verificar migració automàtica

---

*Pla creat: 2024-12-01*
*Versió: 3.3.0*
*Temps estimat: 2-3 hores*
