# PLA ULTRADETALLAT: Millores Pestanya Xat v6.5

## Resum Executiu
Implementació de 3 millores crítiques per la pestanya de xat:
1. **Paginació de missatges** - Evitar memory leaks en converses grans
2. **Validació al backend** - Seguretat fitxers adjunts
3. **Markdown rendering** - Millorar UX de respostes AI

---

## 1. PAGINACIÓ DE MISSATGES

### Problema Actual
- `loadConversationMessages()` (Sidebar.html:918) carrega **TOTS** els missatges de cop
- `handleGetConversation()` (worker.js:2022) retorna `conv.messages || []` sense límit
- Converses amb 500+ missatges poden "esbensar" el navegador

### Solució: Lazy Load amb Scroll Infinit

#### 1.1 Backend - worker.js

**Nou endpoint: `get_conversation_messages`**
```javascript
// Afegir a worker.js línia ~1084
if (body.action === 'get_conversation_messages') {
  return await handleGetConversationMessages(body, env, corsHeaders);
}
```

**Nova funció:**
```javascript
// worker.js - després de handleGetConversation (~línia 2067)
async function handleGetConversationMessages(body, env, corsHeaders) {
  const { license_key, license_key_hash, conversation_id, offset = 0, limit = 50 } = body;

  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");
  if (!conversation_id) throw new Error("missing_conversation_id");

  // Usar SQL function per paginació eficient
  const response = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/get_conversation_messages`,
    {
      method: 'POST',
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_conversation_id: conversation_id,
        p_license_hash: licenseHash,
        p_offset: offset,
        p_limit: limit
      })
    }
  );

  if (!response.ok) throw new Error("supabase_error");
  const result = await response.json();

  return new Response(JSON.stringify({
    status: "ok",
    messages: result.messages || [],
    total: result.total_count,
    has_more: offset + limit < result.total_count
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
```

#### 1.2 Base de Dades - conversations.sql

**Nova funció SQL:**
```sql
-- Afegir al final de conversations.sql
CREATE OR REPLACE FUNCTION get_conversation_messages(
  p_conversation_id UUID,
  p_license_hash TEXT,
  p_offset INTEGER DEFAULT 0,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB AS $$
DECLARE
  conv_record RECORD;
  total_count INTEGER;
  msg_slice JSONB;
BEGIN
  -- Verificar ownership
  SELECT messages, message_count INTO conv_record
  FROM conversations
  WHERE id = p_conversation_id AND license_key_hash = p_license_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'error', 'error', 'not_found');
  END IF;

  total_count := conv_record.message_count;

  -- Extreure slice de missatges (LIFO - els més recents primer, però invertim per mostrar cronològicament)
  -- Volem carregar dels més antics als més nous, però paginar des dels nous
  SELECT jsonb_agg(elem)
  INTO msg_slice
  FROM (
    SELECT elem
    FROM jsonb_array_elements(conv_record.messages) WITH ORDINALITY arr(elem, idx)
    ORDER BY idx DESC
    OFFSET p_offset
    LIMIT p_limit
  ) sub;

  -- Invertir per ordre cronològic
  SELECT jsonb_agg(elem)
  INTO msg_slice
  FROM (
    SELECT elem
    FROM jsonb_array_elements(COALESCE(msg_slice, '[]'::jsonb)) WITH ORDINALITY arr(elem, idx)
    ORDER BY idx DESC
  ) sub;

  RETURN jsonb_build_object(
    'status', 'ok',
    'messages', COALESCE(msg_slice, '[]'::jsonb),
    'total_count', total_count
  );
END;
$$ LANGUAGE plpgsql;
```

#### 1.3 Frontend - Sidebar.html

**Modificar `loadConversationMessages`:**
```javascript
// Sidebar.html - substituir funció a línia 918
const MESSAGES_PAGE_SIZE = 50;
let currentMessagesOffset = 0;
let isLoadingMessages = false;
let hasMoreMessages = false;

function loadConversationMessages(conversation, append = false) {
  const chatHistory = document.getElementById('chatHistory');

  if (!append) {
    chatHistory.innerHTML = '';
    currentMessagesOffset = 0;
  }

  if (conversation.messages && conversation.messages.length > 0) {
    // Crear fragment per millorar performance
    const fragment = document.createDocumentFragment();

    for (const msg of conversation.messages) {
      const bubble = createBubbleElement(msg.role === 'ai' ? 'ai' : 'user', msg.content, false);
      if (append) {
        fragment.insertBefore(bubble, fragment.firstChild);
      } else {
        fragment.appendChild(bubble);
      }
    }

    if (append) {
      chatHistory.insertBefore(fragment, chatHistory.firstChild);
    } else {
      chatHistory.appendChild(fragment);
    }

    hasMoreMessages = conversation.has_more || false;
    currentMessagesOffset += conversation.messages.length;

    if (!append) {
      chatHistory.scrollTop = chatHistory.scrollHeight;
    }
  } else if (!append) {
    chatHistory.innerHTML = '<div class="msg system">Conversa buida. Escriu un missatge!</div>';
  }
}

// Refactoritzar addBubble per separar creació d'element
function createBubbleElement(type, text, isEdit, lastEditWord, selectionBadge) {
  const bubble = document.createElement('div');
  bubble.className = 'msg ' + type;
  // ... (mateixa lògica que addBubble actual)
  return bubble;
}

function addBubble(type, text, isEdit, lastEditWord, selectionBadge) {
  const container = document.getElementById('chatHistory');
  const bubble = createBubbleElement(type, text, isEdit, lastEditWord, selectionBadge);
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}
```

**Afegir scroll listener per lazy load:**
```javascript
// Sidebar.html - afegir després de loadConversationMessages
function initChatScrollListener() {
  const chatHistory = document.getElementById('chatHistory');

  chatHistory.addEventListener('scroll', function() {
    // Detectar scroll cap amunt (prop del top)
    if (chatHistory.scrollTop < 100 && hasMoreMessages && !isLoadingMessages && currentConversationId) {
      loadMoreMessages();
    }
  });
}

function loadMoreMessages() {
  if (isLoadingMessages || !hasMoreMessages) return;

  isLoadingMessages = true;
  const scrollHeightBefore = document.getElementById('chatHistory').scrollHeight;

  // Mostrar loading indicator al top
  const loadingEl = document.createElement('div');
  loadingEl.className = 'msg loading-more';
  loadingEl.innerHTML = '<div class="thinking-shimmer"></div>';
  loadingEl.id = 'loadingMoreIndicator';
  document.getElementById('chatHistory').insertBefore(loadingEl, document.getElementById('chatHistory').firstChild);

  google.script.run
    .withSuccessHandler(function(res) {
      document.getElementById('loadingMoreIndicator')?.remove();
      isLoadingMessages = false;

      if (res.status === 'ok' && res.messages) {
        loadConversationMessages({
          messages: res.messages,
          has_more: res.has_more
        }, true);

        // Mantenir posició de scroll
        const chatHistory = document.getElementById('chatHistory');
        const scrollHeightAfter = chatHistory.scrollHeight;
        chatHistory.scrollTop = scrollHeightAfter - scrollHeightBefore;
      }
    })
    .withFailureHandler(function() {
      document.getElementById('loadingMoreIndicator')?.remove();
      isLoadingMessages = false;
    })
    .getConversationMessages(currentConversationId, currentMessagesOffset, MESSAGES_PAGE_SIZE);
}

// Inicialitzar al carregar
document.addEventListener('DOMContentLoaded', initChatScrollListener);
```

#### 1.4 Code.gs - Nova funció bridge

```javascript
// Code.gs - afegir després de getConversation (~línia 1000)
function getConversationMessages(conversationId, offset, limit) {
  const payload = {
    action: 'get_conversation_messages',
    license_key_hash: getLicenseHash(),
    conversation_id: conversationId,
    offset: offset || 0,
    limit: limit || 50
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    return JSON.parse(response.getContentText());
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}
```

#### 1.5 CSS - Styles.html

```css
/* Afegir a Styles.html */
.loading-more {
  display: flex;
  justify-content: center;
  padding: 8px;
  background: transparent;
}

.loading-more .thinking-shimmer {
  width: 60%;
  height: 12px;
}
```

---

## 2. VALIDACIÓ AL BACKEND

### Problema Actual
- `accept=".pdf,.txt,.csv,.md"` només és client-side (Sidebar.html:564)
- `file.size > 10 * 1024 * 1024` només és client-side (Sidebar.html:3483)
- Backend (`uploadToKnowledgeLibrary`) NO valida res

### Solució: Validació completa al worker

#### 2.1 worker.js - Modificar handleUploadToLibrary

**Localitzar funció `handleUploadToLibrary` i afegir validació:**

```javascript
// worker.js - modificar handleUploadToLibrary
// Constants de validació
const ALLOWED_FILE_TYPES = {
  'application/pdf': { ext: '.pdf', maxSize: 10 * 1024 * 1024 },
  'text/plain': { ext: '.txt', maxSize: 10 * 1024 * 1024 },
  'text/csv': { ext: '.csv', maxSize: 10 * 1024 * 1024 },
  'text/markdown': { ext: '.md', maxSize: 10 * 1024 * 1024 },
  'text/x-markdown': { ext: '.md', maxSize: 10 * 1024 * 1024 }
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

async function handleUploadToLibrary(body, env, corsHeaders) {
  const { license_key, license_key_hash, file_data, file_type, file_name } = body;

  const licenseHash = license_key_hash || (license_key ? await hashKey(license_key) : null);
  if (!licenseHash) throw new Error("missing_license");

  // ═══ VALIDACIÓ DE FITXER ═══

  // 1. Validar que existeix file_data
  if (!file_data || typeof file_data !== 'string') {
    throw new Error("invalid_file_data");
  }

  // 2. Validar tipus MIME
  const normalizedType = (file_type || '').toLowerCase();
  if (!ALLOWED_FILE_TYPES[normalizedType]) {
    throw new Error("invalid_file_type: Only PDF, TXT, CSV, MD allowed");
  }

  // 3. Validar extensió del nom
  const allowedExt = ALLOWED_FILE_TYPES[normalizedType].ext;
  const fileExt = (file_name || '').toLowerCase().slice(-allowedExt.length);
  if (fileExt !== allowedExt && !(normalizedType.includes('markdown') && fileExt === '.md')) {
    throw new Error("file_extension_mismatch");
  }

  // 4. Validar mida (base64 és ~33% més gran que binari)
  const estimatedSize = Math.ceil(file_data.length * 0.75);
  const maxSize = ALLOWED_FILE_TYPES[normalizedType].maxSize;
  if (estimatedSize > maxSize) {
    throw new Error("file_too_large: Max " + (maxSize / 1024 / 1024) + "MB");
  }

  // 5. Validar contingut (magic bytes per PDF)
  if (normalizedType === 'application/pdf') {
    try {
      const decoded = atob(file_data.substring(0, 20));
      if (!decoded.startsWith('%PDF')) {
        throw new Error("invalid_pdf_content");
      }
    } catch (e) {
      throw new Error("invalid_base64_data");
    }
  }

  // 6. Sanititzar nom del fitxer
  const sanitizedName = file_name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 100);

  // ... resta de la funció existent ...
}
```

#### 2.2 Afegir rate limiting

```javascript
// worker.js - afegir al principi del fitxer, després de constants
const RATE_LIMITS = {
  upload: { windowMs: 60000, max: 10 },  // 10 uploads per minut
  chat: { windowMs: 60000, max: 30 }      // 30 missatges per minut
};

// In-memory rate limiter (per request, no persistent)
// Per producció, usar KV o Durable Objects
async function checkRateLimit(env, licenseHash, action) {
  const key = `ratelimit:${action}:${licenseHash}`;

  // Usar KV amb TTL
  const current = await env.DOCMILE_KV?.get(key);
  const count = current ? parseInt(current) : 0;
  const limit = RATE_LIMITS[action]?.max || 100;

  if (count >= limit) {
    throw new Error("rate_limit_exceeded");
  }

  // Incrementar comptador
  await env.DOCMILE_KV?.put(key, String(count + 1), {
    expirationTtl: Math.ceil(RATE_LIMITS[action].windowMs / 1000)
  });

  return true;
}

// Usar en handleUploadToLibrary:
// await checkRateLimit(env, licenseHash, 'upload');

// Usar en handleChat:
// await checkRateLimit(env, licenseHash, 'chat');
```

#### 2.3 Errors més descriptius al frontend

```javascript
// Sidebar.html - modificar handleChatFileSelect (~línia 3510)
.withFailureHandler(function(err) {
  hideChatAttachment();

  // Parsejar errors del backend
  const errorMsg = err.message || '';
  if (errorMsg.includes('invalid_file_type')) {
    alert('Tipus de fitxer no permès. Només PDF, TXT, CSV, MD.');
  } else if (errorMsg.includes('file_too_large')) {
    alert('Fitxer massa gran. Màxim 10MB.');
  } else if (errorMsg.includes('rate_limit')) {
    alert('Has pujat massa fitxers. Espera un minut.');
  } else {
    alert('Error: ' + errorMsg);
  }
})
```

---

## 3. MARKDOWN RENDERING

### Problema Actual
- `sanitizeText()` escapa HTML i converteix `\n` a `<br>` (Sidebar.html:2013)
- No renderitza **bold**, *italic*, `code`, llistes, etc.
- Respostes AI surten en text pla

### Solució: Implementar parser markdown lleuger

#### 3.1 Opció A: Marked.js (CDN)
**Pros:** Complet, ben mantingut
**Contres:** Dependència externa, 28KB

#### 3.2 Opció B: Parser custom lleuger ✓ RECOMANAT
**Pros:** Sense dependències, control total, ~2KB
**Contres:** Menys features

#### Implementació Opció B

**Sidebar.html - Nova funció `renderMarkdown`:**
```javascript
// Sidebar.html - afegir abans de addBubble
function renderMarkdown(text) {
  if (!text) return '';

  // Escapar HTML primer (seguretat)
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (```) - fer primer per evitar conflictes
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, function(match, lang, code) {
    const langClass = lang ? ' class="language-' + lang + '"' : '';
    return '<pre><code' + langClass + '>' + code.trim() + '</code></pre>';
  });

  // Inline code (`)
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold (**text** o __text__)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic (*text* o _text_) - cura de no confondre amb bold
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');

  // Strikethrough (~~text~~)
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Headers (només h3-h6 per no trencar estils)
  html = html.replace(/^#### (.+)$/gm, '<h6 class="md-header">$1</h6>');
  html = html.replace(/^### (.+)$/gm, '<h5 class="md-header">$1</h5>');
  html = html.replace(/^## (.+)$/gm, '<h4 class="md-header">$1</h4>');

  // Llistes no ordenades (- item o * item)
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul class="md-list">$&</ul>');

  // Llistes ordenades (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // (ja queden dins <ul>, caldria <ol> però simplificam)

  // Links [text](url) - només URLs segures
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');

  // Blockquotes (> text)
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');

  // Horizontal rule (---)
  html = html.replace(/^---+$/gm, '<hr class="md-hr">');

  // Line breaks (doble espai o \n\n per paràgrafs)
  html = html.replace(/\n\n/g, '</p><p class="md-para">');
  html = html.replace(/\n/g, '<br>');

  // Wrap en paràgraf si no té estructura
  if (!html.includes('<p') && !html.includes('<pre') && !html.includes('<ul') && !html.includes('<h')) {
    html = '<p class="md-para">' + html + '</p>';
  }

  return html;
}
```

**Modificar `addBubble` per usar markdown:**
```javascript
// Sidebar.html - modificar addBubble (~línia 2007)
function addBubble(type, text, isEdit, lastEditWord, selectionBadge) {
  const container = document.getElementById('chatHistory');
  const bubble = document.createElement('div');
  bubble.className = 'msg ' + type;

  // v6.5: Usar markdown per respostes AI
  const useMarkdown = (type === 'ai');

  function sanitizeText(t) {
    const div = document.createElement('div');
    div.textContent = t;
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  let selectionHtml = '';
  if (type === 'user' && selectionBadge) {
    selectionHtml = '<div class="selection-badge">' +
      '<span class="i i--xs"><svg viewBox="0 0 24 24"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg></span>' +
      '<span class="selection-badge-text">' + sanitizeText(selectionBadge) + '</span></div>';
  }

  if (type === 'ai' && isEdit) {
    let badgeHtml = '<div class="edit-badge">Document modificat' +
      '<button class="revert-btn" onclick="revertLastEdit(this)" title="Desfer canvi">' +
      '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>Desfer</button>';

    if (lastEditWord) {
      badgeHtml += '<button class="ban-word-btn" onclick="addToBannedFromChat(\'' +
        lastEditWord.replace(/'/g, "\\'") + '\')" title="No usar mai aquesta paraula">' +
        icon('ban', 'i--error i--sm') + ' Prohibir</button>';
    }

    badgeHtml += '</div>';
    // v6.5: Markdown per AI
    bubble.innerHTML = badgeHtml + '<div class="md-content">' + renderMarkdown(text) + '</div>';

  } else if (type === 'error') {
    bubble.innerHTML = text;

  } else if (type === 'ai') {
    // v6.5: AI sense edit badge
    bubble.innerHTML = '<div class="md-content">' + renderMarkdown(text) + '</div>';

  } else if (type === 'user' && selectionBadge) {
    bubble.innerHTML = selectionHtml + '<div class="user-text">' + sanitizeText(text) + '</div>';

  } else {
    bubble.innerText = text;
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}
```

#### 3.2 CSS per Markdown - Styles.html

```css
/* Styles.html - afegir secció Markdown */

/* ═══════════════════════════════════════════════════════════════
   MARKDOWN STYLES (v6.5)
   ═══════════════════════════════════════════════════════════════ */

.md-content {
  line-height: 1.5;
}

.md-content p.md-para {
  margin: 0 0 8px 0;
}

.md-content p.md-para:last-child {
  margin-bottom: 0;
}

/* Code blocks */
.md-content pre {
  background: var(--bg-secondary);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
  font-size: 12px;
}

.md-content pre code {
  background: none;
  padding: 0;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  color: var(--text-secondary);
}

/* Inline code */
.md-content code.inline-code {
  background: var(--bg-secondary);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 0.9em;
  color: var(--accent);
}

/* Bold & Italic */
.md-content strong {
  font-weight: 600;
  color: var(--text-primary);
}

.md-content em {
  font-style: italic;
}

.md-content del {
  text-decoration: line-through;
  opacity: 0.7;
}

/* Headers dins bubbles */
.md-content .md-header {
  font-weight: 600;
  margin: 12px 0 6px 0;
  color: var(--text-primary);
}

.md-content h4.md-header { font-size: 1.1em; }
.md-content h5.md-header { font-size: 1em; }
.md-content h6.md-header { font-size: 0.95em; }

/* Llistes */
.md-content ul.md-list {
  margin: 8px 0;
  padding-left: 20px;
}

.md-content ul.md-list li {
  margin: 4px 0;
  line-height: 1.4;
}

/* Links */
.md-content a.md-link {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  transition: border-color 0.2s;
}

.md-content a.md-link:hover {
  border-bottom-color: var(--accent);
}

/* Blockquotes */
.md-content blockquote.md-quote {
  border-left: 3px solid var(--accent);
  margin: 8px 0;
  padding: 4px 12px;
  background: var(--bg-secondary);
  border-radius: 0 4px 4px 0;
  font-style: italic;
  color: var(--text-secondary);
}

/* Horizontal rule */
.md-content hr.md-hr {
  border: none;
  height: 1px;
  background: var(--border);
  margin: 12px 0;
}

/* Dark mode adjustments */
@media (prefers-color-scheme: dark) {
  .md-content pre {
    background: rgba(255,255,255,0.05);
  }

  .md-content code.inline-code {
    background: rgba(255,255,255,0.1);
  }
}
```

---

## ORDRE D'IMPLEMENTACIÓ RECOMANAT

### Fase 1: Validació Backend (Risc: ALT, Esforç: BAIX)
1. Afegir constants de validació a worker.js
2. Modificar handleUploadToLibrary amb validació
3. Testejar amb fitxers invàlids
4. Deploy

### Fase 2: Markdown Rendering (Risc: BAIX, Esforç: MIG)
1. Afegir funció renderMarkdown a Sidebar.html
2. Modificar addBubble per usar-la
3. Afegir CSS a Styles.html
4. Testejar amb diferents formats
5. Deploy

### Fase 3: Paginació (Risc: MIG, Esforç: ALT)
1. Crear funció SQL get_conversation_messages
2. Afegir endpoint a worker.js
3. Afegir funció bridge a Code.gs
4. Modificar loadConversationMessages
5. Implementar scroll listener
6. Afegir CSS per loading
7. Testejar amb converses grans
8. Deploy

---

## FITXERS A MODIFICAR

| Fitxer | Canvis | Fase |
|--------|--------|------|
| `worker/worker.js` | Validació + endpoint paginació | 1, 3 |
| `docs-addon/Sidebar.html` | Markdown + paginació frontend | 2, 3 |
| `docs-addon/Styles.html` | CSS markdown + loading | 2, 3 |
| `docs-addon/Code.gs` | Bridge paginació | 3 |
| `supabase/conversations.sql` | Funció SQL paginació | 3 |

---

## TESTS A EXECUTAR

### Validació Backend
- [ ] Pujar PDF vàlid → OK
- [ ] Pujar TXT vàlid → OK
- [ ] Pujar .exe → Error "invalid_file_type"
- [ ] Pujar PDF de 15MB → Error "file_too_large"
- [ ] Pujar fitxer amb nom maliciós (`../../../etc/passwd`) → Sanititzat

### Markdown Rendering
- [ ] Text amb **bold** → Renderitza correctament
- [ ] Codi inline `code` → Estilitzat
- [ ] Bloc de codi ``` → Pre amb syntax
- [ ] Llistes - item → UL/LI
- [ ] Links [text](url) → Anchor segur

### Paginació
- [ ] Conversa nova → Carrega tot
- [ ] Conversa amb 100 missatges → Carrega 50
- [ ] Scroll up → Carrega 50 més
- [ ] Posició de scroll → Mantinguda

---

## ESTIMACIÓ

| Fase | Complexitat | Fitxers |
|------|-------------|---------|
| 1. Validació | Baixa | 1 |
| 2. Markdown | Mitjana | 2 |
| 3. Paginació | Alta | 5 |

