// --- CONFIGURACIÓ ---
const API_URL = 'https://sidecar-api.conteucontes.workers.dev';

function onOpen() {
  DocumentApp.getUi().createMenu('SideCar').addItem('Obrir Xatbot', 'showSidebar').addToUi();
}

function showSidebar() {
  const html = HtmlService.createTemplateFromFile('Sidebar').evaluate().setTitle('SideCar AI');
  DocumentApp.getUi().showSidebar(html);
}

function setLicenseKey(key) {
  PropertiesService.getUserProperties().setProperty('SIDECAR_LICENSE_KEY', key);
  return "OK";
}

function getLicenseKey() {
  return PropertiesService.getUserProperties().getProperty('SIDECAR_LICENSE_KEY') || "";
}

// --- NUCLI DEL PROCESSAMENT ---
function processUserCommand(instruction) {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();
  let textToProcess = "";
  let isFullDocument = false;

  const licenseKey = getLicenseKey();
  if (!licenseKey) throw new Error("Configura la llicència (⚙️).");

  // 1. Extracció de Text
  if (selection) {
    const elements = selection.getRangeElements();
    textToProcess = elements[0].getElement().asText().getText();
  }

  if (!textToProcess) {
    textToProcess = doc.getBody().getText();
    isFullDocument = true;
  }

  if (!textToProcess.trim()) throw new Error("El document està buit.");

  // 2. Crida al Worker (JSON Protocol)
  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify({
      license_key: licenseKey,
      user_instruction: instruction,
      text: textToProcess,
      doc_metadata: { doc_id: doc.getId() }
    }),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      throw new Error(json.error_code || "Error API");
    }

    // 3. Renderitzat Intel·ligent
    if (isFullDocument) {
      renderFullDocument(doc.getBody(), json.data.blocks);
    } else {
      renderSelection(selection, json.data.blocks);
    }

    return {
      ok: true,
      ai_response: json.data.change_summary,
      credits: json.credits_remaining
    };

  } catch (e) {
    throw new Error("Error SideCar: " + e.message);
  }
}

// --- MOTOR DE RENDERITZAT (Block Engine) ---

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
    if (block.formatting) applyFormatting(element, block.formatting);
  });
}

function renderSelection(selection, blocks) {
  const elements = selection.getRangeElements();
  const targetElement = elements[0].getElement().asText();

  // Concatenem blocs per inserció inline (fallback per seleccions parcials)
  let combinedText = "";
  let combinedFormatting = [];

  blocks.forEach(block => {
    const baseIndex = combinedText.length;
    combinedText += block.text + "\n";
    if (block.formatting) {
      block.formatting.forEach(fmt => {
        combinedFormatting.push({ style: fmt.style, start: baseIndex + fmt.start, length: fmt.length });
      });
    }
  });

  combinedText = combinedText.trim();

  if (elements[0].isPartial()) {
    const start = elements[0].getStartOffset();
    const end = elements[0].getEndOffsetInclusive();
    targetElement.deleteText(start, end);
    targetElement.insertText(start, combinedText);
    applyFormattingWithOffset(targetElement, combinedFormatting, start);
  } else {
    targetElement.setText(combinedText);
    applyFormatting(targetElement, combinedFormatting);
  }
}

function applyFormatting(element, rules) {
  const textObj = element.editAsText();
  rules.forEach(fmt => {
    const end = fmt.start + fmt.length - 1;
    if (end < element.getText().length) {
      if (fmt.style === 'BOLD') textObj.setBold(fmt.start, end, true);
      if (fmt.style === 'ITALIC') textObj.setItalic(fmt.start, end, true);
    }
  });
}

function applyFormattingWithOffset(element, rules, baseOffset) {
  const textObj = element.editAsText();
  rules.forEach(fmt => {
    const absStart = baseOffset + fmt.start;
    const absEnd = absStart + fmt.length - 1;
    if (absEnd < element.getText().length) {
      if (fmt.style === 'BOLD') textObj.setBold(absStart, absEnd, true);
      if (fmt.style === 'ITALIC') textObj.setItalic(absStart, absEnd, true);
    }
  });
}
