// --- CONFIGURACIÓ ---
const API_URL = 'https://docmile-api.conteucontes.workers.dev';

/**
 * Inclou el contingut d'un fitxer HTML dins d'un altre.
 * S'utilitza amb la sintaxi <?!= include('filename') ?> als templates.
 * @param {string} filename - Nom del fitxer HTML (sense extensió .html)
 * @return {string} - Contingut del fitxer
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Crea el menú quan s'obre el document
 * Gestiona tant simple triggers com installable triggers
 * @param {Object} e - Event object amb authMode
 */
function onOpen(e) {
  const ui = DocumentApp.getUi();
  // Menú simplificat: un sol element per obertura directa
  ui.createAddonMenu()
    .addItem('Obrir', 'showSidebar')
    .addToUi();
}

/**
 * S'executa quan l'usuari instal·la l'Add-on des del Marketplace
 * @param {Object} e - Event object
 */
function onInstall(e) {
  onOpen(e);
}

/**
 * Obre el sidebar (requereix autorització, per això és al menú)
 */
function showSidebar() {
  try {
    const html = HtmlService.createTemplateFromFile('Sidebar')
      .evaluate()
      .setTitle('Docmile');
    DocumentApp.getUi().showSidebar(html);
  } catch (e) {
    DocumentApp.getUi().alert('ERROR: ' + e.message);
  }
}

/**
 * Mostra ajuda bàsica
 */
function showHelp() {
  const ui = DocumentApp.getUi();
  ui.alert(
    'Docmile - Ajuda',
    'Docmile és el teu assistent d\'escriptura.\n\n' +
    '1. Fes clic a "Obrir Docmile" per mostrar el panell lateral.\n' +
    '2. Escriu instruccions com "corregeix l\'ortografia" o "tradueix al castellà".\n' +
    '3. Selecciona text abans d\'enviar per editar només aquesta part.\n\n' +
    'Necessites una clau de llicència per funcionar.',
    ui.ButtonSet.OK
  );
}

// --- GESTIÓ DE MEMÒRIA I FITXERS ---
function saveSettings(jsonSettings) {
  PropertiesService.getUserProperties().setProperty('DOCMILE_SETTINGS', jsonSettings);
  return "OK";
}

function getSettings() {
  const props = PropertiesService.getUserProperties();
  const json = props.getProperty('DOCMILE_SETTINGS');
  const defaults = {
    license_key: "",
    style_guide: "",
    strict_mode: false
  };
  if (json) return json;
  return JSON.stringify(defaults);
}

function saveFileUri(uri, name, mime) {
  const props = PropertiesService.getUserProperties();
  props.setProperty('DOCMILE_FILE_URI', uri);
  props.setProperty('DOCMILE_FILE_NAME', name);
  props.setProperty('DOCMILE_FILE_MIME', mime);
  return { name: name, uri: uri };
}

function getKnowledgeFileInfo() {
  const props = PropertiesService.getUserProperties();
  const uri = props.getProperty('DOCMILE_FILE_URI');
  const name = props.getProperty('DOCMILE_FILE_NAME');

  if (uri && name) return { hasFile: true, name: name };
  return { hasFile: false, name: "Cap fitxer actiu" };
}

function clearKnowledgeFile() {
  const props = PropertiesService.getUserProperties();
  // Netejar propietats antigues (legacy)
  props.deleteProperty('DOCMILE_FILE_URI');
  props.deleteProperty('DOCMILE_FILE_NAME');
  props.deleteProperty('DOCMILE_FILE_MIME');
  props.deleteProperty('DOCMILE_ACTIVE_LIBRARY_FILE');
  // v9.4: Netejar també els fitxers actius nous
  props.deleteProperty('DOCMILE_ACTIVE_FILES');
  return "Fitxers esborrats.";
}

// --- SELECTION INFO (v5.3) ---

/**
 * Get info about the current document selection
 * Returns word count and character count of selected text
 */
function getSelectionInfo() {
  try {
    const doc = DocumentApp.getActiveDocument();
    if (!doc) return { hasSelection: false, wordCount: 0, charCount: 0 };

    const selection = doc.getSelection();
    if (!selection) return { hasSelection: false, wordCount: 0, charCount: 0 };

    const ranges = selection.getRangeElements();
    if (!ranges || ranges.length === 0) return { hasSelection: false, wordCount: 0, charCount: 0 };

    let totalText = '';
    for (const range of ranges) {
      const element = range.getElement();
      let text = '';

      if (element.getType() === DocumentApp.ElementType.TEXT) {
        text = element.asText().getText();
        if (range.isPartial()) {
          text = text.substring(range.getStartOffset(), range.getEndOffsetInclusive() + 1);
        }
      } else if (element.editAsText) {
        text = element.editAsText().getText();
      }

      if (text) totalText += text + ' ';
    }

    totalText = totalText.trim();
    // v6.1: Regex optimitzat - match és més ràpid que split+filter
    const wordCount = totalText ? (totalText.match(/\S+/g) || []).length : 0;

    return {
      hasSelection: true,
      wordCount: wordCount,
      charCount: totalText.length
    };
  } catch (e) {
    return { hasSelection: false, wordCount: 0, charCount: 0, error: e.message };
  }
}

// --- CREDITS INFO (v5.1) ---

/**
 * Get credits info for the current user
 */
function getCreditsInfo() {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) {
    return { status: 'ok', credits_remaining: 0, credits_total: 100, is_active: false };
  }

  try {
    const result = callWorker({
      action: 'get_credits',
      license_key: settings.license_key
    });
    // v5.3: Afegir status: 'ok' per compatibilitat amb frontend
    return { status: 'ok', ...result };
  } catch (e) {
    return { status: 'error', credits_remaining: 0, credits_total: 100, is_active: false, error: e.message };
  }
}

// --- KNOWLEDGE LIBRARY (v6.0 - with Folders) ---

/**
 * Get all files from the knowledge library (with folders)
 */
function getKnowledgeLibrary() {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) return { files: [], folders: [] };

  try {
    const result = callWorker({
      action: 'get_knowledge_library',
      license_key: settings.license_key
    });
    return result;
  } catch (e) {
    return { files: [], folders: [], error: e.message };
  }
}

/**
 * Move a file to a folder (v6.0)
 */
function moveFileToFolder(fileId, folderName) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  return callWorker({
    action: 'move_to_folder',
    license_key: settings.license_key,
    file_id: fileId,
    folder: folderName
  });
}

/**
 * Rename a folder (v6.0)
 */
function renameFolder(oldName, newName) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  return callWorker({
    action: 'rename_folder',
    license_key: settings.license_key,
    old_name: oldName,
    new_name: newName
  });
}

/**
 * Delete a folder (moves files to root) (v6.0)
 */
function deleteFolder(folderName) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  return callWorker({
    action: 'delete_folder',
    license_key: settings.license_key,
    folder_name: folderName
  });
}

/**
 * Create a new folder (v7.0 - persistent)
 */
function createFolder(folderName) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  return callWorker({
    action: 'create_folder',
    license_key: settings.license_key,
    folder_name: folderName
  });
}

/**
 * Upload a file to the knowledge library
 */
function uploadToKnowledgeLibrary(base64Data, mimeType, fileName) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  const doc = DocumentApp.getActiveDocument();
  const docId = doc ? doc.getId() : null;

  const result = callWorker({
    action: 'upload_to_library',
    license_key: settings.license_key,
    file_data: base64Data,
    mime_type: mimeType,
    file_name: fileName,
    doc_id: docId
  });

  if (result.status === 'ok' && result.file) {
    // v5.1: Validate file_uri exists before saving
    if (!result.file.file_uri) {
      throw new Error("El fitxer s'està processant. Torna a provar en uns segons.");
    }

    // Save as active file for this doc
    const props = PropertiesService.getUserProperties();
    props.setProperty('DOCMILE_FILE_URI', result.file.file_uri);
    props.setProperty('DOCMILE_FILE_NAME', result.file.name);
    props.setProperty('DOCMILE_FILE_MIME', mimeType);
    props.setProperty('DOCMILE_ACTIVE_LIBRARY_FILE', result.file.id);
  }

  return result;
}

/**
 * Toggle a library file (add/remove from active files)
 */
function toggleKnowledgeFile(fileId) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  const doc = DocumentApp.getActiveDocument();
  if (!doc) throw new Error("No hi ha document actiu.");

  const props = PropertiesService.getUserProperties();
  let activeFiles = [];
  try {
    const stored = props.getProperty('DOCMILE_ACTIVE_FILES');
    if (stored) activeFiles = JSON.parse(stored);
  } catch (e) { activeFiles = []; }

  // Check if file is already active
  const existingIndex = activeFiles.findIndex(f => f.id === fileId);

  if (existingIndex >= 0) {
    // Remove from active files
    activeFiles.splice(existingIndex, 1);
    props.setProperty('DOCMILE_ACTIVE_FILES', JSON.stringify(activeFiles));

    callWorker({
      action: 'unlink_knowledge',
      license_key: settings.license_key,
      file_id: fileId,
      doc_id: doc.getId()
    });

    return { status: 'ok', action: 'removed', activeFiles: activeFiles };
  } else {
    // Add to active files
    const result = callWorker({
      action: 'link_knowledge',
      license_key: settings.license_key,
      file_id: fileId,
      doc_id: doc.getId()
    });

    if (result.status === 'ok') {
      activeFiles.push({
        id: fileId,
        name: result.file_name,
        uri: result.file_uri,
        mime: result.mime_type
      });
      props.setProperty('DOCMILE_ACTIVE_FILES', JSON.stringify(activeFiles));
    }

    return { status: result.status, action: 'added', file_name: result.file_name, activeFiles: activeFiles };
  }
}

/**
 * Link a library file to the current document (legacy support + upload)
 */
function linkKnowledgeFile(fileId) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  const doc = DocumentApp.getActiveDocument();
  if (!doc) throw new Error("No hi ha document actiu.");

  const result = callWorker({
    action: 'link_knowledge',
    license_key: settings.license_key,
    file_id: fileId,
    doc_id: doc.getId()
  });

  if (result.status === 'ok') {
    // Add to active files array
    const props = PropertiesService.getUserProperties();
    let activeFiles = [];
    try {
      const stored = props.getProperty('DOCMILE_ACTIVE_FILES');
      if (stored) activeFiles = JSON.parse(stored);
    } catch (e) { activeFiles = []; }

    // Avoid duplicates
    if (!activeFiles.find(f => f.id === fileId)) {
      activeFiles.push({
        id: fileId,
        name: result.file_name,
        uri: result.file_uri,
        mime: result.mime_type
      });
      props.setProperty('DOCMILE_ACTIVE_FILES', JSON.stringify(activeFiles));
    }
  }

  return result;
}

/**
 * Unlink a specific knowledge file (or all if no fileId)
 */
function unlinkKnowledgeFile(fileId) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  const doc = DocumentApp.getActiveDocument();
  if (!doc) throw new Error("No hi ha document actiu.");

  const props = PropertiesService.getUserProperties();
  let activeFiles = [];
  try {
    const stored = props.getProperty('DOCMILE_ACTIVE_FILES');
    if (stored) activeFiles = JSON.parse(stored);
  } catch (e) { activeFiles = []; }

  if (fileId) {
    // Remove specific file
    const index = activeFiles.findIndex(f => f.id === fileId);
    if (index >= 0) {
      activeFiles.splice(index, 1);
      callWorker({
        action: 'unlink_knowledge',
        license_key: settings.license_key,
        file_id: fileId,
        doc_id: doc.getId()
      });
    }
  } else {
    // Remove all active files
    activeFiles.forEach(f => {
      callWorker({
        action: 'unlink_knowledge',
        license_key: settings.license_key,
        file_id: f.id,
        doc_id: doc.getId()
      });
    });
    activeFiles = [];
  }

  props.setProperty('DOCMILE_ACTIVE_FILES', JSON.stringify(activeFiles));
  return { success: true, activeFiles: activeFiles };
}

/**
 * Delete a file from the library completely
 */
function deleteFromKnowledgeLibrary(fileId) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  const result = callWorker({
    action: 'delete_from_library',
    license_key: settings.license_key,
    file_id: fileId
  });

  // If this was an active file, remove it from the list
  const props = PropertiesService.getUserProperties();
  let activeFiles = [];
  try {
    const stored = props.getProperty('DOCMILE_ACTIVE_FILES');
    if (stored) activeFiles = JSON.parse(stored);
  } catch (e) { activeFiles = []; }

  const index = activeFiles.findIndex(f => f.id === fileId);
  if (index >= 0) {
    activeFiles.splice(index, 1);
    props.setProperty('DOCMILE_ACTIVE_FILES', JSON.stringify(activeFiles));
  }

  return result;
}

/**
 * Get info about currently active knowledge files for this doc
 */
function getActiveKnowledgeFiles() {
  const props = PropertiesService.getUserProperties();
  let activeFiles = [];
  try {
    const stored = props.getProperty('DOCMILE_ACTIVE_FILES');
    if (stored) activeFiles = JSON.parse(stored);
  } catch (e) { activeFiles = []; }

  return {
    hasFiles: activeFiles.length > 0,
    files: activeFiles
  };
}

/**
 * Get info about the currently active knowledge file for this doc (legacy compatibility)
 */
function getActiveKnowledgeFile() {
  const result = getActiveKnowledgeFiles();
  if (result.hasFiles && result.files.length > 0) {
    return {
      hasFile: true,
      id: result.files[0].id,
      name: result.files[0].name
    };
  }
  return { hasFile: false };
}

// --- LAST EDIT MEMORY (v2.6) ---
// Guarda l'últim fragment editat per permetre "una altra", "aquesta no m'agrada", etc.
const LAST_EDIT_KEY = 'DOCMILE_LAST_EDIT';

// --- BANNED WORDS (v2.8) ---
// Paraules que la IA mai hauria d'usar
const BANNED_WORDS_KEY = 'DOCMILE_BANNED_WORDS';

// --- RECIPES (v3.4) ---
// Receptes de l'usuari
const RECIPES_KEY = 'DOCMILE_RECIPES';

function loadLastEdit() {
  const props = PropertiesService.getDocumentProperties();
  const json = props.getProperty(LAST_EDIT_KEY);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function saveLastEdit(lastEdit) {
  const props = PropertiesService.getDocumentProperties();
  if (lastEdit) {
    props.setProperty(LAST_EDIT_KEY, JSON.stringify(lastEdit));
  } else {
    props.deleteProperty(LAST_EDIT_KEY);
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITATS - Funcions compartides (v3.10 refactor)
// ═══════════════════════════════════════════════════════════════

/**
 * Obté els elements editables (paràgrafs i llistes) del document
 * @param {Body} body - El body del document
 * @returns {Array} Array d'elements editables
 */
function getEditableElements(body) {
  const elements = [];
  const numChildren = body.getNumChildren();
  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
        child.getType() === DocumentApp.ElementType.LIST_ITEM) {
      elements.push(child);
    }
  }
  return elements;
}

/**
 * v17.5: Construeix un mapa índex->element consistent amb captureFullDocument/processElement
 * IMPORTANT: Aquesta funció replica EXACTAMENT la lògica d'assignació d'índexs de processElement
 * @param {Body} body - El body del document
 * @returns {Object} - { map: {índex: element}, maxIndex: número }
 */
function buildElementIndexMap(body) {
  const numChildren = body.getNumChildren();
  const map = {};
  let currentIndex = 0;

  for (let i = 0; i < numChildren; i++) {
    const element = body.getChild(i);
    const elementType = element.getType();

    switch (elementType) {
      case DocumentApp.ElementType.PARAGRAPH:
      case DocumentApp.ElementType.LIST_ITEM:
        // Aquests tipus assignen índex i es guarden al mapa (si tenen text)
        try {
          const text = element.asText().getText();
          if (text.trim().length > 0) {
            map[currentIndex] = element;
            currentIndex++;
          }
        } catch (e) {}
        break;

      case DocumentApp.ElementType.TABLE:
        // Les taules consumeixen índex però NO es guarden al mapa (són read-only)
        // IMPORTANT: Usar convertTableToText per consistència amb processElement
        try {
          const tableText = convertTableToText(element.asTable());
          if (tableText.trim().length > 0) {
            currentIndex++;  // Consumeix índex sense guardar al mapa
          }
        } catch (e) {}
        break;

      case DocumentApp.ElementType.TABLE_OF_CONTENTS:
        // TOC consumeix índex però no és editable
        try {
          const tocText = element.asTableOfContents().getText();
          if (tocText.trim()) {
            currentIndex++;
          }
        } catch (e) {}
        break;

      case DocumentApp.ElementType.INLINE_IMAGE:
      case DocumentApp.ElementType.INLINE_DRAWING:
        // Imatges i dibuixos consumeixen índex
        currentIndex++;
        break;

      // HORIZONTAL_RULE i PAGE_BREAK no consumeixen índex

      default:
        // Altres elements: intentar extreure text
        try {
          if (element.asText) {
            const otherText = element.asText().getText();
            if (otherText && otherText.trim().length > 0) {
              map[currentIndex] = element;
              currentIndex++;
            }
          }
        } catch (e) {}
    }
  }

  return { map, maxIndex: currentIndex };
}

/**
 * Troba un element pel seu índex (comptant només elements amb text)
 * @param {Array} elements - Array d'elements del document
 * @param {number} targetIndex - Índex a trobar
 * @returns {Element|null} L'element trobat o null
 */
function findElementByIndex(elements, targetIndex) {
  let currentIndex = 0;
  for (const el of elements) {
    const text = el.asText().getText();
    if (text.trim().length > 0) {
      if (currentIndex === targetIndex) {
        return el;
      }
      currentIndex++;
    }
  }
  return null;
}

/**
 * Neteja el markdown inline (bold/italic) del text
 * @param {string} text - Text amb possible markdown
 * @returns {string} Text net sense markdown
 */
function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1');
}

// ═══════════════════════════════════════════════════════════════
// v14.1: FUNCIONS DE VALIDACIÓ I PROCESSAMENT DE CANVIS
// ═══════════════════════════════════════════════════════════════

/**
 * Calcula un hash simple d'un string (equivalent a sha256Sync del worker)
 * @param {string} text - Text a hashejar
 * @returns {string} - Hash en hexadecimal
 */
