# Changelog

Totes les versions notables de SideCar estan documentades aquí.

Format basat en [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [2.8] - 2024-11-30

### Added
- **Banned Expressions** - Paraules/frases que la IA mai usarà
  - UI: Secció "Paraules Prohibides" a Configuració
  - UI: Botó "Prohibir" després d'edicions
  - Persistència a `PropertiesService`
- **Hybrid Validator** - Validació local (regex) + LLM retry
  - Pre-check sense cost de tokens
  - Retry automàtic si resposta conté paraules prohibides
- **Toast Notifications** - Feedback visual per accions de banned words

### Changed
- `MAX_RETRIES` incrementat a 2 (per permetre retry de banned words)
- System Prompt inclou secció "PARAULES PROHIBIDES" quan n'hi ha
- Debug info inclou `banned_word_retry` i `negative_constraints_count`

### Technical
- `findBannedWords()` - Validació local amb word boundaries
- `getOutputText()` - Extracció de text de resposta per validació
- `negative_constraints` al payload GAS → Worker

---

## [2.7] - 2024-11-30

### Added
- **Document Engineering Engine** - Nou system prompt estil Lovable
- **Chain of Thought obligatori** - Camp `thought` en totes les respostes
- **Retry Loop** - Auto-correcció quan JSON és invàlid (1 retry amb feedback)
- Protocol d'execució: Intenció → Localització → Estratègia

### Changed
- Identitat: de "assistent" a "Motor d'Enginyeria Documental"
- Temperatura reduïda en retry (0.4 → 0.2)
- Modes amb noms nous: CONSULTOR, ENGINYER, ARQUITECTE

### Debug
- `_debug.retries` - número d'intents
- `_debug.thought` - raonament de la IA

---

## [2.6.2] - 2024-11-30

### Added
- **Mode Selector** (estil Cursor) - Dropdown al costat del botó enviar
  - Auto (✨) - La IA decideix
  - Edit (✏️) - Sempre edita
  - Xat (💬) - Mai edita
- Persistència del mode a localStorage
- Mode enforcement al backend

### Changed
- Input area redissenyada amb selector integrat

---

## [2.6.1] - 2024-11-30

### Fixed
- **originalText preservat** en cadenes d'alternatives ("una altra" x3)
- Després de revert: `currentText = originalText` (permet "una altra" post-undo)

### Improved
- Flux de sinònims ara funciona correctament:
  ```
  llegendes → faules → contes → [Desfer] → llegendes
  ```

---

## [2.6] - 2024-11-30

### Added
- **lastEdit Memory** - Guarda `{targetId, originalText, currentText}`
- **Botó Desfer** al costat de "Document modificat"
- Funció `revertLastEdit()` per tornar a l'original
- `last_edit` enviat al worker per context

### Storage
- `DocumentProperties` per persistència per-document
- Constants: `LAST_EDIT_KEY`

---

## [2.5.1] - 2024-11-29

### Fixed
- Instruccions de continuïtat al prompt ("una altra", "no m'agrada")

---

## [2.5] - 2024-11-29

### Added
- **pinned_prefs** - Preferències per document (idioma, to, estil)
- Historial de xat ampliat de 6 a 12 missatges

### Changed
- Bloc de preferències al prompt de Gemini

---

## [2.4.1] - 2024-11-29

### Added
- **safeParseJSON** - Extracció de JSON fins i tot amb text al voltant
- **modeMap** - Normalització de qualsevol mode a valors vàlids
- Fallbacks finals - MAI retorna resposta buida

### Fixed
- Robustesa general contra respostes mal formades

---

## [2.4] - 2024-11-29

### Added
- **Chat History** - Memòria conversacional (6 → 12 missatges)
- Context de conversa enviat a cada petició

### Changed
- `getRecentHistory()` retorna últims 12 missatges

---

## [2.3] - 2024-11-29

### Added
- **User Receipts** - Macros personalitzades (Custom Actions)
- CRUD complet: crear, llistar, eliminar
- Emojis seleccionables per cada recepta
- Persistència a Supabase (`user_receipts` table)

### UI
- Panell "Eines" amb grid de receptes
- Formulari de nova recepta amb emoji picker

---

## [2.2] - 2024-11-29

### Added
- **Thinking Indicator** - Animació de shimmer mentre processa
- **Edit Badge** - Etiqueta "Document modificat" quan hi ha canvis
- **Credits Display** - Mostra crèdits restants

### UI
- Barra inferior amb crèdits
- Badges amb estils per mode

---

## [2.1] - 2024-11-29

### Added
- **Dark Theme** - Mode fosc complet
- Toggle a configuració
- Persistència a localStorage

### UI
- Variables CSS per temes
- Transicions suaus entre temes

---

## [2.0] - 2024-11-28

### Added
- **Sidebar Redesign** - UI completament nova
- Navegació per tabs (Xat, Eines, Configuració)
- Pill animat per navegació
- Fonts: Plus Jakarta Sans + JetBrains Mono

### Architecture
- Menu "SideCar" en lloc d'obertura automàtica
- `onOpen()` crea menú, `showSidebar()` obre panell

### Fixed
- Trigger permissions (simple trigger → menu-based)

---

## [1.x] - 2024-11-27

### Initial
- Sidebar bàsic
- Integració Gemini
- UPDATE_BY_ID mode
- Knowledge files (PDF/TXT)
- Llicències via Supabase

---

## Llegenda

- **Added** - Noves features
- **Changed** - Canvis en features existents
- **Fixed** - Bugs arreglats
- **Removed** - Features eliminades
- **Security** - Vulnerabilitats arreglades
