# Pla d'Implementació Docmile v12.1
## Basat en Consulta Gemini Ultra (Desembre 2024)

---

## RESUM EXECUTIU

### Prioritats Acordades

| Prioritat | Tasca | Impacte | Esforç |
|-----------|-------|---------|--------|
| 🔴 P1 | Semantic Override al Classifier | Alt | Baix |
| 🔴 P1 | Arquitectura Híbrida (Find/Replace + FormatPreserver) | Alt | Mitjà |
| 🟡 P2 | Prompt FIX amb Context Anchors | Alt | Baix |
| 🟡 P2 | Shadow Validator (Thresholds & Integrity) | Alt | Mitjà |
| 🟢 P3 | Detecció Noms Propis & Diacrítics | Mitjà | Mitjà |
| 🟢 P3 | Format cita [[§ID]] + response_style | Baix | Baix |

### Fitxers Afectats

| Fitxer | Canvis |
|--------|--------|
| `worker/multiagent/classifier.js` | Semantic override, thought field, response_style |
| `worker/multiagent/executors/update.js` | Prompt FIX amb context anchors |
| `worker/multiagent/validator.js` | NOU: Shadow Validator complet |
| `worker/multiagent/config.js` | Temperatures i thresholds |
| `docs-addon/Code.gs` | Router híbrid, replaceText natiu |
| `docs-addon/Sidebar.html` | Parsing [[§ID]], deep links |

---

## FASE 1: PRIORITAT 1 (Setmana 1)

### 1.1 Semantic Override al Classifier

**Objectiu:** Les preguntes factuals SEMPRE van a CHAT_ONLY, ignorant ui_mode.

**Fitxer:** `worker/multiagent/classifier.js`

#### Canvi 1: Actualitzar CLASSIFIER_SYSTEM_PROMPT

```javascript
const CLASSIFIER_SYSTEM_PROMPT = `Ets el Router d'Intencions de Docmile. Retorna JSON estricte.

## MATRIU DE DECISIÓ (ORDRE DE PRIORITAT ESTRICTE)

### PRIORITAT 0: PREGUNTA FACTUAL (OVERRIDE ABSOLUT)
Patrons: "Qui...", "Quan...", "On...", "Quin és...", "Quina és...", "De què parla...",
         "Explica...", "Què diu...", "Què significa...", "Quants..."
ACCIÓ: mode = "CHAT_ONLY" (IGNORA ui_mode encara que sigui EDIT)
response_style:
  - Si conté "resumeix/resum/sintetitza" → "bullet_points"
  - Si conté "explica/analitza/detalla" → "detailed"
  - Resta → "concise"

### PRIORITAT 1: REFERENCE_HIGHLIGHT (Anàlisi Passiva)
Patrons: "Veus faltes?", "Hi ha errors?", "Busca 'X'", "Revisa...", "Analitza ortografia"
ACCIÓ: mode = "REFERENCE_HIGHLIGHT"

### PRIORITAT 2: UPDATE_BY_ID (Modificació Activa)
Patrons: "Corregeix...", "Millora...", "Amplia...", "Simplifica...", "Tradueix..."
ACCIÓ: mode = "UPDATE_BY_ID"
modification_type: "fix" | "improve" | "expand" | "simplify" | "translate"

### PRIORITAT 3: REWRITE (Transformació Global)
Patrons: "Fes més formal", "Canvia el to", "Reescriu...", "Escriu un nou..."
ACCIÓ: mode = "REWRITE"
requires_confirmation: true

## OUTPUT JSON
{
  "thought": "<Raonament breu de 1 frase>",
  "mode": "CHAT_ONLY|REFERENCE_HIGHLIGHT|UPDATE_BY_ID|REWRITE",
  "confidence": 0.0-1.0,
  "response_style": "concise|bullet_points|detailed|null",
  "highlight_strategy": "errors|mentions|suggestions|structure|all|null",
  "modification_type": "fix|improve|expand|simplify|translate|null",
  "keywords": ["<termes a buscar>"],
  "target_paragraphs": [],
  "scope": "selection|paragraph|document",
  "requires_confirmation": false,
  "is_question": true|false
}`;
```

