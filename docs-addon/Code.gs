/**
 * SideCar - Google Docs Add-on
 * Multi-mode text processing with AI
 */

// URL del Worker desplegat a Cloudflare
const API_URL = 'https://sidecar-api.conteucontes.workers.dev';

/**
 * Crea el menú quan s'obre el document
 */
function onOpen() {
  DocumentApp.getUi()
    .createMenu('SideCar')
    .addItem('Obrir', 'showSidebar')
    .addToUi();
}

/**
 * Mostra la barra lateral
 */
function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('SideCar')
    .setWidth(300);
  DocumentApp.getUi().showSidebar(html);
}

/**
 * Desa la clau de llicència a les propietats de l'usuari
 */
function setLicenseKey(key) {
  PropertiesService.getUserProperties().setProperty('SIDECAR_LICENSE_KEY', key);
}

/**
 * Recupera la clau de llicència desada
 */
function getLicenseKey() {
  return PropertiesService.getUserProperties().getProperty('SIDECAR_LICENSE_KEY');
}

/**
 * Processa el text seleccionat amb el mode especificat
 * @param {string} mode - Mode d'operació (formalize, improve, summarize, translate_en, translate_es, custom)
 * @param {string} customInstruction - Instrucció personalitzada (només per mode 'custom')
 */
function processSelection(mode, customInstruction) {
  // Default mode if not specified
  mode = mode || 'formalize';
  console.log('SideCar: Processing with mode:', mode, 'instruction:', customInstruction ? 'yes' : 'no');

  // Obtenir la llicència
  const licenseKey = getLicenseKey();
  if (!licenseKey) {
    console.log('SideCar: No license key configured');
    return { success: false, error: 'No hi ha cap llicència configurada' };
  }

  // Obtenir la selecció
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();

  if (!selection) {
    console.log('SideCar: No text selected');
    return { success: false, error: 'No hi ha cap text seleccionat' };
  }

  // Extreure el text seleccionat
  const elements = selection.getRangeElements();
  let selectedText = '';
  let textElement = null;
  let startOffset = 0;
  let endOffset = 0;

  // Per simplicitat MVP, processem només el primer element de text
  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.getElement().getType() === DocumentApp.ElementType.TEXT) {
      textElement = element.getElement().asText();
      if (element.isPartial()) {
        startOffset = element.getStartOffset();
        endOffset = element.getEndOffsetInclusive();
        selectedText = textElement.getText().substring(startOffset, endOffset + 1);
      } else {
        selectedText = textElement.getText();
        startOffset = 0;
        endOffset = selectedText.length - 1;
      }
      break;
    }
  }

  if (!selectedText || selectedText.trim() === '') {
    console.log('SideCar: Selection contains no text');
    return { success: false, error: 'La selecció no conté text' };
  }

  console.log('SideCar: Selected text length:', selectedText.length);

  // Cridar l'API
  try {
    const payload = {
      license_key: licenseKey,
      mode: mode,
      text: selectedText,
      doc_metadata: {
        doc_id: doc.getId(),
        doc_name: doc.getName()
      }
    };

    // Afegir instrucció personalitzada si és mode custom
    if (mode === 'custom' && customInstruction) {
      payload.user_instruction = customInstruction;
    }

    console.log('SideCar: Calling API with mode:', mode);

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(API_URL, options);
    const responseCode = response.getResponseCode();
    const responseData = JSON.parse(response.getContentText());

    console.log('SideCar: API response code:', responseCode);

    if (responseCode !== 200) {
      let errorMsg = responseData.error || 'Error desconegut';
      if (errorMsg === 'LICENSE_NOT_FOUND') errorMsg = 'Llicència no trobada';
      if (errorMsg === 'LICENSE_INACTIVE') errorMsg = 'Llicència inactiva';
      if (errorMsg === 'INSUFFICIENT_CREDITS') errorMsg = 'Crèdits insuficients';
      console.log('SideCar: API error:', errorMsg);
      return { success: false, error: errorMsg };
    }

    // Substituir el text seleccionat amb el resultat
    const resultText = responseData.result_text;
    if (textElement && resultText) {
      // Eliminar el text original i inserir el nou
      textElement.deleteText(startOffset, endOffset);
      textElement.insertText(startOffset, resultText);
      console.log('SideCar: Text replaced successfully');
    }

    return {
      success: true,
      credits_remaining: responseData.credits_remaining,
      mode: responseData.mode,
      change_summary: responseData.change_summary || null
    };

  } catch (error) {
    console.log('SideCar: Connection error:', error.message);
    return { success: false, error: 'Error de connexió: ' + error.message };
  }
}

// Mantenir compatibilitat amb versions anteriors
function formalizeSelection() {
  return processSelection('formalize');
}
