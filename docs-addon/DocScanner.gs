/**
 * DocScanner.gs v3 - Performance, Visual Heuristics & Auto-Structure
 *
 * CANVIS v3:
 * - [NEW] applyAutoStructure() - Converteix visual headings a H2 reals
 * - [NEW] testAutoStructure() - Test manual
 *
 * CANVIS v2:
 * - Timeout safety cutoff (800ms màx)
 * - Detecció de "Visual Headings" (negreta, majúscules)
 * - Optimització: menys crides a objectes GAS
 * - Fix: p.isBold() no existeix, usar editAsText().isBold(0)
 */

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓ
// ═══════════════════════════════════════════════════════════════

const SCAN_CONFIG = {
  PREVIEW_LENGTH: 100,
  MAX_EXECUTION_MS: 800,  // Tallar si triguem massa
  MAX_HEADING_LENGTH: 80, // Títols no solen ser més llargs
  MIN_CONTENT_LENGTH: 20, // Ignorar paràgrafs massa curts

  // Auto-Structure
  AUTO_STRUCTURE_MAX_LENGTH: 100, // Màxim per considerar com a títol
  AUTO_STRUCTURE_MIN_LENGTH: 3,   // Mínim per no ser buit

  // Regex per entitats
  REGEX_MONEY: /\b\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s?[€$]/g,
  REGEX_DATE: /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g,
  REGEX_PERCENT: /\b\d+(?:[.,]\d+)?\s?%/g
};

// Patrons per detectar títols visuals (sense estil Heading)
const VISUAL_HEADING_PATTERNS = [
  /^[A-ZÀÈÉÍÒÓÚÇ][A-ZÀÈÉÍÒÓÚÇ\s\d\.\-\:]{2,}$/,  // TOT MAJÚSCULES
  /^\d+[\.\)\-]\s+.{3,}$/,                         // 1. Títol o 1) Títol
  /^[a-zA-Z][\.\)\-]\s+.{3,}$/,                    // a. Títol o a) Títol
  /^(?:Article|Clàusula|Secció|Capítol|Annex)\s+/i // Paraules clau legals
];

// ═══════════════════════════════════════════════════════════════
// FUNCIÓ PRINCIPAL
// ═══════════════════════════════════════════════════════════════