#### Canvi 2: Actualitzar config.js amb temperatures

**Fitxer:** `worker/multiagent/config.js`

```javascript
// Afegir/actualitzar a config.js
export const TEMPERATURES = {
  classifier: 0.0,      // Determinisme absolut
  fix: 0.0,             // Zero creativitat
  highlight: 0.1,       // Anàlisi estricta
  chat: 0.3,            // Baixa per no inventar
  improve: 0.5,         // Fluïdesa moderada
  expand: 0.5,
  simplify: 0.4,
  translate: 0.3,
  rewrite: 0.7,         // Màxima creativitat
};

export const LENGTH_THRESHOLDS = {
  fix: { min: -0.10, max: 0.10, action: 'BLOCK' },
  improve: { min: -0.30, max: 0.40, action: 'WARN' },
  expand: { min: 0.10, max: 2.0, action: 'BLOCK' },    // Mínim +10%
  simplify: { min: -0.60, max: 0.10, action: 'WARN' }, // Màxim -60%
  translate: { min: -0.40, max: 0.40, action: 'PASS' },
  rewrite: { min: -1.0, max: 10.0, action: 'PASS' },   // Sense límit
};
```

#### Test d'Acceptació P1.1

| Input | ui_mode | Expected Output |
|-------|---------|-----------------|
| "Qui signa l'informe?" | EDIT | mode: CHAT_ONLY |
| "Resumeix el document" | EDIT | mode: CHAT_ONLY, response_style: bullet_points |
| "Corregeix les faltes" | EDIT | mode: UPDATE_BY_ID, modification_type: fix |
| "Veus errors?" | EDIT | mode: REFERENCE_HIGHLIGHT |

---

### 1.2 Arquitectura Híbrida (Code.gs)

**Objectiu:** Usar `replaceText()` natiu per FIX, FormatPreserver per la resta.

**Fitxer:** `docs-addon/Code.gs`

#### Canvi 1: Crear Router de Pipelines

```javascript
// ═══════════════════════════════════════════════════════════════
// PIPELINE ROUTER v12.1
// ═══════════════════════════════════════════════════════════════

/**
 * Router que decideix quin pipeline usar segons el mode
 * @param {Object} result - Resultat del worker
 * @param {Object} context - Context del document
 */
function routeAndApplyChanges(result, context) {
  const mode = result.mode;
  const modificationType = result.modification_type || result._meta?.modification_type;

  logDebug('Pipeline Router', { mode, modificationType });

  // Pipeline A: QUIRÚRGIC (Find/Replace natiu)
  if (mode === 'UPDATE_BY_ID' && modificationType === 'fix') {
    return applyFindReplaceChanges(result.changes, context);
  }

  // Pipeline B: RECONSTRUCTIU (FormatPreserver)
  if (mode === 'UPDATE_BY_ID' || mode === 'REWRITE') {
    return applyFormatPreserverChanges(result.changes, context);
  }

  // Altres modes no modifiquen document
  return { success: true, applied: 0 };
}

/**
 * Pipeline A: Find/Replace Natiu
 * Per mode FIX - preserva format automàticament
 */
function applyFindReplaceChanges(changes, context) {
  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();
  const paragraphs = body.getParagraphs();

  let applied = 0;
  const errors = [];
  const undoStack = [];

  for (const change of changes) {
    try {
      const paraIndex = change.paragraph_id;
      if (paraIndex < 0 || paraIndex >= paragraphs.length) {
        errors.push({ change, error: 'Invalid paragraph_id' });
        continue;
      }

      const para = paragraphs[paraIndex];
      const originalText = para.getText();

      // Verificar que 'find' existeix (Hallucination Check)
      if (!originalText.includes(change.find)) {
        errors.push({ change, error: 'Find text not found in paragraph' });
        continue;
      }

      // Guardar per undo
      undoStack.push({
        type: 'find_replace',
        paragraph_id: paraIndex,
        find: change.replace,      // Invertit per undo
        replace: change.find,
        originalFullText: originalText
      });

      // Aplicar canvi amb mètode natiu (PRESERVA FORMAT!)
      para.replaceText(escapeRegexForGAS(change.find), change.replace);
      applied++;

      logDebug('Applied find/replace', {
        paragraph: paraIndex,
        find: change.find,
        replace: change.replace
      });

    } catch (e) {
      errors.push({ change, error: e.message });
    }
  }

  // Guardar undo stack
  if (undoStack.length > 0) {
    PropertiesService.getDocumentProperties().setProperty(
      'lastFindReplaceUndo',
      JSON.stringify(undoStack)
    );
  }

  return { success: errors.length === 0, applied, errors, pipeline: 'find_replace' };
}

/**
 * Escapa caràcters especials de regex per a Google Apps Script
 */
function escapeRegexForGAS(str) {
  // GAS replaceText usa regex, cal escapar caràcters especials
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pipeline B: FormatPreserver
 * Per modes IMPROVE, EXPAND, SIMPLIFY, TRANSLATE, REWRITE
 */
function applyFormatPreserverChanges(changes, context) {
  let applied = 0;
  const errors = [];

  for (const change of changes) {
    try {
      const result = applyChangePreservingFormat(
        getElementByParagraphId(change.paragraph_id),
        change.original_text,
        change.new_text,
        change.word_changes || null
      );

      if (result) {
        applied++;
      }
    } catch (e) {
      errors.push({ change, error: e.message });
    }
  }

  return { success: errors.length === 0, applied, errors, pipeline: 'format_preserver' };
}
```

