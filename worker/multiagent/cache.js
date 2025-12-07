/**
 * Multi-Agent System Cache v8.3
 *
 * Sistema de cache de 2 nivells:
 * - L1: Cache de sessió (in-memory, hash exacte)
 * - L2: Cache semàntic (embeddings, similaritat cosinus)
 *
 * Inclou:
 * - Document hash per invalidació
 * - Cache locking per evitar race conditions
 * - TTL i cleanup automàtic
 */

import { CacheState } from './types.js';
import { CACHE, TIMEOUTS, API } from './config.js';
import { logDebug, logInfo, logError } from './telemetry.js';

// ═══════════════════════════════════════════════════════════════
// CACHE STORAGE
// ═══════════════════════════════════════════════════════════════

/**
 * L1 Cache: In-memory, per sessió
 * Key: instruction_hash
 * @type {Map<string, CacheEntry>}
 */
const l1Cache = new Map();

/**
 * L2 Cache: Semantic (in-memory per ara, podria ser Cloudflare KV/Vectorize)
 * Key: instruction_hash + doc_hash
 * @type {Map<string, L2CacheEntry>}
 */
const l2Cache = new Map();

/**
 * @typedef {Object} CacheEntry
 * @property {string} key
 * @property {Object} value - IntentPayload
 * @property {string} state - 'available' | 'computing' | 'stale'
 * @property {number} created_at
 * @property {number} expires_at
 * @property {number} hit_count
 */

/**
 * @typedef {Object} L2CacheEntry
 * @property {string} instruction_hash
 * @property {string} doc_hash
 * @property {Float32Array} [embedding]
 * @property {Object} value - IntentPayload
 * @property {string} state
 * @property {number} created_at
 * @property {number} expires_at
 * @property {number} hit_count
 */

// ═══════════════════════════════════════════════════════════════
// HASH FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Genera un hash SHA-256 d'un text
 * @param {string} text
 * @returns {Promise<string>}
 */
async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Genera hash d'una instrucció (normalitzada)
 * @param {string} normalizedInstruction
 * @returns {Promise<string>}
 */
async function hashInstruction(normalizedInstruction) {
  return sha256(normalizedInstruction || '');
}

/**
 * Genera hash d'un document (complet)
 * @param {Array<{text: string}>} paragraphs
 * @returns {Promise<string>}
 */
async function hashDocument(paragraphs) {
  if (!paragraphs || paragraphs.length === 0) {
    return 'empty_document';
  }

  // Concatenar tots els textos dels paràgrafs
  const fullText = paragraphs.map(p => p.text || '').join('\n');
  return sha256(fullText);
}

/**
 * Genera una clau de cache combinada
 * @param {string} instructionHash
 * @param {string} docHash
 * @returns {string}
 */
function buildCacheKey(instructionHash, docHash) {
  return `${instructionHash}:${docHash}`;
}

// ═══════════════════════════════════════════════════════════════
// L1 CACHE (SESSION, EXACT MATCH)
// ═══════════════════════════════════════════════════════════════

/**
 * Busca al L1 cache (match exacte)
 * @param {string} instructionHash
 * @returns {Object|null} - IntentPayload o null
 */
function l1Get(instructionHash) {
  if (!CACHE.l1.enabled) return null;

  const entry = l1Cache.get(instructionHash);

  if (!entry) return null;

  // Comprovar expiració
  if (entry.expires_at && Date.now() > entry.expires_at) {
    l1Cache.delete(instructionHash);
    return null;
  }

  // Comprovar estat
  if (entry.state !== CacheState.AVAILABLE) {
    return null;
  }

  // Incrementar hit count
  entry.hit_count++;

  logDebug('L1 cache hit', { key: instructionHash.substring(0, 8) });

  return entry.value;
}

/**
 * Guarda al L1 cache
 * @param {string} instructionHash
 * @param {Object} intent - IntentPayload
 */
