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
 * Configuració del windowing v8.4
 *
 * v8.4: Límits augmentats per millor context en CHAT
 */
const WINDOW_CONFIG = {
  // Màxim de paràgrafs a incloure en el context (augmentat de 30 a 50)
  max_paragraphs: 50,

  // Paràgrafs abans/després de la selecció
  selection_window_before: 3,
  selection_window_after: 3,

  // Màxim de caràcters per paràgraf (augmentat de 500 a 800)
  max_chars_per_paragraph: 800,

  // Màxim de caràcters totals pel context del document (augmentat de 8000 a 16000)
  max_total_chars: 16000,

  // Paràgrafs mínims a incloure sempre (inici del document)
  min_header_paragraphs: 2,

  // Pes per prioritzar paràgrafs (heading reduït de 2 a 1)
  weights: {
    selected: 10,
    cursor_adjacent: 5,
    recently_mentioned: 3,
    has_heading: 1,  // v8.4: Reduït per no sobre-prioritzar títols
    default: 1,
  },
};

/**
 * Configuració per mode document complet
 * Per preguntes que necessiten veure tot el document
 */
const FULL_DOC_CONFIG = {
  max_paragraphs: 100,
  max_total_chars: 32000,
  max_chars_per_paragraph: 1000,
};

/**
 * Patrons que indiquen necessitat de document complet
 */
const FULL_DOC_PATTERNS = [
  /\b(faltes?|errors?|ortogr[aà]fi[ac]|revisar?|corregi[rx])\b/i,
  /\b(resum(eix)?|resumir|síntesi|sintetitz)\b/i,
  /\b(tot el document|document sencer|complet)\b/i,
  /\b(quants?|compta|nombre de)\b/i,
  /\b(estructura|organitz|seccions)\b/i,
];

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
 * @param {number} maxParagraphs - Màxim de paràgrafs (opcional, per defecte WINDOW_CONFIG)
 * @returns {Array<number>} - IDs dels paràgrafs seleccionats
 */
function selectRelevantParagraphs(paragraphs, selectionContext = {}, maxParagraphs = null) {
  if (!paragraphs || paragraphs.length === 0) {
    return [];
  }

  const limit = maxParagraphs || WINDOW_CONFIG.max_paragraphs;

  const {
    selectedParagraphs = [],
    cursorPosition = null,
    recentlyMentioned = [],
  } = selectionContext;

  // Si el document és petit, incloure'l tot
  if (paragraphs.length <= limit) {
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
    if (selected.size >= limit) break;
    selected.add(item.id);
  }

  // Retornar ordenats per posició (mantenir ordre del document)
  return Array.from(selected).sort((a, b) => a - b);
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta si una instrucció necessita veure el document complet
 * @param {string} instruction - Instrucció de l'usuari
 * @returns {boolean}
 */
function needsFullDocument(instruction) {
  if (!instruction) return false;
  return FULL_DOC_PATTERNS.some(pattern => pattern.test(instruction));
}

/**
 * Construeix el context de document optimitzat
 *
 * @param {Array<Object>} paragraphs - Paràgrafs del document
 * @param {Object} options - Opcions de windowing
 * @param {Array<number>} options.selectedParagraphs - Paràgrafs seleccionats
 * @param {number} options.cursorPosition - Posició del cursor
 * @param {Array<number>} options.recentlyMentioned - Paràgrafs mencionats recentment
 * @param {string} options.selectedText - Text seleccionat
 * @param {string} options.instruction - Instrucció original (per detectar mode full doc)
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
      isFullDoc: false,
    };
  }

  const {
    selectedParagraphs = [],
    cursorPosition = null,
    recentlyMentioned = [],
    selectedText = null,
    instruction = '',
    // v14.3: Info de mode per decisió resumeix/explica
    userMode = 'edit',
    hasSelection = false,
    isPartialSelection = false,
  } = options;

  // v8.4: Detectar si necessitem document complet
  const useFullDoc = needsFullDocument(instruction);
  const config = useFullDoc ? FULL_DOC_CONFIG : WINDOW_CONFIG;

  if (useFullDoc) {
    logDebug('Using FULL_DOC mode for instruction', {
      instruction: instruction.substring(0, 50),
    });
  }

  // Seleccionar paràgrafs rellevants (amb límits adaptats)
  const relevantIds = selectRelevantParagraphs(paragraphs, {
    selectedParagraphs,
    cursorPosition,
    recentlyMentioned,
  }, config.max_paragraphs);

  // Construir context amb truncament
  let totalChars = 0;
  const windowedParagraphs = [];

  for (const id of relevantIds) {
    if (totalChars >= config.max_total_chars) {
      logDebug('Context truncated due to max_total_chars', {
        totalChars,
        includedCount: windowedParagraphs.length,
        mode: useFullDoc ? 'full_doc' : 'windowed',
      });
      break;
    }

    const para = paragraphs[id];
    const text = truncateParagraph(para.text || para, config.max_chars_per_paragraph);
    const charCount = text.length;

    if (totalChars + charCount > config.max_total_chars) {
      // Últim paràgraf, truncar més agressivament
      const remaining = config.max_total_chars - totalChars;
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
    isFullDoc: useFullDoc,
  });

  return {
    paragraphs: windowedParagraphs,
    selectedParagraphIds: selectedParagraphs,
    selectedText,
    totalParagraphs: paragraphs.length,
    includedParagraphs: windowedParagraphs.length,
    isComplete,
    isFullDoc: useFullDoc,
    // v14.3: Info de mode per decisió resumeix/explica
    userMode,
    hasSelection,
    isPartialSelection,
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

  // Paràgrafs v13.5: Format {{N}} per connexió explícita amb resposta [[§N|...]]
  // La IA veu {{5}} i sap que ha d'escriure §5 a la resposta
  // IMPORTANT: Format simple sense [HEADING] per coherència amb l'exemple del prompt
  for (const para of windowedContext.paragraphs) {
    const prefix = para.isSelected ? '>>> ' : '';
    // Format: {{ID}} text (la IA veu el número explícitament)
    lines.push(`{{${para.id + 1}}} ${prefix}${para.text}`);
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
  FULL_DOC_CONFIG,
  FULL_DOC_PATTERNS,

  // Window selection
  selectRelevantParagraphs,
  calculatePriority,
  needsFullDocument,

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