#### Test d'Acceptació P1.2

| Mode | Input | Pipeline | Format Preservat? |
|------|-------|----------|-------------------|
| FIX | "dde" → "de" en text **negreta** | find_replace | ✅ Sí (natiu) |
| IMPROVE | Reestructurar frase | format_preserver | ✅ Sí (FormatPreserver) |
| EXPAND | Afegir contingut | format_preserver | ✅ Sí |

---

## FASE 2: PRIORITAT 2 (Setmana 2)

### 2.1 Prompt FIX amb Context Anchors

**Objectiu:** El camp `find` ha de ser únic dins del paràgraf.

**Fitxer:** `worker/multiagent/executors/update.js`

#### Canvi: Actualitzar UPDATE_PROMPTS.fix

```javascript
const UPDATE_PROMPTS = {
  fix: `CORRECTOR QUIRÚRGIC (Mode Find/Replace)
Objectiu: Corregir errors ortogràfics amb canvis MÍNIMS i ATÒMICS.

## FORMAT DE SORTIDA CRÍTIC
Retorna parells find/replace, NO text complet.
El camp "find" HA DE SER ÚNIC dins del paràgraf.

## REGLES FIND/REPLACE

### Regla 1: Context Anchors (Ancoratge)
Si l'error és una paraula comuna, inclou 2-3 paraules de context:
❌ find: "projecte" (pot aparèixer múltiples vegades)
✅ find: "del projecte PAE" (únic)

### Regla 2: Agrupació d'Errors Adjacents
Si hi ha errors separats per menys de 3 paraules, AGRUPA'LS:
Text: "La documentacio dde l'area metropolitana"
❌ 3 canvis separats (risc de conflicte)
✅ find: "documentacio dde l'area", replace: "documentació de l'àrea"

### Regla 3: Verificació
Abans de retornar, verifica mentalment que el "find" NOMÉS apareix UNA vegada.

## ERRORS A CORREGIR
- Lletres repetides: "dde" → "de", "laa" → "la"
- Accents oblidats: "area" → "àrea", "documentacio" → "documentació"
- Concordança evident: "els casa" → "les cases"

## NO CORREGIR
- Noms propis (majúscula a mig de frase)
- Sigles: PAE, DOGC, API
- Estil o preferències

## ACCENTS DIACRÍTICS CATALANS (ATENCIÓ)
Parells ambigus: te/té, mes/més, dona/dóna, sol/sòl
- Si el context és CLAR → Corregir
- Si hi ha DUBTE → NO corregir (millor no tocar)

## OUTPUT JSON
{
  "changes": [
    {
      "paragraph_id": <número>,
      "find": "<text únic amb context si cal>",
      "replace": "<text corregit>",
      "reason": "typo|accent|grammar|diacritic"
    }
  ]
}

