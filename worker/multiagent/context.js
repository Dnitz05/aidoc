/**
 * Multi-Agent System Context Windowing v8.3
 *
 * Gestió intel·ligent del context del document per optimitzar
 * l'ús de tokens i millorar la precisió del classifier.
 *
 * Estratègies:
 * - Windowing basat en selecció
 * - Priorització de paràgrafs rellevants
 * - Compressió de context per documents grans
 * - Extracció d'estructura del document
 */

import { logDebug } from './telemetry.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

/**
 * Configuració del windowing
 */
const WINDOW_CONFIG = {
  // Màxim de paràgrafs a incloure en el context
  max_paragraphs: 30,

  // Paràgrafs abans/després de la selecció
  selection_window_before: 3,
  selection_window_after: 3,

  // Màxim de caràcters per paràgraf (truncar si excedeix)
  max_chars_per_paragraph: 500,

  // Màxim de caràcters totals pel context del document
  max_total_chars: 8000,

  // Paràgrafs mínims a incloure sempre (inici del document)
  min_header_paragraphs: 2,

  // Pes per prioritzar paràgrafs
  weights: {
    selected: 10,
    cursor_adjacent: 5,
    recently_mentioned: 3,
    has_heading: 2,
    default: 1,
  },
};

// ═══════════════════════════════════════════════════════════════
// PARAGRAPH UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta si un paràgraf és un heading
 * @param {string} text - Text del paràgraf
 * @returns {boolean}
 */
function isHeading(text) {
  if (!text) return false;

  // Headings típics de Google Docs
  // - Text curt (menys de 100 caràcters)
  // - Pot començar amb números (1., 1.1, etc.)
  // - No acaba en punt normalment

  const trimmed = text.trim();

  // Molt curt és sospitós de heading
  if (trimmed.length < 80 && !trimmed.endsWith('.') && !trimmed.endsWith(',')) {
    // Patrons de heading
    if (/^(?:\d+\.?\s*)+/.test(trimmed)) return true; // 1. Títol, 1.1 Subtítol
    if (/^[A-ZÀÈÉÍÒÓÚ][^.]{0,60}$/.test(trimmed)) return true; // Comença majúscula, sense punt
    if (/^(?:article|secció|capítol|part)\s+/i.test(trimmed)) return true;
  }

  return false;
}

/**
 * Trunca un paràgraf si és massa llarg
 * @param {string} text - Text del paràgraf
 * @param {number} maxChars - Màxim de caràcters
 * @returns {string}
 */
function truncateParagraph(text, maxChars = WINDOW_CONFIG.max_chars_per_paragraph) {
  if (!text || text.length <= maxChars) return text;

  // Truncar a la paraula més propera
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxChars * 0.8) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

// ═══════════════════════════════════════════════════════════════
// WINDOW SELECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Calcula la prioritat d'un paràgraf
 * @param {number} paraId - ID del paràgraf
 * @param {Object} context - Context amb selecció i historial
 * @returns {number}
 */
function calculatePriority(paraId, context) {
  let priority = WINDOW_CONFIG.weights.default;

  const {
    selectedParagraphs = [],
    cursorPosition = null,
    recentlyMentioned = [],
    paragraphs = [],
  } = context;

  // Paràgraf seleccionat
  if (selectedParagraphs.includes(paraId)) {
    priority += WINDOW_CONFIG.weights.selected;
  }

  // Adjacent al cursor
  if (cursorPosition !== null) {
    const distance = Math.abs(paraId - cursorPosition);
    if (distance <= WINDOW_CONFIG.selection_window_before ||
        distance <= WINDOW_CONFIG.selection_window_after) {
      priority += WINDOW_CONFIG.weights.cursor_adjacent / (distance + 1);
    }
  }

  // Mencionat recentment en la conversa
  if (recentlyMentioned.includes(paraId)) {
    priority += WINDOW_CONFIG.weights.recently_mentioned;
  }

  // És un heading
  if (paragraphs[paraId] && isHeading(paragraphs[paraId].text)) {
    priority += WINDOW_CONFIG.weights.has_heading;
  }

  return priority;
}

/**
 * Selecciona els paràgrafs més rellevants per incloure en el context
 * @param {Array<Object>} paragraphs - Tots els paràgrafs
 * @param {Object} selectionContext - Context de selecció
 * @returns {Array<number>} - IDs dels paràgrafs seleccionats
 */
