/**
 * DocScanner.gs - Smart Skeleton for Context Engine
 * Sprint 2: Deep Context
 *
 * Genera una "radiografia estructural" del document sense llegir tot el contingut.
 * Objectiu: Estalviar tokens i donar context intel·ligent a la IA.
 */

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const PREVIEW_WORDS = 15;       // Paraules per preview de secció
const PREVIEW_CHARS = 100;      // Màxim chars per preview
const MAX_ENTITIES = 10;        // Màxim entitats per secció
const MAX_NAMES = 5;            // Màxim noms propis per secció

// Regex patterns per extracció d'entitats
const PATTERNS = {
  // Diners: 1.500€, 3000 $, 45,50€
  money: /\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s?[€$]/g,

  // Dates: 25/12/2024, 1-5-23, 31/12/24
  date: /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g,

  // Percentatges: 15%, 3,5%
  percent: /\d+(?:[.,]\d+)?\s?%/g,

  // Emails (simplificat)
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,

  // Noms propis: Majúscula al mig de frase (català/castellà)
  // Detecta "el Client Acme" o "la Maria García"
  properName: /(?<=[a-zàèéíòóúüç,\.]\s)[A-ZÀÈÉÍÒÓÚÜÇ][a-zàèéíòóúüç]+(?:\s[A-ZÀÈÉÍÒÓÚÜÇ][a-zàèéíòóúüç]+)*/g
};

// ═══════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Escaneja el document actiu i retorna un skeleton estructural lleuger.
 * Optimitzat per executar-se en <1 segon per documents de 50 pàgines.
 *
 * @returns {Object} Skeleton del document
 */
