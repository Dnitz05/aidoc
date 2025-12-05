# PLA: Landing Interactiva del Xat v7.1

## VISIÓ

Quan l'usuari obre una nova conversa o el xat per primera vegada, en lloc de veure una pantalla en blanc, veu **missatges de demostració elegants** que:

1. Expliquen les funcionalitats principals
2. Són **clicables** com a shortcuts (fan l'acció directament)
3. Tenen colors per categoria
4. Desapareixen quan l'usuari envia el primer missatge real

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     ╭─────────────────────────────────────╮                 │
│     │  👋 Hola! Sóc Docmile               │                 │
│     │  El teu assistent d'escriptura      │                 │
│     ╰─────────────────────────────────────╯                 │
│                                                             │
│     Prova alguna d'aquestes accions:                        │
│                                                             │
│     ╭──────────────────────╮ ╭──────────────────────╮       │
│     │ ✏️ Corregeix         │ │ 🌍 Tradueix al       │       │
│     │    l'ortografia      │ │    castellà          │       │
│     ╰──────────────────────╯ ╰──────────────────────╯       │
│                                                             │
│     ╭──────────────────────╮ ╭──────────────────────╮       │
│     │ 📝 Resumeix el       │ │ 🔍 Detecta           │       │
│     │    document          │ │    repeticions       │       │
│     ╰──────────────────────╯ ╰──────────────────────╯       │
│                                                             │
│     ╭──────────────────────╮ ╭──────────────────────╮       │
│     │ ✨ Millora l'estil   │ │ 📧 Escriu un email   │       │
│     │                      │ │    formal            │       │
│     ╰──────────────────────╯ ╰──────────────────────╯       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## CATEGORIES I COLORS

| Categoria | Color | Emoji | Exemples |
|-----------|-------|-------|----------|
| **Edició** | Verd (#10B981) | ✏️ | Corregeix, Millora, Escurça |
| **Traducció** | Blau (#3B82F6) | 🌍 | Tradueix al castellà/anglès |
| **Anàlisi** | Lila (#8B5CF6) | 🔍 | Resumeix, Detecta repeticions |
| **Creació** | Taronja (#F59E0B) | ✨ | Escriu email, Genera llista |
| **Referència** | Rosa (#EC4899) | 📌 | Quines parts clarificar? |

---

## ESTRUCTURA HTML

### Container Principal

```html
<div id="chatLanding" class="chat-landing">
  <!-- Salutació -->
  <div class="landing-greeting">
    <div class="landing-logo">
      <span class="landing-wave">👋</span>
    </div>
    <h2 class="landing-title">Hola! Sóc Docmile</h2>
    <p class="landing-subtitle">El teu assistent d'escriptura intel·ligent</p>
  </div>

  <!-- Suggeriments -->
  <div class="landing-suggestions">
    <p class="landing-hint">Prova alguna d'aquestes accions:</p>

    <div class="suggestion-grid">
      <!-- Fila 1 -->
      <button class="suggestion-card cat-edit" data-prompt="Corregeix l'ortografia">
        <span class="suggestion-icon">✏️</span>
        <span class="suggestion-text">Corregeix l'ortografia</span>
      </button>

      <button class="suggestion-card cat-translate" data-prompt="Tradueix al castellà">
        <span class="suggestion-icon">🌍</span>
        <span class="suggestion-text">Tradueix al castellà</span>
      </button>

      <!-- Fila 2 -->
      <button class="suggestion-card cat-analyze" data-prompt="Resumeix el document">
        <span class="suggestion-icon">📝</span>
        <span class="suggestion-text">Resumeix el document</span>
      </button>

      <button class="suggestion-card cat-reference" data-prompt="Detecta repeticions de paraules">
        <span class="suggestion-icon">🔍</span>
        <span class="suggestion-text">Detecta repeticions</span>
      </button>

      <!-- Fila 3 -->
      <button class="suggestion-card cat-edit" data-prompt="Millora l'estil del text">
        <span class="suggestion-icon">✨</span>
        <span class="suggestion-text">Millora l'estil</span>
      </button>

      <button class="suggestion-card cat-create" data-prompt="Escriu un email formal basat en aquest contingut">
        <span class="suggestion-icon">📧</span>
        <span class="suggestion-text">Escriu un email</span>
      </button>
    </div>
  </div>

  <!-- Hint inferior -->
  <p class="landing-footer">
    <span class="i i--xs i--muted">💡</span>
    O escriu la teva pròpia instrucció a baix
  </p>
</div>
```

---

## CSS (Styles.html)

```css
/* ═══════════════════════════════════════════════════════════
   CHAT LANDING v7.1
   ═══════════════════════════════════════════════════════════ */

.chat-landing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  min-height: 100%;
  animation: landingFadeIn 0.4s ease;
}

@keyframes landingFadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Salutació */
.landing-greeting {
  text-align: center;
  margin-bottom: 24px;
}

.landing-logo {
  margin-bottom: 12px;
}

.landing-wave {
  font-size: 40px;
  display: inline-block;
  animation: wave 1.5s ease-in-out infinite;
  transform-origin: 70% 70%;
}

@keyframes wave {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(20deg); }
  75% { transform: rotate(-10deg); }
}

.landing-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px 0;
}

.landing-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}

/* Suggeriments */
.landing-suggestions {
  width: 100%;
  max-width: 320px;
}

.landing-hint {
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  margin: 0 0 12px 0;
}

/* Grid de targetes */
.suggestion-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/* Targeta individual */
.suggestion-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
}

.suggestion-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.suggestion-card:active {
  transform: translateY(0);
}

.suggestion-icon {
  font-size: 20px;
}

.suggestion-text {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.3;
}

/* Colors per categoria */
.suggestion-card.cat-edit {
  border-left: 3px solid #10B981;
}
.suggestion-card.cat-edit:hover {
  background: rgba(16, 185, 129, 0.08);
  border-color: #10B981;
}

.suggestion-card.cat-translate {
  border-left: 3px solid #3B82F6;
}
.suggestion-card.cat-translate:hover {
  background: rgba(59, 130, 246, 0.08);
  border-color: #3B82F6;
}

.suggestion-card.cat-analyze {
  border-left: 3px solid #8B5CF6;
}
.suggestion-card.cat-analyze:hover {
  background: rgba(139, 92, 246, 0.08);
  border-color: #8B5CF6;
}

.suggestion-card.cat-reference {
  border-left: 3px solid #EC4899;
}
.suggestion-card.cat-reference:hover {
  background: rgba(236, 72, 153, 0.08);
  border-color: #EC4899;
}

.suggestion-card.cat-create {
  border-left: 3px solid #F59E0B;
}
.suggestion-card.cat-create:hover {
  background: rgba(245, 158, 11, 0.08);
  border-color: #F59E0B;
}

/* Footer */
.landing-footer {
  margin-top: 20px;
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Ocultar quan hi ha missatges */
.chat-landing.hidden {
  display: none;
}
```

---

## JAVASCRIPT (Sidebar.html)

### 1. Renderitzar Landing

```javascript
/**
 * Mostra la landing del xat si no hi ha missatges
 */
function showChatLanding() {
  const container = document.getElementById('chatHistory');
  const existingLanding = document.getElementById('chatLanding');

  // Si ja existeix, només mostrar-la
  if (existingLanding) {
    existingLanding.classList.remove('hidden');
    return;
  }

  const suggestions = [
    { icon: '✏️', text: 'Corregeix l\'ortografia', prompt: 'Corregeix l\'ortografia', cat: 'edit' },
    { icon: '🌍', text: 'Tradueix al castellà', prompt: 'Tradueix al castellà', cat: 'translate' },
    { icon: '📝', text: 'Resumeix el document', prompt: 'Resumeix el document en 3 punts clau', cat: 'analyze' },
    { icon: '🔍', text: 'Detecta repeticions', prompt: 'Detecta repeticions de paraules', cat: 'reference' },
    { icon: '✨', text: 'Millora l\'estil', prompt: 'Millora l\'estil del text', cat: 'edit' },
    { icon: '📧', text: 'Escriu un email', prompt: 'Escriu un email formal basat en aquest contingut', cat: 'create' }
  ];

  let cardsHtml = suggestions.map(s => `
    <button class="suggestion-card cat-${s.cat}" onclick="useSuggestion('${s.prompt.replace(/'/g, "\\'")}')">
      <span class="suggestion-icon">${s.icon}</span>
      <span class="suggestion-text">${s.text}</span>
    </button>
  `).join('');

  const landingHtml = `
    <div id="chatLanding" class="chat-landing">
      <div class="landing-greeting">
        <div class="landing-logo">
          <span class="landing-wave">👋</span>
        </div>
        <h2 class="landing-title">Hola! Sóc Docmile</h2>
        <p class="landing-subtitle">El teu assistent d'escriptura intel·ligent</p>
      </div>

      <div class="landing-suggestions">
        <p class="landing-hint">Prova alguna d'aquestes accions:</p>
        <div class="suggestion-grid">
          ${cardsHtml}
        </div>
      </div>

      <p class="landing-footer">
        💡 O escriu la teva pròpia instrucció a baix
      </p>
    </div>
  `;

  container.innerHTML = landingHtml;
}

/**
 * Usa un suggeriment de la landing
 */
function useSuggestion(prompt) {
  // Amagar landing
  hideChatLanding();

  // Posar el text al input
  const input = document.getElementById('userInput');
  input.value = prompt;

  // Enviar automàticament
  sendMessage();
}

/**
 * Amaga la landing del xat
 */
function hideChatLanding() {
  const landing = document.getElementById('chatLanding');
  if (landing) {
    landing.classList.add('hidden');
  }
}
```

### 2. Integració amb el flux existent

**Modificar `switchConversation()`:**
```javascript
// Dins switchConversation(), quan es carreguen missatges:
if (!messages || messages.length === 0) {
  showChatLanding();
} else {
  hideChatLanding();
  // Renderitzar missatges...
}
```

**Modificar `startNewConversation()`:**
```javascript
function startNewConversation() {
  // ... codi existent ...

  // Mostrar landing per nova conversa
  showChatLanding();
}
```

**Modificar `sendMessage()`:**
```javascript
// Al principi de sendMessage():
hideChatLanding();  // Amagar landing quan s'envia missatge
```

---

## FITXERS A MODIFICAR

| Fitxer | Canvis |
|--------|--------|
| `Sidebar.html` | Funcions JS: showChatLanding, useSuggestion, hideChatLanding |
| `Sidebar.html` | Modificar: switchConversation, startNewConversation, sendMessage |
| `Styles.html` | CSS complet per la landing |

---

## COMPORTAMENT

1. **Nova conversa** → Mostra landing
2. **Conversa existent buida** → Mostra landing
3. **Conversa amb missatges** → Mostra missatges (amaga landing)
4. **Clic a suggeriment** → Amaga landing + envia missatge
5. **Escriure manualment** → Quan s'envia, amaga landing

---

## CONSIDERACIONS UX

1. **Animació suau**: La landing apareix amb fade-in
2. **Mà animada**: L'emoji 👋 fa una animació de salutació
3. **Hover elegant**: Les targetes pujen lleugerament
4. **Colors semàntics**: Cada categoria té el seu color
5. **Responsive**: Grid de 2 columnes s'adapta
6. **No intrusiu**: Desapareix automàticament

---

## IMPLEMENTACIÓ

**Temps estimat**: ~1h

**Ordre**:
1. Afegir CSS a Styles.html
2. Afegir funcions JS a Sidebar.html
3. Integrar amb funcions existents
4. Testejar
5. Desplegar

---

**Estat:** LLEST PER IMPLEMENTAR
