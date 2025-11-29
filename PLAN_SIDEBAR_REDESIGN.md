# PLA DE REDISSENY: SideCar Sidebar
## Objectiu: UI 10/10 - Moderna, Elegant, Pràctica

---

## 1. ANÀLISI DE L'ESTAT ACTUAL

### Problemes Identificats:
| Problema | Impacte |
|----------|---------|
| Tipografia genèrica (Google Sans, Roboto, Arial) | Aspecte corporatiu/avorrit |
| Colors Google (#1a73e8 blau) | Sense personalitat |
| Gradient violeta als receipts | Típic "AI slop" |
| Layout centrat i simètric | Previsible |
| Animacions mínimes | Sense vida |
| Estètica corporate Google | No memorable |

### Restriccions Tècniques:
- **Format**: HTML únic (Google Apps Script)
- **Amplada**: ~300px (sidebar estret)
- **No React**: Vanilla JS obligatori
- **Google Fonts**: Sí (via link)

---

## 2. DIRECCIÓ ESTÈTICA

### Opció Escollida: **"Refined Dark" + Accent Emerald**

**Concepte**: Interface elegant i professional amb tema fosc sofisticat. Transmet: Intel·ligència, Productivitat, Premium.

**Inspiració**:
- Linear.app (clean, dark, functional)
- Raycast (modern, snappy)
- Arc Browser (personality, polish)

---

## 3. SISTEMA DE DISSENY

### 3.1 Tipografia

```css
/* Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

/* Variables */
--font-display: 'Plus Jakarta Sans', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

| Element | Font | Weight | Size |
|---------|------|--------|------|
| Headers | Plus Jakarta Sans | 600-700 | 14-16px |
| Body | Plus Jakarta Sans | 400-500 | 12-13px |
| Code/Badges | JetBrains Mono | 500 | 10-11px |

### 3.2 Paleta de Colors

```css
:root {
  /* Base (Dark Theme) */
  --bg-primary: #0f0f0f;
  --bg-secondary: #1a1a1a;
  --bg-tertiary: #252525;
  --bg-elevated: #2a2a2a;

  /* Text */
  --text-primary: #fafafa;
  --text-secondary: #a1a1a1;
  --text-muted: #666666;

  /* Accent (Emerald) */
  --accent: #10b981;
  --accent-hover: #34d399;
  --accent-muted: rgba(16, 185, 129, 0.15);

  /* Semantic */
  --success: #22c55e;
  --error: #ef4444;
  --warning: #f59e0b;

  /* Borders & Shadows */
  --border: rgba(255, 255, 255, 0.08);
  --border-hover: rgba(255, 255, 255, 0.15);
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4);
}
```

### 3.3 Spacing & Radius

```css
:root {
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-full: 9999px;
}
```

---

## 4. COMPONENTS REDISSENYATS

### 4.1 Navegació (Tabs)

**Abans**: Text tabs amb border-bottom
**Després**: Icon tabs amb pill selector animat

```
┌─────────────────────────────┐
│  [💬]   [⚡]   [🧠]        │  ← Icons amb tooltip
│   ═══                       │  ← Pill selector animat
└─────────────────────────────┘
```

**Features**:
- Icons en lloc de text (estalvi espai)
- Pill/indicator animat que es mou
- Hover states subtils
- Transició suau entre tabs

### 4.2 Chat Panel

**Abans**: Bubbles bàsiques amb colors Google
**Després**: Cards elegants amb glassmorphism subtil

```
┌─────────────────────────────┐
│                      ┌────┐ │
│                      │User│ │  ← Bubble dreta, accent color
│                      └────┘ │
│ ┌────────────────────┐      │
│ │ AI Response here   │      │  ← Card esquerra, glass effect
│ │ with nice styling  │      │
│ └────────────────────┘      │
└─────────────────────────────┘
```

**Features**:
- User bubbles: Accent color amb gradient subtil
- AI bubbles: Glass effect amb border subtle
- Animació d'entrada (fade + slide)
- Typing indicator més elegant (wave animation)
- Timestamps opcionals

### 4.3 Thinking Indicator

**Abans**: 3 dots pulsant
**Després**: Wave animation + shimmer effect

```css
/* Shimmer bar amb wave */
.thinking-bar {
  background: linear-gradient(90deg,
    var(--bg-tertiary) 25%,
    var(--accent-muted) 50%,
    var(--bg-tertiary) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
```

### 4.4 Input Area

**Abans**: Textarea + botó rodó
**Després**: Input integrat amb accions

```
┌─────────────────────────────┐
│ ┌─────────────────────────┐ │
│ │ Escriu el teu missatge  │ │
│ │                    [➤]  │ │  ← Botó integrat dins input
│ └─────────────────────────┘ │
│      Credits: 142 ⚡         │  ← Badge elegant
└─────────────────────────────┘
```

### 4.5 Receipts (Eines)

**Abans**: Pills amb gradient violeta
**Després**: Cards compactes amb hover reveal

```
┌─────────────────────────────┐
│ Les Teves Receptes          │
│                             │
│ ┌───────────┐ ┌───────────┐ │
│ │ ⚡ Formal │ │ 🚀 Resum  │ │  ← Cards 2-column grid
│ └───────────┘ └───────────┘ │
│ ┌───────────┐ ┌───────────┐ │
│ │ ✨ Millorar│ │ + Nova   │ │  ← Add button integrat
│ └───────────┘ └─ - - - - ─┘ │
└─────────────────────────────┘
```

**Features**:
- Grid 2 columnes
- Hover: revela botó delete
- Press effect (scale down)
- Subtle border glow on hover

### 4.6 Settings (Cervell)

**Abans**: Forms estàndard Google
**Després**: Cards agrupades amb visual hierarchy

```
┌─────────────────────────────┐
│ ⚙️ Configuració              │
│                             │
│ ┌─────────────────────────┐ │
│ │ 🔑 Llicència            │ │
│ │ ┌─────────────────────┐ │ │
│ │ │ SIDECAR-XXXX       │ │ │  ← Input amb icon
│ │ └─────────────────────┘ │ │
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │ 📝 Guia d'Estil         │ │
│ │ ┌─────────────────────┐ │ │
│ │ │ Sigues formal...   │ │ │  ← Textarea elegant
│ │ └─────────────────────┘ │ │
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │ 📎 Fitxer               │ │
│ │   exemple.pdf ✓         │ │  ← File status inline
│ │   [Canviar] [Esborrar]  │ │
│ └─────────────────────────┘ │
│                             │
│ ┌─────────────────────────┐ │
│ │ 🔒 Mode Estricte    [○] │ │  ← Toggle switch modern
│ └─────────────────────────┘ │
│                             │
│     [ ✓ Desar ]             │  ← Primary button
└─────────────────────────────┘
```

---

## 5. ANIMACIONS & MICRO-INTERACCIONS

### 5.1 Transicions Globals

```css
/* Base transition */
* {
  transition: background 0.2s ease,
              border-color 0.2s ease,
              transform 0.15s ease,
              opacity 0.2s ease;
}
```

### 5.2 Animacions Específiques

| Element | Animació | Durada |
|---------|----------|--------|
| Tab switch | Pill slide | 0.3s ease-out |
| Message appear | Fade + slide up | 0.25s ease-out |
| Button hover | Scale 1.02 + glow | 0.15s |
| Button press | Scale 0.98 | 0.1s |
| Receipt hover | Border glow | 0.2s |
| Thinking | Shimmer wave | 1.5s infinite |
| Panel switch | Fade | 0.2s |

### 5.3 Staggered Animations

```css
/* Receipts grid entrance */
.receipt-btn:nth-child(1) { animation-delay: 0ms; }
.receipt-btn:nth-child(2) { animation-delay: 50ms; }
.receipt-btn:nth-child(3) { animation-delay: 100ms; }
.receipt-btn:nth-child(4) { animation-delay: 150ms; }
```

---

## 6. EFECTES VISUALS

### 6.1 Glassmorphism (subtle)

```css
.glass {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border);
}
```

### 6.2 Glow Effects

```css
.glow-accent {
  box-shadow: 0 0 20px rgba(16, 185, 129, 0.2);
}

.glow-on-hover:hover {
  box-shadow: 0 0 0 1px var(--accent),
              0 0 20px rgba(16, 185, 129, 0.15);
}
```

### 6.3 Noise Texture (opcional)

```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,..."); /* noise SVG */
  opacity: 0.02;
  pointer-events: none;
}
```

---

## 7. PLA D'IMPLEMENTACIÓ

### Fase 1: Estructura Base (30 min)
- [ ] Noves CSS variables
- [ ] Import Google Fonts
- [ ] Reset body styles
- [ ] Layout base dark theme

### Fase 2: Navegació (20 min)
- [ ] Icon tabs
- [ ] Animated pill selector
- [ ] Hover states

### Fase 3: Chat Panel (30 min)
- [ ] Nous estils bubbles
- [ ] Animació entrada missatges
- [ ] Thinking indicator nou
- [ ] Input area redissenyat

### Fase 4: Eines Panel (25 min)
- [ ] Grid receipts 2-col
- [ ] Card styles nous
- [ ] Hover/delete reveals
- [ ] Form nova recepta

### Fase 5: Settings Panel (25 min)
- [ ] Card groups
- [ ] Inputs nous
- [ ] Toggle switch
- [ ] File upload area

### Fase 6: Polish (20 min)
- [ ] Animacions finals
- [ ] Micro-interaccions
- [ ] Test responsivitat
- [ ] Ajustos finals

---

## 8. PREVIEW VISUAL

```
┌─────────────────────────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ ← Header dark
│  [💬]    [⚡]    [🧠]          │ ← Icon tabs
│   ════                          │ ← Active indicator
├─────────────────────────────────┤
│                                 │
│                        ┌──────┐ │
│                        │ Hola │ │ ← User bubble (accent)
│                        └──────┘ │
│                                 │
│ ┌────────────────────────────┐  │
│ │ Hola! Com et puc ajudar?   │  │ ← AI bubble (glass)
│ └────────────────────────────┘  │
│                                 │
│ ┌────────────────────────────┐  │
│ │ ▓░░░░░░░░░░░░░░░░░░░░░░░░░│  │ ← Shimmer thinking
│ └────────────────────────────┘  │
│                                 │
├─────────────────────────────────┤
│ ┌─────────────────────────────┐ │
│ │ Escriu aquí...          [➤]│ │ ← Input integrat
│ └─────────────────────────────┘ │
│          ⚡ 142 crèdits         │ ← Credits badge
└─────────────────────────────────┘
```

---

## 9. NEXT STEPS

1. **Aprovar el pla** ✓
2. **Implementar Sidebar.html nou**
3. **Testejar a Google Docs**
4. **Ajustos finals**

---

*Pla creat amb frontend-design skill*
