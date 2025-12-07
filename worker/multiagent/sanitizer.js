/**
 * Multi-Agent System Input Sanitizer v8.3
 *
 * Normalitza i prepara les instruccions de l'usuari abans de processar-les.
 * Inclou detecció d'idioma, extracció de referències i normalització de text.
 */

import { createSanitizedInput } from './types.js';
import { LANGUAGE_PATTERNS } from './config.js';

// ═══════════════════════════════════════════════════════════════
// NORMALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Normalitza una instrucció
 * @param {string} instruction - Instrucció original
 * @returns {string} - Instrucció normalitzada
 */
function normalizeInstruction(instruction) {
  if (!instruction) return '';

  let normalized = instruction
    // Trim whitespace
    .trim()
    // Normalitza múltiples espais
    .replace(/\s+/g, ' ')
    // Lowercase per comparació (mantenim original a part)
    .toLowerCase()
    // Normalitza Unicode (NFC)
    .normalize('NFC');

  return normalized;
}

/**
 * Expandeix abreviacions comunes
 * @param {string} text - Text a expandir
 * @returns {string} - Text amb abreviacions expandides
 */
function expandAbbreviations(text) {
  const abbreviations = {
    // Català
    'q ': 'que ',
    'q\u0027': 'que\'',
    'tb ': 'també ',
    'tb.': 'també.',
    'pq ': 'perquè ',
    'pq?': 'per què?',
    'xq ': 'perquè ',
    'xq?': 'per què?',
    'dsp ': 'després ',
    'doc ': 'document ',
    'docs ': 'documents ',
    'para ': 'paràgraf ',
    'paras ': 'paràgrafs ',
    // Castellà
    'tmb ': 'también ',
    // Anglès
    'pls ': 'please ',
    'thx ': 'thanks ',
  };

  let result = text;
  for (const [abbr, expansion] of Object.entries(abbreviations)) {
    // Només expandir si és una paraula aïllada (no part d'una altra)
    const regex = new RegExp(`\\b${escapeRegex(abbr)}`, 'gi');
    result = result.replace(regex, expansion);
  }

  return result;
}

/**
 * Escapa caràcters especials per regex
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════════════
// LANGUAGE DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta l'idioma de la instrucció
 * @param {string} text - Text a analitzar
 * @returns {string} - Codi d'idioma ('ca', 'es', 'en')
 */
function detectLanguage(text) {
  if (!text) return 'ca';

  const lowerText = text.toLowerCase();

  // Puntuació per idioma
  let scores = {
    ca: 0,
    es: 0,
    en: 0,
  };

  // Patrons catalans
  for (const pattern of LANGUAGE_PATTERNS.catalan) {
    if (pattern.test(lowerText)) {
      scores.ca += 2;
    }
  }

  // Patrons castellans
  for (const pattern of LANGUAGE_PATTERNS.spanish) {
    if (pattern.test(lowerText)) {
      scores.es += 2;
    }
  }

  // Patrons anglesos (detectem per absència de diacrítics i paraules clau)
  if (/\b(the|is|are|can|you|please|this|that|what|where|how|why)\b/i.test(lowerText)) {
    scores.en += 2;
  }

  // Caràcters específics
  if (/[àèéíòóú]/.test(text)) scores.ca += 1;
  if (/[áéíóúñ¿¡]/.test(text)) scores.es += 1;

  // Determinar guanyador
  const maxScore = Math.max(scores.ca, scores.es, scores.en);

  // Si no hi ha puntuació clara, default a català
  if (maxScore === 0) return 'ca';

  if (scores.ca === maxScore) return 'ca';
  if (scores.es === maxScore) return 'es';
  return 'en';
}

// ═══════════════════════════════════════════════════════════════
// REFERENCE EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extreu referències a elements del document (paràgrafs, articles, etc.)
 * @param {string} text - Text a analitzar
 * @returns {Array<RefHint>} - Array de referències trobades
 */