Si no hi ha errors: {"changes": [], "message": "Cap error detectat"}`,

  // ... altres modes es mantenen igual
};
```

---

### 2.2 Shadow Validator Complet

**Objectiu:** Capa de seguretat entre Gemini i l'aplicació de canvis.

**Fitxer NOU:** `worker/multiagent/validator.js`

```javascript
/**
 * Shadow Validator v1.0
 *
 * Valida i filtra respostes de Gemini abans d'aplicar-les.
 */

import { LENGTH_THRESHOLDS } from './config.js';
import { logWarn, logError, logInfo } from './telemetry.js';

/**
 * Valida una resposta de Gemini segons el mode
 * @param {Object} response - Resposta de Gemini parseada
 * @param {string} mode - Mode d'operació
 * @param {string} modificationType - Tipus de modificació (per UPDATE_BY_ID)
 * @param {Object} documentContext - Context original del document
 * @returns {Object} { valid: boolean, response: filteredResponse, warnings: [], errors: [] }
 */
export function validateGeminiResponse(response, mode, modificationType, documentContext) {
  const result = {
    valid: true,
    response: response,
    warnings: [],
    errors: [],
  };

  // Mode FIX: Validació específica find/replace
  if (mode === 'UPDATE_BY_ID' && modificationType === 'fix') {
    return validateFixResponse(response, documentContext, result);
  }

  // Altres modes UPDATE: Validació de thresholds
  if (mode === 'UPDATE_BY_ID') {
    return validateUpdateResponse(response, modificationType, documentContext, result);
  }

  // Mode HIGHLIGHT: Filtrar possibles falsos positius
  if (mode === 'REFERENCE_HIGHLIGHT') {
    return validateHighlightResponse(response, documentContext, result);
  }

  return result;
}

/**
 * Validació específica per mode FIX
 */
function validateFixResponse(response, documentContext, result) {
  if (!response.changes || !Array.isArray(response.changes)) {
    result.valid = false;
    result.errors.push('Missing or invalid changes array');
    return result;
  }

  const validatedChanges = [];

  for (const change of response.changes) {
    const checks = validateSingleFindReplace(change, documentContext);

    if (checks.errors.length > 0) {
      result.errors.push(...checks.errors);
      logWarn('FIX change rejected', { change, errors: checks.errors });
      continue;
    }

    if (checks.warnings.length > 0) {
      result.warnings.push(...checks.warnings);
    }

    validatedChanges.push(change);
  }

  result.response = { ...response, changes: validatedChanges };
  result.valid = result.errors.length === 0;

  logInfo('FIX validation complete', {
    original: response.changes?.length || 0,
    validated: validatedChanges.length,
    warnings: result.warnings.length,
    errors: result.errors.length
  });

  return result;
}

/**
 * Valida un sol canvi find/replace
 */
function validateSingleFindReplace(change, documentContext) {
  const checks = { errors: [], warnings: [] };

  // Check 1: Camps requerits
  if (!change.find || !change.replace || change.paragraph_id === undefined) {
    checks.errors.push(`Missing required fields: ${JSON.stringify(change)}`);
    return checks;
  }

  // Check 2: paragraph_id vàlid
  const para = documentContext.paragraphs?.[change.paragraph_id];
  if (!para) {
    checks.errors.push(`Invalid paragraph_id: ${change.paragraph_id}`);
    return checks;
  }

  const paraText = para.text || para;

  // Check 3: CRÍTIC - Hallucination Check
  // El text "find" ha d'existir LITERALMENT al paràgraf
  if (!paraText.includes(change.find)) {
    checks.errors.push(`HALLUCINATION: Find text "${change.find}" not found in paragraph ${change.paragraph_id}`);
    return checks;
  }

  // Check 4: Unicitat del find
  const occurrences = (paraText.match(new RegExp(escapeRegex(change.find), 'g')) || []).length;
  if (occurrences > 1) {
    checks.warnings.push(`Non-unique find: "${change.find}" appears ${occurrences} times in paragraph ${change.paragraph_id}`);
  }

  // Check 5: Length threshold per FIX
  const lengthDiff = (change.replace.length - change.find.length) / change.find.length;
  const threshold = LENGTH_THRESHOLDS.fix;

  if (lengthDiff < threshold.min || lengthDiff > threshold.max) {
    if (threshold.action === 'BLOCK') {
      checks.errors.push(`Length change ${(lengthDiff * 100).toFixed(1)}% exceeds FIX threshold (±10%)`);
    } else {
      checks.warnings.push(`Large length change: ${(lengthDiff * 100).toFixed(1)}%`);
    }
  }

  // Check 6: No tocar text amb majúscula a mig de frase (possible nom propi)
  if (isLikelyProperNoun(change.find, paraText, documentContext)) {
    checks.warnings.push(`Possible proper noun: "${change.find}"`);
  }

  return checks;
}

/**
 * Determina si una paraula és probablement un nom propi
 */
function isLikelyProperNoun(word, paragraphText, documentContext) {
  // Si no comença per majúscula, no és nom propi
  if (!/^[A-ZÀÈÉÍÒÓÚÜÏÇÑ]/.test(word)) {
    return false;
  }

  // Check 1: Està a principi de frase?
  const beforeWord = paragraphText.split(word)[0];
  const isStartOfSentence = !beforeWord || /[.!?]\s*$/.test(beforeWord) || /^\s*$/.test(beforeWord);

  if (isStartOfSentence) {
    // Check 2: Apareix en minúscula en altres llocs del document?
    const lowerWord = word.toLowerCase();
    const allText = documentContext.paragraphs?.map(p => p.text || p).join(' ') || '';
    const hasLowerVersion = allText.includes(lowerWord);

    // Si existeix versió minúscula, és paraula comuna (no nom propi)
    return !hasLowerVersion;
  }

  // Majúscula a mig de frase = probablement nom propi
  return true;
}

/**
 * Validació per altres modes UPDATE (improve, expand, simplify, translate)
 */
function validateUpdateResponse(response, modificationType, documentContext, result) {
  if (!response.changes || !Array.isArray(response.changes)) {
    result.valid = false;
    result.errors.push('Missing or invalid changes array');
    return result;
  }

  const threshold = LENGTH_THRESHOLDS[modificationType] || LENGTH_THRESHOLDS.improve;
  const validatedChanges = [];

  for (const change of response.changes) {
    // Verificar que original_text existeix
    const para = documentContext.paragraphs?.[change.paragraph_id];
    if (!para) {
      result.errors.push(`Invalid paragraph_id: ${change.paragraph_id}`);
      continue;
    }

    // Calcular canvi de longitud
    const originalLen = (change.original_text || '').length;
    const newLen = (change.new_text || '').length;

    if (originalLen === 0) {
      result.warnings.push(`Empty original_text for paragraph ${change.paragraph_id}`);
      validatedChanges.push(change);
      continue;
    }

    const lengthDiff = (newLen - originalLen) / originalLen;

    // Aplicar threshold segons mode
    if (lengthDiff < threshold.min || lengthDiff > threshold.max) {
      const msg = `Length change ${(lengthDiff * 100).toFixed(1)}% outside ${modificationType} threshold [${threshold.min * 100}%, ${threshold.max * 100}%]`;

      if (threshold.action === 'BLOCK') {
        result.errors.push(msg);
        continue;
      } else {
        result.warnings.push(msg);
      }
    }

    validatedChanges.push(change);
  }

  result.response = { ...response, changes: validatedChanges };
  result.valid = result.errors.filter(e => threshold.action === 'BLOCK').length === 0;

  return result;
}

/**
 * Validació per HIGHLIGHT
 */
function validateHighlightResponse(response, documentContext, result) {
  if (!response.highlights || !Array.isArray(response.highlights)) {
    result.valid = false;
    result.errors.push('Missing or invalid highlights array');
    return result;
  }

  const validatedHighlights = [];

  for (const highlight of response.highlights) {
    // Verificar que el text existeix
    const para = documentContext.paragraphs?.[highlight.paragraph_id];
    if (!para) {
      result.warnings.push(`Invalid paragraph_id: ${highlight.paragraph_id}`);
      continue;
    }

    const paraText = para.text || para;

    // Check: Text existeix al paràgraf
    if (!paraText.includes(highlight.text_to_highlight)) {
      result.warnings.push(`Highlight text not found: "${highlight.text_to_highlight}"`);
      continue;
    }

    // Check: Filtrar possibles noms propis (només per errors)
    if (highlight.severity === 'error') {
      if (isLikelyProperNoun(highlight.text_to_highlight, paraText, documentContext)) {
        result.warnings.push(`Filtered proper noun from errors: "${highlight.text_to_highlight}"`);
        continue;
      }
    }

    validatedHighlights.push(highlight);
  }

  result.response = { ...response, highlights: validatedHighlights };
  result.valid = true; // Highlights mai bloquegen

  logInfo('HIGHLIGHT validation complete', {
    original: response.highlights?.length || 0,
    validated: validatedHighlights.length,
    filtered: (response.highlights?.length || 0) - validatedHighlights.length
  });

  return result;
}

/**
 * Escapa caràcters especials de regex
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { validateSingleFindReplace, isLikelyProperNoun };
```

