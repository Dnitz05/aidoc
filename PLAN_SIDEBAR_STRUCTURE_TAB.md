# PLA: Nova Pestanya d'Estructura del Document

## Objectiu
Reorganitzar la sidebar per tenir una pestanya dedicada exclusivament a l'estructura del document, amb un disseny professional i funcional.

---

## CANVIS RESUM

| Element | Ubicació Actual | Nova Ubicació |
|---------|-----------------|---------------|
| Document Skeleton | Tools Panel | **Nova pestanya Structure** |
| Auto-Structure | Tools Panel | **Nova pestanya Structure** |
| Historial d'Edicions | Tools Panel | **Brain/Settings Panel** |
| Les Teves Receptes | Tools Panel | **ELIMINAR** (ja hi ha Recipes) |
| Tools Panel | Tab 2 | **ELIMINAR** (queda buit) |

---

## NOVA ESTRUCTURA DE TABS

```
ABANS (5 tabs):
[Chat] [Tools] [Docs] [Recipes] [Brain]
  💬     ⚡      📄      📖       ⚙️

DESPRÉS (5 tabs):
[Chat] [Structure] [Docs] [Recipes] [Brain]
  💬      🗂️        📄      📖       ⚙️
```

**Nota:** Mantenim 5 pestanyes per coherència visual.

---

## DISSENY: PESTANYA STRUCTURE

### Filosofia de Disseny
- **Minimalista però informatiu**
- **Jerarquia visual clara**
- **Interactiu** - navegació ràpida al document
- **Professional** - inspirat en editors com Notion/Obsidian

### Layout Proposat

```
┌─────────────────────────────────────────────────┐
│  STRUCTURE PANEL                                │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─ DOCUMENT OVERVIEW ────────────────────────┐ │
│  │                                            │ │
│  │  📊 Stats Bar                              │ │
│  │  ┌──────────┬──────────┬──────────┐       │ │
│  │  │ 1,234    │ 8        │ 3        │       │ │
│  │  │ caràcters│ paràgrafs│ headings │       │ │
│  │  └──────────┴──────────┴──────────┘       │ │
│  │                                            │ │
│  │  Last scan: 2 min ago                      │ │
│  │                                            │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ DOCUMENT OUTLINE ─────────────────────────┐ │
│  │                                            │ │
│  │  🔍 [Cerca al document...]                 │ │
│  │                                            │ │
│  │  ┌────────────────────────────────────┐    │ │
│  │  │ ▸ H1  Introducció              ¶0 │    │ │
│  │  │   ├─ H2  Context               ¶1 │    │ │
│  │  │   │   └─ P   Lorem ipsum...    ¶2 │    │ │
│  │  │   └─ H2  Objectius             ¶3 │    │ │
│  │  │ ▸ H1  Desenvolupament          ¶4 │    │ │
│  │  │   ├─ H2  Fase 1                ¶5 │    │ │
│  │  │   │   ├─ BOLD  Important!      ¶6 │    │ │
│  │  │   │   └─ P   Descripció...     ¶7 │    │ │
│  │  │   └─ H2  Fase 2                ¶8 │    │ │
│  │  │ ▸ H1  Conclusions              ¶9 │    │ │
│  │  └────────────────────────────────────┘    │ │
│  │                                            │ │
│  │  Click to navigate · Hover for preview     │ │
│  │                                            │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ ENTITIES DETECTED ────────────────────────┐ │
│  │                                            │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐      │ │
│  │  │ 📅 3    │ │ 💶 2    │ │ 📊 5    │      │ │
│  │  │ dates   │ │ amounts │ │ numbers │      │ │
│  │  └─────────┘ └─────────┘ └─────────┘      │ │
│  │                                            │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ QUICK ACTIONS ────────────────────────────┐ │
│  │                                            │ │
│  │  [🔄 Refresh]  [✨ Auto-Structure]         │ │
│  │                                            │ │
│  │  ┌────────────────────────────────────┐    │ │
│  │  │ 💡 Suggestion:                     │    │ │
│  │  │ "El ¶3 podria ser un H2"           │    │ │
│  │  │ [Apply] [Dismiss]                  │    │ │
│  │  └────────────────────────────────────┘    │ │
│  │                                            │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## COMPONENTS DETALLATS

### 1. Stats Bar (Document Overview)
```css
.structure-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.stat-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--accent); /* emerald */
}

.stat-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```

### 2. Document Outline (Tree View)
```javascript
// Estructura de dades
const outline = [
  {
    id: 0,
    type: 'H1',
    text: 'Introducció',
    depth: 0,
    children: [
      { id: 1, type: 'H2', text: 'Context', depth: 1, children: [...] },
      { id: 3, type: 'H2', text: 'Objectius', depth: 1, children: [] }
    ]
  },
  // ...
];

// Comportament:
// - Click → Scroll al paràgraf en el document
// - Hover → Preview del contingut
// - Drag & Drop → Reordenar (futur)
```

```css
.outline-tree {
  font-family: var(--font-mono);
  font-size: 13px;
}

.outline-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}

.outline-item:hover {
  background: rgba(16, 185, 129, 0.1);
}

.outline-item.active {
  background: rgba(16, 185, 129, 0.15);
  border-left: 2px solid var(--accent);
}

.outline-type {
  background: rgba(16, 185, 129, 0.2);
  color: var(--accent);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  margin-right: 8px;
  min-width: 32px;
  text-align: center;
}

