/**
 * SideCar - Google Docs Add-on
 * Formalitza text seleccionat usant IA
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
 * Formalitza el text seleccionat
 */
function formalizeSelection() {
  // Obtenir la llicència
  const licenseKey = getLicenseKey();
  if (!licenseKey) {
    return { success: false, error: 'No hi ha cap llicència configurada' };
  }

  // Obtenir la selecció
  const doc = DocumentApp.getActiveDocument();
  const selection = doc.getSelection();

  if (!selection) {
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
    return { success: false, error: 'La selecció no conté text' };
  }

  // Cridar l'API
  try {
    const payload = {
      license_key: licenseKey,
      mode: 'formalize',
      text: selectedText,
      doc_metadata: {
        doc_id: doc.getId(),
        doc_name: doc.getName()
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(API_URL, options);
    const responseCode = response.getResponseCode();
    const responseData = JSON.parse(response.getContentText());

    if (responseCode !== 200) {
      let errorMsg = responseData.error || 'Error desconegut';
      if (errorMsg === 'LICENSE_NOT_FOUND') errorMsg = 'Llicència no trobada';
      if (errorMsg === 'LICENSE_INACTIVE') errorMsg = 'Llicència inactiva';
      if (errorMsg === 'INSUFFICIENT_CREDITS') errorMsg = 'Crèdits insuficients';
      return { success: false, error: errorMsg };
    }

    // Substituir el text seleccionat amb el resultat
    const resultText = responseData.result_text;
    if (textElement && resultText) {
      // Eliminar el text original i inserir el nou
      textElement.deleteText(startOffset, endOffset);
      textElement.insertText(startOffset, resultText);
    }

    return {
      success: true,
      credits_remaining: responseData.credits_remaining
    };

  } catch (error) {
    return { success: false, error: 'Error de connexió: ' + error.message };
  }
}