function getDocSkeleton() {
  const startTime = Date.now();

  const doc = DocumentApp.getActiveDocument();
  if (!doc) {
    return { error: "No hi ha document actiu", structure: [] };
  }

  const body = doc.getBody();
  const paragraphs = body.getParagraphs();
  const totalLength = body.getText().length;
  const pLength = paragraphs.length;

  const structure = [];
  let currentSection = null;
  let truncated = false;

  for (let i = 0; i < pLength; i++) {
    // 🛡️ SAFETY CUTOFF
    if ((Date.now() - startTime) > SCAN_CONFIG.MAX_EXECUTION_MS) {
      structure.push({
        type: "WARNING",
        text: "Scan truncat per temps (>" + SCAN_CONFIG.MAX_EXECUTION_MS + "ms)"
      });
      truncated = true;
      break;
    }

    const para = paragraphs[i];
    const text = para.getText();
    const trimmedText = text.trim();

    // Skip buits
    if (trimmedText.length < 3) continue;

    // Obtenir heading natiu
    const nativeHeading = para.getHeading();
    const isNativeHeading = (nativeHeading !== DocumentApp.ParagraphHeading.NORMAL);

    let headingType = null;

    if (isNativeHeading) {
      // ÉS UN HEADING NATIU
      headingType = mapHeadingType(nativeHeading);
    } else if (trimmedText.length <= SCAN_CONFIG.MAX_HEADING_LENGTH) {
      // 🧠 HEURÍSTICA VISUAL: Mirar si sembla un títol
      headingType = detectVisualHeading(para, trimmedText);
    }

    if (headingType) {
      // ═══ ÉS UN TÍTOL ═══
      // Tancar secció anterior
      currentSection = null;

      structure.push({
        type: headingType,
        text: trimmedText,
        index: i
      });
    } else if (trimmedText.length >= SCAN_CONFIG.MIN_CONTENT_LENGTH) {
      // ═══ ÉS CONTINGUT ═══
      const entities = extractEntitiesFast(trimmedText);

      if (currentSection) {
        // Afegir entitats al bloc actual
        if (entities.length > 0) {
          currentSection.entities.push(...entities);
        }
        currentSection.word_count += countWords(trimmedText);
      } else {
        // Crear nou bloc
        currentSection = {
          type: 'SECTION',
          preview: trimmedText.substring(0, SCAN_CONFIG.PREVIEW_LENGTH) +
                   (trimmedText.length > SCAN_CONFIG.PREVIEW_LENGTH ? '...' : ''),
          entities: entities,
          word_count: countWords(trimmedText)
        };
        structure.push(currentSection);
      }
    }
  }

  // Netejar duplicats d'entitats
  structure.forEach(function(item) {
    if (item.entities) {
      item.entities = uniqueArray(item.entities).slice(0, 10);
    }
  });

  const scanTime = Date.now() - startTime;

  return {
    doc_id: doc.getId(),
    doc_name: doc.getName(),
    structure: structure,
    stats: {
      total_chars: totalLength,
      paragraph_count: pLength,
      structure_items: structure.length,
      scan_time_ms: scanTime,
      truncated: truncated
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Mapeja heading natiu a string
 */
function mapHeadingType(heading) {
  switch (heading) {
    case DocumentApp.ParagraphHeading.TITLE: return 'TITLE';
    case DocumentApp.ParagraphHeading.SUBTITLE: return 'SUBTITLE';
    case DocumentApp.ParagraphHeading.HEADING1: return 'H1';
    case DocumentApp.ParagraphHeading.HEADING2: return 'H2';
    case DocumentApp.ParagraphHeading.HEADING3: return 'H3';
    case DocumentApp.ParagraphHeading.HEADING4: return 'H4';
    case DocumentApp.ParagraphHeading.HEADING5: return 'H5';
    case DocumentApp.ParagraphHeading.HEADING6: return 'H6';
    default: return null;
  }
}

/**
 * Detecta si un paràgraf SEMBLA un títol visualment
 * (Tot majúscules, negreta, numeració, etc.)
 */
function detectVisualHeading(para, text) {
  // 1. Comprovar patrons textuals
  for (var i = 0; i < VISUAL_HEADING_PATTERNS.length; i++) {
    if (VISUAL_HEADING_PATTERNS[i].test(text)) {
      return 'VISUAL_H';
    }
  }

  // 2. Comprovar si és negreta (costós, fer només si curt)
  if (text.length <= 60) {
    try {
      var textElement = para.editAsText();
      // Comprovar si el primer caràcter és bold
      if (textElement.isBold(0)) {
        // Verificar que la majoria del text és bold (no només la primera lletra)
        var midPoint = Math.floor(text.length / 2);
        if (textElement.isBold(midPoint)) {
          return 'BOLD_H';
        }
      }
    } catch (e) {
      // Si falla, ignorar
    }
  }

  return null;
}

/**
 * Extracció ràpida d'entitats (només regex, sense processament complex)
 */
function extractEntitiesFast(text) {
  var entities = [];

  var money = text.match(SCAN_CONFIG.REGEX_MONEY);
  if (money) {
    for (var i = 0; i < Math.min(money.length, 3); i++) {
      entities.push(money[i].trim());
    }
  }

  var dates = text.match(SCAN_CONFIG.REGEX_DATE);
  if (dates) {
    for (var i = 0; i < Math.min(dates.length, 3); i++) {
      entities.push(dates[i]);
    }
  }

  var percents = text.match(SCAN_CONFIG.REGEX_PERCENT);
  if (percents) {
    for (var i = 0; i < Math.min(percents.length, 2); i++) {
      entities.push(percents[i].trim());
    }
  }

  return entities;
}

/**
 * Comptar paraules ràpid
 */
function countWords(text) {
  return text.split(/\s+/).length;
}

/**
 * Eliminar duplicats d'array
 */
function uniqueArray(arr) {
  var seen = {};
  var result = [];
  for (var i = 0; i < arr.length; i++) {
    if (!seen[arr[i]]) {
      seen[arr[i]] = true;
      result.push(arr[i]);
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// AUTO-STRUCTURE: Convertir Visual Headings a H2 reals
// ═══════════════════════════════════════════════════════════════

/**
 * Aplica estil H2 als paràgrafs que semblen títols però no tenen estil
 * @returns {Object} Resultat amb comptador i detalls dels canvis
 */
function applyAutoStructure() {
  var startTime = Date.now();
  var results = {
    success: true,
    converted: 0,
    skipped: 0,
    errors: 0,
    details: [],
    execution_time_ms: 0
  };

  try {
    var doc = DocumentApp.getActiveDocument();
    if (!doc) {
      return { success: false, error: "No hi ha document actiu", converted: 0 };
    }

    var body = doc.getBody();
    var paragraphs = body.getParagraphs();
    var pLength = paragraphs.length;

    for (var i = 0; i < pLength; i++) {
      try {
        var para = paragraphs[i];
        var text = para.getText();
        var trimmedText = text.trim();

        // ═══ FILTRES DE SEGURETAT ═══

        // 1. Ignorar buits o massa curts
        if (trimmedText.length < SCAN_CONFIG.AUTO_STRUCTURE_MIN_LENGTH) {
          continue;
        }

        // 2. Ignorar massa llargs (no són títols)
        if (trimmedText.length > SCAN_CONFIG.AUTO_STRUCTURE_MAX_LENGTH) {
          continue;
        }

        // 3. Ignorar si ja té estil Heading
        var currentHeading = para.getHeading();
        if (currentHeading !== DocumentApp.ParagraphHeading.NORMAL) {
          results.skipped++;
          continue;
        }

        // ═══ DETECTAR VISUAL HEADING ═══
        var isVisualHeading = detectVisualHeadingForAutoStructure(para, trimmedText);

        if (isVisualHeading) {
          // ═══ APLICAR H2 ═══
          para.setHeading(DocumentApp.ParagraphHeading.HEADING2);
          results.converted++;
          results.details.push({
            index: i,
            text: trimmedText.substring(0, 50) + (trimmedText.length > 50 ? '...' : ''),
            reason: isVisualHeading
          });
        }

      } catch (paraError) {
        results.errors++;
        Logger.log('Error al paràgraf ' + i + ': ' + paraError.message);
      }
    }

  } catch (mainError) {
    results.success = false;
    results.error = mainError.message;
  }

  results.execution_time_ms = Date.now() - startTime;
  return results;
}

/**
 * Detecta si un paràgraf sembla un títol visual (per Auto-Structure)
 * Retorna el motiu de la detecció o null
 */
function detectVisualHeadingForAutoStructure(para, text) {
  // 1. Comprovar patrons textuals (majúscules, numeració, etc.)
  for (var i = 0; i < VISUAL_HEADING_PATTERNS.length; i++) {
    if (VISUAL_HEADING_PATTERNS[i].test(text)) {
      return 'PATTERN_MATCH';
    }
  }

  // 2. Comprovar si és tot negreta i curt (< 60 chars)
  if (text.length <= 60) {
    try {
      var textElement = para.editAsText();
      // Comprovar primer i mig del text
      if (textElement.isBold(0)) {
        var midPoint = Math.floor(text.length / 2);
        if (midPoint === 0 || textElement.isBold(midPoint)) {
          return 'BOLD_TEXT';
        }
      }
    } catch (e) {
      // Ignorar errors de format
    }
  }

  return null;
}

