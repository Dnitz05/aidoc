// --- CONFIGURACIÓ ---
const API_URL = 'https://sidecar-api.conteucontes.workers.dev'; // Assegura't que és la teva URL

function onOpen() {
  DocumentApp.getUi().createMenu('SideCar')
      .addItem('Obrir Xatbot', 'showSidebar')
      .addToUi();
}

function showSidebar() {
  const html = HtmlService.createTemplateFromFile('Sidebar')
      .evaluate()
      .setTitle('SideCar AI'); // Nou títol
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
  let targetElement = null; // Guardem on escriurem la resposta

  // 1. Validar llicència
  const licenseKey = getLicenseKey();
  if (!licenseKey) throw new Error("Configura la llicència primer (⚙️).");

  // 2. LÒGICA INTEL·LIGENT DE SELECCIÓ
  if (selection) {
    // CAS A: L'usuari ha seleccionat una part específica
    const elements = selection.getRangeElements();
    const firstElement = elements[0].getElement();

    if (firstElement.editAsText) {
      targetElement = firstElement.editAsText();
      textToProcess = targetElement.getText();
    }
  }

  // CAS B: No hi ha selecció -> Agafem TOT el document
  if (!textToProcess) {
    const body = doc.getBody();
    textToProcess = body.getText();
    targetElement = body.editAsText();
  }

  if (!textToProcess.trim()) throw new Error("El document està buit.");

  // 2. Preparar Payload
  const payload = {
    license_key: licenseKey,
    mode: 'custom', // Ara tot és mode 'custom'
    user_instruction: instruction,
    text: textToProcess,
    doc_metadata: { doc_id: doc.getId() }
  };

  const options = {
    'method' : 'post',
    'contentType': 'application/json',
    'payload' : JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  // 3. Crida al Worker
  try {
    const response = UrlFetchApp.fetch(API_URL, options);
    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() !== 200 || json.status !== 'ok') {
      throw new Error(json.error_code || "Error API desconegut");
    }

    // 4. Aplicar canvis al document
    textElement.setText(json.result_text);

    // 5. Retornar info per al xat
    return {
      ok: true,
      ai_response: json.change_summary, // L'explicació curta
      credits: json.credits_remaining
    };

  } catch (e) {
    throw new Error("Error SideCar: " + e.message);
  }
}
