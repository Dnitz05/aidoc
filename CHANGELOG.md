# Changelog

Totes les versions notables de SideCar estan documentades aquí.

Format basat en [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [3.1] - 2024-11-30

### Added
- **Shadow Validator** - Sistema de validació unificat amb auto-correcció
  - `validateResponse()` - Funció única per validar respostes (JSON, banned words, length)
  - `buildRetryFeedback()` - Genera feedback específic per cada tipus d'error
  - Time Budget de 25s (safety margin per evitar timeout de GAS)
  - Graceful degradation amb `_meta` field
- **Response Metadata** - Camp `_meta` a cada resposta API
  - `validation_passed`: boolean
  - `retries`: número d'intents
  - `timeout_aborted`: si s'ha avortat per temps
  - `elapsed_ms`: temps total de processament
  - `errors` / `warnings`: detalls de validació

### Changed
- Retry loop refactoritzat amb validació centralitzada
- Constants globals: `TIMEOUT_CUTOFF`, `MAX_RETRIES`
- `_debug.version` actualitzat a "3.1"

### Technical
- Arquitectura "Loop of Truth": Genera → Valida → Retry/Return
- Validació determinista (regex) abans de gastar tokens en retries

---

## [3.0] - 2024-11-30

### Added
- **Event Sourcing** - Historial complet d'edicions per document
  - Taula `edit_events` a Supabase
  - `saveEditEvent()` - Guarda cada edició
  - `getEditHistory()` - Recupera historial
  - `markEventReverted()` - Marca events com a revertits
- **Revert Any Edit** - Desfer qualsevol canvi de l'historial (no només l'últim)
  - `handleGetEditHistory()` endpoint
  - `handleRevertEdit()` endpoint
  - UI amb llista d'edicions i botons de revert
- **Edit Event Fields**:
  - `event_type`: UPDATE_BY_ID, REWRITE, REVERT, AUTO_STRUCTURE
  - `target_id`, `before_text`, `after_text`
  - `user_instruction`, `thought`, `ai_mode`
  - `reverted_at`, `reverted_by` (self-referencing FK)

### Changed
- Response inclou `event_id` per tracking
- `_debug` inclou `event_saved` boolean

---

## [2.9] - 2024-11-30

### Added
- **Context Engine** - Anàlisi estructural del document
  - `DocScanner.gs` - Nou fitxer amb lògica d'escaneig
  - `getDocSkeleton()` - Extreu estructura (headings, seccions, entitats)
  - Detecció de "Visual Headings" (negreta, majúscules, numeració)
  - Extracció d'entitats: dates, imports (€/$), percentatges
- **Auto-Structure** - Converteix visual headings a H2 reals
  - `applyAutoStructure()` - Aplica estils automàticament
  - Detecció de patrons: `BOLD_H`, `VISUAL_H`
- **Skeleton Preview UI** (Sprint 2.5)
  - Badges de color per tipus (heading=blau, visual=taronja, section=gris)
  - Indentació jeràrquica
  - Banner de suggeriment: "Detectats X títols sense format"
  - `getContextSummary()` - Versió lleugera per UI
- **Structure Hints** - Tip one-time al chat quan hi ha visual headings

### Technical
- `doc_skeleton` enviat al worker com a context
- System prompt inclou secció "ESTRUCTURA DEL DOCUMENT"
- Safety cutoff de 800ms per escaneig
- `SCAN_CONFIG` amb paràmetres configurables

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