function simpleHash(text) {
  if (!text) return '00000000';
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Status constants per v14.1
 */
const ChangeStatus = {
  OK: 'OK',
  BLOCK: 'BLOCK',
  WARN: 'WARN',
  STALE: 'STALE',
};

/**
 * Processa canvis en format v14 i els converteix al format antic si cal
 * Implementa validació de before_hash per detectar STALE
 *
 * @param {Object} aiData - Dades de l'AI (pot tenir .changes o .updates)
 * @param {Object} mapIdToElement - Mapa d'IDs a elements del document
 * @returns {Object} - { updates: {...}, processedChanges: [...], stalChanges: [...], blockedChanges: [...] }
 */
// v15.3 - Fix array detection for GAS
function processChangesV14(aiData, mapIdToElement) {
  const result = {
    updates: {},              // Format antic per compatibilitat
    processedChanges: [],     // Canvis que es poden aplicar (OK o WARN acceptat)
    staleChanges: [],         // Canvis amb document modificat
    blockedChanges: [],       // Canvis bloquejats
    warnChanges: [],          // Canvis que requereixen confirmació
    hasV14Format: false,      // Si la resposta ve en format v14
  };

  // Cas 1: Format antic (aiData.updates objecte)
  if (aiData.updates && typeof aiData.updates === 'object' && !Array.isArray(aiData.updates)) {
    result.updates = aiData.updates;
    result.hasV14Format = false;
    return result;
  }

  // Cas 2: Format v14 (aiData.changes array o objecte amb claus numèriques)
  // NOTA: GAS pot deserialitzar arrays com objectes amb claus "0", "1", etc.
  // Acceptem qualsevol objecte que tingui aiData.changes[0] definit
  const hasChanges = aiData.changes &&
    typeof aiData.changes === 'object' &&
    (aiData.changes[0] !== undefined || aiData.changes['0'] !== undefined);

  if (hasChanges) {
    result.hasV14Format = true;

    // v15.2: Debug logging per investigar el problema
    const mapKeys = Object.keys(mapIdToElement);
    logDiagnostic('V14_PROCESSING', {
      changes_count: aiData.changes.length,
      map_keys: mapKeys.length,
      map_keys_sample: mapKeys.slice(0, 20).join(','),
    });

    // Usar for clàssic en lloc de for..of per compatibilitat amb GAS
    const changesArray = Array.isArray(aiData.changes) ? aiData.changes : Object.values(aiData.changes);
    for (let i = 0; i < changesArray.length; i++) {
      const change = changesArray[i];
      const paraId = change.paragraph_id;
      const targetElement = mapIdToElement[paraId];

      // v15.2: Debug - mostrar info del canvi
      const changeDebug = {
        paraId: paraId,
        paraId_type: typeof paraId,
        has_element: !!targetElement,
        has_replacement: change.replacement !== undefined,
        has_new_text: change.new_text !== undefined,
        has_original: change.original !== undefined,
        has_original_text: change.original_text !== undefined,
        new_text_value: change.new_text,
        original_text_value: change.original_text ? change.original_text.substring(0, 30) : null,
      };

      // TEMPORAL: Afegir a resposta per debug
      if (!result._debug) result._debug = [];
      result._debug.push(changeDebug);

      // Si no trobem l'element, bloquejar
      if (!targetElement) {
        result.blockedChanges.push({
          ...change,
          _block_reason: 'paragraph_not_found',
        });
        continue;
      }

      // Obtenir text actual del paràgraf
      let currentText = '';
      try {
        currentText = targetElement.asText().getText();
      } catch (e) {
        result.blockedChanges.push({
          ...change,
          _block_reason: 'cannot_read_paragraph',
        });
        continue;
      }

      // Verificar before_hash per detectar STALE (document ha canviat)
      if (change.before_hash) {
        const currentHash = simpleHash(currentText);
        if (change.before_hash !== currentHash) {
          result.staleChanges.push({
            ...change,
            _current_hash: currentHash,
            _stale_reason: 'document_changed_since_analysis',
          });
          continue;
        }
      }

      // Processar segons _status
      const status = change._status || ChangeStatus.OK;

      if (status === ChangeStatus.BLOCK) {
        result.blockedChanges.push(change);
        continue;
      }

      if (status === ChangeStatus.STALE) {
        result.staleChanges.push(change);
        continue;
      }

      if (status === ChangeStatus.WARN) {
        result.warnChanges.push(change);
        // També afegir a processedChanges però marcat com WARN
        // El frontend decidirà si mostrar confirmació
      }

      // Determinar el text nou
      let newText;
      if (change.replacement !== undefined) {
        // Mode find/replace
        if (change.original && currentText.includes(change.original)) {
          newText = currentText.replace(change.original, change.replacement);
        } else {
          newText = change.replacement;
        }
      } else if (change.new_text !== undefined) {
        // Mode paràgraf complet
        newText = change.new_text;
      } else {
        result.blockedChanges.push({
          ...change,
          _block_reason: 'no_replacement_text',
        });
        continue;
      }

      // Afegir al format antic per compatibilitat
      result.updates[paraId] = newText;

      // Afegir als canvis processats amb info completa
      result.processedChanges.push({
        ...change,
        targetId: paraId,
        originalText: currentText,
        proposedText: cleanMarkdown(newText),
        _validated: true,
      });
    }

    return result;
  }

  // Cas 3: Ni updates ni changes - retornar buit
  return result;
}

/**
 * Obté el text actual d'un paràgraf per ID
 * @param {number} paraId - ID del paràgraf
 * @param {Object} mapIdToElement - Mapa d'IDs a elements
 * @returns {string|null} - Text del paràgraf o null si no existeix
 */
function getParagraphTextById(paraId, mapIdToElement) {
  const element = mapIdToElement[paraId];
  if (!element) return null;
  try {
    return element.asText().getText();
  } catch (e) {
    return null;
  }
}

/**
 * Reverteix l'últim canvi fet (v2.6, v6.0 fix)
 * Retorna { success: true } o { success: false, error: string }
 */
function revertLastEdit() {
  try {
    const lastEdit = loadLastEdit();
    if (!lastEdit) {
      return { success: false, error: "No hi ha cap canvi per desfer." };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v6.6: Primer intentar amb bodyIndex (més fiable si el document no ha canviat)
    let targetElement = null;
    if (lastEdit.bodyIndex !== undefined && lastEdit.bodyIndex >= 0) {
      try {
        const candidate = body.getChild(lastEdit.bodyIndex);
        // Verificar que és un element editable
        if (candidate && (candidate.getType() === DocumentApp.ElementType.PARAGRAPH ||
                         candidate.getType() === DocumentApp.ElementType.LIST_ITEM)) {
          targetElement = candidate;
        }
      } catch (e) {
        console.log('[Revert] bodyIndex fallback failed:', e.message);
      }
    }

    // Fallback: usar mapa d'IDs (ara sincronitzat amb processElement)
    if (!targetElement) {
      const targetId = parseInt(lastEdit.targetId, 10);
      const { map: mapIdToElement } = buildElementIndexMap(body);
      targetElement = mapIdToElement[targetId];
    }

    if (!targetElement) {
      return { success: false, error: "No s'ha trobat el paràgraf original." };
    }

    // Revertir al text original
    targetElement.asText().setText(lastEdit.originalText);

    // v10.1: Restaurar heading original si existeix
    if (lastEdit.originalHeading !== undefined && lastEdit.originalHeading !== null) {
      try {
        if (targetElement.setHeading) {
          targetElement.setHeading(lastEdit.originalHeading);
        }
      } catch (e) {
        console.log('[Revert] Could not restore heading:', e.message);
      }
    }

    // v2.6.1: Actualitzar currentText = originalText (no esborrar)
    lastEdit.currentText = lastEdit.originalText;
    saveLastEdit(lastEdit);

    // v8.2: Invalidar cache
    invalidateCaptureCache();

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- OPTIMISTIC UNDO (v2.6 Sprint) ---

/**
 * Restaura el text original d'un paràgraf específic (Optimistic UI Undo)
 * v12.0: Suporta restauració de format complet via formatSnapshot
 * @param {string} targetId - L'ID del paràgraf a restaurar
 * @param {string} originalText - El text original a restaurar
 * @param {number} bodyIndex - Índex al body (opcional, més fiable)
 * @param {Object} formatSnapshot - Snapshot de format complet (opcional)
 * @returns {Object} { status: 'restored' } o { status: 'error', error: string }
 */
function restoreText(targetId, originalText, bodyIndex, formatSnapshot) {
  try {
    if (targetId === null || targetId === undefined) {
      return { status: 'error', error: 'No hi ha targetId' };
    }
    if (!originalText) {
      return { status: 'error', error: 'No hi ha text original' };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v6.6: Primer intentar amb bodyIndex (més fiable)
    let targetElement = null;
    if (bodyIndex !== undefined && bodyIndex >= 0) {
      try {
        const candidate = body.getChild(bodyIndex);
        if (candidate && (candidate.getType() === DocumentApp.ElementType.PARAGRAPH ||
                         candidate.getType() === DocumentApp.ElementType.LIST_ITEM)) {
          targetElement = candidate;
        }
      } catch (e) {
        console.log('[RestoreText] bodyIndex fallback failed:', e.message);
      }
    }

    // Fallback: usar mapa d'IDs (ara sincronitzat amb processElement)
    if (!targetElement) {
      const numericId = parseInt(targetId, 10);
      const { map: mapIdToElement } = buildElementIndexMap(body);
      targetElement = mapIdToElement[numericId];
    }

    if (!targetElement) {
      return { status: 'error', error: 'No s\'ha trobat el paràgraf' };
    }

    // v12.0: Restaurar amb format complet si tenim snapshot
    if (formatSnapshot && formatSnapshot.textFormat) {
      const success = restoreFromSnapshot(targetElement, formatSnapshot);
      if (success) {
        console.log('[RestoreText] v12.0: Format complet restaurat');
      } else {
        // Fallback si falla
        targetElement.asText().setText(originalText);
      }
    } else {
      // Comportament antic: només restaurar text (perd format)
      targetElement.asText().setText(originalText);
    }

    // Actualitzar lastEdit per mantenir coherència
    const lastEdit = loadLastEdit();
    if (lastEdit && String(lastEdit.targetId) === String(targetId)) {
      lastEdit.currentText = originalText;
      saveLastEdit(lastEdit);
    }

    return { status: 'restored' };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}

// --- BANNED WORDS (v2.8) ---

/**
 * Retorna la llista de paraules prohibides
 */
function getBannedWords() {
  try {
    const props = PropertiesService.getUserProperties();
    const json = props.getProperty(BANNED_WORDS_KEY);
    if (!json) return [];
    return JSON.parse(json);
  } catch (e) {
    return [];
  }
}

/**
 * Guarda la llista de paraules prohibides
 */
function saveBannedWords(words) {
  const props = PropertiesService.getUserProperties();
  if (words && Array.isArray(words) && words.length > 0) {
    props.setProperty(BANNED_WORDS_KEY, JSON.stringify(words));
  } else {
    props.deleteProperty(BANNED_WORDS_KEY);
  }
  return { success: true };
}

// --- RECIPES (v3.4) ---

/**
 * Obté la llista de receptes de l'usuari
 */
function getRecipes() {
  try {
    const props = PropertiesService.getUserProperties();
    const json = props.getProperty(RECIPES_KEY);
    if (!json) return [];
    return JSON.parse(json);
  } catch (e) {
    return [];
  }
}

/**
 * Guarda la llista de receptes de l'usuari
 */
function saveRecipes(recipes) {
  const props = PropertiesService.getUserProperties();
  if (recipes && Array.isArray(recipes) && recipes.length > 0) {
    props.setProperty(RECIPES_KEY, JSON.stringify(recipes));
  } else {
    props.deleteProperty(RECIPES_KEY);
  }
  return { success: true };
}

// --- PUJADA DE FITXERS (PROXY VIA WORKER) ---
function uploadFileToWorker(base64Data, mimeType, fileName) {
  const settingsStr = getSettings();
  const settings = JSON.parse(settingsStr);
  if (!settings.license_key) throw new Error("Falta la llicència API.");

  const payload = {
    action: 'upload_file',
    license_key: settings.license_key,
    file_data: base64Data,
    mime_type: mimeType,
    file_name: fileName
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      throw new Error("Error pujant fitxer: " + (json.error_code || "Desconegut"));
    }

    saveFileUri(json.file_uri, fileName, mimeType);
    return { success: true, name: fileName };

  } catch (e) {
    throw new Error("Upload fallit: " + e.message);
  }
}

// --- CAPTURA DE SELECCIÓ (v5.2) ---
// Guarda la selecció actual al cache abans que l'usuari interactuï amb la sidebar
function captureCurrentSelection() {
  try {
    const doc = DocumentApp.getActiveDocument();
    const selection = doc.getSelection();
    const props = PropertiesService.getDocumentProperties();

    // v8.2: Sempre retornar docWordCount per mostrar "tot el document"
    const docWordCount = getDocumentWordCount();

    // v14.2: Detectar canvi de selecció o edició per netejar highlights
    // Qualsevol acció d'usuari (excepte scroll) ha de netejar els ressaltats
    const docBody = doc.getBody();
    const currentCursor = selection ? 'has_selection' : doc.getCursor()?.getOffset() || 'no_cursor';
    const currentDocLength = docBody.getText().length;  // Proxy ràpid per detectar edicions

    const lastCursor = props.getProperty('lastCursorState');
    const lastDocLength = props.getProperty('lastDocLength');

    const cursorChanged = lastCursor && lastCursor !== String(currentCursor);
    const docEdited = lastDocLength && lastDocLength !== String(currentDocLength);

    // v14.4: Notificar el sidebar quan es netegen highlights
    let highlightsCleared = false;

    if (cursorChanged || docEdited) {
      // L'usuari ha mogut el cursor, canviat selecció, o editat el document → netejar highlights
      try {
        clearAllHighlights();
        highlightsCleared = true;
      } catch (e) {
        // Ignorar errors de neteja
      }
    }

    props.setProperty('lastCursorState', String(currentCursor));
    props.setProperty('lastDocLength', String(currentDocLength));

    if (!selection) {
      return { captured: false, hasSelection: false, wordCount: 0, docWordCount: docWordCount, highlightsCleared: highlightsCleared };
    }

    const ranges = selection.getRangeElements() || [];
    if (ranges.length === 0) {
      return { captured: false, hasSelection: false, wordCount: 0, docWordCount: docWordCount, highlightsCleared: highlightsCleared };
    }

    // v5.3: També calcular word count per l'indicador
    let totalText = '';

    // Serialitzar la selecció (guardem índexs dels elements)
    const body = doc.getBody();
    const selectionData = [];

    ranges.forEach(range => {
      const element = range.getElement();
      const parent = element.getType() === DocumentApp.ElementType.TEXT ?
                     element.getParent() : element;

      // v5.3: Extreure text per word count
      let text = '';
      if (element.getType() === DocumentApp.ElementType.TEXT) {
        text = element.asText().getText();
        if (range.isPartial()) {
          text = text.substring(range.getStartOffset(), range.getEndOffsetInclusive() + 1);
        }
      } else if (element.editAsText) {
        text = element.editAsText().getText();
      }
      if (text) totalText += text + ' ';

      // Buscar l'índex de l'element al body
      const numChildren = body.getNumChildren();
      for (let i = 0; i < numChildren; i++) {
        if (body.getChild(i).equals && body.getChild(i).equals(parent)) {
          selectionData.push({
            index: i,
            startOffset: range.getStartOffset(),
            endOffset: range.getEndOffsetInclusive(),
            isPartial: range.isPartial()
          });
          break;
        }
        // Per elements niuats (dins taules, etc.)
        if (body.getChild(i) === parent) {
          selectionData.push({ index: i });
          break;
        }
      }
    });

    // v6.1: Calcular word count amb regex optimitzat
    totalText = totalText.trim();
    const wordCount = totalText ? (totalText.match(/\S+/g) || []).length : 0;

    // v5.3: Text preview (primers 40 chars)
    const textPreview = totalText.length > 40
      ? totalText.substring(0, 40) + '...'
      : totalText;

    if (selectionData.length === 0) {
      return { captured: false, hasSelection: true, wordCount: wordCount, textPreview: textPreview, highlightsCleared: highlightsCleared };
    }

    // Guardar al cache (60 segons de vida)
    const cache = CacheService.getUserCache();
    cache.put('docmile_selection', JSON.stringify({
      docId: doc.getId(),
      timestamp: Date.now(),
      elements: selectionData
    }), 60);

    return { captured: true, hasSelection: true, wordCount: wordCount, textPreview: textPreview, elements: selectionData.length, highlightsCleared: highlightsCleared };

  } catch (e) {
    return { captured: false, hasSelection: false, wordCount: 0, error: e.message, highlightsCleared: false };
  }
}

// Recupera la selecció guardada del cache
function getCachedSelection(doc, body) {
  try {
    const cache = CacheService.getUserCache();
    const cached = cache.get('docmile_selection');

    if (!cached) return null;

    const data = JSON.parse(cached);

    // Verificar que és del mateix document i no ha expirat (30 segons màxim)
    if (data.docId !== doc.getId()) return null;
    if (Date.now() - data.timestamp > 30000) return null;

    // Reconstruir els elements
    const elements = [];
    const numChildren = body.getNumChildren();

    data.elements.forEach(sel => {
      if (sel.index >= 0 && sel.index < numChildren) {
        elements.push(body.getChild(sel.index));
      }
    });

    // Netejar cache després d'usar
    cache.remove('docmile_selection');

    return elements.length > 0 ? elements : null;

  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// TIMELINE HASH SYSTEM (v4.0)
// ═══════════════════════════════════════════════════════════════

/**
 * Genera hash MD5 del contingut del document
 * Inclou text + comptador d'estructura per detectar canvis de format
 */
function getDocumentStateHash() {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    const content = {
      t: body.getText(),
      h: body.getParagraphs().filter(p =>
        p.getHeading() !== DocumentApp.ParagraphHeading.NORMAL
      ).length
    };

    const payload = JSON.stringify(content);
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.MD5,
      payload,
      Utilities.Charset.UTF_8
    );

    return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
  } catch (e) {
    Logger.log('Hash calculation failed: ' + e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// v8.2: DOCUMENT CAPTURE CACHE - Evita escanejos repetits
// ═══════════════════════════════════════════════════════════════
const CAPTURE_CACHE_KEY = 'DOCMILE_CAPTURE_CACHE';
const CAPTURE_CACHE_TTL = 60000; // 60 segons

/**
 * Obtenir capture cachejat si hash coincideix
 * @param {string} currentHash - Hash actual del document
 * @param {boolean} isSelection - Si hi ha selecció activa
 * @returns {Object|null} - Resultat cachejat o null
 */
function getCachedCapture(currentHash, isSelection) {
  // Mai cachear seleccions (canvien sense canvi de hash)
  if (isSelection) return null;

  try {
    const cache = CacheService.getUserCache();
    const cached = cache.get(CAPTURE_CACHE_KEY);
    if (!cached) return null;

    const data = JSON.parse(cached);

    // Validar hash
    if (data.hash !== currentHash) return null;

    // Validar TTL (amb validació de tipus)
    if (typeof data.timestamp !== 'number' || Date.now() - data.timestamp > CAPTURE_CACHE_TTL) return null;

    // Validar mateix document
    const doc = DocumentApp.getActiveDocument();
    if (data.docId !== doc.getId()) return null;

    Logger.log('[Cache] HIT - Document capture reutilitzat');
    return data.result;
  } catch (e) {
    Logger.log('[Cache] Read error: ' + e.message);
    return null;
  }
}

/**
 * Guardar capture al cache
 * @param {string} hash - Hash del document
 * @param {Object} result - Resultat de captureFullDocument
 */
function setCachedCapture(hash, result) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const cache = CacheService.getUserCache();
    const data = {
      hash: hash,
      docId: doc.getId(),
      timestamp: Date.now(),
      result: {
        contentPayload: result.contentPayload,
        stats: result.stats,
        isEmpty: result.isEmpty
        // mapIdToElement NO es cacheja (referències GAS objects)
      }
    };

    const jsonData = JSON.stringify(data);
    // CacheService té límit 100KB per item
    if (jsonData.length < 100000) {
      cache.put(CAPTURE_CACHE_KEY, jsonData, 60);
      Logger.log('[Cache] SAVED - ' + Math.round(jsonData.length / 1024) + 'KB');
    } else {
      Logger.log('[Cache] Document massa gran: ' + Math.round(jsonData.length / 1024) + 'KB');
    }
  } catch (e) {
    Logger.log('[Cache] Write error: ' + e.message);
  }
}

/**
 * Invalidar cache del document
 */
function invalidateCaptureCache() {
  try {
    CacheService.getUserCache().remove(CAPTURE_CACHE_KEY);
    Logger.log('[Cache] Invalidated');
  } catch (e) {
    // Ignorar errors d'invalidació
  }
}

/**
 * Compta paraules del document
 * v6.1: Regex optimitzat
 */
function getDocumentWordCount() {
  try {
    const text = DocumentApp.getActiveDocument().getBody().getText().trim();
    return text ? (text.match(/\S+/g) || []).length : 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Confirma el hash final després d'aplicar edits
 * @param {string} eventId - ID de l'event a confirmar
 */
function confirmEditHash(eventId) {
  if (!eventId) return { confirmed: false };

  const settings = JSON.parse(getSettings());
  const newHash = getDocumentStateHash();
  const wordCount = getDocumentWordCount();

  const payload = {
    action: 'confirm_edit',
    license_key: settings.license_key,
    event_id: eventId,
    final_hash: newHash,
    word_count: wordCount
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());
    return { confirmed: json.status === 'ok' };
  } catch (e) {
    Logger.log('Confirm hash failed: ' + e.message);
    return { confirmed: false };
  }
}

/**
 * Obté el timeline del document actual
 */
function getDocumentTimeline() {
  const doc = DocumentApp.getActiveDocument();
  const settings = JSON.parse(getSettings());

  const payload = {
    action: 'get_timeline',
    license_key: settings.license_key,
    doc_id: doc.getId(),
    // v4.0: Send current hash to detect gaps on timeline load
    client_hash: getDocumentStateHash(),
    word_count: getDocumentWordCount()
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());
    return json;  // Return full response with status and timeline
  } catch (e) {
    Logger.log('Get timeline failed: ' + e.message);
    return { status: 'error', timeline: [] };
  }
}

/**
 * Reverteix una edició específica del timeline
 * Usa el mateix mapatge d'elements que processUserCommand
 */
function revertEditEvent(eventId) {
  const doc = DocumentApp.getActiveDocument();
  const settings = JSON.parse(getSettings());

  const payload = {
    action: 'revert_edit',
    license_key: settings.license_key,
    doc_id: doc.getId(),
    event_id: eventId
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (json.status !== 'ok') {
      return { status: 'error', error: json.error_code || json.error || 'Error desconegut' };
    }

    if (!json.restore_text) {
      return { status: 'error', error: 'No hi ha text anterior guardat per aquesta edició' };
    }

    if (json.target_id === null || json.target_id === undefined) {
      return { status: 'error', error: 'No hi ha target_id per aquesta edició' };
    }

    // Usar el MATEIX mapatge que processUserCommand (només PARAGRAPH i LIST_ITEM amb text)
    const body = doc.getBody();
    const numChildren = body.getNumChildren();
    let elementsToProcess = [];

    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
          child.getType() === DocumentApp.ElementType.LIST_ITEM) {
        elementsToProcess.push(child);
      }
    }

    // Trobar element per ID (comptant només elements amb text, com fa el marcatge)
    const targetId = parseInt(json.target_id, 10);
    let targetElement = null;
    let currentIndex = 0;

    for (let i = 0; i < elementsToProcess.length; i++) {
      const el = elementsToProcess[i];
      const text = el.asText().getText();
      if (text.trim().length > 0) {
        if (currentIndex === targetId) {
          targetElement = el;
          break;
        }
        currentIndex++;
      }
    }

    if (targetElement) {
      targetElement.asText().setText(json.restore_text);
      // v8.2: Invalidar cache
      invalidateCaptureCache();
      return { status: 'ok', restore_text: json.restore_text, target_id: json.target_id };
    } else {
      return { status: 'error', error: "No s'ha trobat el paràgraf amb ID " + targetId };
    }

  } catch (e) {
    Logger.log('Revert edit failed: ' + e.message);
    return { status: 'error', error: e.message };
  }
}

// --- NUCLI DEL PROCESSAMENT (v3.10 simplificat - 2 modes) ---
// v8.0: Added chatAttachments parameter for temporary file attachments
function processUserCommand(instruction, chatHistory, userMode, previewMode, chatAttachments) {
  // v3.7: Iniciar col·lector de mètriques
  const metrics = createMetricsCollector();

  // v13.6: Netejar TOTS els highlights anteriors abans de processar nou missatge
  // Això fa que els ressaltats siguin temporals i desapareguin amb cada nova acció
  try {
    clearAllHighlights();
  } catch (e) {
    // Ignorar errors de neteja - no ha de bloquejar el flux principal
  }

  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();
  const body = doc.getBody();

  // v3.7: Analitzar estructura COMPLETA del document (diagnòstic)
  const docStats = analyzeDocumentStructure(body);
  metrics.setDocumentStats(docStats);

  // v3.7: Log inicial amb estadístiques del document
  logDiagnostic('INIT', {
    doc_id: doc.getId(),
    doc_name: doc.getName(),
    total_elements: docStats.total_children,
    captured_elements: docStats.captured.paragraph + docStats.captured.list_item,
    captured_chars: docStats.captured.total_chars,
    invisible_tables: docStats.invisible.table,
    invisible_images: docStats.invisible.inline_image,
    invisible_other: docStats.invisible.other + docStats.invisible.footnote,
    element_types: Object.keys(docStats.by_type).join(', ')
  });

  let contentPayload = "";
  let mapIdToElement = {};
  let isSelection = false;

  // v2.6: Carregar l'últim edit per contexte
  const lastEdit = loadLastEdit();

  // v2.8: Carregar paraules prohibides
  const bannedWords = getBannedWords();

  // v8.2: LAZY LOAD SKELETON - Només quan cal per operacions estructurals
  let docSkeleton = null;

  // Patrons que indiquen necessitat d'estructura
  const skeletonTriggers = [
    /\b(titol|títol|heading|encapçalament|secció|sección|section|capítol|capitol)\b/i,
    /\b(estructura|structure|índex|index|taula de continguts|toc)\b/i,
    /\b(primer|segon|tercer|últim|anterior|següent)\s+(paràgraf|párrafo|secció)/i,
    /\b(resum|summary|table of contents|sumari)\b/i,
    /\b(reorganitza|reorganize|reordena|reorder|mou.*secció)\b/i,
    /\b(afegeix.*al final|afegeix.*abans|insereix.*secció)\b/i,
    /\b(quantes seccions|quants capítols|llista.*seccions)\b/i
  ];

  const needsSkeleton = instruction && skeletonTriggers.some(r => r.test(instruction));

  if (needsSkeleton) {
    try {
      docSkeleton = getDocSkeleton();
      Logger.log('[Skeleton] LOADED - keyword detected');
    } catch (e) {
      // Si falla el skeleton, continuar sense (graceful degradation)
      docSkeleton = null;
      Logger.log('[Skeleton] Load failed: ' + e.message);
    }
  } else {
    Logger.log('[Skeleton] SKIPPED - no structural keywords');
  }

  const settings = JSON.parse(getSettings());
  if (!settings.license_key) throw new Error("Falta llicència.");

  // v6.0: Multiple active files support
  // v9.4: Filtrar fitxers sense URI vàlid per evitar errors d'expiració
  const activeFilesResult = getActiveKnowledgeFiles();
  const knowledgeFiles = (activeFilesResult.files || []).filter(f => f && f.uri && f.uri.trim().length > 0);

  // v5.2: Preparar elements per la captura (amb fallback a cache)
  let selectedElements = null;
  let selectionSource = 'none';

  if (selection) {
    // Selecció activa directa del document
    const ranges = selection.getRangeElements() || [];
    selectedElements = [];
    ranges.forEach(r => {
      const el = r.getElement();
      if (el.getType() === DocumentApp.ElementType.TEXT) selectedElements.push(el.getParent());
      else selectedElements.push(el);
    });
    selectedElements = [...new Set(selectedElements)];
    isSelection = true;
    selectionSource = 'direct';
  } else {
    // v5.2: Intentar recuperar selecció del cache (capturada abans del focus change)
    const cachedElements = getCachedSelection(doc, body);
    if (cachedElements && cachedElements.length > 0) {
      selectedElements = cachedElements;
      isSelection = true;
      selectionSource = 'cache';
    }
  }

  // v3.7: UNIVERSAL DOC READER - Captura TOTAL del document
  // Inclou: Header, Body (paràgrafs, llistes, taules, TOC), Footer, Footnotes
  // v8.2: HASH-BASED CACHING - Evitar escanejos repetits
  const currentHash = getDocumentStateHash();
  let captureResult;

  // Intentar cache primer (només si no hi ha selecció)
  const cachedResult = getCachedCapture(currentHash, isSelection);
  if (cachedResult) {
    // v17.6 FIX: Cache HIT - usar buildElementIndexMap per consistència absoluta
    // IMPORTANT: buildElementIndexMap replica exactament processElement
    const { map: lightweightMap } = buildElementIndexMap(body);
    captureResult = {
      contentPayload: cachedResult.contentPayload,
      stats: cachedResult.stats,
      isEmpty: cachedResult.isEmpty,
      mapIdToElement: lightweightMap
    };
    Logger.log('[Cache] HIT - Skipped full document capture');
  } else {
    // Cache MISS - captura completa
    captureResult = captureFullDocument(doc, body, isSelection, selectedElements);
    // Guardar per properes peticions (només si no hi ha selecció)
    if (!isSelection && currentHash) {
      setCachedCapture(currentHash, captureResult);
    }
  }

  contentPayload = captureResult.contentPayload;
  mapIdToElement = captureResult.mapIdToElement;
  const contentIndex = Object.keys(mapIdToElement).length;
  const isDocumentEmpty = captureResult.isEmpty;
  const captureStats = captureResult.stats;

  // v3.7: Log de la instrucció i estat del document (UNIVERSAL DOC READER)
  const requestInfo = {
    instruction_length: instruction ? instruction.length : 0,
    instruction_preview: instruction ? instruction.substring(0, 100) : '',
    has_selection: isSelection,
    user_mode: userMode || 'edit',
    preview_mode: previewMode || false,
    content_payload_chars: contentPayload.length,
    content_payload_is_empty: isDocumentEmpty,
    elements_with_content: contentIndex,
    has_last_edit: !!lastEdit,
    banned_words_count: bannedWords ? bannedWords.length : 0,
    // v3.7: Estadístiques COMPLETES del document
    captured_paragraphs: captureStats.captured_paragraphs,
    captured_tables: captureStats.captured_tables,
    captured_lists: captureStats.captured_lists,
    has_header: captureStats.captured_header,
    has_footer: captureStats.captured_footer,
    footnotes_count: captureStats.footnotes_count,
    has_images: captureStats.has_images,
    has_drawings: captureStats.has_drawings
  };
  metrics.setRequestInfo(requestInfo);

  logDiagnostic('REQUEST', {
    instruction: instruction ? instruction.substring(0, 200) : null,
    user_mode: userMode,
    has_selection: isSelection,
    selection_source: selectionSource, // v5.2: direct, cache, o none
    doc_is_empty: isDocumentEmpty,
    captured_ids: contentIndex,
    total_chars: contentPayload.length,
    tables: captureStats.captured_tables,
    header: captureStats.captured_header,
    footer: captureStats.captured_footer,
    footnotes: captureStats.footnotes_count
  });

  // v12.4: Build auth object for BYOK support
  const authObject = buildAuthObject();

  const payload = {
    license_key: settings.license_key,
    // v12.4: BYOK auth - si hi ha provider actiu, enviar auth
    auth: authObject,
    user_instruction: instruction,
    text: contentPayload,
    doc_metadata: { doc_id: doc.getId() },
    style_guide: settings.style_guide,
    strict_mode: settings.strict_mode,
    // v6.0: Multiple knowledge files support
    knowledge_files: knowledgeFiles.map(f => ({ uri: f.uri, mime: f.mime, name: f.name })),
    // Legacy single file support (first file if any)
    knowledge_file_uri: knowledgeFiles.length > 0 ? knowledgeFiles[0].uri : null,
    knowledge_file_mime: knowledgeFiles.length > 0 ? knowledgeFiles[0].mime : null,
    has_selection: isSelection,
    chat_history: chatHistory || [],
    last_edit: lastEdit,
    user_mode: userMode || 'edit',
    negative_constraints: bannedWords, // v2.8: Paraules prohibides
    doc_skeleton: docSkeleton, // v2.9: Estructura del document
    // v3.7: UNIVERSAL DOC READER - Estadístiques COMPLETES
    doc_stats: {
      total_elements: captureStats.total_elements,
      paragraphs: captureStats.captured_paragraphs,
      lists: captureStats.captured_lists,
      tables: captureStats.captured_tables,
      total_chars: captureStats.total_chars,
      is_empty: isDocumentEmpty,
      // Nous camps v3.7
      has_header: captureStats.captured_header,
      has_footer: captureStats.captured_footer,
      footnotes: captureStats.footnotes_count,
      has_images: captureStats.has_images,
      has_drawings: captureStats.has_drawings
    },
    pinned_prefs: {
      language: 'ca',
      tone: 'tècnic però entenedor',
      style_notes: settings.style_guide || ''
    },
    // v4.0: Timeline hash fields
    client_hash: getDocumentStateHash(),
    word_count: getDocumentWordCount(),
    // v8.0: Chat attachments (temporary files)
    chat_attachments: chatAttachments || [],
    // v6.0: Document images for multimodal AI (conditional extraction)
    images: null  // Will be populated below if needed
  };

  // v6.0: Extract images if instruction mentions them
  if (shouldExtractImages(instruction) && captureStats.has_images) {
    try {
      const imageResult = extractDocumentImages(body);
      if (imageResult.images.length > 0) {
        payload.images = imageResult.images;
        logDiagnostic('IMAGES_EXTRACTED', {
          count: imageResult.stats.extracted,
          total_kb: imageResult.stats.total_size_kb,
          time_ms: imageResult.stats.extraction_time_ms
        });
      }
    } catch (e) {
      logDiagnostic('IMAGE_EXTRACTION_ERROR', { error: e.message });
    }
  }

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      throw new Error(json.error_code || "Error API");
    }

    const aiData = json.data;

    // --- ROUTER D'INTENCIÓ ---
    if (aiData.mode === 'CHAT_ONLY') {
      // v9.0: Apply proactive highlights if present
      let proactiveHighlightResult = null;
      if (json.proactive_highlights && json.proactive_highlights.length > 0) {
        try {
          proactiveHighlightResult = applyProactiveHighlights(json.proactive_highlights);
          logDiagnostic('PROACTIVE_HIGHLIGHT', {
            requested: json.proactive_highlights.length,
            applied: proactiveHighlightResult.applied,
            not_found: proactiveHighlightResult.notFound ? proactiveHighlightResult.notFound.length : 0
          });
        } catch (e) {
          logDiagnostic('PROACTIVE_HIGHLIGHT_ERROR', { error: e.message });
        }
      }

      // v3.7: Log resposta CHAT_ONLY
      const responseInfo = {
        mode: 'CHAT_ONLY',
        has_chat_response: !!(aiData.chat_response || aiData.change_summary),
        response_length: (aiData.chat_response || aiData.change_summary || '').length,
        credits_remaining: json.credits_remaining,
        proactive_highlights: json.proactive_highlights ? json.proactive_highlights.length : 0
      };
      metrics.setResponseInfo(responseInfo);
      logDiagnostic('RESPONSE', {
        mode: 'CHAT_ONLY',
        response_preview: (aiData.chat_response || aiData.change_summary || '').substring(0, 100),
        doc_was_empty: isDocumentEmpty,
        user_wanted: userMode,
        proactive_highlights: json.proactive_highlights ? json.proactive_highlights.length : 0
      });
      metrics.finalize();

      return {
        ok: true,
        ai_response: aiData.chat_response || aiData.change_summary,
        credits: json.credits_remaining,
        mode: 'chat',
        // v9.0: Proactive highlights for frontend rendering
        proactive_highlights: json.proactive_highlights || [],
        proactive_applied: proactiveHighlightResult ? proactiveHighlightResult.applied : 0,
        // v3.7: Afegir diagnòstic
        _diag: {
          doc_chars: contentPayload.length,
          doc_empty: isDocumentEmpty,
          invisible_elements: docStats.invisible.table + docStats.invisible.inline_image
        }
      };
    }

    // v7.0: REFERENCE_HIGHLIGHT mode - Marca parts del document sense editar
    if (aiData.mode === 'REFERENCE_HIGHLIGHT' && aiData.highlights) {
      // Aplicar highlights al document
      const highlightResult = applyReferenceHighlights(aiData.highlights);

      // Log resposta REFERENCE_HIGHLIGHT
      const responseInfo = {
        mode: 'REFERENCE_HIGHLIGHT',
        highlights_requested: aiData.highlights.length,
        highlights_applied: highlightResult.applied,
        credits_remaining: json.credits_remaining
      };
      metrics.setResponseInfo(responseInfo);
      logDiagnostic('RESPONSE', {
        mode: 'REFERENCE_HIGHLIGHT',
        highlights: aiData.highlights.length,
        applied: highlightResult.applied,
        doc_was_empty: isDocumentEmpty
      });
      metrics.finalize();

      return {
        ok: true,
        status: 'reference_highlight',
        ai_response: aiData.ai_response,
        highlights: aiData.highlights,
        applied: highlightResult.applied,
        credits: json.credits_remaining,
        mode: 'reference',
        _diag: {
          doc_chars: contentPayload.length,
          doc_empty: isDocumentEmpty
        }
      };
    }

    // v6.0: TABLE_UPDATE mode - Modify existing table cells/rows
    if (aiData.mode === 'TABLE_UPDATE' && aiData.operations) {
      const tableResult = applyTableOperations(aiData.table_id, aiData.operations);

      // Log resposta TABLE_UPDATE
      const responseInfo = {
        mode: 'TABLE_UPDATE',
        table_id: aiData.table_id,
        operations_requested: aiData.operations.length,
        operations_applied: tableResult.operations_applied,
        operations_failed: tableResult.operations_failed,
        credits_remaining: json.credits_remaining
      };
      metrics.setResponseInfo(responseInfo);
      logDiagnostic('RESPONSE', {
        mode: 'TABLE_UPDATE',
        table_id: aiData.table_id,
        operations: aiData.operations.length,
        applied: tableResult.operations_applied,
        failed: tableResult.operations_failed
      });
      metrics.finalize();

      return {
        ok: tableResult.success,
        status: 'table_updated',
        ai_response: aiData.change_summary || aiData.thought || 'Taula actualitzada.',
        table_id: aiData.table_id,
        operations_applied: tableResult.operations_applied,
        operations_failed: tableResult.operations_failed,
        details: tableResult.details,
        credits: json.credits_remaining,
        mode: 'table_update',
        _diag: {
          doc_chars: contentPayload.length,
          original_dims: tableResult.original_dimensions,
          final_dims: tableResult.final_dimensions
        }
      };
    }

    let lastEditWord = null; // v2.8: Paraula per al botó "Prohibir"

    // v2.6 Snapshot for Optimistic UI Undo
    let undoSnapshot = null;

    // v3.7: Variables per estadístiques d'execució (scope global dins la funció)
    let editsApplied = 0;
    let editsSkipped = 0;
    let editErrors = [];
    let editDuration = 0;

    if (aiData.mode === 'UPDATE_BY_ID') {
      // v14.1: Processar canvis amb validació v14 (suporta format antic i nou)
      const v14Result = processChangesV14(aiData, mapIdToElement);

      // v3.8: Preview Mode - IN-DOCUMENT preview (Track Changes style)
      if (previewMode) {
        let changes = [];

        // v15.3: Workaround - detectar format v14 directament si processChangesV14 falla
        const hasChangesWorkaround = aiData.changes &&
          typeof aiData.changes === 'object' &&
          (aiData.changes[0] !== undefined || aiData.changes['0'] !== undefined);

        // v14.1: Si tenim format v14, usar processedChanges directament
        if (v14Result.hasV14Format) {
          changes = v14Result.processedChanges;

          // Log si hi ha canvis bloquejats o stale
          if (v14Result.blockedChanges.length > 0 || v14Result.staleChanges.length > 0) {
            logDiagnostic('V14_VALIDATION', {
              processed: v14Result.processedChanges.length,
              blocked: v14Result.blockedChanges.length,
              stale: v14Result.staleChanges.length,
              warned: v14Result.warnChanges.length,
            });
          }
        } else if (hasChangesWorkaround) {
          // v15.3: Workaround - processar directament si GAS té codi antic cachejat
          const changesArray = Array.isArray(aiData.changes) ? aiData.changes : Object.values(aiData.changes);
          logDiagnostic('WORKAROUND_V15.3', {
            changes_count: changesArray.length,
            map_keys: Object.keys(mapIdToElement).slice(0, 10),
          });
          for (let i = 0; i < changesArray.length; i++) {
            const change = changesArray[i];
            const paraId = change.paragraph_id;
            // v15.3: Provar tant amb número com amb string
            const targetElement = mapIdToElement[paraId] || mapIdToElement[String(paraId)];

            logDiagnostic('WORKAROUND_CHANGE', {
              i: i,
              paraId: paraId,
              paraIdType: typeof paraId,
              hasElement: !!targetElement,
              original: change.original ? change.original.substring(0, 20) : null,
              replacement: change.replacement,
            });

            if (targetElement) {
              const currentText = targetElement.asText().getText();
              // Determinar el text nou
              let newText = change.new_text;
              if (newText === undefined && change.replacement !== undefined) {
                // Format find/replace: aplicar substitució
                const original = change.original || change.original_text || '';
                if (original && currentText.includes(original)) {
                  newText = currentText.replace(original, change.replacement);
                } else {
                  logDiagnostic('WORKAROUND_NO_MATCH', {
                    original: original,
                    currentText: currentText.substring(0, 50),
                    includes: currentText.includes(original),
                  });
                }
              }
              if (newText !== undefined) {
                changes.push({
                  targetId: paraId,
                  originalText: currentText,
                  proposedText: newText,
                  _workaround: true,
                });
              }
            }
          }
        } else {
          // Format antic: convertir a array de canvis
          for (const [id, newText] of Object.entries(v14Result.updates)) {
            const targetElement = mapIdToElement[id];
            if (targetElement) {
              const currentDocText = targetElement.asText().getText();
              const cleanNewText = cleanMarkdown(newText);
              changes.push({
                targetId: id,
                originalText: currentDocText,
                proposedText: cleanNewText
              });
            }
          }
        }

        // If no changes found (IDs don't match), return error - no fallback to direct mode
        if (changes.length === 0) {
          // v15.3: Debug info més complet per investigar el problema
          const firstChange = aiData.changes ? (aiData.changes[0] || aiData.changes['0']) : null;
          const hasChangesCheck = aiData.changes &&
            typeof aiData.changes === 'object' &&
            (aiData.changes[0] !== undefined || aiData.changes['0'] !== undefined);
          const debugInfo = {
            ai_changes: aiData.changes ? Object.keys(aiData.changes).length : 0,
            is_array: Array.isArray(aiData.changes),
            changes_type: typeof aiData.changes,
            changes_keys: aiData.changes ? Object.keys(aiData.changes).slice(0, 5) : [],
            first_change: firstChange ? JSON.stringify(firstChange).substring(0, 100) : null,
            hasChangesCheck: hasChangesCheck,
            processed: v14Result.processedChanges.length,
            blocked: v14Result.blockedChanges.length,
            stale: v14Result.staleChanges.length,
            map_keys: Object.keys(mapIdToElement).length,
            hasV14: v14Result.hasV14Format,
            change_debug: v14Result._debug || [],
          };

          // v14.1: Millorar missatge d'error si hi ha canvis bloquejats/stale
          let previewError = `DEBUG: ${JSON.stringify(debugInfo)}`;
          if (v14Result.staleChanges.length > 0) {
            previewError = 'El document ha canviat des de l\'última anàlisi. Actualitza el document i torna a provar.';
          } else if (v14Result.blockedChanges.length > 0) {
            previewError = `Canvi bloquejat: ${v14Result.blockedChanges[0]._block_reason} (para ${v14Result.blockedChanges[0].paragraph_id})`;
          }

          logDiagnostic('WARNING', {
            issue: 'PREVIEW_NO_CHANGES',
            updates_from_ai: aiData.changes ? aiData.changes.length : Object.keys(v14Result.updates).length,
            map_ids_available: Object.keys(mapIdToElement).length,
            blocked: v14Result.blockedChanges.length,
            stale: v14Result.staleChanges.length,
          });
          // v10.2: No fall through - retornar error en lloc d'aplicar directament
          return {
            ok: true,
            status: 'in_doc_preview_error',
            ai_response: aiData.chat_response || aiData.change_summary,  // v14.4: Prioritzar resposta natural
            credits: json.credits_remaining,
            preview_error: previewError,
            mode: 'edit',
            // v14.1: Afegir info de canvis bloquejats per debug
            _v14: {
              blocked: v14Result.blockedChanges.length,
              stale: v14Result.staleChanges.length,
            }
          };
        }

        // v11.0: Unified Annotations - NO aplicar al document, retornar per accept/reject individual
        // Log resposta PREVIEW
        const responseInfo = {
          mode: 'UPDATE_BY_ID',
          sub_mode: 'UNIFIED_PREVIEW',
          changes_count: changes.length,
          credits_remaining: json.credits_remaining
        };
        metrics.setResponseInfo(responseInfo);
        logDiagnostic('RESPONSE', {
          mode: 'UPDATE_BY_ID',
          sub_mode: 'UNIFIED_PREVIEW',
          changes: changes.length,
          doc_was_empty: isDocumentEmpty,
          user_wanted: userMode,
          v14_format: v14Result.hasV14Format,
        });
        metrics.finalize();

        // v10.2: Generar preview de la selecció per al badge del xat
        let selectionPreview = null;
        if (isSelection && contentPayload) {
          const cleanText = contentPayload.replace(/\[\d+\]\s*/g, '').trim();
          selectionPreview = cleanText.length > 50
            ? cleanText.substring(0, 47) + '...'
            : cleanText;
        }

        // v14.2: Aplicar highlights al document per ressaltar els fragments a modificar
        let highlightsApplied = 0;
        if (aiData.highlights && aiData.highlights.length > 0) {
          const highlightResult = applyReferenceHighlights(aiData.highlights);
          highlightsApplied = highlightResult.applied || 0;
          logDiagnostic('UPDATE_HIGHLIGHTS', {
            requested: aiData.highlights.length,
            applied: highlightsApplied,
          });
        }

        // v11.0: Retornar status 'preview' amb array de canvis complet
        // v14.1: Afegir info de canvis bloquejats/stale/warn per al frontend
        // El sidebar mostrarà cada canvi amb botons Accept/Reject individuals
        return {
          ok: true,
          status: 'preview',  // v11.0: Unified Annotations
          changes: changes,   // Array complet per accept/reject individual
          ai_response: aiData.chat_response || aiData.change_summary,  // v14.4: Prioritzar resposta natural de la IA
          credits: json.credits_remaining,
          thought: aiData.thought,
          mode: 'edit',
          has_selection: isSelection,
          selection_preview: selectionPreview,
          modification_type: aiData.modification_type,  // v14.1: Passar el tipus de modificació
          highlights_applied: highlightsApplied,  // v14.2: Nombre de highlights aplicats
          // v14.1: Info de validació per al frontend
          _v14: {
            hasV14Format: v14Result.hasV14Format,
            warnChanges: v14Result.warnChanges,
            blockedChanges: v14Result.blockedChanges,
            staleChanges: v14Result.staleChanges,
          },
          _diag: {
            doc_chars: contentPayload.length,
            doc_empty: isDocumentEmpty,
            invisible_elements: docStats.invisible.table + docStats.invisible.inline_image
          }
        };
      }

      // Normal mode - Apply changes directly
      // v3.7: Robust execution with error handling and validation
      // v14.1: Usar v14Result.updates (ja processat amb validació)
      let capturedLastEdit = null;
      const existingLastEdit = loadLastEdit(); // v2.6.1: Carregar ABANS del loop
      const editStartTime = Date.now();

      // v14.1: Log si hi ha canvis bloquejats/stale (no s'aplicaran)
      if (v14Result.blockedChanges.length > 0 || v14Result.staleChanges.length > 0) {
        logDiagnostic('V14_DIRECT_MODE_FILTERED', {
          will_apply: Object.keys(v14Result.updates).length,
          blocked: v14Result.blockedChanges.length,
          stale: v14Result.staleChanges.length,
        });
      }

      for (const [id, newText] of Object.entries(v14Result.updates)) {
        try {
          const targetElement = mapIdToElement[id];

          // v3.7: Verificar que l'element existeix i és vàlid
          if (!targetElement) {
            editsSkipped++;
            logDiagnostic('EDIT_SKIP', {
              reason: 'ELEMENT_NOT_FOUND',
              target_id: id,
              available_ids: Object.keys(mapIdToElement).slice(0, 10).join(', ')
            });
            continue;
          }

          // v3.7: Verificar que l'element té el mètode asText
          if (typeof targetElement.asText !== 'function') {
            editsSkipped++;
            logDiagnostic('EDIT_SKIP', {
              reason: 'ELEMENT_NOT_EDITABLE',
              target_id: id,
              element_type: targetElement.getType ? targetElement.getType().toString() : 'unknown'
            });
            continue;
          }

          const currentDocText = targetElement.asText().getText();
          // v10.1: Capturar heading original ABANS de modificar
          const originalHeading = getElementHeading(targetElement);
          // v12.0: Capturar format complet per undo
          const formatSnapshot = createFormatSnapshot(targetElement);

          // v2.6 Snapshot: Capturar ABANS de modificar (v12.0: inclou format)
          undoSnapshot = {
            targetId: id,
            originalText: currentDocText,
            originalHeading: originalHeading,  // v10.1
            bodyIndex: getBodyIndex(targetElement),  // v6.6: Per undo més fiable
            formatSnapshot: formatSnapshot  // v12.0: Per restaurar format
          };

          // v12.0: Aplicar edició amb preservació de format intel·ligent
          const formatPreserved = applyChangePreservingFormat(
            targetElement,
            currentDocText,
            newText,
            null  // No tenim word_changes en aquest flux
          );

          // Fallback a l'antic mètode si el nou falla
          if (!formatPreserved) {
            updateParagraphPreservingAttributes(targetElement, newText);
          }
          editsApplied++;

          // v3.7: Validar que l'edició s'ha aplicat correctament
          const newDocText = targetElement.asText().getText();
          const cleanNewText = cleanMarkdown(newText);
          if (newDocText !== cleanNewText) {
            logDiagnostic('EDIT_VALIDATION', {
              status: 'MISMATCH',
              target_id: id,
              expected_length: cleanNewText.length,
              actual_length: newDocText.length,
              expected_preview: cleanNewText.substring(0, 50),
              actual_preview: newDocText.substring(0, 50)
            });
          }

          // v2.6.1: Preservar originalText si editem el MATEIX paràgraf (cadena d'alternatives)
          // Si és un paràgraf diferent, comencem nova cadena amb l'actual com a original
          const isSameTarget = existingLastEdit &&
                               String(existingLastEdit.targetId) === String(id);
          const preservedOriginal = isSameTarget
                                    ? existingLastEdit.originalText
                                    : currentDocText;

          // v10.1: Preservar heading original si és el mateix target
          const preservedHeading = isSameTarget && existingLastEdit.originalHeading
                                   ? existingLastEdit.originalHeading
                                   : originalHeading;

          capturedLastEdit = {
            targetId: id,
            originalText: preservedOriginal,
            originalHeading: preservedHeading,  // v10.1
            currentText: cleanNewText,
            bodyIndex: getBodyIndex(targetElement)  // v6.6: Per undo més fiable
          };

          // v2.8: Extraure la primera paraula diferent per al botó "Prohibir"
          // Comparem paraules i trobem la primera diferència significant
          const oldWords = preservedOriginal.toLowerCase().split(/\s+/);
          const newWords = cleanNewText.toLowerCase().split(/\s+/);
          for (let i = 0; i < newWords.length; i++) {
            if (!oldWords.includes(newWords[i]) && newWords[i].length > 3) {
              lastEditWord = newWords[i];
              break;
            }
          }
        } catch (editError) {
          editsSkipped++;
          editErrors.push({ id, error: editError.message });
          logDiagnostic('EDIT_ERROR', {
            target_id: id,
            error: editError.message,
            stack: editError.stack ? editError.stack.substring(0, 200) : null
          });
        }
      }

      // v3.7: Log timing i estadístiques d'execució
      // v14.1: Usar v14Result.updates per el comptatge
      editDuration = Date.now() - editStartTime;
      logDiagnostic('EDIT_EXECUTION', {
        total_updates: Object.keys(v14Result.updates).length,
        edits_applied: editsApplied,
        edits_skipped: editsSkipped,
        edit_errors: editErrors.length,
        duration_ms: editDuration,
        v14_blocked: v14Result.blockedChanges.length,
        v14_stale: v14Result.staleChanges.length,
      });
      if (capturedLastEdit) {
        saveLastEdit(capturedLastEdit);
      }
    // v10.3: Branca explícita per REWRITE amb suport preview i undo
    } else if (aiData.mode === 'REWRITE' && aiData.blocks) {
      // Capturar contingut original ABANS de modificar (per preview i undo)
      let originalContent = '';
      if (isSelection && elementsToProcess.length > 0) {
        originalContent = elementsToProcess[0].asText().getText();
      } else {
        // Capturar tot el document
        const allElements = getEditableElements(body);
        originalContent = allElements.map(el => el.asText().getText()).join('\n');
      }

      const proposedContent = aiData.blocks.map(b => b.text).join('\n');

      // v10.3: PREVIEW MODE per REWRITE
      if (previewMode) {
        logDiagnostic('REWRITE_PREVIEW', {
          original_length: originalContent.length,
          proposed_length: proposedContent.length,
          blocks_count: aiData.blocks.length,
          is_selection: isSelection
        });

        return {
          ok: true,
          status: 'rewrite_preview',
          ai_response: aiData.change_summary,
          original_text: originalContent,
          proposed_text: proposedContent,
          blocks: aiData.blocks,
          is_selection: isSelection,
          credits: json.credits_remaining,
          mode: 'edit'
        };
      }

      // v10.3: Capturar undo snapshot ABANS d'aplicar REWRITE
      // v12.0: Incloure format snapshot per a seleccions
      let formatSnapshot = null;
      if (isSelection && elementsToProcess.length > 0) {
        formatSnapshot = createFormatSnapshot(elementsToProcess[0]);
      }

      undoSnapshot = {
        type: 'rewrite',
        originalText: originalContent,
        isSelection: isSelection,
        formatSnapshot: formatSnapshot  // v12.0
      };

      // Aplicar REWRITE
      if (isSelection && elementsToProcess.length > 0) {
        // v12.0: Usar rewritePreservingFormat per preservar format dominant
        const success = rewritePreservingFormat(elementsToProcess[0], proposedContent);
        if (!success) {
          // Fallback
          elementsToProcess[0].asText().setText(proposedContent);
        }
      } else {
        // Per documents complets, renderFullDocument és l'única opció
        // ja que reconstrueix l'estructura completa
        renderFullDocument(body, aiData.blocks);
      }

      // Guardar lastEdit per poder mostrar amb l'ull (v12.0: inclou formatSnapshot)
      saveLastEdit({
        type: 'rewrite',
        originalText: originalContent,
        currentText: proposedContent,
        isSelection: isSelection,
        formatSnapshot: formatSnapshot  // v12.0
      });

      logDiagnostic('REWRITE_APPLIED', {
        original_length: originalContent.length,
        new_length: proposedContent.length,
        is_selection: isSelection,
        format_preserved: true  // v12.0
      });

    } else {
      // Fallback genèric (no hauria d'arribar aquí normalment)
      logDiagnostic('WARNING', {
        issue: 'UNEXPECTED_FALLBACK',
        mode: aiData.mode,
        has_blocks: !!aiData.blocks,
        has_updates: !!aiData.updates
      });
      // v10.3.1: Guarda per evitar error si aiData.blocks és undefined
      if (aiData.blocks && Array.isArray(aiData.blocks)) {
        if (isSelection && elementsToProcess.length > 0) {
           // v12.0: Usar rewritePreservingFormat també al fallback
           const proposedText = aiData.blocks.map(b => b.text).join('\n');
           const success = rewritePreservingFormat(elementsToProcess[0], proposedText);
           if (!success) {
             elementsToProcess[0].asText().setText(proposedText);
           }
        } else {
           renderFullDocument(body, aiData.blocks);
        }
      } else {
        logDiagnostic('ERROR', {
          issue: 'FALLBACK_NO_BLOCKS',
          mode: aiData.mode
        });
      }
    }

    // v3.7: Log resposta EDIT aplicada
    // v14.1: Comptar updates del v14Result si existeix, sinó format antic
    // NOTA: v14Result només existeix per mode UPDATE_BY_ID
    const updatesApplied = (typeof v14Result !== 'undefined' && v14Result) ? Object.keys(v14Result.updates).length : (aiData.updates ? Object.keys(aiData.updates).length : 0);
    const responseInfo = {
      mode: aiData.mode,
      sub_mode: 'APPLIED',
      updates_applied: updatesApplied,
      has_undo_snapshot: !!undoSnapshot,
      credits_remaining: json.credits_remaining
    };
    metrics.setResponseInfo(responseInfo);
    logDiagnostic('RESPONSE', {
      mode: aiData.mode,
      sub_mode: 'APPLIED',
      updates: updatesApplied,
      doc_was_empty: isDocumentEmpty,
      user_wanted: userMode,
      last_edit_word: lastEditWord
    });
    metrics.finalize();

    // v3.7: Construir missatge de resposta millorat
    let enhancedResponse = aiData.change_summary;

    // v3.7: Afegir warnings si hi ha edicions saltades o errors
    if (editsSkipped > 0 || (editErrors && editErrors.length > 0)) {
      const warnings = [];
      if (editsSkipped > 0) {
        warnings.push(`${editsSkipped} element${editsSkipped > 1 ? 's' : ''} no s'ha${editsSkipped > 1 ? 'n' : ''} pogut modificar`);
      }
      if (editErrors && editErrors.length > 0) {
        warnings.push(`${editErrors.length} error${editErrors.length > 1 ? 's' : ''} durant l'edició`);
      }
      if (warnings.length > 0) {
        enhancedResponse += '\n\n⚠️ ' + warnings.join(', ') + '.';
      }
    }

    return {
      ok: true,
      ai_response: enhancedResponse,
      credits: json.credits_remaining,
      mode: 'edit',
      last_edit_word: lastEditWord, // v2.8: Per al botó "Prohibir"
      undo_snapshot: undoSnapshot,  // v2.6: Per Optimistic UI Undo
      // v3.7: Estadístiques d'execució
      // v14.1: Usar v14Result si existeix (només per UPDATE_BY_ID)
      edit_stats: {
        total_requested: (typeof v14Result !== 'undefined' && v14Result) ? Object.keys(v14Result.updates).length : (aiData.updates ? Object.keys(aiData.updates).length : 0),
        applied: editsApplied || 0,
        skipped: editsSkipped || 0,
        errors: editErrors ? editErrors.length : 0,
        duration_ms: editDuration || 0,
        v14_blocked: (typeof v14Result !== 'undefined' && v14Result) ? v14Result.blockedChanges.length : 0,
        v14_stale: (typeof v14Result !== 'undefined' && v14Result) ? v14Result.staleChanges.length : 0,
      },
      // v3.7: Diagnòstic
      _diag: {
        doc_chars: contentPayload.length,
        doc_empty: isDocumentEmpty,
        updates_applied: editsApplied || updatesApplied,
        invisible_elements: docStats.invisible.table + docStats.invisible.inline_image
      }
    };

  } catch (e) {
    // v3.7: Log errors
    metrics.addError(e.message);
    logDiagnostic('ERROR', {
      error: e.message,
      instruction_preview: instruction ? instruction.substring(0, 50) : null,
      doc_was_empty: typeof isDocumentEmpty !== 'undefined' ? isDocumentEmpty : 'unknown'
    });
    metrics.finalize();
    throw new Error("Error: " + e.message);
  }
}

// --- v3.2: APPLY PENDING CHANGES (Preview Mode) ---
/**
 * Aplica els canvis prèviament previsualitzats
 * @param {Array} changes - Array de {targetId, originalText, proposedText}
 * @returns {Object} {ok, applied, undoSnapshots, error}
 */
function applyPendingChanges(changes, expectedSnapshot) {
  try {
    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      return { ok: false, error: "No hi ha canvis per aplicar" };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    // v3.3: Verificar que el document no ha canviat (race condition detection)
    if (expectedSnapshot) {
      let currentSnapshot = '';
      let snapshotIdx = 0;
      for (const id of Object.keys(mapIdToElement).slice(0, 5)) {
        const el = mapIdToElement[id];
        const text = el.asText().getText();
        currentSnapshot += '{{' + id + '}} ' + text.substring(0, 100) + '\n';
        snapshotIdx++;
      }
      if (currentSnapshot !== expectedSnapshot) {
        return {
          ok: false,
          error: "El document ha canviat des de la previsualització. Sol·licita els canvis de nou."
        };
      }
    }

    const undoSnapshots = [];
    let appliedCount = 0;
    const existingLastEdit = loadLastEdit();

    for (const change of changes) {
      const targetId = parseInt(change.targetId, 10);
      const targetElement = mapIdToElement[targetId];

      if (targetElement) {
        const currentDocText = targetElement.asText().getText();
        // v10.1: Capturar heading original ABANS de modificar
        const originalHeading = getElementHeading(targetElement);
        // v12.0: Capturar format complet per undo
        const formatSnapshot = createFormatSnapshot(targetElement);

        // Guardar snapshot per undo (v12.0: inclou format complet)
        undoSnapshots.push({
          targetId: change.targetId,
          originalText: currentDocText,
          originalHeading: originalHeading,  // v10.1
          bodyIndex: getBodyIndex(targetElement),  // v6.6: Per undo més fiable
          formatSnapshot: formatSnapshot  // v12.0: Per restaurar format
        });

        // v12.0: Aplicar el canvi amb preservació de format intel·ligent
        const formatPreserved = applyChangePreservingFormat(
          targetElement,
          currentDocText,
          change.proposedText,
          change.word_changes  // Si el backend envia word_changes
        );

        // Fallback a l'antic mètode si el nou falla
        if (!formatPreserved) {
          updateParagraphPreservingAttributes(targetElement, change.proposedText);
        }
        appliedCount++;

        // Actualitzar lastEdit memory (per al primer canvi)
        if (appliedCount === 1) {
          const isSameTarget = existingLastEdit &&
                               String(existingLastEdit.targetId) === String(change.targetId);
          const preservedOriginal = isSameTarget
                                    ? existingLastEdit.originalText
                                    : currentDocText;
          // v10.1: Preservar heading original
          const preservedHeading = isSameTarget && existingLastEdit.originalHeading
                                   ? existingLastEdit.originalHeading
                                   : originalHeading;

          saveLastEdit({
            targetId: change.targetId,
            originalText: preservedOriginal,
            originalHeading: preservedHeading,  // v10.1
            currentText: change.proposedText,
            bodyIndex: getBodyIndex(targetElement)  // v6.6: Per undo més fiable
          });
        }
      }
    }

    // v8.2: Invalidar cache després d'aplicar canvis
    invalidateCaptureCache();

    return {
      ok: true,
      applied: appliedCount,
      undoSnapshots: undoSnapshots
    };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// --- v11.0: APPLY SINGLE CHANGE (Individual change acceptance) ---
/**
 * Aplica un sol canvi individual
 * @param {Object} change - {targetId, originalText, proposedText}
 * @returns {Object} {ok, undoSnapshot, error}
 */
function applySingleChange(change) {
  try {
    if (!change || change.targetId === undefined) {
      return { ok: false, error: "Canvi invàlid" };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    const targetId = parseInt(change.targetId, 10);
    const targetElement = mapIdToElement[targetId];

    if (!targetElement) {
      return { ok: false, error: "Paràgraf no trobat: " + targetId };
    }

    const currentDocText = targetElement.asText().getText();

    // Verificar que el text original coincideix (protecció race condition)
    if (change.originalText && currentDocText !== change.originalText) {
      return {
        ok: false,
        error: "El document ha canviat. Actualitza i torna a provar.",
        mismatch: true
      };
    }

    // Capturar heading original
    const originalHeading = getElementHeading(targetElement);
    // v12.0: Capturar format complet per undo
    const formatSnapshot = createFormatSnapshot(targetElement);

    // Guardar snapshot per undo (v12.0: inclou format complet)
    const undoSnapshot = {
      targetId: change.targetId,
      originalText: currentDocText,
      originalHeading: originalHeading,
      bodyIndex: getBodyIndex(targetElement),
      formatSnapshot: formatSnapshot  // v12.0: Per restaurar format
    };

    // v12.0: Aplicar el canvi amb preservació de format intel·ligent
    const formatPreserved = applyChangePreservingFormat(
      targetElement,
      currentDocText,
      change.proposedText,
      change.word_changes  // Si el backend envia word_changes
    );

    // Fallback a l'antic mètode si el nou falla
    if (!formatPreserved) {
      updateParagraphPreservingAttributes(targetElement, change.proposedText);
    }

    // Actualitzar lastEdit memory
    saveLastEdit({
      targetId: change.targetId,
      originalText: currentDocText,
      originalHeading: originalHeading,
      currentText: change.proposedText,
      bodyIndex: getBodyIndex(targetElement)
    });

    // Invalidar cache
    invalidateCaptureCache();

    // v16.4: Highlight temporal NOMÉS del fragment canviat
    try {
      const APPLIED_HIGHLIGHT_COLOR = '#D4EDDA';  // Verd suau (success)
      const textObj = targetElement.asText();
      const newText = textObj.getText();

      // Trobar el fragment que ha canviat comparant original i nou
      const diff = findTextDiff(currentDocText, newText);
      if (diff && diff.start >= 0 && diff.end > diff.start) {
        textObj.setBackgroundColor(diff.start, diff.end - 1, APPLIED_HIGHLIGHT_COLOR);
      } else if (newText.length > 0) {
        // Fallback: si no podem trobar la diferència, marcar primeres paraules
        const words = newText.split(/\s+/).slice(0, 3).join(' ');
        const endPos = Math.min(words.length - 1, newText.length - 1);
        if (endPos >= 0) {
          textObj.setBackgroundColor(0, endPos, APPLIED_HIGHLIGHT_COLOR);
        }
      }
    } catch (highlightErr) {
      // No fallar si el highlight no funciona
      console.warn('[applySingleChange] Highlight error:', highlightErr);
    }

    return {
      ok: true,
      applied: 1,
      undoSnapshot: undoSnapshot,
      highlightApplied: true  // v15.4: Indicar que s'ha aplicat highlight
    };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// --- v12.1: APPLY FIND/REPLACE CHANGES (FIX mode - native format preservation) ---
/**
 * Aplica canvis usant replaceText() natiu que preserva format automàticament.
 * Optimitzat per mode FIX on només es canvien errors ortogràfics/tipogràfics.
 *
 * @param {Array} changes - Array de {targetId, find, replace, context?}
 *   - find: text exacte a trobar (amb context si cal per unicitat)
 *   - replace: text de reemplaçament
 *   - context: objecte opcional {before, after} per verificar unicitat
 * @returns {Object} {ok, applied, skipped, undoSnapshots, error}
 */
function applyFindReplaceChanges(changes) {
  try {
    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      return { ok: false, error: "No hi ha canvis per aplicar" };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    const undoSnapshots = [];
    let appliedCount = 0;
    let skippedCount = 0;

    for (const change of changes) {
      const targetId = parseInt(change.targetId, 10);
      const targetElement = mapIdToElement[targetId];

      // v17.5 DEBUG: Log per diagnosticar problemes d'indexació
      console.log('[applyFindReplaceChanges] targetId=' + targetId + ', found=' + !!targetElement + ', mapKeys=' + Object.keys(mapIdToElement).join(','));

      if (!targetElement) {
        console.warn('[applyFindReplaceChanges] Element NOT FOUND for targetId=' + targetId);
        skippedCount++;
        continue;
      }

      const text = targetElement.asText();
      const currentText = text.getText();

      // v17.3: Lògica de decisió robusta per modes find/replace vs full-replace
      // IMPORTANT: replace pot ser string buit "" (eliminar text) - això és VÀLID!
      const hasFind = change.find !== null && change.find !== undefined && change.find !== '';
      const hasReplace = change.replace !== null && change.replace !== undefined;  // "" és vàlid!
      const hasOriginalText = change.original_text && change.original_text.length > 0;
      const hasNewText = change.new_text !== null && change.new_text !== undefined;  // "" és vàlid!

      // v17.41: Debug exhaustiu per diagnosticar problemes d'eliminació
      console.log('[applyFindReplaceChanges] v17.41 DEBUG - change object:', JSON.stringify(change).substring(0, 300));
      console.log('[applyFindReplaceChanges] v17.41 DEBUG - hasFind=' + hasFind + ', hasReplace=' + hasReplace + ', hasOriginalText=' + hasOriginalText + ', hasNewText=' + hasNewText);
      console.log('[applyFindReplaceChanges] v17.41 DEBUG - original_text type: ' + typeof change.original_text + ', new_text type: ' + typeof change.new_text);

      // Prioritat 1: Mode find/replace (correccions atòmiques - mode FIX)
      // v17.33: Només entrar si find existeix al text actual
      // v17.40: Cerca més tolerant - normalitzar espais
      let findExistsInText = hasFind && hasReplace && currentText.includes(change.find);
      let actualFind = change.find;  // El que realment usarem per cercar

      // v17.40: Si no es troba exacte, provar amb normalització d'espais
      if (hasFind && hasReplace && !findExistsInText) {
        const normalizeSpaces = (s) => s.replace(/\s+/g, ' ').trim();
        const normalizedFind = normalizeSpaces(change.find);
        const normalizedCurrent = normalizeSpaces(currentText);

        if (normalizedCurrent.includes(normalizedFind)) {
          console.log('[applyFindReplaceChanges] v17.40 - Found with normalized spaces');
          // Trobar la posició al text normalitzat i reconstruir el find real
          const pos = normalizedCurrent.indexOf(normalizedFind);
          // Usar el text normalitzat per la cerca
          findExistsInText = true;
          // Però necessitem trobar el text real al document
          // Usar regex flexible per espais
          const regexPattern = change.find.split(/\s+/).map(escapeRegExp).join('\\s+');
          const regex = new RegExp(regexPattern);
          const match = currentText.match(regex);
          if (match) {
            actualFind = match[0];  // El text real trobat
            console.log('[applyFindReplaceChanges] v17.40 - Real match: "' + actualFind + '"');
          }
        }
      }

      console.log('[applyFindReplaceChanges] MODE CHECK - targetId=' + targetId + ', hasFind=' + hasFind + ', hasReplace=' + hasReplace + ', findExistsInText=' + findExistsInText);
      if (hasFind && !findExistsInText) {
        console.log('[applyFindReplaceChanges] v17.40 DEBUG - find NOT in text');
        console.log('[applyFindReplaceChanges] v17.40 DEBUG - find: "' + change.find + '"');
        console.log('[applyFindReplaceChanges] v17.40 DEBUG - currentText: "' + currentText.substring(0, 100) + '..."');
      }

      if (findExistsInText) {
        console.log('[applyFindReplaceChanges] MODE FIX - find="' + actualFind + '"');

        // Guardar snapshot per undo ABANS del canvi
        // v17.47: Afegir find/replace per permetre undo atòmic (no restaurar tot el paràgraf)
        const snapshot = {
          targetId: change.targetId,
          originalText: currentText,
          bodyIndex: getBodyIndex(targetElement),
          highlight_find: change.highlight_find || actualFind || null,
          // v17.47: Per undo atòmic MODE FIX
          mode: 'fix',
          find: actualFind,
          replace: change.replace
        };
        undoSnapshots.push(snapshot);
        console.log('[applyFindReplaceChanges] FIX - Created undoSnapshot:', JSON.stringify(snapshot).substring(0, 200));

        // MAGIC: replaceText() natiu preserva el format automàticament!
        // v17.40: Usar actualFind (pot ser diferent de change.find si s'han normalitzat espais)
        text.replaceText(escapeRegExp(actualFind), change.replace);
        appliedCount++;

        // v17.3: Highlight PRECÍS després d'aplicar
        try {
          const APPLIED_HIGHLIGHT_COLOR = '#D4EDDA';  // Verd suau
          const newText = text.getText();
          const textLen = newText.length;

          // PRIMER: Netejar TOT el highlight del paràgraf
          if (textLen > 0) {
            text.setBackgroundColor(0, textLen - 1, null);
          }

          // DESPRÉS: Afegir highlight verd NOMÉS a la paraula canviada
          const textToHighlight = change.highlight_replace || change.replace;
          if (textToHighlight && textToHighlight.length > 0) {
            const highlightPos = newText.indexOf(textToHighlight);
            if (highlightPos !== -1) {
              text.setBackgroundColor(highlightPos, highlightPos + textToHighlight.length - 1, APPLIED_HIGHLIGHT_COLOR);
            }
          }
        } catch (highlightErr) {
          console.warn('[applyFindReplaceChanges] Highlight error:', highlightErr);
        }

        continue;  // Processat - següent canvi
      }
      // v17.33: Si find/replace existeix però find NO es troba al text, deixar que caigui al mode IMPROVE

      // Prioritat 2: Mode full-replace (paràgraf complet - mode IMPROVE)
      if (hasOriginalText && hasNewText) {
        console.log('[applyFindReplaceChanges] MODE IMPROVE - targetId=' + targetId);
        console.log('[applyFindReplaceChanges] original_text: "' + change.original_text.substring(0, 60) + '..."');
        console.log('[applyFindReplaceChanges] currentText: "' + currentText.substring(0, 60) + '..."');

        // v17.35: STALE check relaxat - confiar en l'usuari ja que ha vist i acceptat el canvi
        // Normalització agressiva per ignorar diferències menors
        const normalizeAggressive = (t) => t.trim()
          .replace(/\s+/g, ' ')  // Espais múltiples a un sol espai
          .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')  // Caràcters invisibles
          .replace(/\r\n/g, '\n')  // Normalitzar salts de línia
          .toLowerCase();

        const normalizedCurrent = normalizeAggressive(currentText);
        const normalizedOriginal = normalizeAggressive(change.original_text);

        // v17.35: Check de similitud - si el 90% del text coincideix, acceptar
        const minLen = Math.min(normalizedCurrent.length, normalizedOriginal.length);
        const maxLen = Math.max(normalizedCurrent.length, normalizedOriginal.length);
        const lengthRatio = maxLen > 0 ? minLen / maxLen : 1;

        // Comparar prefix comú
        let commonPrefix = 0;
        while (commonPrefix < minLen && normalizedCurrent[commonPrefix] === normalizedOriginal[commonPrefix]) {
          commonPrefix++;
        }
        const prefixRatio = maxLen > 0 ? commonPrefix / maxLen : 1;

        // v17.42: Skip STALE check per eliminacions (new_text === "")
        // Si l'usuari vol eliminar un paràgraf, la ràtio serà 0 però és vàlid!
        const isDeletion = change.new_text === '';

        // v17.42: Per eliminacions, validar que original_text coincideixi amb currentText (>70% similitud)
        let deletionValid = true;
        if (isDeletion) {
          // Per eliminacions, el prefixRatio és entre original_text i currentText
          deletionValid = prefixRatio >= 0.7;  // 70% mínim de coincidència
          console.log('[applyFindReplaceChanges] v17.42 DELETION - prefixRatio=' + prefixRatio.toFixed(2) + ', valid=' + deletionValid);
        }

        const isStale = isDeletion ? !deletionValid : (lengthRatio < 0.8 || prefixRatio < 0.7);

        console.log('[applyFindReplaceChanges] v17.42 STALE CHECK - isDeletion=' + isDeletion + ', isStale=' + isStale + ', lengthRatio=' + lengthRatio.toFixed(2) + ', prefixRatio=' + prefixRatio.toFixed(2));

        if (isStale) {
          console.warn('[applyFindReplaceChanges] v17.35 STALE - text ha canviat massa, targetId=' + targetId);
          console.warn('[applyFindReplaceChanges] normalizedOriginal: "' + normalizedOriginal.substring(0, 60) + '..."');
          console.warn('[applyFindReplaceChanges] normalizedCurrent: "' + normalizedCurrent.substring(0, 60) + '..."');
          // v17.35: IMPORTANT - Encara creem l'undoSnapshot per permetre undo encara que sigui STALE
          // Però mostrem warning i NO apliquem el canvi automàticament
          skippedCount++;
          continue;
        }

        // Guardar snapshot per undo ABANS del canvi
        const snapshot = {
          targetId: change.targetId,
          originalText: currentText,
          bodyIndex: getBodyIndex(targetElement),
          highlight_find: change.highlight_find || null
        };
        undoSnapshots.push(snapshot);
        console.log('[applyFindReplaceChanges] IMPROVE - Created undoSnapshot for targetId=' + targetId);

        // Substituir tot el paràgraf
        text.setText(change.new_text);
        appliedCount++;

        // Highlight per full-replace
        try {
          const APPLIED_HIGHLIGHT_COLOR = '#D4EDDA';
          const newText = text.getText();
          const textLen = newText.length;

          // PRIMER: Netejar TOT el highlight
          if (textLen > 0) {
            text.setBackgroundColor(0, textLen - 1, null);
          }

          // DESPRÉS: Ressaltar el fragment canviat
          const toHighlight = change.highlight_replace;
          if (toHighlight && toHighlight.length > 0) {
            const pos = newText.indexOf(toHighlight);
            if (pos !== -1) {
              text.setBackgroundColor(pos, pos + toHighlight.length - 1, APPLIED_HIGHLIGHT_COLOR);
            }
          }
        } catch (e) {}

        continue;  // Processat - següent canvi
      }

      // Fallback: Intentar amb original/replacement
      if (change.original && (change.replacement !== null && change.replacement !== undefined)) {
        if (!currentText.includes(change.original)) {
          skippedCount++;
          continue;
        }

        undoSnapshots.push({
          targetId: change.targetId,
          originalText: currentText,
          bodyIndex: getBodyIndex(targetElement),
          highlight_find: change.original
        });

        text.replaceText(escapeRegExp(change.original), change.replacement);
        appliedCount++;

        try {
          const newText = text.getText();
          const textLen = newText.length;
          if (textLen > 0) {
            text.setBackgroundColor(0, textLen - 1, null);
          }
          if (change.replacement && change.replacement.length > 0) {
            const pos = newText.indexOf(change.replacement);
            if (pos !== -1) {
              text.setBackgroundColor(pos, pos + change.replacement.length - 1, '#D4EDDA');
            }
          }
        } catch (e) {}

        continue;
      }

      // Cap mode vàlid - saltar
      skippedCount++;
    }

    // Invalidar cache
    invalidateCaptureCache();

    // v17.42: Debug - retornar info del primer canvi per diagnosticar
    const debugInfo = changes.length > 0 ? {
      first_change_keys: Object.keys(changes[0]),
      has_original_text: changes[0].original_text !== undefined,
      has_new_text: changes[0].new_text !== undefined,
      new_text_value: changes[0].new_text,
      new_text_type: typeof changes[0].new_text,
      new_text_is_empty_string: changes[0].new_text === ''
    } : null;

    return {
      ok: true,
      applied: appliedCount,
      skipped: skippedCount,
      _debug_v17_42: debugInfo,
      undoSnapshots: undoSnapshots,
      highlightApplied: appliedCount > 0  // v15.4
    };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * v16.1: Desfer un canvi aplicat anteriorment
 * Restaura el text original al paràgraf corresponent
 * @param {Object} snapshot - {targetId, originalText, bodyIndex}
 * @returns {Object} {ok, error}
 */
function undoAnnotationChange(snapshot) {
  try {
    if (!snapshot || (!snapshot.originalText && !snapshot.mode)) {
      return { ok: false, error: "Snapshot invàlid" };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    const targetId = parseInt(snapshot.targetId, 10);
    const targetElement = mapIdToElement[targetId];

    if (!targetElement) {
      return { ok: false, error: "No s'ha trobat el paràgraf original" };
    }

    const textObj = targetElement.asText();

    // v17.48: MODE FIX - fer find/replace invers (atòmic, no afecta altres canvis)
    if (snapshot.mode === 'fix' && snapshot.find && snapshot.replace !== undefined) {
      console.log('[undoAnnotationChange] v17.48 MODE FIX - replace invers: "' + snapshot.replace + '" → "' + snapshot.find + '"');
      const currentText = textObj.getText();
      console.log('[undoAnnotationChange] v17.48 - currentText length:', currentText.length, 'replace length:', snapshot.replace.length);
      console.log('[undoAnnotationChange] v17.48 - currentText preview:', currentText.substring(0, 100));

      // v17.48: Verificar que el replace existeix al text actual (amb fallback a originalText)
      const replaceExists = currentText.includes(snapshot.replace);
      console.log('[undoAnnotationChange] v17.48 - replaceExists:', replaceExists);

      if (!replaceExists) {
        console.warn('[undoAnnotationChange] v17.48 - replace text not found, falling back to MODE IMPROVE');
        // Fallback: restaurar tot el paràgraf si tenim originalText
        if (snapshot.originalText) {
          console.log('[undoAnnotationChange] v17.48 - using originalText fallback');
          textObj.setText(snapshot.originalText);
          invalidateCaptureCache();
          return { ok: true, targetId: targetId, fallback: true };
        }
        return { ok: false, error: "Text ja modificat, no es pot desfer" };
      }

      // Fer el reemplaçament invers (replace → find)
      textObj.replaceText(escapeRegExp(snapshot.replace), snapshot.find);

      // Highlight el text restaurat
      try {
        const UNDO_HIGHLIGHT_COLOR = '#FFF3CD';
        const newText = textObj.getText();
        const pos = newText.indexOf(snapshot.find);
        if (pos !== -1) {
          textObj.setBackgroundColor(pos, pos + snapshot.find.length - 1, UNDO_HIGHLIGHT_COLOR);
        }
      } catch (e) {}

      invalidateCaptureCache();
      return { ok: true, targetId: targetId };
    }

    // MODE IMPROVE (paràgraf complet) - restaurar tot el text original
    console.log('[undoAnnotationChange] MODE IMPROVE - restaurar paràgraf complet');
    textObj.setText(snapshot.originalText);

    // v17.2: Highlight PRECÍS per undo
    try {
      const UNDO_HIGHLIGHT_COLOR = '#FFF3CD';  // Groc suau
      const restoredText = textObj.getText();
      const textLen = restoredText.length;

      // PRIMER: Netejar TOT el highlight del paràgraf
      if (textLen > 0) {
        textObj.setBackgroundColor(0, textLen - 1, null);
      }

      // DESPRÉS: Ressaltar NOMÉS el text restaurat
      const textToHighlight = snapshot.highlight_find;
      if (textToHighlight && textToHighlight.length > 0) {
        const pos = restoredText.indexOf(textToHighlight);
        if (pos !== -1) {
          const endPos = pos + textToHighlight.length - 1;
          textObj.setBackgroundColor(pos, endPos, UNDO_HIGHLIGHT_COLOR);
        }
      }
    } catch (highlightErr) {
      // No fallar si el highlight no funciona
    }

    // Invalidar cache
    invalidateCaptureCache();

    // v16.7: Retornar targetId per poder netejar el highlight després
    return { ok: true, targetId: targetId };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Escapa caràcters especials per usar en RegExp
 * @param {string} string
 * @returns {string}
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * v16.4: Troba el fragment que difereix entre dos textos
 * Retorna {start, end} del fragment NOU (en newText)
 * @param {string} oldText - Text original
 * @param {string} newText - Text nou
 * @returns {Object|null} - {start, end} o null si no hi ha diferència
 */
function findTextDiff(oldText, newText) {
  if (!oldText || !newText || oldText === newText) return null;

  // Trobar prefix comú
  let prefixLen = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }

  // Trobar suffix comú
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  // El fragment canviat és entre prefix i (length - suffix)
  const start = prefixLen;
  const end = newText.length - suffixLen;

  // Validar que tenim un rang vàlid
  if (end <= start) return null;

  return { start, end };
}

// ═══════════════════════════════════════════════════════════════════════════
// IN-DOCUMENT PREVIEW v3.8 - Track Changes Style
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Colors per la previsualització in-document
 */
const PREVIEW_COLORS = {
  DELETE_BG: '#FFCDD2',      // Vermell clar (fons text a eliminar)
  DELETE_TEXT: '#B71C1C',    // Vermell fosc (text a eliminar)
  ADD_BG: '#C8E6C9',         // Verd clar (fons text nou)
  ADD_TEXT: '#1B5E20'        // Verd fosc (text nou)
};

// v7.0: Colors per Reference Highlighting
const REFERENCE_COLORS = {
  yellow: '#FFF59D',   // Atenció / Repeticions
  orange: '#FFCC80',   // Problemes d'estil
  blue: '#90CAF9',     // Recomanacions
  purple: '#CE93D8',   // Preguntes / Clarificacions
  // v17.46: Colors per preview de canvis
  lightBlue: '#D6EAF8',  // Blau molt clar - text ABANS del canvi (original)
  lightGreen: '#D4EDDA'  // Verd molt clar - text DESPRÉS del canvi (acceptat)
};

/**
 * Aplica preview visual al document (estil Track Changes)
 * - Text original: fons vermell + ratllat
 * - Text nou: fons verd + subratllat
 *
 * @param {Array} changes - Array de {targetId, originalText, proposedText}
 * @param {Object} existingMap - Mapa ID->Element opcional (per mantenir consistència amb seleccions)
 * @returns {Object} { ok, previews, error }
 */
function applyInDocumentPreview(changes, existingMap) {
  try {
    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      return { ok: false, error: "No hi ha canvis per previsualitzar" };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v17.6: Usar mapa existent si es proporciona (per seleccions), sinó reconstruir amb buildElementIndexMap
    const mapIdToElement = existingMap || buildElementIndexMap(body).map;
    const previews = [];

    for (const change of changes) {
      const targetId = parseInt(change.targetId, 10);
      const targetElement = mapIdToElement[targetId];

      if (!targetElement) {
        console.log('[Preview] Element not found:', targetId);
        continue;
      }

      const textObj = targetElement.editAsText();
      const originalText = textObj.getText();
      const cleanNewText = cleanMarkdown(change.proposedText || '');

      // Evitar preview si són iguals
      if (originalText.trim() === cleanNewText.trim()) {
        console.log('[Preview] No changes for:', targetId);
        continue;
      }

      // v5.3: Obtenir l'índex real de l'element dins del body per commit posterior
      let bodyIndex = -1;
      try {
        const parent = targetElement.getParent();
        if (parent && parent.getType() === DocumentApp.ElementType.BODY_SECTION) {
          bodyIndex = parent.getChildIndex(targetElement);
        }
      } catch (e) {
        console.log('[Preview] Could not get body index:', e.message);
      }

      const originalLength = originalText.length;

      // 1. Afegir separador i text nou al final
      const separator = '  →  ';
      textObj.appendText(separator + cleanNewText);

      // 2. Formatar text ORIGINAL com "a eliminar" (només sombreig vermell)
      if (originalLength > 0) {
        textObj.setBackgroundColor(0, originalLength - 1, PREVIEW_COLORS.DELETE_BG);
        textObj.setForegroundColor(0, originalLength - 1, PREVIEW_COLORS.DELETE_TEXT);
      }

      // 3. Formatar text NOU com "a afegir" (només sombreig verd)
      const newStart = originalLength + separator.length;
      const newEnd = newStart + cleanNewText.length - 1;
      if (newEnd >= newStart) {
        textObj.setBackgroundColor(newStart, newEnd, PREVIEW_COLORS.ADD_BG);
        textObj.setForegroundColor(newStart, newEnd, PREVIEW_COLORS.ADD_TEXT);
      }

      previews.push({
        targetId: String(targetId),
        originalText: originalText,
        newText: cleanNewText,
        newTextRaw: change.proposedText || '',  // v10.1: Text amb markdown per detectar heading al commit
        originalLength: originalLength,
        separatorLength: separator.length,
        bodyIndex: bodyIndex  // v5.3: Índex real dins el body
      });
    }

    if (previews.length === 0) {
      return { ok: false, error: "Cap canvi aplicable trobat" };
    }

    // Guardar l'estat del preview per poder fer commit/cancel
    savePendingInDocPreview(previews);

    return {
      ok: true,
      previews: previews,
      count: previews.length
    };

  } catch (e) {
    console.error('[Preview Error]', e);
    return { ok: false, error: e.message };
  }
}

/**
 * Confirma els canvis del preview (elimina text original, neteja formatació)
 *
 * @returns {Object} { ok, applied, error }
 */
function commitInDocumentPreview() {
  try {
    const previews = loadPendingInDocPreview();
    if (!previews || previews.length === 0) {
      return { ok: false, error: "No hi ha preview pendent" };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v17.6: Construir mapa usant buildElementIndexMap per consistència
    const { map: mapIdToElement } = buildElementIndexMap(body);

    // v5.3: Crear mapa alternatiu usant bodyIndex per seleccions
    const hasBodyIndices = previews.some(p => p.bodyIndex !== undefined && p.bodyIndex >= 0);

    let applied = 0;
    const existingLastEdit = loadLastEdit();

    // Processar en ordre INVERS per no afectar índexs
    for (let i = previews.length - 1; i >= 0; i--) {
      const preview = previews[i];

      // v5.3: Usar bodyIndex si disponible, sinó fallback a targetId
      let targetElement = null;
      if (hasBodyIndices && preview.bodyIndex !== undefined && preview.bodyIndex >= 0) {
        try {
          targetElement = body.getChild(preview.bodyIndex);
        } catch (e) {
          console.log('[Commit] Could not get element by bodyIndex:', preview.bodyIndex, e.message);
        }
      }

      // Fallback: usar el mapa tradicional
      if (!targetElement) {
        const targetId = parseInt(preview.targetId, 10);
        targetElement = mapIdToElement[targetId];
      }

      if (!targetElement) continue;

      const textObj = targetElement.editAsText();
      // v10.1: Capturar heading original ABANS de modificar
      const originalHeading = getElementHeading(targetElement);

      // Eliminar: text original + separador (deixant només el text nou)
      const deleteEnd = preview.originalLength + preview.separatorLength - 1;
      if (deleteEnd >= 0) {
        textObj.deleteText(0, deleteEnd);
      }

      // Netejar formatació del text que queda (el nou)
      const remainingLength = textObj.getText().length;
      if (remainingLength > 0) {
        textObj.setBackgroundColor(0, remainingLength - 1, null);
        textObj.setUnderline(0, remainingLength - 1, false);
        textObj.setForegroundColor(0, remainingLength - 1, null);
        textObj.setStrikethrough(0, remainingLength - 1, false);
      }

      // v10.1: Detectar i aplicar heading del markdown original
      const rawText = preview.newTextRaw || preview.newText;
      const headingInfo = detectHeadingFromMarkdown(rawText);
      if (headingInfo && targetElement.setHeading) {
        targetElement.setHeading(headingInfo.heading);
        applyHeadingSpacing(targetElement, headingInfo.heading);
      }

      // v10.1: Aplicar markdown inline (bold, italic) si hi ha text raw
      if (rawText && remainingLength > 0) {
        applyInlineMarkdown(targetElement, rawText);
      }

      applied++;

      // Guardar lastEdit per al primer canvi
      if (i === 0) {
        const isSameTarget = existingLastEdit &&
                             String(existingLastEdit.targetId) === String(preview.targetId);
        const preservedOriginal = isSameTarget
                                  ? existingLastEdit.originalText
                                  : preview.originalText;
        // v10.1: Preservar heading original
        const preservedHeading = isSameTarget && existingLastEdit.originalHeading
                                 ? existingLastEdit.originalHeading
                                 : originalHeading;

        saveLastEdit({
          targetId: preview.targetId,
          originalText: preservedOriginal,
          originalHeading: preservedHeading,  // v10.1
          currentText: preview.newText,
          bodyIndex: preview.bodyIndex !== undefined ? preview.bodyIndex : getBodyIndex(targetElement)  // v6.6
        });
      }
    }

    // Netejar preview pendent
    clearPendingInDocPreview();

    // v10.2: Retornar lastEdit per permetre desfer des del frontend
    const lastEdit = loadLastEdit();

    return {
      ok: true,
      applied: applied,
      message: `${applied} canvi${applied !== 1 ? 's' : ''} aplicat${applied !== 1 ? 's' : ''}`,
      // v10.2: Info per botó Desfer
      undo_available: !!lastEdit,
      undo_snapshot: lastEdit ? {
        targetId: lastEdit.targetId,
        originalText: lastEdit.originalText,
        originalHeading: lastEdit.originalHeading,
        bodyIndex: lastEdit.bodyIndex
      } : null
    };

  } catch (e) {
    console.error('[Commit Preview Error]', e);
    return { ok: false, error: e.message };
  }
}

/**
 * Cancel·la el preview (elimina text nou, restaura formatació original)
 *
 * @returns {Object} { ok, cancelled, error }
 */
function cancelInDocumentPreview() {
  try {
    const previews = loadPendingInDocPreview();
    if (!previews || previews.length === 0) {
      return { ok: false, error: "No hi ha preview pendent" };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v17.6: Construir mapa usant buildElementIndexMap per consistència
    const { map: mapIdToElement } = buildElementIndexMap(body);
    const hasBodyIndices = previews.some(p => p.bodyIndex !== undefined && p.bodyIndex >= 0);

    let cancelled = 0;

    for (const preview of previews) {
      // v5.3: Usar bodyIndex si disponible, sinó fallback a targetId
      let targetElement = null;
      if (hasBodyIndices && preview.bodyIndex !== undefined && preview.bodyIndex >= 0) {
        try {
          targetElement = body.getChild(preview.bodyIndex);
        } catch (e) {
          console.log('[Cancel] Could not get element by bodyIndex:', preview.bodyIndex, e.message);
        }
      }

      // Fallback: usar el mapa tradicional
      if (!targetElement) {
        const targetId = parseInt(preview.targetId, 10);
        targetElement = mapIdToElement[targetId];
      }

      if (!targetElement) continue;

      const textObj = targetElement.editAsText();
      const fullText = textObj.getText();

      // Eliminar: separador + text nou (deixant només l'original)
      const deleteStart = preview.originalLength;
      const deleteEnd = fullText.length - 1;

      if (deleteEnd >= deleteStart) {
        textObj.deleteText(deleteStart, deleteEnd);
      }

      // Netejar formatació del text original
      if (preview.originalLength > 0) {
        textObj.setBackgroundColor(0, preview.originalLength - 1, null);
        textObj.setStrikethrough(0, preview.originalLength - 1, false);
        textObj.setForegroundColor(0, preview.originalLength - 1, null);
      }

      cancelled++;
    }

    // Netejar preview pendent
    clearPendingInDocPreview();

    return {
      ok: true,
      cancelled: cancelled,
      message: "Preview cancel·lat"
    };

  } catch (e) {
    console.error('[Cancel Preview Error]', e);
    return { ok: false, error: e.message };
  }
}

/**
 * v9.4: Força la neteja de qualsevol preview orfe al document
 * Elimina colors i text afegit (després de " → ")
 */
function forceCleanPreview() {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const numChildren = body.getNumChildren();
    const separator = '  →  ';
    let cleaned = 0;

    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      const elementType = child.getType();

      if (elementType === DocumentApp.ElementType.PARAGRAPH ||
          elementType === DocumentApp.ElementType.LIST_ITEM) {
        try {
          const textObj = child.editAsText();
          const text = textObj.getText();

          // Buscar el separador del preview
          const sepIndex = text.indexOf(separator);
          if (sepIndex > 0) {
            // Eliminar des del separador fins al final
            textObj.deleteText(sepIndex, text.length - 1);
            cleaned++;
          }

          // Netejar colors de fons i text (vermell/verd del preview)
          const currentText = textObj.getText();
          if (currentText.length > 0) {
            textObj.setBackgroundColor(0, currentText.length - 1, null);
            textObj.setForegroundColor(0, currentText.length - 1, null);
          }
        } catch (e) {
          // Element sense text o error - continuar
        }
      }
    }

    // Netejar també l'estat del preview pendent
    clearPendingInDocPreview();

    return {
      ok: true,
      cleaned: cleaned,
      message: cleaned > 0 ?
        'Netejats ' + cleaned + ' paràgraf' + (cleaned !== 1 ? 's' : '') :
        'Document net (no s\'han trobat previews)'
    };

  } catch (e) {
    console.error('[Force Clean Preview Error]', e);
    return { ok: false, error: e.message };
  }
}

/**
 * Construeix el mapa ID -> Element del document
 * v6.6: Unificat amb processElement() per evitar desincronització d'IDs
 *
 * IMPORTANT: Ha de comptar elements en el MATEIX ordre que processElement()
 * per garantir que els IDs coincideixin quan hi ha taules/imatges/etc.
 */
function buildElementMap(body) {
  const mapIdToElement = {};
  const numChildren = body.getNumChildren();
  let currentIndex = 0;

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    const elementType = child.getType();

    switch (elementType) {
      case DocumentApp.ElementType.PARAGRAPH:
      case DocumentApp.ElementType.LIST_ITEM:
        // Elements editables: afegir al mapa SI tenen contingut
        try {
          const text = child.asText().getText();
          if (text.trim().length > 0) {
            mapIdToElement[currentIndex] = child;
            mapIdToElement[currentIndex]._bodyIndex = i; // v6.6: Guardar índex real
            currentIndex++;
          }
        } catch (e) {
          // Element sense text vàlid, saltar
        }
        break;

      case DocumentApp.ElementType.TABLE:
        // Taules: incrementar només si tenen contingut (igual que processElement)
        try {
          const table = child.asTable();
          if (table && table.getNumRows() > 0) {
            currentIndex++;
          }
        } catch (e) {
          currentIndex++; // En cas de dubte, incrementar
        }
        break;

      case DocumentApp.ElementType.TABLE_OF_CONTENTS:
        // TOC: incrementar només si té contingut (igual que processElement)
        try {
          const tocText = child.asTableOfContents().getText();
          if (tocText && tocText.trim()) {
            currentIndex++;
          }
        } catch (e) {
          currentIndex++; // En cas de dubte, incrementar
        }
        break;

      case DocumentApp.ElementType.INLINE_IMAGE:
      case DocumentApp.ElementType.INLINE_DRAWING:
        // Imatges i dibuixos: sempre incrementen (igual que processElement)
        currentIndex++;
        break;

      case DocumentApp.ElementType.HORIZONTAL_RULE:
        // Regles horitzontals: NO incrementen el comptador (igual que processElement)
        break;

      default:
        // Altres elements: ignorar completament
        break;
    }
  }

  return mapIdToElement;
}

/**
 * v6.6: Obté l'índex real d'un element dins del body
 */
function getBodyIndex(element) {
  try {
    const parent = element.getParent();
    if (parent && parent.getType() === DocumentApp.ElementType.BODY_SECTION) {
      return parent.getChildIndex(element);
    }
  } catch (e) {
    // Element sense parent vàlid
  }
  return -1;
}

/**
 * Guarda l'estat del preview pendent a DocumentProperties
 */
function savePendingInDocPreview(previews) {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('PENDING_INDOC_PREVIEW', JSON.stringify(previews));
  props.setProperty('PENDING_INDOC_PREVIEW_TIME', Date.now().toString());
}

/**
 * Carrega l'estat del preview pendent
 */
function loadPendingInDocPreview() {
  const props = PropertiesService.getDocumentProperties();
  const json = props.getProperty('PENDING_INDOC_PREVIEW');
  if (!json) return null;

  // Verificar timeout (5 minuts)
  const timeStr = props.getProperty('PENDING_INDOC_PREVIEW_TIME');
  if (timeStr) {
    const elapsed = Date.now() - parseInt(timeStr, 10);
    if (elapsed > 5 * 60 * 1000) {
      // Preview expirat, netejar
      clearPendingInDocPreview();
      return null;
    }
  }

  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

/**
 * Neteja l'estat del preview pendent
 */
function clearPendingInDocPreview() {
  const props = PropertiesService.getDocumentProperties();
  props.deleteProperty('PENDING_INDOC_PREVIEW');
  props.deleteProperty('PENDING_INDOC_PREVIEW_TIME');
}

/**
 * Comprova si hi ha un preview pendent
 */
function hasPendingInDocPreview() {
  const previews = loadPendingInDocPreview();
  return previews && previews.length > 0;
}

// ═══════════════════════════════════════════════════════════════
// HEADING DETECTION & SPACING v10.1
// ═══════════════════════════════════════════════════════════════

/**
 * Detecta si el text comença amb markdown de heading
 * Usa regla conservadora: només detecta si segueix majúscula o número
 *
 * @param {string} text - El text a analitzar
 * @returns {Object|null} - { heading, cleanText, prefixLen } o null si no és heading
 */
function detectHeadingFromMarkdown(text) {
  if (!text || typeof text !== 'string') return null;

  // Patrons: # + espai + (Majúscula, Número, o Caràcter especial com "¿¡")
  // Ordre important: de més específic (####) a menys (#)
  const patterns = [
    { regex: /^#### ([A-ZÀÁÈÉÍÏÒÓÚÜ0-9¿¡"'])/, heading: DocumentApp.ParagraphHeading.HEADING4, prefixLen: 5 },
    { regex: /^### ([A-ZÀÁÈÉÍÏÒÓÚÜ0-9¿¡"'])/, heading: DocumentApp.ParagraphHeading.HEADING3, prefixLen: 4 },
    { regex: /^## ([A-ZÀÁÈÉÍÏÒÓÚÜ0-9¿¡"'])/, heading: DocumentApp.ParagraphHeading.HEADING2, prefixLen: 3 },
    { regex: /^# ([A-ZÀÁÈÉÍÏÒÓÚÜ0-9¿¡"'])/, heading: DocumentApp.ParagraphHeading.HEADING1, prefixLen: 2 }
  ];

  for (const p of patterns) {
    if (p.regex.test(text)) {
      return {
        heading: p.heading,
        cleanText: text.substring(p.prefixLen),
        prefixLen: p.prefixLen
      };
    }
  }

  return null; // No és heading
}

/**
 * Aplica spacing professional segons el tipus de heading
 *
 * @param {Element} element - L'element paràgraf
 * @param {ParagraphHeading} heading - El tipus de heading
 */
function applyHeadingSpacing(element, heading) {
  if (!element || !heading) return;

  try {
    // Spacing en punts (pt) - valors professionals
    const spacingConfig = {
      HEADING1: { before: 24, after: 12 },
      HEADING2: { before: 18, after: 10 },
      HEADING3: { before: 14, after: 8 },
      HEADING4: { before: 12, after: 6 },
      NORMAL: { before: 0, after: 0 }
    };

    // Trobar el nom del heading
    let headingName = 'NORMAL';
    for (const [name, value] of Object.entries(DocumentApp.ParagraphHeading)) {
      if (value === heading) {
        headingName = name;
        break;
      }
    }

    const config = spacingConfig[headingName];
    if (config && element.setSpacingBefore && element.setSpacingAfter) {
      element.setSpacingBefore(config.before);
      element.setSpacingAfter(config.after);
    }
  } catch (e) {
    // Error aplicant spacing - no crític
    console.log('[Spacing] Error:', e.message);
  }
}

/**
 * Obté el heading actual d'un element (per guardar a lastEdit)
 *
 * @param {Element} element - L'element a analitzar
 * @returns {ParagraphHeading|null} - El heading o null
 */
function getElementHeading(element) {
  try {
    if (element && element.getHeading) {
      return element.getHeading();
    }
  } catch (e) {}
  return null;
}

// ═══════════════════════════════════════════════════════════════
// FORMAT PRESERVER MODULE v12.0
// Garanteix preservació de format en totes les operacions de text.
// ═══════════════════════════════════════════════════════════════

/**
 * Captura TOTS els atributs de format d'un rang de text
 * @param {Text} textObj - Objecte Text (element.editAsText())
 * @param {number} startIndex - Índex inicial
 * @param {number} endIndex - Índex final
 * @returns {Array<Object>} - Array d'atributs per cada caràcter
 */
function captureFormatAttributes(textObj, startIndex, endIndex) {
  const attrs = [];
  const textLength = textObj.getText().length;

  // Validar índexs
  startIndex = Math.max(0, startIndex);
  endIndex = Math.min(endIndex, textLength - 1);

  for (let i = startIndex; i <= endIndex; i++) {
    try {
      let fontSize = safeGetAttribute(textObj, 'getFontSize', i);
      let fontFamily = safeGetAttribute(textObj, 'getFontFamily', i);
      let foregroundColor = safeGetAttribute(textObj, 'getForegroundColor', i);

      // v15.1: FALLBACK per fonts/mida per defecte que retornen null
      if (!fontSize || !fontFamily) {
        try {
          const charAttrs = textObj.getAttributes(i);
          if (charAttrs) {
            if (!fontSize && charAttrs[DocumentApp.Attribute.FONT_SIZE]) {
              fontSize = charAttrs[DocumentApp.Attribute.FONT_SIZE];
            }
            if (!fontFamily && charAttrs[DocumentApp.Attribute.FONT_FAMILY]) {
              fontFamily = charAttrs[DocumentApp.Attribute.FONT_FAMILY];
            }
            if (!foregroundColor && charAttrs[DocumentApp.Attribute.FOREGROUND_COLOR]) {
              foregroundColor = charAttrs[DocumentApp.Attribute.FOREGROUND_COLOR];
            }
          }
        } catch (attrErr) {
          // Ignorar - usar els valors que tenim
        }
      }

      attrs.push({
        position: i - startIndex, // Posició relativa
        bold: safeGetAttribute(textObj, 'isBold', i),
        italic: safeGetAttribute(textObj, 'isItalic', i),
        underline: safeGetAttribute(textObj, 'isUnderline', i),
        strikethrough: safeGetAttribute(textObj, 'isStrikethrough', i),
        fontSize: fontSize,
        fontFamily: fontFamily,
        foregroundColor: foregroundColor,
        backgroundColor: safeGetAttribute(textObj, 'getBackgroundColor', i),
        linkUrl: safeGetAttribute(textObj, 'getLinkUrl', i)
      });
    } catch (e) {
      // Caràcter especial o error - usar atributs neutres
      attrs.push({ position: i - startIndex, bold: null, italic: null });
    }
  }
  return attrs;
}

/**
 * Helper per obtenir atributs de forma segura
 */
function safeGetAttribute(textObj, methodName, index) {
  try {
    if (textObj[methodName]) {
      return textObj[methodName](index);
    }
  } catch (e) {}
  return null;
}

/**
 * Aplica atributs capturats a un rang de text
 * @param {Text} textObj - Objecte Text
 * @param {number} startIndex - On començar a aplicar
 * @param {Array<Object>} attrs - Atributs a aplicar
 */
function applyFormatAttributes(textObj, startIndex, attrs) {
  const textLength = textObj.getText().length;

  attrs.forEach((attr, offset) => {
    const i = startIndex + offset;
    if (i >= textLength) return;

    try {
      if (attr.bold !== null) textObj.setBold(i, i, attr.bold);
      if (attr.italic !== null) textObj.setItalic(i, i, attr.italic);
      if (attr.underline !== null) textObj.setUnderline(i, i, attr.underline);
      if (attr.strikethrough !== null) textObj.setStrikethrough(i, i, attr.strikethrough);
      if (attr.fontSize) textObj.setFontSize(i, i, attr.fontSize);
      if (attr.fontFamily) textObj.setFontFamily(i, i, attr.fontFamily);
      if (attr.foregroundColor) textObj.setForegroundColor(i, i, attr.foregroundColor);
      if (attr.backgroundColor) textObj.setBackgroundColor(i, i, attr.backgroundColor);
      if (attr.linkUrl) textObj.setLinkUrl(i, i, attr.linkUrl);
    } catch (e) {
      // Ignorar errors per caràcters especials
    }
  });
}

/**
 * Aplica un format uniforme a un rang de text
 * @param {Text} textObj - Objecte Text
 * @param {number} startIndex - Índex inicial
 * @param {number} endIndex - Índex final
 * @param {Object} formatRef - Format de referència a aplicar
 */
function applyUniformFormat(textObj, startIndex, endIndex, formatRef) {
  if (!formatRef || startIndex > endIndex) return;

  const textLength = textObj.getText().length;
  endIndex = Math.min(endIndex, textLength - 1);

  try {
    if (formatRef.bold !== null) textObj.setBold(startIndex, endIndex, formatRef.bold);
    if (formatRef.italic !== null) textObj.setItalic(startIndex, endIndex, formatRef.italic);
    if (formatRef.underline !== null) textObj.setUnderline(startIndex, endIndex, formatRef.underline);
    if (formatRef.strikethrough !== null) textObj.setStrikethrough(startIndex, endIndex, formatRef.strikethrough);
    if (formatRef.fontSize) textObj.setFontSize(startIndex, endIndex, formatRef.fontSize);
    if (formatRef.fontFamily) textObj.setFontFamily(startIndex, endIndex, formatRef.fontFamily);
    if (formatRef.foregroundColor) textObj.setForegroundColor(startIndex, endIndex, formatRef.foregroundColor);
    if (formatRef.backgroundColor) textObj.setBackgroundColor(startIndex, endIndex, formatRef.backgroundColor);
    // No apliquem linkUrl uniformement (seria incorrecte)
  } catch (e) {
    // Error aplicant format uniforme
    console.log('[FormatPreserver] Error applying uniform format:', e.message);
  }
}

/**
 * Determina el format dominant (més freqüent) d'un array d'atributs
 * @param {Array<Object>} formatArray - Array d'atributs capturats
 * @returns {Object} - Format dominant
 */
function getDominantFormat(formatArray) {
  if (!formatArray || formatArray.length === 0) {
    return { bold: false, italic: false, underline: false, strikethrough: false };
  }

  // Comptar freqüència de cada atribut
  const counts = {
    bold: { true: 0, false: 0 },
    italic: { true: 0, false: 0 },
    underline: { true: 0, false: 0 },
    strikethrough: { true: 0, false: 0 }
  };

  const fontSizes = {};
  const fontFamilies = {};
  const foregroundColors = {};

  formatArray.forEach(attr => {
    if (attr.bold !== null) counts.bold[attr.bold]++;
    if (attr.italic !== null) counts.italic[attr.italic]++;
    if (attr.underline !== null) counts.underline[attr.underline]++;
    if (attr.strikethrough !== null) counts.strikethrough[attr.strikethrough]++;

    if (attr.fontSize) fontSizes[attr.fontSize] = (fontSizes[attr.fontSize] || 0) + 1;
    if (attr.fontFamily) fontFamilies[attr.fontFamily] = (fontFamilies[attr.fontFamily] || 0) + 1;
    if (attr.foregroundColor) foregroundColors[attr.foregroundColor] = (foregroundColors[attr.foregroundColor] || 0) + 1;
  });

  // Trobar el més freqüent de cada tipus
  const getMostFrequent = (obj) => {
    let max = 0, result = null;
    for (const [key, count] of Object.entries(obj)) {
      if (count > max) { max = count; result = key; }
    }
    return result;
  };

  return {
    bold: counts.bold.true > counts.bold.false,
    italic: counts.italic.true > counts.italic.false,
    underline: counts.underline.true > counts.underline.false,
    strikethrough: counts.strikethrough.true > counts.strikethrough.false,
    fontSize: getMostFrequent(fontSizes),
    fontFamily: getMostFrequent(fontFamilies),
    foregroundColor: getMostFrequent(foregroundColors),
    backgroundColor: null // Normalment no volem propagar backgroundColor
  };
}

/**
 * ESTRATÈGIA A: Substitució de paraula simple (per FIX mode)
 * Usa replaceText natiu que preserva format circumdant
 * @param {Element} element - Element del document
 * @param {string} oldWord - Paraula a substituir
 * @param {string} newWord - Paraula nova
 * @returns {boolean} - Èxit
 */
function replaceWordPreservingFormat(element, oldWord, newWord) {
  try {
    const textObj = element.editAsText();
    const fullText = textObj.getText();
    const index = fullText.indexOf(oldWord);

    if (index === -1) return false;

    // replaceText de Google Apps Script preserva el format del text circumdant
    // El text nou heretarà el format del primer caràcter de la coincidència
    const escaped = escapeRegexForReplace(oldWord);
    textObj.replaceText(escaped, newWord);

    return true;
  } catch (e) {
    console.log('[FormatPreserver] replaceWord error:', e.message);
    return false;
  }
}

/**
 * Escapa caràcters especials per regex
 */
function escapeRegexForReplace(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * ESTRATÈGIA B: Reemplaçar un rang preservant format
 * Per modificacions de fragments (IMPROVE)
 * @param {Element} element - Element del document
 * @param {number} startIdx - Índex inicial
 * @param {number} endIdx - Índex final
 * @param {string} newText - Text nou
 * @returns {boolean} - Èxit
 */
function replaceRangePreservingFormat(element, startIdx, endIdx, newText) {
  try {
    const textObj = element.editAsText();

    // 1. Capturar format del punt d'inici (servirà de referència)
    const formatRef = captureFormatAttributes(textObj, startIdx, startIdx)[0];

    // 2. Eliminar text antic
    textObj.deleteText(startIdx, endIdx);

    // 3. Inserir text nou
    textObj.insertText(startIdx, newText);

    // 4. Aplicar format capturat al text nou
    const newEndIdx = startIdx + newText.length - 1;
    if (newText.length > 0 && formatRef) {
      applyUniformFormat(textObj, startIdx, newEndIdx, formatRef);
    }

    return true;
  } catch (e) {
    console.log('[FormatPreserver] replaceRange error:', e.message);
    return false;
  }
}

/**
 * ESTRATÈGIA C: Reescriptura completa preservant estil dominant
 * Per REWRITE mode
 * @param {Element} element - Element del document
 * @param {string} newText - Text completament nou
 * @returns {boolean} - Èxit
 */
function rewritePreservingFormat(element, newText) {
  try {
    const textObj = element.editAsText();
    const oldText = textObj.getText();

    // 1. Capturar format complet del paràgraf existent
    // v15.1: Default amb fontSize/fontFamily per evitar pèrdua de format
    let dominantFormat = {
      bold: false,
      italic: false,
      fontSize: null,
      fontFamily: null,
      foregroundColor: null
    };

    if (oldText.length > 0) {
      const fullFormat = captureFormatAttributes(textObj, 0, oldText.length - 1);
      dominantFormat = getDominantFormat(fullFormat);

      // v15.1: FALLBACK CRÍTIC - Si fontSize/fontFamily són null (default de Google),
      // intentar capturar directament del primer caràcter amb mètode alternatiu
      if (!dominantFormat.fontSize || !dominantFormat.fontFamily) {
        try {
          // Usar getAttributes() que retorna TOTS els atributs incloent defaults
          const firstCharAttrs = textObj.getAttributes(0);
          if (firstCharAttrs) {
            if (!dominantFormat.fontSize && firstCharAttrs[DocumentApp.Attribute.FONT_SIZE]) {
              dominantFormat.fontSize = firstCharAttrs[DocumentApp.Attribute.FONT_SIZE];
            }
            if (!dominantFormat.fontFamily && firstCharAttrs[DocumentApp.Attribute.FONT_FAMILY]) {
              dominantFormat.fontFamily = firstCharAttrs[DocumentApp.Attribute.FONT_FAMILY];
            }
            if (!dominantFormat.foregroundColor && firstCharAttrs[DocumentApp.Attribute.FOREGROUND_COLOR]) {
              dominantFormat.foregroundColor = firstCharAttrs[DocumentApp.Attribute.FOREGROUND_COLOR];
            }
          }
        } catch (attrErr) {
          console.log('[FormatPreserver] getAttributes fallback error:', attrErr.message);
        }
      }
    }

    console.log('[FormatPreserver] dominantFormat after fallback:', JSON.stringify({
      fontSize: dominantFormat.fontSize,
      fontFamily: dominantFormat.fontFamily,
      bold: dominantFormat.bold
    }));

    // 2. Capturar atributs de paràgraf
    const paragraphAttrs = captureParagraphAttributes(element);

    // 3. Reemplaçar el text
    textObj.setText(newText);

    // 4. Aplicar format dominant a tot el text nou
    if (newText.length > 0) {
      applyUniformFormat(textObj, 0, newText.length - 1, dominantFormat);
    }

    // 5. Restaurar atributs de paràgraf
    restoreParagraphAttributes(element, paragraphAttrs);

    return true;
  } catch (e) {
    console.log('[FormatPreserver] rewrite error:', e.message);
    return false;
  }
}

/**
 * Captura atributs de paràgraf (heading, alignment, spacing, indentation)
 * @param {Element} element - Element paràgraf
 * @returns {Object} - Atributs capturats
 */
function captureParagraphAttributes(element) {
  const attrs = {};

  try {
    if (element.getHeading) attrs.heading = element.getHeading();
    if (element.getAlignment) attrs.alignment = element.getAlignment();
    if (element.getLineSpacing) attrs.lineSpacing = element.getLineSpacing();
    if (element.getSpacingBefore) attrs.spaceBefore = element.getSpacingBefore();
    if (element.getSpacingAfter) attrs.spaceAfter = element.getSpacingAfter();
    if (element.getIndentStart) attrs.indentStart = element.getIndentStart();
    if (element.getIndentEnd) attrs.indentEnd = element.getIndentEnd();
    if (element.getIndentFirstLine) attrs.indentFirstLine = element.getIndentFirstLine();
  } catch (e) {}

  return attrs;
}

/**
 * Restaura atributs de paràgraf
 * @param {Element} element - Element paràgraf
 * @param {Object} attrs - Atributs a restaurar
 */
function restoreParagraphAttributes(element, attrs) {
  if (!attrs) return;

  try {
    if (attrs.heading !== undefined && element.setHeading) element.setHeading(attrs.heading);
    if (attrs.alignment !== undefined && element.setAlignment) element.setAlignment(attrs.alignment);
    if (attrs.lineSpacing !== undefined && element.setLineSpacing) element.setLineSpacing(attrs.lineSpacing);
    if (attrs.spaceBefore !== undefined && element.setSpacingBefore) element.setSpacingBefore(attrs.spaceBefore);
    if (attrs.spaceAfter !== undefined && element.setSpacingAfter) element.setSpacingAfter(attrs.spaceAfter);
    if (attrs.indentStart !== undefined && element.setIndentStart) element.setIndentStart(attrs.indentStart);
    if (attrs.indentEnd !== undefined && element.setIndentEnd) element.setIndentEnd(attrs.indentEnd);
    if (attrs.indentFirstLine !== undefined && element.setIndentFirstLine) element.setIndentFirstLine(attrs.indentFirstLine);
  } catch (e) {
    console.log('[FormatPreserver] restoreParagraph error:', e.message);
  }
}

/**
 * Crea un snapshot complet del format d'un element (per UNDO)
 * @param {Element} element - Element a capturar
 * @returns {Object} - Snapshot complet
 */
function createFormatSnapshot(element) {
  try {
    const textObj = element.editAsText();
    const text = textObj.getText();

    return {
      text: text,
      textFormat: text.length > 0 ? captureFormatAttributes(textObj, 0, text.length - 1) : [],
      paragraphAttrs: captureParagraphAttributes(element)
    };
  } catch (e) {
    console.log('[FormatPreserver] createSnapshot error:', e.message);
    return null;
  }
}

/**
 * Restaura un element des d'un snapshot (per UNDO)
 * @param {Element} element - Element a restaurar
 * @param {Object} snapshot - Snapshot a aplicar
 * @returns {boolean} - Èxit
 */
function restoreFromSnapshot(element, snapshot) {
  if (!snapshot || !snapshot.text) return false;

  try {
    const textObj = element.editAsText();

    // 1. Restaurar text
    textObj.setText(snapshot.text);

    // 2. Restaurar format del text
    if (snapshot.textFormat && snapshot.textFormat.length > 0) {
      applyFormatAttributes(textObj, 0, snapshot.textFormat);
    }

    // 3. Restaurar atributs de paràgraf
    if (snapshot.paragraphAttrs) {
      restoreParagraphAttributes(element, snapshot.paragraphAttrs);
    }

    return true;
  } catch (e) {
    console.log('[FormatPreserver] restore error:', e.message);
    return false;
  }
}

/**
 * ESTRATÈGIA D: Detecció intel·ligent i aplicació de canvis
 * Analitza el diff i escull l'estratègia òptima
 * @param {Element} element - Element del document
 * @param {string} originalText - Text original
 * @param {string} newText - Text nou proposat
 * @param {Array} wordChanges - [opcional] Canvis de paraules específics [{old, new}]
 * @returns {boolean} - Èxit
 */
function applyChangePreservingFormat(element, originalText, newText, wordChanges) {
  try {
    // Si tenim word_changes del backend, usar-los directament
    if (wordChanges && Array.isArray(wordChanges) && wordChanges.length > 0) {
      return applyWordChanges(element, wordChanges);
    }

    // Detectar el tipus de canvi automàticament
    const changeAnalysis = analyzeTextChange(originalText, newText);

    console.log('[FormatPreserver] Change analysis:', JSON.stringify(changeAnalysis));

    switch (changeAnalysis.type) {
      case 'SINGLE_WORD':
        // Canvi d'una sola paraula (típic de FIX)
        return replaceWordPreservingFormat(element, changeAnalysis.oldWord, changeAnalysis.newWord);

      case 'MULTIPLE_WORDS':
        // Múltiples canvis de paraules
        return applyWordChanges(element, changeAnalysis.wordChanges);

      case 'INSERTION':
        // Text afegit (típic de EXPAND)
        return applyInsertionPreservingFormat(element, changeAnalysis.insertPosition, changeAnalysis.insertedText);

      case 'MINOR_EDIT':
        // Canvis menors (<30% del text)
        return applyMinorEditsPreservingFormat(element, originalText, newText);

      case 'MAJOR_REWRITE':
      default:
        // Reescriptura significant - usar format dominant
        return rewritePreservingFormat(element, newText);
    }
  } catch (e) {
    console.log('[FormatPreserver] applyChange error:', e.message);
    // Fallback al mètode existent
    return false;
  }
}

/**
 * Analitza el canvi entre dos textos per determinar l'estratègia òptima
 */
function analyzeTextChange(oldText, newText) {
  if (!oldText || !newText) {
    return { type: 'MAJOR_REWRITE' };
  }

  // Normalitzar espais
  const oldNorm = oldText.trim();
  const newNorm = newText.trim();

  // Detectar canvi de paraula simple
  const singleWordChange = detectSingleWordChange(oldNorm, newNorm);
  if (singleWordChange) {
    return {
      type: 'SINGLE_WORD',
      oldWord: singleWordChange.old,
      newWord: singleWordChange.new
    };
  }

  // Detectar múltiples canvis de paraules
  const multiWordChanges = detectMultipleWordChanges(oldNorm, newNorm);
  if (multiWordChanges && multiWordChanges.length > 0 && multiWordChanges.length <= 5) {
    return {
      type: 'MULTIPLE_WORDS',
      wordChanges: multiWordChanges
    };
  }

  // Detectar inserció (text original està contingut al nou)
  const insertionCheck = detectInsertion(oldNorm, newNorm);
  if (insertionCheck) {
    return {
      type: 'INSERTION',
      insertPosition: insertionCheck.position,
      insertedText: insertionCheck.text
    };
  }

  // Calcular percentatge de canvi
  const changeRatio = calculateChangeRatio(oldNorm, newNorm);
  if (changeRatio < 0.3) {
    return { type: 'MINOR_EDIT' };
  }

  return { type: 'MAJOR_REWRITE' };
}

/**
 * Detecta si el canvi és d'una sola paraula
 */
function detectSingleWordChange(oldText, newText) {
  const oldWords = oldText.split(/\s+/);
  const newWords = newText.split(/\s+/);

  // Si la diferència de paraules és més d'1, no és canvi simple
  if (Math.abs(oldWords.length - newWords.length) > 1) {
    return null;
  }

  // Trobar diferències
  let diffCount = 0;
  let oldWord = null;
  let newWord = null;

  const maxLen = Math.max(oldWords.length, newWords.length);
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldWords.length || newIdx < newWords.length) {
    if (oldIdx >= oldWords.length) {
      // Inserció al final
      diffCount++;
      newIdx++;
    } else if (newIdx >= newWords.length) {
      // Eliminació al final
      diffCount++;
      oldIdx++;
    } else if (oldWords[oldIdx] === newWords[newIdx]) {
      // Paraules iguals
      oldIdx++;
      newIdx++;
    } else {
      // Diferència trobada
      diffCount++;
      oldWord = oldWords[oldIdx];
      newWord = newWords[newIdx];
      oldIdx++;
      newIdx++;
    }
  }

  if (diffCount === 1 && oldWord && newWord) {
    return { old: oldWord, new: newWord };
  }

  return null;
}

/**
 * Detecta múltiples canvis de paraules
 */
function detectMultipleWordChanges(oldText, newText) {
  const changes = [];

  // Tokenitzar preservant posicions
  const oldTokens = tokenizeWithPositions(oldText);
  const newTokens = tokenizeWithPositions(newText);

  // Comparar token a token
  let newIdx = 0;
  for (let i = 0; i < oldTokens.length && changes.length <= 5; i++) {
    const oldToken = oldTokens[i];

    // Buscar coincidència al nou text
    let found = false;
    for (let j = newIdx; j < newTokens.length; j++) {
      if (newTokens[j].word === oldToken.word) {
        // Si hem saltat paraules, pot ser inserció - massa complex
        if (j > newIdx + 1) {
          return null; // Retornar null per usar altre estratègia
        }
        if (j === newIdx + 1 && newTokens[newIdx].word !== oldToken.word) {
          // Una paraula canviada
          changes.push({
            old: oldToken.word,
            new: newTokens[newIdx].word
          });
        }
        newIdx = j + 1;
        found = true;
        break;
      }
    }

    if (!found && newIdx < newTokens.length) {
      // Paraula canviada o eliminada
      if (oldTokens.length === newTokens.length) {
        changes.push({
          old: oldToken.word,
          new: newTokens[i] ? newTokens[i].word : ''
        });
        newIdx = i + 1;
      } else {
        return null; // Estructura massa diferent
      }
    }
  }

  return changes;
}

/**
 * Tokenitza text preservant posicions
 */
function tokenizeWithPositions(text) {
  const tokens = [];
  const regex = /\S+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      word: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return tokens;
}

/**
 * Detecta si el canvi és una inserció
 */
function detectInsertion(oldText, newText) {
  // El text nou ha de ser més llarg
  if (newText.length <= oldText.length) {
    return null;
  }

  // Comprovar si el text original és prefix
  if (newText.startsWith(oldText)) {
    return {
      position: oldText.length,
      text: newText.substring(oldText.length)
    };
  }

  // Comprovar si el text original és sufix
  if (newText.endsWith(oldText)) {
    return {
      position: 0,
      text: newText.substring(0, newText.length - oldText.length)
    };
  }

  // Comprovar si el text original està contingut
  const idx = newText.indexOf(oldText);
  if (idx > 0) {
    // Inserció al principi
    return {
      position: 0,
      text: newText.substring(0, idx)
    };
  }

  return null;
}

/**
 * Calcula el ràtio de canvi entre dos textos
 */
function calculateChangeRatio(oldText, newText) {
  // Simple Levenshtein-like estimation
  const maxLen = Math.max(oldText.length, newText.length);
  if (maxLen === 0) return 0;

  let matches = 0;
  const minLen = Math.min(oldText.length, newText.length);

  for (let i = 0; i < minLen; i++) {
    if (oldText[i] === newText[i]) matches++;
  }

  return 1 - (matches / maxLen);
}

/**
 * Aplica múltiples canvis de paraules
 */
function applyWordChanges(element, wordChanges) {
  let success = true;
  for (const change of wordChanges) {
    if (change.old && change.new) {
      const result = replaceWordPreservingFormat(element, change.old, change.new);
      if (!result) {
        console.log('[FormatPreserver] Word change failed:', change.old, '->', change.new);
        success = false;
      }
    }
  }
  return success;
}

/**
 * Aplica una inserció preservant format
 */
function applyInsertionPreservingFormat(element, position, text) {
  try {
    const textObj = element.editAsText();

    // Capturar format del punt d'inserció (o del caràcter anterior)
    const refPos = position > 0 ? position - 1 : 0;
    const formatRef = captureFormatAttributes(textObj, refPos, refPos)[0];

    // Inserir text
    textObj.insertText(position, text);

    // Aplicar format capturat
    if (text.length > 0 && formatRef) {
      applyUniformFormat(textObj, position, position + text.length - 1, formatRef);
    }

    return true;
  } catch (e) {
    console.log('[FormatPreserver] insertion error:', e.message);
    return false;
  }
}

/**
 * Aplica edicions menors preservant format
 * Usa diff per trobar els canvis mínims
 */
function applyMinorEditsPreservingFormat(element, oldText, newText) {
  try {
    const textObj = element.editAsText();
    const currentText = textObj.getText();

    // Trobar el primer i últim caràcter diferent
    let start = 0;
    while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) {
      start++;
    }

    let endOld = oldText.length - 1;
    let endNew = newText.length - 1;
    while (endOld > start && endNew > start && oldText[endOld] === newText[endNew]) {
      endOld--;
      endNew--;
    }

    // Extreure la part canviada
    const oldPart = oldText.substring(start, endOld + 1);
    const newPart = newText.substring(start, endNew + 1);

    // Capturar format del punt d'inici
    const formatRef = start < currentText.length
      ? captureFormatAttributes(textObj, start, start)[0]
      : null;

    // Eliminar la part antiga
    if (oldPart.length > 0 && endOld >= start) {
      textObj.deleteText(start, endOld);
    }

    // Inserir la part nova
    if (newPart.length > 0) {
      textObj.insertText(start, newPart);

      // Aplicar format
      if (formatRef) {
        applyUniformFormat(textObj, start, start + newPart.length - 1, formatRef);
      }
    }

    return true;
  } catch (e) {
    console.log('[FormatPreserver] minorEdits error:', e.message);
    return false;
  }
}

// --- RENDERING HELPERS ---
function updateParagraphPreservingAttributes(element, newMarkdownText) {
  const textObj = element.editAsText();
  const oldText = textObj.getText();

  // 0. DETECTAR HEADING del markdown ABANS de processar
  // Si l'AI retorna "## Títol", detectem H2 i netegem el prefix
  const headingInfo = detectHeadingFromMarkdown(newMarkdownText);
  let textToProcess = newMarkdownText;
  let detectedHeading = null;

  if (headingInfo) {
    textToProcess = headingInfo.cleanText;
    detectedHeading = headingInfo.heading;
  }

  // Netejar bold/italic del text (sense el prefix de heading)
  const cleanText = cleanMarkdown(textToProcess);

  // 1. Guardar atributs del PARÀGRAF (heading, alignment, spacing, indentation)
  let paragraphHeading = null;
  let paragraphAlignment = null;
  let lineSpacing = null;
  let indentStart = null;
  let indentEnd = null;
  let indentFirstLine = null;

  try {
    if (element.getHeading) paragraphHeading = element.getHeading();
    if (element.getAlignment) paragraphAlignment = element.getAlignment();
    if (element.getLineSpacing) lineSpacing = element.getLineSpacing();
    // Nota: NO guardem spacingBefore/After si detectem heading nou (volem spacing automàtic)
    if (element.getIndentStart) indentStart = element.getIndentStart();
    if (element.getIndentEnd) indentEnd = element.getIndentEnd();
    if (element.getIndentFirstLine) indentFirstLine = element.getIndentFirstLine();
  } catch (e) {
    // Element sense aquests mètodes (graceful degradation)
  }

  // 2. Guardar atributs del TEXT (font, size, color) del primer caràcter
  let fontFamily = null;
  let fontSize = null;
  let foregroundColor = null;

  if (oldText.length > 0) {
    try {
      fontFamily = textObj.getFontFamily(0);
      fontSize = textObj.getFontSize(0);
      foregroundColor = textObj.getForegroundColor(0);
    } catch (e) {
      // Atributs no disponibles
    }
  }

  // 3. Aplicar el text nou
  if (oldText.length > 0) {
    textObj.insertText(0, cleanText);
    const startOfOld = cleanText.length;
    const endOfOld = startOfOld + oldText.length - 1;
    if (endOfOld >= startOfOld) textObj.deleteText(startOfOld, endOfOld);
  } else {
    textObj.setText(cleanText);
  }

  // 4. Restaurar atributs del TEXT a tot el nou contingut
  const newLength = cleanText.length;
  if (newLength > 0) {
    try {
      if (fontFamily) textObj.setFontFamily(0, newLength - 1, fontFamily);
      if (fontSize) textObj.setFontSize(0, newLength - 1, fontSize);
      if (foregroundColor) textObj.setForegroundColor(0, newLength - 1, foregroundColor);
    } catch (e) {
      // Error aplicant atributs de text
    }
  }

  // 5. Aplicar HEADING (detectat del markdown O preservar l'original)
  try {
    if (detectedHeading !== null && element.setHeading) {
      // Hem detectat un heading nou del markdown → Aplicar-lo
      element.setHeading(detectedHeading);
      // Aplicar spacing professional per aquest heading
      applyHeadingSpacing(element, detectedHeading);
    } else if (paragraphHeading !== null && element.setHeading) {
      // No hi ha heading detectat → Preservar l'original
      element.setHeading(paragraphHeading);
    }
  } catch (e) {
    // Error aplicant heading
  }

  // 6. Restaurar altres atributs del PARÀGRAF (no heading ni spacing si s'ha detectat heading)
  try {
    if (paragraphAlignment !== null && element.setAlignment) {
      element.setAlignment(paragraphAlignment);
    }
    if (lineSpacing !== null && element.setLineSpacing) {
      element.setLineSpacing(lineSpacing);
    }
    if (indentStart !== null && element.setIndentStart) {
      element.setIndentStart(indentStart);
    }
    if (indentEnd !== null && element.setIndentEnd) {
      element.setIndentEnd(indentEnd);
    }
    if (indentFirstLine !== null && element.setIndentFirstLine) {
      element.setIndentFirstLine(indentFirstLine);
    }
  } catch (e) {
    // Error restaurant atributs de paràgraf
  }

  // 7. Aplicar markdown inline (bold, italic) - usar text sense prefix de heading
  applyInlineMarkdown(element, textToProcess);
}

function applyInlineMarkdown(element, originalMarkdown) {
  const textObj = element.editAsText();
  const cleanText = textObj.getText();
  const boldPattern = /\*\*(.+?)\*\*/g;
  let match;
  let searchStart = 0;
  while ((match = boldPattern.exec(originalMarkdown)) !== null) {
    const content = match[1];
    const pos = cleanText.indexOf(content, searchStart);
    if (pos !== -1) textObj.setBold(pos, pos + content.length - 1, true);
  }
  const italicPattern = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
  searchStart = 0;
  while ((match = italicPattern.exec(originalMarkdown)) !== null) {
    const content = match[1];
    const pos = cleanText.indexOf(content, searchStart);
    if (pos !== -1) textObj.setItalic(pos, pos + content.length - 1, true);
  }
}

function renderFullDocument(body, blocks) {
  body.clear();
  blocks.forEach(block => {
    let element;
    switch (block.type) {
      case 'HEADING_1': element = body.appendParagraph(block.text).setHeading(DocumentApp.ParagraphHeading.HEADING1); break;
      case 'HEADING_2': element = body.appendParagraph(block.text).setHeading(DocumentApp.ParagraphHeading.HEADING2); break;
      case 'HEADING_3': element = body.appendParagraph(block.text).setHeading(DocumentApp.ParagraphHeading.HEADING3); break;
      case 'BULLET_LIST': element = body.appendListItem(block.text).setGlyphType(DocumentApp.GlyphType.BULLET); break;
      case 'NUMBERED_LIST': element = body.appendListItem(block.text).setGlyphType(DocumentApp.GlyphType.NUMBER); break;
      case 'TABLE':
        // v6.0: Handle TABLE blocks
        if (block.headers && Array.isArray(block.headers)) {
          insertTableFromBlock(body, body.getNumChildren(), block);
        }
        break;
      default: element = body.appendParagraph(block.text).setHeading(DocumentApp.ParagraphHeading.NORMAL);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// TABLE GENERATION v6.0 - Insert tables from REWRITE blocks
// ═══════════════════════════════════════════════════════════════

/**
 * Inserts a table into Google Docs from a TABLE block
 * @param {Body} body - Document body
 * @param {number} insertIndex - Where to insert
 * @param {Object} tableData - { headers: [], rows: [[]] }
 * @returns {Object} { success, stats, error }
 */
function insertTableFromBlock(body, insertIndex, tableData) {
  try {
    if (!tableData.headers || !Array.isArray(tableData.headers) || tableData.headers.length === 0) {
      return { success: false, error: 'Missing headers' };
    }

    const numCols = tableData.headers.length;
    const rows = tableData.rows || [];

    // Build cells matrix
    const cells = [];

    // Add header row
    cells.push(tableData.headers.map(h => String(h)));

    // Add data rows
    for (const row of rows) {
      if (Array.isArray(row)) {
        // Ensure correct column count
        const paddedRow = [];
        for (let i = 0; i < numCols; i++) {
          paddedRow.push(String(row[i] || ''));
        }
        cells.push(paddedRow);
      }
    }

    // Insert the table
    const table = body.insertTable(insertIndex, cells);

    // Format headers (bold)
    const headerRow = table.getRow(0);
    for (let c = 0; c < numCols; c++) {
      try {
        headerRow.getCell(c).editAsText().setBold(true);
      } catch (e) {}
    }

    return {
      success: true,
      stats: { rows: cells.length, cols: numCols }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// IMAGE EXTRACTION v6.0 - Extract images for multimodal AI
// ═══════════════════════════════════════════════════════════════

const IMAGE_CONFIG = {
  MAX_SIZE_KB: 500,
  MAX_IMAGES: 3,
  MAX_TOTAL_KB: 1500,
  SUPPORTED_TYPES: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  EXTRACTION_TIMEOUT_MS: 5000
};

/**
 * Detects if the instruction requires image analysis
 * @param {string} instruction - User instruction
 * @returns {boolean}
 */
function shouldExtractImages(instruction) {
  if (!instruction) return false;
  const lower = instruction.toLowerCase();

  // Direct patterns (image-related words)
  const directPatterns = [
    /imatge/i, /image/i, /foto/i, /fotografia/i,
    /gràfic/i, /gráfico/i, /graph/i, /chart/i,
    /diagrama/i, /figura/i, /picture/i,
    /screenshot/i, /captura/i, /il·lustració/i
  ];

  // Action patterns (visual analysis requests)
  const actionPatterns = [
    /què (hi ha|mostra|veus|es veu)/i,
    /what (is|does|shows)/i,
    /descriu/i, /describe/i,
    /explica.*visual/i,
    /analitza.*imatge/i, /analyze.*image/i,
    /mira/i, /look at/i,
    /text.*imatge/i, /ocr/i
  ];

  for (const pattern of directPatterns) {
    if (pattern.test(lower)) return true;
  }
  for (const pattern of actionPatterns) {
    if (pattern.test(lower)) return true;
  }

  return false;
}

/**
 * Extracts a single image as base64
 * @param {InlineImage} inlineImage
 * @param {number} index
 * @returns {Object}
 */
function extractImageAsBase64(inlineImage, index) {
  try {
    const blob = inlineImage.getBlob();
    const mimeType = blob.getContentType();

    if (!IMAGE_CONFIG.SUPPORTED_TYPES.includes(mimeType)) {
      return { success: false, index: index, error: 'Unsupported type: ' + mimeType, skipped: true };
    }

    const bytes = blob.getBytes();
    const sizeKB = Math.round(bytes.length / 1024);

    if (sizeKB > IMAGE_CONFIG.MAX_SIZE_KB) {
      return { success: false, index: index, error: 'Too large: ' + sizeKB + 'KB', sizeKB: sizeKB, skipped: true };
    }

    const base64 = Utilities.base64Encode(bytes);
    return { success: true, index: index, data: base64, mimeType: mimeType, sizeKB: sizeKB };
  } catch (e) {
    return { success: false, index: index, error: e.message, skipped: true };
  }
}

/**
 * Extracts all images from the document (with limits)
 * @param {Body} body
 * @returns {Object} { images: [], stats: {}, warnings: [] }
 */
function extractDocumentImages(body) {
  const startTime = Date.now();
  const result = {
    images: [],
    stats: { total_found: 0, extracted: 0, skipped: 0, total_size_kb: 0 },
    warnings: []
  };

  const numChildren = body.getNumChildren();
  let imageIndex = 0;

  for (let i = 0; i < numChildren; i++) {
    // Timeout check
    if (Date.now() - startTime > IMAGE_CONFIG.EXTRACTION_TIMEOUT_MS) {
      result.warnings.push('Extraction truncated by timeout');
      break;
    }

    // Image limit check
    if (result.images.length >= IMAGE_CONFIG.MAX_IMAGES) {
      result.warnings.push('Max ' + IMAGE_CONFIG.MAX_IMAGES + ' images limit reached');
      break;
    }

    const child = body.getChild(i);

    // Search for images inside paragraphs
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
      const para = child.asParagraph();
      const numParaChildren = para.getNumChildren();

      for (let j = 0; j < numParaChildren; j++) {
        const paraChild = para.getChild(j);

        if (paraChild.getType() === DocumentApp.ElementType.INLINE_IMAGE) {
          result.stats.total_found++;

          if (result.stats.total_size_kb >= IMAGE_CONFIG.MAX_TOTAL_KB) {
            result.warnings.push('Total size limit reached');
            break;
          }

          const extracted = extractImageAsBase64(paraChild.asInlineImage(), imageIndex);

          if (extracted.success) {
            result.images.push({
              index: imageIndex,
              data: extracted.data,
              mimeType: extracted.mimeType,
              sizeKB: extracted.sizeKB
            });
            result.stats.extracted++;
            result.stats.total_size_kb += extracted.sizeKB;
          } else {
            result.stats.skipped++;
            if (extracted.error) {
              result.warnings.push('Image ' + imageIndex + ': ' + extracted.error);
            }
          }
          imageIndex++;
        }
      }
    }

    // Direct images in body
    if (child.getType() === DocumentApp.ElementType.INLINE_IMAGE) {
      result.stats.total_found++;

      const extracted = extractImageAsBase64(child.asInlineImage(), imageIndex);

      if (extracted.success && result.images.length < IMAGE_CONFIG.MAX_IMAGES) {
        result.images.push({
          index: imageIndex,
          data: extracted.data,
          mimeType: extracted.mimeType,
          sizeKB: extracted.sizeKB
        });
        result.stats.extracted++;
        result.stats.total_size_kb += extracted.sizeKB;
      } else {
        result.stats.skipped++;
      }
      imageIndex++;
    }
  }

  result.stats.extraction_time_ms = Date.now() - startTime;
  return result;
}

// ═══════════════════════════════════════════════════════════════
// TABLE UPDATE v6.0 - Apply operations to existing tables
// ═══════════════════════════════════════════════════════════════

/**
 * Finds a table by its index
 * @param {Body} body
 * @param {number} tableId
 * @returns {Table|null}
 */
function findTableById(body, tableId) {
  let currentTableIndex = 0;
  const numChildren = body.getNumChildren();

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.TABLE) {
      if (currentTableIndex === tableId) {
        return child.asTable();
      }
      currentTableIndex++;
    }
  }
  return null;
}

/**
 * Sorts operations to avoid index shifting issues
 * Deletes are moved to the end and sorted descending
 */
function sortTableOperations(operations) {
  const deletes = [];
  const others = [];

  for (const op of operations) {
    if (op.action === 'delete_row') {
      deletes.push(op);
    } else {
      others.push(op);
    }
  }

  // Sort deletes descending by row
  deletes.sort(function(a, b) { return b.row - a.row; });

  return others.concat(deletes);
}

/**
 * Applies a single operation to a table
 */
function applySingleTableOperation(table, op, numRows, numCols) {
  switch (op.action) {
    case 'update_cell':
      if (op.row < 0 || op.row >= numRows) {
        return { success: false, error: 'Row ' + op.row + ' out of range (0-' + (numRows-1) + ')' };
      }
      if (op.col < 0 || op.col >= numCols) {
        return { success: false, error: 'Col ' + op.col + ' out of range (0-' + (numCols-1) + ')' };
      }
      table.getCell(op.row, op.col).setText(String(op.value));
      return { success: true };

    case 'add_row':
      if (op.values.length !== numCols) {
        return { success: false, error: 'Values has ' + op.values.length + ' items, table has ' + numCols + ' cols' };
      }
      var newRow = table.insertTableRow(op.after_row + 1);
      for (var v = 0; v < op.values.length; v++) {
        newRow.appendTableCell(String(op.values[v]));
      }
      return { success: true };

    case 'delete_row':
      if (op.row < 0 || op.row >= numRows) {
        return { success: false, error: 'Row ' + op.row + ' out of range' };
      }
      table.getRow(op.row).removeFromParent();
      return { success: true };

    case 'update_row':
      if (op.row < 0 || op.row >= numRows) {
        return { success: false, error: 'Row ' + op.row + ' out of range' };
      }
      if (op.values.length !== numCols) {
        return { success: false, error: 'Values count mismatch' };
      }
      var targetRow = table.getRow(op.row);
      for (var c = 0; c < numCols; c++) {
        targetRow.getCell(c).setText(String(op.values[c]));
      }
      return { success: true };

    default:
      return { success: false, error: 'Unknown action: ' + op.action };
  }
}

/**
 * Applies all operations to a table
 * @param {number} tableId
 * @param {Array} operations
 * @returns {Object} Result with stats
 */
function applyTableOperations(tableId, operations) {
  const body = DocumentApp.getActiveDocument().getBody();
  const table = findTableById(body, tableId);

  if (!table) {
    return { success: false, error: 'Table ' + tableId + ' not found' };
  }

  var numRows = table.getNumRows();
  var numCols = numRows > 0 ? table.getRow(0).getNumCells() : 0;

  const results = {
    success: true,
    operations_applied: 0,
    operations_failed: 0,
    details: [],
    original_dimensions: { rows: numRows, cols: numCols }
  };

  // Sort operations to avoid index issues
  const sortedOps = sortTableOperations(operations);

  for (var i = 0; i < sortedOps.length; i++) {
    var op = sortedOps[i];
    try {
      // Recalculate dimensions after each operation
      numRows = table.getNumRows();
      numCols = numRows > 0 ? table.getRow(0).getNumCells() : 0;

      var opResult = applySingleTableOperation(table, op, numRows, numCols);

      if (opResult.success) {
        results.operations_applied++;
        results.details.push({ action: op.action, status: 'OK' });
      } else {
        results.operations_failed++;
        results.details.push({ action: op.action, status: 'FAILED', error: opResult.error });
      }
    } catch (e) {
      results.operations_failed++;
      results.details.push({ action: op.action, status: 'ERROR', error: e.message });
    }
  }

  results.final_dimensions = {
    rows: table.getNumRows(),
    cols: table.getRow(0).getNumCells()
  };

  return results;
}

// ═══════════════════════════════════════════════════════════
// TABLES PANEL v6.0 - Backend functions for table management UI
// ═══════════════════════════════════════════════════════════

/**
 * Scans all tables in the document and returns their metadata
 * @returns {Object} { tables: [{rows, cols, preview, headers}], total }
 */
function scanTablesInDocument() {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const numChildren = body.getNumChildren();
    const tables = [];

    for (var i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.TABLE) {
        const table = child.asTable();
        const numRows = table.getNumRows();
        const numCols = numRows > 0 ? table.getRow(0).getNumCells() : 0;

        // Get headers (first row)
        let headers = [];
        let preview = '';
        if (numRows > 0) {
          const firstRow = table.getRow(0);
          for (var c = 0; c < numCols && c < 5; c++) {
            try {
              headers.push(firstRow.getCell(c).getText().trim().substring(0, 30));
            } catch (e) {
              headers.push('');
            }
          }
          preview = headers.join(' | ');
        }

        tables.push({
          index: tables.length,
          bodyIndex: i,
          rows: numRows,
          cols: numCols,
          headers: headers,
          preview: preview
        });
      }
    }

    return {
      success: true,
      tables: tables,
      total: tables.length
    };
  } catch (e) {
    return { success: false, error: e.message, tables: [] };
  }
}

/**
 * Scrolls to and selects a table by its index
 * @param {number} tableIndex - The index of the table (0-based)
 * @returns {Object} Result
 */
function scrollToTableByIndex(tableIndex) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const numChildren = body.getNumChildren();
    let tableCount = 0;

    for (var i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.TABLE) {
        if (tableCount === tableIndex) {
          // Found the table - set cursor to it
          const table = child.asTable();
          // Set position to first cell
          if (table.getNumRows() > 0) {
            const firstCell = table.getRow(0).getCell(0);
            const position = doc.newPosition(firstCell, 0);
            doc.setCursor(position);
          }
          return { success: true };
        }
        tableCount++;
      }
    }

    return { success: false, error: 'Taula no trobada' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Adds a row to a table by its index
 * @param {number} tableIndex - The index of the table (0-based)
 * @param {Array<string>} rowData - Array of cell values
 * @returns {Object} Result
 */
function addRowToTable(tableIndex, rowData) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const numChildren = body.getNumChildren();
    let tableCount = 0;

    for (var i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.TABLE) {
        if (tableCount === tableIndex) {
          const table = child.asTable();
          const numCols = table.getRow(0).getNumCells();

          // Append empty row first
          const newRow = table.appendTableRow();

          // Then populate cells
          for (var c = 0; c < numCols; c++) {
            newRow.appendTableCell(rowData[c] || '');
          }

          return { success: true, newRowIndex: table.getNumRows() - 1 };
        }
        tableCount++;
      }
    }

    return { success: false, error: 'Taula no trobada' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Inserts an empty table at cursor position
 * @param {number} numRows - Number of rows
 * @param {number} numCols - Number of columns
 * @returns {Object} Result
 */
function insertEmptyTable(numRows, numCols) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const cursor = doc.getCursor();
    let insertIndex = -1;

    if (cursor) {
      // Find the element at cursor
      const element = cursor.getElement();
      let parent = element;
      while (parent && parent.getParent() && parent.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) {
        parent = parent.getParent();
      }
      if (parent) {
        insertIndex = doc.getBody().getChildIndex(parent) + 1;
      }
    }

    // Create empty cells array
    const cells = [];
    for (var r = 0; r < numRows; r++) {
      const row = [];
      for (var c = 0; c < numCols; c++) {
        row.push(r === 0 ? 'Col ' + (c + 1) : '');
      }
      cells.push(row);
    }

    // Insert table
    const body = doc.getBody();
    let table;
    if (insertIndex > 0 && insertIndex < body.getNumChildren()) {
      table = body.insertTable(insertIndex, cells);
    } else {
      table = body.appendTable(cells);
    }

    // Bold first row (headers)
    const headerRow = table.getRow(0);
    for (var c = 0; c < numCols; c++) {
      try {
        headerRow.getCell(c).editAsText().setBold(true);
      } catch (e) {}
    }

    return { success: true, rows: numRows, cols: numCols };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Generates a table from AI description
 * @param {string} description - What the table should contain
 * @param {number} numRows - Desired number of rows
 * @param {boolean} includeHeaders - Whether to include headers
 * @returns {Object} Result
 */
function generateTableFromDescription(description, numRows, includeHeaders) {
  try {
    // Build a specific prompt for table generation
    const tablePrompt = 'Genera una taula amb exactament ' + numRows + ' files de dades' +
      (includeHeaders ? ' més una fila de capçaleres' : '') +
      '. Contingut: ' + description +
      '\n\nRespon NOMÉS amb format JSON vàlid amb aquesta estructura exacta:' +
      '\n{"headers": ["Col1", "Col2", ...], "rows": [["val1", "val2", ...], ...]}' +
      '\n\nNo afegeixis cap text addicional, només el JSON.';

    // Get API key
    const props = PropertiesService.getUserProperties();
    let apiKey = props.getProperty('DOCMILE_API_KEY');
    if (!apiKey) {
      apiKey = props.getProperty('gemini_api_key');
    }

    if (!apiKey) {
      return { success: false, error: 'No s\'ha configurat la clau API' };
    }

    // Call Gemini directly for structured output
    const response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        contentType: 'application/json',
        payload: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{ text: tablePrompt }]
          }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048
          }
        }),
        muteHttpExceptions: true
      }
    );

    const responseData = JSON.parse(response.getContentText());

    if (!responseData.candidates || !responseData.candidates[0]) {
      return { success: false, error: 'No s\'ha rebut resposta de la IA' };
    }

    let aiText = responseData.candidates[0].content.parts[0].text;

    // Clean up the response - extract JSON
    aiText = aiText.trim();
    if (aiText.startsWith('```json')) {
      aiText = aiText.substring(7);
    }
    if (aiText.startsWith('```')) {
      aiText = aiText.substring(3);
    }
    if (aiText.endsWith('```')) {
      aiText = aiText.substring(0, aiText.length - 3);
    }
    aiText = aiText.trim();

    // Parse the table data
    const tableData = JSON.parse(aiText);

    if (!tableData.headers || !Array.isArray(tableData.headers)) {
      return { success: false, error: 'Format de taula invàlid: falten capçaleres' };
    }

    // Build cells array
    const numCols = tableData.headers.length;
    const cells = [];

    // Add headers row
    if (includeHeaders) {
      cells.push(tableData.headers.map(h => String(h)));
    }

    // Add data rows
    const rows = tableData.rows || [];
    for (var r = 0; r < rows.length && r < numRows; r++) {
      const row = rows[r];
      if (Array.isArray(row)) {
        const paddedRow = [];
        for (var c = 0; c < numCols; c++) {
          paddedRow.push(String(row[c] || ''));
        }
        cells.push(paddedRow);
      }
    }

    // Insert the table at cursor or end
    const doc = DocumentApp.getActiveDocument();
    const cursor = doc.getCursor();
    let insertIndex = -1;

    if (cursor) {
      const element = cursor.getElement();
      let parent = element;
      while (parent && parent.getParent() && parent.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) {
        parent = parent.getParent();
      }
      if (parent) {
        insertIndex = doc.getBody().getChildIndex(parent) + 1;
      }
    }

    const body = doc.getBody();
    let table;
    if (insertIndex > 0 && insertIndex < body.getNumChildren()) {
      table = body.insertTable(insertIndex, cells);
    } else {
      table = body.appendTable(cells);
    }

    // Bold headers if included
    if (includeHeaders && table.getNumRows() > 0) {
      const headerRow = table.getRow(0);
      for (var c = 0; c < numCols; c++) {
        try {
          headerRow.getCell(c).editAsText().setBold(true);
        } catch (e) {}
      }
    }

    return {
      success: true,
      stats: {
        rows: cells.length,
        cols: numCols
      }
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- INSTRUMENTATION & DIAGNOSTICS (v3.7) ---

/**
 * Analitza TOTS els elements del document per diagnòstic
 * Retorna estadístiques detallades de què hi ha vs què capturem
 */
function analyzeDocumentStructure(body) {
  const stats = {
    total_children: 0,
    by_type: {},
    captured: {
      paragraph: 0,
      list_item: 0,
      total_chars: 0
    },
    invisible: {
      table: 0,
      inline_image: 0,
      horizontal_rule: 0,
      page_break: 0,
      footnote: 0,
      other: 0
    },
    element_details: []  // Per debug detallat
  };

  const numChildren = body.getNumChildren();
  stats.total_children = numChildren;

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    const typeName = child.getType().toString();

    // Comptador per tipus
    stats.by_type[typeName] = (stats.by_type[typeName] || 0) + 1;

    // Classificar per categoria
    switch (child.getType()) {
      case DocumentApp.ElementType.PARAGRAPH:
        stats.captured.paragraph++;
        const pText = child.asText().getText();
        stats.captured.total_chars += pText.length;
        if (pText.trim().length > 0) {
          stats.element_details.push({
            index: i,
            type: 'PARAGRAPH',
            chars: pText.length,
            preview: pText.substring(0, 50)
          });
        }
        break;

      case DocumentApp.ElementType.LIST_ITEM:
        stats.captured.list_item++;
        const liText = child.asText().getText();
        stats.captured.total_chars += liText.length;
        if (liText.trim().length > 0) {
          stats.element_details.push({
            index: i,
            type: 'LIST_ITEM',
            chars: liText.length,
            preview: liText.substring(0, 50)
          });
        }
        break;

      case DocumentApp.ElementType.TABLE:
        stats.invisible.table++;
        // Comptar cel·les i text dins la taula
        try {
          const table = child.asTable();
          let tableChars = 0;
          for (let r = 0; r < table.getNumRows(); r++) {
            const row = table.getRow(r);
            for (let c = 0; c < row.getNumCells(); c++) {
              tableChars += row.getCell(c).getText().length;
            }
          }
          stats.element_details.push({
            index: i,
            type: 'TABLE',
            rows: table.getNumRows(),
            chars: tableChars,
            note: 'INVISIBLE TO AI'
          });
        } catch (e) {}
        break;

      case DocumentApp.ElementType.INLINE_IMAGE:
        stats.invisible.inline_image++;
        stats.element_details.push({
          index: i,
          type: 'INLINE_IMAGE',
          note: 'INVISIBLE TO AI'
        });
        break;

      case DocumentApp.ElementType.HORIZONTAL_RULE:
        stats.invisible.horizontal_rule++;
        break;

      case DocumentApp.ElementType.PAGE_BREAK:
        stats.invisible.page_break++;
        break;

      case DocumentApp.ElementType.FOOTNOTE:
        stats.invisible.footnote++;
        break;

      default:
        stats.invisible.other++;
        stats.element_details.push({
          index: i,
          type: typeName,
          note: 'UNKNOWN - INVISIBLE TO AI'
        });
    }
  }

  return stats;
}

/**
 * Genera un log estructurat per diagnòstic
 * @param {string} phase - 'INIT', 'REQUEST', 'RESPONSE', 'ERROR'
 * @param {Object} data - Dades a logar
 */
function logDiagnostic(phase, data) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp: timestamp,
    phase: phase,
    ...data
  };

  // Log a la consola de Google Apps Script
  Logger.log('[DOCMILE_DIAG] ' + JSON.stringify(logEntry));

  // Retornar per si volem enviar a Supabase després
  return logEntry;
}

/**
 * Recull mètriques d'una execució completa
 */
function createMetricsCollector() {
  const startTime = Date.now();
  const metrics = {
    timing: {
      start_ms: startTime,
      doc_analysis_ms: null,
      api_call_ms: null,
      total_ms: null
    },
    document: null,
    request: null,
    response: null,
    errors: []
  };

  return {
    setDocumentStats: function(stats) {
      metrics.timing.doc_analysis_ms = Date.now() - startTime;
      metrics.document = stats;
    },
    setRequestInfo: function(info) {
      metrics.request = info;
    },
    setResponseInfo: function(info) {
      metrics.timing.api_call_ms = Date.now() - startTime - (metrics.timing.doc_analysis_ms || 0);
      metrics.response = info;
    },
    addError: function(error) {
      metrics.errors.push({
        time_ms: Date.now() - startTime,
        error: error
      });
    },
    finalize: function() {
      metrics.timing.total_ms = Date.now() - startTime;
      logDiagnostic('METRICS', metrics);
      // v3.7: Enviar mètriques al Worker (de forma asíncrona)
      try {
        sendDiagnostic(metrics);
      } catch (e) {
        // Ignorar errors - no volem bloquejar l'usuari
      }
      return metrics;
    },
    getMetrics: function() {
      return metrics;
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// UNIVERSAL DOC READER v3.7 - Captura TOTAL del document
// ═══════════════════════════════════════════════════════════════
//
// Filosofia: "Si l'usuari ho veu, la IA també ho ha de veure"
// Serialitzem TOT el DOM del document en text estructurat.
// ═══════════════════════════════════════════════════════════════

/**
 * UNIVERSAL DOC READER - Captura ABSOLUTAMENT TOT el document
 *
 * Captura:
 * - Header (capçalera del document)
 * - Body (paràgrafs, llistes, taules, etc.)
 * - Footer (peu de pàgina)
 * - Footnotes (notes al peu)
 *
 * @param {Document} doc - El document complet
 * @param {Body} body - El body del document
 * @param {boolean} isSelection - Si hi ha selecció activa
 * @param {Array} selectedElements - Elements seleccionats (si aplica)
 */
function captureFullDocument(doc, body, isSelection, selectedElements) {
  const sections = [];
  const mapIdToElement = {};
  let globalIndex = 0;

  const stats = {
    total_elements: 0,
    captured_paragraphs: 0,
    captured_lists: 0,
    captured_tables: 0,
    captured_header: false,
    captured_footer: false,
    footnotes_count: 0,
    total_chars: 0,
    has_images: false,
    has_drawings: false
  };

  // ═══ 1. CAPTURAR HEADER (Capçalera) ═══
  try {
    const header = doc.getHeader();
    if (header) {
      const headerText = captureContainerContent(header, 'HEADER');
      if (headerText.text.trim()) {
        sections.push(`[CAPÇALERA DEL DOCUMENT]\n${headerText.text}\n[/CAPÇALERA]\n`);
        stats.captured_header = true;
        stats.total_chars += headerText.chars;
      }
    }
  } catch (e) {
    // Document sense header - normal
  }

  // ═══ 2. CAPTURAR BODY (Contingut Principal) ═══
  let bodyContent = "";

  // v5.4: CONTEXT EXPANDIT - Sempre obtenir tots els fills del body
  const allBodyElements = getAllChildElements(body);
  const totalElements = allBodyElements.length;

  // Determinar quins elements processar i quins estan seleccionats
  let elementsToProcess = [];
  let selectedIndices = new Set();

  if (isSelection && selectedElements && selectedElements.length > 0) {
    // Trobar els índexs dels elements seleccionats dins del body
    for (let i = 0; i < totalElements; i++) {
      const bodyEl = allBodyElements[i];
      for (const selEl of selectedElements) {
        // Comparar elements (poden ser el mateix o parent/child)
        if (bodyEl === selEl ||
            (selEl.getParent && selEl.getParent() === bodyEl) ||
            (bodyEl.getText && selEl.getText && bodyEl.getText() === selEl.getText())) {
          selectedIndices.add(i);
          break;
        }
      }
    }
  }

  // v17.6 FIX: SEMPRE processar tot el document per garantir índexs absoluts consistents
  // La selecció es marca amb ⟦SEL⟧ dins processElement
  for (let i = 0; i < totalElements; i++) {
    elementsToProcess.push({ element: allBodyElements[i], bodyIndex: i });
  }

  stats.total_elements = elementsToProcess.length;

  for (let i = 0; i < elementsToProcess.length; i++) {
    const { element, bodyIndex } = elementsToProcess[i];
    const isSelected = selectedIndices.has(bodyIndex);
    const result = processElement(element, globalIndex, mapIdToElement, stats, isSelected);
    if (result.content) {
      bodyContent += result.content;
      globalIndex = result.nextIndex;
    }
  }

  if (bodyContent.trim()) {
    sections.push(bodyContent);
  }

  // ═══ 3. CAPTURAR FOOTER (Peu de Pàgina) ═══
  try {
    const footer = doc.getFooter();
    if (footer) {
      const footerText = captureContainerContent(footer, 'FOOTER');
      if (footerText.text.trim()) {
        sections.push(`[PEU DE PÀGINA]\n${footerText.text}\n[/PEU DE PÀGINA]\n`);
        stats.captured_footer = true;
        stats.total_chars += footerText.chars;
      }
    }
  } catch (e) {
    // Document sense footer - normal
  }

  // ═══ 4. CAPTURAR FOOTNOTES (Notes al Peu) ═══
  try {
    const footnotes = doc.getFootnotes();
    if (footnotes && footnotes.length > 0) {
      let footnotesText = "[NOTES AL PEU]\n";
      footnotes.forEach((fn, idx) => {
        const fnContent = fn.getFootnoteContents();
        if (fnContent) {
          const fnText = fnContent.getText();
          if (fnText.trim()) {
            footnotesText += `[${idx + 1}] ${fnText.trim()}\n`;
            stats.footnotes_count++;
            stats.total_chars += fnText.length;
          }
        }
      });
      if (stats.footnotes_count > 0) {
        footnotesText += "[/NOTES AL PEU]\n";
        sections.push(footnotesText);
      }
    }
  } catch (e) {
    // Document sense footnotes - normal
  }

  // ═══ 5. GENERAR RESUM D'ELEMENTS INVISIBLES ═══
  let invisibleNote = "";
  if (stats.has_images || stats.has_drawings) {
    const items = [];
    if (stats.has_images) items.push("imatges");
    if (stats.has_drawings) items.push("dibuixos");
    invisibleNote = `\n[NOTA: El document conté ${items.join(" i ")} que no es poden mostrar com a text]\n`;
  }

  // ═══ 6. CONSTRUIR PAYLOAD FINAL ═══
  let contentPayload = sections.join("\n").trim();
  if (invisibleNote) {
    contentPayload += invisibleNote;
  }

  return {
    contentPayload: contentPayload || "[Document Buit]",
    mapIdToElement: mapIdToElement,
    stats: stats,
    isEmpty: !contentPayload.trim()
  };
}

/**
 * Processa un element individual i retorna el seu contingut formatat
 * v5.4: Afegit paràmetre isSelected per marcar elements seleccionats
 */
function processElement(element, currentIndex, mapIdToElement, stats, isSelected) {
  const elementType = element.getType();
  let content = "";
  let nextIndex = currentIndex;

  // v5.4: Marcador per elements seleccionats
  const selMarker = isSelected ? '⟦SEL⟧ ' : '';

  switch (elementType) {
    case DocumentApp.ElementType.PARAGRAPH:
      const pText = element.asText().getText();
      if (pText.trim().length > 0) {
        // Detectar si és un heading pel format
        const heading = element.getHeading();
        let prefix = "";
        if (heading === DocumentApp.ParagraphHeading.HEADING1) prefix = "# ";
        else if (heading === DocumentApp.ParagraphHeading.HEADING2) prefix = "## ";
        else if (heading === DocumentApp.ParagraphHeading.HEADING3) prefix = "### ";
        else if (heading === DocumentApp.ParagraphHeading.HEADING4) prefix = "#### ";

        content = `{{${currentIndex}}} ${selMarker}${prefix}${pText}\n`;
        mapIdToElement[currentIndex] = element;
        nextIndex = currentIndex + 1;
        stats.captured_paragraphs++;
        stats.total_chars += pText.length;
      }
      break;

    case DocumentApp.ElementType.LIST_ITEM:
      const liText = element.asText().getText();
      if (liText.trim().length > 0) {
        const nestingLevel = element.getNestingLevel() || 0;
        const indent = "  ".repeat(nestingLevel);
        const glyphType = element.getGlyphType();
        const bullet = (glyphType === DocumentApp.GlyphType.NUMBER) ?
          `${element.getListId()}.` : "•";

        content = `{{${currentIndex}}} ${selMarker}${indent}${bullet} ${liText}\n`;
        mapIdToElement[currentIndex] = element;
        nextIndex = currentIndex + 1;
        stats.captured_lists++;
        stats.total_chars += liText.length;
      }
      break;

    case DocumentApp.ElementType.TABLE:
      const tableText = convertTableToText(element.asTable());
      if (tableText.trim().length > 0) {
        content = `{{T:${currentIndex}}} [TAULA]\n${tableText}[/TAULA]\n`;
        // Taules són només lectura - no afegim a mapIdToElement
        nextIndex = currentIndex + 1;
        stats.captured_tables++;
        stats.total_chars += tableText.length;
      }
      break;

    case DocumentApp.ElementType.TABLE_OF_CONTENTS:
      try {
        const tocText = element.asTableOfContents().getText();
        if (tocText.trim()) {
          content = `{{TOC:${currentIndex}}} [ÍNDEX]\n${tocText}\n[/ÍNDEX]\n`;
          nextIndex = currentIndex + 1;
          stats.total_chars += tocText.length;
        }
      } catch (e) {}
      break;

    case DocumentApp.ElementType.INLINE_IMAGE:
      stats.has_images = true;
      content = `{{IMG:${currentIndex}}} [Imatge]\n`;
      nextIndex = currentIndex + 1;
      break;

    case DocumentApp.ElementType.INLINE_DRAWING:
      stats.has_drawings = true;
      content = `{{DRW:${currentIndex}}} [Dibuix]\n`;
      nextIndex = currentIndex + 1;
      break;

    case DocumentApp.ElementType.HORIZONTAL_RULE:
      content = `---\n`;
      break;

    case DocumentApp.ElementType.PAGE_BREAK:
      content = `[Salt de pàgina]\n`;
      break;

    default:
      // Intentar extreure text d'altres tipus
      try {
        if (element.asText) {
          const otherText = element.asText().getText();
          if (otherText && otherText.trim().length > 0) {
            content = `{{${currentIndex}}} ${otherText}\n`;
            mapIdToElement[currentIndex] = element;
            nextIndex = currentIndex + 1;
            stats.total_chars += otherText.length;
          }
        }
      } catch (e) {
        // Element sense text
      }
  }

  return { content, nextIndex };
}

/**
 * Captura el contingut d'un container (Header o Footer)
 */
function captureContainerContent(container, type) {
  let text = "";
  let chars = 0;

  const numChildren = container.getNumChildren();
  for (let i = 0; i < numChildren; i++) {
    const child = container.getChild(i);
    try {
      const childText = child.asText ? child.asText().getText() : '';
      if (childText && childText.trim()) {
        text += childText.trim() + "\n";
        chars += childText.length;
      }
    } catch (e) {
      // Element sense text
    }
  }

  return { text: text.trim(), chars };
}

/**
 * Obté tots els elements fills del body
 */
function getAllChildElements(body) {
  const elements = [];
  const numChildren = body.getNumChildren();
  for (let i = 0; i < numChildren; i++) {
    elements.push(body.getChild(i));
  }
  return elements;
}

/**
 * Converteix una taula de Google Docs a representació textual Markdown
 */
function convertTableToText(table) {
  const rows = table.getNumRows();
  if (rows === 0) return '';

  let text = '';

  for (let r = 0; r < rows; r++) {
    const row = table.getRow(r);
    const numCells = row.getNumCells();
    const cells = [];

    for (let c = 0; c < numCells; c++) {
      const cellText = row.getCell(c).getText().replace(/\n/g, ' ').trim();
      cells.push(cellText || ' ');
    }

    text += '| ' + cells.join(' | ') + ' |\n';

    // Separador després de la primera fila (header)
    if (r === 0) {
      text += '|' + cells.map(() => '---').join('|') + '|\n';
    }
  }

  return text;
}


/**
 * Envia mètriques de diagnòstic al Worker per analitzar patrons
 * S'executa de forma asíncrona sense bloquejar l'usuari
 * @param {Object} metrics - Les mètriques recollides pel collector
 */
function sendDiagnostic(metrics) {
  try {
    const settings = JSON.parse(getSettings());
    if (!settings.license_key) return;  // No enviar si no hi ha llicència

    const doc = DocumentApp.getActiveDocument();

    const payload = {
      action: 'log_diagnostic',
      license_key: settings.license_key,
      diagnostic: {
        doc_id: doc ? doc.getId() : null,
        session_id: Session.getTemporaryActiveUserKey(),  // Identificador de sessió
        timing: metrics.timing,
        document: metrics.document,
        request: metrics.request,
        response: metrics.response,
        errors: metrics.errors
      }
    };

    const options = {
      'method': 'post',
      'contentType': 'application/json',
      'payload': JSON.stringify(payload),
      'muteHttpExceptions': true
    };

    // Enviar de forma "fire and forget" - no esperem resposta
    UrlFetchApp.fetch(API_URL, options);
  } catch (e) {
    // Silently fail - no volem que errors de diagnòstic afectin l'usuari
    Logger.log('[DIAGNOSTIC] Error sending: ' + e.message);
  }
}

/**
 * Retorna diagnòstics del document actual per mostrar a l'usuari
 * Permet que l'usuari vegi què "veu" la IA
 */
function getDiagnostics() {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const selection = doc.getSelection();

    // Analitzar estructura completa
    const docStats = analyzeDocumentStructure(body);

    // Comptar elements amb contingut real (com ho fa processUserCommand)
    let contentElements = 0;
    let totalChars = 0;
    const numChildren = body.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
          child.getType() === DocumentApp.ElementType.LIST_ITEM) {
        const text = child.asText().getText();
        if (text.trim().length > 0) {
          contentElements++;
          totalChars += text.length;
        }
      }
    }

    // Determinar problemes potencials
    const issues = [];
    if (contentElements === 0) {
      issues.push({
        type: 'CRITICAL',
        message: 'El document apareix BUIT per la IA',
        detail: 'No hi ha paràgrafs ni llistes amb contingut de text'
      });
    }
    if (docStats.invisible.table > 0) {
      issues.push({
        type: 'WARNING',
        message: docStats.invisible.table + ' taula(es) invisible(s) per la IA',
        detail: 'Les taules no s\'envien a la IA - considera convertir a text'
      });
    }
    if (docStats.invisible.inline_image > 0) {
      issues.push({
        type: 'INFO',
        message: docStats.invisible.inline_image + ' imatge(s) al document',
        detail: 'Les imatges no es processen'
      });
    }

    return {
      ok: true,
      doc_name: doc.getName(),
      doc_id: doc.getId(),
      has_selection: !!selection,
      stats: {
        total_elements: docStats.total_children,
        visible_to_ai: contentElements,
        total_chars: totalChars,
        by_type: docStats.by_type
      },
      invisible: {
        tables: docStats.invisible.table,
        images: docStats.invisible.inline_image,
        other: docStats.invisible.footnote + docStats.invisible.other
      },
      issues: issues,
      ai_will_see: contentElements > 0 ? 'DOCUMENT_WITH_CONTENT' : 'DOCUMENT_EMPTY'
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message
    };
  }
}

// --- RECEIPTS (Custom Macros) ---

/**
 * Obté les receptes de l'usuari des del Worker
 */
function getReceiptsFromWorker() {
  const settings = JSON.parse(getSettings());
  if (!settings.license_key) return { receipts: [] };

  const payload = {
    action: 'get_receipts',
    license_key: settings.license_key
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      return { receipts: [] };
    }

    return { receipts: json.receipts || [] };
  } catch (e) {
    return { receipts: [] };
  }
}

/**
 * Guarda una nova recepta al Worker
 */
function saveReceiptToWorker(label, instruction, icon) {
  const settings = JSON.parse(getSettings());
  if (!settings.license_key) throw new Error("Falta llicència.");

  const payload = {
    action: 'save_receipt',
    license_key: settings.license_key,
    label: label,
    instruction: instruction,
    icon: icon || '⚡'
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      throw new Error(json.error_code || "Error guardant recepta");
    }

    return { success: true, receipt: json.receipt };
  } catch (e) {
    throw new Error("Error: " + e.message);
  }
}

/**
 * Elimina una recepta
 */
function deleteReceiptFromWorker(receiptId) {
  const settings = JSON.parse(getSettings());
  if (!settings.license_key) throw new Error("Falta llicència.");

  const payload = {
    action: 'delete_receipt',
    license_key: settings.license_key,
    receipt_id: receiptId
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      throw new Error(json.error_code || "Error eliminant recepta");
    }

    return { success: true };
  } catch (e) {
    throw new Error("Error: " + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED HIGHLIGHT SYSTEM v6.8
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sistema unificat per ressaltar elements al document
 * Substitueix: scrollToParagraph, scrollToReference, findAndHighlight
 *
 * @param {Object} options
 * @param {string} options.mode - 'bodyIndex' | 'elementId' | 'text'
 * @param {any} options.value - L'identificador segons el mode
 * @param {string} options.color - Color del highlight (default: '#a8d4ff')
 * @param {boolean} options.scroll - Si fer scroll (default: true)
 * @returns {Object} - {success: boolean, error?: string}
 */
function highlightElement(options) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const props = PropertiesService.getDocumentProperties();

    const mode = options.mode;
    const value = options.value;
    const color = options.color || '#a8d4ff';
    const scroll = options.scroll !== false;

    // 1. Netejar highlight anterior
    clearHighlight();

    // 2. Trobar element segons mode
    let element = null;
    let startOffset = -1;
    let endOffset = -1;
    let childIndex = -1;

    switch (mode) {
      case 'bodyIndex':
        // Índex directe del body (usat per UI estructura)
        if (value >= 0 && value < body.getNumChildren()) {
          element = body.getChild(value);
          childIndex = value;
        }
        break;

      case 'elementId':
        // ID del sistema {{0}}, {{1}} (usat per AI i lastEdit)
        const { map } = buildElementIndexMap(body);
        element = map[value];
        if (element) {
          const parent = element.getParent();
          if (parent && parent.getType() === DocumentApp.ElementType.BODY_SECTION) {
            childIndex = parent.getChildIndex(element);
          }
        }
        break;

      case 'text':
        // Cerca per text (usat per referències [[text]])
        let searchResult = body.findText(value);

        // Fallback: primeres paraules si no troba
        if (!searchResult && value.split(/\s+/).length > 3) {
          const partialSearch = value.split(/\s+/).slice(0, 4).join(' ');
          searchResult = body.findText(partialSearch);
        }

        if (searchResult) {
          element = searchResult.getElement();
          startOffset = searchResult.getStartOffset();
          endOffset = searchResult.getEndOffsetInclusive();
          try {
            const parent = element.getParent();
            if (parent && parent.getType() === DocumentApp.ElementType.BODY_SECTION) {
              childIndex = parent.getChildIndex(element);
            } else {
              // Element dins d'un altre contenidor, buscar el parent al body
              let current = element;
              while (current.getParent() &&
                     current.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) {
                current = current.getParent();
              }
              if (current.getParent()) {
                childIndex = current.getParent().getChildIndex(current);
              }
            }
          } catch (e) {}
        }
        break;

      default:
        return { success: false, error: 'Mode no vàlid: ' + mode };
    }

    if (!element) {
      return {
        success: false,
        error: mode === 'text' ? 'Text no trobat al document' : 'Element no trobat',
        searchedFor: mode === 'text' ? String(value).substring(0, 50) : undefined
      };
    }

    // 3. Aplicar highlight
    let textEl;
    try {
      textEl = element.asText();
    } catch (e) {
      return { success: false, error: 'Element no té text' };
    }

    const text = textEl.getText();
    const len = text.length;

    if (len > 0) {
      if (startOffset >= 0 && endOffset >= 0) {
        // Highlight parcial (només el text trobat)
        textEl.setBackgroundColor(startOffset, endOffset, color);
      } else {
        // Highlight complet de l'element
        textEl.setBackgroundColor(0, len - 1, color);
        startOffset = 0;
        endOffset = len - 1;
      }
    }

    // 4. Guardar per netejar després
    props.setProperty('activeHighlight', JSON.stringify({
      childIndex: childIndex,
      start: startOffset,
      end: endOffset
    }));

    // 5. Scroll si cal (v9.3: usar setCursor en lloc de setSelection per evitar selecció visual)
    if (scroll) {
      try {
        // setCursor fa scroll sense crear selecció visual prominent
        const position = doc.newPosition(element, 0);
        doc.setCursor(position);
      } catch (scrollErr) {
        // Fallback a setSelection si setCursor falla (alguns elements no ho suporten)
        try {
          const rangeBuilder = doc.newRange();
          rangeBuilder.addElement(element);
          doc.setSelection(rangeBuilder.build());
        } catch (e) {
          // Ignorar errors de scroll - el highlight ja s'ha aplicat
        }
      }
    }

    return { success: true };

  } catch (e) {
    console.error('[highlightElement] Error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * v16.4: Neteja el highlight d'un paràgraf específic per ID
 * @param {number} paraId - ID del paràgraf
 */
function clearHighlightByParaId(paraId) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    const targetId = parseInt(paraId, 10);
    const targetElement = mapIdToElement[targetId];

    if (targetElement) {
      const textObj = targetElement.asText();
      const textLen = textObj.getText().length;
      if (textLen > 0) {
        textObj.setBackgroundColor(0, textLen - 1, null);
      }
    }
  } catch (e) {
    console.warn('[clearHighlightByParaId] Error:', e);
  }
}

/**
 * Neteja el highlight actiu (qualsevol tipus)
 */
function clearHighlight() {
  try {
    const props = PropertiesService.getDocumentProperties();

    // Netejar highlight unificat
    const saved = props.getProperty('activeHighlight');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        const doc = DocumentApp.getActiveDocument();
        const body = doc.getBody();

        if (data.childIndex >= 0 && data.childIndex < body.getNumChildren()) {
          const element = body.getChild(data.childIndex);
          try {
            const text = element.asText();
            if (data.start >= 0 && data.end >= 0) {
              text.setBackgroundColor(data.start, data.end, null);
            }
          } catch (e) {}
        }
      } catch (e) {}
      props.deleteProperty('activeHighlight');
    }

    // Netejar també les properties antigues (compatibilitat)
    const oldHighlight = props.getProperty('highlightedParagraph');
    if (oldHighlight) {
      try {
        const doc = DocumentApp.getActiveDocument();
        const body = doc.getBody();
        const idx = parseInt(oldHighlight, 10);
        if (idx >= 0 && idx < body.getNumChildren()) {
          const element = body.getChild(idx);
          const text = element.asText();
          const len = text.getText().length;
          if (len > 0) text.setBackgroundColor(0, len - 1, null);
        }
      } catch (e) {}
      props.deleteProperty('highlightedParagraph');
    }

    const docRefHighlight = props.getProperty('docRefHighlight');
    if (docRefHighlight) {
      try {
        const data = JSON.parse(docRefHighlight);
        const doc = DocumentApp.getActiveDocument();
        const body = doc.getBody();
        if (data.childIndex >= 0 && data.childIndex < body.getNumChildren()) {
          const element = body.getChild(data.childIndex);
          element.asText().setBackgroundColor(data.start, data.end, null);
        }
      } catch (e) {}
      props.deleteProperty('docRefHighlight');
    }

    // v17.46: Netejar highlight de paràgraf (usat per highlightParagraphById)
    const highlightParaId = props.getProperty('highlight_para_id');
    if (highlightParaId) {
      try {
        const doc = DocumentApp.getActiveDocument();
        const body = doc.getBody();
        const { map: mapIdToElement } = buildElementIndexMap(body);
        const targetElement = mapIdToElement[highlightParaId] || mapIdToElement[String(highlightParaId)];
        if (targetElement) {
          const textObj = targetElement.asText();
          const len = textObj.getText().length;
          if (len > 0) textObj.setBackgroundColor(0, len - 1, null);
        }
      } catch (e) {}
      props.deleteProperty('highlight_para_id');
    }

  } catch (e) {
    // Ignorar errors de neteja
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY WRAPPERS (per compatibilitat - criden highlightElement)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// v10.3: APPLY PENDING REWRITE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aplica un rewrite que estava pendent de confirmació
 * @param {Array} blocks - Array de blocs {text, heading?} a aplicar
 * @param {boolean} isSelection - Si és una selecció o tot el document
 * @returns {Object} {ok: boolean, error?: string}
 */
function applyPendingRewrite(blocks, isSelection) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    if (!blocks || blocks.length === 0) {
      return { ok: false, error: 'No hi ha blocs per aplicar' };
    }

    const proposedContent = blocks.map(b => b.text).join('\n');

    // Capturar contingut original per undo
    let originalContent = '';
    const allElements = getEditableElements(body);
    originalContent = allElements.map(el => el.asText().getText()).join('\n');

    // Guardar undo snapshot
    saveLastEdit({
      type: 'rewrite',
      originalText: originalContent,
      currentText: proposedContent,
      isSelection: isSelection
    });

    // Aplicar el rewrite
    if (isSelection) {
      const selection = doc.getSelection();
      if (selection) {
        const elements = selection.getRangeElements();
        if (elements.length > 0) {
          elements[0].getElement().asText().setText(proposedContent);
        }
      } else {
        // Si no hi ha selecció activa, aplicar a tot el document
        renderFullDocument(body, blocks);
      }
    } else {
      renderFullDocument(body, blocks);
    }

    logDiagnostic('REWRITE_APPLIED_FROM_PREVIEW', {
      blocks_count: blocks.length,
      is_selection: isSelection
    });

    return { ok: true };
  } catch (error) {
    console.error('[applyPendingRewrite] Error:', error);
    return { ok: false, error: error.message };
  }
}

/**
 * v15.4: Ressaltar un paràgraf sencer per ID (usat quan el text s'ha eliminat)
 * v17.46: Afegit paràmetre colorName per diferenciar abans/després
 * @param {number} paragraphId - L'índex del paràgraf
 * @param {string} colorName - Nom del color ('lightBlue' per original, 'lightGreen' per acceptat)
 * @returns {Object} - {applied: number, error?: string}
 */
function highlightParagraphById(paragraphId, colorName) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    const targetId = parseInt(paragraphId, 10);
    const targetElement = mapIdToElement[targetId] || mapIdToElement[String(targetId)];

    if (!targetElement) {
      return { applied: 0, error: 'Paràgraf no trobat: ' + targetId };
    }

    // v17.46: Usar color passat o default a lightBlue (original)
    const color = REFERENCE_COLORS[colorName] || REFERENCE_COLORS.lightBlue;
    const textObj = targetElement.asText();
    const text = textObj.getText();

    if (text.length > 0) {
      textObj.setBackgroundColor(0, text.length - 1, color);

      // Guardar per poder netejar després
      const props = PropertiesService.getDocumentProperties();
      props.setProperty('highlight_para_id', String(targetId));

      return { applied: 1 };
    }

    return { applied: 0, error: 'Paràgraf buit' };
  } catch (e) {
    console.error('[highlightParagraphById] Error:', e);
    return { applied: 0, error: e.message };
  }
}

/**
 * @deprecated Usar highlightElement({mode:'bodyIndex', value:idx})
 * Mantingut per compatibilitat amb crides existents
 */
function scrollToParagraph(paragraphIndex) {
  return highlightElement({ mode: 'bodyIndex', value: paragraphIndex });
}

/**
 * @deprecated Usar clearHighlight()
 */
function clearStructureHighlight() {
  clearHighlight();
}

// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENT REFERENCES v6.7 - Referències Vives (Legacy Wrappers)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @deprecated Usar highlightElement({mode:'text', value:searchText})
 */
function findAndHighlight(searchText) {
  if (!searchText || searchText.trim().length < 2) {
    return { success: false, error: 'Text de cerca massa curt' };
  }
  return highlightElement({ mode: 'text', value: searchText });
}

/**
 * @deprecated Usar clearHighlight()
 */
function clearDocRefHighlight() {
  clearHighlight();
}

/**
 * Cerca text amb fallback a clipboard si no troba
 */
function findInDocumentWithFallback(searchText) {
  const result = highlightElement({ mode: 'text', value: searchText });

  if (!result.success) {
    return {
      success: false,
      fallback: 'clipboard',
      textToCopy: searchText,
      message: 'Text no trobat. Usa Ctrl+F per buscar manualment.'
    };
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// REFERENCE HIGHLIGHTING v7.1 - Suport parcial + sense límit
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aplica highlights de referència al document (v7.1 - Suport parcial)
 * @param {Array} highlights - Array de {para_id, color, reason, start?, end?}
 * @returns {Object} - {success, applied, errors}
 */
function applyReferenceHighlights(highlights) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const results = { applied: 0, errors: [], partial: 0 };
    const highlightedIndices = [];
    const highlightDetails = [];  // v7.1: Guardem detalls per neteja precisa

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    for (const hl of highlights) {
      try {
        const element = mapIdToElement[hl.para_id];

        if (!element) {
          results.errors.push('Paràgraf ' + hl.para_id + ' no trobat');
          continue;
        }

        const textObj = element.editAsText();
        const fullText = textObj.getText();
        const textLength = fullText.length;

        if (textLength === 0) continue;

        // v7.1: Determinar rang de highlight (parcial o complet)
        let startPos = 0;
        let endPos = textLength - 1;

        if (typeof hl.start === 'number' && typeof hl.end === 'number') {
          // Highlight parcial per posició - validar límits
          startPos = Math.max(0, Math.min(hl.start, textLength - 1));
          endPos = Math.max(startPos, Math.min(hl.end - 1, textLength - 1));
          results.partial++;
        } else if (hl.snippet && typeof hl.snippet === 'string' && hl.snippet.length > 0) {
          // v14.5: Highlight parcial per snippet - buscar text dins del paràgraf
          const snippetPos = fullText.indexOf(hl.snippet);
          if (snippetPos !== -1) {
            startPos = snippetPos;
            endPos = snippetPos + hl.snippet.length - 1;
            results.partial++;
          }
          // Si no es troba el snippet, ressalta tot el paràgraf (fallback)
        }

        // Aplicar color de fons
        const color = REFERENCE_COLORS[hl.color] || REFERENCE_COLORS.yellow;
        textObj.setBackgroundColor(startPos, endPos, color);

        highlightedIndices.push(hl.para_id);
        // v7.1: Guardar detalls complets per neteja precisa
        highlightDetails.push({
          para_id: hl.para_id,
          start: startPos,
          end: endPos
        });
        results.applied++;

      } catch (e) {
        results.errors.push('Error a paràgraf ' + hl.para_id + ': ' + e.message);
      }
    }

    // Guardar índexs i detalls per netejar després
    if (highlightedIndices.length > 0) {
      const props = PropertiesService.getDocumentProperties();
      props.setProperty('referenceHighlights', JSON.stringify(highlightedIndices));
      props.setProperty('referenceHighlightDetails', JSON.stringify(highlightDetails));  // v7.1
    }

    results.success = results.applied > 0;
    return results;

  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Neteja tots els highlights de referència (v7.1 - Suport parcial)
 * @returns {Object} - {success, cleared}
 */
function clearReferenceHighlights() {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const props = PropertiesService.getDocumentProperties();

    const savedIndices = props.getProperty('referenceHighlights');
    const savedDetails = props.getProperty('referenceHighlightDetails');  // v7.1
    if (!savedIndices) return { success: true, cleared: 0 };

    const indices = JSON.parse(savedIndices);
    const details = savedDetails ? JSON.parse(savedDetails) : null;  // v7.1

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    let cleared = 0;

    // v7.1: Si tenim detalls, usem neteja precisa; sinó, neteja completa
    if (details && Array.isArray(details)) {
      for (const detail of details) {
        try {
          const element = mapIdToElement[detail.para_id];
          if (element && element.editAsText) {
            const textObj = element.editAsText();
            const len = textObj.getText().length;
            if (len > 0) {
              // Netejar el rang específic (o tot si no hi ha detalls)
              const startPos = detail.start || 0;
              const endPos = detail.end !== undefined ? detail.end : len - 1;
              textObj.setBackgroundColor(startPos, Math.min(endPos, len - 1), null);
              cleared++;
            }
          }
        } catch (e) {
          // Ignorar errors individuals
        }
      }
    } else {
      // Fallback: neteja tot el paràgraf (comportament antic)
      for (const idx of indices) {
        try {
          const element = mapIdToElement[idx];
          if (element && element.editAsText) {
            const textObj = element.editAsText();
            const len = textObj.getText().length;
            if (len > 0) {
              textObj.setBackgroundColor(0, len - 1, null);
              cleared++;
            }
          }
        } catch (e) {
          // Ignorar errors individuals
        }
      }
    }

    props.deleteProperty('referenceHighlights');
    props.deleteProperty('referenceHighlightDetails');  // v7.1
    return { success: true, cleared: cleared };

  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// v9.0: PROACTIVE HIGHLIGHTING SYSTEM
// ═══════════════════════════════════════════════════════════════
// Highlights text snippets from AI response in the document
// Uses text search to find exact matches

/**
 * Color palette for proactive highlights (subtle blue tones)
 */
const PROACTIVE_HIGHLIGHT_COLOR = '#b3e0ff';  // Light cyan-blue for proactive highlights

/**
 * Apply proactive highlights from AI response
 * @param {Array} highlights - Array of {text, para_id, start, end, confidence}
 * @returns {Object} - {success, applied, errors}
 */
function applyProactiveHighlights(highlights) {
  try {
    if (!highlights || !Array.isArray(highlights) || highlights.length === 0) {
      return { success: true, applied: 0, skipped: 'no highlights' };
    }

    // v9.0 FIX: Clear any existing proactive highlights before applying new ones
    // This prevents accumulation if user sends messages quickly
    try {
      clearProactiveHighlights();
    } catch (e) {
      // Ignore cleanup errors, continue with new highlights
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const results = { applied: 0, errors: [], notFound: [] };
    const highlightDetails = [];

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    for (const hl of highlights) {
      try {
        // Strategy 1: Use para_id + start/end if available (most precise)
        if (hl.para_id !== null && typeof hl.start === 'number' && typeof hl.end === 'number') {
          const element = mapIdToElement[hl.para_id];
          if (element) {
            const textObj = element.editAsText();
            const textLength = textObj.getText().length;

            if (textLength > 0) {
              const startPos = Math.max(0, Math.min(hl.start, textLength - 1));
              const endPos = Math.max(startPos, Math.min(hl.end - 1, textLength - 1));

              textObj.setBackgroundColor(startPos, endPos, PROACTIVE_HIGHLIGHT_COLOR);
              highlightDetails.push({
                para_id: hl.para_id,
                start: startPos,
                end: endPos,
                text: hl.text
              });
              results.applied++;
              continue;
            }
          }
        }

        // Strategy 2: Search by text content (fallback)
        if (hl.text && hl.text.length >= 3) {
          // Try original text first, then normalized text for fuzzy matches
          let searchResult = body.findText(hl.text);

          // v9.0 FIX: If not found and we have normalized_text (fuzzy match), try that
          if (!searchResult && hl.normalized_text) {
            searchResult = body.findText(hl.normalized_text);
          }

          if (searchResult) {
            const element = searchResult.getElement();
            const startOffset = searchResult.getStartOffset();
            const endOffset = searchResult.getEndOffsetInclusive();

            // v9.0 FIX: Use asText() to ensure we have the Text object methods
            element.asText().setBackgroundColor(startOffset, endOffset, PROACTIVE_HIGHLIGHT_COLOR);

            // Find childIndex for cleanup
            let childIndex = -1;
            try {
              let current = element;
              while (current.getParent() &&
                     current.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) {
                current = current.getParent();
              }
              if (current.getParent()) {
                childIndex = current.getParent().getChildIndex(current);
              }
            } catch (e) {}

            highlightDetails.push({
              childIndex: childIndex,
              start: startOffset,
              end: endOffset,
              text: hl.text
            });
            results.applied++;
          } else {
            results.notFound.push(hl.text.substring(0, 30));
          }
        }

      } catch (e) {
        results.errors.push('Error highlighting: ' + e.message);
      }
    }

    // Store for cleanup
    if (highlightDetails.length > 0) {
      const props = PropertiesService.getDocumentProperties();
      props.setProperty('proactiveHighlights', JSON.stringify(highlightDetails));
    }

    // Scroll to first highlight if any applied
    if (results.applied > 0 && highlightDetails.length > 0) {
      try {
        const first = highlightDetails[0];
        let scrollElement = null;

        // v9.2 FIX: Try para_id first (Strategy 1), then childIndex (Strategy 2)
        if (first.para_id !== undefined && first.para_id !== null) {
          scrollElement = mapIdToElement[first.para_id];
        } else if (first.childIndex !== undefined && first.childIndex >= 0) {
          scrollElement = body.getChild(first.childIndex);
        }

        if (scrollElement) {
          const position = doc.newPosition(scrollElement, 0);
          doc.setCursor(position);
        }
      } catch (scrollErr) {
        // Ignore scroll errors
      }
    }

    results.success = results.applied > 0;
    return results;

  } catch (e) {
    console.error('[applyProactiveHighlights] Error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Clear all proactive highlights
 * @returns {Object} - {success, cleared}
 */
function clearProactiveHighlights() {
  try {
    const props = PropertiesService.getDocumentProperties();
    const saved = props.getProperty('proactiveHighlights');

    if (!saved) return { success: true, cleared: 0 };

    const details = JSON.parse(saved);
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    let cleared = 0;

    // v17.5: Usar funció auxiliar consistent amb captureFullDocument/processElement
    const { map: mapIdToElement } = buildElementIndexMap(body);

    for (const detail of details) {
      try {
        let element = null;
        let startPos = detail.start;
        let endPos = detail.end;

        // Strategy 1: Find element by para_id (most reliable)
        if (detail.para_id !== undefined && detail.para_id !== null) {
          element = mapIdToElement[detail.para_id];
        }

        // Strategy 2: Find by childIndex (less reliable, document may have changed)
        if (!element && detail.childIndex !== undefined && detail.childIndex >= 0) {
          if (detail.childIndex < body.getNumChildren()) {
            element = body.getChild(detail.childIndex);
          }
        }

        // Strategy 3: If we have the text, search for it (most robust fallback)
        if (!element && detail.text && detail.text.length >= 3) {
          const searchResult = body.findText(detail.text);
          if (searchResult) {
            element = searchResult.getElement();
            startPos = searchResult.getStartOffset();
            endPos = searchResult.getEndOffsetInclusive();
          }
        }

        // Clear the highlight if we found the element
        if (element) {
          const textObj = element.editAsText ? element.editAsText() : element.asText();
          const len = textObj.getText().length;

          if (len > 0) {
            // If we have specific positions, use them; otherwise clear whole element
            if (startPos !== undefined && startPos !== null &&
                endPos !== undefined && endPos !== null) {
              const safeStart = Math.max(0, Math.min(startPos, len - 1));
              const safeEnd = Math.max(safeStart, Math.min(endPos, len - 1));
              textObj.setBackgroundColor(safeStart, safeEnd, null);
            } else {
              // Fallback: clear entire element background
              textObj.setBackgroundColor(0, len - 1, null);
            }
            cleared++;
          }
        }
      } catch (e) {
        // Ignore individual errors - continue with next highlight
      }
    }

    props.deleteProperty('proactiveHighlights');
    return { success: true, cleared: cleared };

  } catch (e) {
    console.error('[clearProactiveHighlights] Error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * Highlight a single text snippet by searching (for click-to-reactivate)
 * @param {string} text - The text to find and highlight
 * @returns {Object} - {success, ...}
 */
function highlightTextSnippet(text) {
  // v9.0 FIX: Clear existing proactive highlights before applying new one
  try {
    clearProactiveHighlights();
  } catch (e) {
    // Ignore cleanup errors
  }

  // Apply new highlight
  const result = highlightElement({
    mode: 'text',
    value: text,
    color: PROACTIVE_HIGHLIGHT_COLOR,
    scroll: true
  });

  // Store this single highlight for future cleanup
  if (result.success) {
    try {
      const props = PropertiesService.getDocumentProperties();
      // highlightElement already stores in 'activeHighlight', but we also track as proactive
      const activeData = props.getProperty('activeHighlight');
      if (activeData) {
        props.setProperty('proactiveHighlights', '[' + activeData + ']');
      }
    } catch (e) {
      // Ignore storage errors
    }
  }

  return result;
}

/**
 * @deprecated Usar highlightElement({mode:'elementId', value:id, color:color})
 * Scroll a un paràgraf per ID del sistema {{0}}, {{1}}
 */
function scrollToReference(paragraphIndex, color) {
  // Convertir color de nom a hex si cal
  const hexColor = REFERENCE_COLORS[color] || color || '#a8d4ff';
  return highlightElement({ mode: 'elementId', value: paragraphIndex, color: hexColor });
}

// ═══════════════════════════════════════════════════════════
// v13.4: SISTEMA LÀSER DE PRECISIÓ AMB TRIPLE FALLBACK
// ═══════════════════════════════════════════════════════════
// Ressalta fragments ESPECÍFICS dins de paràgrafs, no paràgrafs sencers

const LASER_HIGHLIGHT_COLOR = '#FFF59D'; // Groc intens per coincidència exacta
const LASER_WORD_COLOR = '#FFE082';      // Groc mig per coincidència de paraula
const LASER_FALLBACK_COLOR = '#FFF9C4';  // Groc suau per fallback a paràgraf

/**
 * v13.4: Ressalta fragments específics dins de paràgrafs
 * Format entrada: [{id: 12, text: "50.000€"}, {id: 15, text: "30 dies"}]
 *
 * TRIPLE FALLBACK:
 * 1. Cerca EXACTA → groc intens
 * 2. Cerca CASE-INSENSITIVE → groc intens
 * 3. Cerca per PARAULES clau → groc mig
 * 4. Fallback a paràgraf sencer → groc suau
 *
 * @param {Array<{id: number, text: string}>} references - Llista de referències
 * @returns {Object} - { success, applied, wordMatches, fallbacks }
 */
function highlightLaserPrecision(references) {
  if (!references || references.length === 0) {
    return { success: false, error: 'No references provided' };
  }

  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const numChildren = body.getNumChildren();

    let applied = 0;
    let wordMatches = 0;
    let fallbacks = 0;
    let firstMatchPosition = null;
    const highlightDetails = [];

    for (const ref of references) {
      const paraId = ref.id;
      const searchText = ref.text;

      // Validació de límits
      if (paraId < 0 || paraId >= numChildren) {
        console.log('[Laser] Skip: paraId ' + paraId + ' out of bounds (max: ' + numChildren + ')');
        continue;
      }

      try {
        const element = body.getChild(paraId);
        if (!element) continue;

        let textObj = null;
        try {
          textObj = element.asText();
        } catch (e) {
          continue;
        }

        const fullText = textObj.getText();
        if (!fullText || fullText.length === 0) continue;

        // Intentar trobar el text dins del paràgraf
        if (searchText && searchText.length > 0) {
          let foundIndex = -1;
          let matchedText = searchText;
          let matchType = 'exact';

          // 1. Cerca EXACTA
          foundIndex = fullText.indexOf(searchText);

          // 2. Si falla, cerca CASE-INSENSITIVE
          if (foundIndex === -1) {
            foundIndex = fullText.toLowerCase().indexOf(searchText.toLowerCase());
            if (foundIndex !== -1) {
              matchedText = fullText.substring(foundIndex, foundIndex + searchText.length);
              matchType = 'case-insensitive';
            }
          }

          // 3. Si encara falla, cerca per PARAULES clau (mín 3 caràcters)
          if (foundIndex === -1) {
            const words = searchText.split(/\s+/).filter(function(w) { return w.length > 2; });
            for (let i = 0; i < words.length; i++) {
              const word = words[i];
              const wordLower = word.toLowerCase();
              const fullTextLower = fullText.toLowerCase();
              const wordIndex = fullTextLower.indexOf(wordLower);
              if (wordIndex !== -1) {
                foundIndex = wordIndex;
                matchedText = fullText.substring(wordIndex, wordIndex + word.length);
                matchType = 'word';
                break;
              }
            }
          }

          if (foundIndex !== -1) {
            // PRECISIÓ: Ressaltar NOMÉS el fragment exacte
            const startOffset = foundIndex;
            const endOffset = foundIndex + matchedText.length - 1;
            const highlightColor = matchType === 'word' ? LASER_WORD_COLOR : LASER_HIGHLIGHT_COLOR;

            textObj.setBackgroundColor(startOffset, endOffset, highlightColor);

            if (matchType === 'word') {
              wordMatches++;
            } else {
              applied++;
            }

            // Guardar detalls per netejar
            highlightDetails.push({
              childIndex: paraId,
              start: startOffset,
              end: endOffset
            });

            // Guardar posició per scroll (primera trobada)
            if (!firstMatchPosition) {
              firstMatchPosition = doc.newPosition(textObj, startOffset);
            }

            console.log('[Laser] Match (' + matchType + '): "' + matchedText + '" at para ' + paraId);
          } else {
            // FALLBACK: Text no trobat, ressaltar tot el paràgraf amb color suau
            textObj.setBackgroundColor(0, fullText.length - 1, LASER_FALLBACK_COLOR);
            fallbacks++;

            highlightDetails.push({
              childIndex: paraId,
              start: 0,
              end: fullText.length - 1
            });

            if (!firstMatchPosition) {
              firstMatchPosition = doc.newPosition(element, 0);
            }

            console.log('[Laser] Fallback: "' + searchText + '" not found in para ' + paraId);
          }
        } else {
          // Sense text, ressaltar tot el paràgraf
          textObj.setBackgroundColor(0, fullText.length - 1, LASER_HIGHLIGHT_COLOR);
          fallbacks++;

          highlightDetails.push({
            childIndex: paraId,
            start: 0,
            end: fullText.length - 1
          });

          if (!firstMatchPosition) {
            firstMatchPosition = doc.newPosition(element, 0);
          }
        }
      } catch (e) {
        console.error('[Laser] Error processing para ' + paraId + ':', e);
        continue;
      }
    }

    // Guardar per netejar després
    if (highlightDetails.length > 0) {
      const props = PropertiesService.getDocumentProperties();
      props.setProperty('laserHighlights', JSON.stringify(highlightDetails));
    }

    // Scroll a la primera coincidència
    if (firstMatchPosition) {
      try {
        doc.setCursor(firstMatchPosition);
      } catch (e) {
        // Fallback amb Range
        try {
          if (highlightDetails.length > 0) {
            const firstChild = body.getChild(highlightDetails[0].childIndex);
            const rangeBuilder = doc.newRange();
            rangeBuilder.addElement(firstChild);
            doc.setSelection(rangeBuilder.build());
          }
        } catch (e2) {
          // Ignorar
        }
      }
    }

    return {
      success: true,
      applied: applied,
      wordMatches: wordMatches,
      fallbacks: fallbacks,
      total: references.length
    };

  } catch (e) {
    console.error('[highlightLaserPrecision] Error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * v13.4: Neteja tots els ressaltats làser
 * @returns {Object} - { success, cleared }
 */
function clearLaserHighlights() {
  try {
    const props = PropertiesService.getDocumentProperties();
    const saved = props.getProperty('laserHighlights');

    if (!saved) {
      return { success: true, cleared: 0 };
    }

    const highlightDetails = JSON.parse(saved);
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    let cleared = 0;

    for (const detail of highlightDetails) {
      try {
        if (detail.childIndex >= 0 && detail.childIndex < body.getNumChildren()) {
          const element = body.getChild(detail.childIndex);
          const textObj = element.asText();
          const text = textObj.getText();

          if (text && text.length > 0) {
            const endPos = Math.min(detail.end, text.length - 1);
            textObj.setBackgroundColor(detail.start, endPos, null);
            cleared++;
          }
        }
      } catch (e) {
        // Ignorar errors individuals
      }
    }

    props.deleteProperty('laserHighlights');
    return { success: true, cleared: cleared };

  } catch (e) {
    console.error('[clearLaserHighlights] Error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * v13.6: Neteja TOTS els tipus de highlights del document
 * Cridat automàticament quan l'usuari envia un nou missatge
 * @returns {Object} - {success, cleared}
 */
function clearAllHighlights() {
  let totalCleared = 0;
  const errors = [];

  try {
    // 1. Netejar highlights de referència (REFERENCE_HIGHLIGHT mode)
    try {
      const ref = clearReferenceHighlights();
      if (ref.cleared) totalCleared += ref.cleared;
    } catch (e) {
      errors.push('ref: ' + e.message);
    }

    // 2. Netejar highlights proactius (CHAT_ONLY mode)
    try {
      const proactive = clearProactiveHighlights();
      if (proactive.cleared) totalCleared += proactive.cleared;
    } catch (e) {
      errors.push('proactive: ' + e.message);
    }

    // 3. Netejar highlights laser (clics interactius)
    try {
      const laser = clearLaserHighlights();
      if (laser.cleared) totalCleared += laser.cleared;
    } catch (e) {
      errors.push('laser: ' + e.message);
    }

    // 4. Netejar highlight actiu unificat
    try {
      clearHighlight();
    } catch (e) {
      errors.push('unified: ' + e.message);
    }

    return { success: true, cleared: totalCleared, errors: errors.length > 0 ? errors : null };
  } catch (e) {
    console.error('[clearAllHighlights] Error:', e);
    return { success: false, error: e.message };
  }
}

/**
 * v13.0: Focus manual en un element específic (per clics als xips del xat)
 * @param {number} id - ID del paràgraf (0-indexed)
 * @param {string} text - Text exacte a ressaltar
 * @returns {Object} - { success }
 */
function focusLaserElement(id, text) {
  // Netejar ressaltats anteriors
  clearLaserHighlights();

  // Ressaltar el nou element
  return highlightLaserPrecision([{ id: id, text: text }]);
}

// Aliases per compatibilitat amb codi anterior
function highlightInteractiveBatch(ids) {
  // Convertir format antic a nou (sense text específic = fallback)
  const refs = ids.map(id => ({ id: id, text: null }));
  return highlightLaserPrecision(refs);
}

function clearInteractiveBatch() {
  return clearLaserHighlights();
}

function focusSingleParagraph(id) {
  return focusLaserElement(id, null);
}

// --- CONTEXT SUMMARY (v2.5) ---

/**
 * Retorna un resum lleuger del context del document
 * Més ràpid que getDocSkeleton() per UI inicial
 */
function getContextSummary() {
  try {
    const skeleton = getDocSkeleton();
    if (!skeleton || skeleton.error) {
      return {
        headings: 0,
        sections: 0,
        visual_headings: 0,
        has_suggestions: false,
        suggestion_text: null
      };
    }

    let headings = 0;
    let visualHeadings = 0;
    let sections = 0;

    skeleton.structure.forEach(function(item) {
      if (item.type === 'SECTION') {
        sections++;
      } else if (item.type === 'VISUAL_H' || item.type === 'BOLD_H') {
        visualHeadings++;
      } else if (item.type !== 'WARNING') {
        headings++;
      }
    });

    const hasSuggestions = (headings === 0 && visualHeadings > 0);
    const suggestionText = hasSuggestions
      ? 'Detectats ' + visualHeadings + ' títols sense format. Usa Auto-Structure!'
      : null;

    return {
      headings: headings,
      sections: sections,
      visual_headings: visualHeadings,
      has_suggestions: hasSuggestions,
      suggestion_text: suggestionText,
      scan_time_ms: skeleton.stats ? skeleton.stats.scan_time_ms : 0
    };
  } catch (e) {
    return {
      headings: 0,
      sections: 0,
      visual_headings: 0,
      has_suggestions: false,
      suggestion_text: null,
      error: e.message
    };
  }
}

// --- EVENT SOURCING (v3.0) ---

/**
 * Obté l'historial d'edicions del document actual
 */
function getEditHistory(limit) {
  const doc = DocumentApp.getActiveDocument();
  if (!doc) return { events: [], error: "No hi ha document actiu" };

  const settings = JSON.parse(getSettings());
  if (!settings.license_key) return { events: [], error: "Falta llicència" };

  const payload = {
    action: 'get_edit_history',
    license_key: settings.license_key,
    doc_id: doc.getId(),
    limit: limit || 20
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      return { events: [], error: json.error_code || "Error obtenint historial" };
    }

    return { events: json.events || [], count: json.count || 0 };
  } catch (e) {
    return { events: [], error: e.message };
  }
}

/**
 * v16.1: Guarda un canvi aplicat a l'historial persistent
 * @param {Object} editData - {target_id, before_text, after_text, instruction, reason}
 * @returns {Object} {ok, event_id, error}
 */
function saveAppliedEdit(editData) {
  const doc = DocumentApp.getActiveDocument();
  if (!doc) return { ok: false, error: "No hi ha document actiu" };

  const settings = JSON.parse(getSettings());
  if (!settings.license_key) return { ok: false, error: "Falta llicència" };

  const payload = {
    action: 'save_applied_edit',
    license_key: settings.license_key,
    doc_id: doc.getId(),
    target_id: editData.target_id,
    before_text: editData.before_text,
    after_text: editData.after_text,
    instruction: editData.instruction,
    reason: editData.reason
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      return { ok: false, error: json.error || "Error guardant event" };
    }

    return { ok: true, event_id: json.event_id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Reverteix una edició específica per ID d'event
 */
function revertEditById(eventId) {
  const doc = DocumentApp.getActiveDocument();
  if (!doc) return { success: false, error: "No hi ha document actiu" };

  const settings = JSON.parse(getSettings());
  if (!settings.license_key) return { success: false, error: "Falta llicència" };

  const payload = {
    action: 'revert_edit',
    license_key: settings.license_key,
    doc_id: doc.getId(),
    event_id: eventId
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      return { success: false, error: json.error_code || "Error revertint edició" };
    }

    // Apply the revert to the document
    if (json.restore_text !== null && json.target_id !== null) {
      const body = doc.getBody();
      const targetId = parseInt(json.target_id, 10);

      // Rebuild element map (same logic as processUserCommand)
      let elementsToProcess = [];
      const numChildren = body.getNumChildren();
      for (let i = 0; i < numChildren; i++) {
        const child = body.getChild(i);
        if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
            child.getType() === DocumentApp.ElementType.LIST_ITEM) {
          elementsToProcess.push(child);
        }
      }

      // Find target element by ID
      let targetElement = null;
      let currentIndex = 0;
      for (let i = 0; i < elementsToProcess.length; i++) {
        const el = elementsToProcess[i];
        const text = el.asText().getText();
        if (text.trim().length > 0) {
          if (currentIndex === targetId) {
            targetElement = el;
            break;
          }
          currentIndex++;
        }
      }

      if (targetElement) {
        targetElement.asText().setText(json.restore_text);
        // v8.2: Invalidar cache
        invalidateCaptureCache();
        // v16.8: Retornar targetId per poder netejar highlight
        return { success: true, restored: true, targetId: targetId };
      } else {
        return { success: false, error: "No s'ha trobat el paràgraf" };
      }
    }

    return { success: true, restored: false };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// GENERIC WORKER CALL (v5.0 - Conversations)
// ═══════════════════════════════════════════════════════════════

/**
 * Generic function to call worker endpoints
 * Used for conversations and other simple API calls
 * @param {Object} payload - The payload to send to the worker
 * @return {Object} - The response from the worker
 */
function callWorker(payload) {
  // v5.1 fix: Use license_key from payload if available, otherwise read from settings
  let licenseKey = payload.license_key;

  if (!licenseKey) {
    // Fallback: read from DOCMILE_SETTINGS
    const props = PropertiesService.getUserProperties();
    const settingsJson = props.getProperty('DOCMILE_SETTINGS');

    if (settingsJson) {
      try {
        const settings = JSON.parse(settingsJson);
        licenseKey = settings.license_key;
      } catch (e) {
        // Invalid JSON
      }
    }
  }

  if (!licenseKey) {
    throw new Error("Llicència no configurada");
  }

  // Hash the license key for privacy
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, licenseKey);
  const licenseKeyHash = hash.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');

  const fullPayload = {
    ...payload,
    license_key_hash: licenseKeyHash
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(fullPayload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200) {
      throw new Error(json.error_code || "Error comunicant amb el servidor");
    }

    return json;
  } catch (e) {
    throw new Error("Error: " + e.message);
  }
}
