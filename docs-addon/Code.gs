// --- CONFIGURACIÓ ---
const API_URL = 'https://sidecar-api.conteucontes.workers.dev';

function onOpen() {
  DocumentApp.getUi().createMenu('SideCar').addItem('Obrir SideCar', 'showSidebar').addToUi();
}

function showSidebar() {
  const html = HtmlService.createTemplateFromFile('Sidebar').evaluate().setTitle('SideCar AI');
  DocumentApp.getUi().showSidebar(html);
}

// --- GESTIÓ DE MEMÒRIA I FITXERS ---
function saveSettings(jsonSettings) {
  PropertiesService.getUserProperties().setProperty('SIDECAR_SETTINGS', jsonSettings);
  return "OK";
}

function getSettings() {
  const json = PropertiesService.getUserProperties().getProperty('SIDECAR_SETTINGS');
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
  props.setProperty('SIDECAR_FILE_URI', uri);
  props.setProperty('SIDECAR_FILE_NAME', name);
  props.setProperty('SIDECAR_FILE_MIME', mime);
  return { name: name, uri: uri };
}

function getKnowledgeFileInfo() {
  const props = PropertiesService.getUserProperties();
  const uri = props.getProperty('SIDECAR_FILE_URI');
  const name = props.getProperty('SIDECAR_FILE_NAME');

  if (uri && name) return { hasFile: true, name: name };
  return { hasFile: false, name: "Cap fitxer actiu" };
}

function clearKnowledgeFile() {
  const props = PropertiesService.getUserProperties();
  props.deleteProperty('SIDECAR_FILE_URI');
  props.deleteProperty('SIDECAR_FILE_NAME');
  props.deleteProperty('SIDECAR_FILE_MIME');
  return "Fitxer oblidat.";
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

// --- NUCLI DEL PROCESSAMENT (AMB ROUTER D'INTENCIÓ) ---
function processUserCommand(instruction) {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();
  const body = doc.getBody();

  let contentPayload = "";
  let mapIdToElement = {};
  let isSelection = false;

  const settings = JSON.parse(getSettings());
  if (!settings.license_key) throw new Error("Falta llicència.");

  const fileProps = PropertiesService.getUserProperties();
  const knowledgeFileUri = fileProps.getProperty('SIDECAR_FILE_URI');
  const knowledgeFileMime = fileProps.getProperty('SIDECAR_FILE_MIME');

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

  elementsToProcess.forEach((el, index) => {
    const text = el.asText().getText();
    if (text.trim().length > 0) {
      contentPayload += `{{${index}}} ${text}\n`;
      mapIdToElement[index] = el;
    }
  });

  if (!contentPayload.trim()) contentPayload = "[Document Buit]";

  const payload = {
    license_key: settings.license_key,
    user_instruction: instruction,
    text: contentPayload,
    doc_metadata: { doc_id: doc.getId() },
    style_guide: settings.style_guide,
    strict_mode: settings.strict_mode,
    knowledge_file_uri: knowledgeFileUri,
    knowledge_file_mime: knowledgeFileMime
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
        mode: 'chat'
      };
    }

    if (aiData.mode === 'UPDATE_BY_ID') {
      for (const [id, newText] of Object.entries(aiData.updates)) {
        const targetElement = mapIdToElement[id];
        if (targetElement) updateParagraphPreservingAttributes(targetElement, newText);
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
      mode: 'edit'
    };

  } catch (e) {
    throw new Error("Error: " + e.message);
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