function selectRelevantParagraphs(paragraphs, selectionContext = {}) {
  if (!paragraphs || paragraphs.length === 0) {
    return [];
  }

  const {
    selectedParagraphs = [],
    cursorPosition = null,
    recentlyMentioned = [],
  } = selectionContext;

  // Si el document és petit, incloure'l tot
  if (paragraphs.length <= WINDOW_CONFIG.max_paragraphs) {
    return paragraphs.map((_, i) => i);
  }

  // Calcular prioritats
  const priorities = paragraphs.map((para, i) => ({
    id: i,
    priority: calculatePriority(i, {
      selectedParagraphs,
      cursorPosition,
      recentlyMentioned,
      paragraphs,
    }),
    isHeader: isHeading(para.text),
  }));

  // Ordenar per prioritat
  priorities.sort((a, b) => b.priority - a.priority);

  // Seleccionar els millors
  const selected = new Set();

  // Sempre incloure primers paràgrafs (headers del document)
  for (let i = 0; i < Math.min(WINDOW_CONFIG.min_header_paragraphs, paragraphs.length); i++) {
    selected.add(i);
  }

  // Afegir paràgrafs per prioritat fins al màxim
  for (const item of priorities) {
    if (selected.size >= WINDOW_CONFIG.max_paragraphs) break;
    selected.add(item.id);
  }

  // Retornar ordenats per posició (mantenir ordre del document)
  return Array.from(selected).sort((a, b) => a - b);
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Construeix el context de document optimitzat
 *
 * @param {Array<Object>} paragraphs - Paràgrafs del document
 * @param {Object} options - Opcions de windowing
 * @param {Array<number>} options.selectedParagraphs - Paràgrafs seleccionats
 * @param {number} options.cursorPosition - Posició del cursor
 * @param {Array<number>} options.recentlyMentioned - Paràgrafs mencionats recentment
 * @param {string} options.selectedText - Text seleccionat
 * @returns {Object} - Context optimitzat
 */
function buildWindowedContext(paragraphs, options = {}) {
  if (!paragraphs || paragraphs.length === 0) {
    return {
      paragraphs: [],
      selectedParagraphIds: [],
      selectedText: options.selectedText || null,
      totalParagraphs: 0,
      includedParagraphs: 0,
      isComplete: true,
    };
  }

  const {
    selectedParagraphs = [],
    cursorPosition = null,
    recentlyMentioned = [],
    selectedText = null,
  } = options;

  // Seleccionar paràgrafs rellevants
  const relevantIds = selectRelevantParagraphs(paragraphs, {
    selectedParagraphs,
    cursorPosition,
    recentlyMentioned,
  });

  // Construir context amb truncament
  let totalChars = 0;
  const windowedParagraphs = [];

  for (const id of relevantIds) {
    if (totalChars >= WINDOW_CONFIG.max_total_chars) {
      logDebug('Context truncated due to max_total_chars', {
        totalChars,
        includedCount: windowedParagraphs.length,
      });
      break;
    }

    const para = paragraphs[id];
    const text = truncateParagraph(para.text || para);
    const charCount = text.length;

    if (totalChars + charCount > WINDOW_CONFIG.max_total_chars) {
      // Últim paràgraf, truncar més agressivament
      const remaining = WINDOW_CONFIG.max_total_chars - totalChars;
      if (remaining > 100) {
        windowedParagraphs.push({
          id,
          text: truncateParagraph(text, remaining),
          isSelected: selectedParagraphs.includes(id),
          isHeading: isHeading(text),
        });
      }
      break;
    }

    windowedParagraphs.push({
      id,
      text,
      isSelected: selectedParagraphs.includes(id),
      isHeading: isHeading(text),
    });

    totalChars += charCount;
  }

  const isComplete = windowedParagraphs.length === paragraphs.length;

  logDebug('Context window built', {
    total: paragraphs.length,
    included: windowedParagraphs.length,
    chars: totalChars,
    isComplete,
  });

  return {
    paragraphs: windowedParagraphs,
    selectedParagraphIds: selectedParagraphs,
    selectedText,
    totalParagraphs: paragraphs.length,
    includedParagraphs: windowedParagraphs.length,
    isComplete,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT FORMATTING
// ═══════════════════════════════════════════════════════════════

/**
 * Formata el context per al prompt del classifier
 * @param {Object} windowedContext - Context windowed
 * @returns {string}
 */
function formatContextForPrompt(windowedContext) {
  if (!windowedContext || !windowedContext.paragraphs || windowedContext.paragraphs.length === 0) {
    return '[Document buit]';
  }

  const lines = [];

  // Header amb info del document
  if (!windowedContext.isComplete) {
    lines.push(`[Document parcial: ${windowedContext.includedParagraphs}/${windowedContext.totalParagraphs} paràgrafs mostrats]`);
    lines.push('');
  }

  // Paràgrafs (v12.1: IDs 1-indexed per consistència amb UI)
  for (const para of windowedContext.paragraphs) {
    const prefix = para.isSelected ? '>>> ' : '';
    const headingMarker = para.isHeading ? ' [HEADING]' : '';
    // Mostrar ID + 1 per UI (l'usuari veu §1, §2... no §0, §1...)
    lines.push(`§${para.id + 1}${headingMarker}: ${prefix}${para.text}`);
  }

  // Text seleccionat si n'hi ha
  if (windowedContext.selectedText) {
    lines.push('');
    lines.push(`[Text seleccionat: "${windowedContext.selectedText}"]`);
  }

  return lines.join('\n');
}

/**
 * Formata el context de manera compacta per a l'executor
 * @param {Object} windowedContext - Context windowed
 * @param {Array<number>} targetIds - IDs dels paràgrafs target
 * @returns {string}
 */
function formatContextForExecutor(windowedContext, targetIds = []) {
  if (!windowedContext || !windowedContext.paragraphs) {
    return '';
  }

  const lines = [];

  // Només incloure paràgrafs target i context immediat
  const targetSet = new Set(targetIds);
  const contextIds = new Set();

  // Afegir paràgrafs adjacents als targets
  for (const id of targetIds) {
    contextIds.add(id);
    if (id > 0) contextIds.add(id - 1);
    if (id < windowedContext.totalParagraphs - 1) contextIds.add(id + 1);
  }

  for (const para of windowedContext.paragraphs) {
    if (targetSet.has(para.id)) {
      // Paràgraf target - mostrar complet (v12.1: 1-indexed)
      lines.push(`§${para.id + 1} [TARGET]: ${para.text}`);
    } else if (contextIds.has(para.id)) {
      // Context adjacent - mostrar truncat (v12.1: 1-indexed)
      lines.push(`§${para.id + 1}: ${truncateParagraph(para.text, 200)}`);
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// DOCUMENT STRUCTURE EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extreu l'estructura del document (headings, seccions)
 * @param {Array<Object>} paragraphs - Paràgrafs del document
 * @returns {Object} - Estructura del document
 */
function extractDocumentStructure(paragraphs) {
  if (!paragraphs || paragraphs.length === 0) {
    return { headings: [], sections: [] };
  }

  const headings = [];
  const sections = [];
  let currentSection = null;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const text = para.text || para;

    if (isHeading(text)) {
      // Tancar secció anterior si existeix
      if (currentSection) {
        currentSection.endId = i - 1;
        sections.push(currentSection);
      }

      // Nova secció
      headings.push({ id: i, text: text.trim() });
      currentSection = {
        headingId: i,
        headingText: text.trim(),
        startId: i,
        endId: null,
      };
    }
  }

  // Tancar última secció
  if (currentSection) {
    currentSection.endId = paragraphs.length - 1;
    sections.push(currentSection);
  }

  return { headings, sections };
}

/**
 * Troba la secció a la qual pertany un paràgraf
 * @param {number} paraId - ID del paràgraf
 * @param {Array<Object>} sections - Seccions del document
 * @returns {Object|null}
 */
function findSection(paraId, sections) {
  for (const section of sections) {
    if (paraId >= section.startId && paraId <= section.endId) {
      return section;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // Configuration
  WINDOW_CONFIG,

  // Window selection
  selectRelevantParagraphs,
  calculatePriority,

  // Context building
  buildWindowedContext,
  formatContextForPrompt,
  formatContextForExecutor,

  // Document structure
  extractDocumentStructure,
  findSection,

  // Utilities
  isHeading,
  truncateParagraph,
};
