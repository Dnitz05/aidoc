// --- CONFIGURACIÓ ---
const API_URL = 'https://docmile-api.conteucontes.workers.dev';

/**
 * Crea el menú quan s'obre el document
 * Gestiona tant simple triggers com installable triggers
 * @param {Object} e - Event object amb authMode
 */
function onOpen(e) {
  const ui = DocumentApp.getUi();
  const menu = ui.createMenu('📄 Docmile')
    .addItem('Obrir Docmile', 'showSidebar')
    .addSeparator()
    .addItem('Ajuda', 'showHelp');

  // En AuthMode.NONE (abans d'autorització), el menú es mostra però
  // les funcions que requereixen permisos no funcionaran fins autoritzar
  menu.addToUi();
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

  // v3.3: Migració automàtica de SIDECAR a DOCMILE (per usuaris existents)
  const oldJson = props.getProperty('SIDECAR_SETTINGS');
  if (oldJson && !props.getProperty('DOCMILE_SETTINGS')) {
    props.setProperty('DOCMILE_SETTINGS', oldJson);
    props.deleteProperty('SIDECAR_SETTINGS');
    // Also migrate file keys
    const oldUri = props.getProperty('SIDECAR_FILE_URI');
    const oldName = props.getProperty('SIDECAR_FILE_NAME');
    const oldMime = props.getProperty('SIDECAR_FILE_MIME');
    if (oldUri) {
      props.setProperty('DOCMILE_FILE_URI', oldUri);
      props.setProperty('DOCMILE_FILE_NAME', oldName || '');
      props.setProperty('DOCMILE_FILE_MIME', oldMime || '');
      props.deleteProperty('SIDECAR_FILE_URI');
      props.deleteProperty('SIDECAR_FILE_NAME');
      props.deleteProperty('SIDECAR_FILE_MIME');
    }
  }

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
  return "Fitxer oblidat.";
}

// --- LAST EDIT MEMORY (v2.6) ---
// Guarda l'últim fragment editat per permetre "una altra", "aquesta no m'agrada", etc.
const LAST_EDIT_KEY = 'DOCMILE_LAST_EDIT';

// --- BANNED WORDS (v2.8) ---
// Paraules que la IA mai hauria d'usar
const BANNED_WORDS_KEY = 'DOCMILE_BANNED_WORDS';

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