---

## FASE 3: PRIORITAT 3 (Setmana 3)

### 3.1 Format Cita [[§ID]] i response_style

**Fitxer:** `worker/multiagent/executors/chat.js`

#### Canvi: Actualitzar CHAT_SYSTEM_PROMPT amb response_style

```javascript
const CHAT_SYSTEM_PROMPT_TEMPLATES = {
  concise: `MOTOR DE RESPOSTA FACTUAL (Mode Concís)
Objectiu: Extreure la resposta exacta amb màxima brevetat.

## REGLES
1. MÀXIM 2 frases
2. Cita OBLIGATÒRIA: [[§ID]] al final de cada afirmació
3. Si no trobes la resposta: "No consta al document."
4. MAI suggerir canvis

## FORMAT
Resposta directa [[§ID]].`,

  bullet_points: `MOTOR DE RESPOSTA FACTUAL (Mode Punts)
Objectiu: Resumir en punts clau.

## REGLES
1. 3-5 punts màxim
2. Format: "• Punt [[§ID]]"
3. Cada punt és autònom i citable
4. Ordenar per importància

## FORMAT
• Primer punt clau [[§X]]
• Segon punt [[§Y]]
• Tercer punt [[§Z]]`,

  detailed: `MOTOR DE RESPOSTA FACTUAL (Mode Detallat)
