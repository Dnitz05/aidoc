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

// --- NUCLI HÍBRID AMB SMART MARKERS ---
function processUserCommand(instruction) {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();
  const body = doc.getBody();

  let contentPayload = "";
  let mapIdToElement = {};
  let isSelection = false;

  const licenseKey = getLicenseKey();
  if (!licenseKey) throw new Error("Configura la llicència (⚙️).");

  // 1. INDEXACIÓ DEL DOCUMENT
  let elementsToProcess = [];

  if (selection) {
    const ranges = selection.getRangeElements();
    ranges.forEach(r => {
      const el = r.getElement();
      if (el.getType() === DocumentApp.ElementType.TEXT) {
         elementsToProcess.push(el.getParent());
      } else if (el.getType() === DocumentApp.ElementType.PARAGRAPH ||
                 el.getType() === DocumentApp.ElementType.LIST_ITEM) {
        elementsToProcess.push(el);
      }
    });
    // Eliminar duplicats
    elementsToProcess = [...new Set(elementsToProcess)];
    isSelection = true;
  } else {
    // Tot el document
    const numChildren = body.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH ||
          child.getType() === DocumentApp.ElementType.LIST_ITEM) {
        elementsToProcess.push(child);
      }
    }
  }

  // Construïm el payload amb IDs virtuals {{0}}...
  elementsToProcess.forEach((el, index) => {
    const text = el.asText().getText();
    if (text.trim().length > 0) {
      contentPayload += `{{${index}}} ${text}\n`;
      mapIdToElement[index] = el;
    }
  });

  if (!contentPayload.trim()) throw new Error("No hi ha text vàlid.");

  // 2. Crida al Worker
  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify({
      license_key: licenseKey,
      user_instruction: instruction,
      text: contentPayload,
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

    const aiData = json.data;

    // 3. APLICACIÓ DE CANVIS
    if (aiData.mode === 'UPDATE_BY_ID') {
      // ESTRATÈGIA NO DESTRUCTIVA (Cirurgia)
      for (const [id, newText] of Object.entries(aiData.updates)) {
        const targetElement = mapIdToElement[id];
        if (targetElement) {
          updateParagraphPreservingAttributes(targetElement, newText);
        }
      }
    } else {
      // ESTRATÈGIA RECONSTRUCCIÓ (Resums globals)
      if (isSelection) {
         if (elementsToProcess.length > 0) {
            elementsToProcess[0].asText().setText(aiData.blocks.map(b=>b.text).join('\n'));
         }
      } else {
         renderFullDocument(body, aiData.blocks);
      }
    }

    return {
      ok: true,
      ai_response: aiData.change_summary,
      credits: json.credits_remaining
    };

  } catch (e) {
    throw new Error("Error SideCar: " + e.message);
  }
}

// --- FUNCIONS DE RENDERITZAT I PRESERVACIÓ D'ESTIL ---

/**
 * Funció INFAL·LIBLE per preservar estil (Tècnica Insert-Delete)
 * En lloc d'esborrar i perdre l'estil, inserim primer per heretar-lo.
 */
function updateParagraphPreservingAttributes(element, newMarkdownText) {
  const textObj = element.editAsText();
  const oldText = textObj.getText();

  // 1. Netejar Markdown (treure asteriscos per al text pla)
  const cleanText = newMarkdownText.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');

  // 2. ESTRATÈGIA "CAVALL DE TROIA" (Insertar abans d'esborrar)
  if (oldText.length > 0) {
    // A. Inserim el NOU text al principi (índex 0)
    // Apps Script farà que hereti l'estil (Mida 24, Color Blau, etc.) del caràcter 0 original.
    textObj.insertText(0, cleanText);

    // B. Ara tenim "NOU TEXT" + "ANTIC TEXT".
    // Esborrem l'antic text, que ara comença després del nou.
    // (Des de la longitud del nou, fins al final)
    const startOfOld = cleanText.length;
    // Calculem l'índex final amb cura
    const endOfOld = startOfOld + oldText.length - 1;

    if (endOfOld >= startOfOld) {
      textObj.deleteText(startOfOld, endOfOld);
    }

  } else {
    // Si el paràgraf estava buit, no tenim d'on heretar. Fem setText normal.
    textObj.setText(cleanText);
  }

  // 3. FINALMENT, APLIQUEM LES NOVES NEGRETES/CURSIVES DE LA IA
  // (Això posarà negreta sobre la mida 24 que ja hem preservat)
  applyInlineMarkdown(element, newMarkdownText);
}

function applyInlineMarkdown(element, originalMarkdown) {
  const textObj = element.editAsText();
  const cleanText = textObj.getText();

  // Negreta (**text**)
  const boldPattern = /\*\*(.+?)\*\*/g;
  let match;
  let searchStart = 0;

  // Reiniciem regex cada cop
  while ((match = boldPattern.exec(originalMarkdown)) !== null) {
    const content = match[1];
    const pos = cleanText.indexOf(content, searchStart);
    if (pos !== -1) {
      textObj.setBold(pos, pos + content.length - 1, true);
      // Opcional: actualitzar searchStart per optimitzar
    }
  }

  // Cursiva (*text*)
  const italicPattern = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
  searchStart = 0;
  while ((match = italicPattern.exec(originalMarkdown)) !== null) {
    const content = match[1];
    const pos = cleanText.indexOf(content, searchStart);
    if (pos !== -1) {
      textObj.setItalic(pos, pos + content.length - 1, true);
    }
  }
}

// Fallback per reescriptura total (Resums)
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