function getDocSkeleton() {
  const doc = DocumentApp.getActiveDocument();
  if (!doc) {
    return { error: "No hi ha document actiu", structure: [], total_length: 0 };
  }

  const body = doc.getBody();
  const paragraphs = body.getParagraphs();

  const structure = [];
  let sectionParagraphs = [];
  let lastHeadingIndex = -1;
  let totalLength = 0;
  let paragraphCount = 0;

  // ─── PASS 1: Recórrer paràgrafs ───
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const text = para.getText();
    const trimmedText = text.trim();

    // Skip empty paragraphs
    if (trimmedText.length === 0) continue;

    paragraphCount++;
    totalLength += text.length;

    const headingType = getHeadingType(para.getHeading());

    if (headingType !== null) {
      // ─── És un HEADING ───

      // Primer, tancar la secció anterior si n'hi ha
      if (sectionParagraphs.length > 0) {
        const summary = createSectionSummary(sectionParagraphs);
        if (summary) structure.push(summary);
        sectionParagraphs = [];
      }

      // Afegir el heading
      structure.push({
        type: headingType,
        text: trimmedText.substring(0, PREVIEW_CHARS),
        index: i
      });

      lastHeadingIndex = structure.length - 1;

    } else {
      // ─── És un paràgraf normal ───
      sectionParagraphs.push(trimmedText);
    }
  }

  // Tancar última secció
  if (sectionParagraphs.length > 0) {
    const summary = createSectionSummary(sectionParagraphs);
    if (summary) structure.push(summary);
  }

  // ─── PASS 2: Obtenir context del cursor ───
  const cursorContext = getCursorContext(doc, paragraphs, structure);

  return {
    doc_id: doc.getId(),
    doc_name: doc.getName(),
    structure: structure,
    cursor_location: cursorContext,
    stats: {
      total_chars: totalLength,
      paragraph_count: paragraphCount,
      heading_count: structure.filter(s => s.type !== 'SECTION').length,
      section_count: structure.filter(s => s.type === 'SECTION').length
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Mapeja ParagraphHeading de GAS a tipus simplificat
 */
function getHeadingType(heading) {
  const map = {
    [DocumentApp.ParagraphHeading.TITLE]: 'TITLE',
    [DocumentApp.ParagraphHeading.SUBTITLE]: 'SUBTITLE',
    [DocumentApp.ParagraphHeading.HEADING1]: 'H1',
    [DocumentApp.ParagraphHeading.HEADING2]: 'H2',
    [DocumentApp.ParagraphHeading.HEADING3]: 'H3',
    [DocumentApp.ParagraphHeading.HEADING4]: 'H4',
    [DocumentApp.ParagraphHeading.HEADING5]: 'H5',
    [DocumentApp.ParagraphHeading.HEADING6]: 'H6'
  };
  return map[heading] || null;
}

/**
 * Crea un resum d'una secció (paràgrafs entre headings)
 */
function createSectionSummary(paragraphs) {
  if (paragraphs.length === 0) return null;

  // Combinar paràgrafs per extracció d'entitats
  const fullText = paragraphs.join(' ');

  // Només les primeres N paraules com a preview
  const words = fullText.split(/\s+/);
  const previewWords = words.slice(0, PREVIEW_WORDS);
  let preview = previewWords.join(' ');

  if (preview.length > PREVIEW_CHARS) {
    preview = preview.substring(0, PREVIEW_CHARS);
  }

  if (words.length > PREVIEW_WORDS) {
    preview += '...';
  }

  // Extreure entitats
  const entities = extractEntities(fullText);

  return {
    type: 'SECTION',
    preview: preview,
    word_count: words.length,
    paragraph_count: paragraphs.length,
    entities: entities
  };
}

/**
 * Extreu entitats del text usant regex (sense IA)
 * Retorna array de strings simples per estalviar tokens
 */
function extractEntities(text) {
  const entities = [];

  // Diners
  const money = text.match(PATTERNS.money);
  if (money) {
    money.slice(0, 3).forEach(m => entities.push(m.trim()));
  }

  // Dates
  const dates = text.match(PATTERNS.date);
  if (dates) {
    dates.slice(0, 3).forEach(d => entities.push(d));
  }

  // Percentatges
  const percents = text.match(PATTERNS.percent);
  if (percents) {
    percents.slice(0, 2).forEach(p => entities.push(p.trim()));
  }

  // Emails
  const emails = text.match(PATTERNS.email);
  if (emails) {
    emails.slice(0, 2).forEach(e => entities.push(e));
  }

  // Noms propis (més restrictiu per evitar falsos positius)
  try {
    const names = text.match(PATTERNS.properName);
    if (names) {
      // Filtrar noms massa curts i duplicats
      const uniqueNames = [...new Set(names)]
        .filter(n => n.length >= 3 && !isCommonWord(n))
        .slice(0, MAX_NAMES);
      uniqueNames.forEach(n => entities.push(n));
    }
  } catch (e) {
    // Lookbehind pot fallar en alguns motors - ignorar
  }

  // Limitar i eliminar duplicats
  return [...new Set(entities)].slice(0, MAX_ENTITIES);
}

/**
 * Filtra paraules comunes que poden semblar noms propis
 */
function isCommonWord(word) {
  const common = [
    'El', 'La', 'Els', 'Les', 'Un', 'Una', 'Uns', 'Unes',
    'I', 'O', 'Però', 'Que', 'Com', 'Per', 'De', 'Del',
    'En', 'Amb', 'Sense', 'Segons', 'Durant', 'Entre',
    'Article', 'Secció', 'Capítol', 'Punt', 'Annex',
    'Primer', 'Segon', 'Tercer', 'Quart'
  ];
  return common.includes(word);
}

/**
 * Obté el context de la posició del cursor
 */
function getCursorContext(doc, paragraphs, structure) {
  try {
    // Intentar obtenir cursor
    const cursor = doc.getCursor();
    let cursorElement = null;
    let cursorOffset = 0;

    if (cursor) {
      cursorElement = cursor.getElement();
      cursorOffset = cursor.getOffset();
    } else {
      // Provar amb selecció
      const selection = doc.getSelection();
      if (selection) {
        const ranges = selection.getRangeElements();
        if (ranges && ranges.length > 0) {
          cursorElement = ranges[0].getElement();
        }
      }
    }

    if (!cursorElement) {
      return {
        has_cursor: false,
        index: -1,
        nearest_heading: null
      };
    }

    // Trobar el paràgraf on està el cursor
    let cursorParagraphIndex = -1;
    const cursorText = cursorElement.getType() === DocumentApp.ElementType.TEXT
      ? cursorElement.getParent().asText().getText()
      : (cursorElement.asText ? cursorElement.asText().getText() : '');

    for (let i = 0; i < paragraphs.length; i++) {
      if (paragraphs[i].getText() === cursorText) {
        cursorParagraphIndex = i;
        break;
      }
    }

    // Trobar el heading més proper ABANS del cursor
    let nearestHeading = null;
    for (const item of structure) {
      if (item.type !== 'SECTION' && item.index !== undefined) {
        if (item.index <= cursorParagraphIndex) {
          nearestHeading = item.text;
        } else {
          break;
        }
      }
    }

    return {
      has_cursor: true,
      index: cursorParagraphIndex,
      offset: cursorOffset,
      nearest_heading: nearestHeading
    };

  } catch (e) {
    return {
      has_cursor: false,
      index: -1,
      nearest_heading: null,
      error: e.message
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// LIGHTWEIGHT VERSION (Per a documents molt llargs)
// ═══════════════════════════════════════════════════════════════

/**
 * Versió encara més lleugera: només headings, sense seccions
 * Per a documents >100 pàgines
 */
function getDocSkeletonLight() {
  const doc = DocumentApp.getActiveDocument();
  if (!doc) return { error: "No hi ha document actiu" };

  const body = doc.getBody();
  const paragraphs = body.getParagraphs();

  const headings = [];
  let totalLength = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const text = para.getText();
    totalLength += text.length;

    const headingType = getHeadingType(para.getHeading());
    if (headingType !== null) {
      headings.push({
        type: headingType,
        text: text.trim().substring(0, PREVIEW_CHARS),
        index: i
      });
    }
  }

  return {
    doc_id: doc.getId(),
    headings: headings,
    total_chars: totalLength,
    heading_count: headings.length
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Funció de test per verificar el funcionament del scanner
 * Executa-la des de l'editor de GAS i mira el Logger
 */
function testSkeleton() {
  const startTime = new Date().getTime();

  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('       DOCUMENT SKELETON TEST - Sprint 2');
  Logger.log('═══════════════════════════════════════════════════════');

  const skeleton = getDocSkeleton();

  const endTime = new Date().getTime();
  const executionTime = endTime - startTime;

  Logger.log('');
  Logger.log('📊 ESTADÍSTIQUES:');
  Logger.log('   Temps d\'execució: ' + executionTime + 'ms');
  Logger.log('   Document: ' + skeleton.doc_name);
  Logger.log('   Total chars: ' + (skeleton.stats?.total_chars || 'N/A'));
  Logger.log('   Paràgrafs: ' + (skeleton.stats?.paragraph_count || 'N/A'));
  Logger.log('   Headings: ' + (skeleton.stats?.heading_count || 'N/A'));
  Logger.log('   Seccions: ' + (skeleton.stats?.section_count || 'N/A'));

  Logger.log('');
  Logger.log('🗂️ ESTRUCTURA:');

  if (skeleton.structure) {
    skeleton.structure.forEach(function(item, i) {
      if (item.type === 'SECTION') {
        Logger.log('   [' + i + '] 📄 SECTION: "' + item.preview + '"');
        Logger.log('        Words: ' + item.word_count + ' | Paragraphs: ' + item.paragraph_count);
        if (item.entities && item.entities.length > 0) {
          Logger.log('        Entities: ' + item.entities.join(', '));
        }
      } else {
        Logger.log('   [' + i + '] 📌 ' + item.type + ': "' + item.text + '"');
      }
    });
  }

  Logger.log('');
  Logger.log('📍 CURSOR:');
  Logger.log('   ' + JSON.stringify(skeleton.cursor_location));

  Logger.log('');
  Logger.log('📦 JSON COMPLET (per copiar):');
  Logger.log(JSON.stringify(skeleton, null, 2));

  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('✅ Test completat en ' + executionTime + 'ms');
  if (executionTime > 1000) {
    Logger.log('⚠️ ALERTA: Execució >1s. Considera usar getDocSkeletonLight()');
  }
  Logger.log('═══════════════════════════════════════════════════════');

  return skeleton;
}

/**
 * Test de rendiment amb múltiples execucions
 */
function testSkeletonPerformance() {
  const iterations = 5;
  const times = [];

  Logger.log('🏃 Test de rendiment (' + iterations + ' iteracions)...');

  for (let i = 0; i < iterations; i++) {
    const start = new Date().getTime();
    getDocSkeleton();
    const end = new Date().getTime();
    times.push(end - start);
    Logger.log('   Iteració ' + (i + 1) + ': ' + (end - start) + 'ms');
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  Logger.log('');
  Logger.log('📊 Resultats:');
  Logger.log('   Mitjana: ' + avg.toFixed(2) + 'ms');
  Logger.log('   Mínim: ' + min + 'ms');
  Logger.log('   Màxim: ' + max + 'ms');
  Logger.log('   Target: <1000ms');
  Logger.log('   Status: ' + (avg < 1000 ? '✅ PASS' : '❌ FAIL'));
}
