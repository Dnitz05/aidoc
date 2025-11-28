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

// --- NUCLI HÍBRID (Smart Markers) ---
function processUserCommand(instruction) {
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();
  const body = doc.getBody();

  let contentPayload = "";
  let mapIdToElement = {}; // Mapa per recuperar elements per ID
  let isSelection = false;

  const licenseKey = getLicenseKey();
  if (!licenseKey) throw new Error("Configura la llicència (⚙️).");

  // 1. INDEXACIÓ DEL DOCUMENT (Assignem IDs virtuals)
  let elementsToProcess = [];

  if (selection) {
    // Si hi ha selecció, només processem els elements seleccionats
    const ranges = selection.getRangeElements();
    ranges.forEach(r => {
      const el = r.getElement();
      // Només elements amb text
      if (el.getType() === DocumentApp.ElementType.TEXT) {
        elementsToProcess.push(el.getParent()); // Agafem el paràgraf pare
      } else if (el.getType() === DocumentApp.ElementType.PARAGRAPH ||
                 el.getType() === DocumentApp.ElementType.LIST_ITEM) {
        elementsToProcess.push(el);
      }
    });
    isSelection = true;
  } else {
    // Si no, processem tot el Body (fills directes: Paràgrafs, Llistes)
    // IGNOREM Taules i Imatges per no trencar-les
    const numChildren = body.getNumChildren();
    for (let i = 0; i < numChildren; i++) {
      const child = body.getChild(i);
      const type = child.getType();
      // Només paràgrafs i llistes (text editable)
      if (type === DocumentApp.ElementType.PARAGRAPH ||
          type === DocumentApp.ElementType.LIST_ITEM) {
        elementsToProcess.push(child);
      }
      // Taules, imatges, etc. es SALTEN (es preservaran!)
    }
  }

  // Construïm el text amb marcadors: {{0}} Text... {{1}} Text...
  let validIndex = 0;
  elementsToProcess.forEach((el, originalIndex) => {
    try {
      const text = el.asText().getText();
      if (text && text.trim().length > 0) { // Saltem paràgrafs buits
        contentPayload += `{{${validIndex}}} ${text}\n`;
        mapIdToElement[String(validIndex)] = el; // Clau com a string
        validIndex++;
      }
    } catch (e) {
      // Element sense text, el saltem
    }
  });

  if (!contentPayload.trim()) throw new Error("No hi ha text vàlid per processar.");

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

    // 3. APLICACIÓ DE CANVIS (Híbrida)

    if (aiData.mode === 'UPDATE_BY_ID') {
      // ═══════════════════════════════════════════════════════════
      // ESTRATÈGIA NO DESTRUCTIVA (Cirurgia per ID)
      // Només toquem els elements que la IA ha modificat
      // Les imatges i taules es preserven perquè NO estan al mapa
      // ═══════════════════════════════════════════════════════════

      for (const [id, newTextWithMarkdown] of Object.entries(aiData.updates)) {
        const targetElement = mapIdToElement[String(id)];
        if (targetElement) {
          // Usem la funció blindada que preserva font/tamany/color
          updateParagraphPreservingAttributes(targetElement, newTextWithMarkdown);
        }
      }

    } else {
      // ═══════════════════════════════════════════════════════════
      // ESTRATÈGIA RECONSTRUCCIÓ (Resums, canvis d'estructura)
      // Aquí SÍ fem clear() perquè l'estructura canvia totalment
      // ═══════════════════════════════════════════════════════════

      if (isSelection && aiData.blocks) {
        // En selecció, substituïm el text del primer element
        const firstEl = Object.values(mapIdToElement)[0];
        if (firstEl) {
          const combinedText = aiData.blocks.map(b => b.text).join('\n');
          firstEl.asText().setText(combinedText);
        }
      } else if (aiData.blocks) {
        // Document sencer: reconstrucció total
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

// ═══════════════════════════════════════════════════════════════════
// UTILITATS DE FORMAT
// ═══════════════════════════════════════════════════════════════════

/**
 * Neteja els marcadors de Markdown per obtenir text pla
 */
function cleanMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')  // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1');      // *italic* → italic
}

/**
 * Funció BLINDADA per preservar estil (Font i Tamany)
 * Captura els atributs ABANS de modificar i els reimposició DESPRÉS
 */
function updateParagraphPreservingAttributes(element, newMarkdownText) {
  const textObj = element.editAsText();

  // 1. CAPTURA D'ESTILS CRÍTICS (Abans de tocar res)
  // Llegim els atributs del primer caràcter (índex 0)
  // Si el paràgraf és buit, usem valors segurs per defecte.
  let currentFontSize = 11;
  let currentFontFamily = 'Arial';
  let currentColor = '#000000';
  let currentAlignment = null;
  let currentHeading = null;

  try {
    // Intentem llegir els atributs existents
    const attrs = textObj.getAttributes(0);

    // Validem que no siguin nuls (això evita el text minúscul)
    if (attrs[DocumentApp.Attribute.FONT_SIZE]) {
      currentFontSize = attrs[DocumentApp.Attribute.FONT_SIZE];
    }
    if (attrs[DocumentApp.Attribute.FONT_FAMILY]) {
      currentFontFamily = attrs[DocumentApp.Attribute.FONT_FAMILY];
    }
    if (attrs[DocumentApp.Attribute.FOREGROUND_COLOR]) {
      currentColor = attrs[DocumentApp.Attribute.FOREGROUND_COLOR];
    }

    // L'alineació i heading pertanyen al paràgraf, no al text
    if (element.getAlignment) {
      currentAlignment = element.getAlignment();
    }
    if (element.getHeading) {
      currentHeading = element.getHeading();
    }
  } catch (e) {
    console.log("No s'han pogut llegir estils originals, usant defectes.");
  }

  // 2. NETEJA I SUBSTITUCIÓ
  // Treiem els asteriscos del markdown per no ensuciar el text
  const cleanText = cleanMarkdown(newMarkdownText);

  // Aquesta és l'acció destructiva:
  textObj.setText(cleanText);

  // 3. RE-APLICACIÓ FORÇADA D'ESTILS (Resurrecció)
  // Apliquem els estils capturats a tot el nou rang de text
  const end = cleanText.length - 1;

  if (end >= 0) {
    try {
      // Imposem la font i el tamany originals
      textObj.setFontSize(0, end, currentFontSize);
      textObj.setFontFamily(0, end, currentFontFamily);
      textObj.setForegroundColor(0, end, currentColor);

      // Imposem l'alineació i heading
      if (currentAlignment && element.setAlignment) {
        element.setAlignment(currentAlignment);
      }
      if (currentHeading && element.setHeading) {
        element.setHeading(currentHeading);
      }
    } catch (e) {
      console.log("Error re-aplicant estils: " + e.message);
    }
  }

  // 4. FINALMENT, APLIQUEM LES NOVES NEGRETES/CURSIVES DE LA IA
  applyInlineMarkdown(element, newMarkdownText);
}

/**
 * Aplica format inline (negreta/cursiva) basant-se en marcadors Markdown
 * Aquesta funció busca on estaven els ** i * i aplica l'estil corresponent
 */
function applyInlineMarkdown(element, originalMarkdown) {
  const textObj = element.editAsText();
  const cleanText = textObj.getText();

  // ─── NEGRETA (**text**) ───
  const boldPattern = /\*\*(.+?)\*\*/g;
  let match;
  let searchStart = 0;

  // Creem una còpia per iterar sense interferències
  const markdownCopy = originalMarkdown;

  while ((match = boldPattern.exec(markdownCopy)) !== null) {
    const boldContent = match[1]; // El text dins dels **

    // Busquem aquesta subcadena en el text net
    const pos = cleanText.indexOf(boldContent, searchStart);
    if (pos !== -1 && pos + boldContent.length <= cleanText.length) {
      try {
        textObj.setBold(pos, pos + boldContent.length - 1, true);
      } catch (e) {}
      searchStart = pos + boldContent.length;
    }
  }

  // ─── CURSIVA (*text* però NO **text**) ───
  // Usem un patró que exclou els dobles asteriscos
  const italicPattern = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g;
  searchStart = 0;

  while ((match = italicPattern.exec(markdownCopy)) !== null) {
    const italicContent = match[1]; // El text dins dels *

    const pos = cleanText.indexOf(italicContent, searchStart);
    if (pos !== -1 && pos + italicContent.length <= cleanText.length) {
      try {
        textObj.setItalic(pos, pos + italicContent.length - 1, true);
      } catch (e) {}
      searchStart = pos + italicContent.length;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// MOTOR DE RECONSTRUCCIÓ (per a resums/reescriptures totals)
// ═══════════════════════════════════════════════════════════════════

function renderFullDocument(body, blocks) {
  body.clear();

  blocks.forEach(block => {
    let element;
    const text = block.text || "";

    switch (block.type) {
      case 'HEADING_1':
        element = body.appendParagraph(text);
        element.setHeading(DocumentApp.ParagraphHeading.HEADING1);
        break;
      case 'HEADING_2':
        element = body.appendParagraph(text);
        element.setHeading(DocumentApp.ParagraphHeading.HEADING2);
        break;
      case 'HEADING_3':
        element = body.appendParagraph(text);
        element.setHeading(DocumentApp.ParagraphHeading.HEADING3);
        break;
      case 'BULLET_LIST':
        element = body.appendListItem(text);
        element.setGlyphType(DocumentApp.GlyphType.BULLET);
        break;
      case 'NUMBERED_LIST':
        element = body.appendListItem(text);
        element.setGlyphType(DocumentApp.GlyphType.NUMBER);
        break;
      default: // PARAGRAPH
        element = body.appendParagraph(text);
        element.setHeading(DocumentApp.ParagraphHeading.NORMAL);
    }

    // Aplicar format si hi ha array de formatting
    if (block.formatting && block.formatting.length > 0) {
      applyBlockFormatting(element, block.formatting);
    }
  });
}

/**
 * Aplica format basat en l'array de formatting dels blocs JSON
 */
function applyBlockFormatting(element, formattingRules) {
  const textObj = element.editAsText();
  const textLength = element.getText().length;

  formattingRules.forEach(fmt => {
    const start = fmt.start || 0;
    const end = start + (fmt.length || 1) - 1;

    // Validar límits
    if (start >= 0 && end < textLength && start <= end) {
      try {
        if (fmt.style === 'BOLD') textObj.setBold(start, end, true);
        if (fmt.style === 'ITALIC') textObj.setItalic(start, end, true);
      } catch (e) {}
    }
  });
}