function extractRefHints(text) {
  if (!text) return [];

  const refs = [];

  // Patrons de referència
  const patterns = [
    // §N, §3
    {
      pattern: /§\s*(\d+)/gi,
      type: 'paragraph',
      extract: (m) => parseInt(m[1], 10),
    },
    // paràgraf N, paràgrafs 3 i 5
    {
      pattern: /par[àa]grafs?\s+(\d+)/gi,
      type: 'paragraph',
      extract: (m) => parseInt(m[1], 10),
    },
    // article N, articles 3 i 5
    {
      pattern: /articles?\s+(\d+)/gi,
      type: 'article',
      extract: (m) => parseInt(m[1], 10),
    },
    // punt N, punts 3 i 5
    {
      pattern: /punts?\s+(\d+)/gi,
      type: 'paragraph',
      extract: (m) => parseInt(m[1], 10),
    },
    // secció N
    {
      pattern: /secci[óo]n?s?\s+(\d+)/gi,
      type: 'section',
      extract: (m) => parseInt(m[1], 10),
    },
    // pàgina N
    {
      pattern: /p[àa]gina\s+(\d+)/gi,
      type: 'page',
      extract: (m) => parseInt(m[1], 10),
    },
    // el 3, la 5 (context dependent)
    {
      pattern: /\b(el|la|l')\s*(\d+)\b/gi,
      type: 'paragraph',
      extract: (m) => parseInt(m[2], 10),
    },
    // primer/segon/tercer paràgraf
    {
      pattern: /(primer|segon|tercer|quart|cinqu[eè]|sis[eè]|set[eè]|vuit[eè]|nov[eè]|des[eè]|[uú]ltim)\s+(par[àa]graf|article|punt|secci[óo])/gi,
      type: 'ordinal',
      extract: (m) => ordinalToNumber(m[1]),
    },
    // l'últim, l'anterior, el següent
    {
      pattern: /\b(l'[uú]ltim|l'anterior|el\s+seg[üu]ent)\b/gi,
      type: 'relative',
      extract: (m) => m[0],
    },
  ];

  for (const { pattern, type, extract } of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      refs.push({
        type,
        value: extract(match),
        raw_match: match[0],
      });
    }
  }

  return refs;
}

/**
 * Converteix ordinals a números
 */
function ordinalToNumber(ordinal) {
  const ordinals = {
    primer: 1,
    segon: 2,
    tercer: 3,
    quart: 4,
    cinquè: 5,
    cinque: 5,
    sisè: 6,
    sise: 6,
    setè: 7,
    sete: 7,
    vuitè: 8,
    vuite: 8,
    novè: 9,
    nove: 9,
    desè: 10,
    dese: 10,
    últim: -1,
    ultim: -1,
  };

  return ordinals[ordinal.toLowerCase()] || 0;
}

// ═══════════════════════════════════════════════════════════════
// ENTITY EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extreu entitats de la instrucció (conceptes a buscar)
 * @param {string} text - Text a analitzar
 * @returns {Array<Entity>} - Array d'entitats trobades
 */
function extractEntities(text) {
  if (!text) return [];

  const entities = [];

  // Patrons per detectar conceptes entre cometes
  const quotedPattern = /["«»'']([^"«»'']+)["«»'']/g;
  let match;
  while ((match = quotedPattern.exec(text)) !== null) {
    entities.push({
      type: 'concept',
      value: match[1].trim(),
      start: match.index + 1,
      end: match.index + 1 + match[1].length,
    });
  }

  // Patrons per detectar termes després de "de/del/sobre"
  const topicPatterns = [
    /(?:parla|menciona|tracta|cita)\s+(?:de|del|sobre)\s+(?:la\s+|el\s+|l')?([a-zA-ZàèéíòóúüïçÀÈÉÍÒÓÚÜÏÇáéíóúñÁÉÍÓÚÑ\s]{3,30}?)(?:\?|$|,|\.)/gi,
    /(?:busca|troba|localitza)\s+(?:on\s+)?(?:parla\s+de\s+)?(?:la\s+|el\s+|l')?([a-zA-ZàèéíòóúüïçÀÈÉÍÒÓÚÜÏÇáéíóúñÁÉÍÓÚÑ\s]{3,30}?)(?:\?|$|,|\.)/gi,
  ];

  for (const pattern of topicPatterns) {
    while ((match = pattern.exec(text)) !== null) {
      const value = match[1].trim();
      // Evitar captures massa genèriques
      if (value.length >= 3 && !['que', 'això', 'aquí', 'the', 'this'].includes(value.toLowerCase())) {
        entities.push({
          type: 'concept',
          value,
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }
  }

  return entities;
}

// ═══════════════════════════════════════════════════════════════
// TOKEN ESTIMATION
// ═══════════════════════════════════════════════════════════════

/**
 * Estima el nombre de tokens d'un text
 * Aproximació: ~4 caràcters = 1 token (per idiomes llatins)
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  // Aproximació conservadora
  return Math.ceil(text.length / 4);
}

// ═══════════════════════════════════════════════════════════════
// MAIN SANITIZER FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Sanititza i analitza una instrucció de l'usuari
 * @param {string} instruction - Instrucció original de l'usuari
 * @returns {SanitizedInput} - Input sanititzat i analitzat
 */
function sanitizeInput(instruction) {
  const result = createSanitizedInput();

  if (!instruction || typeof instruction !== 'string') {
    return result;
  }

  // Guardar original
  result.original = instruction;

  // Normalitzar
  result.normalized = normalizeInstruction(instruction);

  // Expandir abreviacions (sobre el normalitzat)
  result.normalized = expandAbbreviations(result.normalized);

  // Detectar idioma
  result.language = detectLanguage(instruction);

  // Extreure referències
  result.ref_hints = extractRefHints(instruction);

  // Extreure entitats
  result.entities = extractEntities(instruction);

  // Estimar tokens
  result.token_count = estimateTokens(instruction);

  return result;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  sanitizeInput,
  normalizeInstruction,
  expandAbbreviations,
  detectLanguage,
  extractRefHints,
  extractEntities,
  estimateTokens,
};