Objectiu: Explicació estructurada.

## REGLES
1. 2-3 paràgrafs curts
2. Cada afirmació porta [[§ID]]
3. Estructura: Context → Explicació → Conclusió
4. MAI inventar, només citar document`,
};

function getChatPromptForStyle(style) {
  return CHAT_SYSTEM_PROMPT_TEMPLATES[style] || CHAT_SYSTEM_PROMPT_TEMPLATES.concise;
}
```

**Fitxer:** `docs-addon/Sidebar.html`

#### Canvi: Parser per [[§ID]]

```javascript
/**
 * Converteix [[§ID]] a enllaços clicables
 */
function parseCitations(text) {
  return text.replace(/\[\[§(\d+)\]\]/g, (match, id) => {
    const paraId = parseInt(id, 10);
    return `<a href="#" class="citation-link" data-para-id="${paraId}" onclick="scrollToParagraph(${paraId}); return false;">§${id}</a>`;
  });
}

/**
 * Scroll al paràgraf citat
 */
function scrollToParagraph(paraId) {
  google.script.run
    .withSuccessHandler(() => {
      // Opcional: highlight temporal
      showToast(`Navegant a §${paraId}`);
    })
    .scrollToParagraphById(paraId);
}
```

---

### 3.2 Detecció Diacrítics Catalans

**Fitxer:** `worker/multiagent/executors/highlight.js`

#### Canvi: Afegir lògica de confidence tiering

```javascript
// Afegir al HIGHLIGHT_PROMPTS.errors

const CATALAN_DIACRITICS_ADDENDUM = `

## ACCENTS DIACRÍTICS CATALANS (CAS ESPECIAL)

