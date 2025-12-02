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

// --- NUCLI DEL PROCESSAMENT (v3.7 amb instrumentació) ---
function processUserCommand(instruction, chatHistory, userMode, previewMode, clientIntentClassification) {
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

  // v3.7: Preparar elements per la captura
  let selectedElements = null;
  if (selection) {
    const ranges = selection.getRangeElements() || [];
    selectedElements = [];
    ranges.forEach(r => {
      const el = r.getElement();
      if (el.getType() === DocumentApp.ElementType.TEXT) selectedElements.push(el.getParent());
      else selectedElements.push(el);
    });
    selectedElements = [...new Set(selectedElements)];
    isSelection = true;
  }

  // v3.7: UNIVERSAL DOC READER - Captura TOTAL del document
  // Inclou: Header, Body (paràgrafs, llistes, taules, TOC), Footer, Footnotes
  const captureResult = captureFullDocument(doc, body, isSelection, selectedElements);
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
    user_mode: userMode || 'auto',
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
    has_drawings: captureStats.has_drawings,
    // v3.7: Classificació d'intenció del client
    client_intent: clientIntentClassification ? clientIntentClassification.intent : null,
    client_intent_confidence: clientIntentClassification ? clientIntentClassification.confidence : null,
    client_intent_reason: clientIntentClassification ? clientIntentClassification.reason : null
  };
  metrics.setRequestInfo(requestInfo);

  logDiagnostic('REQUEST', {
    instruction: instruction ? instruction.substring(0, 200) : null,
    user_mode: userMode,
    has_selection: isSelection,
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
    knowledge_file_uri: knowledgeFileUri,
    knowledge_file_mime: knowledgeFileMime,
    has_selection: isSelection,
    chat_history: chatHistory || [],
    last_edit: lastEdit,
    user_mode: userMode || 'auto',
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
    // v3.7: Classificació d'intenció del client (frontend)
    client_intent: clientIntentClassification ? {
      intent: clientIntentClassification.intent,
      confidence: clientIntentClassification.confidence,
      reason: clientIntentClassification.reason,
      scores: clientIntentClassification.scores
    } : null
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
            const cleanNewText = newText.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
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
          const previewResult = applyInDocumentPreview(changes);

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
            originalText: currentDocText
          };

          // v3.7: Aplicar edició amb validació
          updateParagraphPreservingAttributes(targetElement, newText);
          editsApplied++;

          // v3.7: Validar que l'edició s'ha aplicat correctament
          const newDocText = targetElement.asText().getText();
          const cleanNewText = newText.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
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

/**
 * Aplica preview visual al document (estil Track Changes)
 * - Text original: fons vermell + ratllat
 * - Text nou: fons verd + subratllat
 *
 * @param {Array} changes - Array de {targetId, originalText, proposedText}
 * @returns {Object} { ok, previews, error }
 */
function applyInDocumentPreview(changes) {
  try {
    if (!changes || !Array.isArray(changes) || changes.length === 0) {
      return { ok: false, error: "No hi ha canvis per previsualitzar" };
    }

    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();

    // Reconstruir el mapa d'elements
    const mapIdToElement = buildElementMap(body);
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
      const cleanNewText = (change.proposedText || '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1');

      // Evitar preview si són iguals
      if (originalText.trim() === cleanNewText.trim()) {
        console.log('[Preview] No changes for:', targetId);
        continue;
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
        separatorLength: separator.length
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
    const mapIdToElement = buildElementMap(body);

    let applied = 0;
    const existingLastEdit = loadLastEdit();

    // Processar en ordre INVERS per no afectar índexs
    for (let i = previews.length - 1; i >= 0; i--) {
      const preview = previews[i];
      const targetId = parseInt(preview.targetId, 10);
      const targetElement = mapIdToElement[targetId];

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
          currentText: preview.newText
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
    const mapIdToElement = buildElementMap(body);

    let cancelled = 0;

    for (const preview of previews) {
      const targetId = parseInt(preview.targetId, 10);
      const targetElement = mapIdToElement[targetId];

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
 */
function buildElementMap(body) {
  const mapIdToElement = {};
  const numChildren = body.getNumChildren();
  let currentIndex = 0;

  for (let i = 0; i < numChildren; i++) {
    const child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
        child.getType() === DocumentApp.ElementType.LIST_ITEM) {
      const text = child.asText().getText();
      if (text.trim().length > 0) {
        mapIdToElement[currentIndex] = child;
        currentIndex++;
      }
    }
  }

  return mapIdToElement;
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

  // Si hi ha selecció, processar només els elements seleccionats
  const elementsToProcess = isSelection && selectedElements ?
    selectedElements : getAllChildElements(body);

  stats.total_elements = elementsToProcess.length;

  for (let i = 0; i < elementsToProcess.length; i++) {
    const element = elementsToProcess[i];
    const result = processElement(element, globalIndex, mapIdToElement, stats);
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
 */
function processElement(element, currentIndex, mapIdToElement, stats) {
  const elementType = element.getType();
  let content = "";
  let nextIndex = currentIndex;

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

        content = `{{${currentIndex}}} ${prefix}${pText}\n`;
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

        content = `{{${currentIndex}}} ${indent}${bullet} ${liText}\n`;
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

// ═══════════════════════════════════════════════════════════════
// LEGACY WRAPPER - Mantenir compatibilitat
// ═══════════════════════════════════════════════════════════════

/**
 * Wrapper per compatibilitat amb codi existent
 * @deprecated Usar captureFullDocument() directament
 */
function captureDocumentComplete(body, isSelection, selectedElements) {
  const doc = DocumentApp.getActiveDocument();
  return captureFullDocument(doc, body, isSelection, selectedElements);
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

// --- SCROLL TO PARAGRAPH (v3.9) ---

/**
 * Fa scroll al document fins al paràgraf indicat
 * @param {number} paragraphIndex - Índex del paràgraf (0-based)
 */
function scrollToParagraph(paragraphIndex) {
  try {
    const doc = DocumentApp.getActiveDocument();
    const body = doc.getBody();
    const numChildren = body.getNumChildren();

    if (paragraphIndex < 0 || paragraphIndex >= numChildren) {
      return { success: false, error: 'Índex fora de rang' };
    }

    const element = body.getChild(paragraphIndex);

    // Seleccionar l'element per fer scroll fins a ell
    const rangeBuilder = doc.newRange();
    rangeBuilder.addElement(element);
    doc.setSelection(rangeBuilder.build());

    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
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