function l1Set(instructionHash, intent) {
  if (!CACHE.l1.enabled) return;

  const entry = {
    key: instructionHash,
    value: intent,
    state: CacheState.AVAILABLE,
    created_at: Date.now(),
    expires_at: null,  // L1 no expira (només durant la sessió)
    hit_count: 0,
  };

  l1Cache.set(instructionHash, entry);

  logDebug('L1 cache set', { key: instructionHash.substring(0, 8) });
}

/**
 * Neteja el L1 cache (per nova sessió)
 */
function l1Clear() {
  l1Cache.clear();
  logDebug('L1 cache cleared');
}

// ═══════════════════════════════════════════════════════════════
// L2 CACHE (SEMANTIC, WITH DOC HASH)
// ═══════════════════════════════════════════════════════════════

/**
 * Busca al L2 cache (match exacte per instruction + doc hash)
 * @param {string} instructionHash
 * @param {string} docHash
 * @returns {Object|null} - IntentPayload o null
 */
function l2GetExact(instructionHash, docHash) {
  if (!CACHE.l2.enabled) return null;

  const key = buildCacheKey(instructionHash, docHash);
  const entry = l2Cache.get(key);

  if (!entry) return null;

  // Comprovar expiració
  if (entry.expires_at && Date.now() > entry.expires_at) {
    l2Cache.delete(key);
    return null;
  }

  // Comprovar estat
  if (entry.state === CacheState.COMPUTING) {
    logDebug('L2 cache entry is computing', { key: key.substring(0, 16) });
    return null;  // Podríem esperar, però per simplicitat retornem null
  }

  if (entry.state === CacheState.STALE) {
    l2Cache.delete(key);
    return null;
  }

  // Incrementar hit count
  entry.hit_count++;

  logDebug('L2 cache hit (exact)', { key: key.substring(0, 16) });

  return entry.value;
}

/**
 * Guarda al L2 cache
 * @param {string} instructionHash
 * @param {string} docHash
 * @param {Object} intent - IntentPayload
 * @param {Float32Array} [embedding] - Embedding de la instrucció (per cerca semàntica futura)
 */
function l2Set(instructionHash, docHash, intent, embedding = null) {
  if (!CACHE.l2.enabled) return;

  const key = buildCacheKey(instructionHash, docHash);

  const entry = {
    instruction_hash: instructionHash,
    doc_hash: docHash,
    embedding,
    value: intent,
    state: CacheState.AVAILABLE,
    created_at: Date.now(),
    expires_at: Date.now() + (CACHE.l2.ttl_days * 24 * 60 * 60 * 1000),
    hit_count: 0,
  };

  l2Cache.set(key, entry);

  logDebug('L2 cache set', { key: key.substring(0, 16) });
}

/**
 * Marca una entrada del L2 cache com a "computing" (lock)
 * @param {string} instructionHash
 * @param {string} docHash
 * @returns {boolean} - true si s'ha pogut adquirir el lock
 */
function l2AcquireLock(instructionHash, docHash) {
  const key = buildCacheKey(instructionHash, docHash);
  const existing = l2Cache.get(key);

  // Si ja existeix i està computing, no podem adquirir el lock
  if (existing && existing.state === CacheState.COMPUTING) {
    // Comprovar si el lock ha expirat
    const lockAge = Date.now() - existing.created_at;
    if (lockAge < TIMEOUTS.cache_computing) {
      return false;  // Lock encara actiu
    }
    // Lock expirat, podem sobreescriure
  }

  // Adquirir lock
  l2Cache.set(key, {
    instruction_hash: instructionHash,
    doc_hash: docHash,
    value: null,
    state: CacheState.COMPUTING,
    created_at: Date.now(),
    expires_at: Date.now() + TIMEOUTS.cache_computing,
    hit_count: 0,
  });

  logDebug('L2 cache lock acquired', { key: key.substring(0, 16) });

  return true;
}

/**
 * Allibera un lock del L2 cache (en cas d'error)
 * @param {string} instructionHash
 * @param {string} docHash
 */