Parells on AMBDUES formes existeixen:
| Sense | Amb | Exemple sense | Exemple amb |
|-------|-----|---------------|-------------|
| te | té | "te verd" (planta) | "ell té raó" (verb) |
| mes | més | "fa uns mesos" | "vull més" |
| dona | dóna | "una dona" (femella) | "li dóna" (verb) |
| sol | sòl | "el sol" (astre) | "el sòl" (terra) |
| os | ós | "un os" (animal) | "l'os del braç" |

### PROTOCOL:
1. Analitza el CONTEXT GRAMATICAL
2. Si estàs 100% segur de l'error → severity: "error"
3. Si hi ha DUBTE → severity: "suggestion" amb comment: "Verificar accent diacrític: X/Y"
4. MAI marcar com error si no estàs segur`;
```

---

## INTEGRACIÓ I TESTING

### Checklist Pre-Deploy

- [ ] Classifier retorna `response_style` correctament
- [ ] Temperatures actualitzades a config.js
- [ ] Router a Code.gs diferencia FIX d'altres modes
- [ ] `replaceText()` preserva format (test manual amb negreta/colors)
- [ ] Shadow Validator bloqueja hallucinations
- [ ] Thresholds correctes per mode
- [ ] Parser [[§ID]] funciona al Sidebar
- [ ] Deep links naveguen al paràgraf correcte

### Tests Automatitzats (Proposats)

```javascript
// tests/validator.test.js

describe('Shadow Validator', () => {
  describe('FIX mode', () => {
    it('should reject hallucinated find text', () => {
      const response = { changes: [{ paragraph_id: 0, find: 'xyz', replace: 'abc' }] };
      const context = { paragraphs: [{ text: 'Hello world' }] };
      const result = validateGeminiResponse(response, 'UPDATE_BY_ID', 'fix', context);
      expect(result.errors).toContain(expect.stringContaining('HALLUCINATION'));
    });

    it('should warn on non-unique find', () => {
      const response = { changes: [{ paragraph_id: 0, find: 'the', replace: 'The' }] };
      const context = { paragraphs: [{ text: 'the cat and the dog' }] };
      const result = validateGeminiResponse(response, 'UPDATE_BY_ID', 'fix', context);
      expect(result.warnings).toContain(expect.stringContaining('Non-unique'));
    });

    it('should block changes exceeding 10% length', () => {
      const response = { changes: [{ paragraph_id: 0, find: 'cat', replace: 'a very large animal indeed' }] };
      const context = { paragraphs: [{ text: 'the cat sat' }] };
      const result = validateGeminiResponse(response, 'UPDATE_BY_ID', 'fix', context);
      expect(result.valid).toBe(false);
    });
  });

  describe('Proper noun detection', () => {
    it('should identify mid-sentence capitals as proper nouns', () => {
      const result = isLikelyProperNoun('Catalunya', 'Viu a Catalunya des de fa anys', {});
      expect(result).toBe(true);
    });

    it('should not flag start-of-sentence capitals if lowercase exists', () => {
      const context = { paragraphs: [{ text: 'això és bo' }, { text: 'Això també' }] };
      const result = isLikelyProperNoun('Això', 'Això també', context);
      expect(result).toBe(false);
    });
  });
});
```

---

## CRONOGRAMA

| Setmana | Fase | Lliurable |
|---------|------|-----------|
| 1 | P1 | Semantic Override + Arquitectura Híbrida |
| 2 | P2 | Prompt FIX + Shadow Validator |
| 3 | P3 | Cites [[§ID]] + Diacrítics |
| 4 | Testing | Validació completa + fixes |

---

## RISCOS I MITIGACIONS

| Risc | Probabilitat | Impacte | Mitigació |
|------|--------------|---------|-----------|
| `replaceText()` no preserva format | Baixa | Alt | Test manual exhaustiu abans de deploy |
| Shadow Validator massa restrictiu | Mitjana | Mitjà | Logs detallats + ajust thresholds |
| Latència per `thought` field | Baixa | Baix | Només al Classifier |
| Edge cases diacrítics catalans | Alta | Baix | Fallback a "suggestion" |

---

## APROVACIÓ

- [ ] Pla revisat i aprovat
- [ ] Recursos assignats
- [ ] Començar implementació Fase 1