/**
 * Reverteix l'últim canvi fet (v2.6)
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
    const targetId = parseInt(lastEdit.targetId, 10);

    // Reconstruir el mapa d'elements (igual que a processUserCommand)
    let elementsToProcess = [];
    const numChildren = body.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
          child.getType() === DocumentApp.ElementType.LIST_ITEM) {
        elementsToProcess.push(child);
      }
    }

    // Trobar l'element per ID
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

    if (!targetElement) {
      return { success: false, error: "No s'ha trobat el paràgraf original." };
    }

    // Revertir al text original
    targetElement.asText().setText(lastEdit.originalText);

    // v2.6.1: Actualitzar currentText = originalText (no esborrar)
    // Així si l'usuari diu "una altra" després de desfer, la IA entén que partim de l'original
    lastEdit.currentText = lastEdit.originalText;
    saveLastEdit(lastEdit);

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
function restoreText(targetId, originalText) {
  try {
    if (targetId === null || targetId === undefined) {
      return { status: 'error', error: 'No hi ha targetId' };
    }
    if (!originalText) {
      return { status: 'error', error: 'No hi ha text original' };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const numericId = parseInt(targetId, 10);

    // Reconstruir el mapa d'elements (igual que a processUserCommand)
    let elementsToProcess = [];
    const numChildren = body.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
          child.getType() === DocumentApp.ElementType.LIST_ITEM) {
        elementsToProcess.push(child);
      }
    }

    // Trobar l'element per ID (comptant només els que tenen text)
    let targetElement = null;
    let currentIndex = 0;
    for (let i = 0; i < elementsToProcess.length; i++) {
      const el = elementsToProcess[i];
      const text = el.asText().getText();
      if (text.trim().length > 0) {
        if (currentIndex === numericId) {
          targetElement = el;
          break;
        }
        currentIndex++;
      }
    }

    if (!targetElement) {
      return { status: 'error', error: 'No s\'ha trobat el paràgraf (ID: ' + numericId + ')' };
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

// --- NUCLI DEL PROCESSAMENT (v3.2 amb preview mode) ---
function processUserCommand(instruction, chatHistory, userMode, previewMode) {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();
  const body = doc.getBody();

  let contentPayload = "";
  let mapIdToElement = {};
  let isSelection = false;

  // v2.6: Carregar l'últim edit per contexte
  const lastEdit = loadLastEdit();

  // v2.8: Carregar paraules prohibides
  const bannedWords = getBannedWords();

  // v2.9: Obtenir skeleton del document (estructura + entitats)
  let docSkeleton = null;
  try {
    docSkeleton = getDocSkeleton();
  } catch (e) {
    // Si falla el skeleton, continuar sense (graceful degradation)
    docSkeleton = null;
  }

  const settings = JSON.parse(getSettings());
  if (!settings.license_key) throw new Error("Falta llicència.");

  const fileProps = PropertiesService.getUserProperties();
  const knowledgeFileUri = fileProps.getProperty('DOCMILE_FILE_URI');
  const knowledgeFileMime = fileProps.getProperty('DOCMILE_FILE_MIME');

  let elementsToProcess = [];
  if (selection) {
    const ranges = selection.getRangeElements() || [];
    ranges.forEach(r => {
      const el = r.getElement();
      if (el.getType() === DocumentApp.ElementType.TEXT) elementsToProcess.push(el.getParent());
      else if (el.getType() === DocumentApp.ElementType.PARAGRAPH || el.getType() === DocumentApp.ElementType.LIST_ITEM) elementsToProcess.push(el);
    });
    elementsToProcess = [...new Set(elementsToProcess)];
    isSelection = true;
  } else {
    const numChildren = body.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH || child.getType() === DocumentApp.ElementType.LIST_ITEM) {
        elementsToProcess.push(child);
      }
    }
  }

  // Use separate counter to ensure sequential IDs (skip empty paragraphs)
  let contentIndex = 0;
  elementsToProcess.forEach((el) => {
    const text = el.asText().getText();
    if (text.trim().length > 0) {
      contentPayload += `{{${contentIndex}}} ${text}\n`;
      mapIdToElement[contentIndex] = el;
      contentIndex++;
    }
  });

  if (!contentPayload.trim()) contentPayload = "[Document Buit]";

  // DEBUG TEMPORAL: Log per verificar que es llegeix el document
  Logger.log('[DEBUG] contentPayload length: ' + contentPayload.length);
  Logger.log('[DEBUG] contentPayload preview: ' + contentPayload.substring(0, 200));
  Logger.log('[DEBUG] elementsToProcess count: ' + elementsToProcess.length);

  const payload = {
    license_key: settings.license_key,
    user_instruction: instruction,
    text: contentPayload,
    doc_metadata: { doc_id: doc.getId() },
    style_guide: settings.style_guide,
    strict_mode: settings.strict_mode,
    knowledge_file_uri: knowledgeFileUri,
    knowledge_file_mime: knowledgeFileMime,
    has_selection: isSelection,
    chat_history: chatHistory || [],
    last_edit: lastEdit,
    user_mode: userMode || 'auto',
    negative_constraints: bannedWords, // v2.8: Paraules prohibides
    doc_skeleton: docSkeleton, // v2.9: Estructura del document
    pinned_prefs: {
      language: 'ca',
      tone: 'tècnic però entenedor',
      style_notes: settings.style_guide || ''
    }
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
      throw new Error(json.error_code || "Error API");
    }

    const aiData = json.data;

    // --- ROUTER D'INTENCIÓ ---
    if (aiData.mode === 'CHAT_ONLY') {
      return {
        ok: true,
        ai_response: aiData.chat_response || aiData.change_summary,
        credits: json.credits_remaining,
        mode: 'chat',
        // DEBUG: afegir info del document per verificar
        _debug_doc_chars: contentPayload.length,
        _debug_doc_preview: contentPayload.substring(0, 100)
      };
    }

    let lastEditWord = null; // v2.8: Paraula per al botó "Prohibir"

    // v2.6 Snapshot for Optimistic UI Undo
    let undoSnapshot = null;

    if (aiData.mode === 'UPDATE_BY_ID') {
      // v3.2: Preview Mode - Return changes without applying
      if (previewMode) {
        const changes = [];
        // v3.3: Build snapshot fingerprint for race condition detection
        let docSnapshot = '';
        let snapshotIdx = 0;

        for (const [id, newText] of Object.entries(aiData.updates)) {
          const targetElement = mapIdToElement[id];
          if (targetElement) {
            const currentDocText = targetElement.asText().getText();
            const cleanNewText = newText.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
            changes.push({
              targetId: id,
              originalText: currentDocText,
              proposedText: cleanNewText
            });
            // Build snapshot for first few elements
            if (snapshotIdx < 5) {
              docSnapshot += '{{' + id + '}} ' + currentDocText.substring(0, 100) + '\n';
              snapshotIdx++;
            }
          }
        }

        // If no changes found (IDs don't match), fall back to normal mode
        if (changes.length === 0) {
          // Try to apply directly instead of showing empty preview
        } else {
          return {
            ok: true,
            status: 'preview',
            changes: changes,
            ai_response: aiData.change_summary,
            credits: json.credits_remaining,
            thought: aiData.thought,
            mode: 'edit',
            doc_snapshot: docSnapshot,  // v3.3: For race condition detection
            // DEBUG: afegir info del document per verificar
            _debug_doc_chars: contentPayload.length,
            _debug_doc_preview: contentPayload.substring(0, 100)
          };
        }
      }

      // Normal mode - Apply changes directly
      let capturedLastEdit = null;
      const existingLastEdit = loadLastEdit(); // v2.6.1: Carregar ABANS del loop

      for (const [id, newText] of Object.entries(aiData.updates)) {
        const targetElement = mapIdToElement[id];
        if (targetElement) {
          const currentDocText = targetElement.asText().getText();

          // v2.6 Snapshot: Capturar ABANS de modificar
          undoSnapshot = {
            targetId: id,
            originalText: currentDocText
          };

          updateParagraphPreservingAttributes(targetElement, newText);

          // v2.6.1: Preservar originalText si editem el MATEIX paràgraf (cadena d'alternatives)
          // Si és un paràgraf diferent, comencem nova cadena amb l'actual com a original
          const isSameTarget = existingLastEdit &&
                               String(existingLastEdit.targetId) === String(id);
          const preservedOriginal = isSameTarget
                                    ? existingLastEdit.originalText
                                    : currentDocText;

          const cleanNewText = newText.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');

          capturedLastEdit = {
            targetId: id,
            originalText: preservedOriginal,
            currentText: cleanNewText
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
        }
      }
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

    return {
      ok: true,
      ai_response: aiData.change_summary,
      credits: json.credits_remaining,
      mode: 'edit',
      last_edit_word: lastEditWord, // v2.8: Per al botó "Prohibir"
      undo_snapshot: undoSnapshot   // v2.6: Per Optimistic UI Undo
    };

  } catch (e) {
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

    // Reconstruir el mapa d'elements (igual que a processUserCommand)
    let elementsToProcess = [];
    const numChildren = body.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
          child.getType() === DocumentApp.ElementType.LIST_ITEM) {
        elementsToProcess.push(child);
      }
    }

    // Crear mapa ID -> Element (només els que tenen text)
    let mapIdToElement = {};
    let currentIndex = 0;
    for (let i = 0; i < elementsToProcess.length; i++) {
      const el = elementsToProcess[i];
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
          originalText: currentDocText
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
            currentText: change.proposedText
          });
        }
      }
    }

    return {
      ok: true,
      applied: appliedCount,
      undoSnapshots: undoSnapshots
    };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// --- RENDERING HELPERS ---
function updateParagraphPreservingAttributes(element, newMarkdownText) {
  const textObj = element.editAsText();
  const oldText = textObj.getText();
  const cleanText = newMarkdownText.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');

  if (oldText.length > 0) {
    textObj.insertText(0, cleanText);
    const startOfOld = cleanText.length;
    const endOfOld = startOfOld + oldText.length - 1;
    if (endOfOld >= startOfOld) textObj.deleteText(startOfOld, endOfOld);
  } else {
    textObj.setText(cleanText);
  }
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
      default: element = body.appendParagraph(block.text).setHeading(DocumentApp.ParagraphHeading.NORMAL);
    }
  });
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