.outline-type.h1 { background: rgba(99, 102, 241, 0.2); color: #818cf8; }
.outline-type.h2 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
.outline-type.h3 { background: rgba(14, 165, 233, 0.2); color: #38bdf8; }
.outline-type.bold { background: rgba(249, 115, 22, 0.2); color: #fb923c; }
.outline-type.p { background: rgba(255,255,255,0.05); color: var(--text-muted); }

.outline-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-id {
  color: var(--text-muted);
  font-size: 11px;
  opacity: 0.5;
}

/* Indentation per depth */
.outline-item[data-depth="1"] { padding-left: 24px; }
.outline-item[data-depth="2"] { padding-left: 40px; }
.outline-item[data-depth="3"] { padding-left: 56px; }
```

### 3. Entities Panel
```html
<div class="entities-grid">
  <div class="entity-card" data-type="dates">
    <span class="entity-icon">📅</span>
    <span class="entity-count">3</span>
    <span class="entity-label">dates</span>
  </div>
  <!-- més entitats... -->
</div>
```

### 4. Quick Actions
```html
<div class="structure-actions">
  <button class="btn-secondary" onclick="refreshStructure()">
    <span>🔄</span> Refresh
  </button>
  <button class="btn-primary" onclick="runAutoStructure()">
    <span>✨</span> Auto-Structure
  </button>
</div>

<!-- Suggestion Card (si n'hi ha) -->
<div class="suggestion-card" id="structureSuggestion">
  <div class="suggestion-icon">💡</div>
  <div class="suggestion-content">
    <div class="suggestion-text">El ¶3 podria ser un H2</div>
    <div class="suggestion-actions">
      <button onclick="applySuggestion()">Apply</button>
      <button onclick="dismissSuggestion()">Dismiss</button>
    </div>
  </div>
</div>
```

---

## DISSENY: HISTORIAL A SETTINGS

### Nova secció al Brain Panel

```
┌─────────────────────────────────────────────────┐
│  BRAIN/SETTINGS PANEL                           │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─ LICENSE ──────────────────────────────────┐ │
│  │ 🔑 [••••••••••••••••] [Save]              │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ STYLE GUIDE ──────────────────────────────┐ │
│  │ 📝 [textarea...]                          │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ EDIT HISTORY ─────────────────────────────┐ │  <-- NOU!
│  │                                            │ │
│  │  📜 Últimes edicions                       │ │
│  │                                            │ │
│  │  ┌────────────────────────────────────┐    │ │
│  │  │ ✏️ "Traduir al castellà"  │ ↩ Desfer│    │ │
│  │  │    Edit · 2 min · ¶3              │    │ │
│  │  ├────────────────────────────────────┤    │ │
│  │  │ 📝 "Fer més formal"       │ ↩ Desfer│    │ │
│  │  │    Rewrite · 5 min · ¶1           │    │ │
│  │  └────────────────────────────────────┘    │ │
│  │                                            │ │
│  │  [🔄 Refresh] [🗑️ Clear All]              │ │
│  │                                            │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ APPEARANCE ───────────────────────────────┐ │
│  │ 🌙 Dark Theme  [toggle]                   │ │
│  │ 🎨 Accent: [emerald ▼]                    │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌─ DANGER ZONE ──────────────────────────────┐ │
│  │ 🗑️ Clear all data                         │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## PASSOS D'IMPLEMENTACIÓ

### Fase 1: Preparació
1. Llegir `Sidebar.html` actual
2. Identificar totes les funcions JS relacionades

### Fase 2: Nova Pestanya Structure
1. Afegir nou tab button amb icon `🗂️`
2. Crear `structurePanel` div
3. Implementar stats bar
4. Implementar outline tree amb jerarquia visual
5. Implementar entities grid
6. Implementar actions i suggestions

### Fase 3: Moure Historial
1. Crear nova secció "Edit History" dins brainPanel
2. Moure HTML de historyCard
3. Actualitzar `switchTab()` per no fer refresh a tools
4. Afegir refresh a brain tab

### Fase 4: Netejar Tools Panel
1. Eliminar "Les Teves Receptes" section
2. Eliminar `toolsPanel` completament
3. Eliminar tab button de tools
4. Actualitzar `switchTab()` function
5. Actualitzar `updateNavPill()` positions

### Fase 5: Testing
1. Verificar navegació entre tabs
2. Verificar refresh d'estructura
3. Verificar historial funciona des de Settings
4. Verificar que receptes segueixen funcionant al seu panel

---

## COLORS I ESTIL (Coherent amb Dark Theme)

```css
:root {
  /* Existing theme */
  --bg-primary: #0d0d0d;
  --bg-secondary: #141414;
  --bg-tertiary: #1a1a1a;
  --accent: #10b981;
  --text-primary: #f4f4f5;
  --text-secondary: #a1a1aa;
  --text-muted: #71717a;

  /* Nous per Structure */
  --structure-h1: #818cf8;  /* indigo */
  --structure-h2: #60a5fa;  /* blue */
  --structure-h3: #38bdf8;  /* sky */
  --structure-bold: #fb923c; /* orange */
  --structure-p: #71717a;    /* muted */
}
```

---

## APROVAT PER IMPLEMENTAR?

Esperant confirmació de l'usuari abans de procedir amb la implementació.