function l2ReleaseLock(instructionHash, docHash) {
  const key = buildCacheKey(instructionHash, docHash);
  const entry = l2Cache.get(key);

  if (entry && entry.state === CacheState.COMPUTING) {
    l2Cache.delete(key);
    logDebug('L2 cache lock released', { key: key.substring(0, 16) });
  }
}

/**
 * Invalida totes les entrades del L2 cache per un document
 * (quan el document canvia)
 * @param {string} docHash
 */
function l2InvalidateByDocument(docHash) {
  let invalidated = 0;

  for (const [key, entry] of l2Cache.entries()) {
    if (entry.doc_hash === docHash) {
      l2Cache.delete(key);
      invalidated++;
    }
  }

  if (invalidated > 0) {
    logInfo('L2 cache invalidated by document', { count: invalidated });
  }
}

// ═══════════════════════════════════════════════════════════════
// SEMANTIC SEARCH (PLACEHOLDER FOR CLOUDFLARE VECTORIZE)
// ═══════════════════════════════════════════════════════════════

/**
 * Busca entrades similars al L2 cache per embedding
 * NOTA: Aquesta és una implementació simplificada.
 * En producció, s'usaria Cloudflare Vectorize.
 *
 * @param {Float32Array} embedding - Embedding de la instrucció
 * @param {string} docHash - Hash del document
 * @param {number} [threshold=0.92] - Threshold de similaritat
 * @returns {Object|null} - IntentPayload o null
 */
function l2FindSimilar(embedding, docHash, threshold = CACHE.l2.similarity_threshold) {
  if (!CACHE.l2.enabled || !embedding) return null;

  let bestMatch = null;
  let bestSimilarity = 0;

  for (const entry of l2Cache.values()) {
    // Només comparar amb el mateix document
    if (entry.doc_hash !== docHash) continue;

    // Només entrades disponibles amb embedding
    if (entry.state !== CacheState.AVAILABLE || !entry.embedding) continue;

    // Calcular similaritat cosinus
    const similarity = cosineSimilarity(embedding, entry.embedding);

    if (similarity > threshold && similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = entry;
    }
  }

  if (bestMatch) {
    bestMatch.hit_count++;
    logDebug('L2 cache hit (semantic)', {
      similarity: bestSimilarity.toFixed(3),
      threshold,
    });
    return bestMatch.value;
  }

  return null;
}

/**
 * Calcula la similaritat cosinus entre dos vectors
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);

  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

// ═══════════════════════════════════════════════════════════════
// EMBEDDINGS (PLACEHOLDER)
// ═══════════════════════════════════════════════════════════════

/**
 * Genera embedding per una instrucció
 * NOTA: Implementació placeholder. En producció, cridaria Gemini text-embedding-004
 *
 * @param {string} text
 * @param {string} apiKey
 * @returns {Promise<Float32Array|null>}
 */
async function generateEmbedding(text, apiKey) {
  // Per ara, retornem null (no usem embeddings)
  // En producció, això cridaria l'API de Gemini
  return null;

  /* Implementació futura:
  try {
    const url = `${API.gemini.base_url}/models/${API.gemini.embedding_model}:embedContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${API.gemini.embedding_model}`,
        content: { parts: [{ text }] },
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const values = data.embedding?.values;

    if (!values) return null;

    return new Float32Array(values);

  } catch (error) {
    logError('Embedding generation failed', { error: error.message });
    return null;
  }
  */
}

// ═══════════════════════════════════════════════════════════════
// MAIN CACHE FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Busca al cache (L1 + L2) o retorna null
 *
 * @param {string} normalizedInstruction - Instrucció normalitzada
 * @param {string} docHash - Hash del document
 * @returns {Promise<{hit: boolean, layer: string|null, intent: Object|null}>}
 */
