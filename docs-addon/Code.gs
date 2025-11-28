// --- CONFIGURACIÓ ---
const API_URL = 'https://sidecar-api.conteucontes.workers.dev';

function onOpen() {
  DocumentApp.getUi().createMenu('SideCar')
      .addItem('Obrir Xatbot', 'showSidebar')
      .addToUi();
}

function showSidebar() {
  const html = HtmlService.createTemplateFromFile('Sidebar')
      .evaluate()
      .setTitle('SideCar AI');
  DocumentApp.getUi().showSidebar(html);
}

// --- Gestió de Claus ---
function setLicenseKey(key) {
  PropertiesService.getUserProperties().setProperty('SIDECAR_LICENSE_KEY', key);
  return "OK";
}

function getLicenseKey() {
  return PropertiesService.getUserProperties().getProperty('SIDECAR_LICENSE_KEY') || "";
}

// --- Funció Principal (Mode Xat) ---
function processUserCommand(instruction) {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();
  let textToProcess = "";
  let targetElement = null;
  let startOffset = null;
  let endOffset = null;
  let isPartialSelection = false;
  let isFullDocument = false;

  // 1. Validar llicència
  const licenseKey = getLicenseKey();
  if (!licenseKey) throw new Error("Configura la llicència primer (⚙️).");

  // 2. LÒGICA INTEL·LIGENT DE SELECCIÓ
  if (selection) {
    const elements = selection.getRangeElements();
    const rangeElement = elements[0];
    const element = rangeElement.getElement();

    // Verificar si és un element de text
    if (element.getType() === DocumentApp.ElementType.TEXT) {
      targetElement = element.asText();
      const fullText = targetElement.getText();

      if (rangeElement.isPartial()) {
        // SELECCIÓ PARCIAL - Només el fragment seleccionat
        startOffset = rangeElement.getStartOffset();
        endOffset = rangeElement.getEndOffsetInclusive();
        textToProcess = fullText.substring(startOffset, endOffset + 1);
        isPartialSelection = true;
      } else {
        // Element sencer seleccionat
        textToProcess = fullText;
        startOffset = 0;
        endOffset = fullText.length - 1;
      }
    } else if (element.editAsText) {
      // Altres elements editables (paràgrafs, etc.)
      targetElement = element.editAsText();
      textToProcess = targetElement.getText();
      startOffset = 0;
      endOffset = textToProcess.length - 1;
    }
  }

  // 3. NO HI HA SELECCIÓ -> Document sencer (Mode Markdown)
  if (!textToProcess) {
    const body = doc.getBody();
    textToProcess = body.getText();
    isFullDocument = true;
  }

  if (!textToProcess.trim()) throw new Error("El document està buit.");

  // 4. Preparar Payload
  const payload = {
    license_key: licenseKey,
    mode: 'custom',
    user_instruction: instruction,
    text: textToProcess,
    doc_metadata: {
      doc_id: doc.getId(),
      is_full_document: isFullDocument  // Informem al worker
    }
  };

  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  // 5. Crida al Worker
  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      throw new Error(json.error_code || "Error API desconegut");
    }

    // 6. APLICAR CANVIS SEGONS EL MODE
    if (isFullDocument) {
      // MODE DOCUMENT SENCER: Reconstrucció amb Markdown
      const body = doc.getBody();
      applyMarkdown(body, json.result_text);
    } else if (isPartialSelection) {
      // MODE SELECCIÓ PARCIAL: deleteText + insertText (preserva format circumdant)
      targetElement.deleteText(startOffset, endOffset);
      targetElement.insertText(startOffset, json.result_text);
    } else {
      // MODE ELEMENT SENCER: setText simple
      targetElement.setText(json.result_text);
    }

    // 7. Retornar info per al xat
    return {
      ok: true,
      ai_response: json.change_summary,
      credits: json.credits_remaining
    };

  } catch (e) {
    throw new Error("Error SideCar: " + e.message);
  }
}

// --- Funció per aplicar Markdown al document ---
function applyMarkdown(body, markdownText) {
  // 1. Netejar el document
  body.clear();

  // 2. Processar línia per línia
  const lines = markdownText.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Saltar línies buides (però afegir paràgraf buit per espaiat)
    if (line.trim() === '') {
      // No afegim paràgrafs buits consecutius
      continue;
    }

    // Detectar títols (# ## ###)
    if (line.startsWith('### ')) {
      const text = line.substring(4);
      const para = body.appendParagraph(text);
      para.setHeading(DocumentApp.ParagraphHeading.HEADING3);
    } else if (line.startsWith('## ')) {
      const text = line.substring(3);
      const para = body.appendParagraph(text);
      para.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    } else if (line.startsWith('# ')) {
      const text = line.substring(2);
      const para = body.appendParagraph(text);
      para.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    }
    // Detectar llistes amb guió o asterisc
    else if (line.match(/^[\*\-]\s+/)) {
      const text = line.replace(/^[\*\-]\s+/, '');
      const listItem = body.appendListItem(text);
      listItem.setGlyphType(DocumentApp.GlyphType.BULLET);
    }
    // Detectar llistes numerades
    else if (line.match(/^\d+\.\s+/)) {
      const text = line.replace(/^\d+\.\s+/, '');
      const listItem = body.appendListItem(text);
      listItem.setGlyphType(DocumentApp.GlyphType.NUMBER);
    }
    // Text normal
    else {
      const para = body.appendParagraph(line);
      para.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    }
  }

  // 3. Aplicar format inline (negreta i cursiva) a tot el document
  applyInlineFormatting(body);
}

// --- Funció per aplicar format inline (negreta, cursiva) ---
function applyInlineFormatting(body) {
  const text = body.editAsText();
  const content = text.getText();

  // Processar **negreta**
  const boldPattern = /\*\*(.+?)\*\*/g;
  let match;
  let offset = 0;

  // Necessitem fer múltiples passades perquè els índexs canvien
  let processedText = content;

  // Primer passem per negreta
  while ((match = boldPattern.exec(content)) !== null) {
    const fullMatch = match[0];      // **text**
    const innerText = match[1];       // text
    const startIndex = match.index;

    // Buscar la posició actual en el document
    const currentText = body.editAsText().getText();
    const pos = currentText.indexOf(fullMatch);

    if (pos !== -1) {
      // Substituir **text** per text i aplicar negreta
      const textElement = body.editAsText();
      textElement.deleteText(pos, pos + fullMatch.length - 1);
      textElement.insertText(pos, innerText);
      textElement.setBold(pos, pos + innerText.length - 1, true);
    }
  }

  // Després passem per cursiva (*text* o _text_)
  const italicPattern = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|_(.+?)_/g;
  const currentContent = body.editAsText().getText();

  while ((match = italicPattern.exec(currentContent)) !== null) {
    const fullMatch = match[0];
    const innerText = match[1] || match[2];

    const currentText = body.editAsText().getText();
    const pos = currentText.indexOf(fullMatch);

    if (pos !== -1) {
      const textElement = body.editAsText();
      textElement.deleteText(pos, pos + fullMatch.length - 1);
      textElement.insertText(pos, innerText);
      textElement.setItalic(pos, pos + innerText.length - 1, true);
    }
  }
}
