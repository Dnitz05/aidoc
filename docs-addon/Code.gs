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
  props.deleteProperty('DOCMILE_FILE_URI');
  props.deleteProperty('DOCMILE_FILE_NAME');
  props.deleteProperty('DOCMILE_FILE_MIME');
  props.deleteProperty('DOCMILE_ACTIVE_LIBRARY_FILE');
  return "Fitxer oblidat.";
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
      const mapIdToElement = buildElementMap(body);
      targetElement = mapIdToElement[targetId];
    }

    if (!targetElement) {
      return { success: false, error: "No s'ha trobat el paràgraf original." };
    }

    // Revertir al text original
    targetElement.asText().setText(lastEdit.originalText);

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
 * @param {string} targetId - L'ID del paràgraf a restaurar
 * @param {string} originalText - El text original a restaurar
 * @returns {Object} { status: 'restored' } o { status: 'error', error: string }
 */
function restoreText(targetId, originalText, bodyIndex) {
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
      const mapIdToElement = buildElementMap(body);
      targetElement = mapIdToElement[numericId];
    }

    if (!targetElement) {
      return { status: 'error', error: 'No s\'ha trobat el paràgraf' };
    }

    // Restaurar el text original
    targetElement.asText().setText(originalText);

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

    if (!selection) {
      return { captured: false, hasSelection: false, wordCount: 0 };
    }

    const ranges = selection.getRangeElements() || [];
    if (ranges.length === 0) {
      return { captured: false, hasSelection: false, wordCount: 0 };
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
      return { captured: false, hasSelection: true, wordCount: wordCount, textPreview: textPreview };
    }

    // Guardar al cache (60 segons de vida)
    const cache = CacheService.getUserCache();
    cache.put('docmile_selection', JSON.stringify({
      docId: doc.getId(),
      timestamp: Date.now(),
      elements: selectionData
    }), 60);

    return { captured: true, hasSelection: true, wordCount: wordCount, textPreview: textPreview, elements: selectionData.length };

  } catch (e) {
    return { captured: false, hasSelection: false, wordCount: 0, error: e.message };
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
  const activeFilesResult = getActiveKnowledgeFiles();
  const knowledgeFiles = activeFilesResult.files || [];

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
    // v8.2 FIX: Cache HIT - només construir mapIdToElement (operació lleugera)
    // NO cridem captureFullDocument per estalviar temps
    const lightweightMap = buildElementMap(body);
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

  const payload = {
    license_key: settings.license_key,
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
      // v3.7: Log resposta CHAT_ONLY
      const responseInfo = {
        mode: 'CHAT_ONLY',
        has_chat_response: !!(aiData.chat_response || aiData.change_summary),
        response_length: (aiData.chat_response || aiData.change_summary || '').length,
        credits_remaining: json.credits_remaining
      };
      metrics.setResponseInfo(responseInfo);
      logDiagnostic('RESPONSE', {
        mode: 'CHAT_ONLY',
        response_preview: (aiData.chat_response || aiData.change_summary || '').substring(0, 100),
        doc_was_empty: isDocumentEmpty,
        user_wanted: userMode
      });
      metrics.finalize();

      return {
        ok: true,
        ai_response: aiData.chat_response || aiData.change_summary,
        credits: json.credits_remaining,
        mode: 'chat',
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
      // v3.8: Preview Mode - IN-DOCUMENT preview (Track Changes style)
      if (previewMode) {
        const changes = [];

        for (const [id, newText] of Object.entries(aiData.updates)) {
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

        // If no changes found (IDs don't match), fall back to normal mode
        if (changes.length === 0) {
          logDiagnostic('WARNING', {
            issue: 'PREVIEW_NO_CHANGES',
            updates_from_ai: Object.keys(aiData.updates).length,
            map_ids_available: Object.keys(mapIdToElement).length
          });
          // Fall through to apply directly
        } else {
          // v3.8: Aplicar preview VISUAL al document (Track Changes)
          // v5.3: Passar mapIdToElement per mantenir consistència amb seleccions
          const previewResult = applyInDocumentPreview(changes, mapIdToElement);

          if (!previewResult.ok) {
            // Si falla el preview in-doc, retornem error
            logDiagnostic('ERROR', {
              issue: 'IN_DOC_PREVIEW_FAILED',
              error: previewResult.error
            });
            return {
              ok: false,
              error: previewResult.error || "Error aplicant preview"
            };
          }

          // Log resposta PREVIEW IN-DOCUMENT
          const responseInfo = {
            mode: 'UPDATE_BY_ID',
            sub_mode: 'IN_DOC_PREVIEW',
            changes_count: previewResult.count,
            credits_remaining: json.credits_remaining
          };
          metrics.setResponseInfo(responseInfo);
          logDiagnostic('RESPONSE', {
            mode: 'UPDATE_BY_ID',
            sub_mode: 'IN_DOC_PREVIEW',
            changes: previewResult.count,
            doc_was_empty: isDocumentEmpty,
            user_wanted: userMode
          });
          metrics.finalize();

          return {
            ok: true,
            status: 'in_doc_preview',  // Nou status per frontend
            changes_count: previewResult.count,
            ai_response: aiData.change_summary,
            credits: json.credits_remaining,
            thought: aiData.thought,
            mode: 'edit',
            // v3.8: Info per la barra d'acció del sidebar
            preview_info: {
              count: previewResult.count,
              previews: previewResult.previews.map(p => ({
                targetId: p.targetId,
                originalPreview: p.originalText.substring(0, 50) + (p.originalText.length > 50 ? '...' : ''),
                newPreview: p.newText.substring(0, 50) + (p.newText.length > 50 ? '...' : '')
              }))
            },
            _diag: {
              doc_chars: contentPayload.length,
              doc_empty: isDocumentEmpty,
              invisible_elements: docStats.invisible.table + docStats.invisible.inline_image
            }
          };
        }
      }

      // Normal mode - Apply changes directly
      // v3.7: Robust execution with error handling and validation
      let capturedLastEdit = null;
      const existingLastEdit = loadLastEdit(); // v2.6.1: Carregar ABANS del loop
      const editStartTime = Date.now();

      for (const [id, newText] of Object.entries(aiData.updates)) {
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

          // v2.6 Snapshot: Capturar ABANS de modificar
          undoSnapshot = {
            targetId: id,
            originalText: currentDocText,
            bodyIndex: getBodyIndex(targetElement)  // v6.6: Per undo més fiable
          };

          // v3.7: Aplicar edició amb validació
          updateParagraphPreservingAttributes(targetElement, newText);
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

          capturedLastEdit = {
            targetId: id,
            originalText: preservedOriginal,
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
      editDuration = Date.now() - editStartTime;
      logDiagnostic('EDIT_EXECUTION', {
        total_updates: Object.keys(aiData.updates).length,
        edits_applied: editsApplied,
        edits_skipped: editsSkipped,
        edit_errors: editErrors.length,
        duration_ms: editDuration
      });
      if (capturedLastEdit) {
        saveLastEdit(capturedLastEdit);
      }
    } else {
      if (isSelection && elementsToProcess.length > 0) {
         elementsToProcess[0].asText().setText(aiData.blocks.map(b=>b.text).join('\n'));
      } else {
         renderFullDocument(body, aiData.blocks);
      }
    }

    // v3.7: Log resposta EDIT aplicada
    const updatesApplied = aiData.updates ? Object.keys(aiData.updates).length : 0;
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
      edit_stats: {
        total_requested: aiData.updates ? Object.keys(aiData.updates).length : 0,
        applied: editsApplied || 0,
        skipped: editsSkipped || 0,
        errors: editErrors ? editErrors.length : 0,
        duration_ms: editDuration || 0
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

    // v3.10: Usar funció utilitat refactoritzada
    const elementsToProcess = getEditableElements(body);

    // Crear mapa ID -> Element (només els que tenen text)
    let mapIdToElement = {};
    let currentIndex = 0;
    for (const el of elementsToProcess) {
      const text = el.asText().getText();
      if (text.trim().length > 0) {
        mapIdToElement[currentIndex] = el;
        currentIndex++;
      }
    }

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

        // Guardar snapshot per undo
        undoSnapshots.push({
          targetId: change.targetId,
          originalText: currentDocText,
          bodyIndex: getBodyIndex(targetElement)  // v6.6: Per undo més fiable
        });

        // Aplicar el canvi
        updateParagraphPreservingAttributes(targetElement, change.proposedText);
        appliedCount++;

        // Actualitzar lastEdit memory (per al primer canvi)
        if (appliedCount === 1) {
          const isSameTarget = existingLastEdit &&
                               String(existingLastEdit.targetId) === String(change.targetId);
          const preservedOriginal = isSameTarget
                                    ? existingLastEdit.originalText
                                    : currentDocText;

          saveLastEdit({
            targetId: change.targetId,
            originalText: preservedOriginal,
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
  purple: '#CE93D8'    // Preguntes / Clarificacions
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

    // v5.3: Usar mapa existent si es proporciona (per seleccions), sinó reconstruir
    const mapIdToElement = existingMap || buildElementMap(body);
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

    // v5.3: Construir mapa usant bodyIndex si disponible, sinó fallback al mapa general
    const mapIdToElement = buildElementMap(body);

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

      applied++;

      // Guardar lastEdit per al primer canvi
      if (i === 0) {
        const isSameTarget = existingLastEdit &&
                             String(existingLastEdit.targetId) === String(preview.targetId);
        const preservedOriginal = isSameTarget
                                  ? existingLastEdit.originalText
                                  : preview.originalText;

        saveLastEdit({
          targetId: preview.targetId,
          originalText: preservedOriginal,
          currentText: preview.newText,
          bodyIndex: preview.bodyIndex !== undefined ? preview.bodyIndex : getBodyIndex(targetElement)  // v6.6
        });
      }
    }

    // Netejar preview pendent
    clearPendingInDocPreview();

    return {
      ok: true,
      applied: applied,
      message: `${applied} canvi${applied !== 1 ? 's' : ''} aplicat${applied !== 1 ? 's' : ''}`
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

    // v5.3: Construir mapa usant bodyIndex si disponible
    const mapIdToElement = buildElementMap(body);
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

// --- RENDERING HELPERS ---
function updateParagraphPreservingAttributes(element, newMarkdownText) {
  const textObj = element.editAsText();
  const oldText = textObj.getText();
  const cleanText = cleanMarkdown(newMarkdownText);

  // 1. Guardar atributs del PARÀGRAF (heading, alignment, spacing, indentation)
  let paragraphHeading = null;
  let paragraphAlignment = null;
  let lineSpacing = null;
  let spacingBefore = null;
  let spacingAfter = null;
  let indentStart = null;
  let indentEnd = null;
  let indentFirstLine = null;

  try {
    if (element.getHeading) paragraphHeading = element.getHeading();
    if (element.getAlignment) paragraphAlignment = element.getAlignment();
    if (element.getLineSpacing) lineSpacing = element.getLineSpacing();
    if (element.getSpacingBefore) spacingBefore = element.getSpacingBefore();
    if (element.getSpacingAfter) spacingAfter = element.getSpacingAfter();
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
  let backgroundColor = null;

  if (oldText.length > 0) {
    try {
      fontFamily = textObj.getFontFamily(0);
      fontSize = textObj.getFontSize(0);
      foregroundColor = textObj.getForegroundColor(0);
      backgroundColor = textObj.getBackgroundColor(0);
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
      // Nota: No restaurem backgroundColor per defecte (pot ser del preview)
    } catch (e) {
      // Error aplicant atributs de text
    }
  }

  // 5. Restaurar atributs del PARÀGRAF
  try {
    if (paragraphHeading !== null && element.setHeading) {
      element.setHeading(paragraphHeading);
    }
    if (paragraphAlignment !== null && element.setAlignment) {
      element.setAlignment(paragraphAlignment);
    }
    if (lineSpacing !== null && element.setLineSpacing) {
      element.setLineSpacing(lineSpacing);
    }
    if (spacingBefore !== null && element.setSpacingBefore) {
      element.setSpacingBefore(spacingBefore);
    }
    if (spacingAfter !== null && element.setSpacingAfter) {
      element.setSpacingAfter(spacingAfter);
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

  // 6. Aplicar markdown inline (bold, italic)
  applyInlineMarkdown(element, newMarkdownText);
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

          // Ensure rowData has correct number of columns
          const paddedRow = [];
          for (var c = 0; c < numCols; c++) {
            paddedRow.push(rowData[c] || '');
          }

          // Append row
          table.appendTableRow(paddedRow);

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
    const selectionBodyIndices = [];
    for (let i = 0; i < totalElements; i++) {
      const bodyEl = allBodyElements[i];
      for (const selEl of selectedElements) {
        // Comparar elements (poden ser el mateix o parent/child)
        if (bodyEl === selEl ||
            (selEl.getParent && selEl.getParent() === bodyEl) ||
            (bodyEl.getText && selEl.getText && bodyEl.getText() === selEl.getText())) {
          selectionBodyIndices.push(i);
          selectedIndices.add(i);
          break;
        }
      }
    }

    if (selectionBodyIndices.length > 0) {
      // Expandir rang ±3 elements al voltant de la selecció
      const CONTEXT_WINDOW = 3;
      const minIdx = Math.max(0, Math.min(...selectionBodyIndices) - CONTEXT_WINDOW);
      const maxIdx = Math.min(totalElements - 1, Math.max(...selectionBodyIndices) + CONTEXT_WINDOW);

      // Processar el rang expandit
      for (let i = minIdx; i <= maxIdx; i++) {
        elementsToProcess.push({ element: allBodyElements[i], bodyIndex: i });
      }
    } else {
      // Fallback: si no trobem els elements, processar tot
      for (let i = 0; i < totalElements; i++) {
        elementsToProcess.push({ element: allBodyElements[i], bodyIndex: i });
      }
    }
  } else {
    // Sense selecció: processar tot el document
    for (let i = 0; i < totalElements; i++) {
      elementsToProcess.push({ element: allBodyElements[i], bodyIndex: i });
    }
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
        const map = buildElementMap(body);
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

    // 5. Scroll si cal
    if (scroll) {
      const rangeBuilder = doc.newRange();
      if (startOffset >= 0 && endOffset >= 0 && startOffset !== 0) {
        rangeBuilder.addElement(element, startOffset, endOffset);
      } else {
        rangeBuilder.addElement(element);
      }
      doc.setSelection(rangeBuilder.build());
    }

    return { success: true };

  } catch (e) {
    console.error('[highlightElement] Error:', e);
    return { success: false, error: e.message };
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

  } catch (e) {
    // Ignorar errors de neteja
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY WRAPPERS (per compatibilitat - criden highlightElement)
// ═══════════════════════════════════════════════════════════════════════════

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
// REFERENCE HIGHLIGHTING v7.0
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aplica highlights de referència al document
 * @param {Array} highlights - Array de {para_id, color, reason}
 * @returns {Object} - {success, applied, errors}
 */
function applyReferenceHighlights(highlights) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const results = { applied: 0, errors: [] };
    const highlightedIndices = [];

    // Construir mapa d'elements editables
    const elementsToProcess = getEditableElements(body);
    let mapIdToElement = {};
    let currentIndex = 0;
    for (const el of elementsToProcess) {
      const text = el.asText().getText();
      if (text.trim().length > 0) {
        mapIdToElement[currentIndex] = el;
        currentIndex++;
      }
    }

    for (const hl of highlights) {
      try {
        const element = mapIdToElement[hl.para_id];

        if (!element) {
          results.errors.push('Paràgraf ' + hl.para_id + ' no trobat');
          continue;
        }

        const textObj = element.editAsText();
        const textLength = textObj.getText().length;

        if (textLength === 0) continue;

        // Aplicar color de fons
        const color = REFERENCE_COLORS[hl.color] || REFERENCE_COLORS.yellow;
        textObj.setBackgroundColor(0, textLength - 1, color);

        highlightedIndices.push(hl.para_id);
        results.applied++;

      } catch (e) {
        results.errors.push('Error a paràgraf ' + hl.para_id + ': ' + e.message);
      }
    }

    // Guardar índexs per netejar després
    if (highlightedIndices.length > 0) {
      const props = PropertiesService.getDocumentProperties();
      props.setProperty('referenceHighlights', JSON.stringify(highlightedIndices));
    }

    results.success = results.applied > 0;
    return results;

  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Neteja tots els highlights de referència
 * @returns {Object} - {success, cleared}
 */
function clearReferenceHighlights() {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const props = PropertiesService.getDocumentProperties();

    const savedIndices = props.getProperty('referenceHighlights');
    if (!savedIndices) return { success: true, cleared: 0 };

    const indices = JSON.parse(savedIndices);

    // Reconstruir mapa d'elements
    const elementsToProcess = getEditableElements(body);
    let mapIdToElement = {};
    let currentIndex = 0;
    for (const el of elementsToProcess) {
      const text = el.asText().getText();
      if (text.trim().length > 0) {
        mapIdToElement[currentIndex] = el;
        currentIndex++;
      }
    }

    let cleared = 0;

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

    props.deleteProperty('referenceHighlights');
    return { success: true, cleared: cleared };

  } catch (e) {
    return { success: false, error: e.message };
  }
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
        return { success: true, restored: true };
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