async function getCached(normalizedInstruction, docHash) {
  const instructionHash = await hashInstruction(normalizedInstruction);

  // Provar L1 primer (més ràpid)
  const l1Result = l1Get(instructionHash);
  if (l1Result) {
    return {
      hit: true,
      layer: 'L1',
      intent: l1Result,
    };
  }

  // Provar L2 (match exacte instruction + doc)
  const l2Result = l2GetExact(instructionHash, docHash);
  if (l2Result) {
    // Guardar a L1 per accelerar futures consultes
    l1Set(instructionHash, l2Result);

    return {
      hit: true,
      layer: 'L2',
      intent: l2Result,
    };
  }

  // Cap hit
  return {
    hit: false,
    layer: null,
    intent: null,
  };
}

/**
 * Guarda al cache (L1 + L2)
 *
 * @param {string} normalizedInstruction
 * @param {string} docHash
 * @param {Object} intent - IntentPayload
 */
async function setCache(normalizedInstruction, docHash, intent) {
  const instructionHash = await hashInstruction(normalizedInstruction);

  // Guardar a L1
  l1Set(instructionHash, intent);

  // Guardar a L2
  l2Set(instructionHash, docHash, intent);
}

/**
 * Funció principal: obtenir del cache o classificar
 *
 * @param {string} normalizedInstruction
 * @param {string} docHash
 * @param {Function} classifyFn - Funció async que classifica si no hi ha cache hit
 * @returns {Promise<{intent: Object, cacheHit: boolean, cacheLayer: string|null}>}
 */
async function getCachedOrClassify(normalizedInstruction, docHash, classifyFn) {
  // Buscar al cache
  const cached = await getCached(normalizedInstruction, docHash);

  if (cached.hit) {
    return {
      intent: cached.intent,
      cacheHit: true,
      cacheLayer: cached.layer,
    };
  }

  // No hi ha cache hit, hem de classificar
  const instructionHash = await hashInstruction(normalizedInstruction);

  // Intentar adquirir lock (evitar race conditions)
  const lockAcquired = l2AcquireLock(instructionHash, docHash);

  if (!lockAcquired) {
    // Algú altre està classificant, esperem una mica i tornem a provar
    await new Promise(resolve => setTimeout(resolve, 500));
    const retryCache = await getCached(normalizedInstruction, docHash);
    if (retryCache.hit) {
      return {
        intent: retryCache.intent,
        cacheHit: true,
        cacheLayer: retryCache.layer,
      };
    }
    // Si encara no hi ha cache hit, classifiquem igualment
  }

  try {
    // Classificar
    const intent = await classifyFn();

    // Guardar al cache
    await setCache(normalizedInstruction, docHash, intent);

    return {
      intent,
      cacheHit: false,
      cacheLayer: null,
    };

  } catch (error) {
    // Alliberar lock en cas d'error
    l2ReleaseLock(instructionHash, docHash);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// CACHE STATS & CLEANUP
// ═══════════════════════════════════════════════════════════════

/**
 * Obté estadístiques del cache
 * @returns {Object}
 */
function getCacheStats() {
  return {
    l1: {
      size: l1Cache.size,
      enabled: CACHE.l1.enabled,
    },
    l2: {
      size: l2Cache.size,
      enabled: CACHE.l2.enabled,
      ttl_days: CACHE.l2.ttl_days,
    },
  };
}

/**
 * Neteja entrades expirades del cache
 */
function cleanupCache() {
  const now = Date.now();
  let l2Cleaned = 0;

  for (const [key, entry] of l2Cache.entries()) {
    if (entry.expires_at && now > entry.expires_at) {
      l2Cache.delete(key);
      l2Cleaned++;
    }
  }

  if (l2Cleaned > 0) {
    logInfo('Cache cleanup', { l2_cleaned: l2Cleaned });
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  // Hash functions
  hashInstruction,
  hashDocument,

  // L1 Cache
  l1Get,
  l1Set,
  l1Clear,

  // L2 Cache
  l2GetExact,
  l2Set,
  l2AcquireLock,
  l2ReleaseLock,
  l2InvalidateByDocument,
  l2FindSimilar,

  // Embeddings
  generateEmbedding,
  cosineSimilarity,

  // Main functions
  getCached,
  setCache,
  getCachedOrClassify,

  // Stats & cleanup
  getCacheStats,
  cleanupCache,
};
